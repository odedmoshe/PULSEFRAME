/**
 * Pure command search for the palette. Matches both languages and the command id, ignoring case,
 * Hebrew niqqud/cantillation (U+0591–U+05C7) and Latin diacritics.
 */
export interface SearchItem { id: string; he: string; en: string }

/** Lower-case, strip niqqud and Latin diacritics, collapse separators to single spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-֑ͯ-ׇ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const isSubsequence = (q: string, text: string): boolean => {
  let i = 0;
  for (let j = 0; j < text.length && i < q.length; j++) if (text[j] === q[i]) i++;
  return i === q.length;
};

/** 0 exact, 1 prefix, 2 word-prefix, 3 substring, 4 fuzzy, Infinity no match. */
function scoreText(q: string, text: string): number {
  if (!text) return Infinity;
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  if ((' ' + text).includes(' ' + q)) return 2;
  if (text.includes(q)) return 3;
  if (isSubsequence(q.replace(/ /g, ''), text.replace(/ /g, ''))) return 4;
  return Infinity;
}

/** Ids best first; empty query keeps the original order; non-matches are excluded; ties keep input order. */
export function rankCommands(query: string, items: SearchItem[]): string[] {
  const q = normalize(query);
  if (!q) return items.map((i) => i.id);
  const scored: { id: string; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    // The id is a weaker signal than a visible label: half a step behind the same quality of label match.
    const score = Math.min(scoreText(q, normalize(item.he)), scoreText(q, normalize(item.en)), scoreText(q, normalize(item.id)) + 0.5);
    if (Number.isFinite(score)) scored.push({ id: item.id, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.map((s) => s.id);
}
