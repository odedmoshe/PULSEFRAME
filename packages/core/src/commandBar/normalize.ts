/**
 * The command bar's tokenizer (ADR-0027, plan §4.1 steps 1–4). Pure: no clock, no random source, no DOM.
 *
 * - Quoted spans first, in six quote styles (" ״ “ „ « '), each closed by its own closer and kept VERBATIM (the title text the
 *   owner typed). A " or ״ between two Hebrew letters is gershayim (an abbreviation: דצ״ב, ש״ח), not a quote, unless it opens
 *   after a lone proclitic (ל"גן רימון") and a closer follows. An unclosed quote is reported, never guessed.
 * - Outside quotes: NFC, niqqud and cantillation stripped, ' and ’ after a Hebrew letter read as geresh ׳, " between Hebrew
 *   letters as gershayim ״, Latin lower-cased; maqaf ־ and a hyphen between letters split words and the next word remembers it.
 * - Tokens: word, number (\d+(\.\d+)?; "1,5" keeps its comma and is ambiguous), timecode (m:ss, h:mm:ss, hh:mm:ss:ff), unit
 *   (s, sec, f, fr, min, db, %, x, ש׳, שנ׳, דק׳, דצ״ב). Every token keeps its span in the ORIGINAL text.
 * - Proclitics (ו ה ב ל מ ש כ and the listed pairs) are stripped only when what remains is a word the lexicon knows; a lone
 *   proclitic before a maqaf, a number, a timecode or a quote («ב־3», «ו־10», ל"…") becomes that token's prefix.
 */
import type { BarToken } from '../commandBarContract.ts';
import { dict } from './dict.ts';

const HEB = /[א-ת]/;
const isHeb = (c: string | undefined) => !!c && HEB.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
/** Niqqud and cantillation, U+0591–U+05C7 without the maqaf, paseq, sof pasuq and nun hafukha (they are not marks). */
const NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;
const MAQAF = '־';

/** Single proclitics, and the explicit two-letter pairs (plan §4.1 step 4). */
export const PROCLITICS = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ'] as const;
export const PROCLITIC_PAIRS = ['וה', 'וב', 'ול', 'ומ', 'וש', 'שה', 'שב', 'של', 'כש', 'מה', 'לכ'] as const;
const LONE_PROCLITIC = new Set<string>([...PROCLITICS, ...PROCLITIC_PAIRS]);

/** Quote openers and the closers each accepts. */
const QUOTES: Readonly<Record<string, string[]>> = dict({ '"': ['"', '״', '”'], '״': ['״', '"', '”'], '“': ['”', '“', '"'], '„': ['“', '”', '"'], '«': ['»'], "'": ["'", '’'] });

/** Lower-case Latin, NFC, niqqud out, geresh and gershayim unified. Not for quoted text. */
export function normWord(raw: string): string {
  let s = raw.normalize('NFC').replace(NIQQUD, '');
  s = s.replace(/([א-ת])['’]/g, '$1׳').replace(/([א-ת])["”]([א-ת])/g, '$1״$2');
  return s.toLowerCase();
}

/** The unit abbreviations a token can be (normal form → canonical unit). */
const UNIT_WORDS: Readonly<Record<string, string>> = dict({ s: 's', sec: 's', secs: 's', f: 'f', fr: 'f', min: 'min', db: 'db', '%': '%', x: 'x', '×': 'x', 'ש׳': 's', 'שנ׳': 's', 'דק׳': 'min', 'דצ״ב': 'db' });
const TRAIL_PUNCT = /[.,!?;:)\]}…»”"״]+$/;
const LEAD_PUNCT = /^[([{«“„]+/;

export interface Tokenized {
  tokens: BarToken[];
  /** The start offset of a quote that was opened and never closed (null: none). */
  unclosedQuote: number | null;
}

interface Piece { raw: string; start: number; end: number; maqaf: boolean }

/** Where the quoted spans are: [start, end) including the marks, with the inner text; or an unclosed opener. */
function findQuotes(text: string): { spans: { start: number; end: number; inner: string }[]; unclosed: number | null } {
  const spans: { start: number; end: number; inner: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const closers = QUOTES[c];
    if (!closers) { i++; continue; }
    const prev = text[i - 1], next = text[i + 1];
    // the opener sits at a word boundary, or right after a lone proclitic that itself starts a word (ל"גן רימון")
    let lead = i;
    while (lead > 0 && isHeb(text[lead - 1])) lead--;
    const proclitic = i - lead > 0 && i - lead <= 2 && LONE_PROCLITIC.has(text.slice(lead, i)) && (lead === 0 || isSpace(text[lead - 1]) || text[lead - 1] === MAQAF);
    const boundary = i === 0 || isSpace(prev) || prev === MAQAF || prev === '-' || proclitic;
    if (!boundary || isSpace(next)) { i++; continue; }
    if (c === "'" && isHeb(prev)) { i++; continue; } // a geresh
    if ((c === '"' || c === '״') && isHeb(prev) && isHeb(next) && !proclitic) { i++; continue; } // gershayim
    // the closer: a matching mark followed by the end, a space or punctuation
    let j = i + 1, close = -1;
    while (j < text.length) {
      if (closers.includes(text[j]!) && j > i + 1 && (j + 1 >= text.length || isSpace(text[j + 1]) || /[.,!?;:)]/.test(text[j + 1]!))) { close = j; break; }
      j++;
    }
    if (close < 0) {
      if ((c === '"' || c === '״') && isHeb(prev) && isHeb(next)) { i++; continue; } // after a proclitic with no closer: an abbreviation (ב"ה)
      return { spans, unclosed: i };
    }
    spans.push({ start: i, end: close + 1, inner: text.slice(i + 1, close) });
    i = close + 1;
  }
  return { spans, unclosed: null };
}

/** Split an unquoted region into pieces at spaces, maqaf and hyphens between letters or digits. */
function pieces(text: string, from: number, to: number): Piece[] {
  const out: Piece[] = [];
  let i = from;
  while (i < to) {
    while (i < to && isSpace(text[i])) i++;
    if (i >= to) break;
    let j = i;
    while (j < to && !isSpace(text[j])) j++;
    // [i, j) is one space-free chunk: cut it at maqaf and at a hyphen that has something on both sides
    let s = i, maqaf = false;
    for (let k = i; k <= j; k++) {
      const ch = text[k];
      const cut = k === j || ch === MAQAF || (ch === '-' && k > s && k + 1 < j);
      if (!cut) continue;
      if (k > s) out.push({ raw: text.slice(s, k), start: s, end: k, maqaf });
      maqaf = k < j;
      s = k + 1;
    }
    i = j;
  }
  return out;
}

/** One piece → tokens (a number glued to its unit, "3s", "-6db", "x2", is two tokens; a leading sign is its own word). */
function classify(p: Piece): BarToken[] {
  let { raw, start } = p;
  const lead = LEAD_PUNCT.exec(raw)?.[0].length ?? 0;
  raw = raw.slice(lead); start += lead;
  // trailing punctuation, but keep a geresh or gershayim that belongs to an abbreviation (ש׳, דצ״ב) and a % unit
  let trail = TRAIL_PUNCT.exec(raw)?.[0].length ?? 0;
  if (trail && /[א-ת]["״]$/.test(raw) && raw.length >= 2) trail = 0;
  raw = raw.slice(0, raw.length - trail);
  if (!raw) return [];
  const end = start + raw.length;
  const tok = (kind: BarToken['kind'], r: string, s: number, norm: string, maqaf = p.maqaf): BarToken => ({ kind, raw: r, norm, start: s, end: s + r.length, prefixes: [], maqaf });
  if (/^\d{1,2}(:\d{2}){1,3}$/.test(raw)) return [tok('timecode', raw, start, raw)];
  if (/^\d+(\.\d+)?$/.test(raw) || /^\d+(,\d+)+$/.test(raw)) return [tok('number', raw, start, raw)];
  const sign = /^([+\-−])(?=\d)/.exec(raw);
  if (sign) return [tok('word', sign[1]!, start, sign[1] === '+' ? '+' : '-'), ...classify({ raw: raw.slice(1), start: start + 1, end, maqaf: false })];
  const glued = /^(\d+(?:[.,]\d+)?)([a-z%×]+)$/i.exec(raw);
  if (glued && UNIT_WORDS[glued[2]!.toLowerCase()]) return [tok('number', glued[1]!, start, glued[1]!), tok('unit', glued[2]!, start + glued[1]!.length, UNIT_WORDS[glued[2]!.toLowerCase()]!, false)];
  const times = /^([x×])(\d+(?:\.\d+)?)$/i.exec(raw);
  if (times) return [tok('unit', times[1]!, start, 'x'), tok('number', times[2]!, start + 1, times[2]!, false)];
  const norm = normWord(raw);
  const unit = UNIT_WORDS[norm];
  if (unit) return [tok('unit', raw, start, unit)];
  return [tok('word', raw, start, norm)];
}

/** Strip up to two proclitics when (and only when) what remains is known. A word known as written is never stripped. */
export function stripProclitics(norm: string, known: (w: string) => boolean): { norm: string; prefixes: string[] } | null {
  if (known(norm)) return { norm, prefixes: [] };
  for (const p of PROCLITICS) if (norm.startsWith(p) && norm.length - 1 >= 2 && known(norm.slice(1))) return { norm: norm.slice(1), prefixes: [p] };
  for (const p of PROCLITIC_PAIRS) if (norm.startsWith(p) && norm.length - 2 >= 2 && known(norm.slice(2))) return { norm: norm.slice(2), prefixes: [...p] };
  return null;
}

/**
 * Tokenize `text`. `known` says which normal forms the lexicon knows (words, number words, units, catalogue names); it decides
 * proclitic stripping only.
 */
export function tokenize(text: string, known: (w: string) => boolean): Tokenized {
  const { spans, unclosed } = findQuotes(text);
  const raw: BarToken[] = [];
  let at = 0;
  const regions: { from: number; to: number; quote?: { inner: string } }[] = [];
  for (const q of spans) { regions.push({ from: at, to: q.start }); regions.push({ from: q.start, to: q.end, quote: { inner: q.inner } }); at = q.end; }
  regions.push({ from: at, to: unclosed ?? text.length });
  for (const r of regions) {
    if (r.quote) { raw.push({ kind: 'quote', raw: text.slice(r.from, r.to), norm: r.quote.inner, start: r.from, end: r.to, prefixes: [], maqaf: false }); continue; }
    // a quote opened right after a proclitic (ל"…") leaves that letter glued to the region's end
    for (const p of pieces(text, r.from, r.to)) raw.push(...classify(p));
  }
  if (unclosed !== null) raw.push({ kind: 'quote', raw: text.slice(unclosed), norm: text.slice(unclosed + 1), start: unclosed, end: text.length, prefixes: [], maqaf: false });
  // proclitics
  const out: BarToken[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i]!;
    const next = raw[i + 1];
    if (t.kind === 'word' && LONE_PROCLITIC.has(t.norm) && next && (next.maqaf || next.start === t.end) && next.kind !== 'unit') {
      // «ב־3», «ו־10», «ה־70», ל"גן רימון": the letters become the next token's prefixes
      const merged = next.kind === 'word' ? stripProclitics(next.norm, known) : null;
      raw[i + 1] = { ...next, raw: text.slice(t.start, next.end), start: t.start, prefixes: [...t.norm, ...(merged?.prefixes ?? [])], norm: merged?.norm ?? next.norm, maqaf: t.maqaf };
      continue;
    }
    if (t.kind === 'word' && LONE_PROCLITIC.has(t.norm) && next && (next.kind === 'number' || next.kind === 'timecode' || next.kind === 'quote') && t.norm.length === 1 && t.norm !== 'ה') {
      raw[i + 1] = { ...next, raw: text.slice(t.start, next.end), start: t.start, prefixes: [t.norm], maqaf: t.maqaf };
      continue;
    }
    if (t.kind === 'word') {
      const s = stripProclitics(t.norm, known);
      out.push(s ? { ...t, norm: s.norm, prefixes: s.prefixes } : t);
    } else out.push(t);
  }
  return { tokens: out, unclosedQuote: unclosed };
}
