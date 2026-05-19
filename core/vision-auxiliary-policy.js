export const VISION_AUXILIARY_DISABLED_ERROR =
  "vision auxiliary is disabled for image input with the current text-only model";

export function isVisionAuxiliaryEnabled(engine) {
  return engine?.isVisionAuxiliaryEnabled?.() === true;
}

export function requireVisionAuxiliaryEnabled(engine) {
  if (!isVisionAuxiliaryEnabled(engine)) {
    throw new Error(VISION_AUXILIARY_DISABLED_ERROR);
  }
}
