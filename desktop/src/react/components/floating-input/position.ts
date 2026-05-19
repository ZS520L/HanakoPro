export interface FloatingRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface FloatingSize {
  width: number;
  height: number;
}

export type FloatingInputOrigin = 'top-center' | 'bottom-center';

export interface FloatingInputPosition {
  left: number;
  top: number;
  origin: FloatingInputOrigin;
}

const DEFAULT_GAP = 8;
const DEFAULT_MARGIN = 16;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function computeFloatingInputPosition(
  anchor: FloatingRect,
  viewport: ViewportSize,
  floating: FloatingSize,
  gap = DEFAULT_GAP,
  margin = DEFAULT_MARGIN,
): FloatingInputPosition {
  const centeredLeft = anchor.left + anchor.width / 2 - floating.width / 2;
  const left = clamp(centeredLeft, margin, viewport.width - margin - floating.width);
  const preferredTop = anchor.bottom + gap;
  const top = clamp(preferredTop, margin, viewport.height - margin - floating.height);

  return {
    left,
    top,
    origin: top >= anchor.bottom ? 'top-center' : 'bottom-center',
  };
}
