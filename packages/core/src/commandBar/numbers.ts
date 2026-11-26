/**
 * Exact numbers of the command bar (ADR-0027, plan §4.2): Hebrew and English number words and digits → a reduced bigint
 * rational. Nothing here is a float: digits are read from their decimal string, words from the tables below.
 *
 * Hebrew: masculine, feminine and construct cardinals, the teens in both genders, the tens joined by ו («עשרים וחמש»), מאה,
 * מאתיים and the hundreds, אלף/אלפיים/…אלפים; fractions חצי, רבע, שליש, «שני שלישים», «שלושה רבעים / שלושת רבעי», and added
 * after a whole with ו («וחצי», «ורבע», «ושליש»). English: one … nineteen, the tens, hundred, thousand, half, quarter, third,
 * "and a half". Signs: מינוס / פחות / minus / - / +. «1,5» is ambiguous (a decimal comma or a thousands comma) and asks.
 */
import { BAR_NUMBER_MAX, type BarExact, type BarToken, type ParseNumber } from '../commandBarContract.ts';
import { dict } from './dict.ts';

// ---------- exact arithmetic ----------
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
/** A reduced rational with den > 0. */
export function ex(num: bigint, den: bigint = 1n): BarExact {
  if (den === 0n) throw new RangeError('zero denominator');
  if (den < 0n) { num = -num; den = -den; }
  const g = gcd(num, den) || 1n;
  return { num: num / g, den: den / g };
}
export const exAdd = (a: BarExact, b: BarExact) => ex(a.num * b.den + b.num * a.den, a.den * b.den);
export const exMul = (a: BarExact, b: BarExact) => ex(a.num * b.num, a.den * b.den);
export const exDiv = (a: BarExact, b: BarExact) => ex(a.num * b.den, a.den * b.num);
export const exNeg = (a: BarExact) => ex(-a.num, a.den);
export const exIsInt = (a: BarExact) => a.den === 1n;
export const exCmp = (a: BarExact, b: BarExact) => { const l = a.num * b.den, r = b.num * a.den; return l < r ? -1 : l > r ? 1 : 0; };
/** Exact decimal text when the value has a terminating expansion of at most 6 places, else "num/den". */
export function exText(a: BarExact): string {
  if (a.den === 1n) return a.num.toString();
  for (let k = 1; k <= 6; k++) {
    const scale = 10n ** BigInt(k);
    if ((a.num * scale) % a.den === 0n) {
      const v = (a.num * scale) / a.den;
      const neg = v < 0n, abs = neg ? -v : v;
      const s = abs.toString().padStart(k + 1, '0');
      return `${neg ? '-' : ''}${s.slice(0, -k)}.${s.slice(-k)}`;
    }
  }
  return `${a.num}/${a.den}`;
}
/** Digits as written (up to 6 decimals) → exact; null for anything else. */
export function exFromDecimal(s: string): BarExact | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  return ex(BigInt(`${m[1]}${frac}`), 10n ** BigInt(frac.length));
}

// ---------- the word tables (every form listed) ----------
/** 1–9: feminine, masculine and construct forms, with the common spellings. */
export const HE_UNITS: Readonly<Record<string, number>> = dict({
  'אחת': 1, 'אחד': 1,
  'שתיים': 2, 'שתים': 2, 'שניים': 2, 'שנים': 2, 'שתי': 2, 'שני': 2,
  'שלוש': 3, 'שלש': 3, 'שלושה': 3, 'שלשה': 3, 'שלושת': 3, 'שלשת': 3,
  'ארבע': 4, 'ארבעה': 4, 'ארבעת': 4,
  'חמש': 5, 'חמישה': 5, 'חמשה': 5, 'חמשת': 5,
  'שש': 6, 'שישה': 6, 'ששה': 6, 'ששת': 6,
  'שבע': 7, 'שבעה': 7, 'שבעת': 7,
  'שמונה': 8, 'שמונת': 8,
  'תשע': 9, 'תשעה': 9, 'תשעת': 9,
});
/** 10 alone. */
export const HE_TEN: Readonly<Record<string, number>> = dict({ 'עשר': 10, 'עשרה': 10, 'עשרת': 10 });
/** The teens, two words each, both genders (11–19). The second word is עשרה (feminine) or עשר (masculine). */
export const HE_TEENS: Readonly<Record<string, number>> = dict({
  'אחת עשרה': 11, 'אחד עשר': 11, 'שתים עשרה': 12, 'שתיים עשרה': 12, 'שנים עשר': 12, 'שניים עשר': 12, 'שלוש עשרה': 13, 'שלושה עשר': 13,
  'ארבע עשרה': 14, 'ארבעה עשר': 14, 'חמש עשרה': 15, 'חמישה עשר': 15, 'חמשה עשר': 15, 'שש עשרה': 16, 'שישה עשר': 16, 'ששה עשר': 16,
  'שבע עשרה': 17, 'שבעה עשר': 17, 'שמונה עשרה': 18, 'שמונה עשר': 18, 'תשע עשרה': 19, 'תשעה עשר': 19,
});
export const HE_TENS: Readonly<Record<string, number>> = dict({ 'עשרים': 20, 'שלושים': 30, 'שלשים': 30, 'ארבעים': 40, 'חמישים': 50, 'חמשים': 50, 'שישים': 60, 'ששים': 60, 'שבעים': 70, 'שמונים': 80, 'תשעים': 90 });
export const HE_HUNDREDS: Readonly<Record<string, number>> = dict({
  'מאה': 100, 'מאתיים': 200, 'שלוש מאות': 300, 'ארבע מאות': 400, 'חמש מאות': 500, 'שש מאות': 600, 'שבע מאות': 700, 'שמונה מאות': 800, 'תשע מאות': 900,
});
export const HE_THOUSANDS: Readonly<Record<string, number>> = dict({
  'אלף': 1000, 'אלפיים': 2000, 'שלושת אלפים': 3000, 'ארבעת אלפים': 4000, 'חמשת אלפים': 5000, 'ששת אלפים': 6000, 'שבעת אלפים': 7000, 'שמונת אלפים': 8000, 'תשעת אלפים': 9000,
  'מיליון': 1_000_000,
});
export const EN_UNITS: Readonly<Record<string, number>> = dict({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
});
export const EN_TENS: Readonly<Record<string, number>> = dict({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 });
/** Fractions said alone or after a whole («וחצי»); the plural forms only after a count («שני שלישים», «שלושה רבעים»). */
export const FRACTIONS: Readonly<Record<string, BarExact>> = dict({ 'חצי': ex(1n, 2n), 'רבע': ex(1n, 4n), 'שליש': ex(1n, 3n), half: ex(1n, 2n), quarter: ex(1n, 4n), third: ex(1n, 3n) });
export const FRACTION_PLURALS: Readonly<Record<string, bigint>> = dict({ 'רבעים': 4n, 'רבעי': 4n, 'שלישים': 3n, 'שלישי': 3n, quarters: 4n, thirds: 3n });
export const SIGN_WORDS: Readonly<Record<string, -1 | 1>> = dict({ 'מינוס': -1, 'פחות': -1, minus: -1, '-': -1, '+': 1, 'פלוס': 1, plus: 1 });
/** English helpers inside a number ("a hundred", "and a half"). */
const EN_HUNDRED = 'hundred', EN_THOUSAND = 'thousand', EN_MILLION = 'million';

/** Every word a number can be made of (for the tokenizer's proclitic rule). */
export function numberWords(): string[] {
  const out = new Set<string>([...Object.keys(HE_UNITS), ...Object.keys(HE_TEN), ...Object.keys(HE_TENS), ...Object.keys(EN_UNITS), ...Object.keys(EN_TENS), ...Object.keys(FRACTIONS), ...Object.keys(FRACTION_PLURALS), ...Object.keys(SIGN_WORDS), EN_HUNDRED, EN_THOUSAND, EN_MILLION, 'and', 'a', 'an']);
  for (const k of [...Object.keys(HE_TEENS), ...Object.keys(HE_HUNDREDS), ...Object.keys(HE_THOUSANDS)]) for (const w of k.split(' ')) out.add(w);
  return [...out];
}

// ---------- reading ----------
export interface NumberRead {
  value: BarExact;
  /** The first token after the number. */
  end: number;
  /** The first token's proclitics other than ו (ב, ל …), e.g. «ב־3». */
  prefixes: string[];
  /** The first token was joined by ו («ועשר», «ו־10»). */
  conj: boolean;
  /** «1,5»: the readings a comma allows; the number is ambiguous. */
  alternatives?: BarExact[];
}

const w = (t: BarToken | undefined) => (t && t.kind === 'word' ? t.norm : undefined);
/** A token joined to the previous one by ו (its prefixes start with ו) — only such tokens and plain ones continue a number. */
const conjOf = (t: BarToken | undefined) => !!t && t.prefixes[0] === 'ו';
const plainOrConj = (t: BarToken | undefined) => !!t && (t.prefixes.length === 0 || (t.prefixes.length === 1 && t.prefixes[0] === 'ו'));
/** Look up a phrase of 1–2 tokens in a two-word table; the second word must be plain (no proclitic). */
function two(tokens: BarToken[], i: number, table: Readonly<Record<string, number>>): number | undefined {
  const a = w(tokens[i]), b = w(tokens[i + 1]);
  if (a && b && tokens[i + 1]!.prefixes.length === 0) return table[`${a} ${b}`];
  return undefined;
}

interface Term { value: number; mag: number; end: number }
/** One term of a whole number at i (ignoring the token's prefixes, which the caller checked). */
function termAt(tokens: BarToken[], i: number): Term | null {
  const a = w(tokens[i]);
  if (a === undefined) return null;
  let v = two(tokens, i, HE_THOUSANDS); if (v !== undefined) return { value: v, mag: 1000, end: i + 2 };
  v = HE_THOUSANDS[a]; if (v !== undefined) return { value: v, mag: v >= 1_000_000 ? 1_000_000 : 1000, end: i + 1 };
  v = two(tokens, i, HE_HUNDREDS); if (v !== undefined) return { value: v, mag: 100, end: i + 2 };
  v = HE_HUNDREDS[a]; if (v !== undefined) return { value: v, mag: 100, end: i + 1 };
  v = two(tokens, i, HE_TEENS); if (v !== undefined) return { value: v, mag: 1, end: i + 2 };
  v = HE_TENS[a] ?? EN_TENS[a]; if (v !== undefined) return { value: v, mag: 10, end: i + 1 };
  v = HE_TEN[a]; if (v !== undefined) return { value: v, mag: 1, end: i + 1 };
  v = HE_UNITS[a] ?? EN_UNITS[a];
  if (v !== undefined) {
    // English "two hundred"
    if (EN_UNITS[a] !== undefined && w(tokens[i + 1]) === EN_HUNDRED) return { value: v * 100, mag: 100, end: i + 2 };
    return { value: v, mag: 1, end: i + 1 };
  }
  if ((a === 'a' || a === 'an') && w(tokens[i + 1]) === EN_HUNDRED) return { value: 100, mag: 100, end: i + 2 };
  if (a === EN_HUNDRED) return { value: 100, mag: 100, end: i + 1 };
  return null;
}

/** A fraction phrase at i: «חצי», "a half", "a quarter". */
function fractionAt(tokens: BarToken[], i: number): { value: BarExact; end: number } | null {
  let j = i;
  if (w(tokens[j]) === 'a' || w(tokens[j]) === 'an') j++;
  const f = w(tokens[j]);
  if (f !== undefined && FRACTIONS[f] && (j === i || tokens[j]!.prefixes.length === 0)) return { value: FRACTIONS[f]!, end: j + 1 };
  return null;
}

/** A whole number (words or digits) at i, without the fraction tail. */
function wholeAt(tokens: BarToken[], i: number): { value: BarExact; end: number; alternatives?: BarExact[] } | null {
  const t = tokens[i];
  if (!t) return null;
  if (t.kind === 'number') {
    if (t.norm.includes(',')) {
      // «1,5»: a decimal comma (1.5) or, with groups of three, a thousands comma (1,500) — never chosen here
      const parts = t.norm.split(',');
      const alts: BarExact[] = [];
      if (parts.length === 2 && parts[1]!.length <= 6) alts.push(exFromDecimal(`${parts[0]}.${parts[1]}`)!);
      if (parts.slice(1).every((p) => p.length === 3)) alts.push(ex(BigInt(parts.join(''))));
      return { value: alts[0] ?? ex(0n), end: i + 1, alternatives: alts };
    }
    const v = exFromDecimal(t.norm);
    return v ? { value: v, end: i + 1 } : null;
  }
  let total = 0, lastMag = Infinity, j = i, any = false;
  for (;;) {
    const tok = tokens[j];
    if (!tok) break;
    if (any && !plainOrConj(tok)) break;
    // English "and" between terms ("one hundred and twenty")
    if (any && w(tok) === 'and' && tok.prefixes.length === 0) {
      const nxt = termAt(tokens, j + 1);
      if (nxt && nxt.mag < lastMag) { j++; continue; }
      break;
    }
    // × 1000 after a group below a thousand ("עשרים אלף", "twenty thousand"); × 10^6 after a group ("two million")
    const m = w(tok);
    if (any && tok.prefixes.length === 0 && total < 1000 && lastMag < 1000 && (m === 'אלף' || m === 'אלפים' || m === EN_THOUSAND)) { total *= 1000; lastMag = 1000; j++; continue; }
    if (any && tok.prefixes.length === 0 && total < 1000 && lastMag < 1000 && (m === 'מיליון' || m === EN_MILLION)) { total *= 1_000_000; lastMag = 1_000_000; j++; continue; }
    const term = termAt(tokens, j);
    if (!term) break;
    if (any && term.mag >= lastMag) break;
    if (any && term.mag === 1 && lastMag === 10 && !conjOf(tok) && /[א-ת]/.test(tok.norm)) {
      // Hebrew joins the units to the tens with ו («עשרים וחמש»); «עשרים חמש» is not a number phrase
      break;
    }
    total += term.value; lastMag = term.mag; any = true; j = term.end;
    if (term.mag === 1 && !['אלף', 'אלפים', EN_THOUSAND, 'מיליון', EN_MILLION].includes(w(tokens[j]) ?? '')) break;
  }
  if (!any) return null;
  return { value: ex(BigInt(total)), end: j };
}

/**
 * The number at token i: [sign] (whole [fraction tail] | fraction | count fraction-plural). Its first token may carry ו and
 * other proclitics (reported); the following tokens may carry only ו. Null when there is no number here.
 */
export function readNumber(tokens: BarToken[], i: number): NumberRead | null {
  const first = tokens[i];
  if (!first) return null;
  const conj = first.prefixes[0] === 'ו';
  const prefixes = first.prefixes.filter((p, k) => !(k === 0 && p === 'ו'));
  let j = i, sign: 1 | -1 = 1;
  const s = w(first);
  if (s !== undefined && SIGN_WORDS[s] && tokens[i + 1] && (tokens[i + 1]!.kind === 'number' || termAt(tokens, i + 1) || fractionAt(tokens, i + 1))) { sign = SIGN_WORDS[s]!; j = i + 1; }
  const out = (value: BarExact, end: number, alternatives?: BarExact[]): NumberRead => ({ value: sign < 0 ? exNeg(value) : value, end, prefixes, conj, ...(alternatives ? { alternatives: alternatives.map((a) => (sign < 0 ? exNeg(a) : a)) } : {}) });
  // a fraction alone: «חצי», «רבע», "a half"
  const fr = fractionAt(tokens, j);
  if (fr) return out(fr.value, fr.end);
  const whole = wholeAt(tokens, j);
  if (!whole) return null;
  if (whole.alternatives) return out(whole.value, whole.end, whole.alternatives);
  let value = whole.value, end = whole.end;
  const nx = tokens[end];
  // count + fraction plural: «שני שלישים», «שלושה רבעים», «שלושת רבעי», "two thirds"
  const pl = w(nx) !== undefined && nx!.prefixes.length === 0 ? FRACTION_PLURALS[w(nx)!] : undefined;
  if (pl) return out(ex(value.num, value.den * pl), end + 1);
  // the fraction tail: «וחצי», «ורבע», «ושליש», «ושלושה רבעים», "and a half"
  const tail = fractionTail(tokens, end);
  if (tail) { value = exAdd(value, tail.value); end = tail.end; }
  return out(value, end);
}

/** «וחצי», «ורבע», «ושליש», «ושלושה רבעים», «ושני שלישים», "and a half", "and a quarter" at i. */
export function fractionTail(tokens: BarToken[], i: number): { value: BarExact; end: number } | null {
  const t = tokens[i];
  if (!t) return null;
  if (t.kind === 'word' && t.norm === 'and' && t.prefixes.length === 0) {
    const f = fractionAt(tokens, i + 1);
    return f ? { value: f.value, end: f.end } : null;
  }
  if (!conjOf(t) || t.prefixes.length !== 1) return null;
  const f = w(t) !== undefined ? FRACTIONS[w(t)!] : undefined;
  if (f) return { value: f, end: i + 1 };
  const u = w(t) !== undefined ? HE_UNITS[w(t)!] : undefined;
  const pl = w(tokens[i + 1]) !== undefined && tokens[i + 1]!.prefixes.length === 0 ? FRACTION_PLURALS[w(tokens[i + 1])!] : undefined;
  if (u && pl && BigInt(u) < pl) return { value: ex(BigInt(u), pl), end: i + 2 };
  return null;
}

/** True when |value| is within the bar's range (plan §4.2: 0 ≤ |value| ≤ 10^6). */
export const inNumberRange = (v: BarExact) => exCmp(v.num < 0n ? exNeg(v) : v, ex(BigInt(BAR_NUMBER_MAX))) <= 0;

/** The contract's parseNumber (commandBarContract.ts ParseNumber): the value, or ambiguous for «1,5», or null. */
export const parseNumber: ParseNumber = (tokens, at) => {
  const r = readNumber(tokens, at);
  if (!r) return null;
  if (r.alternatives) return { ambiguous: true, end: r.end };
  return { value: r.value, end: r.end };
};
