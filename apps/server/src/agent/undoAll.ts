/**
 * «ביטול הכול» (wave 8 autonomy Part 2; verifier C6, C7). W1.
 *  - undoAll (one run): Store.undoActor(run.actor, run.startRevision, byActor = the caller) + the run's open jobs cancelled + the list
 *    of what no undo reverses (core summarizeNotUndone over the run's steps), shown every time.
 *  - undoActorFor (any actor since a revision): own actor always; another actor when the caller acts as the owner (Part 1's
 *    actsAsOwner: the owner, or an open principal); 403 agent_undo_not_yours otherwise.
 *  - THE SESSION RULE (C6; lead's answer 4): without sinceRevision, an actor that is not a run (agent:local, Claude Code, a grant)
 *    is undone back to the start of its LAST CONTINUOUS SESSION: its transactions walked from the newest back, a gap of more than
 *    SESSION_GAP_MINUTES (30) between two of them ends the session. The dry run returns that revision (sinceRevision) so the dialog
 *    shows it, with the number, before pressing. A run actor without sinceRevision uses its run's start revision.
 */
import { AGENT_REFUSAL_CODES, AGENT_RUN_ACTOR_PREFIX, summarizeNotUndone, type AgentStep, type NotUndoneItem, type UndoAllAnswer } from '@pulseframe/core';
import type { Governance, Principal } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';
import type { RunRepo } from './runs.ts';

export const SESSION_GAP_MINUTES = 30;

/** The revision BEFORE the actor's last continuous session (exclusive: undoActor reverses revisions > it). */
export function sessionSince(store: Store, projectId: string, actor: string): number {
  const rows = store.db.prepare('SELECT revision, created_at FROM transactions WHERE project_id = ? AND actor = ? ORDER BY revision DESC').all(projectId, actor) as { revision: number; created_at: string }[];
  if (!rows.length) return store.wholeProject(projectId).revision;
  let start = rows[0]!;
  for (const r of rows.slice(1)) {
    if (Date.parse(start.created_at) - Date.parse(r.created_at) > SESSION_GAP_MINUTES * 60_000) break;
    start = r;
  }
  return start.revision - 1;
}

/** C7 for an actor that is not a run: its export jobs since the first reversed transaction (the only non-op effect the server can count for it). */
function notUndoneOutside(store: Store, projectId: string, actor: string, since: number): NotUndoneItem[] {
  const first = store.db.prepare('SELECT created_at FROM transactions WHERE project_id = ? AND actor = ? AND revision > ? ORDER BY revision LIMIT 1').get(projectId, actor, since) as { created_at: string } | undefined;
  if (!first) return [];
  const n = (store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND actor = ? AND type = 'export' AND status = 'succeeded' AND created_at >= ?").get(projectId, actor, first.created_at) as { n: number }).n;
  return n ? [{ kind: 'export_file', count: n }] : [];
}
export const notUndoneOfSteps = (steps: readonly AgentStep[]): NotUndoneItem[] => summarizeNotUndone(steps);

export interface UndoDeps {
  store: Store;
  gov: Governance;
  runs: RunRepo;
  actsAsOwner: (p: Principal) => boolean;
  /** cancels the open jobs of an actor (through MCP cancel_job as that actor; asynchronous): returns the ids it was sent for */
  cancelOpenJobs: (projectId: string, actor: string) => string[];
}

function mayUndo(d: UndoDeps, p: Principal, actor: string, extraOwners: string[] = []): void {
  if (p.actor === actor || extraOwners.includes(p.actor) || d.actsAsOwner(p)) return;
  throw new ApiError(AGENT_REFUSAL_CODES.notYourActor.status, AGENT_REFUSAL_CODES.notYourActor.code, `${p.actor} may undo its own edits; ${actor}'s edits are undone from the owner's window or by an agent the open mode lets act as the owner`, { actor }, 'Ask the owner to press «ביטול הכול», or undo your own actor\'s edits.');
}
function undo(d: UndoDeps, p: Principal, projectId: string, actor: string, since: number, opts: { dryRun?: boolean; partial?: boolean }) {
  if (!opts.dryRun && p.kind === 'agent') d.gov.assertMayAct(p, projectId, 'edit'); // a paused project (423), a read-only credential
  return d.store.undoActor(projectId, actor, since, { byActor: p.actor, dryRun: opts.dryRun, partial: opts.partial });
}

/** «ביטול הכול» of one run. Its starter, its own actor and whoever acts as the owner may press it. */
export function undoAllRun(d: UndoDeps, p: Principal, projectId: string, runId: string, opts: { dryRun?: boolean; partial?: boolean }, stopRun: (runId: string) => void): UndoAllAnswer {
  const run = d.runs.get(runId, projectId);
  mayUndo(d, p, run.actor, [run.startedBy]);
  const notUndone = notUndoneOfSteps(d.runs.steps(run.id));
  let r;
  try { r = undo(d, p, projectId, run.actor, run.startRevision, opts); }
  catch (e) { if (e instanceof ApiError && e.code === 'undo_conflict') e.details = { ...e.details, notUndone }; throw e; }
  if (!opts.dryRun && run.undoneBy && !r.transactionId && !r.undoes.length)
    throw new ApiError(AGENT_REFUSAL_CODES.alreadyUndone.status, AGENT_REFUSAL_CODES.alreadyUndone.code, `run ${run.id} was already undone by ${run.undoneBy}`, { runId: run.id, transactionId: run.undoneBy, notUndone }, 'Redo that undo (Ctrl+Shift+Z in the editor) if you want the run\'s edits back.');
  let canceledJobs: string[] = [];
  if (!opts.dryRun) {
    stopRun(run.id); // a run still working is stopped first (the step in flight finishes; a later edit of it can be undone again)
    canceledJobs = d.cancelOpenJobs(projectId, run.actor);
    if (r.transactionId) d.runs.setUndoneBy(run.id, r.transactionId);
  }
  return { ...r, sinceRevision: run.startRevision, notUndone, canceledJobs };
}

/** Any actor since a revision (undo_actor_since, POST …/undo-actor). */
export function undoActorFor(d: UndoDeps, p: Principal, projectId: string, body: { actor: string; sinceRevision?: number; dryRun?: boolean; partial?: boolean }): UndoAllAnswer {
  mayUndo(d, p, body.actor);
  const run = body.actor.startsWith(AGENT_RUN_ACTOR_PREFIX) ? d.runs.byActor(body.actor) : null;
  const since = body.sinceRevision ?? (run ? run.startRevision : sessionSince(d.store, projectId, body.actor));
  const notUndone = run ? notUndoneOfSteps(d.runs.steps(run.id)) : notUndoneOutside(d.store, projectId, body.actor, since);
  let r;
  try { r = undo(d, p, projectId, body.actor, since, body); }
  catch (e) { if (e instanceof ApiError && e.code === 'undo_conflict') e.details = { ...e.details, notUndone }; throw e; }
  // the open jobs of a RUN are cancelled with its edits; an outside agent's jobs are its own to manage
  const canceledJobs = body.dryRun || !run ? [] : d.cancelOpenJobs(projectId, body.actor);
  if (run && r.transactionId) d.runs.setUndoneBy(run.id, r.transactionId);
  return { ...r, sinceRevision: since, notUndone, canceledJobs };
}
