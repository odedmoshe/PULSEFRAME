/**
 * Lexicon match (ADR-0027, plan §4.1 steps 5–6): each intent family reads the tokens left to right with its own verbs, words
 * and slot parsers; at every position the LONGEST match wins («בטל השתקה» before «בטל»). A family "covers" the request when
 * every token was read (filler words count as read) and one of its heads was seen. No scoring: a token nobody reads leaves
 * the request unknown, never half-understood into an action.
 */
import type { BarReading, BarReadingRole, BarToken } from '../commandBarContract.ts';
import {
  AFTER_MARK, AT_END, AT_MARK, AT_START, BACKWARD, BEFORE_MARK, catalogNames, CLIP_MANY, CLIP_ONE, DB_WORDS, DESTINATION_WORDS, DURATION_MARK, FADE_EDGE, FAMILIES, FILLERS, FORWARD,
  FROM_HERE, HERE, LANGUAGE_WORDS, MUSIC, OPEN_WORDS, SOUND, SPEED_DOUBLE, SPEED_FACTOR, SPEED_HALF, STYLE_MARK, TO_END, TO_START, VERBS, WORKSPACE_WORDS,
  type FamilySpec, type SlotName,
} from './lexicon.ts';
import { normWord, tokenize } from './normalize.ts';
import { exText, numberWords, readNumber, type NumberRead } from './numbers.ts';
import type { BarExact } from '../commandBarContract.ts';
import { readAmount, timeWords, type TimeAmount } from './time.ts';

// ---------- phrases ----------
export interface WordSpec { w: string; pre: 'default' | 'any' | readonly string[] }
export type Phrase = readonly WordSpec[];
const phraseCache = new Map<string, Phrase>();
/** "ב:סמן עד" → word specs (see lexicon.ts for the syntax). */
export function phrase(s: string): Phrase {
  const hit = phraseCache.get(s);
  if (hit) return hit;
  const out = s.split(' ').filter(Boolean).map((part): WordSpec => {
    const k = part.indexOf(':');
    if (k > 0 && !/^\d/.test(part)) {
      const pre = part.slice(0, k), w = normWord(part.slice(k + 1));
      return { w, pre: pre === '*' ? 'any' : pre.split('|') };
    }
    return { w: normWord(part), pre: 'default' };
  });
  phraseCache.set(s, out);
  return out;
}
const FILLER_SET: ReadonlySet<string> = new Set(FILLERS);
export const isFiller = (t: BarToken | undefined) => !!t && t.kind === 'word' && FILLER_SET.has(t.norm) && (t.prefixes.length === 0 || (t.prefixes.length === 1 && t.prefixes[0] === 'ו'));

/**
 * Does the token spell the word with allowed proclitics? Compared on the surface (proclitics + normal form), so a phrase
 * written with the article («עם הסוף») and a token stripped of it («סוף» + ה) agree, and the reverse.
 */
function prefixOk(t: BarToken, w: string, pre: WordSpec['pre']): boolean {
  const surface = t.prefixes.join('') + t.norm;
  if (!surface.endsWith(w)) return false;
  const p = [...surface.slice(0, surface.length - w.length)];
  if (pre === 'any') return p.every((c) => 'והבלמשכ'.includes(c));
  if (pre === 'default') {
    if (p[0] === 'ו') p.shift();
    return p.length === 0 || (p.length === 1 && p[0] === 'ה');
  }
  if (p[0] === 'ו' || p[0] === 'ש') p.shift();
  return pre.some((x) => p.length >= 1 && p[0] === x && (p.length === 1 || (p.length === 2 && p[1] === 'ה')));
}
/** The token after the phrase when it matches at i (filler words may stand between its words), else -1. */
export function matchPhrase(tokens: readonly BarToken[], i: number, ph: Phrase): number {
  let j = i;
  for (let k = 0; k < ph.length; k++) {
    const spec = ph[k]!;
    if (k > 0) while (isFiller(tokens[j]) && tokens[j]!.norm !== spec.w) j++;
    const t = tokens[j];
    if (!t || t.kind === 'quote' || !prefixOk(t, spec.w, spec.pre)) return -1;
    j++;
  }
  return j;
}
/** The longest of `phrases` at i: its end, or -1. */
export function longest(tokens: readonly BarToken[], i: number, phrases: readonly string[]): number {
  let best = -1;
  for (const s of phrases) { const e = matchPhrase(tokens, i, phrase(s)); if (e > best) best = e; }
  return best;
}

// ---------- known words (for the tokenizer's proclitic rule) ----------
let knownSet: Set<string> | null = null;
/** Every normal form the lexicon knows: phrase words, number and time words, fillers, catalogue name words. */
export function knownWords(): ReadonlySet<string> {
  if (knownSet) return knownSet;
  const s = new Set<string>([...numberWords(), ...timeWords(), ...FILLERS]);
  const addAll = (list: readonly string[]) => { for (const p of list) for (const w of phrase(p)) s.add(w.w); };
  for (const v of Object.values(VERBS)) addAll(v);
  for (const f of FAMILIES) { for (const h of f.heads) addAll(h.phrases); for (const w of f.words ?? []) addAll(w.phrases); }
  for (const list of [CLIP_ONE, CLIP_MANY, MUSIC, SOUND, HERE, AT_START, AT_END, TO_START, TO_END, DURATION_MARK, AT_MARK, AFTER_MARK, BEFORE_MARK, FORWARD, BACKWARD, FROM_HERE, DB_WORDS, SPEED_FACTOR, SPEED_DOUBLE, SPEED_HALF, STYLE_MARK]) addAll(list);
  for (const r of [WORKSPACE_WORDS, DESTINATION_WORDS, LANGUAGE_WORDS, OPEN_WORDS, FADE_EDGE] as Record<string, readonly string[]>[]) for (const l of Object.values(r)) addAll(l);
  const c = catalogNames();
  for (const n of [...c.effect, ...c.look, ...c.transition, ...c.textStyle]) for (const t of tokenize(n.phrase, () => true).tokens) s.add(t.norm);
  knownSet = s;
  return s;
}
export const tokenizeBar = (text: string) => { const k = knownWords(); return tokenize(text, (w) => k.has(w)); };

// ---------- hits ----------
/** A time said in a request, before it is placed on the timeline (match → plans). */
export type TimeSpec =
  | { kind: 'here' } | { kind: 'start' } | { kind: 'end' }
  | { kind: 'abs'; amount: TimeAmount; saidSeconds: boolean; saidFrames: boolean; form: 'count' | 'ordinal' | 'timecode' }
  | { kind: 'rel'; sign: 1 | -1; amount: TimeAmount; saidSeconds: boolean; saidFrames: boolean }
  | { kind: 'refused'; code: 'half_frame' | 'out_of_range' };
export type SpeedSpec = { kind: 'factor'; k: BarExact } | { kind: 'abs'; v: BarExact } | { kind: 'half' };
export interface Alt { key: string; role: BarReadingRole; value: unknown; he: string; en: string }
export interface Hit { start: number; end: number; role: BarReadingRole; key: string; value: unknown; head: boolean; alts?: Alt[] }
export interface FamilyParse { family: FamilySpec; hits: Hit[]; unread: number[]; head: boolean }

type Matcher = (tokens: readonly BarToken[], i: number) => Hit[];
const words = (key: string, role: BarReadingRole, list: readonly string[], value: unknown, head = false): Matcher => (tokens, i) => {
  const e = longest(tokens, i, list);
  return e > i ? [{ start: i, end: e, role, key, value, head }] : [];
};
const table = (key: string, role: BarReadingRole, rows: Readonly<Record<string, readonly string[]>>, head = false): Matcher => (tokens, i) =>
  Object.entries(rows).flatMap(([value, list]) => words(key, role, list, value, head)(tokens, i));
const catalogPhrases = new WeakMap<readonly { id: string; phrase: string }[], { id: string; ph: Phrase }[]>();
/** A catalogue's names as phrases (tokenized once per catalogue). */
function phrasesOf(list: readonly { id: string; phrase: string }[]): { id: string; ph: Phrase }[] {
  let out = catalogPhrases.get(list);
  if (!out) {
    out = list.map((n) => ({ id: n.id, ph: tokenize(n.phrase, () => true).tokens.map((t, k): WordSpec => ({ w: t.norm, pre: k === 0 ? 'any' : 'default' })) })).filter((n) => n.ph.length > 0);
    catalogPhrases.set(list, out);
  }
  return out;
}
function catalog(key: string, list: readonly { id: string; phrase: string }[], head = false): Matcher {
  return (tokens, i) => {
    let best: Hit | null = null;
    for (const n of phrasesOf(list)) {
      const ph = n.ph;
      const e = matchPhrase(tokens, i, ph);
      if (e > i && (!best || e > best.end)) best = { start: i, end: e, role: 'style', key, value: n.id, head };
    }
    return best ? [best] : [];
  };
}

/** Seconds of an amount, as words for a choice label ("3", "1.5", "1 s + 12 frames"). */
export function amountWords(a: TimeAmount): { he: string; en: string } {
  const s = exText(a.secs), f = exText(a.frames);
  if (a.frames.num === 0n) return { he: `${s} שניות`, en: `${s} s` };
  if (a.secs.num === 0n) return { he: `${f} פריימים`, en: `${f} frames` };
  return { he: `${s} שניות ו־${f} פריימים`, en: `${s} s and ${f} frames` };
}

interface TimeEnv { pos: boolean; dur: boolean; seek: boolean }
/** Positions and durations made of an amount (plan §4.3): «בשנייה 3», «ב־1:10», «למשך 4 שניות», «לשנייה וחצי», «אחרי 2 שניות מכאן», «5 שניות קדימה». */
function timeMatcher(env: TimeEnv): Matcher {
  return (tokens, i) => {
    const out: Hit[] = [];
    const absOf = (r: NonNullable<ReturnType<typeof readAmount>>, a: TimeAmount = r.amount): TimeSpec => (r.refused ? { kind: 'refused', code: r.refused } : { kind: 'abs', amount: a, saidSeconds: r.saidSeconds, saidFrames: r.saidFrames, form: r.form });
    const plainNext = (j: number) => { const t = tokens[j]; return !!t && t.prefixes.length === 0; };
    // marker words: למשך / for, at, אחרי / בעוד / after, לפני / before
    const dm = longest(tokens, i, DURATION_MARK);
    if (dm > i && env.dur && plainNext(dm)) { const r = readAmount(tokens as BarToken[], dm); if (r && !r.alternatives) out.push({ start: i, end: r.end, role: 'duration', key: 'dur', value: absOf(r), head: false }); }
    const am = longest(tokens, i, AT_MARK);
    if (am > i && (env.pos || env.seek) && plainNext(am)) { const r = readAmount(tokens as BarToken[], am); if (r) out.push(withAlts({ start: i, end: r.end, role: 'position', key: 'pos', value: absOf(r), head: false }, r, 'pos', 'position')); }
    for (const [list, sign] of [[AFTER_MARK, 1], [BEFORE_MARK, -1]] as const) {
      const m = longest(tokens, i, list);
      if (m > i && (env.pos || env.seek) && plainNext(m)) {
        const r = readAmount(tokens as BarToken[], m);
        if (r && !r.alternatives) {
          const fh = longest(tokens, r.end, FROM_HERE);
          const value: TimeSpec = r.refused ? { kind: 'refused', code: r.refused } : { kind: 'rel', sign, amount: r.amount, saidSeconds: r.saidSeconds, saidFrames: r.saidFrames };
          out.push({ start: i, end: fh > r.end ? fh : r.end, role: 'position', key: 'pos', value, head: false });
        }
      }
    }
    // an amount: its proclitic says position or length
    const r = readAmount(tokens as BarToken[], i);
    if (r) {
      const fw = longest(tokens, r.end, FORWARD), bw = longest(tokens, r.end, BACKWARD);
      if ((fw > r.end || bw > r.end) && (env.pos || env.seek) && r.prefixes.length === 0 && !r.alternatives) {
        const value: TimeSpec = r.refused ? { kind: 'refused', code: r.refused } : { kind: 'rel', sign: fw > r.end ? 1 : -1, amount: r.amount, saidSeconds: r.saidSeconds, saidFrames: r.saidFrames };
        out.push({ start: i, end: Math.max(fw, bw), role: 'position', key: 'pos', value, head: false });
        return out;
      }
      const p = r.prefixes.join('');
      let as: 'pos' | 'dur' | 'both' | null = null;
      if (env.seek) as = p === '' || p === 'ל' || p === 'ב' ? 'pos' : null;
      else if (r.form === 'timecode' || r.form === 'ordinal') as = p === 'ל' && env.dur && r.form === 'timecode' ? 'dur' : p === '' || p === 'ב' || p === 'ל' ? (env.pos ? 'pos' : null) : null;
      else if (p === 'ב') as = env.pos && env.dur ? 'both' : env.pos ? 'pos' : env.dur ? 'dur' : null;
      else if (p === 'ל') as = env.dur ? 'dur' : null;
      else if (p === '') as = env.dur ? 'dur' : env.pos ? 'pos' : null;
      if (as === 'pos' || as === 'dur') out.push(withAlts({ start: i, end: r.end, role: as === 'pos' ? 'position' : 'duration', key: as, value: absOf(r), head: false }, r, as, as === 'pos' ? 'position' : 'duration'));
      if (as === 'both') {
        // «ב־3 שניות» with a verb that takes a position and a length: asked, never chosen (plan §4.3)
        const alts = (r.alternatives ?? [r.amount]).flatMap((a): Alt[] => {
          const w = amountWords(a), val = absOf(r, a);
          return [{ key: 'pos', role: 'position', value: val, he: `בנקודה ${w.he}`, en: `at ${w.en}` }, { key: 'dur', role: 'duration', value: val, he: `למשך ${w.he}`, en: `for ${w.en}` }];
        });
        out.push({ start: i, end: r.end, role: 'position', key: 'time', value: null, head: false, alts });
      }
    }
    return out;
  };
}
/** A time whose words allow several amounts («בשנייה השלישית», «1,5 שניות») carries them as alternatives. */
function withAlts(h: Hit, r: NonNullable<ReturnType<typeof readAmount>>, key: string, role: BarReadingRole): Hit {
  if (!r.alternatives) return h;
  return { ...h, value: null, alts: r.alternatives.map((a) => { const w = amountWords(a); return { key, role, value: { kind: 'abs', amount: a, saidSeconds: r.saidSeconds, saidFrames: r.saidFrames, form: r.form } satisfies TimeSpec, he: w.he, en: w.en }; }) };
}

/** «ב־3 דציבל», «-6 dB», «מינוס 3 דצ״ב». */
const dbMatcher: Matcher = (tokens, i) => {
  const n = readNumber(tokens as BarToken[], i);
  if (!n) return [];
  const u = tokens[n.end];
  let end = -1;
  if (u && u.kind === 'unit' && u.norm === 'db') end = n.end + 1;
  else { const e = longest(tokens, n.end, DB_WORDS); if (e > n.end) end = e; }
  if (end < 0) return [];
  if (n.alternatives) return [{ start: i, end, role: 'amount', key: 'db', value: null, head: false, alts: n.alternatives.map((v) => ({ key: 'db', role: 'amount' as const, value: v, he: `${exText(v)} דציבל`, en: `${exText(v)} dB` })) }];
  return [{ start: i, end, role: 'amount', key: 'db', value: n.value, head: false }];
};

/** «פי 2», «x2», «2x», «פעמיים», «כפולה», «חצי», «0.5», «50%». */
const speedMatcher: Matcher = (tokens, i) => {
  const out: Hit[] = [];
  const hit = (end: number, value: SpeedSpec): Hit => ({ start: i, end, role: 'amount', key: 'speed', value, head: false });
  const fm = longest(tokens, i, SPEED_FACTOR);
  if (fm > i) { const n = readNumber(tokens as BarToken[], fm); if (n && !n.alternatives) out.push(hit(n.end, { kind: 'factor', k: n.value })); }
  const t = tokens[i];
  if (t?.kind === 'unit' && t.norm === 'x') { const n = readNumber(tokens as BarToken[], i + 1); if (n && !n.alternatives) out.push(hit(n.end, { kind: 'factor', k: n.value })); }
  const d = longest(tokens, i, SPEED_DOUBLE);
  if (d > i) out.push(hit(d, { kind: 'factor', k: { num: 2n, den: 1n } }));
  const h = longest(tokens, i, SPEED_HALF);
  if (h > i) out.push(hit(h, { kind: 'half' }));
  const n: NumberRead | null = t && t.kind === 'number' ? readNumber(tokens as BarToken[], i) : null;
  if (n && !n.alternatives) {
    const u = tokens[n.end];
    if (u?.kind === 'unit' && u.norm === 'x') out.push(hit(n.end + 1, { kind: 'factor', k: n.value }));
    else if (u?.kind === 'unit' && u.norm === '%') out.push(hit(n.end + 1, { kind: 'abs', v: { num: n.value.num, den: n.value.den * 100n } }));
    else if (n.prefixes.length === 0 || (n.prefixes.length === 1 && n.prefixes[0] === 'ל')) out.push(hit(n.end, { kind: 'abs', v: n.value }));
  }
  return out;
};

/** A quote token: the text the owner typed, verbatim. */
const textMatcher = (unclosed: number | null): Matcher => (tokens, i) => {
  const t = tokens[i];
  return t?.kind === 'quote' ? [{ start: i, end: i + 1, role: 'text', key: 'text', value: { text: t.norm, unclosed: unclosed !== null && t.start <= unclosed && unclosed < t.end }, head: false }] : [];
};

/** «בסגנון זהב», "in style gold". */
const textStyleMatcher: Matcher = (tokens, i) => {
  const m = longest(tokens, i, STYLE_MARK);
  if (m <= i) return [];
  const h = catalog('style', catalogNames().textStyle)(tokens, m);
  return h.map((x) => ({ ...x, start: i }));
};

function slotMatchers(slots: readonly SlotName[], headSlots: readonly SlotName[], unclosed: number | null): Matcher[] {
  const has = (s: SlotName) => slots.includes(s);
  const head = (s: SlotName) => headSlots.includes(s);
  const out: Matcher[] = [];
  if (has('here') || has('pos')) out.push(words('pos', 'position', HERE, { kind: 'here' } satisfies TimeSpec));
  if (has('pos')) { out.push(words('pos', 'position', AT_START, { kind: 'start' } satisfies TimeSpec)); out.push(words('pos', 'position', AT_END, { kind: 'end' } satisfies TimeSpec)); }
  if (has('seek')) {
    out.push(words('pos', 'position', TO_START, { kind: 'start' } satisfies TimeSpec), words('pos', 'position', TO_END, { kind: 'end' } satisfies TimeSpec), words('pos', 'position', AT_START, { kind: 'start' } satisfies TimeSpec), words('pos', 'position', AT_END, { kind: 'end' } satisfies TimeSpec));
  }
  if (has('pos') || has('dur') || has('seek')) out.push(timeMatcher({ pos: has('pos'), dur: has('dur'), seek: has('seek') }));
  if (has('text')) out.push(textMatcher(unclosed));
  if (has('db')) out.push(dbMatcher);
  if (has('speed')) out.push(speedMatcher);
  if (has('music')) out.push(words('target', 'target', MUSIC, 'music'));
  if (has('clip')) { out.push(words('target', 'target', CLIP_ONE, 'clip')); out.push(words('target', 'target', CLIP_MANY, 'clips')); }
  if (has('sound')) out.push(words('target', 'target', SOUND, 'sound'));
  if (has('fadeEdge')) out.push(table('edge', 'mode', FADE_EDGE));
  if (has('workspace')) out.push(table('workspace', 'mode', WORKSPACE_WORDS));
  if (has('destination')) out.push(table('destination', 'destination', DESTINATION_WORDS));
  if (has('language')) out.push(table('lang', 'mode', LANGUAGE_WORDS));
  if (has('openTarget')) out.push(table('open', 'object', OPEN_WORDS, head('openTarget')));
  if (has('effect')) out.push(catalog('name', catalogNames().effect));
  if (has('look')) out.push(catalog('name', catalogNames().look));
  if (has('transition')) out.push(catalog('name', catalogNames().transition, head('transition')));
  if (has('textStyle')) out.push(textStyleMatcher);
  return out;
}

/** Keys that may be said once: a second one is not read (the request is then not understood). */
const ONCE = new Set(['pos', 'dur', 'time', 'text', 'db', 'speed', 'target', 'workspace', 'destination', 'name', 'lang', 'open', 'edge', 'style', 'scope', 'keepGap', 'dir']);

/** Read the tokens with one family's words and slots. */
export function parseFamily(f: FamilySpec, tokens: readonly BarToken[], unclosed: number | null): FamilyParse {
  const matchers: Matcher[] = [
    ...f.heads.map((h) => words('head', 'verb', h.phrases, h.value ?? null, true)),
    ...(f.words ?? []).map((w) => words(w.key, w.role, w.phrases, w.value ?? null)),
    ...slotMatchers(f.slots ?? [], f.headSlots ?? [], unclosed),
  ];
  const hits: Hit[] = [], unread: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tokens.length;) {
    let best: Hit | null = null;
    for (const m of matchers) for (const h of m(tokens, i)) if (!best || h.end > best.end) best = h;
    if (!best) {
      if (isFiller(tokens[i])) hits.push({ start: i, end: i + 1, role: 'filler', key: 'filler', value: null, head: false });
      else unread.push(i);
      i++;
      continue;
    }
    if (!best.head && ONCE.has(best.key) && seen.has(best.key)) {
      for (let k = best.start; k < best.end; k++) unread.push(k);
    } else {
      hits.push(best);
      seen.add(best.key);
    }
    i = best.end;
  }
  // effect / look: the words after the head that name nothing in the catalogue are an unknown name (refused with its own words)
  if ((f.id === 'effect' || f.id === 'look') && unread.length && !hits.some((h) => h.key === 'name')) {
    const headEnd = Math.max(...hits.filter((h) => h.head).map((h) => h.end), -1);
    if (headEnd >= 0 && unread.every((k, n) => k >= headEnd && (n === 0 || unread[n - 1] === k - 1))) {
      hits.push({ start: unread[0]!, end: unread[unread.length - 1]! + 1, role: 'style', key: 'name', value: null, head: false });
      unread.length = 0;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  return { family: f, hits, unread: [...new Set(unread)].sort((a, b) => a - b), head: hits.some((h) => h.head) };
}

/** A reading's value, JSON-safe (no bigint): what the «הבנתי» highlight may show. */
function jsonValue(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(jsonValue);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.num === 'bigint' && typeof o.den === 'bigint' && Object.keys(o).length === 2) return exText(o as unknown as BarExact);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, jsonValue(x)]));
  }
  return v;
}
export function readingsOf(tokens: readonly BarToken[], hits: readonly Hit[]): BarReading[] {
  return hits.map((h) => ({ role: h.role, span: [tokens[h.start]!.start, tokens[h.end - 1]!.end] as [number, number], value: jsonValue(h.alts ? { alternatives: h.alts.map((a) => ({ key: a.key, value: a.value })) } : h.value) }));
}
/** Merge the unread token indexes into character spans of the original text. */
export function spansOf(tokens: readonly BarToken[], idx: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const k of idx) {
    const t = tokens[k]!;
    const last = out[out.length - 1];
    if (last && idx.includes(k - 1) && out.length) last[1] = t.end; else out.push([t.start, t.end]);
  }
  return out;
}
