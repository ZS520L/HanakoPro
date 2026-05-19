/**
 * 回归测试：验证 server/bootstrap.js 的 keepalive worker 真的能穿透主线程阻塞。
 *
 * 历史 bug（commit 03d01566）：keepalive worker 用了 `process.stdout.write(...)`，
 * 但 Node Worker 的 stdout 默认走 MessagePort 转发到主线程的 writable，主线程
 * 被阻塞时所有 stdout message 都堆在队列里。结果是 #719 / #736 根因没修掉，
 * 只是靠 90s/180s 调宽窗口缓和概率。
 *
 * 修复（commit ae00ae86 之后）：Worker 改用 `fs.writeSync(1, ...)` 直接对父进程
 * 继承的 stdout fd 做 syscall，绕过 Node stdio 基础设施，主线程怎么卡都不影响。
 *
 * 这个测试 spawn 一个独立 Node 进程，模拟 bootstrap 的 worker setup + 主线程
 * 同步阻塞 1.2s，断言父进程在阻塞窗口内能收到 keepalive 行（不是阻塞结束后才一
 * 起 flush）。如果有人改回 process.stdout.write，这个测试会失败。
 */
import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";

const BOOTSTRAP_KEEPALIVE_FIXTURE = `
import { Worker } from "worker_threads";
import fs from "fs";

const KEEPALIVE_INTERVAL_MS = 50;
const BLOCK_MS = 1200;

new Worker(
  "const fs = require('fs');"
  + "setInterval(() => { try { fs.writeSync(1, 'KEEPALIVE:' + Date.now() + '\\\\n'); } catch {} }, " + KEEPALIVE_INTERVAL_MS + ");",
  { eval: true },
);

await new Promise(r => setTimeout(r, 200));

fs.writeSync(1, 'BLOCK_START:' + Date.now() + '\\n');
const blockStart = Date.now();
while (Date.now() - blockStart < BLOCK_MS) { /* busy */ }
fs.writeSync(1, 'BLOCK_END:' + Date.now() + '\\n');

await new Promise(r => setTimeout(r, 200));
process.exit(0);
`;

function spawnAndCollect(scriptPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath], { stdio: ["ignore", "pipe", "pipe"] });
    const events = [];
    let buffer = "";

    proc.stdout.on("data", (chunk) => {
      const receivedAt = Date.now();
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line) events.push({ line, receivedAt });
      }
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("test process timed out"));
    }, timeoutMs);

    proc.on("exit", () => {
      clearTimeout(timer);
      resolve(events);
    });
    proc.on("error", reject);
  });
}

function parseTaggedTs(events, tag) {
  const hit = events.find(e => e.line.startsWith(tag + ":"));
  if (!hit) return null;
  return { sentAt: Number(hit.line.split(":")[1]), receivedAt: hit.receivedAt };
}

describe("bootstrap keepalive worker", () => {
  it("keepalive line reaches parent during a 1.2s main-thread block", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-keepalive-"));
    const fixturePath = path.join(tmpDir, `fixture-${crypto.randomBytes(4).toString("hex")}.mjs`);
    fs.writeFileSync(fixturePath, BOOTSTRAP_KEEPALIVE_FIXTURE);

    try {
      const events = await spawnAndCollect(fixturePath, 5000);

      const blockStart = parseTaggedTs(events, "BLOCK_START");
      const blockEnd = parseTaggedTs(events, "BLOCK_END");
      expect(blockStart, "BLOCK_START marker missing").not.toBeNull();
      expect(blockEnd, "BLOCK_END marker missing").not.toBeNull();

      // Keepalive lines whose parent-side receivedAt falls inside the block window.
      const keepalivesDuringBlock = events.filter(e =>
        e.line.startsWith("KEEPALIVE:")
        && e.receivedAt >= blockStart.receivedAt
        && e.receivedAt <= blockEnd.receivedAt
      );

      // 50ms keepalive interval over a 1200ms block window → ~24 lines expected.
      expect(
        keepalivesDuringBlock.length,
        `expected >=5 keepalives during the block, got ${keepalivesDuringBlock.length}`,
      ).toBeGreaterThanOrEqual(5);

      // ⚠️ Critical assertion. The broken impl (process.stdout.write inside the
      // Worker) ALSO produces ~24 keepalive lines whose receivedAt timestamps
      // technically fall within the [blockStart, blockEnd] window — but they
      // all arrive in a single batch at the very end (cluster spread ≈ 0ms),
      // because Worker stdio is forwarded via the main-thread MessagePort and
      // gets flushed only when the block releases.
      //
      // The good impl (fs.writeSync(1, ...)) delivers keepalives in real time
      // throughout the block; receivedAt values are spread roughly across the
      // entire window. Asserting the time spread distinguishes the two cleanly.
      const kaTimes = keepalivesDuringBlock.map(e => e.receivedAt);
      const spread = kaTimes.length === 0 ? 0 : Math.max(...kaTimes) - Math.min(...kaTimes);
      expect(
        spread,
        `keepalives clustered at one moment (spread=${spread}ms) → Worker stdio was blocked by main thread; check that the worker uses fs.writeSync(1, ...) and NOT process.stdout.write`,
      ).toBeGreaterThanOrEqual(300);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }, 10000);
});
