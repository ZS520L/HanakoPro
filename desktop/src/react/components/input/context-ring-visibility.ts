export const CONTEXT_RING_TOKEN_LABEL_THRESHOLD = 100_000;

export function shouldShowContextRingTokenLabel(tokens: number | null | undefined): boolean {
  return typeof tokens === 'number'
    && Number.isFinite(tokens)
    && tokens >= CONTEXT_RING_TOKEN_LABEL_THRESHOLD;
}
