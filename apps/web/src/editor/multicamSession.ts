/**
 * A live switching session (ADR-0020): digit presses recorded in GROUP time while the program plays, previewed as a local
 * projection and committed as ONE switch_angles. LEAD: the types and signatures; W3: the bodies (pure, testable without a
 * browser). Rules: cuts are {groupTime, angleId} (they stay right after anyone else's ripple); projection = applyTransaction
 * of switch_angles (coverage 'clip') on a copy with a local id seed (the SourceViewer precedent) — never committed; commit
 * parts hold at most core MAX_CUTS cuts each and are labelled «חלק k מתוך n» when there are several; a 409 re-sends once at the
 * fresh revision with the same group-time cuts.
 */
import type * as T from '@pulseframe/time';
import type { OpCall, ProjectDocument } from '@pulseframe/core';

export interface MulticamCut { groupTime: T.RationalTime; angleId: string }
export interface MulticamSession { groupId: string; sequenceId: string; trackId: string; cuts: MulticamCut[]; baseRevision: number; reactionFrames: number }
export interface MulticamCommitPart { label: string; ops: OpCall[] }
const todo = (): never => { throw new Error('not built yet (ADR-0020 W3)'); };
export function startSession(doc: ProjectDocument, at: { groupId: string; sequenceId: string; trackId: string; revision: number; reactionFrames?: number }): MulticamSession { void doc; void at; return todo(); }
/** The session with one more cut (the last cut wins on the same frame when committed). */
export function record(s: MulticamSession, groupTime: T.RationalTime, angleId: string): MulticamSession { void s; void groupTime; void angleId; return todo(); }
/** What the program would look like with the session's cuts: never saved. */
export function projection(doc: ProjectDocument, s: MulticamSession): ProjectDocument { void doc; void s; return todo(); }
/** The commits of the session: one switch_angles per ≤ MAX_CUTS cuts, labelled. */
export function commitParts(s: MulticamSession): MulticamCommitPart[] { void s; return todo(); }
