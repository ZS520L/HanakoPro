/**
 * commands.js — Slash 命令 REST API
 *
 * GET /api/commands?agentId=... — 返回 registry 前端镜像
 * 只暴露展示性字段（name / aliases / description / permission / scope / source），
 * 不含 handler 函数（前端不执行，handler 在 server dispatcher 里跑）。
 */

import { Hono } from "hono";

export function createCommandsRoute(engine) {
  const route = new Hono();

  /** GET /commands — 列出所有可见命令，供前端 slash 菜单显示 */
  route.get("/commands", (c) => {
    try {
      const registry = engine.slashRegistry;
      if (!registry) return c.json({ error: "slash system not ready" }, 503);
      const defs = registry.list().map((d) => ({
        name: d.name,
        aliases: d.aliases || [],
        description: d.description || "",
        permission: d.permission,
        scope: d.scope || "session",
        source: d.source || "core",
      }));
      return c.json({ commands: defs });
    } catch (err) {
      console.error(`[commands] list failed: ${err.message}`);
      return c.json({ error: err.message }, 500);
    }
  });

  return route;
}
