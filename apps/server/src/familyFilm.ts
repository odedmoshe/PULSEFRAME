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
 * - Regeneration passes the run's tracks by role (filmRunTracks) and the previous mix (ownSound and whether there was music),
 *   and keeps the run's tracks in the new run record, so a regenerated film uses its own tracks again instead of adding more.
 * - The age refusal is checked on the request's texts before planning AND on the plan's own title steps before committing
 *   (refuseAgesInPlan): only a step that turns live fields on can show an age.
 * - While the planner is not built (core FAMILY_FILM_BUILT false) every call answers 501 film_not_built, after the permission
 *   checks; nothing is planned or changed.
 * Every refusal's English sentence is fixed here (FILM_API_ERRORS); the Hebrew wording is packages/i18n/src/familyFilm.ts.
 */
import * as T from '@pulseframe/time';
import {
  clipEnd, derivedRanges, filmRunRemovedPicks, eventNeedsSunsetAnswer, eventOfAsset, escapeFieldText, FAMILY_FILM_BUILT, FAMILY_FILM_DRAFT_LABEL, FAMILY_FILM_RUN_RECIPE_ID, FAMILY_FILM_TEMPLATE_ID, FAMILY_FILM_VERSION, FilmError, filmRunParams,
  findClip, isPersonToken, parseFields, planFamilyFilm, shownCapture,
  type FamilyFilmApplyResult, type RecipeRun, type TemplateStep, type Track, type FamilyFilmParams, type FamilyFilmPlan, type FamilyFilmPlanView, type FamilyFilmRegenerateResult, type FilmKeptClip, type FilmPlanContext, type FilmText, type ProjectDocument, type RegenerateOptions, type RunRange, type SlotRecord, filmRegenerationRemoved, filmRunRecordParams,
} from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { peopleAccess, PEOPLE_SCOPE_REQUIRED } from './peoplePrivacy.ts';
import { ApiError, type Store } from './store.ts';
import { runHandEdits, withoutClips } from './templates.ts';

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
/**
 * The same refusal on what the plan would actually commit: a title step that turns live fields on (add_text fields: true, or
 * set_text_fields enabled: true on a step bound earlier) over a text holding an {age:…} field. A text added without fields is
 * shown as it is (an event name '{age:p1}' stays plain text), so it is not refused. Exported for its unit test.
 */
export function refuseAgesInPlan(principal: Principal, ops: readonly TemplateStep[]) {
  if (peopleAccess(principal) === 'full') return;
  const textOf = new Map<string, unknown>();
  for (const step of ops) {
    const a = isObject(step.args) ? step.args : {};
    if (step.op === 'add_text' && step.bind !== undefined) textOf.set(step.bind, a.text);
    const ref = isObject(a.clipId) && typeof a.clipId.$ref === 'string' ? a.clipId.$ref : undefined;
    if (step.op === 'update_text' && ref !== undefined && typeof a.text === 'string') textOf.set(ref, a.text);
    const on = (step.op === 'add_text' && a.fields === true && holdsAgeField(a.text)) || (step.op === 'set_text_fields' && a.enabled === true && ref !== undefined && holdsAgeField(textOf.get(ref)));
    if (on) throw FILM_API_ERRORS.ages();
  }
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
  // typed text is in the field grammar; without a field it is added without fields, so its doubled braces are undone here
  if (!parts.some((p) => 'token' in p)) return { text: parts.map((p) => ('literal' in p ? p.literal : '')).join(''), live: false, resolved: null };
  return { text: typed, live: true, resolved: null };
}
/**
 * The context the planner needs that is not in its parameters (FilmPlanContext), built from the document `doc` (the one the
 * credential may read). Capture times are the life line's shown captures (own-property lookups; unknown ids are left out).
 * The default opening title holds live fields ({event} when the chosen event has a name, {hebrewDate}) only when EVERY chosen
 * file has a capture date and none of their events waits for its sunset answer; otherwise it is fixed text (the planner then
 * warns title_resolved_static).
 */
export function filmContext(doc: ProjectDocument, params: unknown, extra: Pick<FilmPlanContext, 'kept' | 'keptKeys' | 'removedKeys' | 'removedPicks' | 'previousCut' | 'reuseTracks' | 'previousOwnSound' | 'previousMusic' | 'movedKeys'> = {}): FilmPlanContext {
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
  refuseAgesInPlan(principal, plan.ops);
  refuseBlocked(plan);
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Family film: ${plan.steps[0] ?? ''}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: FAMILY_FILM_VERSION, params: filmRunRecordParams(plan, []), steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true } }],
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
 * The film's tracks, by role, as the planner reuses them (FilmPlanContext.reuseTracks), from the document as it is before the
 * run's untouched clips are removed. A role is found from the clips the run placed (its slots), on ANY track of the document:
 * the pictures track holds the picture slots' clips, the music track the music slot's clip, the own-sound track the sound clips
 * linked to the picture slots' clips. A track the planner reused (an empty A1 or V1 that was already in the project) holds the
 * film's clips although no step reported its id, so it is not among run.createdIds; regeneration finds it here and records it
 * in the new run (filmRegeneration's keepIds). When clips were moved by hand to another track, the track holding the most of
 * them wins (ties: a track the run made, then document order). A single track the run made that is left over (its clips were
 * deleted by hand) takes the single role left that the previous run had. Only tracks still in the document are named; ids are
 * compared, never used as plain-object keys.
 */
export function filmRunTracks(doc: ProjectDocument, run: Pick<RecipeRun, 'createdIds' | 'slots' | 'params'>): NonNullable<FilmPlanContext['reuseTracks']> {
  const made = new Set(run.createdIds);
  const all: Track[] = Object.values(doc.sequences).flatMap((q) => q.tracks);
  const slots = run.slots ?? [];
  const pictureClips = new Set(slots.filter((x) => x.kind === 'picture').map((x) => x.clipId));
  const musicClips = new Set(slots.filter((x) => x.kind === 'music').map((x) => x.clipId));
  const groups = new Set(all.flatMap((t) => t.clips.flatMap((c) => (pictureClips.has(c.id) && c.type === 'media' && c.linkGroupId ? [c.linkGroupId] : []))));
  /** The track of `kind` holding the most clips that `counts` (ties: made by the run, then document order), if any holds one. */
  const most = (kind: Track['kind'], counts: (c: Track['clips'][number]) => boolean, not?: string) => {
    let best: Track | undefined, bestN = 0;
    for (const t of all) {
      if (t.kind !== kind || t.id === not) continue;
      const k = t.clips.filter(counts).length;
      if (k > bestN || (k === bestN && k > 0 && best && !made.has(best.id) && made.has(t.id))) { best = t; bestN = k; }
    }
    return best;
  };
  const out: NonNullable<FilmPlanContext['reuseTracks']> = {};
  const madeOf = (kind: Track['kind']) => all.filter((t) => t.kind === kind && made.has(t.id));
  const pictures = most('video', (c) => pictureClips.has(c.id)) ?? (madeOf('video').length === 1 ? madeOf('video')[0] : undefined);
  if (pictures) out.pictures = pictures.id;
  const music = most('audio', (c) => musicClips.has(c.id));
  if (music) out.musicTrack = music.id;
  const own = most('audio', (c) => c.type === 'media' && !!c.linkGroupId && groups.has(c.linkGroupId) && !pictureClips.has(c.id), out.musicTrack);
  if (own) out.ownSound = own.id;
  const left = madeOf('audio').filter((t) => t.id !== out.musicTrack && t.id !== out.ownSound);
  const hadMusic = typeof run.params.musicAssetId === 'string', hadOwn = run.params.ownSound !== 'mute';
  const roles = [...(hadOwn && !out.ownSound ? ['ownSound' as const] : []), ...(hadMusic && !out.musicTrack ? ['musicTrack' as const] : [])];
  if (left.length === 1 && roles.length === 1) out[roles[0]!] = left[0]!.id;
  return out;
}

/**
 * The places of a film run that recorded none (made before run.ranges): the film's own plan made again from the run's stored
 * parameters on the document without the run's clips, with the run's tracks by role and what had been deleted by hand before
 * that run (slot records whose clip the run did not make or keep). Undefined when the film version changed or the planner
 * refuses now. Only a clip whose fingerprint agrees with a place found here counts as moved (core movedOnly, then the same
 * closed-gap test as for a run that recorded its places), so a plan that comes out differently (other measured moments, a clip
 * that was kept then) simply finds nothing: such clips stay kept, as before.
 */
function filmRunPlaces(doc: ProjectDocument, run: RecipeRun, live: readonly string[]): Record<string, RunRange> | undefined {
  if (run.params.templateVersion !== FAMILY_FILM_VERSION) return undefined;
  const own = filmRunParams(run.params), base = withoutClips(doc, live);
  const carried = (run.slots ?? []).filter((x) => !run.createdIds.includes(x.clipId));
  const previousOwnSound = own.ownSound === 'lead' || own.ownSound === 'mute' || own.ownSound === 'under' ? own.ownSound : undefined;
  try {
    const plan = planFamilyFilm(base, own, filmContext(base, own, { removedKeys: carried.map((x) => x.key), removedPicks: filmRunRemovedPicks(run.params), reuseTracks: filmRunTracks(doc, run), previousOwnSound, previousMusic: typeof own.musicAssetId === 'string' }));
    return derivedRanges(doc, plan, run);
  } catch (e) {
    if (e instanceof FilmError || e instanceof ApiError) return undefined;
    throw e;
  }
}

/**
 * What a regeneration starts from (pure; exported for its unit test): the run's clips still in the document, those edited by
 * hand (kept, with their link partners and slots), the document without the others, the planner's context (kept clips, kept
 * keys, the run's tracks by role, the previous mix) and the ids the new run record keeps (kept clips and the run's tracks that
 * still exist, so the tracks stay the film's own for the next regeneration whether or not this plan uses them again).
 * A clip that moved earlier only because a delete before it closed the gap is not edited by hand (ADR-0026, amendment of
 * 2026-11-24; runHandEdits with core closedGapOnly): it goes with the untouched clips and the film is laid out again, so one
 * Delete that closes the gap no longer freezes every later pick where the delete left it. Its key is passed on as movedKeys
 * (warning moved_back). A clip moved in any other way was dragged by hand: kept, and the film is laid around it, as before.
 */
export function filmRegeneration(doc: ProjectDocument, run: RecipeRun, params: Record<string, unknown>, options: RegenerateOptions = {}) {
  const live = run.createdIds.filter((id) => !!findClip(doc, id));
  const { protectedIds, movedBack } = runHandEdits(doc, run, live, run.ranges ? undefined : filmRunPlaces(doc, run, live), 'closed-gap');
  const removable = live.filter((id) => !protectedIds.includes(id));
  const keptSlots = (run.slots ?? []).filter((s) => protectedIds.includes(s.clipId));
  const movedKeys = (run.slots ?? []).filter((s) => movedBack.includes(s.clipId)).map((s) => s.key);
  // slots whose clip was deleted by hand travel on in the new run record (so the next regeneration still knows), unless restored;
  // with them what each deleted pick showed, the mix the run left and how it was cut (core filmRegenerationRemoved)
  const { removedSlots, removedPicks, previousMusic, previousCut } = filmRegenerationRemoved(doc, run, options.restoreRemoved);
  const keepSlots = [...keptSlots, ...removedSlots];
  const without = withoutClips(doc, removable);
  const previousOwnSound = run.params.ownSound === 'lead' || run.params.ownSound === 'mute' || run.params.ownSound === 'under' ? run.params.ownSound : undefined;
  const reuseTracks = filmRunTracks(doc, run);
  const trackIds = new Set(Object.values(doc.sequences).flatMap((q) => q.tracks.map((t) => t.id)));
  // the run's tracks that still exist, and the tracks found by role (a reused A1 too), so they are the film's own from now on
  const keepIds = [...new Set([...protectedIds, ...run.createdIds.filter((id) => trackIds.has(id)), ...Object.values(reuseTracks).filter((id): id is string => typeof id === 'string')])];
  const ctx = filmContext(without, params, { kept: keptClips(doc, protectedIds, run.slots ?? []), keptKeys: keptSlots.map((s) => s.key), removedKeys: removedSlots.map((s) => s.key), removedPicks, previousCut, reuseTracks, previousOwnSound, previousMusic, ...(movedKeys.length ? { movedKeys } : {}) });
  return { removable, protectedIds, keepSlots, removedSlots, removedPicks, keepIds, without, ctx, movedKeys };
}

/**
 * Regenerate a film run, optionally with changed parameters («רגעים אחרים», «אורך אחר»): clips the run made that nobody
 * changed are replaced; clips edited by hand since (and the clips linked to them) are kept exactly as they are, with their
 * slots — a clip moved by hand too (the planner lays the new slots around it). A clip that moved earlier only because a delete
 * before it closed the gap is not edited by hand: it is replaced with the untouched ones (warning moved_back). Works from the
 * document's run after a reload.
 * A clip deleted by hand is not made again (its file is left out, a title, card or music is not placed; warning removed_by_hand)
 * unless `restoreRemoved` is set: the explicit choice the plan's alternatives offer.
 */
export async function regenerateFamilyFilmFor(store: Store, gov: Governance, principal: Principal, projectId: string, runId: string, newParams?: unknown, expectedRevision?: number, options: RegenerateOptions = {}): Promise<FamilyFilmRegenerateResult> {
  mayApply(gov, principal, projectId);
  if (newParams !== undefined && !isObject(newParams)) throw FILM_API_ERRORS.badParams();
  const p = store.getProject(projectId);
  const run = own(p.doc.recipeRuns, runId);
  if (!run || run.recipeId !== FAMILY_FILM_RUN_RECIPE_ID) throw FILM_API_ERRORS.runNotFound(runId);
  const params: Partial<FamilyFilmParams> & Record<string, unknown> = { ...filmRunParams(run.params), ...(newParams as Record<string, unknown> | undefined) };
  refuseAges(principal, params);
  refuseNotBuilt();
  const { removable, protectedIds, keepSlots, removedSlots, removedPicks, keepIds, without, ctx, movedKeys } = filmRegeneration(p.doc, run, params, options);
  const plan = wrap(() => planFamilyFilm(without, params, ctx));
  refuseAgesInPlan(principal, plan.ops);
  // a new slot never takes a key a kept slot holds (apply_template drops a slot only when key AND clip match): a planner fault, not the request's
  const clash = plan.slots.find((s) => keepSlots.some((k) => k.key === s.key));
  if (clash) throw FILM_API_ERRORS.keyClash(clash.key);
  refuseBlocked(plan);
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Regenerate family film: ${plan.steps[0] ?? ''}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { runId, templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: FAMILY_FILM_VERSION, params: filmRunRecordParams(plan, removedPicks), steps: plan.steps, removeClipIds: removable, keepIds, keepSlots, ops: plan.ops, slots: plan.slots, recordRanges: true } }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return { revision: r.revision, runId, createdIds: out.createdIds ?? [], slots: out.slots ?? [], steps: plan.steps, warnings: plan.warnings, picks: plan.picks, excluded: plan.excluded, replaced: removable.length, protected: protectedIds, removed: removedSlots.map((s) => s.key), movedBack: movedKeys, alternatives: plan.alternatives };
}
