/**
 * 消息发送前净化器 — capability-aware message adaptation layer
 *
 * 职责：按 Pi SDK Model.input 声明的输入模态，把历史 messages 里不兼容的
 * content block 替换为 TextContent 占位。目前处理 ImageContent / VideoContent；
 * 未来可扩展 AudioContent。
 *
 * 定位：注册为 Pi SDK "context" extension event handler（engine.js 内）。
 * "context" 事件在每次 LLM 调用前触发，允许修改 messages。
 *
 * 非静默降级：调用方（engine）根据返回的 stripped 计数决定是否通过事件总线
 * 通知 UI，避免用户悄无声息地丢失信息。
 */
import { modelSupportsDirectVideoInput, modelSupportsVideoInput } from "../shared/model-capabilities.js";

const IMAGE_PLACEHOLDER_TEXT = "[图片已省略：当前模型不支持图像输入]";
const VIDEO_PLACEHOLDER_TEXT = "[视频已省略：当前模型不支持视频输入]";

/**
 * 模型是否支持 image 输入（Pi SDK 标准字段 input 数组）。
 * @param {{ input?: readonly string[] } | null | undefined} model
 */
export function modelSupportsImage(model) {
  const input = model?.input;
  return Array.isArray(input) && input.includes("image");
}

/**
 * 模型是否支持 video 输入（Hana 扩展能力，兼容读取旧 input 数组）。
 * @param {{ input?: readonly string[] } | null | undefined} model
 */
export function modelSupportsVideo(model) {
  return modelSupportsVideoInput(model);
}

/**
 * 对 messages 做 provider 能力适配。
 *
 * @param {ReadonlyArray<any>} messages
 * @param {{ input?: readonly string[] } | null | undefined} model
 * @returns {{ messages: any[], stripped: number, strippedImages: number, strippedVideos: number }}
 */
export function sanitizeMessagesForModel(messages, model) {
  if (!Array.isArray(messages)) return emptySanitizeResult(messages);
  const supportsImage = modelSupportsImage(model);
  const supportsVideo = modelSupportsDirectVideoInput(model);
  if (supportsImage && supportsVideo) return emptySanitizeResult(messages);

  // 快速探测：没有任何需要剥离的媒体 block 就返回原数组，避免无谓分配
  if (!hasUnsupportedMediaContent(messages, { supportsImage, supportsVideo })) {
    return emptySanitizeResult(messages);
  }

  let strippedImages = 0;
  let strippedVideos = 0;
  const out = messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    // 只扫可能携带 ImageContent 的消息种类：
    //  - user（UserMessage.content 可以是 (text|image)[])
    //  - toolResult（ToolResultMessage.content 可以是 (text|image)[])
    if (msg.role !== "user" && msg.role !== "toolResult") return msg;
    if (typeof msg.content === "string") return msg;
    if (!Array.isArray(msg.content)) return msg;

    let localStripped = 0;
    const newContent = [];
    for (const block of msg.content) {
      if (block && typeof block === "object" && block.type === "image" && !supportsImage) {
        localStripped++;
        strippedImages++;
        newContent.push({ type: "text", text: IMAGE_PLACEHOLDER_TEXT });
      } else if (block && typeof block === "object" && block.type === "video" && !supportsVideo) {
        localStripped++;
        strippedVideos++;
        newContent.push({ type: "text", text: VIDEO_PLACEHOLDER_TEXT });
      } else {
        newContent.push(block);
      }
    }
    if (localStripped === 0) return msg;
    return { ...msg, content: newContent };
  });

  const stripped = strippedImages + strippedVideos;
  return { messages: out, stripped, strippedImages, strippedVideos };
}

function emptySanitizeResult(messages) {
  return { messages, stripped: 0, strippedImages: 0, strippedVideos: 0 };
}

/** 快速判断 messages 里是否存在至少一个当前模型不支持的媒体 block。 */
function hasUnsupportedMediaContent(messages, { supportsImage, supportsVideo }) {
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.role !== "user" && msg.role !== "toolResult") continue;
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "image" && !supportsImage) return true;
      if (block.type === "video" && !supportsVideo) return true;
    }
  }
  return false;
}
