import { describe, expect, it } from 'vitest';

import { shouldShowContextRingTokenLabel } from '../../components/input/context-ring-visibility';

describe('context ring visibility', () => {
  it('shows the numeric label only from 100k tokens', () => {
    expect(shouldShowContextRingTokenLabel(99_999)).toBe(false);
    expect(shouldShowContextRingTokenLabel(100_000)).toBe(true);
  });

  it('hides the numeric label when usage is unknown or invalid', () => {
    expect(shouldShowContextRingTokenLabel(null)).toBe(false);
    expect(shouldShowContextRingTokenLabel(Number.NaN)).toBe(false);
  });
});
