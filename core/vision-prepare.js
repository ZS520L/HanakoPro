import { getLocale } from "../server/i18n.js";
import { requireVisionAuxiliaryEnabled } from "./vision-auxiliary-policy.js";

export function isAbortLikeError(err) {
  return err?.name === "AbortError"
    || err?.message === "This operation was aborted"
    || err?.type === "aborted";
}

function abortError() {
  const err = new Error("This operation was aborted");
  err.name = "AbortError";
  err.type = "aborted";
  return err;
}

function isRecoverableVisionPrepareError(err) {
  if (isAbortLikeError(err)) return false;
  if (err?.code === "LLM_AUTH_FAILED") return false;
  if (err?.code === "LLM_TIMEOUT" || err?.code === "LLM_RATE_LIMITED" || err?.code === "LLM_EMPTY_RESPONSE") {
    return true;
  }
  if (err?.retryable === true) return true;
  if (err?.name === "TimeoutError") return true;
  if (err instanceof TypeError && /fetch|network|terminated/i.test(err.message || "")) return true;
  return false;
}

function visionFailureNotice(err) {
  const isZh = getLocale().startsWith("zh");
  const reason = err?.message ? ` (${err.message})` : "";
  return isZh
    ? `[图片分析失败：辅助视觉模型暂时不可用，本轮不会把图片内容传给文本模型。请明确说明你没有看到图片，并请用户稍后重试或检查视觉模型配置${reason}。]`
    : `[Image analysis failed: the auxiliary vision model is temporarily unavailable, so this turn does not include image content for the text-only model. Clearly state that you could not inspect the image, and ask the user to retry later or check the vision model configuration${reason}.]`;
}

function appendVisionFailureNotice(text, err) {
  const notice = visionFailureNotice(err);
  return text ? `${notice}\n\n${text}` : notice;
}

export async function prepareVisionInputForTextOnlyModel({
  targetModel,
  text,
  opts,
  sessionPath,
  getVisionBridge,
  visionPolicyTarget,
  warn,
  signal,
}) {
  const inputMods = targetModel?.input;
  if (!opts?.images?.length || !Array.isArray(inputMods) || inputMods.includes("image")) {
    return { text, opts };
  }

  requireVisionAuxiliaryEnabled(visionPolicyTarget);
  const bridge = getVisionBridge?.();
  if (!bridge) {
    throw new Error("vision auxiliary model is required for image input with the current text-only model");
  }

  try {
    const prepared = await bridge.prepare({
      sessionPath,
      targetModel,
      text,
      images: opts.images,
      imageAttachmentPaths: opts.imageAttachmentPaths,
      signal,
    });
    if (signal?.aborted) throw abortError();
    return { text: prepared.text, opts: { ...opts, images: prepared.images } };
  } catch (err) {
    if (isAbortLikeError(err) || !isRecoverableVisionPrepareError(err)) throw err;
    warn?.(`vision prepare failed, proceeding without images: ${err?.message || err}`);
    return {
      text: appendVisionFailureNotice(text, err),
      opts: { ...opts, images: [] },
    };
  }
}
