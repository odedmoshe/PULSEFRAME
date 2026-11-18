/**
 * The family film on the server (wave 5, ADR-0026), mirroring templates.ts: plan (read-only), apply (ONE internal
 * apply_template committed through governance against the revision the plan was built from), regenerate (replace what the last
 * run made and nobody touched; keep what was edited by hand, by content fingerprint). Reached through the recipe routes and the
 * MCP recipe tools (recipes.ts dispatches recipe 'family-film' and runs 'template:tpl.family-film' here; templates.ts sends a
 * film run's regeneration here too). Heuristic; no model; faces are not used.
 *
 * - The planner (core planFamilyFilm) is pure; this module builds its context (FilmPlanContext) from the document: capture times
 *   from the life line (shownCapture), the titles (live fields only when every chosen file has a capture date and no event
 *   waits for its sunset answer, so a title never blocks an export with a field without data), the kept clips on regeneration.
 * - Agents in propose mode are refused (403 insufficient_scope) and so is a grant limited to tracks or a time range (403
 *   out_of_scope), as for templates: the film is applied through an internal op that a proposal cannot carry.
 * - CHILDREN'S DATA: planning reads the document the credential may read (Store.getProject under readingAs: names only for an
 *   agent without the people scope). Such a credential is refused (403 people_scope_required) a film whose opening or closing
 *   text holds an {age:…} field, at plan, apply and regenerate, so an agent cannot produce a film with ages.
 * - While the planner is not built (core FAMILY_FILM_BUILT false) every call answers 501 film_not_built, after the permission
 *   checks; nothing is planned or changed.
 * Every refusal's English sentence is fixed here (FILM_API_ERRORS); the Hebrew wording is packages/i18n/src/familyFilm.ts.
 */
import * as T from '@pulseframe/time';
import {
  clipEnd, eventNeedsSunsetAnswer, eventOfAsset, escapeFieldText, FAMILY_FILM_BUILT, FAMILY_FILM_DRAFT_LABEL, FAMILY_FILM_RUN_RECIPE_ID, FAMILY_FILM_TEMPLATE_ID, FAMILY_FILM_VERSION, FilmError, filmRunParams,
  findClip, isPersonToken, parseFields, planFamilyFilm, shownCapture,
  type FamilyFilmApplyResult, type FamilyFilmParams, type FamilyFilmPlan, type FamilyFilmPlanView, type FamilyFilmRegenerateResult, type FilmKeptClip, type FilmPicked, type FilmPlanContext, type FilmText, type ProjectDocument, type SlotRecord,
} from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { peopleAccess, PEOPLE_SCOPE_REQUIRED } from './peoplePrivacy.ts';
import { ApiError, type Store } from './store.ts';
import { keptByHand } from './templates.ts';

/** The fixed refusals of the family film routes (their Hebrew wording: i18n familyFilm.ts HE_FAMILY_FILM). */
export const FILM_API_ERRORS = {
  notBuilt: () => new ApiError(501, 'film_not_built', 'the family film maker is not built in this version yet', {}, 'Nothing was changed. Recipes and templates still work.'),
  propose: () => new ApiError(403, 'insufficient_scope', 'this credential may only propose edits, and a family film cannot be proposed: it is applied through an internal step that a proposal does not carry', { mode: 'propose' }, 'Ask the project owner to make the film, or for a grant in edit mode. The plan still shows what it would do.'),
  ages: () => new ApiError(403, PEOPLE_SCOPE_REQUIRED, 'this credential may not make a film whose titles show an age: an age is computed from a birth date', {}, 'Leave the age field out of the title text ({name:…} is allowed), or ask the owner to make the film.'),
  badTitle: (fields: string) => new ApiError(400, 'invalid_request', `the title text has brace groups that are not fields: ${fields}`, {}, 'Choose a field such as {hebrewDate} or {event}, or double the braces to show them as text.'),
  blocked: (first: string, blocking: unknown) => new ApiError(409, 'film_blocked', `the film cannot be made like this: ${first}`, { blocking }, 'See the plan: choose another length, other music or other clips.'),
  runNotFound: (runId: string) => new ApiError(404, 'not_found', `family film run ${runId} not found`, { runId }, 'A film run id is returned by apply (runId).'),
  badParams: () => new ApiError(400, 'invalid_request', 'params must be an object of family film parameters to change'),
  keyClash: (key: string) => new ApiError(500, 'invalid_result', `the film plan gave a new slot the key ${key}, which a clip kept by hand holds`, { key }, 'This is a fault in this build; nothing was changed.'),
} as const;

const STATUS: Record<FilmError['code'], number> = { not_found: 404, needs_analysis: 409, invalid_args: 400, nothing_to_do: 409 };
const CODE: Record<FilmError['code'], string> = { not_found: 'not_found', needs_analysis: 'needs_analysis', invalid_args: 'invalid_request', nothing_to_do: 'nothing_to_do' };
const wrap = <R>(fn: () => R): R => {
  try { return fn(); } catch (e) {
    if (e instanceof FilmError) throw new ApiError(STATUS[e.code], CODE[e.code], e.message, {}, e.hint);
    throw e;
  }
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = <V>(rec: Readonly<Record<string, V>> | undefined, key: string): V | undefined => (rec && Object.hasOwn(rec, key) ? rec[key] : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** True when a title text holds an {age:…} field (refused to a credential without the people scope). */
export function holdsAgeField(text: unknown): boolean {
  return typeof text === 'string' && parseFields(text).some((p) => 'token' in p && isPersonToken(p.token) && p.token.name === 'age');
}
function refuseAges(principal: Principal, params: unknown) {
  if (peopleAccess(principal) === 'full' || !isObject(params)) return;
  if (holdsAgeField(params.openingText) || holdsAgeField(params.closingText)) throw FILM_API_ERRORS.ages();
}
/** Checks before a film may change a project: the grant covers the project, edit rights (propose mode refused), no track/range limit. */
function mayApply(gov: Governance, principal: Principal, projectId: string) {
  gov.assertMayAct(principal, projectId, 'observe');
  if (principal.kind === 'agent' && principal.mode === 'propose') throw FILM_API_ERRORS.propose();
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'make a family film (it adds tracks, clips and a run record)');
}
const refuseNotBuilt = () => { if (!FAMILY_FILM_BUILT) throw FILM_API_ERRORS.notBuilt(); };

// ---------- the planner's context ----------
const DEFAULT_TEXT = { closing: { he: 'סוף', en: 'The end' }, opening: { he: 'הסרט שלנו', en: 'Our film' } } as const;
/** A title of the film from what the person typed (fields allowed) or from the event; live only when its fields have data. */
function filmText(typed: string | undefined, fallback: () => { text: string; live: boolean }): FilmText {
  if (typed === undefined) return { ...fallback(), resolved: null };
  const parts = parseFields(typed);
  const bad = parts.flatMap((p) => ('bad' in p ? [p.bad] : []));
  if (bad.length) throw FILM_API_ERRORS.badTitle(bad.join(', '));
  return { text: typed, live: parts.some((p) => 'token' in p), resolved: null };
}
/**
 * The context the planner needs that is not in its parameters (FilmPlanContext), built from the document `doc` (the one the
 * credential may read). Capture times are the life line's shown captures (own-property lookups; unknown ids are left out).
 * The default opening title holds live fields ({event} when the chosen event has a name, {hebrewDate}) only when EVERY chosen
 * file has a capture date and none of their events waits for its sunset answer; otherwise it is fixed text (the planner then
 * warns title_resolved_static).
 */
export function filmContext(doc: ProjectDocument, params: unknown, extra: Pick<FilmPlanContext, 'kept' | 'keptKeys' | 'reuseTracks' | 'previousOwnSound'> = {}): FilmPlanContext {
  const p = isObject(params) ? params : {};
  const ids = strings(p.assetIds).filter((id) => Object.hasOwn(doc.assets, id));
  const capture: Record<string, string | null> = {};
  for (const id of ids) Object.defineProperty(capture, id, { value: shownCapture(doc, id)?.wall ?? null, enumerable: true, writable: true, configurable: true });
  const lang = p.lang === 'en' ? 'en' : 'he';
  const allDated = ids.length > 0 && ids.every((id) => capture[id] !== null);
  const sunsetOpen = ids.some((id) => { const e = eventOfAsset(doc, id); return !!e && eventNeedsSunsetAnswer(doc, e); });
  const ev = isObject(p.event) ? p.event : null;
  const docEvent = ev && typeof ev.id === 'string' ? own(doc.events, ev.id) : undefined;
  const eventName = ev && typeof ev.name === 'string' ? ev.name : null;
  const opening = filmText(typeof p.openingText === 'string' ? p.openingText : undefined, () => {
    if (allDated && !sunsetOpen) return { text: docEvent && docEvent.name ? '{event} · {hebrewDate}' : eventName ? `${escapeFieldText(eventName)} · {hebrewDate}` : '{hebrewDate}', live: true };
    return { text: eventName ?? DEFAULT_TEXT.opening[lang], live: false };
  });
  const closing = filmText(typeof p.closingText === 'string' ? p.closingText : undefined, () => ({ text: DEFAULT_TEXT.closing[lang], live: false }));
  return { capture, title: p.openingTitle === false ? null : opening, closing: p.closingCard === false ? null : closing, ...extra };
}

const NOTE = 'Nothing was changed. Apply it to make the film as one undoable step; everything it makes stays an ordinary editable clip.';
const view = (revision: number, plan: FamilyFilmPlan): FamilyFilmPlanView => {
  const { ops: _o, slots: _s, ...rest } = plan;
  return { ...rest, revision, operations: plan.ops.length, label: FAMILY_FILM_DRAFT_LABEL, note: plan.blocking.length ? 'Nothing was changed. This plan cannot be applied as it is: see blocking.' : NOTE };
};
const refuseBlocked = (plan: FamilyFilmPlan) => { if (plan.blocking.length) throw FILM_API_ERRORS.blocked(plan.blocking[0]!.message, plan.blocking); };
const picked = (plan: FamilyFilmPlan): FilmPicked[] => plan.picks.map((k) => ({ key: k.key, assetId: k.assetId, kind: k.kind, windowIndex: k.windowIndex, reasons: k.reasons }));
type CommitOut = { revision: number; results?: { output?: { runId?: string; createdIds?: string[]; slots?: SlotRecord[] } }[] };

/** Read-only: what the film would be in this project now, and at which revision. */
export async function planFamilyFilmFor(store: Store, gov: Governance, principal: Principal, projectId: string, params: unknown): Promise<FamilyFilmPlanView> {
  gov.assertMayAct(principal, projectId, 'observe');
  refuseAges(principal, params);
  refuseNotBuilt();
  const p = store.getProject(projectId);
  return view(p.revision, wrap(() => planFamilyFilm(p.doc, params, filmContext(p.doc, params))));
}

/** Apply: plan against the current revision and commit ONE apply_template against exactly that revision (or `expectedRevision`). */
export async function applyFamilyFilmFor(store: Store, gov: Governance, principal: Principal, projectId: string, params: unknown, expectedRevision?: number): Promise<FamilyFilmApplyResult> {
  mayApply(gov, principal, projectId);
  refuseAges(principal, params);
  refuseNotBuilt();
  const p = store.getProject(projectId);
  const plan = wrap(() => planFamilyFilm(p.doc, params, filmContext(p.doc, params)));
  refuseBlocked(plan);
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Family film: ${plan.steps[0] ?? ''}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: FAMILY_FILM_VERSION, params: { ...plan.params, picked: picked(plan) }, steps: plan.steps, ops: plan.ops, slots: plan.slots } }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return { revision: r.revision, runId: out.runId ?? '', createdIds: out.createdIds ?? [], slots: out.slots ?? [], steps: plan.steps, warnings: plan.warnings, picks: plan.picks, excluded: plan.excluded };
}

/** The kept clips of a run as the planner sees them (occupied intervals, their slot keys and kinds), in project frames. */
function keptClips(doc: ProjectDocument, protectedIds: readonly string[], slots: readonly SlotRecord[]): FilmKeptClip[] {
  const rate = doc.settings.frameRate;
  return protectedIds.flatMap((id) => {
    const f = findClip(doc, id);
    if (!f) return [];
    const slot = slots.find((s) => s.clipId === id);
    const kind: FilmKeptClip['kind'] = slot?.kind === 'text' ? 'text' : slot?.kind === 'music' ? 'music' : f.track.kind === 'audio' ? 'sound' : 'picture';
    return [{ key: slot?.key ?? null, clipId: id, assetId: f.clip.type === 'media' ? f.clip.assetId : null, kind, startFrame: T.nearestFrameIndex(f.clip.start, rate), endFrame: T.nearestFrameIndex(clipEnd(f.clip), rate) }];
  });
}

/**
 * Regenerate a film run, optionally with changed parameters («רגעים אחרים», «אורך אחר»): clips the run made that nobody
 * changed are replaced; clips edited by hand since (and the clips linked to them) are kept exactly as they are, with their
 * slots — a moved kept clip too (the planner lays the new slots around it). Works from the document's run after a reload.
 */
export async function regenerateFamilyFilmFor(store: Store, gov: Governance, principal: Principal, projectId: string, runId: string, newParams?: unknown, expectedRevision?: number): Promise<FamilyFilmRegenerateResult> {
  mayApply(gov, principal, projectId);
  if (newParams !== undefined && !isObject(newParams)) throw FILM_API_ERRORS.badParams();
  const p = store.getProject(projectId);
  const run = own(p.doc.recipeRuns, runId);
  if (!run || run.recipeId !== FAMILY_FILM_RUN_RECIPE_ID) throw FILM_API_ERRORS.runNotFound(runId);
  const params: Partial<FamilyFilmParams> & Record<string, unknown> = { ...filmRunParams(run.params), ...(newParams as Record<string, unknown> | undefined) };
  refuseAges(principal, params);
  refuseNotBuilt();
  const live = run.createdIds.filter((id) => !!findClip(p.doc, id));
  const protectedIds = keptByHand(p.doc, live, run.fingerprints ?? {});
  const removable = live.filter((id) => !protectedIds.includes(id));
  const keepSlots = (run.slots ?? []).filter((s) => protectedIds.includes(s.clipId));
  const without = structuredClone(p.doc);
  for (const id of removable) { const f = findClip(without, id); if (f) f.track.clips.splice(f.index, 1); }
  const previousOwnSound = run.params.ownSound === 'lead' || run.params.ownSound === 'mute' || run.params.ownSound === 'under' ? run.params.ownSound : undefined;
  const ctx = filmContext(without, params, { kept: keptClips(p.doc, protectedIds, run.slots ?? []), keptKeys: keepSlots.map((s) => s.key), previousOwnSound });
  const plan = wrap(() => planFamilyFilm(without, params, ctx));
  // a new slot never takes a key a kept slot holds (apply_template drops a slot only when key AND clip match): a planner fault, not the request's
  const clash = plan.slots.find((s) => keepSlots.some((k) => k.key === s.key));
  if (clash) throw FILM_API_ERRORS.keyClash(clash.key);
  refuseBlocked(plan);
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Regenerate family film: ${plan.steps[0] ?? ''}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { runId, templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: FAMILY_FILM_VERSION, params: { ...plan.params, picked: picked(plan) }, steps: plan.steps, removeClipIds: removable, keepIds: protectedIds, keepSlots, ops: plan.ops, slots: plan.slots } }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return { revision: r.revision, runId, createdIds: out.createdIds ?? [], slots: out.slots ?? [], steps: plan.steps, warnings: plan.warnings, picks: plan.picks, excluded: plan.excluded, replaced: removable.length, protected: protectedIds };
}
