import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

describe("checkpoints route", () => {
  it("creates explicit user-edit checkpoints through the engine boundary", async () => {
    const engine = {
      createUserEditCheckpoint: vi.fn(async ({ filePath, reason }) => ({
        id: "ckpt-1",
        path: filePath,
        reason,
      })),
    };
    const { createCheckpointsRoute } = await import("../server/routes/checkpoints.js");
    const app = new Hono();
    app.route("/api", createCheckpointsRoute(engine));

    const res = await app.request("/api/checkpoints/user-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "/tmp/note.md", reason: "edit-start" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      checkpoint: { id: "ckpt-1", path: "/tmp/note.md", reason: "edit-start" },
    });
    expect(engine.createUserEditCheckpoint).toHaveBeenCalledWith({
      filePath: "/tmp/note.md",
      reason: "edit-start",
    });
  });

  it("rejects relative user-edit checkpoint paths", async () => {
    const engine = { createUserEditCheckpoint: vi.fn() };
    const { createCheckpointsRoute } = await import("../server/routes/checkpoints.js");
    const app = new Hono();
    app.route("/api", createCheckpointsRoute(engine));

    const res = await app.request("/api/checkpoints/user-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "note.md", reason: "edit-start" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "absolute filePath required" });
    expect(engine.createUserEditCheckpoint).not.toHaveBeenCalled();
  });

  it("rejects unknown user-edit checkpoint reasons", async () => {
    const engine = { createUserEditCheckpoint: vi.fn() };
    const { createCheckpointsRoute } = await import("../server/routes/checkpoints.js");
    const app = new Hono();
    app.route("/api", createCheckpointsRoute(engine));

    const res = await app.request("/api/checkpoints/user-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "/tmp/note.md", reason: "fallback" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid reason" });
    expect(engine.createUserEditCheckpoint).not.toHaveBeenCalled();
  });
});
