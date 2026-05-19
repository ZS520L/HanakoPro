import path from "path";
import { describe, expect, it, vi } from "vitest";
import { wrapReadImageWithVisionBridge } from "../lib/sandbox/read-image-vision.js";
import { VISION_CONTEXT_END, VISION_CONTEXT_START } from "../core/vision-bridge.js";

function makeReadTool(result) {
  return {
    name: "read",
    execute: vi.fn(async () => result),
  };
}

function makeCtx(sessionPath, model) {
  return {
    model,
    sessionManager: {
      getSessionFile: () => sessionPath,
    },
  };
}

const imageResult = {
  content: [
    {
      type: "text",
      text: "Read image file [image/png]\n[Current model does not support images. The image will be omitted from this request.]",
    },
    { type: "image", data: Buffer.from("image-bytes").toString("base64"), mimeType: "image/png" },
  ],
};

describe("wrapReadImageWithVisionBridge", () => {
  it("leaves image-capable models on the normal read image path", async () => {
    const base = makeReadTool(imageResult);
    const prepareResources = vi.fn();
    const recordFileOperation = vi.fn();
    const wrapped = wrapReadImageWithVisionBridge(base, "/workspace", {
      getVisionBridge: () => ({ prepareResources }),
      isVisionAuxiliaryEnabled: () => true,
      getSessionPath: () => "/sessions/read.jsonl",
      recordFileOperation,
    });

    const result = await wrapped.execute(
      "call-1",
      { path: "shot.png" },
      null,
      null,
      makeCtx("/sessions/read.jsonl", { id: "gpt-4o", provider: "openai", input: ["text", "image"] }),
    );

    expect(result).toBe(imageResult);
    expect(prepareResources).not.toHaveBeenCalled();
    expect(recordFileOperation).not.toHaveBeenCalled();
  });

  it("returns persisted auxiliary vision text for text-only models when auxiliary vision is enabled", async () => {
    const sessionPath = "/sessions/read.jsonl";
    const filePath = path.join("/workspace", "shot.png");
    const base = makeReadTool(imageResult);
    const prepareResources = vi.fn(async () => ({
      notes: [{
        key: "visual-resource:read:test",
        label: "shot.png",
        note: "image_overview: A settings screenshot.\nvisible_text: Save",
      }],
    }));
    const recordFileOperation = vi.fn(() => ({
      id: "sf_read_shot",
      fileId: "sf_read_shot",
      sessionPath,
      filePath,
      label: "shot.png",
      mime: "image/png",
      kind: "image",
      status: "available",
    }));
    const wrapped = wrapReadImageWithVisionBridge(base, "/workspace", {
      getVisionBridge: () => ({ prepareResources }),
      isVisionAuxiliaryEnabled: () => true,
      getSessionPath: () => sessionPath,
      recordFileOperation,
    });

    const result = await wrapped.execute(
      "call-1",
      { path: "shot.png" },
      null,
      null,
      makeCtx(sessionPath, { id: "deepseek-chat", provider: "deepseek", input: ["text"] }),
    );

    expect(recordFileOperation).toHaveBeenCalledWith(expect.objectContaining({
      sessionPath,
      filePath,
      label: "shot.png",
      origin: "agent_read_image",
      operation: "read",
    }));
    expect(prepareResources).toHaveBeenCalledWith(expect.objectContaining({
      sessionPath,
      targetModel: expect.objectContaining({ id: "deepseek-chat" }),
      resources: [expect.objectContaining({
        label: "shot.png",
        image: expect.objectContaining({ type: "image", mimeType: "image/png" }),
      })],
    }));
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain(VISION_CONTEXT_START);
    expect(result.content[0].text).toContain("image_overview: A settings screenshot.");
    expect(result.content[0].text).toContain(VISION_CONTEXT_END);
    expect(result.content[0].text).not.toContain("Current model does not support images");
    expect(result.details.visionAdapted).toBe(true);
    expect(result.details.sessionFile).toMatchObject({ fileId: "sf_read_shot", kind: "image" });
    expect(result.details.media.items).toEqual([
      expect.objectContaining({ type: "session_file", fileId: "sf_read_shot", kind: "image" }),
    ]);
  });

  it("keeps the existing unsupported-image result when auxiliary vision is disabled", async () => {
    const base = makeReadTool(imageResult);
    const prepareResources = vi.fn();
    const recordFileOperation = vi.fn();
    const wrapped = wrapReadImageWithVisionBridge(base, "/workspace", {
      getVisionBridge: () => ({ prepareResources }),
      isVisionAuxiliaryEnabled: () => false,
      getSessionPath: () => "/sessions/read.jsonl",
      recordFileOperation,
    });

    const result = await wrapped.execute(
      "call-1",
      { path: "shot.png" },
      null,
      null,
      makeCtx("/sessions/read.jsonl", { id: "deepseek-chat", provider: "deepseek", input: ["text"] }),
    );

    expect(result).toBe(imageResult);
    expect(prepareResources).not.toHaveBeenCalled();
    expect(recordFileOperation).not.toHaveBeenCalled();
  });
});
