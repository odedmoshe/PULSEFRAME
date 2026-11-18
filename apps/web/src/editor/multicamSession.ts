/**
 * A live switching session (ADR-0020): digit presses recorded in GROUP time while the program plays, previewed as a local
 * projection and committed as ONE switch_angles. Pure and testable without a browser. Rules: cuts are {groupTime, angleId}
 * (they stay right after anyone else's ripple, because core resolves a group-time cut against the track as it is when the
 * step is applied); projection = applyTransaction of switch_angles (coverage 'clip') on a copy with a local id seed (the
 * SourceViewer precedent), never committed; commit parts hold at most core MAX_CUTS cuts each and are labelled «חלק k מתוך n»
 * when there are several; a 409 re-sends once at the fresh revision with the same group-time cuts (store.ts does the sending).
 */
import * as T from '@pulseframe/time';
import { applyTransaction, MAX_CUTS, multicamGroupOf, OpError, type MulticamAngle, type MulticamGroup, type OpCall, type ProjectDocument, type SwitchAnglesOutput } from '@pulseframe/core';

export interface MulticamCut { groupTime: T.RationalTime; angleId: string }
export interface MulticamSession { groupId: string; sequenceId: string; trackId: string; cuts: MulticamCut[]; baseRevision: number; reactionFrames: number }
export interface MulticamCommitPart { label: string; ops: OpCall[] }
/** The most frames a person's reaction time may be set to compensate (the panel's control: 0–10). */
export const MAX_REACTION_FRAMES = 10;
export const SESSION_ACTOR = 'multicam-session';

/** A session on this program (the group, the sequence and the video track holding its segments) at the revision the editor holds now. */
export function startSession(doc: ProjectDocument, at: { groupId: string; sequenceId: string; trackId: string; revision: number; reactionFrames?: number }): MulticamSession {
  if (!multicamGroupOf(doc, at.groupId)) throw new Error(`multicam group ${at.groupId} not found`);
  const r = Math.round(at.reactionFrames ?? 0);
  return { groupId: at.groupId, sequenceId: at.sequenceId, trackId: at.trackId, cuts: [], baseRevision: at.revision, reactionFrames: Math.max(0, Math.min(MAX_REACTION_FRAMES, Number.isFinite(r) ? r : 0)) };
}

/** The session with one more cut (the last cut wins on the same group time when committed). Never changes `s`. */
export function record(s: MulticamSession, groupTime: T.RationalTime, angleId: string): MulticamSession {
  return { ...s, cuts: [...s.cuts, { groupTime, angleId }] };
}

/** The cuts as committed: an earlier cut at exactly the same group time as a later one is dropped (the last press wins); the order of pressing is kept. */
export function effectiveCuts(s: MulticamSession): MulticamCut[] {
  const out: MulticamCut[] = [];
  for (const c of s.cuts) {
    const same = out.findIndex((x) => T.eq(x.groupTime, c.groupTime));
    if (same >= 0) out.splice(same, 1);
    out.push(c);
  }
  return out;
}

const cutArgs = (cuts: readonly MulticamCut[]) => cuts.map((c) => ({ groupTime: { value: c.groupTime.value, timescale: c.groupTime.timescale }, angleId: c.angleId }));
const switchOp = (s: MulticamSession, cuts: readonly MulticamCut[]): OpCall => ({
  op: 'switch_angles',
  args: { groupId: s.groupId, sequenceId: s.sequenceId, trackId: s.trackId, cuts: cutArgs(cuts), coverage: 'clip' },
});

/** What the program would look like with the session's cuts, and what the step reported or why it was refused. Never saved. */
export interface SessionProjection { doc: ProjectDocument; output: SwitchAnglesOutput | null; refusal: OpError | null }
export function projectionResult(doc: ProjectDocument, s: MulticamSession): SessionProjection {
  const cuts = effectiveCuts(s);
  if (!cuts.length) return { doc, output: null, refusal: null };
  try {
    // one step per MAX_CUTS cuts, in order, exactly as they will be committed
    let cur = doc, last: SwitchAnglesOutput | null = null;
    for (const [k, part] of chunks(cuts).entries()) {
      const r = applyTransaction(cur, [switchOp(s, part)], { idSeed: `mcs${k}_`, actor: SESSION_ACTOR });
      cur = r.doc;
      last = (r.results[0]?.output ?? null) as SwitchAnglesOutput | null;
    }
    return { doc: cur, output: last, refusal: null };
  } catch (e) {
    if (e instanceof OpError) return { doc, output: null, refusal: e }; // the preview shows the program as it is; the refusal is said when the session ends
    throw e;
  }
}
/** The projected document alone (the SourceViewer precedent); the program unchanged when there are no cuts or the step is refused. */
export function projection(doc: ProjectDocument, s: MulticamSession): ProjectDocument { return projectionResult(doc, s).doc; }

function chunks<X>(a: readonly X[]): X[][] {
  const out: X[][] = [];
  for (let i = 0; i < a.length; i += MAX_CUTS) out.push(a.slice(i, i + MAX_CUTS));
  return out;
}
/** The label of part k of n (1-based), as the history shows it. */
export const partLabel = (k: number, n: number): string => (n > 1 ? `החלפת זוויות · חלק ${k} מתוך ${n}` : 'החלפת זוויות');
/** The commits of the session: one switch_angles per ≤ MAX_CUTS cuts, labelled. Empty when nothing was recorded. */
export function commitParts(s: MulticamSession): MulticamCommitPart[] {
  const parts = chunks(effectiveCuts(s));
  return parts.map((cuts, i) => ({ label: partLabel(i + 1, parts.length), ops: [switchOp(s, cuts)] }));
}
/** The ops of the whole session as one list (a single part), or null when it needs several (over MAX_CUTS cuts). */
export function commitOps(s: MulticamSession): OpCall[] | null {
  const p = commitParts(s);
  return p.length === 1 ? p[0]!.ops : null;
}

/** What a commit reported, summed over its parts: cuts kept, cuts skipped with their reasons (core SKIP_REASONS), what a switch dropped. */
export interface SessionReport { saved: number; skipped: { reason: string; count: number }[]; dropped: SwitchAnglesOutput['dropped']; warnings: SwitchAnglesOutput['warnings'] }
export function reportOf(outputs: readonly (SwitchAnglesOutput | undefined | null)[]): SessionReport {
  const skipped = new Map<string, number>();
  let saved = 0;
  const dropped: SwitchAnglesOutput['dropped'] = [], warnings: SwitchAnglesOutput['warnings'] = [];
  for (const o of outputs) {
    if (!o) continue;
    saved += o.cuts.length;
    for (const k of o.skipped) skipped.set(k.reason, (skipped.get(k.reason) ?? 0) + 1);
    dropped.push(...o.dropped); warnings.push(...o.warnings);
  }
  return { saved, skipped: [...skipped].map(([reason, count]) => ({ reason, count })), dropped, warnings };
}

/** The picture angles of a group in the order the tiles and the digits use (1..9); the digits never name a sound angle. */
export const pictureAngles = (group: MulticamGroup): MulticamAngle[] => group.angles.filter((a) => a.kind === 'picture');
/** The angle a digit names: 1..9 = the n-th picture angle, 0 = the wide angle (null when there is none). */
export function angleForDigit(group: MulticamGroup, digit: number): MulticamAngle | null {
  if (digit === 0) return group.angles.find((a) => a.id === group.wideAngleId) ?? null;
  return pictureAngles(group)[digit - 1] ?? null;
}

/**
 * Where tile n (1-based, reading order) sits in a grid of `cols` columns: row from the top, and the VISUAL column from the left.
 * In a right-to-left interface reading starts at the top right, so tile 1 is the right-most cell of the first row.
 */
export function tilePositions(count: number, cols: number, rtl: boolean): { tile: number; row: number; col: number }[] {
  return Array.from({ length: count }, (_, i) => ({ tile: i + 1, row: Math.floor(i / cols), col: rtl ? cols - 1 - (i % cols) : i % cols }));
}

/** The privacy/look side of a report in words: what a switch dropped, then the warnings (redaction_missing is the only signal, policy is warn, never block). */
export function reportNotes(rep: Pick<SessionReport, 'dropped' | 'warnings'>, dict: Record<string, string>, droppedLine: (what: string, n: number) => string): string[] {
  const by = new Map<string, number>();
  for (const d of rep.dropped) by.set(d.what, (by.get(d.what) ?? 0) + 1);
  const out = [...by].map(([w, n]) => droppedLine(dict[`multicam.dropped.${w}`] ?? w, n));
  for (const code of new Set(rep.warnings.map((w) => w.code))) out.push(dict[`multicam.warn.${code}`] ?? code);
  return out;
}
