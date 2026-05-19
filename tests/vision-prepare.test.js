import { describe, expect, it, vi } from "vitest";
import { AppError } from "../shared/errors.js";
import { prepareVisionInputForTextOnlyModel } from "../core/vision-prepare.js";

const textOnlyModel = { id: "deepseek-chat", provider: "deepseek", input: ["text"] };

describe("prepareVisionInputForTextOnlyModel", () => {
  it("degrades recoverable auxiliary vision failures into an explicit text notice", async () => {
    const warn = vi.fn();
    const result = await prepareVisionInputForTextOnlyModel({
      targetModel: textOnlyModel,
      text: "[attached_image: /tmp/a.png]\nwhat is this?",
      opts: { images: [{ type: "image", data: "b64", mimeType: "image/png" }], imageAttachmentPaths: ["/tmp/a.png"] },
      sessionPath: "/tmp/session.jsonl",
      getVisionBridge: () => ({
        prepare: vi.fn(async () => {
          throw new AppError("LLM_TIMEOUT");
        }),
      }),
      visionPolicyTarget: { isVisionAuxiliaryEnabled: () => true },
      warn,
    });

    expect(result.opts.images).toEqual([]);
    expect(result.text).toMatch(/图片分析失败|Image analysis failed/);
    expect(result.text).toContain("[attached_image: /tmp/a.png]");
    expect(warn).toHaveBeenCalled();
  });

  it("fails closed for auxiliary vision configuration errors", async () => {
    await expect(prepareVisionInputForTextOnlyModel({
      targetModel: textOnlyModel,
      text: "what is this?",
      opts: { images: [{ type: "image", data: "b64", mimeType: "image/png" }] },
      sessionPath: "/tmp/session.jsonl",
      getVisionBridge: () => null,
      visionPolicyTarget: { isVisionAuxiliaryEnabled: () => true },
    })).rejects.toThrow(/vision auxiliary model/i);
  });

  it("propagates user aborts instead of degrading them", async () => {
    const controller = new AbortController();
    const pending = prepareVisionInputForTextOnlyModel({
      targetModel: textOnlyModel,
      text: "what is this?",
      opts: { images: [{ type: "image", data: "b64", mimeType: "image/png" }] },
      sessionPath: "/tmp/session.jsonl",
      getVisionBridge: () => ({
        prepare: vi.fn(async () => {
          controller.abort();
          return { text: "ignored", images: [] };
        }),
      }),
      visionPolicyTarget: { isVisionAuxiliaryEnabled: () => true },
      signal: controller.signal,
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
