/**
 * The routes of «מוזיקה שמתאימה לסרט» (wave 7 musicfit track; .artifacts/wave7/musicfit-decisions.md §4). The lead lands the permission
 * checks COMPLETE here; the bodies run after them (each answers 501 musicfit_not_built only while its flag below is false):
 * plan and apply by BUILDER B (musicfit/plan.ts, musicfit/apply.ts, with builder A's song fitter wired in at integration), the join preview and the heard mark by BUILDER A (musicfit/joinPreview.ts, musicfit/heard.ts).
 *
 * - plan (observe, read-only): POST /api/v1/projects/:id/music-fit/plan, MCP plan_music_fit.
 * - apply (edit; a propose-mode credential is refused: the fit adds a file to the library through an internal step a proposal does
 *   not carry; a grant limited to tracks or a range is refused; checked before making the file AND again before committing, as
 *   music.ts addMusic): POST …/music-fit/apply, MCP apply_music_fit. Two commits (ADR-0022): the made file, then ONE transaction.
 * - join preview (observe): GET …/music-fit/join.wav?assetId&from&to&startAt — the four bars around a removal, nothing stored.
 * - heard (the owner's own session only; no MCP tool): POST …/assets/:assetId/music-join/heard {heard} → internal mark_join_heard.
 */
import type { MusicFitApplyRequest, MusicFitApplyResult, MusicFitPlan, MusicFitPlanRequest } from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import type { Governance } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';
import { commitJoinHeard } from './heard.ts';
import { renderJoinPreview } from './joinPreview.ts';
import { prepareMusicFit } from './plan.ts';
import { applyMusicFit } from './apply.ts';
import { actsAsOwner } from '../autonomy.ts';

/**
 * True once plan and apply answer: builder B built them (musicfit/plan.ts, apply.ts) and integration wired builder A's join search
 * and splice into them (plan.ts builtSongFitter). Kept as a flag so a build can switch the routes back to the honest 501.
 */
export const MUSICFIT_SERVER_BUILT: boolean = true;
/** True once builder A has built the join preview and the heard mark. */
export const MUSICFIT_JOIN_BUILT = true;

/** Every refusal of the routes: status, code, fixed English, hint (Hebrew: packages/i18n/src/musicFit.ts HE_MUSICFIT). */
export const MUSICFIT_SERVER_REFUSALS = {
  notBuilt: { status: 501, code: 'musicfit_not_built', message: () => 'music that fits the film is not built in this build yet', hint: 'Update the editor and try again.' },
  proposeRefused: { status: 403, code: 'insufficient_scope', message: () => 'this credential may only propose edits, and fitting music adds a file to the library, which a proposal does not carry', hint: 'Ask the project owner, or for a grant in edit mode.' },
  notOwner: { status: 403, code: 'human_approval_required', message: () => 'only the project owner can mark a join as heard, from their own session', hint: 'Tell the owner which join to play; they mark it in the editor.' },
  needsBars: { status: 409, code: 'needs_bars', message: () => 'the song has no measured bar starts, so no whole bars can be removed', hint: 'Measure its beats, or end it with a fade (fit_music).' },
  noJoin: { status: 409, code: 'no_join', message: () => 'no place to join was found on the bar starts of this song', hint: 'End it with a fade (fit_music), or choose other music.' },
  tooShort: { status: 400, code: 'too_short', message: (seconds: string) => `the film is too short for this music: it needs at least ${seconds} s`, hint: 'Choose another style, or add pictures.' },
  tooLongBuiltin: { status: 400, code: 'too_long', message: () => 'built-in music is at most five minutes', hint: 'Shorten the film, or choose a song of the library.' },
  tooLongSong: { status: 400, code: 'too_long', message: () => 'a song longer than ten minutes is not shortened', hint: 'Choose a shorter song, or end it with a fade.' },
  notFromStart: { status: 409, code: 'not_from_start', message: () => 'built-in music is composed again from its start, and this clip does not start at the start of its file', hint: 'Drag the start of the clip to the start of its file, then try again.' },
  fitStale: { status: 409, code: 'fit_stale', message: () => 'the beats of the song changed since the plan', hint: 'Plan again.' },
  fitUnstable: { status: 409, code: 'fit_unstable', message: () => 'the second plan ended on another frame than the first, so nothing was changed', hint: 'Try again.' },
  flashGap: { status: 409, code: 'flash_gap', message: () => 'a cut this plan makes would come closer to another cut than the flash rule allows', hint: 'Choose slower music, or a calmer cutting pace.' },
} as const;
export type MusicFitServerRefusalKey = keyof typeof MUSICFIT_SERVER_REFUSALS;
export function musicFitApiError<K extends MusicFitServerRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof MUSICFIT_SERVER_REFUSALS)[K]['message']>): ApiError {
  const r = MUSICFIT_SERVER_REFUSALS[key] as { status: number; code: string; message: (...a: unknown[]) => string; hint: string };
  return new ApiError(r.status, r.code, r.message(...values), details, r.hint);
}

/** May this principal apply a music fit to this project now? (Checked before making a file and again before committing.) */
export function mayApplyMusicFit(gov: Governance, principal: Principal, projectId: string): void {
  gov.assertMayAct(principal, projectId, 'observe');
  if (principal.kind === 'agent' && principal.mode === 'propose') throw musicFitApiError('proposeRefused', { mode: 'propose' });
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'add media to the library');
}

/** POST …/music-fit/plan and MCP plan_music_fit (observe). */
export async function planMusicFitFor(store: Store, gov: Governance, principal: Principal, projectId: string, req: MusicFitPlanRequest): Promise<MusicFitPlan> {
  gov.assertMayAct(principal, projectId, 'observe');
  const p = store.getProject(projectId);
  if (!MUSICFIT_SERVER_BUILT) throw musicFitApiError('notBuilt', {});
  return (await prepareMusicFit(store, projectId, p.doc, p.revision, req)).plan;
}
/** POST …/music-fit/apply and MCP apply_music_fit. */
export async function applyMusicFitFor(store: Store, gov: Governance, principal: Principal, projectId: string, req: MusicFitApplyRequest): Promise<MusicFitApplyResult> {
  mayApplyMusicFit(gov, principal, projectId);
  store.getProject(projectId);
  if (!MUSICFIT_SERVER_BUILT) throw musicFitApiError('notBuilt', {});
  return applyMusicFit(store, gov, principal, projectId, req);
}
/** GET …/music-fit/join.wav (observe): WAV bytes of the four bars around a removal. Nothing is stored. */
export async function musicJoinPreviewFor(store: Store, gov: Governance, principal: Principal, projectId: string, q: { assetId: string; from: string; to: string; startAt?: string }, signal?: AbortSignal): Promise<Buffer> {
  gov.assertMayAct(principal, projectId, 'observe');
  store.getProject(projectId);
  return renderJoinPreview(store, projectId, q, signal);
}
/**
 * POST …/assets/:assetId/music-join/heard: only the owner's own session (a person who listened). Every agent credential, whatever its
 * grant, is refused before anything else; there is no MCP tool and the op is internal (apply_transaction refuses it).
 */
export function refuseHeardByAgent(principal: Principal, assetId: string): void {
  if (!actsAsOwner(principal)) throw musicFitApiError('notOwner', { assetId });
}
export function markJoinHeardFor(store: Store, gov: Governance, principal: Principal, projectId: string, assetId: string, heard: boolean): unknown {
  refuseHeardByAgent(principal, assetId);
  gov.assertMayAct(principal, projectId, 'edit');
  store.getProject(projectId);
  return commitJoinHeard(gov, principal, projectId, assetId, heard);
}
