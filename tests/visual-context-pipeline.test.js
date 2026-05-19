import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisionBridge, VISION_CONTEXT_END, VISION_CONTEXT_START } from "../core/vision-bridge.js";
import { adaptVisualContextMessages } from "../core/visual-context-pipeline.js";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-visual-context-"));
  tempDirs.push(dir);
  return dir;
}

function makeBridge() {
  const callText = vi.fn(async () => [
    "image_overview: A browser screenshot with a red error banner.",
    "visible_text: Error 500.",
    "objects_and_layout: The banner sits at the top of the page.",
    "charts_or_data: none.",
    "user_request_answer: The visible state is an error page.",
    "evidence: red banner and Error 500 text.",
    "uncertainty: exact route is unclear.",
  ].join("\n"));
  return {
    callText,
    bridge: new VisionBridge({
      resolveVisionConfig: () => ({
        model: { id: "qwen-vl", provider: "dashscope", input: ["text", "image"] },
        api: "openai-completions",
        api_key: "sk-test",
        base_url: "https://example.test/v1",
      }),
      callText,
    }),
  };
}

describe("VisualContextPipeline", () => {
  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("injects vision context for tool result image blocks before text-only model calls", async () => {
    const dir = makeTempDir();
    const sessionPath = path.join(dir, "session.jsonl");
    const { bridge, callText } = makeBridge();
    const messages = [
      { role: "user", content: "check the page" },
      {
        role: "toolResult",
        content: [
          { type: "text", text: "browser screenshot captured" },
          { type: "image", mimeType: "image/png", data: "SCREENSHOT_BASE64" },
        ],
      },
    ];

    const result = await adaptVisualContextMessages({
      messages,
      sessionPath,
      targetModel: { id: "deepseek-chat", provider: "deepseek", input: ["text"] },
      visionBridge: bridge,
      isVisionAuxiliaryEnabled: () => true,
    });

    expect(callText).toHaveBeenCalledTimes(1);
    expect(result.injected).toBe(1);
    expect(result.messages[1].content[0].text).toContain(VISION_CONTEXT_START);
    expect(result.messages[1].content[0].text).toContain("browser screenshot");
    expect(result.messages[1].content[0].text).toContain("image_overview");
    expect(result.messages[1].content[0].text).toContain(VISION_CONTEXT_END);
    expect(result.messages[1].content[2]).toEqual(
      expect.objectContaining({ type: "image", data: "SCREENSHOT_BASE64" }),
    );
  });

  it("resolves image session files from tool media details and injects their notes", async () => {
    const dir = makeTempDir();
    const sessionPath = path.join(dir, "session.jsonl");
    const imagePath = path.join(dir, "generated.png");
    fs.writeFileSync(imagePath, Buffer.from("GENERATED_IMAGE_BYTES"));
    const { bridge, callText } = makeBridge();
    const sessionFile = {
      id: "sf_generated",
      fileId: "sf_generated",
      sessionPath,
      filePath: imagePath,
      label: "generated.png",
      filename: "generated.png",
      mime: "image/png",
      kind: "image",
      status: "available",
    };

    const messages = [
      { role: "user", content: "review the generated image" },
      {
        role: "toolResult",
        content: [{ type: "text", text: "generated.png staged" }],
        details: {
          media: {
            items: [{ type: "session_file", fileId: "sf_generated", sessionPath }],
          },
        },
      },
    ];

    const result = await adaptVisualContextMessages({
      messages,
      sessionPath,
      targetModel: { id: "deepseek-chat", provider: "deepseek", input: ["text"] },
      visionBridge: bridge,
      isVisionAuxiliaryEnabled: () => true,
      resolveSessionFile: vi.fn(() => sessionFile),
    });

    expect(callText).toHaveBeenCalledTimes(1);
    expect(result.injected).toBe(1);
    expect(result.messages[1].content[0].text).toContain(VISION_CONTEXT_START);
    expect(result.messages[1].content[0].text).toContain("generated.png");
    expect(result.messages[1].content[0].text).toContain("image_overview");
  });

  it("deduplicates the same image when a tool result has both image content and session file media", async () => {
    const dir = makeTempDir();
    const sessionPath = path.join(dir, "session.jsonl");
    const imagePath = path.join(dir, "browser.png");
    const bytes = Buffer.from("SAME_BROWSER_IMAGE");
    fs.writeFileSync(imagePath, bytes);
    const base64 = bytes.toString("base64");
    const { bridge, callText } = makeBridge();
    const sessionFile = {
      id: "sf_browser",
      fileId: "sf_browser",
      sessionPath,
      filePath: imagePath,
      label: "browser.png",
      mime: "image/png",
      kind: "image",
      status: "available",
    };

    const messages = [
      { role: "user", content: "check the page" },
      {
        role: "toolResult",
        content: [
          { type: "text", text: "browser screenshot captured" },
          { type: "image", mimeType: "image/png", data: base64 },
        ],
        details: {
          media: {
            items: [{ type: "session_file", fileId: "sf_browser", sessionPath }],
          },
        },
      },
    ];

    const result = await adaptVisualContextMessages({
      messages,
      sessionPath,
      targetModel: { id: "deepseek-chat", provider: "deepseek", input: ["text"] },
      visionBridge: bridge,
      isVisionAuxiliaryEnabled: () => true,
      resolveSessionFile: vi.fn(() => sessionFile),
    });

    expect(callText).toHaveBeenCalledTimes(1);
    expect(result.injected).toBe(1);
  });

  it("leaves image-capable model context unchanged", async () => {
    const { bridge, callText } = makeBridge();
    const messages = [{
      role: "toolResult",
      content: [{ type: "image", mimeType: "image/png", data: "SCREENSHOT_BASE64" }],
    }];

    const result = await adaptVisualContextMessages({
      messages,
      sessionPath: "/tmp/session.jsonl",
      targetModel: { id: "gpt-4o", provider: "openai", input: ["text", "image"] },
      visionBridge: bridge,
      isVisionAuxiliaryEnabled: () => true,
    });

    expect(callText).not.toHaveBeenCalled();
    expect(result).toEqual({ messages, injected: 0 });
  });
});
