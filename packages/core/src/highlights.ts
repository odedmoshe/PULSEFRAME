/**
 * The shorts finder's ranking (ADR-0018, plan §4.3): candidate windows of one video, each with an explained RELATIVE score —
 * weighted percentiles of measured signals within this one video, labelled a heuristic (SHORTS_RANK_METHOD). Rules over the
 * statements, the fillers, the audio features and the scene cuts; no model. Nothing is reworded: quotes are transcript words.
 *
 * - Units: the statements when at least 80% of the speech (by statement duration) is word- or phrase-timed; otherwise, when
 *   the sound was measured, speech blocks between silences of the features (below −35 dBFS for at least 0.5 s) split at the
 *   scene cuts. A window starts where a unit starts (after a silence, for blocks) and ends where a unit ends a sentence (before
 *   a silence, for blocks), and lasts minSeconds..maxSeconds; at most 40 ends per start.
 * - A window that opens with a connective (statements.ts) gets up to contextSeconds of earlier statements prepended
 *   (context_added), or is flagged starts_with_reference when none fit.
 * - Components (SCORE_COMPONENTS) are percentiles 0..100 among all windows of this asset; the score is their weighted mean
 *   (SCORE_WEIGHTS; a missing input's weight is dropped and the rest rescaled, with a missing_input note) minus SCORE_PENALTIES
 *   for approximate or phrase-only timing, rounded to a whole number.
 * - "moments" is the reaction-burst heuristic: at least 0.6 s of noise-like sound (flatness ≥ 0.5) at least 6 dB above the
 *   median speech level, where no word is spoken. It also fires on music, applause and crowd noise.
 * - include words add a topic_word reason; exclude words remove the window and list it in `excluded` (never dropped silently).
 *   Both are matched with fillers.ts bareWord, also after one Hebrew prefix letter.
 * - Selection is greedy by score with no overlap (at most 25% of the shorter window when allowOverlap).
 */
import * as T from '@pulseframe/time';
import { fingerprint } from './entities.ts';
import { bareWord } from './fillers.ts';
import type { ShortReason } from './schema.ts';
import {
  REVIEW_CONTEXT_SECONDS, SCORE_COMPONENTS, SCORE_PENALTIES, SCORE_WEIGHTS, SHORTS_RANK_METHOD, FEATURE_HOP, FEATURE_RATE,
  type CandidateWarning, type ExcludedWindow, type FindShortsBody, type HighlightInputs, type ScoreComponent, type ShortCandidate,
  type ShortCandidatesResult, type Statement,
} from './shortsContract.ts';
import { HEBREW_PREFIX_LETTERS, inWordSet } from './statements.ts';

/** A timed transcript word, so exclusions and quotes carry their exact time (the server passes the transcript's words). */
export interface HighlightWord { id: string; text: string; start: T.RationalTime; end: T.RationalTime; confidence: number | null }
/** The contract's inputs plus, optionally, the transcript's timed words. Without them a word's time is its statement's start. */
export interface HighlightInputsWithWords extends HighlightInputs { words?: readonly HighlightWord[] | null }

/** Thresholds of the ranking (fixed; part of SHORTS_RANK_METHOD version 1). */
export const HIGHLIGHT_RULES = {
  /** Share of the speech that must be word- or phrase-timed for statements to be the units. */
  statementShare: 0.8,
  silenceDb: -35, silenceMinSeconds: 0.5,
  reaction: { minSeconds: 0.6, flatness: 0.5, aboveMedianDb: 6 },
  maxEndsPerStart: 40,
  openingSeconds: 3,
  longPauseSeconds: 1.2,
  lowConfidence: 0.5,
  /** Overlap allowed with allowOverlap, as a share of the shorter window. */
  maxOverlap: 0.25,
  firstWords: 8,
} as const;
/** Words that make an opening catch the ear (compared with bareWord, also after one prefix letter). */
export const HOOK_WORDS = {
  he: ['סוד', 'טעות', 'טעויות', 'הכי', 'לעולם', 'תמיד', 'למה', 'איך', 'האמת', 'דמיינו', 'תדמיינו', 'הנה', 'אסור', 'חייבים', 'מפתיע', 'הסיבה', 'בעצם', 'שאלה'],
  en: ['secret', 'mistake', 'mistakes', 'never', 'always', 'why', 'how', 'truth', 'imagine', 'here', 'surprising', 'reason', 'best', 'worst', 'nobody', 'everyone', 'stop'],
} as const;
export const NUMBER_WORDS = {
  he: ['אחד', 'אחת', 'שניים', 'שתיים', 'שני', 'שתי', 'שלוש', 'שלושה', 'ארבע', 'ארבעה', 'חמש', 'חמישה', 'שש', 'שישה', 'שבע', 'שבעה', 'שמונה', 'תשע', 'תשעה', 'עשר', 'עשרה', 'מאה', 'אלף', 'מיליון', 'חצי'],
  en: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'hundred', 'thousand', 'million', 'half'],
} as const;
export const SECOND_PERSON_WORDS = {
  he: ['אתם', 'אתה', 'אתן', 'לכם', 'לך', 'שלכם', 'שלך', 'אתכם', 'אותך', 'אותכם', 'תחשבו', 'תנסו', 'שמתם', 'תראו', 'תסתכלו', 'דמיינו', 'תדמיינו'],
  en: ['you', 'your', 'yours', 'youre', 'yourself', 'yourselves'],
} as const;
const set = (l: { he: readonly string[]; en: readonly string[] }) => new Set([...l.he, ...l.en].map(bareWord));
const HOOKS = set(HOOK_WORDS), NUMBERS = set(NUMBER_WORDS), YOU = set(SECOND_PERSON_WORDS);

const HOP_RATE = { num: FEATURE_RATE / FEATURE_HOP, den: 1 }; // 10 hops per second
const hopAt = (t: T.RationalTime) => T.frameIndexAt(t, HOP_RATE);
const hopTime = (h: number) => T.frameTime(h, HOP_RATE);
const secs = T.toSeconds;
const r2 = (x: number) => Math.round(x * 100) / 100;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Midrank percentiles 0..100 (equal values share a rank; a single value is 50). Raising one value never lowers its percentile. */
export function percentiles(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 1) return [50];
  const idx = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]! || a - b);
  const out = new Array<number>(n);
  for (let k = 0; k < n;) {
    let m = k;
    while (m + 1 < n && values[idx[m + 1]!] === values[idx[k]!]) m++;
    for (let q = k; q <= m; q++) out[idx[q]!] = (100 * (k + m)) / 2 / (n - 1);
    k = m + 1;
  }
  return out;
}

/** A list term as bare tokens (a term may be several words). */
const termTokens = (term: string) => term.split(/\s+/u).map(bareWord).filter(Boolean);
/** Does the run of tokens starting at `i` match the term (its first word also after one prefix letter)? */
function matchesAt(bares: readonly string[], i: number, term: readonly string[]): boolean {
  if (!term.length || i + term.length > bares.length) return false;
  const w = bares[i]!, t0 = term[0]!;
  if (w !== t0 && !(w.length > 1 && (HEBREW_PREFIX_LETTERS as readonly string[]).includes(w[0]!) && w.slice(1) === t0)) return false;
  for (let k = 1; k < term.length; k++) if (bares[i + k] !== term[k]) return false;
  return true;
}

interface Tok { text: string; bare: string; at: T.RationalTime; end: T.RationalTime | null; confidence: number | null }
/** A unit of the ranking: a statement, or (without a transcript) a stretch of speech between silences. */
interface Unit {
  start: T.RationalTime; end: T.RationalTime;
  statement: Statement | null;
  toks: Tok[];
  canStart: boolean; canEnd: boolean;
  /** Seconds of long pauses inside the unit; the first one. */
  pauseSeconds: number; firstPause: T.RationalTime | null;
  lowConf: number; level: number | null;
}
interface Occurrence { unit: number; tok: number; at: T.RationalTime; text: string }
/** One window with its raw measurements and components (exported for the tests and the proof). */
export interface ScoredWindow {
  first: number; anchor: number; last: number;
  start: T.RationalTime; end: T.RationalTime;
  contextAdded: number | null; reference: boolean;
  raw: Record<ScoreComponent, number | null>;
  components: Record<ScoreComponent, number | null>;
  penalty: number; score: number;
  timing: { approximate: boolean; segment: boolean };
}
export interface ScoredWindows { mode: 'statements' | 'speech_blocks' | 'none'; windows: ScoredWindow[]; units: number; missing: ScoreComponent[]; basis: string[] }

/** Everything the ranking measures, before selection. */
function measure(inp: HighlightInputsWithWords) {
  const R = HIGHLIGHT_RULES;
  const f = inp.features;
  const hopsN = f ? f.hops : 0;
  const speechHops: number[] = [];
  if (f) for (let h = 0; h < hopsN; h++) if (f.rmsDb[h]! >= R.silenceDb) speechHops.push(f.rmsDb[h]!);
  const assetLevel = median(speechHops);
  const levelOf = (a: T.RationalTime, b: T.RationalTime) => {
    if (!f) return null;
    const xs: number[] = [];
    for (let h = Math.max(0, hopAt(a)); h < Math.min(hopsN, hopAt(b)); h++) if (f.rmsDb[h]! >= R.silenceDb) xs.push(f.rmsDb[h]!);
    return median(xs);
  };
  const words = new Map((inp.words ?? []).map((w) => [w.id, w]));
  const statements = [...(inp.statements ?? [])].sort((a, b) => T.cmp(a.start, b.start));
  const speech = statements.reduce((n, s) => n + secs(T.sub(s.end, s.start)), 0);
  const timedShare = speech > 0 ? statements.filter((s) => s.timing !== 'approximate').reduce((n, s) => n + secs(T.sub(s.end, s.start)), 0) / speech : 0;
  const mode: ScoredWindows['mode'] = statements.length && (timedShare >= R.statementShare || !f) ? 'statements' : f ? 'speech_blocks' : 'none';
  const units: Unit[] = [];
  // silences of the features: runs of hops below silenceDb lasting at least silenceMinSeconds
  const silences: [number, number][] = [];
  if (f) {
    const minHops = Math.round(R.silenceMinSeconds * HOP_RATE.num);
    for (let h = 0; h < hopsN;) {
      if (f.rmsDb[h]! >= R.silenceDb) { h++; continue; }
      let e = h;
      while (e < hopsN && f.rmsDb[e]! < R.silenceDb) e++;
      if (e - h >= minHops) silences.push([h, e]);
      h = e;
    }
  }
  if (mode === 'statements') {
    for (const s of statements) {
      const ws = s.timing === 'word' ? s.wordIds.map((id) => words.get(id)).filter((w): w is HighlightWord => !!w) : [];
      const toks: Tok[] = ws.length === s.wordIds.length && ws.length
        ? ws.map((w) => ({ text: w.text, bare: bareWord(w.text), at: w.start, end: w.end, confidence: w.confidence }))
        : s.text.split(/\s+/u).filter(Boolean).map((text) => ({ text, bare: bareWord(text), at: s.start, end: null, confidence: null }));
      let pauseSeconds = 0, firstPause: T.RationalTime | null = null;
      for (let i = 0; i + 1 < toks.length; i++) {
        const a = toks[i]!.end, b = toks[i + 1]!.at;
        if (a && secs(T.sub(b, a)) >= R.longPauseSeconds) { pauseSeconds += secs(T.sub(b, a)); firstPause ??= a; }
      }
      units.push({ start: s.start, end: s.end, statement: s, toks, canStart: true, canEnd: s.endsSentence, pauseSeconds, firstPause, lowConf: toks.filter((t) => t.confidence !== null && t.confidence < R.lowConfidence).length, level: levelOf(s.start, s.end) });
    }
  } else if (mode === 'speech_blocks') {
    const cuts = (inp.sceneCuts ?? []).map(hopAt);
    let from = 0;
    const blocks: [number, number][] = [];
    for (const [a, b] of silences) { if (a > from) blocks.push([from, a]); from = b; }
    if (from < hopsN) blocks.push([from, hopsN]);
    for (const [a, b] of blocks) {
      const inner = cuts.filter((c) => c > a && c < b);
      const edges = [a, ...inner, b];
      for (let k = 0; k + 1 < edges.length; k++) {
        const s = hopTime(edges[k]!), e = hopTime(edges[k + 1]!);
        units.push({ start: s, end: e, statement: null, toks: [], canStart: k === 0, canEnd: k + 2 === edges.length, pauseSeconds: 0, firstPause: null, lowConf: 0, level: levelOf(s, e) });
      }
    }
  }
  // long pauses between units (statements) or silences inside a window (blocks): the gap after unit i
  const gapAfter = units.map((u, i) => { const n = units[i + 1]; if (!n) return 0; const g = secs(T.sub(n.start, u.end)); return g >= R.longPauseSeconds ? g : 0; });
  // reaction bursts: hops where nobody speaks, noise-like and loud
  const burst = new Uint8Array(hopsN);
  const bursts: [number, number][] = [];
  if (f && assetLevel !== null) {
    const spoken = new Uint8Array(hopsN);
    const cover = (a: T.RationalTime, b: T.RationalTime) => { for (let h = Math.max(0, hopAt(a)); h < Math.min(hopsN, hopAt(b) + 1); h++) spoken[h] = 1; };
    for (const u of units) if (u.statement) { if (u.toks.every((t) => t.end)) for (const t of u.toks) cover(t.at, t.end!); else cover(u.start, u.end); }
    const minHops = Math.round(R.reaction.minSeconds * HOP_RATE.num);
    for (let h = 0; h < hopsN;) {
      const ok = (k: number) => !spoken[k] && f.flatness[k]! >= R.reaction.flatness && f.rmsDb[k]! >= assetLevel + R.reaction.aboveMedianDb;
      if (!ok(h)) { h++; continue; }
      let e = h;
      while (e < hopsN && ok(e)) e++;
      if (e - h >= minHops) { bursts.push([h, e]); for (let k = h; k < e; k++) burst[k] = 1; }
      h = e;
    }
  }
  const burstPrefix = new Float64Array(hopsN + 1);
  for (let h = 0; h < hopsN; h++) burstPrefix[h + 1] = burstPrefix[h]! + burst[h]!;
  const cuts = [...(inp.sceneCuts ?? [])].sort(T.cmp);
  const cutsSec = cuts.map(secs);
  const fillers = [...(inp.fillers ?? [])].sort((a, b) => T.cmp(a.start, b.start));
  return { mode, units, gapAfter, bursts, burstPrefix, cuts, cutsSec, fillers, silences, assetLevel, timedShare, statements };
}
type Measured = ReturnType<typeof measure>;

const inSpan = (t: number, a: number, b: number) => t >= a && t < b;
function windowRaw(m: Measured, inp: HighlightInputsWithWords, w: Pick<ScoredWindow, 'first' | 'last' | 'start' | 'end' | 'reference'>): Record<ScoreComponent, number | null> {
  const us = m.units.slice(w.first, w.last + 1);
  const a = secs(w.start), b = secs(w.end), minutes = Math.max(1e-9, (b - a) / 60);
  const st = m.mode === 'statements';
  const f = inp.features;
  let complete: number | null = null, opening: number | null = null, pace: number | null = null;
  if (st) {
    complete = us.filter((u) => u.statement!.endsSentence).length / us.length - (w.reference ? 0.5 : 0);
    const open = us.filter((u, i) => i === 0 || secs(T.sub(u.start, w.start)) < HIGHLIGHT_RULES.openingSeconds);
    const toks = open.flatMap((u) => u.toks);
    opening = (us[0]!.statement!.question ? 3 : 0) + (toks.some((t) => inWordSet(t.bare, HOOKS)) ? 2 : 0) + (toks.some((t) => /\p{N}/u.test(t.bare) || inWordSet(t.bare, NUMBERS)) ? 1 : 0) + (toks.some((t) => inWordSet(t.bare, YOU)) ? 1 : 0);
    const spoken = us.reduce((n, u) => n + secs(T.sub(u.end, u.start)), 0);
    pace = spoken > 0 ? us.reduce((n, u) => n + u.toks.length, 0) / spoken : 0;
  }
  let voice: number | null = null, moments: number | null = null;
  if (f && m.assetLevel !== null) {
    const levels = us.map((u) => u.level).filter((x): x is number => x !== null);
    voice = levels.length ? Math.max(...levels) - m.assetLevel : -100;
    const h0 = Math.max(0, Math.min(f.hops, hopAt(w.start))), h1 = Math.max(h0, Math.min(f.hops, hopAt(w.end)));
    moments = (m.burstPrefix[h1]! - m.burstPrefix[h0]!) / HOP_RATE.num;
  }
  const picture = inp.sceneCuts ? m.cutsSec.filter((c) => c > a && c < b).length / minutes : null;
  let clean: number | null = null;
  if (st || f) {
    const pauses = us.reduce((n, u) => n + u.pauseSeconds, 0) + m.gapAfter.slice(w.first, w.last).reduce((n, g) => n + g, 0);
    const fill = st ? m.fillers.filter((x) => inSpan(secs(x.start), a, b)).length : 0;
    const low = us.reduce((n, u) => n + u.lowConf, 0);
    clean = -(fill + low + pauses) / minutes;
  }
  return { complete, opening, voice, pace, moments, picture, clean };
}

/** Every window of the asset with its components and score (before exclusion and selection). */
export function scoreWindows(inp: HighlightInputsWithWords, body: FindShortsBody): ScoredWindows & { measured: Measured } {
  const m = measure(inp);
  const R = HIGHLIGHT_RULES;
  const min = body.minSeconds, max = body.maxSeconds;
  const found = new Map<string, Omit<ScoredWindow, 'raw' | 'components' | 'penalty' | 'score' | 'timing'>>();
  for (let i = 0; i < m.units.length; i++) {
    const u = m.units[i]!;
    if (!u.canStart) continue;
    let first = i, contextAdded: number | null = null, reference = false;
    if (u.statement?.startsWithConnective) {
      while (first > 0 && secs(T.sub(u.start, m.units[first - 1]!.start)) <= body.contextSeconds) first--;
      if (first < i) contextAdded = r2(secs(T.sub(u.start, m.units[first]!.start)));
      else reference = true;
    }
    const start = m.units[first]!.start;
    let ends = 0;
    for (let j = i; j < m.units.length && ends < R.maxEndsPerStart; j++) {
      const d = secs(T.sub(m.units[j]!.end, start));
      if (d > max + 1e-9) break;
      if (d + 1e-9 < min || !m.units[j]!.canEnd) continue;
      ends++;
      const w = { first, anchor: i, last: j, start, end: m.units[j]!.end, contextAdded, reference };
      const key = `${T.normalize(start).value}/${T.normalize(start).timescale}-${T.normalize(w.end).value}/${T.normalize(w.end).timescale}`;
      const had = found.get(key);
      if (!had || (had.contextAdded === null && contextAdded !== null)) found.set(key, w); // the same span: keep the one that says it carries context
    }
  }
  const list = [...found.values()].sort((a, b) => T.cmp(a.start, b.start) || T.cmp(a.end, b.end));
  const raws = list.map((w) => windowRaw(m, inp, w));
  const comps = list.map(() => ({}) as Record<ScoreComponent, number | null>);
  const missing: ScoreComponent[] = [];
  for (const c of SCORE_COMPONENTS) {
    const present = raws.length > 0 && raws.every((r) => r[c] !== null);
    if (!present) { missing.push(c); comps.forEach((x) => (x[c] = null)); continue; }
    const p = percentiles(raws.map((r) => r[c]!));
    comps.forEach((x, k) => (x[c] = r2(p[k]!)));
  }
  const weight = SCORE_COMPONENTS.filter((c) => !missing.includes(c)).reduce((n, c) => n + SCORE_WEIGHTS[c], 0);
  const windows: ScoredWindow[] = list.map((w, k) => {
    const us = m.units.slice(w.first, w.last + 1);
    const timing = { approximate: us.some((u) => u.statement?.timing === 'approximate'), segment: us.some((u) => u.statement?.timing === 'segment') };
    const penalty = (timing.approximate ? SCORE_PENALTIES.approximateTiming : 0) + (timing.segment ? SCORE_PENALTIES.segmentTiming : 0);
    const mean = weight ? SCORE_COMPONENTS.reduce((n, c) => n + (comps[k]![c] ?? 0) * SCORE_WEIGHTS[c], 0) / weight : 0;
    return { ...w, raw: raws[k]!, components: comps[k]!, penalty, score: Math.max(0, Math.min(100, Math.round(mean - penalty))), timing };
  });
  const basis: string[] = [];
  if (m.mode === 'statements') basis.push(`transcript: ${m.statements.length} statement(s), ${Math.round(m.timedShare * 100)}% of the speech word- or phrase-timed`);
  else if (inp.statements?.length) basis.push(`transcript: mostly approximate timing (${Math.round(m.timedShare * 100)}% word- or phrase-timed), so the units are speech between silences`);
  else basis.push('no transcript: the units are speech between silences of the measured sound and the scene cuts');
  if (inp.features) basis.push(`sound: ${inp.features.hops} measurements of 100 ms (level in dBFS, not LUFS)${inp.features.partial ? `, only the first ${Math.round(inp.features.analysedSeconds)} s analysed` : ''}`);
  else basis.push('sound: not measured (voice and moments left out)');
  basis.push(inp.sceneCuts ? `scene cuts: ${inp.sceneCuts.length}` : 'scene cuts: not analysed (picture left out)');
  if (inp.fillers) basis.push(`filler candidates: ${inp.fillers.length}`);
  basis.push(`windows compared: ${windows.length}`);
  return { mode: m.mode, windows, units: m.units.length, missing, basis, measured: m };
}

/** The tokens of a window's units with their unit and token index. */
const tokensOf = (m: Measured, w: ScoredWindow) => m.units.slice(w.first, w.last + 1).flatMap((u, ui) => u.toks.map((t, ti) => ({ t, unit: w.first + ui, tok: ti })));
function occurrences(m: Measured, w: ScoredWindow, terms: string[][]): Occurrence[] {
  const out: Occurrence[] = [];
  for (let ui = w.first; ui <= w.last; ui++) {
    const toks = m.units[ui]!.toks, bares = toks.map((t) => t.bare);
    for (let i = 0; i < toks.length; i++) for (const term of terms) if (matchesAt(bares, i, term)) { out.push({ unit: ui, tok: i, at: toks[i]!.at, text: toks.slice(i, i + term.length).map((t) => t.text).join(' ') }); break; }
  }
  return out;
}
const quote = (s: string) => (s.length > 200 ? s.slice(0, 200) : s);
const reason = (code: ShortReason['code'], sign: ShortReason['sign'], value: number | null, unit: ShortReason['unit'], at: T.RationalTime | null, q: string | null): ShortReason => ({ code, sign, value: value === null ? null : r2(value), unit, at, quote: q === null ? null : quote(q) });

/** The reasons of one window: the top 3 plus, the largest minus, then notes; at most 6. */
function reasonsOf(m: Measured, inp: HighlightInputsWithWords, w: ScoredWindow, topics: Occurrence[], missing: ScoreComponent[]): ShortReason[] {
  const R = HIGHLIGHT_RULES;
  const plus: { r: ShortReason; weight: number }[] = [], minus: { r: ShortReason; weight: number }[] = [], notes: ShortReason[] = [];
  const contribution = (c: ScoreComponent) => (SCORE_WEIGHTS[c] * (w.components[c] ?? 0)) / 100;
  const shortfall = (c: ScoreComponent) => (SCORE_WEIGHTS[c] * (100 - (w.components[c] ?? 100))) / 100;
  const us = m.units.slice(w.first, w.last + 1);
  const a = secs(w.start), b = secs(w.end);
  for (const o of topics) plus.push({ r: reason('topic_word', 'plus', null, null, o.at, o.text), weight: 1000 });
  if (m.mode === 'statements') {
    const first = us[0]!.statement!;
    const complete = us.filter((u) => u.statement!.endsSentence).length;
    plus.push({ r: reason('complete_statements', 'plus', complete, 'count', w.start, null), weight: contribution('complete') });
    const open = us.filter((u, i) => i === 0 || secs(T.sub(u.start, w.start)) < R.openingSeconds);
    const toks = open.flatMap((u) => u.toks);
    const oc = contribution('opening');
    if (first.question) plus.push({ r: reason('opens_with_question', 'plus', null, null, first.start, first.text), weight: oc + 0.3 });
    const hook = toks.find((t) => inWordSet(t.bare, HOOKS));
    if (hook) plus.push({ r: reason('hook_word', 'plus', null, null, hook.at, hook.text), weight: oc + 0.2 });
    const num = toks.find((t) => /\p{N}/u.test(t.bare) || inWordSet(t.bare, NUMBERS));
    if (num) plus.push({ r: reason('number_in_opening', 'plus', null, null, num.at, num.text), weight: oc + 0.1 });
    const you = toks.find((t) => inWordSet(t.bare, YOU));
    if (you) plus.push({ r: reason('speaks_to_viewer', 'plus', null, null, you.at, you.text), weight: oc });
    if (w.reference) minus.push({ r: reason('starts_with_reference', 'minus', null, null, first.start, us[0]!.toks.slice(0, R.firstWords).map((t) => t.text).join(' ')), weight: 5 });
    const pace = w.raw.pace!;
    const pp = w.components.pace;
    if (pp !== null && pp >= 60) plus.push({ r: reason('pace', 'plus', pace, 'words_per_s', null, null), weight: contribution('pace') });
    else if (pp !== null && pp <= 40) minus.push({ r: reason('pace', 'minus', pace, 'words_per_s', null, null), weight: shortfall('pace') });
    const fills = m.fillers.filter((x) => inSpan(secs(x.start), a, b));
    if (fills.length) minus.push({ r: reason('fillers', 'minus', fills.length, 'count', fills[0]!.start, fills[0]!.text), weight: shortfall('clean') + 0.2 });
    const low = us.flatMap((u) => u.toks).filter((t) => t.confidence !== null && t.confidence < R.lowConfidence);
    if (low.length) minus.push({ r: reason('low_confidence_words', 'minus', low.length, 'count', low[0]!.at, low[0]!.text), weight: shortfall('clean') + 0.1 });
    if (w.contextAdded !== null) notes.push(reason('context_added', 'note', w.contextAdded, 's', w.start, null));
  }
  // long pauses (inside statements and between units)
  let pauseS = 0, pauseAt: T.RationalTime | null = null;
  us.forEach((u, i) => { if (u.pauseSeconds) { pauseS += u.pauseSeconds; pauseAt ??= u.firstPause; } if (w.first + i < w.last && m.gapAfter[w.first + i]) { pauseS += m.gapAfter[w.first + i]!; pauseAt ??= u.end; } });
  if (pauseS > 0) minus.push({ r: reason('long_pauses', 'minus', pauseS, 's', pauseAt, null), weight: shortfall('clean') });
  if (w.raw.voice !== null && w.raw.voice >= 1) {
    const loud = us.reduce((best, u) => (u.level !== null && (best === null || u.level > best.level!) ? u : best), null as Unit | null)!;
    plus.push({ r: reason('louder_than_usual', 'plus', w.raw.voice, 'dB', loud.start, loud.statement ? loud.toks.slice(0, R.firstWords).map((t) => t.text).join(' ') : null), weight: contribution('voice') });
  }
  if (w.raw.moments) {
    const bu = m.bursts.find(([h, e]) => secs(hopTime(e)) > a && secs(hopTime(h)) < b)!;
    plus.push({ r: reason('reaction_burst_heuristic', 'plus', w.raw.moments, 's', hopTime(Math.max(bu[0], hopAt(w.start))), null), weight: contribution('moments') });
  }
  if (w.raw.picture) plus.push({ r: reason('shot_changes', 'plus', w.raw.picture, 'per_min', m.cuts[m.cutsSec.findIndex((c) => c > a && c < b)]!, null), weight: contribution('picture') });
  if (w.timing.approximate) minus.push({ r: reason('approximate_timing', 'minus', SCORE_PENALTIES.approximateTiming, null, null, null), weight: SCORE_PENALTIES.approximateTiming });
  if (w.timing.segment) minus.push({ r: reason('segment_timing', 'minus', SCORE_PENALTIES.segmentTiming, null, null, null), weight: SCORE_PENALTIES.segmentTiming });
  if (missing.length) notes.push(reason('missing_input', 'note', missing.reduce((n, c) => n + SCORE_WEIGHTS[c], 0), 'percent', null, null));
  if (m.mode !== 'statements') notes.push(reason('no_transcript', 'note', null, null, null, null));
  const byWeight = (x: { weight: number }, y: { weight: number }) => y.weight - x.weight;
  // one plus per kind of evidence (the opening's strongest sign only), so the three shown say different things
  const groupOf = (c: ShortReason['code']) => (['opens_with_question', 'hook_word', 'number_in_opening', 'speaks_to_viewer'].includes(c) ? 'opening' : c);
  const shownPlus = plus.sort(byWeight).filter((x, i, all) => all.findIndex((y) => groupOf(y.r.code) === groupOf(x.r.code)) === i);
  const topMinus = minus.sort(byWeight).slice(0, 1).map((x) => x.r);
  const room = Math.max(0, 6 - topMinus.length - notes.length);
  return [...shownPlus.slice(0, Math.min(3, room)).map((x) => x.r), ...topMinus, ...notes].slice(0, 6);
}

const overlapShare = (a: { start: T.RationalTime; end: T.RationalTime }, b: { start: T.RationalTime; end: T.RationalTime }) => {
  const inter = secs(T.min(a.end, b.end)) - secs(T.max(a.start, b.start));
  if (inter <= 0) return 0;
  return inter / Math.min(secs(T.sub(a.end, a.start)), secs(T.sub(b.end, b.start)));
};
const text = (us: Unit[]) => us.map((u) => (u.statement ? u.statement.text : '')).filter(Boolean).join(' ');

/** Rank the candidate windows of one video. Deterministic: the same inputs give the same JSON. */
export function rankShortCandidates(inp: HighlightInputsWithWords, body: FindShortsBody): ShortCandidatesResult {
  const s = scoreWindows(inp, body);
  const m = s.measured;
  const note = 'Nothing was changed. The score is relative within this one video: weighted percentiles of measured signals (a heuristic). Read the quotes and choose by meaning.';
  if (s.mode === 'none') return { candidates: [], excluded: [], basis: [...s.basis, 'no transcript and no measured sound: nothing to rank'], method: SHORTS_RANK_METHOD, note };
  const excludeTerms = body.exclude.map(termTokens).filter((t) => t.length), includeTerms = body.include.map(termTokens).filter((t) => t.length);
  const order = [...s.windows].sort((a, b) => b.score - a.score || T.cmp(a.start, b.start) || T.cmp(a.end, b.end));
  const chosen: ScoredWindow[] = [], excluded: ExcludedWindow[] = [];
  const seen = new Set<string>();
  for (const w of order) {
    const hits = excludeTerms.length ? occurrences(m, w, excludeTerms) : [];
    if (hits.length) {
      // listed once per occurrence of an excluded word, with the best window it removed
      for (const h of hits) { const k = `${h.unit}:${h.tok}`; if (!seen.has(k)) { seen.add(k); excluded.push({ start: w.start, end: w.end, word: h.text, at: h.at }); } }
      continue;
    }
    if (chosen.length >= body.count) continue;
    if (chosen.some((c) => overlapShare(c, w) > (body.allowOverlap ? HIGHLIGHT_RULES.maxOverlap : 0))) continue;
    chosen.push(w);
  }
  excluded.sort((a, b) => T.cmp(a.at, b.at) || T.cmp(a.start, b.start));
  const dur = inp.assetDuration;
  const ctx = T.fromSeconds(REVIEW_CONTEXT_SECONDS);
  const candidates: ShortCandidate[] = chosen.map((w, i) => {
    const us = m.units.slice(w.first, w.last + 1);
    const words = tokensOf(m, w).map((x) => x.t.text);
    const before = m.units.filter((u) => u.statement && T.lte(u.end, w.start) && T.lte(T.sub(w.start, ctx), u.start));
    const after = m.units.filter((u) => u.statement && T.lte(w.end, u.start) && T.lte(u.end, T.add(w.end, ctx)));
    const warnings: CandidateWarning[] = [];
    if (s.mode === 'statements' && !m.units[w.last]!.statement!.endsSentence) warnings.push('ends_mid_sentence');
    if (w.reference) warnings.push('starts_with_reference');
    if (w.timing.approximate) warnings.push('approximate_timing');
    if (w.timing.segment) warnings.push('segment_timing');
    if (s.mode !== 'statements') warnings.push('no_transcript');
    if (!inp.sceneCuts) warnings.push('no_scene_cuts');
    if (inp.existingShorts.some((x) => overlapShare(x, w) > 0)) warnings.push('overlaps_existing_short');
    if (inp.features?.partial && secs(w.end) > inp.features.analysedSeconds) warnings.push('partial_analysis');
    return {
      id: `cand_${fingerprint({ assetId: inp.assetId, start: T.normalize(w.start), end: T.normalize(w.end), method: SHORTS_RANK_METHOD })}`,
      rank: i + 1, assetId: inp.assetId, start: w.start, end: w.end, seconds: r2(secs(T.sub(w.end, w.start))),
      statementIds: us.flatMap((u) => (u.statement ? [u.statement.id] : [])),
      firstWords: words.slice(0, HIGHLIGHT_RULES.firstWords).join(' '), text: text(us), contextBefore: text(before), contextAfter: text(after),
      context: { start: T.max(T.ZERO, T.sub(w.start, ctx)), end: T.min(dur, T.add(w.end, ctx)) },
      score: w.score, components: w.components,
      reasons: reasonsOf(m, inp, w, includeTerms.length ? occurrences(m, w, includeTerms).slice(0, 1) : [], s.missing),
      warnings,
    };
  });
  return { candidates, excluded, basis: s.basis, method: SHORTS_RANK_METHOD, note };
}
