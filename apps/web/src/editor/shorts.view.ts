/**
 * Pure helpers of the Shorts panel and of the editor's active sequence (ADR-0018, W3; tested in shorts.view.test.ts and
 * activeSequence.test.ts): edge nudges of a candidate in the review list, the list's keys, the selection, the length chips,
 * the injection of the active sequence into an operation call, and the guards that keep a project-level writer from
 * changing the whole project while a short is shown. Times are exact rationals (ADR-0003): an edge only ever lands on a word
 * or statement edge of the transcript, never on a float.
 *
 * Keys of the review list (handled = the list's onKeyDown calls preventDefault AND stopPropagation, pattern
 * AudioFxBlock.tsx, so the global trim of commands.ts never runs): Space preview; [ and ] move the start by one statement,
 * Shift+[ and Shift+] the end, with Alt by one word; Enter toggles the selection (at most SHORTS_MAX_SELECTED).
 */
import { findClip, fingerprint, frameOf, getOp, SHORTS_RUN_ID, sequenceOf, SHORTS_CAPS, type BuildShortsBody, type OpCall, type ProjectDocument, type SequenceFormat, type Statement } from '@pulseframe/core';
import { dictionaries, type Lang } from '@pulseframe/i18n';
import * as T from '@pulseframe/time';

/** At most this many shorts are made at once (core SHORTS_CAPS.maxShortsPerApply). */
export const SHORTS_MAX_SELECTED = SHORTS_CAPS.maxShortsPerApply;
/** The length chips of step 1, in seconds. A chip of T asks for windows of 0.6·T to 1.25·T (lengthRange). */
export const LENGTH_CHIPS = [15, 30, 45, 60, 90] as const;
export interface ReviewEdges { start: T.RationalTime; end: T.RationalTime }
export interface NudgeContext { statements: readonly Statement[]; words: readonly { start: T.RationalTime; end: T.RationalTime }[]; minSeconds: number }
export type ReviewKeyAction =
  | { kind: 'preview' }
  | { kind: 'nudge'; edge: 'start' | 'end'; dir: -1 | 1; unit: 'statement' | 'word' }
  | { kind: 'toggle' };

/** The bounds FindShortsBody accepts for minSeconds and maxSeconds (core shortsContract.ts). */
const FIND_MIN = 5, FIND_MAX = 180;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** minSeconds and maxSeconds of FindShortsBody for a length chip of `seconds`: 0.6·T to 1.25·T, inside what the finder accepts. */
export function lengthRange(seconds: number): { minSeconds: number; maxSeconds: number } {
  const clamp = (n: number) => Math.min(FIND_MAX, Math.max(FIND_MIN, round2(n)));
  return { minSeconds: clamp(seconds * 0.6), maxSeconds: clamp(seconds * 1.25) };
}

/** The sorted, distinct edges of a list of times. */
function distinct(times: readonly T.RationalTime[]): T.RationalTime[] {
  const sorted = [...times].sort(T.cmp);
  return sorted.filter((t, i) => i === 0 || !T.eq(t, sorted[i - 1]!));
}
/** The nearest edge strictly after (dir 1) or strictly before (dir -1) `from`, or null. */
function nextEdge(edges: readonly T.RationalTime[], from: T.RationalTime, dir: -1 | 1): T.RationalTime | null {
  if (dir === 1) return edges.find((t) => T.lt(from, t)) ?? null;
  for (let i = edges.length - 1; i >= 0; i--) if (T.lt(edges[i]!, from)) return edges[i]!;
  return null;
}
/**
 * Move one edge by one statement or one word; edges never cross and never come closer than minSeconds. The start lands on a
 * statement or word START, the end on a statement or word END. When the next edge would break a rule (or there is none), the
 * edges are returned unchanged: an edge is never skipped past a neighbour to find a legal one.
 */
export function nudgeEdge(edges: ReviewEdges, edge: 'start' | 'end', dir: -1 | 1, unit: 'statement' | 'word', ctx: NudgeContext): ReviewEdges {
  const pool = unit === 'statement'
    ? ctx.statements.map((s) => (edge === 'start' ? s.start : s.end))
    : ctx.words.map((w) => (edge === 'start' ? w.start : w.end));
  const to = nextEdge(distinct(pool), edge === 'start' ? edges.start : edges.end, dir);
  if (!to) return edges;
  const next: ReviewEdges = edge === 'start' ? { start: to, end: edges.end } : { start: edges.start, end: to };
  if (!T.lt(next.start, next.end)) return edges;
  if (T.lt(T.sub(next.end, next.start), T.fromSeconds(String(Math.max(0, ctx.minSeconds))))) return edges;
  return next;
}

/** What a key does in the review list, or null (the key is not the list's: let it through). */
export function reviewKey(e: { code: string; shiftKey: boolean; altKey: boolean; ctrlKey?: boolean; metaKey?: boolean }): ReviewKeyAction | null {
  if (e.ctrlKey || e.metaKey) return null;
  if (e.code === 'Space') return e.shiftKey || e.altKey ? null : { kind: 'preview' };
  if (e.code === 'Enter') return e.shiftKey || e.altKey ? null : { kind: 'toggle' };
  if (e.code !== 'BracketLeft' && e.code !== 'BracketRight') return null;
  return { kind: 'nudge', edge: e.shiftKey ? 'end' : 'start', dir: e.code === 'BracketLeft' ? -1 : 1, unit: e.altKey ? 'word' : 'statement' };
}
/** The part of a keyboard event the list's handler uses. */
export interface ReviewKeyEvent { code: string; shiftKey: boolean; altKey: boolean; ctrlKey?: boolean; metaKey?: boolean; preventDefault(): void; stopPropagation(): void }
/**
 * The list's onKeyDown: runs `act` for a key that belongs to the list and says it handled it (preventDefault and
 * stopPropagation, so the global trim of commands.ts on the same keys never runs). Any other key is left alone (false).
 */
export function handleReviewKey(e: ReviewKeyEvent, act: (a: ReviewKeyAction) => void): boolean {
  const a = reviewKey(e);
  if (!a) return false;
  e.preventDefault();
  e.stopPropagation();
  act(a);
  return true;
}

/** Toggle a candidate in the selection, capped at SHORTS_MAX_SELECTED (a toggle past the cap is ignored and reported). */
export function toggleSelection(selected: readonly string[], id: string): { selected: string[]; capped: boolean } {
  if (selected.includes(id)) return { selected: selected.filter((x) => x !== id), capped: false };
  if (selected.length >= SHORTS_MAX_SELECTED) return { selected: [...selected], capped: true };
  return { selected: [...selected, id], capped: false };
}

// ---------------------------------------------------------------------------------------------------------------------
// The active sequence (store.ts) and the project-level writers
// ---------------------------------------------------------------------------------------------------------------------
/** True when the operation's argument schema declares a `sequenceId` key (read from the registered schema, never a hand list). */
export function declaresSequenceId(op: string): boolean {
  const shape = (getOp(op)?.args as unknown as { shape?: Record<string, unknown> } | undefined)?.shape;
  return !!shape && Object.hasOwn(shape, 'sequenceId');
}
/**
 * The call with the active sequence named: for an operation whose schema declares `sequenceId` and a call that omits it, the
 * active id is added; an explicit id is kept. Nothing is injected while the main sequence is active, so the logs of a project
 * without shorts stay exactly as they were.
 */
export function injectSequenceId(call: OpCall, activeId: string | null, mainId: string): OpCall {
  if (!activeId || activeId === mainId || !declaresSequenceId(call.op)) return call;
  const args = (call.args ?? {}) as Record<string, unknown>;
  if (args.sequenceId !== undefined) return call;
  return { ...call, args: { ...args, sequenceId: activeId } };
}

/** True while a sequence other than the main edit is the active one. */
export const isShortActive = (raw: ProjectDocument | null, activeId: string): boolean => !!raw && activeId !== raw.mainSequenceId && !!sequenceOf(raw, activeId);

/** The sequence's own frame as update_sequence takes it: its stored format, or one made from the frame it renders at. */
function formatOf(raw: ProjectDocument, id: string): SequenceFormat {
  const own = sequenceOf(raw, id)?.format;
  if (own) return own;
  const f = frameOf(raw, id);
  return { width: f.width, height: f.height, fit: f.fit, profileId: null, safeArea: null };
}
export interface FrameChange { width?: number; height?: number; fit?: 'contain' | 'cover'; background?: string }
/**
 * What the master-format apply of the Deliver panel commits. The main sequence: set_project_format with what changed. A short:
 * update_sequence { format } for THAT sequence (the project's size is not touched); the background belongs to the project, so
 * it is not part of a short's change (the panel disables that control).
 */
export function frameOps(raw: ProjectDocument, activeId: string, change: FrameChange): OpCall[] {
  if (!isShortActive(raw, activeId)) return [{ op: 'set_project_format', args: { ...change } }];
  const f = formatOf(raw, activeId);
  const next: SequenceFormat = { ...f, ...(change.width !== undefined ? { width: change.width } : {}), ...(change.height !== undefined ? { height: change.height } : {}), ...(change.fit !== undefined ? { fit: change.fit } : {}) };
  return [{ op: 'update_sequence', args: { sequenceId: activeId, format: next } }];
}
/**
 * What the loudness controls of the Sound panel commit. The main sequence: set_loudness_target. A short: update_sequence with
 * format.loudness (null = no normalisation) so the target is the short's own, never the whole project's.
 */
export function loudnessOps(raw: ProjectDocument, activeId: string, target: number | null): OpCall[] {
  if (!isShortActive(raw, activeId)) return [{ op: 'set_loudness_target', args: { target } }];
  const f = formatOf(raw, activeId);
  const truePeak = f.loudness?.truePeak ?? raw.settings.loudness?.truePeak ?? -1;
  return [{ op: 'update_sequence', args: { sequenceId: activeId, format: { ...f, loudness: target === null ? null : { target, truePeak } } } }];
}
/** Linked formats belong to the whole project: while a short is shown, adding one is disabled with the reason. */
export function addVariantGuard(raw: ProjectDocument | null, activeId: string, lang: Lang): { disabled: boolean; reason: string | null } {
  return isShortActive(raw, activeId) ? { disabled: true, reason: dictionaries[lang]['shorts.variantProjectWide'] } : { disabled: false, reason: null };
}

/** m:ss of a number of seconds (the switcher's label; the caller isolates it in <bdi dir="ltr">). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** A rational time as seconds with one decimal for a range (m:ss.d). */
export function stamp(t: T.RationalTime): string {
  const s = Math.max(0, T.toSeconds(t));
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * How many clips of a short differ from the shorts run that made them (content fingerprints, as recipes and templates notice
 * hand edits): a rebuild replaces them, so the panel warns first. Clips the run did not create are not counted.
 */
export function editedClipCount(raw: ProjectDocument, sequenceId: string): number {
  const seq = sequenceOf(raw, sequenceId);
  if (!seq) return 0;
  const ids = new Set(seq.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  let n = 0;
  for (const run of Object.values(raw.recipeRuns ?? {})) {
    if (run.recipeId !== SHORTS_RUN_ID) continue;
    for (const id of run.createdIds) {
      if (!ids.has(id) || !run.fingerprints[id]) continue;
      const f = findClip(raw, id);
      if (f && fingerprint(f.clip) !== run.fingerprints[id]) n++;
    }
  }
  return n;
}
/** The make body that rebuilds one built short from its measured origin (replaceSequenceIds: the old one goes in the same undo step); null when it has no origin. */
export function rebuildBody(raw: ProjectDocument, sequenceId: string): Partial<BuildShortsBody> | null {
  const seq = sequenceOf(raw, sequenceId);
  const o = seq?.origin;
  if (!seq || !o || o.kind !== 'short' || !Object.hasOwn(raw.assets, o.assetId)) return null;
  const reframe = o.reframe === 'track' && o.motionTrackId ? { source: 'track' as const, motionTrackId: o.motionTrackId, framing: 1 } : { source: o.reframe === 'track' ? 'auto' as const : o.reframe, framing: 1 };
  return {
    picks: [{ ...(o.candidateId ? { candidateId: o.candidateId } : {}), assetId: o.assetId, start: o.excerpt.start, end: o.excerpt.end, name: seq.name }],
    ...(seq.format ? { format: seq.format } : {}), reframe, replaceSequenceIds: [sequenceId],
  };
}
