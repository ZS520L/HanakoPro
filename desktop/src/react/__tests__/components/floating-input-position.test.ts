import { describe, expect, it } from 'vitest';
import { computeFloatingInputPosition } from '../../components/floating-input/position';

describe('computeFloatingInputPosition', () => {
  it('centers the floating input below the selection while keeping it inside the viewport', () => {
    const result = computeFloatingInputPosition(
      { left: 300, right: 500, top: 120, bottom: 180, width: 200, height: 60 },
      { width: 1200, height: 800 },
      { width: 400, height: 56 },
    );

    expect(result).toEqual({
      left: 200,
      top: 188,
      origin: 'top-center',
    });
  });

  it('clamps the input to the bottom edge and flips the transform origin when there is no room below', () => {
    const result = computeFloatingInputPosition(
      { left: 720, right: 900, top: 730, bottom: 770, width: 180, height: 40 },
      { width: 1200, height: 800 },
      { width: 400, height: 120 },
    );

    expect(result).toEqual({
      left: 610,
      top: 664,
      origin: 'bottom-center',
    });
  });

  it('clamps the input horizontally when the selected text is close to the app edge', () => {
    const result = computeFloatingInputPosition(
      { left: 10, right: 40, top: 160, bottom: 190, width: 30, height: 30 },
      { width: 900, height: 600 },
      { width: 300, height: 48 },
    );

    expect(result.left).toBe(16);
    expect(result.top).toBe(198);
  });
});
