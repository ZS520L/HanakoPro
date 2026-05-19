let graphemeSegmenter: Intl.Segmenter | null | undefined;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter !== undefined) return graphemeSegmenter;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  } else {
    graphemeSegmenter = null;
  }
  return graphemeSegmenter;
}

export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), (entry) => entry.segment);
}

export function firstGrapheme(text: string): string {
  return splitGraphemes(text)[0] || '';
}

export function displayInitial(value: string | null | undefined, fallback = '?'): string {
  const first = firstGrapheme((value || '').trim()) || fallback;
  return first.toUpperCase();
}
