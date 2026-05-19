import { describe, expect, it } from 'vitest';
import { displayInitial, firstGrapheme, splitGraphemes } from '../../utils/grapheme';

describe('grapheme utilities', () => {
  it('uses full emoji graphemes for initials without creating lone surrogates', () => {
    expect(displayInitial('😊')).toBe('😊');
    expect(encodeURIComponent(displayInitial('😊'))).toBe('%F0%9F%98%8A');
  });

  it('keeps zero-width-joiner emoji sequences intact', () => {
    expect(firstGrapheme('👩‍💻 Hana')).toBe('👩‍💻');
  });

  it('splits text by user-visible characters', () => {
    expect(splitGraphemes('A👨‍👩‍👧‍👦B')).toEqual(['A', '👨‍👩‍👧‍👦', 'B']);
  });

  it('falls back to the provided default for blank names', () => {
    expect(displayInitial('   ', '?')).toBe('?');
  });
});
