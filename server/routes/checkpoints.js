import { Hono } from "hono";
import path from "path";

const USER_EDIT_CHECKPOINT_REASONS = new Set(["edit-start", "autosave-interval"]);

export function createCheckpointsRoute(engine) {
  const route = new Hono();

  route.get("/checkpoints", async (c) => {
    try {
      const list = await engine.listCheckpoints();
      return c.json({ checkpoints: list });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/checkpoints/user-edit", async (c) => {
    try {
      const body = await c.req.json();
      const filePath = typeof body.filePath === "string" ? body.filePath : "";
      if (!filePath) return c.json({ error: "filePath required" }, 400);
      if (!path.isAbsolute(filePath)) return c.json({ error: "absolute filePath required" }, 400);
      const reason = typeof body.reason === "string" ? body.reason : "";
      if (!USER_EDIT_CHECKPOINT_REASONS.has(reason)) return c.json({ error: "invalid reason" }, 400);
      const checkpoint = await engine.createUserEditCheckpoint({ filePath, reason });
      return c.json({ ok: true, checkpoint });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/checkpoints/:id/restore", async (c) => {
    try {
      const { id } = c.req.param();
      const result = await engine.restoreCheckpoint(id);
      return c.json({ ok: true, restoredTo: result.restoredTo });
    } catch (err) {
      if (err.code === "ENOENT") {
        return c.json({ error: "checkpoint not found" }, 404);
      }
      return c.json({ error: err.message }, 500);
    }
  });

  route.delete("/checkpoints/:id", async (c) => {
    try {
      const { id } = c.req.param();
      await engine.removeCheckpoint(id);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  return route;
}
