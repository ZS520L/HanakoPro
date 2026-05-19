/**
 * sandbox/index.js — 沙盒入口（无状态工厂）
 *
 * 每次 buildTools 调用时创建 session 级的 PathGuard + OS 沙盒 exec。
 * 不持有 engine 级状态，天然支持多 agent 并发。
 */

import { deriveSandboxPolicy } from "./policy.js";
import { PathGuard } from "./path-guard.js";
import { detectPlatform, checkAvailability } from "./platform.js";
import { createSeatbeltExec } from "./seatbelt.js";
import { createBwrapExec } from "./bwrap.js";
import { createWin32Exec } from "./win32-exec.js";
import { wrapPathTool, wrapBashTool } from "./tool-wrapper.js";
import { createEnhancedReadFile } from "./read-enhanced.js";
import { wrapReadImageWithVisionBridge } from "./read-image-vision.js";
import { wrapReadOfficeMedia } from "./read-office-media.js";
import { t } from "../../server/i18n.js";
import fs, { constants } from "fs";
import { createWriteStream } from "fs";
import { access as fsAccess } from "fs/promises";
import path, { extname } from "path";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "../pi-sdk/index.js";
import { normalizeWin32ShellPath } from "./win32-path.js";
import { serializeSessionFile } from "../session-files/session-file-response.js";

/**
 * 为一个 session 创建沙盒包装后的工具集
 *
 * 每次调用独立，不共享状态。
 * 当传入 getSandboxEnabled 回调时，工具在每次调用时动态检查沙盒状态，
 * 切换偏好后无需重建 session 即可生效。
 *
 * @param {string} cwd  工作目录
 * @param {object[]} customTools  自定义工具
 * @param {object} opts
 * @param {string} opts.agentDir
 * @param {string|null} opts.workspace
 * @param {string[]} [opts.workspaceFolders]
 * @param {string} opts.hanakoHome
 * @param {() => boolean} opts.getSandboxEnabled  动态沙盒开关（每次工具调用时求值）
 * @param {() => boolean} [opts.getSandboxNetworkEnabled]  动态沙盒联网开关（仅沙盒开启时生效）
 * @param {() => boolean} [opts.getInlineDiffEnabled]  动态 inline diff 开关
 * @param {() => string[]} [opts.getExternalReadPaths]  当前 session 用户显式给过的外部只读路径
 * @param {() => string|null} [opts.getSessionPath]  当前工具调用归属的 sessionPath
 * @param {(entry: object) => void} [opts.recordFileOperation]  记录 write/edit 触达的 session file
 * @param {(event: object, sessionPath: string|null) => void} [opts.emitEvent]  发送 session 事件
 * @param {() => object|null} [opts.getVisionBridge]  辅助视觉桥
 * @param {() => boolean} [opts.isVisionAuxiliaryEnabled]  辅助视觉开关
 * @returns {{ tools: object[], customTools: object[] }}
 */
export function createSandboxedTools(cwd, customTools, {
  agentDir,
  workspace,
  workspaceFolders = [],
  hanakoHome,
  getSandboxEnabled,
  getSandboxNetworkEnabled,
  getInlineDiffEnabled,
  getExternalReadPaths,
  getSessionPath,
  recordFileOperation,
  emitEvent,
  getVisionBridge,
  isVisionAuxiliaryEnabled,
}) {
  // 始终按 standard 模式构建策略和 PathGuard，wrappers 在运行时动态 bypass
  const policy = deriveSandboxPolicy({ agentDir, workspace, workspaceFolders, hanakoHome, mode: "standard" });
  const guard = new PathGuard(policy);

  // 增强 readFile：xlsx 解析 + 编码检测，保留 PI SDK 默认的 access / detectImageMimeType
  const IMAGE_MIMES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
  const readOps = {
    readFile: createEnhancedReadFile(),
    access: (p) => fsAccess(p, constants.R_OK),
    detectImageMimeType: async (p) => IMAGE_MIMES[extname(p).toLowerCase()] || undefined,
  };

  const platform = detectPlatform();
  const isWin32 = process.platform === "win32";
  const wrapOpts = { getSandboxEnabled, getExternalReadPaths };

  // 无 OS 沙盒时的 bash 工具（沙盒关闭时回退用）
  const normalBashTool = isWin32
    ? createBashTool(cwd, { operations: { exec: createWin32Exec() } })
    : createBashTool(cwd);

  const bashWrapOpts = { getSandboxEnabled, getExternalReadPaths, fallbackTool: normalBashTool };
  const writeTool = wrapFileTouchTool(createWriteTool(cwd), cwd, {
    origin: "agent_write",
    operationForPath: (filePath) => fs.existsSync(filePath) ? "modified" : "created",
    getSessionPath,
    recordFileOperation,
    getInlineDiffEnabled,
    emitEvent,
  });
  const editTool = wrapFileTouchTool(createEditTool(cwd), cwd, {
    origin: "agent_edit",
    operationForPath: () => "modified",
    getSessionPath,
    recordFileOperation,
    getInlineDiffEnabled,
    emitEvent,
  });
  const readTool = wrapReadImageWithVisionBridge(wrapReadOfficeMedia(createReadTool(cwd, { operations: readOps }), cwd, {
    hanakoHome,
    getSessionPath,
    recordFileOperation,
    getVisionBridge,
    isVisionAuxiliaryEnabled,
  }), cwd, {
    getSessionPath,
    recordFileOperation,
    getVisionBridge,
    isVisionAuxiliaryEnabled,
  });

  // ── Windows: PathGuard 包装 + AppContainer exec，关闭沙盒时走 direct fallback ──
  if (platform === "win32-appcontainer") {
    const sandboxedBashTool = createBashTool(cwd, {
      operations: {
        exec: createWin32Exec({
          sandbox: {
            policy,
            getExternalReadPaths,
            getSandboxNetworkEnabled,
          },
        }),
      },
    });
    return {
      tools: [
        wrapPathTool(readTool, guard, "read", cwd, wrapOpts),
        wrapPathTool(writeTool, guard, "write", cwd, wrapOpts),
        wrapPathTool(editTool, guard, "write", cwd, wrapOpts),
        wrapBashTool(sandboxedBashTool, guard, cwd, bashWrapOpts),
        wrapPathTool(createGrepTool(cwd), guard, "read", cwd, wrapOpts),
        wrapPathTool(createFindTool(cwd), guard, "read", cwd, wrapOpts),
        wrapPathTool(createLsTool(cwd), guard, "read", cwd, wrapOpts),
      ],
      customTools,
    };
  }

  // ── macOS / Linux: PathGuard + OS 沙盒 ──
  let sandboxedBashTool = normalBashTool;
  if (checkAvailability(platform)) {
    const sandboxExec = platform === "seatbelt"
      ? createSeatbeltExec(policy, { getSandboxNetworkEnabled })
      : createBwrapExec(policy, { getExternalReadPaths, getSandboxNetworkEnabled });
    sandboxedBashTool = createBashTool(cwd, { operations: { exec: sandboxExec } });
  } else if (platform === "bwrap") {
    sandboxedBashTool = {
      ...normalBashTool,
      execute: async () => ({
        content: [{ type: "text", text: t("sandbox.osRequired", { platform }) }],
      }),
    };
  }

  return {
    tools: [
      wrapPathTool(readTool, guard, "read", cwd, wrapOpts),
      wrapPathTool(writeTool, guard, "write", cwd, wrapOpts),
      wrapPathTool(editTool, guard, "write", cwd, wrapOpts),
      wrapBashTool(sandboxedBashTool, guard, cwd, bashWrapOpts),
      wrapPathTool(createGrepTool(cwd), guard, "read", cwd, wrapOpts),
      wrapPathTool(createFindTool(cwd), guard, "read", cwd, wrapOpts),
      wrapPathTool(createLsTool(cwd), guard, "read", cwd, wrapOpts),
    ],
    customTools,
  };
}

function resolveToolPath(rawPath, cwd) {
  if (!rawPath) return null;
  if (process.platform === "win32") {
    return normalizeWin32ShellPath(rawPath, cwd, { allowRelative: true });
  }
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
}

/** 安全读文件，失败返回 null；大文件跳过防止内存爆炸 */
const DIFF_MAX_FILE_SIZE = 512 * 1024; // 512 KB
const WRITE_PREVIEW_MAX_CHARS = 12 * 1024;
function safeReadForDiff(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > DIFF_MAX_FILE_SIZE) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function wrapFileTouchTool(tool, cwd, {
  origin,
  operationForPath,
  getSessionPath,
  recordFileOperation,
  getInlineDiffEnabled,
  emitEvent,
} = {}) {
  return {
    ...tool,
    execute: async (toolCallId, params, ...rest) => {
      const absolutePath = resolveToolPath(params?.path, cwd);
      const operation = absolutePath ? operationForPath?.(absolutePath) : null;
      const inlineDiffEnabled = getInlineDiffEnabled?.() !== false;
      const emitProgress = createFileToolProgressEmitter({
        emitEvent,
        getSessionPath,
        toolName: tool.name,
        toolCallId,
        filePath: absolutePath,
        rawPath: params?.path,
        operation,
      });

      try {
        emitProgress("preparing");

        // ★ 编辑前保存旧内容（用于前端 inline diff）
        if (inlineDiffEnabled && absolutePath) emitProgress("snapshotting");
        const oldContent = inlineDiffEnabled && absolutePath ? safeReadForDiff(absolutePath) : null;

        emitProgress(tool.name === "write" ? "writing" : "applying");
        const result = tool.name === "write" && absolutePath && typeof params?.content === "string"
          ? await executeChunkedWriteTool(params, absolutePath, emitProgress)
          : await tool.execute(toolCallId, params, ...rest);
        emitProgress("written");

        // ★ 编辑后读新内容
        if (inlineDiffEnabled && absolutePath) emitProgress("diffing");
        const newContent = inlineDiffEnabled && absolutePath ? safeReadForDiff(absolutePath) : null;

        // 把 diff 数据挂进 details（前端 ToolGroupBlock 消费）
        emitProgress("finalizing");
        let enriched = result;
        if (absolutePath) {
          const details = {
            ...(result?.details || {}),
            filePath: absolutePath,
            fileName: path.basename(absolutePath),
          };
          delete details.oldContent;
          delete details.newContent;
          if (oldContent !== null || newContent !== null) {
            details.oldContent = oldContent ?? "";
            details.newContent = newContent ?? "";
          }
          enriched = {
            ...(result || {}),
            details,
          };
        }

        const sessionPath = getSessionPath?.() || null;
        if (!absolutePath || !sessionPath || typeof recordFileOperation !== "function") {
          emitProgress("done");
          return enriched;
        }
        if (!fs.existsSync(absolutePath)) {
          emitProgress("done");
          return enriched;
        }
        try {
          const sessionFile = serializeSessionFile(recordFileOperation({
            sessionPath,
            filePath: absolutePath,
            label: path.basename(absolutePath),
            origin,
            operation,
          }));
          emitProgress("done");
          return appendSessionFileDetails(enriched, sessionFile);
        } catch (err) {
          emitProgress("done", { warning: err?.message || String(err) });
          return appendRegistrationWarning(enriched, err);
        }
      } catch (err) {
        emitProgress("failed", { error: err?.message || String(err) });
        throw err;
      }
    },
  };
}

function createFileToolProgressEmitter({
  emitEvent,
  getSessionPath,
  toolName,
  toolCallId,
  filePath,
  rawPath,
  operation,
}) {
  return (stage, extra = {}) => {
    const sessionPath = getSessionPath?.() || null;
    if (!sessionPath || typeof emitEvent !== "function") return;
    try {
      emitEvent({
        type: "tool_execution_update",
        toolName,
        toolCallId,
        stage,
        filePath,
        fileName: filePath ? path.basename(filePath) : undefined,
        rawPath,
        operation,
        ...extra,
      }, sessionPath);
    } catch {}
  };
}

async function executeChunkedWriteTool(params, absolutePath, emitProgress) {
  const content = params.content;
  const totalBytes = Buffer.byteLength(content, "utf8");
  const dir = path.dirname(absolutePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tmpPath = path.join(
    dir,
    `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  let bytesWritten = 0;
  let previewCharsSent = 0;
  const stream = createWriteStream(tmpPath, { encoding: "utf8" });

  try {
    emitProgress("writing", { bytesWritten, totalBytes, progress: totalBytes > 0 ? 0 : 1, previewReset: true });
    const chunkChars = 64 * 1024;
    for (let offset = 0; offset < content.length;) {
      let end = Math.min(offset + chunkChars, content.length);
      if (
        end < content.length &&
        end > offset &&
        isHighSurrogate(content.charCodeAt(end - 1)) &&
        isLowSurrogate(content.charCodeAt(end))
      ) {
        end -= 1;
      }
      if (end <= offset) end = Math.min(offset + chunkChars, content.length);
      const chunk = content.slice(offset, end);
      await writeStreamChunk(stream, chunk);
      offset = end;
      bytesWritten += Buffer.byteLength(chunk, "utf8");
      let previewChunk;
      if (previewCharsSent < WRITE_PREVIEW_MAX_CHARS) {
        previewChunk = chunk.slice(0, WRITE_PREVIEW_MAX_CHARS - previewCharsSent);
        previewCharsSent += previewChunk.length;
      }
      emitProgress("writing", {
        bytesWritten,
        totalBytes,
        progress: totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : 1,
        previewChunk,
        previewTruncated: previewCharsSent < content.length,
      });
    }
    await closeWriteStream(stream);
    await fs.promises.rename(tmpPath, absolutePath);
    return {
      content: [{ type: "text", text: `Successfully wrote ${totalBytes} bytes to ${params.path}` }],
    };
  } catch (err) {
    stream.destroy();
    try { await fs.promises.rm(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

function writeStreamChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      stream.off("error", onError);
    };
    const finish = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };
    const onError = (err) => {
      finish(err);
    };
    stream.once("error", onError);
    stream.write(chunk, "utf8", () => {
      finish();
    });
  });
}

function closeWriteStream(stream) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      stream.off("error", onError);
      stream.off("finish", onFinish);
    };
    const finish = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };
    const onError = (err) => {
      finish(err);
    };
    const onFinish = () => {
      finish();
    };
    stream.once("error", onError);
    stream.once("finish", onFinish);
    stream.end();
  });
}

function isHighSurrogate(code) {
  return code >= 0xD800 && code <= 0xDBFF;
}

function isLowSurrogate(code) {
  return code >= 0xDC00 && code <= 0xDFFF;
}

function appendSessionFileDetails(result, sessionFile) {
  if (!sessionFile) return result;
  return {
    ...(result || {}),
    details: {
      ...(result?.details || {}),
      sessionFile,
    }
  };
}

function appendRegistrationWarning(result, err) {
  const message = `Session file registration failed: ${err?.message || String(err)}`;
  const content = Array.isArray(result?.content) ? [...result.content] : [];
  return {
    ...(result || {}),
    content: [...content, { type: "text", text: message }],
  };
}
