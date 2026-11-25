/**
 * Find and replace (wave 7 craft; craft-plan.md §4.3 and "Corrected" C4). Pure, integer code points only, so Node and Chromium
 * agree (findReplace.golden.json, run in both: proof F8). No String.normalize, no \p{…} classes: their Unicode data differs.
 * - Marks: commandBar/normalize.ts HEBREW_MARKS (the one fold table; no second one). Direction and joiner characters
 *   (BIDI_CONTROLS) are ALWAYS ignored in matching; on replace, isolates and embeddings inside the run are kept, in order,
 *   after the new text (a title's isolates stay paired). Presentation forms U+FB1D–U+FB4F are not folded.
 * - finalsEqual: ך ם ן ף ץ = כ מ נ פ צ. Always ״ = ", ׳ = ', ־ = -. ignoreCase folds A–Z only. No stemming, no prefixes.
 *   Marks not ignored: the marks on a letter must be the same set, in any order.
 * - wholeWord: the characters before and after are not a Hebrew letter, a Latin letter or a digit (׳ and ״ between letters
 *   are part of the word). Text inside {…} field tokens (fields.ts parseFields) of a title with fields is masked: never
 *   matched, never crossed, never touched by a replacement (escaped braces {{ }} and lone braces too).
 * - A matched range covers its letters and all their marks (a replacement leaves no mark without its letter).
 * - Carriers: title text, manual cue text, transcript phrases, and per format overrides[clipId].text and phraseText — what
 *   variants.ts projectVariant substitutes — in every sequence; matches grouped by sequence (main first, then by name), kind
 *   (title, cue, phrase, override, variantPhrase), format (master, then formats by name), then timeline frame.
 * - The one labelled check (a rule, not a correction): a final-form letter directly followed by a Hebrew letter (final_mid_word).
 * - findText returns EVERY match; the server lists at most CRAFT_LIMITS.findMatches of them and reports the total.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument, Sequence } from './schema.ts';
import type { FindQuery, MatchNote, ReplacePlan, TextCarrier, TextMatch } from './craftContract.ts';
import { BIDI_CONTROLS, HEBREW_MARKS } from './commandBar/normalize.ts';
import { findClip } from './ops.ts';
import { wordsOf } from './craftOps.ts';
import { sourceEnd, timelineAt, isRamped } from './speed.ts';

export type MatchFlags = Pick<FindQuery, 'wholeWord' | 'ignoreMarks' | 'finalsEqual' | 'ignoreCase'>;

// ---------------------------------------------------------------- the character rules
const MARK = new RegExp(`^${HEBREW_MARKS.source}$`);
const BIDI = new RegExp(`^${BIDI_CONTROLS.source}$`);
/** Isolates and embeddings: kept (in order, after the new text) when a replacement covers them. */
const KEEP_ON_REPLACE = /^[‪-‮⁦-⁩]$/;
const FINALS: Readonly<Record<string, string>> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const ALWAYS: Readonly<Record<string, string>> = { '״': '"', '׳': "'", '־': '-' };
const HEB_LETTER = /^[א-ת]$/;
const WORD_CHAR = /^[א-תA-Za-z0-9]$/;
const isFinal = (ch: string) => Object.hasOwn(FINALS, ch);

/** The key a character is compared by under the flags. */
function fold(ch: string, flags: MatchFlags): string {
  if (Object.hasOwn(ALWAYS, ch)) return ALWAYS[ch]!;
  if (flags.finalsEqual && isFinal(ch)) return FINALS[ch]!;
  if (flags.ignoreCase && ch >= 'A' && ch <= 'Z') return String.fromCharCode(ch.charCodeAt(0) + 32);
  return ch;
}

/** One letter (any character that is not a mark or a direction control) with its marks; a barrier stands for a masked character. */
interface Unit { key: string; marks: string; start: number; end: number; barrier: boolean }
const BARRIER = '\u0000';
function unitsOf(text: string, flags: MatchFlags, masked?: readonly boolean[]): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!, ch = String.fromCodePoint(cp), next = i + ch.length;
    if (masked?.[i]) out.push({ key: BARRIER, marks: '', start: i, end: next, barrier: true });
    else if (BIDI.test(ch)) { /* ignored in matching, always */ }
    else if (MARK.test(ch)) {
      const last = out[out.length - 1];
      // a mark belongs to the letter before it: the range of that letter grows over it, so a replacement takes it along
      if (last && !last.barrier) { if (!flags.ignoreMarks) last.marks += ch; last.end = next; }
    } else out.push({ key: fold(ch, flags), marks: '', start: i, end: next, barrier: false });
    i = next;
  }
  for (const u of out) if (u.marks.length > 1) u.marks = [...u.marks].sort().join('');
  return out;
}
const wordUnit = (u: Unit | undefined) => !!u && !u.barrier && WORD_CHAR.test(u.key);
const gereshLike = (u: Unit | undefined) => !!u && !u.barrier && (u.key === "'" || u.key === '"');
/** The unit before index i (or after, dir +1) is part of a word: a word character, or ׳ ״ with a word character beyond it. */
function joins(U: readonly Unit[], i: number, dir: -1 | 1): boolean {
  const u = U[i];
  if (wordUnit(u)) return true;
  return gereshLike(u) && wordUnit(U[i + dir]);
}

/** Matching with an optional mask (code-unit indices that are never matched). */
function rangesOf(text: string, needle: string, flags: MatchFlags, masked?: readonly boolean[]): [number, number][] {
  const N = unitsOf(needle, flags).filter((u) => !u.barrier);
  if (!N.length) return [];
  const U = unitsOf(text, flags, masked);
  const out: [number, number][] = [];
  const n = N.length;
  for (let i = 0; i + n <= U.length;) {
    let ok = true;
    for (let k = 0; k < n && ok; k++) {
      const u = U[i + k]!, v = N[k]!;
      ok = !u.barrier && u.key === v.key && (flags.ignoreMarks || u.marks === v.marks);
    }
    if (ok && flags.wholeWord) ok = !(wordUnit(U[i]) && joins(U, i - 1, -1)) && !(wordUnit(U[i + n - 1]) && joins(U, i + n, 1));
    if (ok) { out.push([U[i]!.start, U[i + n - 1]!.end]); i += n; } else i++;
  }
  return out;
}

/** The [start, end) code-unit ranges of `needle` in `text`, left to right, not overlapping. */
export function matchText(text: string, needle: string, flags: MatchFlags): [number, number][] {
  return rangesOf(text, needle, flags);
}

/**
 * The code units of a title with live fields that find never touches: every brace group on one line ({name:…}, also one that
 * is not a field), escaped braces ({{, }}) and lone braces — as fields.ts scanBraces cuts the text.
 */
export function fieldMask(text: string): boolean[] {
  const m = new Array<boolean>(text.length).fill(false);
  for (let i = 0; i < text.length;) {
    const ch = text[i]!;
    if (ch !== '{' && ch !== '}') { i++; continue; }
    if (text[i + 1] === ch) { m[i] = m[i + 1] = true; i += 2; continue; }
    if (ch === '{') {
      let j = i + 1;
      while (j < text.length && text[j] !== '}' && text[j] !== '{' && text[j] !== '\n' && text[j] !== '\r') j++;
      if (text[j] === '}') { for (let k = i; k <= j; k++) m[k] = true; i = j + 1; continue; }
    }
    m[i] = true; i++;
  }
  return m;
}

/** The check of rule 5: a final-form letter directly followed (marks and controls aside) by a Hebrew letter, at index p. */
function finalMidWordAt(text: string, p: number): boolean {
  if (!isFinal(text[p]!)) return false;
  let q = p + 1;
  while (q < text.length && (MARK.test(text[q]!) || BIDI.test(text[q]!))) q++;
  return q < text.length && HEB_LETTER.test(text[q]!);
}

/** The text with each range replaced; isolates and embeddings inside a range kept after the new text. Spans: where the new text went. */
export function replaceRanges(text: string, ranges: readonly [number, number][], replacement: string): { text: string; spans: [number, number][] } {
  let out = '', at = 0;
  const spans: [number, number][] = [];
  for (const [s, e] of ranges) {
    out += text.slice(at, s);
    const kept = [...text.slice(s, e)].filter((c) => KEEP_ON_REPLACE.test(c)).join('');
    spans.push([out.length, out.length + replacement.length]);
    out += replacement + kept;
    at = e;
  }
  return { text: out + text.slice(at), spans };
}

// ---------------------------------------------------------------- carriers
interface Carrier { at: TextCarrier; sequenceId: string | null; variantId: string | null; text: string; frame: number | null; masked?: boolean[]; clipId: string | null }
const KIND_RANK: Record<TextCarrier['kind'], number> = { title: 0, cue: 1, phrase: 2, override: 3, variantPhrase: 4 };

function orderedSequences(doc: ProjectDocument): Sequence[] {
  const main = doc.sequences[doc.mainSequenceId];
  const rest = Object.values(doc.sequences).filter((s) => s.id !== doc.mainSequenceId).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  return main ? [main, ...rest] : rest;
}
/** Where a phrase is on a timeline: the first clip (main sequence first) that shows its asset at the phrase start. */
function placePhrase(doc: ProjectDocument, seqs: readonly Sequence[], assetId: string, at: T.RationalTime, only: ReadonlySet<string> | null): { sequenceId: string; frame: number; clipId: string } | null {
  for (const seq of seqs) for (const t of seq.tracks) for (const c of t.clips) {
    if (c.type !== 'media' || c.assetId !== assetId || (only && !only.has(c.id))) continue;
    if (T.lt(at, c.sourceIn) || !T.lt(at, sourceEnd(c))) continue;
    const plain = !c.reverse && !isRamped(c) && !c.freeze;
    return { sequenceId: seq.id, frame: T.frameIndexAt(plain ? timelineAt(c, at) : c.start, doc.settings.frameRate), clipId: c.id };
  }
  return null;
}

function carriersOf(doc: ProjectDocument, q: FindQuery): Carrier[] {
  const rate = doc.settings.frameRate;
  const seqs = orderedSequences(doc);
  const only = q.scope === 'clips' ? new Set(q.clipIds ?? []) : null;
  const viewed = q.formats === 'viewed' && q.variantId && Object.hasOwn(doc.variants, q.variantId) ? doc.variants[q.variantId]! : null;
  const variants = q.formats === 'master' ? [] : q.formats === 'viewed' ? (viewed ? [viewed] : []) : Object.values(doc.variants).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  const out: Carrier[] = [];
  // the master: what a viewed format shows in its own wording is that format's row, not the master's
  for (const seq of seqs) for (const t of seq.tracks) for (const c of t.clips) {
    if (only && !only.has(c.id)) continue;
    if (c.type !== 'text' && c.type !== 'caption') continue;
    if (viewed?.overrides[c.id]?.text !== undefined) continue;
    const frame = T.frameIndexAt(c.start, rate);
    out.push({ at: { kind: c.type === 'text' ? 'title' : 'cue', clipId: c.id }, sequenceId: seq.id, variantId: null, text: c.text, frame, clipId: c.id, ...(c.type === 'text' && c.fields ? { masked: fieldMask(c.text) } : {}) });
  }
  const segAsset = new Map<string, string>();
  for (const assetId of Object.keys(doc.transcripts).sort()) for (const seg of doc.transcripts[assetId]!.segments) {
    if (!segAsset.has(seg.id)) segAsset.set(seg.id, assetId);
    if (viewed?.phraseText && Object.hasOwn(viewed.phraseText, seg.id)) continue;
    const place = placePhrase(doc, seqs, assetId, seg.start, only);
    if (only && !place) continue;
    out.push({ at: { kind: 'phrase', assetId, segmentId: seg.id }, sequenceId: place?.sequenceId ?? null, variantId: null, text: seg.text, frame: place?.frame ?? null, clipId: place?.clipId ?? null });
  }
  for (const v of variants) {
    for (const clipId of Object.keys(v.overrides).sort()) {
      const text = v.overrides[clipId]!.text;
      if (text === undefined || (only && !only.has(clipId))) continue;
      const f = findClip(doc, clipId);
      if (!f) continue;
      out.push({ at: { kind: 'override', variantId: v.id, clipId }, sequenceId: f.seq.id, variantId: v.id, text, frame: T.frameIndexAt(f.clip.start, rate), clipId, ...(f.clip.type === 'text' && f.clip.fields ? { masked: fieldMask(text) } : {}) });
    }
    for (const segmentId of Object.keys(v.phraseText ?? {}).sort()) {
      const assetId = segAsset.get(segmentId);
      if (!assetId) continue;
      const seg = doc.transcripts[assetId]!.segments.find((s) => s.id === segmentId)!;
      const place = placePhrase(doc, seqs, assetId, seg.start, only);
      if (only && !place) continue;
      out.push({ at: { kind: 'variantPhrase', variantId: v.id, assetId, segmentId }, sequenceId: place?.sequenceId ?? null, variantId: v.id, text: v.phraseText![segmentId]!, frame: place?.frame ?? null, clipId: place?.clipId ?? null });
    }
  }
  const seqRank = new Map(seqs.map((s, i) => [s.id, i]));
  const fmtRank = new Map(variants.map((v, i) => [v.id, i + 1]));
  const rank = (c: Carrier): number[] => [c.sequenceId === null ? seqs.length : seqRank.get(c.sequenceId)!, KIND_RANK[c.at.kind], c.variantId === null ? 0 : fmtRank.get(c.variantId)!, c.frame ?? 0];
  const keyed = out.map((c, i) => ({ c, r: rank(c), i }));
  keyed.sort((x, y) => { for (let k = 0; k < x.r.length; k++) if (x.r[k] !== y.r[k]) return x.r[k]! - y.r[k]!; return x.i - y.i; });
  return keyed.map((k) => k.c);
}

/** Every match in the document under the query (all of them: the server lists at most CRAFT_LIMITS.findMatches with the total). */
export function findText(doc: ProjectDocument, query: FindQuery): TextMatch[] {
  const flags: MatchFlags = { wholeWord: query.wholeWord, ignoreMarks: query.ignoreMarks, finalsEqual: query.finalsEqual, ignoreCase: query.ignoreCase };
  const out: TextMatch[] = [];
  for (const c of carriersOf(doc, query)) {
    const ranges = rangesOf(c.text, query.text, flags, c.masked);
    if (!ranges.length) continue;
    const notes: MatchNote[] = ranges.some(([s, e]) => { for (let p = s; p < e; p++) if (finalMidWordAt(c.text, p)) return true; return false; }) ? ['final_mid_word'] : [];
    out.push({ at: c.at, sequenceId: c.sequenceId, kind: c.at.kind, variantId: c.variantId, text: c.text, ranges, frame: c.frame, notes });
  }
  return out;
}

/** The replace_text edits for the matches (all, or the picked indices of findText's list), with the notes said before the commit. */
export function planReplace(doc: ProjectDocument, query: FindQuery, replacement: string, picked?: readonly number[]): ReplacePlan {
  const matches = findText(doc, query);
  const chosen = picked ? [...new Set(picked)].filter((i) => Number.isInteger(i) && i >= 0 && i < matches.length).sort((a, b) => a - b).map((i) => matches[i]!) : matches;
  const plan: ReplacePlan = { edits: [], lostWordTiming: [], approximated: [], reviewAgain: [], finalMidWord: 0 };
  for (const m of chosen) {
    const { text, spans } = replaceRanges(m.text, m.ranges, replacement);
    if (text === m.text) continue;
    plan.edits.push({ at: m.at, was: m.text, text });
    for (let p = 0; p < text.length; p++) if (spans.some(([s, e]) => (p >= s && p < e) || p === s - 1) && finalMidWordAt(text, p)) plan.finalMidWord++;
    const at = m.at;
    const count = wordsOf(text).length;
    if (at.kind === 'cue') { const f = findClip(doc, at.clipId); if (f?.clip.type === 'caption' && f.clip.words?.length && f.clip.words.length !== count) plan.lostWordTiming.push(at.clipId); }
    if (at.kind === 'phrase') { const seg = doc.transcripts[at.assetId]?.segments.find((s) => s.id === at.segmentId); if (seg && seg.words.length && seg.words.length !== count) plan.approximated.push(at.segmentId); }
    if ((at.kind === 'override' || at.kind === 'variantPhrase') && doc.variants[at.variantId]?.translation?.review === 'reviewed' && !plan.reviewAgain.includes(at.variantId)) plan.reviewAgain.push(at.variantId);
  }
  return plan;
}
