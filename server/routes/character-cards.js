import fsp from "fs/promises";
import path from "path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { emitAppEvent } from "../app-events.js";
import { safeJson } from "../hono-helpers.js";
import { createCharacterCardService, CharacterCardError } from "../../lib/character-cards/service.js";

const MAX_CARD_PACKAGE_SIZE = 80 * 1024 * 1024;

function safeUploadName(name) {
  const base = path.basename(String(name || "character-card.zip").replace(/\\/g, "/"));
  // eslint-disable-next-line no-control-regex -- 正是要清除文件名里的控制字符（防 path traversal/注入）
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim();
  return cleaned || "character-card.zip";
}

async function saveUploadedPackage(engine, file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new CharacterCardError("file is required");
  }
  const uploadRoot = path.join(engine.hanakoHome, ".ephemeral", "character-card-uploads");
  await fsp.mkdir(uploadRoot, { recursive: true });
  const fileName = `${Date.now().toString(36)}-${safeUploadName(file.name)}`;
  const target = path.join(uploadRoot, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(target, bytes);
  return target;
}

function routeError(c, err) {
  const status = err instanceof CharacterCardError ? err.status : 500;
  if (!(err instanceof CharacterCardError)) {
    console.error("[character-cards] route failed:", err);
  }
  return c.json({ error: err.message || String(err) }, status);
}

function pickUploadedFile(body) {
  for (const value of Object.values(body || {})) {
    if (value && typeof value.arrayBuffer === "function") return value;
  }
  return null;
}

export function createCharacterCardsRoute(engine) {
  const route = new Hono();
  const service = createCharacterCardService(engine);

  route.post("/character-cards/plan", bodyLimit({ maxSize: MAX_CARD_PACKAGE_SIZE }), async (c) => {
    try {
      const contentType = c.req.header("content-type") || "";
      let sourcePath;
      let originalName;
      if (contentType.includes("multipart/form-data")) {
        const body = await c.req.parseBody();
        const file = pickUploadedFile(body);
        sourcePath = await saveUploadedPackage(engine, file);
        originalName = file?.name || path.basename(sourcePath);
      } else {
        const body = await safeJson(c);
        sourcePath = body.path;
        originalName = body.name;
      }
      const plan = await service.createImportPlanFromPath(sourcePath, { originalName });
      return c.json({ ok: true, plan });
    } catch (err) {
      return routeError(c, err);
    }
  });

  route.get("/character-cards/plans/:token/assets/:asset", async (c) => {
    try {
      const { filePath, mime } = service.resolvePlanAsset(c.req.param("token"), c.req.param("asset"));
      c.header("Content-Type", mime);
      c.header("Cache-Control", "private, max-age=3600");
      return c.body(await fsp.readFile(filePath));
    } catch (err) {
      return routeError(c, err);
    }
  });

  route.get("/character-cards/export/:agentId/assets/:asset", async (c) => {
    try {
      const { filePath, mime } = service.resolveExportAsset(c.req.param("agentId"), c.req.param("asset"));
      c.header("Content-Type", mime);
      c.header("Cache-Control", "no-store");
      return c.body(await fsp.readFile(filePath));
    } catch (err) {
      return routeError(c, err);
    }
  });

  route.post("/character-cards/import", async (c) => {
    try {
      const body = await safeJson(c);
      const result = await service.commitImportPlan(body.token, {
        importMemory: body.importMemory === true,
      });
      emitAppEvent(engine, "agent-created", { agentId: result.agent.id, name: result.agent.name });
      if (result.installedSkills.length > 0) {
        emitAppEvent(engine, "skills-changed", { agentId: result.agent.id });
      }
      return c.json(result);
    } catch (err) {
      return routeError(c, err);
    }
  });

  route.post("/character-cards/export/preview", async (c) => {
    try {
      const body = await safeJson(c);
      const plan = await service.createExportPreview(body.agentId);
      return c.json({ ok: true, plan });
    } catch (err) {
      return routeError(c, err);
    }
  });

  route.post("/character-cards/export/plan", async (c) => {
    try {
      const body = await safeJson(c);
      const plan = await service.createExportPreview(body.agentId);
      return c.json({ ok: true, plan });
    } catch (err) {
      return routeError(c, err);
    }
  });

  route.post("/character-cards/export", async (c) => {
    try {
      const body = await safeJson(c);
      const result = await service.exportAgentPackage(body.agentId, {
        exportMemory: body.exportMemory === true,
      });
      return c.json(result);
    } catch (err) {
      return routeError(c, err);
    }
  });

  return route;
}
