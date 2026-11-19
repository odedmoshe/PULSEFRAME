/**
 * Exact times of the command bar (ADR-0027, plan §4.3). A time phrase is read as an exact amount — rational seconds plus a
 * whole number of frames — and converted to a frame index ONCE: frame = T.nearestFrameIndex(T.rt(num, den), rate) (ties up)
 * plus the frames said as frames. The stored time is T.frameTime(frame, rate). Sums are added as rationals before that one
 * rounding; nothing here goes through a float, and the lint test (time.test.ts) keeps the float helpers out of this file.
 *
 * Read here: timecodes (m:ss, h:mm:ss, hh:mm:ss:ff), units (frame, second, minute, hour; a unit alone is one of it), a unit
 * plus a fraction («שנייה וחצי»), compounds («דקה ו־10 שניות», «שנייה ו־12 פריימים»), a bare number after a unit and ו as the
 * next smaller unit («דקה ועשר» = 70 s; lead decision 3), the duals («דקותיים», «שעתיים»), and the ordinal position form
 * «בשנייה 3» (= 0:03; lead decision 2). «בשנייה השלישית» is ambiguous (0:02 or 0:03) and «חצי פריים» is refused.
 * Positions (כאן, בהתחלה, בסוף, ± from here) and durations (למשך) are the matcher's (match.ts): they need the context.
 */
import * as T from '@pulseframe/time';
import { BAR_NUMBER_MAX, type BarExact, type BarTime, type BarToken, type ParseTime } from '../commandBarContract.ts';
import { ex, exAdd, exCmp, exIsInt, exMul, fractionTail, readNumber } from './numbers.ts';
import { dict } from './dict.ts';

export type TimeUnit = 'frame' | 'second' | 'minute' | 'hour';
/** Unit words, as the tokenizer leaves them (unit tokens are already canonical: s, f, min). Every form listed. */
export const UNIT_FORMS: Readonly<Record<string, TimeUnit>> = dict({
  'פריים': 'frame', 'פריימים': 'frame', frame: 'frame', frames: 'frame', f: 'frame',
  'שנייה': 'second', 'שניה': 'second', 'שניות': 'second', s: 'second', second: 'second', seconds: 'second',
  'דקה': 'minute', 'דקות': 'minute', min: 'minute', minute: 'minute', minutes: 'minute',
  'שעה': 'hour', 'שעות': 'hour', hour: 'hour', hours: 'hour',
});
/** The singular forms, which take the ordinal position form «בשנייה 3». */
export const SINGULAR_UNITS: ReadonlySet<string> = new Set(['פריים', 'שנייה', 'שניה', 'דקה', 'שעה', 'frame', 'second', 'minute', 'hour', 's', 'f', 'min']);
/** Duals: two of the unit in one word. */
export const DUAL_FORMS: Readonly<Record<string, TimeUnit>> = dict({ 'דקותיים': 'minute', 'שעתיים': 'hour' });
/** Ordinal words (masculine and feminine) for «בשנייה השלישית». */
export const ORDINALS: Readonly<Record<string, number>> = dict({
  'ראשון': 1, 'ראשונה': 1, 'שני': 2, 'שנייה': 2, 'שניה': 2, 'שלישי': 3, 'שלישית': 3, 'רביעי': 4, 'רביעית': 4, 'חמישי': 5, 'חמישית': 5,
  'שישי': 6, 'שישית': 6, 'שביעי': 7, 'שביעית': 7, 'שמיני': 8, 'שמינית': 8, 'תשיעי': 9, 'תשיעית': 9, 'עשירי': 10, 'עשירית': 10,
});
export const timeWords = (): string[] => [...Object.keys(UNIT_FORMS), ...Object.keys(DUAL_FORMS), ...Object.keys(ORDINALS)];

/** An exact amount of time: rational seconds plus frames (frames must come out whole). */
export interface TimeAmount { secs: BarExact; frames: BarExact }
const ZERO_AMOUNT: TimeAmount = { secs: ex(0n), frames: ex(0n) };
const UNIT_AMOUNT: Record<TimeUnit, TimeAmount> = {
  frame: { secs: ex(0n), frames: ex(1n) }, second: { secs: ex(1n), frames: ex(0n) }, minute: { secs: ex(60n), frames: ex(0n) }, hour: { secs: ex(3600n), frames: ex(0n) },
};
const SMALLER: Partial<Record<TimeUnit, TimeUnit>> = { hour: 'minute', minute: 'second' };
export const amountAdd = (a: TimeAmount, b: TimeAmount): TimeAmount => ({ secs: exAdd(a.secs, b.secs), frames: exAdd(a.frames, b.frames) });
export const amountScale = (a: TimeAmount, k: BarExact): TimeAmount => ({ secs: exMul(a.secs, k), frames: exMul(a.frames, k) });

export interface AmountRead {
  amount: TimeAmount;
  /** The first token after the phrase. */
  end: number;
  /** count: «3 שניות», «שנייה וחצי»; ordinal: «בשנייה 3»; timecode: «1:10». */
  form: 'count' | 'ordinal' | 'timecode';
  /** The first token's proclitics other than a leading ו (ב, ל, מ …). */
  prefixes: string[];
  /** The phrase was joined by ו to what came before. */
  conj: boolean;
  saidSeconds: boolean;
  saidFrames: boolean;
  /** «בשנייה השלישית», «1,5 שניות»: the readings the words allow; the time is ambiguous. */
  alternatives?: TimeAmount[];
  /** Refused as said: half a frame, or out of range. */
  refused?: 'half_frame' | 'out_of_range';
}

const unitOf = (t: BarToken | undefined): TimeUnit | undefined => (t && (t.kind === 'word' || t.kind === 'unit') ? UNIT_FORMS[t.norm] : undefined);
const split = (t: BarToken) => ({ conj: t.prefixes[0] === 'ו', prefixes: t.prefixes.filter((p, k) => !(k === 0 && p === 'ו')) });
const plain = (t: BarToken | undefined) => !!t && t.prefixes.length === 0;

/** hh:mm:ss:ff, h:mm:ss, m:ss → an amount; fields past the first must be < 60 (and ff < the nominal rate, checked at conversion). */
function timecode(t: BarToken): TimeAmount | 'out_of_range' {
  const f = t.norm.split(':').map((x) => BigInt(x));
  if (f.slice(1, f.length === 4 ? 3 : undefined).some((x) => x >= 60n)) return 'out_of_range';
  if (f.length === 2) return { secs: ex(f[0]! * 60n + f[1]!), frames: ex(0n) };
  if (f.length === 3) return { secs: ex(f[0]! * 3600n + f[1]! * 60n + f[2]!), frames: ex(0n) };
  return { secs: ex(f[0]! * 3600n + f[1]! * 60n + f[2]!), frames: ex(f[3]!), };
}

interface Term { amount: TimeAmount; unit: TimeUnit; end: number }
/** [number] [a] unit [אחת] [fraction tail] at i; the number, when there is one, starts the term. */
function termAt(tokens: BarToken[], i: number, first: boolean): Term | 'ambiguous' | null {
  const t = tokens[i];
  if (!t) return null;
  const n = readNumber(tokens, i);
  let j = n ? n.end : i;
  if (n && (tokens[j]?.norm === 'a' || tokens[j]?.norm === 'an') && plain(tokens[j])) j++;
  const ut = tokens[j];
  const unit = unitOf(ut);
  if (!unit || !ut) {
    const dual = !n && t.kind === 'word' && DUAL_FORMS[t.norm];
    if (dual && !t.prefixes.includes('ה')) return { amount: amountScale(UNIT_AMOUNT[dual], ex(2n)), unit: dual, end: i + 1 };
    return null;
  }
  if (n && !plain(ut)) return null;
  // a unit alone is one of it — but not with the article (הפריים is the frame, an object)
  if (!n && ut.prefixes.includes('ה')) return null;
  if (!n && !first && !ut.prefixes.length) return null;
  if (n?.alternatives) return 'ambiguous';
  let amount = amountScale(UNIT_AMOUNT[unit], n ? n.value : ex(1n));
  let end = j + 1;
  if (!n && (tokens[end]?.norm === 'אחת' || tokens[end]?.norm === 'אחד' || tokens[end]?.norm === 'one') && plain(tokens[end])) end++; // «שנייה אחת»
  const tail = fractionTail(tokens, end);
  if (tail) { amount = amountAdd(amount, amountScale(UNIT_AMOUNT[unit], tail.value)); end = tail.end; }
  return { amount, unit, end };
}

/** The exact amount of a time phrase at token i, with its form; null when there is none. Positions and durations: match.ts. */
export function readAmount(tokens: BarToken[], i: number): AmountRead | null {
  const t = tokens[i];
  if (!t) return null;
  const { conj, prefixes } = split(t);
  const base = { prefixes, conj };
  if (t.kind === 'timecode') {
    const a = timecode(t);
    if (a === 'out_of_range') return { ...base, amount: ZERO_AMOUNT, end: i + 1, form: 'timecode', saidSeconds: true, saidFrames: false, refused: 'out_of_range' };
    return { ...base, amount: a, end: i + 1, form: 'timecode', saidSeconds: true, saidFrames: t.norm.split(':').length === 4 };
  }
  // the ordinal position form: a singular unit, then a plain number («בשנייה 3») or an ordinal word («בשנייה השלישית»)
  const u = unitOf(t);
  if (u && SINGULAR_UNITS.has(t.norm) && !t.prefixes.includes('ה')) {
    const nx = tokens[i + 1];
    if (nx && plain(nx) && !['אחת', 'אחד', 'one'].includes(nx.norm)) {
      const n = readNumber(tokens, i + 1);
      if (n && !n.conj) {
        const saidFrames = u === 'frame';
        if (n.alternatives) return { ...base, amount: ZERO_AMOUNT, end: n.end, form: 'ordinal', saidSeconds: !saidFrames, saidFrames, alternatives: n.alternatives.map((v) => amountScale(UNIT_AMOUNT[u], v)) };
        return finish({ ...base, amount: amountScale(UNIT_AMOUNT[u], n.value), end: n.end, form: 'ordinal', saidSeconds: !saidFrames, saidFrames });
      }
    }
    if (nx && nx.kind === 'word' && nx.prefixes.length === 1 && nx.prefixes[0] === 'ה' && ORDINALS[nx.norm] !== undefined) {
      const k = BigInt(ORDINALS[nx.norm]!);
      // the start of the k-th unit, or the k-unit mark: asked, never chosen
      return { ...base, amount: ZERO_AMOUNT, end: i + 2, form: 'ordinal', saidSeconds: u !== 'frame', saidFrames: u === 'frame', alternatives: [amountScale(UNIT_AMOUNT[u], ex(k - 1n)), amountScale(UNIT_AMOUNT[u], ex(k))] };
    }
  }
  // the count form: term (ו term | ו bare number)*
  const first = termAt(tokens, i, true);
  if (first === 'ambiguous') return { ...base, amount: ZERO_AMOUNT, end: i + 2, form: 'count', saidSeconds: true, saidFrames: false, alternatives: commaAlternatives(tokens, i) };
  if (!first) return null;
  let amount = first.amount, end = first.end, unit = first.unit;
  let saidSeconds = unit !== 'frame', saidFrames = unit === 'frame';
  for (;;) {
    const c = tokens[end];
    if (!c) break;
    const english = c.kind === 'word' && c.norm === 'and' && plain(c);
    const at = english ? end + 1 : end;
    const ct = tokens[at];
    if (!ct || (!english && ct.prefixes[0] !== 'ו')) break;
    if (!english && ct.prefixes.length !== 1) break;
    const next = termAt(tokens, at, false);
    if (next === 'ambiguous') return { ...base, amount: ZERO_AMOUNT, end: at + 2, form: 'count', saidSeconds, saidFrames, alternatives: [] };
    if (next) {
      amount = amountAdd(amount, next.amount); end = next.end; unit = next.unit;
      if (next.unit === 'frame') saidFrames = true; else saidSeconds = true;
      continue;
    }
    // «דקה ועשר»: a bare number after a unit and ו is the next smaller unit (hours → minutes, minutes → seconds)
    const n = readNumber(tokens, at);
    const smaller = SMALLER[unit];
    if (n && !n.alternatives && smaller && !unitOf(tokens[n.end]) && exIsInt(n.value)) {
      amount = amountAdd(amount, amountScale(UNIT_AMOUNT[smaller], n.value)); end = n.end; unit = smaller; saidSeconds = true;
      continue;
    }
    break;
  }
  return finish({ ...base, amount, end, form: 'count', saidSeconds, saidFrames });
}

/** «1,5 שניות»: the comma readings of the number, each times the unit. */
function commaAlternatives(tokens: BarToken[], i: number): TimeAmount[] {
  const n = readNumber(tokens, i);
  const unit = n ? unitOf(tokens[n.end]) : undefined;
  return n?.alternatives && unit ? n.alternatives.map((v) => amountScale(UNIT_AMOUNT[unit], v)) : [];
}

const MAX = ex(BigInt(BAR_NUMBER_MAX));
function finish(r: AmountRead): AmountRead {
  const { secs, frames } = r.amount;
  if (secs.num < 0n || frames.num < 0n || exCmp(secs, MAX) > 0 || exCmp(frames, MAX) > 0) return { ...r, refused: 'out_of_range' };
  if (!exIsInt(frames)) return { ...r, refused: 'half_frame' }; // «חצי פריים»: a frame is the smallest unit
  return r;
}

/**
 * The ONE conversion of an amount to a frame index at `rate` (plan §4.3): seconds → T.nearestFrameIndex(T.rt(num, den)),
 * ties up, plus the whole frames said. `rounded` says the seconds were not a whole frame. A timecode's frame field must be
 * below the nominal rate (as toTimecode writes it), else null.
 */
export function toBarTime(a: TimeAmount, rate: T.Rate, saidSeconds: boolean, saidFrames: boolean): BarTime | null {
  if (!exIsInt(a.frames)) return null;
  const den = a.secs.den;
  if (den > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const secs = T.rt(a.secs.num, Number(den));
  const fromSecs = T.nearestFrameIndex(secs, rate);
  const frames = Number(a.frames.num);
  return { seconds: saidSeconds ? a.secs : null, frames: saidFrames ? frames : null, frame: fromSecs + frames, rounded: !T.isFrameAligned(secs, rate) };
}
/** The nominal frame base of a rate (30000/1001 → 30), for a timecode's frame field. */
export const nominalBase = (rate: T.Rate): number => Math.ceil(rate.num / rate.den);

/** The contract's parseTime (commandBarContract.ts ParseTime): a time phrase at `at` converted once at `rate`. */
export const parseTime: ParseTime = (tokens, at, rate) => {
  const r = readAmount(tokens, at);
  if (!r) return null;
  if (r.alternatives) return { ambiguous: true, end: r.end };
  if (r.refused) return { refused: r.refused, end: r.end };
  if (r.form === 'timecode' && r.saidFrames && exCmp(r.amount.frames, ex(BigInt(nominalBase(rate)))) >= 0) return { refused: 'out_of_range', end: r.end };
  const time = toBarTime(r.amount, rate, r.saidSeconds, r.saidFrames);
  return time ? { time, end: r.end } : { refused: 'out_of_range', end: r.end };
};
