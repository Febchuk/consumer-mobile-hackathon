export function isSingleEmoji(s: string) {
  const t = s.trim();
  if (!t) return false;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<unknown> } }).Segmenter;
  if (Seg && [...new Seg(undefined, { granularity: "grapheme" }).segment(t)].length !== 1) return false;
  if (!Seg && [...t].length > 8) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(t);
}

export function lastGrapheme(s: string) {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (!Seg) return s;
  const parts = [...new Seg(undefined, { granularity: "grapheme" }).segment(s)].map((p) => p.segment);
  return parts[parts.length - 1] ?? "";
}
