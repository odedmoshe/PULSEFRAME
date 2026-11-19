/**
 * Give the words of a typed or imported phrase the times a recogniser heard (SPEC §16 alignment).
 * The typed text is kept exactly; only times are taken from recognition. Typed and recognised words are matched in order
 * (edit-distance alignment on the bare words). A typed word matched to an identical recognised word, or standing where the
 * recogniser heard a different word, takes that word's time. A typed word the recogniser has no counterpart for gets a share
 * of the gap between its neighbours, by length: an estimate, which makes the whole phrase "approximate".
 * All times are integer milliseconds.
 */
import { bareWord } from './fillers.ts';

export interface HeardWord { text: string; start: number; end: number; confidence: number }
export interface AlignedWord { text: string; start: number; end: number; confidence: number | null; how: 'same' | 'different' | 'estimated' }
export interface AlignedPhrase { words: AlignedWord[]; same: number; different: number; estimated: number; /** word = every time comes from a heard word and at least half are identical; otherwise approximate. */ timing: 'word' | 'approximate' }

export function alignPhrase(typed: string[], heard: HeardWord[], phraseStart: number, phraseEnd: number): AlignedPhrase {
  const a = typed.map(bareWord), b = heard.map((h) => bareWord(h.text));
  const n = a.length, m = b.length;
  // cost[i][j]: cheapest way to align the first i typed words with the first j heard words
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) cost[i]![j] = Math.min(cost[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] && a[i - 1] ? 0 : 1), cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1);
  const pair: (number | null)[] = Array(n).fill(null);
  for (let i = n, j = m; i > 0; ) {
    if (j > 0 && cost[i]![j] === cost[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] && a[i - 1] ? 0 : 1)) { pair[i - 1] = j - 1; i--; j--; }
    else if (cost[i]![j] === cost[i - 1]![j]! + 1) i--;
    else j--;
  }
  const clamp = (x: number) => Math.min(phraseEnd, Math.max(phraseStart, x));
  const words: AlignedWord[] = typed.map((text, i) => {
    const h = pair[i] === null ? null : heard[pair[i]!]!;
    return h ? { text, start: clamp(h.start), end: clamp(h.end), confidence: a[i] === bareWord(h.text) ? h.confidence : null, how: a[i] === bareWord(h.text) ? 'same' as const : 'different' as const } : { text, start: 0, end: 0, confidence: null, how: 'estimated' as const };
  });
  // estimated runs share the gap between the timed words around them, by length of the word
  for (let i = 0; i < n; ) {
    if (words[i]!.how !== 'estimated') { i++; continue; }
    let k = i;
    while (k < n && words[k]!.how === 'estimated') k++;
    const from = i > 0 ? words[i - 1]!.end : phraseStart, to = Math.max(from, k < n ? words[k]!.start : phraseEnd);
    const total = words.slice(i, k).reduce((s, w) => s + Math.max(1, w.text.length), 0);
    let at = from, used = 0;
    for (let x = i; x < k; x++) { used += Math.max(1, words[x]!.text.length); const end = Math.round(from + ((to - from) * used) / total); words[x]!.start = at; words[x]!.end = end; at = end; }
    i = k;
  }
  // in order, never overlapping (heard words can overlap by a few milliseconds)
  let prev = phraseStart;
  for (const w of words) { if (w.start < prev) w.start = prev; if (w.end < w.start) w.end = w.start; prev = w.end; }
  const same = words.filter((w) => w.how === 'same').length, different = words.filter((w) => w.how === 'different').length, estimated = n - same - different;
  return { words, same, different, estimated, timing: estimated === 0 && same * 2 >= n && n > 0 ? 'word' : 'approximate' };
}
