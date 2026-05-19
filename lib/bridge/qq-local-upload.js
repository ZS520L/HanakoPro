import crypto from "crypto";
import fs from "fs";
import path from "path";

export const QQ_FILE_TYPE = Object.freeze({
  IMAGE: 1,
  VIDEO: 2,
  VOICE: 3,
  FILE: 4,
});

export const QQ_UPLOAD_SIZE_LIMITS = Object.freeze({
  [QQ_FILE_TYPE.IMAGE]: 30 * 1024 * 1024,
  [QQ_FILE_TYPE.VIDEO]: 100 * 1024 * 1024,
  [QQ_FILE_TYPE.VOICE]: 20 * 1024 * 1024,
  [QQ_FILE_TYPE.FILE]: 100 * 1024 * 1024,
});

const MD5_10M_SIZE = 10_002_432;
const DEFAULT_CONCURRENT_PARTS = 1;
const MAX_CONCURRENT_PARTS = 10;
const PART_UPLOAD_TIMEOUT_MS = 300_000;
const PART_UPLOAD_MAX_RETRIES = 2;
const PART_FINISH_MAX_RETRIES = 2;
const PART_FINISH_BASE_DELAY_MS = 1000;
const PART_FINISH_RETRYABLE_CODE = 40093001;
const PART_FINISH_RETRYABLE_DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const PART_FINISH_RETRYABLE_INTERVAL_MS = 1000;
const MAX_PART_FINISH_RETRY_TIMEOUT_MS = 10 * 60 * 1000;
const COMPLETE_UPLOAD_MAX_RETRIES = 2;
const COMPLETE_UPLOAD_BASE_DELAY_MS = 2000;

export class QQApiError extends Error {
  constructor(message, { status, path: requestPath, bizCode } = {}) {
    super(message);
    this.name = "QQApiError";
    this.status = status;
    this.path = requestPath;
    this.bizCode = bizCode;
  }
}

export async function uploadQQLocalFile({ apiRequest, chatId, filePath, fileType, metadata = {} }) {
  const targets = qqMediaTargets(chatId, metadata);
  let lastError = null;
  for (const target of targets) {
    if (target.scope === "group" && fileType === QQ_FILE_TYPE.FILE) {
      lastError = new Error("QQ 群聊暂不开放文件类型发送，请改用单聊或发送图片/视频/语音");
      continue;
    }
    try {
      return await chunkedUploadLocalFile({ apiRequest, target, filePath, fileType, metadata });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (metadata.isGroup !== undefined) throw lastError;
    }
  }
  throw lastError || new Error("QQ 本地文件上传失败");
}

function qqMediaTargets(chatId, metadata = {}) {
  const scopes = metadata.isGroup === true ? ["group"]
    : metadata.isGroup === false ? ["user"]
      : ["user", "group"];
  return scopes.map((scope) => {
    const base = scope === "group" ? `/v2/groups/${chatId}` : `/v2/users/${chatId}`;
    return {
      scope,
      prepare: `${base}/upload_prepare`,
      partFinish: `${base}/upload_part_finish`,
      complete: `${base}/files`,
    };
  });
}

async function chunkedUploadLocalFile({ apiRequest, target, filePath, fileType, metadata }) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`QQ 只能上传文件，不能上传目录：${filePath}`);
  if (stat.size === 0) throw new Error(`QQ 不能发送空文件：${filePath}`);
  const maxBytes = QQ_UPLOAD_SIZE_LIMITS[fileType] || QQ_UPLOAD_SIZE_LIMITS[QQ_FILE_TYPE.FILE];
  if (stat.size > maxBytes) {
    throw new Error(`QQ ${qqTypeName(fileType)}过大（${formatBytes(stat.size)}），超过 ${formatBytes(maxBytes)} 限制`);
  }

  const fileName = sanitizeUploadFileName(metadata.filename || path.basename(filePath));
  const hashes = await computeLocalFileHashes(filePath, stat.size);
  const prepare = await apiRequest("POST", target.prepare, {
    file_type: fileType,
    file_name: fileName,
    file_size: stat.size,
    md5: hashes.md5,
    sha1: hashes.sha1,
    md5_10m: hashes.md5_10m,
  });

  const uploadId = prepare.upload_id;
  const blockSize = Number(prepare.block_size);
  const parts = Array.isArray(prepare.parts) ? prepare.parts : [];
  if (!uploadId || !Number.isFinite(blockSize) || blockSize <= 0 || parts.length === 0) {
    throw new Error("QQ upload_prepare 返回格式异常");
  }

  const concurrency = Math.min(
    Math.max(Number(prepare.concurrency) || DEFAULT_CONCURRENT_PARTS, 1),
    MAX_CONCURRENT_PARTS,
  );
  const retryTimeoutMs = parseRetryTimeoutMs(prepare.retry_timeout);

  await runWithConcurrency(parts.map((part) => async () => {
    const partIndex = Number(part.index);
    if (!Number.isInteger(partIndex) || partIndex <= 0 || !part.presigned_url) {
      throw new Error("QQ upload_prepare 返回了无效分片");
    }
    const offset = (partIndex - 1) * blockSize;
    const length = Math.min(blockSize, stat.size - offset);
    if (length <= 0) throw new Error("QQ upload_prepare 分片范围超过文件大小");
    const chunk = await readFileChunk(filePath, offset, length);
    const md5 = crypto.createHash("md5").update(chunk).digest("hex");
    await putToPresignedUrl(part.presigned_url, chunk);
    await finishUploadPart(apiRequest, target.partFinish, {
      upload_id: uploadId,
      part_index: partIndex,
      block_size: length,
      md5,
    }, retryTimeoutMs);
  }), concurrency);

  return completeUploadWithRetry(apiRequest, target.complete, { upload_id: uploadId });
}

function qqTypeName(fileType) {
  if (fileType === QQ_FILE_TYPE.IMAGE) return "图片";
  if (fileType === QQ_FILE_TYPE.VIDEO) return "视频";
  if (fileType === QQ_FILE_TYPE.VOICE) return "语音";
  return "文件";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function replaceAsciiControlChars(value, replacement) {
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1F || code === 0x7F ? replacement : char;
  }).join("");
}

function sanitizeUploadFileName(value) {
  const base = path.basename(String(value || "file"));
  const cleaned = replaceAsciiControlChars(base, "_").trim();
  return cleaned.slice(0, 128) || "file";
}

function parseRetryTimeoutMs(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(seconds * 1000, MAX_PART_FINISH_RETRY_TIMEOUT_MS);
}

async function computeLocalFileHashes(filePath, fileSize) {
  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash("md5");
    const sha1 = crypto.createHash("sha1");
    const md5First10m = crypto.createHash("md5");
    const needsFirst10m = fileSize > MD5_10M_SIZE;
    let bytesRead = 0;

    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      md5.update(buffer);
      sha1.update(buffer);
      if (needsFirst10m) {
        const remaining = MD5_10M_SIZE - bytesRead;
        if (remaining > 0) {
          md5First10m.update(remaining >= buffer.length ? buffer : buffer.subarray(0, remaining));
        }
      }
      bytesRead += buffer.length;
    });
    stream.on("error", reject);
    stream.on("end", () => {
      const md5Hex = md5.digest("hex");
      resolve({
        md5: md5Hex,
        sha1: sha1.digest("hex"),
        md5_10m: needsFirst10m ? md5First10m.digest("hex") : md5Hex,
      });
    });
  });
}

async function readFileChunk(filePath, offset, length) {
  const fd = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await fd.read(buffer, 0, length, offset);
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

async function putToPresignedUrl(url, buffer) {
  let lastError = null;
  for (let attempt = 0; attempt <= PART_UPLOAD_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PART_UPLOAD_TIMEOUT_MS);
    try {
      const body = new Blob([buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)]);
      const res = await fetch(url, {
        method: "PUT",
        body,
        headers: { "Content-Length": String(buffer.length) },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`QQ part upload failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`.trim());
      }
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.name === "AbortError") {
        lastError = new Error(`QQ part upload timeout after ${PART_UPLOAD_TIMEOUT_MS}ms`);
      }
      if (attempt < PART_UPLOAD_MAX_RETRIES) {
        await sleep(1000 * Math.pow(2, attempt));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

async function finishUploadPart(apiRequest, endpoint, body, retryTimeoutMs) {
  let lastError = null;
  for (let attempt = 0; attempt <= PART_FINISH_MAX_RETRIES; attempt++) {
    try {
      await apiRequest("POST", endpoint, body);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof QQApiError && err.bizCode === PART_FINISH_RETRYABLE_CODE) {
        await retryUploadPartFinishUntilReady(apiRequest, endpoint, body, retryTimeoutMs);
        return;
      }
      if (attempt < PART_FINISH_MAX_RETRIES) {
        await sleep(PART_FINISH_BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

async function retryUploadPartFinishUntilReady(apiRequest, endpoint, body, retryTimeoutMs) {
  const timeoutMs = retryTimeoutMs || PART_FINISH_RETRYABLE_DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await apiRequest("POST", endpoint, body);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!(err instanceof QQApiError) || err.bizCode !== PART_FINISH_RETRYABLE_CODE) {
        throw lastError;
      }
      await sleep(Math.min(PART_FINISH_RETRYABLE_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
    }
  }
  throw lastError || new Error("QQ upload_part_finish 重试超时");
}

async function completeUploadWithRetry(apiRequest, endpoint, body) {
  let lastError = null;
  for (let attempt = 0; attempt <= COMPLETE_UPLOAD_MAX_RETRIES; attempt++) {
    try {
      return await apiRequest("POST", endpoint, body);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < COMPLETE_UPLOAD_MAX_RETRIES) {
        await sleep(COMPLETE_UPLOAD_BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

async function runWithConcurrency(tasks, concurrency) {
  for (let i = 0; i < tasks.length; i += concurrency) {
    await Promise.all(tasks.slice(i, i + concurrency).map((task) => task()));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
