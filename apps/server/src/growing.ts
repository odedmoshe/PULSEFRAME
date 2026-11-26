/**
 * «גדלים מול העיניים» on the server (wave 8 growing; W2). Mirrors story.ts: plan (read-only), apply (ONE internal apply_template
 * committed through governance against the revision the plan was built from, recordRanges), rebuild (runHandEdits(…, 'any-move'):
 * hand edits kept, a pick only moved in time goes back, a deleted pick stays out unless restoreRemoved AND it is marked again).
 * Reached through the existing recipe routes and MCP recipe tools: recipes.ts dispatches recipe 'growing' and runs
 * 'template:tpl.growing' here, templates.ts sends such a run's regeneration here too. No new route, no new tool.
 *
 * OWNER'S OWN SESSION ONLY (decisions; verifier C8 "Kept"; lead decision of wave 8: the STRICT check): every call answers 403
 * owner_required to anything that is not the owner's own browser session (assistant/contract.ts isOwnerSession: kind 'user' AND
 * actor 'user:local', as the booth routes and the «שמעתי» mark use), before the body is looked at, so no agent supplies eye points
 * worked out from stills. Then the edit rights (gov.assertMayAct(…, 'edit')).
 * THE EYES ARE REQUEST DATA ONLY: GrowingParams.picks[].eyes are read here and passed to the planner; they are never echoed in an
 * answer (the plan view's params are the run record), never committed (the run record is growingRunRecordParams, built again here
 * key by key from the plan), never written to a log line, an error's details or the event stream. A planner refusal keeps its fixed
 * sentence and hint and drops its details. growing.test.ts plants a coordinate and looks for it in the stored document, the events,
 * the transactions, the entity versions, the summary, archives, named versions, MCP resources and the server's console output.
 * A rebuild derives an untouched pick's eyes from its clip's current transform (core eyesFromTransform, with the RUN's face size
 * and eye line: the target that transform was solved for); a pick edited by hand is kept as it is; a pick deleted by hand comes back
 * only with restoreRemoved and eyes in the request (else it stays out and the answer names it needs_marks).
 * Every refusal's English sentence is fixed (GROWING_API_ERRORS, core GROWING_REFUSALS); the Hebrew is packages/i18n/src/growing.ts.
 */
import {
  eyesFromTransform, findClip, GROWING, GROWING_RUN_RECIPE_ID, GROWING_TEMPLATE_ID, GROWING_VERSION, GrowingError, GrowingRebuildParamsSchema, growingPickKey,
  growingRefusal, growingRunPicked, growingRunRecordParams, planGrowing, removedByHand, shownCapture,
  type Asset, type EyePoint, type GrowingApplyResult, type GrowingExclusion, type GrowingFrame, type GrowingPickInput, type GrowingPicked, type GrowingPlan,
  type GrowingPlanContext, type GrowingPlanView, type GrowingRegenerateResult, type ProjectDocument, type RecipeRun, type RegenerateOptions, type ShownSize, type SlotRecord, type Track,
} from '@pulseframe/core';
import { isOwnerSession } from './assistant/contract.ts';
import type { Principal } from './auth.ts';
import { filmRunTracks } from './familyFilm.ts';
import type { Governance } from './governance.ts';
import { ApiError, type Store } from './store.ts';
import { actsAsOwner } from './autonomy.ts';
import { runHandEdits, withoutClips } from './templates.ts';

/** True once the bodies below are built (W2 flipped it). A planner that is not built yet still answers 501 growing_not_built. */
export const GROWING_SERVER_BUILT: boolean = true;

/** The fixed refusals of the growing calls (Hebrew: i18n growing.ts HE_GROWING; growing-wording.test.ts provokes each). */
export const GROWING_API_ERRORS = {
  ownerRequired: () => new ApiError(403, 'owner_required', 'growing up before your eyes is made from the owner\'s own session only', {}, 'The owner makes it in the editor on this computer; an agent cannot plan, apply or rebuild it.'),
  notBuilt: () => new ApiError(501, 'growing_not_built', 'growing up before your eyes is not built in this version yet', {}, 'Nothing was changed. The family film, the story and templates still work.'),
  runNotFound: (runId: string) => new ApiError(404, 'not_found', `growing run ${runId} not found`, { runId }, 'A growing run id is returned by apply (runId).'),
} as const;
export type GrowingApiErrorKey = keyof typeof GROWING_API_ERRORS;

/**
 * The first check of every growing call: the credential may see the project, and it is the owner's own session (isOwnerSession:
 * kind 'user' and actor 'user:local'; auth.ts issues no other user principal today, grants are always kind 'agent'). Exported for
 * templates.ts.
 */
export function assertGrowingCaller(gov: Governance, principal: Principal, projectId: string): void {
  gov.assertMayAct(principal, projectId, 'observe');
  if (!actsAsOwner(principal)) throw GROWING_API_ERRORS.ownerRequired(); // the owner's own window, or an agent in open mode (ADR-0036)
}
/** The owner, then the edit rights (a paused project, a revoked grant… are governance's to refuse). */
function mayApply(gov: Governance, principal: Principal, projectId: string) {
  assertGrowingCaller(gov, principal, projectId);
  gov.assertMayAct(principal, projectId, 'edit');
}
const refuseNotBuilt = () => { if (!GROWING_SERVER_BUILT) throw GROWING_API_ERRORS.notBuilt(); };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = <V>(rec: Readonly<Record<string, V>> | undefined, key: string): V | undefined => (rec && Object.hasOwn(rec, key) ? rec[key] : undefined);

/**
 * The planner's refusals as API errors. The fixed sentence and hint only: the details are dropped, so nothing of the request (an eye
 * point among them) can travel back in an error. GrowingNotBuilt (a core part not built yet) is 501 growing_not_built.
 */
const STATUS: Record<GrowingError['code'], number> = { not_found: 404, incompatible: 422, out_of_bounds: 422, invalid_args: 400, not_built: 501 };
const CODE: Record<GrowingError['code'], string> = { not_found: 'not_found', incompatible: 'incompatible', out_of_bounds: 'out_of_bounds', invalid_args: 'invalid_request', not_built: 'growing_not_built' };
function wrap<R>(fn: () => R): R {
  try { return fn(); } catch (e) {
    if (e instanceof GrowingError) {
      if (e.code === 'not_built') { const nb = GROWING_API_ERRORS.notBuilt(); nb.details = { part: typeof e.details.what === 'string' ? e.details.what : null }; throw nb; }
      throw new ApiError(STATUS[e.code], CODE[e.code], e.message, {}, e.hint);
    }
    throw e;
  }
}

/** Wall-clock capture per picked asset (life line shownCapture), as the film's context builds it (never a plain-object key). */
function captureOf(doc: ProjectDocument, picks: unknown): Record<string, string | null> {
  const capture: Record<string, string | null> = {};
  for (const p of Array.isArray(picks) ? picks : []) {
    const id = isObject(p) && typeof p.assetId === 'string' ? p.assetId : null;
    if (id === null || !Object.hasOwn(doc.assets, id) || Object.hasOwn(capture, id)) continue;
    Object.defineProperty(capture, id, { value: shownCapture(doc, id)?.wall ?? null, enumerable: true, writable: true, configurable: true });
  }
  return capture;
}
/**
 * What a growing run records: growingRunRecordParams built again here, key by key, from the plan's resolved settings and the
 * picks the plan's record names (a whitelist: whatever else a plan carries, no coordinate reaches the run record).
 */
function recordOf(plan: Pick<GrowingPlan, 'params' | 'record'>, picked?: readonly GrowingPicked[], removed?: readonly GrowingPicked[]): Record<string, unknown> {
  return growingRunRecordParams(plan.params, picked ?? growingRunPicked(plan.record), removed ?? growingRunPicked(plan.record, 'removed'));
}

const NOTE = 'Nothing was changed. Apply it to make the film as one undoable step; everything it makes stays an ordinary editable clip.';
/** The plan view: no ops, no slots, and its params are the run record's (the request's eyes are never echoed). */
function view(revision: number, plan: GrowingPlan): GrowingPlanView {
  const { ops, slots: _s, params: _p, record: _r, ...rest } = plan;
  const record = recordOf(plan);
  return { ...rest, record, params: record, revision, operations: ops.length, note: NOTE };
}
type CommitOut = { revision: number; results?: { output?: { runId?: string; createdIds?: string[]; slots?: SlotRecord[] } }[] };

/** Read-only: what the film would be in this project now, and at which revision. */
export async function planGrowingFor(store: Store, gov: Governance, principal: Principal, projectId: string, params: unknown): Promise<GrowingPlanView> {
  assertGrowingCaller(gov, principal, projectId);
  refuseNotBuilt();
  const p = store.getProject(projectId);
  const plan = wrap(() => planGrowing(p.doc, params, { capture: captureOf(p.doc, isObject(params) ? params.picks : undefined) }));
  return view(p.revision, plan);
}

/** Apply: plan against the current revision and commit ONE apply_template against exactly that revision (or `expectedRevision`). */
export async function applyGrowingFor(store: Store, gov: Governance, principal: Principal, projectId: string, params: unknown, expectedRevision?: number): Promise<GrowingApplyResult> {
  mayApply(gov, principal, projectId);
  refuseNotBuilt();
  const p = store.getProject(projectId);
  const plan = wrap(() => planGrowing(p.doc, params, { capture: captureOf(p.doc, isObject(params) ? params.picks : undefined) }));
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Growing up before your eyes: ${plan.steps[0] ?? ''}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { templateId: GROWING_TEMPLATE_ID, templateVersion: GROWING_VERSION, params: recordOf(plan), steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true } }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return { revision: r.revision, runId: out.runId ?? '', createdIds: out.createdIds ?? [], slots: out.slots ?? [], steps: plan.steps, warnings: plan.warnings, picks: plan.picks, excluded: plan.excluded };
}

// ---------- the rebuild (verifier C8) ----------
/** The picture as shown (EXIF applied): asset.image, or asset.video for a held frame. Null for a file without a picture. */
export function shownSizeOf(asset: Asset | undefined): ShownSize | null {
  if (!asset) return null;
  const s = asset.image ?? asset.video;
  return s && s.width > 0 && s.height > 0 ? { width: s.width, height: s.height } : null;
}
/** The project frame the planner solves against: the main sequence's (the project settings) and the project's fit. */
export const growingFrameOf = (doc: ProjectDocument): GrowingFrame => ({ width: doc.settings.width, height: doc.settings.height, fit: doc.settings.fit ?? 'contain' });
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
/** Rounding noise of the inverse (the solve rounds each number to 1e-6): a point this close outside 0..1 is put on the edge. */
const NOISE = 1e-5;
/**
 * The eye points an untouched clip gives back (core eyesFromTransform with the run's face size and eye line), or null when they do
 * not make a valid request (outside the picture beyond rounding noise, or closer than GROWING.minEyeShownPx): then the pick needs
 * marking again. Exported for its unit test.
 */
export function eyesOfClip(doc: ProjectDocument, clipId: string, runParams: Readonly<Record<string, unknown>>): [EyePoint, EyePoint] | null {
  const f = findClip(doc, clipId);
  if (!f || f.clip.type !== 'media') return null;
  const shown = shownSizeOf(own(doc.assets, f.clip.assetId));
  if (!shown) return null;
  const t = f.clip.transform;
  const target = { faceSize: num(runParams.faceSize, GROWING.faceSize.default), eyeLine: num(runParams.eyeLine, GROWING.eyeLine.default) };
  const eyes = eyesFromTransform({ x: t.x, y: t.y, scale: t.scale, rotation: t.rotation }, shown, growingFrameOf(doc), target);
  const fit = (x: number) => (x < -NOISE || x > 1 + NOISE || !Number.isFinite(x) ? null : Math.min(1, Math.max(0, x)));
  const pts = eyes.map((e) => ({ u: fit(e.u), v: fit(e.v) }));
  if (pts.some((e) => e.u === null || e.v === null)) return null;
  const [a, b] = pts as [EyePoint, EyePoint];
  if (Math.hypot((a.u - b.u) * shown.width, (a.v - b.v) * shown.height) < GROWING.minEyeShownPx) return null;
  return [a, b];
}

/** The run's tracks by role: the pictures track (the film's rule: the track holding the picture slots' clips) and the captions track. */
export function growingRunTracks(doc: ProjectDocument, run: Pick<RecipeRun, 'createdIds' | 'slots' | 'params'>): NonNullable<GrowingPlanContext['reuseTracks']> {
  const out: NonNullable<GrowingPlanContext['reuseTracks']> = {};
  const pictures = filmRunTracks(doc, run).pictures;
  if (pictures) out.pictures = pictures;
  const texts = new Set((run.slots ?? []).filter((s) => s.kind === 'text').map((s) => s.clipId));
  let best: Track | undefined, bestN = 0;
  for (const t of Object.values(doc.sequences).flatMap((q) => q.tracks)) {
    if (t.kind !== 'video' || t.id === out.pictures) continue;
    const n = t.clips.filter((c) => texts.has(c.id)).length;
    if (n > bestN) { best = t; bestN = n; }
  }
  if (best) out.captions = best.id;
  return out;
}

export interface GrowingRegeneration {
  /** The planner's params: the run's settings with the request's over them, and the picks with the eyes the server could give. Request data only. */
  params: Record<string, unknown>;
  ctx: GrowingPlanContext;
  /** The run's clips that are replaced (untouched, or only moved in time). */
  removable: string[];
  /** Clips kept by hand and their link partners. */
  protectedIds: string[];
  /** Slot records the new run keeps: the kept ones, and those deleted by hand that stay out. */
  keepSlots: SlotRecord[];
  /** Keys of the slots deleted by hand that stay out. */
  removedKeys: string[];
  /** Picks deleted by hand that restoreRemoved asked for but the request did not mark again: they stay out, named needs_marks. */
  needsMarks: string[];
  /** The pick records of the picks kept by hand and of those that stay out (the new run record carries them). */
  keptPicks: GrowingPicked[]; removedPicks: GrowingPicked[];
  keepIds: string[];
  /** The document without the removable clips (what the plan is made against). */
  without: ProjectDocument;
  movedKeys: string[];
  /** The pick keys in the order of the list the plan was made from. */
  order: string[];
}
const SETTINGS = ['sort', 'holdFrames', 'dissolve', 'faceSize', 'eyeLine', 'fill', 'caption', 'personId', 'at'] as const;
/**
 * What a rebuild starts from (pure; exported for its unit test). `request` is a parsed GrowingRebuildParams. For each pick of the
 * request (or, without picks, of the run record, then those it carried as deleted by hand): the request's eyes when it gives them
 * (a pick marked again, or a new one); else, for a pick whose clip is replaced (untouched, or only moved in time), the eyes its
 * clip's transform gives back; a pick kept by hand gets them too when they make a valid request (the planner keeps it as it is
 * whatever they are). A pick deleted by hand stays out (removedKeys) unless restoreRemoved AND the request marks it again.
 */
export function growingRegeneration(doc: ProjectDocument, run: RecipeRun, request: Readonly<Record<string, unknown>>, options: RegenerateOptions = {}): GrowingRegeneration {
  const slots = run.slots ?? [];
  const live = run.createdIds.filter((id) => !!findClip(doc, id));
  const { protectedIds, movedBack } = runHandEdits(doc, run, live, undefined, 'any-move');
  const removable = live.filter((id) => !protectedIds.includes(id));
  const keptSlots = slots.filter((s) => protectedIds.includes(s.clipId));
  const movedKeys = [...new Set(slots.filter((s) => movedBack.includes(s.clipId)).map((s) => s.key))];
  const gone = removedByHand(doc, slots);
  const picked = growingRunPicked(run.params), carried = growingRunPicked(run.params, 'removed');
  const known = new Map<string, GrowingPicked>();
  for (const r of [...carried, ...picked]) known.set(r.key, r);
  const requested = Array.isArray(request.picks) ? request.picks as GrowingPickInput[] : null;
  const list: GrowingPickInput[] = requested ?? [...picked, ...carried.filter((c) => !picked.some((x) => x.key === c.key))].map((r) => ({ assetId: r.assetId, frame: r.frame }));
  const slotOf = (key: string) => slots.find((s) => s.key === key && s.kind === 'picture');
  const goneKeys = new Set(gone.map((s) => s.key));
  const keptKeys = new Set(keptSlots.map((s) => s.key));
  const needsMarks: string[] = [], restored = new Set<string>();
  const picks = list.map((p): GrowingPickInput => {
    const key = growingPickKey(p.assetId, p.frame);
    const slot = slotOf(key);
    if (goneKeys.has(key) && slot) {
      if (options.restoreRemoved && p.eyes) { restored.add(key); return { assetId: p.assetId, frame: p.frame, eyes: p.eyes }; }
      if (options.restoreRemoved) needsMarks.push(key);
      return { assetId: p.assetId, frame: p.frame };
    }
    if (p.eyes) return { assetId: p.assetId, frame: p.frame, eyes: p.eyes };
    // a pick the run never had must come marked (the planner only names an unmarked pick of the last film needs_marks)
    if (!known.has(key)) throw growingRefusal('needsMarks', {});
    const eyes = slot && !goneKeys.has(key) ? eyesOfClip(doc, slot.clipId, run.params) : null;
    return eyes ? { assetId: p.assetId, frame: p.frame, eyes } : { assetId: p.assetId, frame: p.frame };
  });
  // a deleted slot whose pick is not made again travels on (picture or caption); with restoreRemoved only the unmarked pictures do
  const staysOut = (s: SlotRecord) => (s.kind === 'picture' ? !restored.has(s.key) && (!options.restoreRemoved || needsMarks.includes(s.key) || !list.some((p) => growingPickKey(p.assetId, p.frame) === s.key)) : !options.restoreRemoved);
  const removedSlots = gone.filter(staysOut);
  const removedKeys = removedSlots.map((s) => s.key);
  const removedPicks = removedSlots.flatMap((s) => { const k = known.get(s.key); return s.kind === 'picture' && k ? [k] : []; });
  const keptPicks = keptSlots.flatMap((s) => { const k = known.get(s.key); return s.kind === 'picture' && k ? [k] : []; });
  const reuseTracks = growingRunTracks(doc, run);
  const trackIds = new Set(Object.values(doc.sequences).flatMap((q) => q.tracks.map((t) => t.id)));
  const keepIds = [...new Set([...protectedIds, ...run.createdIds.filter((id) => trackIds.has(id)), ...Object.values(reuseTracks).filter((id): id is string => typeof id === 'string')])];
  const settings: Record<string, unknown> = {};
  for (const k of SETTINGS) {
    const v = Object.hasOwn(request, k) ? request[k] : Object.hasOwn(run.params, k) ? run.params[k] : undefined;
    if (v !== undefined && !(k === 'personId' && v === null)) settings[k] = v;
  }
  const without = withoutClips(doc, removable);
  const ctx: GrowingPlanContext = {
    capture: captureOf(without, picks),
    keptKeys: [...keptKeys], removedKeys,
    ...(movedKeys.length ? { movedKeys } : {}),
    reuseTracks,
  };
  return { params: { ...settings, picks }, ctx, removable, protectedIds, keepSlots: [...keptSlots, ...removedSlots], removedKeys, needsMarks, keptPicks, removedPicks, keepIds, without, movedKeys, order: list.map((p) => growingPickKey(p.assetId, p.frame)) };
}

/** The exclusions of a rebuild's answer: the planner's, with a pick restoreRemoved could not make (no eyes in the request) named needs_marks. */
function rebuildExclusions(plan: GrowingPlan, g: GrowingRegeneration): GrowingExclusion[] {
  const out = plan.excluded.map((x) => (g.needsMarks.includes(x.key) ? { ...x, code: 'needs_marks' as const, details: {} } : x));
  for (const key of g.needsMarks) {
    if (out.some((x) => x.key === key)) continue;
    const p = g.removedPicks.find((r) => r.key === key);
    if (p) out.push({ key, assetId: p.assetId, frame: p.frame, code: 'needs_marks', details: {} });
  }
  return out;
}

/**
 * Rebuild a growing run, optionally with changed settings or picks: clips the run made that nobody changed are replaced (their eyes
 * come back from their transforms), clips edited by hand are kept exactly, a clip only moved in time goes back (moved_back), a pick
 * deleted by hand stays out (removed) unless restoreRemoved and the request marks it again. ONE apply_template, one undo.
 */
export async function regenerateGrowingFor(store: Store, gov: Governance, principal: Principal, projectId: string, runId: string, newParams?: unknown, expectedRevision?: number, options: RegenerateOptions = {}): Promise<GrowingRegenerateResult> {
  mayApply(gov, principal, projectId);
  refuseNotBuilt();
  if (newParams !== undefined && !isObject(newParams)) throw wrap(() => { throw growingRefusal('badParams', {}, 'params must be an object of growing settings to change'); });
  const parsed = GrowingRebuildParamsSchema.safeParse(newParams ?? {});
  // the path and zod's sentence only (zod's sentences name the rule, never the value sent)
  if (!parsed.success) { const i = parsed.error.issues[0]!; throw wrap(() => { throw growingRefusal('badParams', {}, `${i.path.join('.') || 'params'}: ${i.message}`); }); }
  const p = store.getProject(projectId);
  const run = own(p.doc.recipeRuns, runId);
  if (!run || run.recipeId !== GROWING_RUN_RECIPE_ID) throw GROWING_API_ERRORS.runNotFound(runId);
  const g = wrap(() => growingRegeneration(p.doc, run, parsed.data as Record<string, unknown>, options));
  const plan = wrap(() => planGrowing(g.without, g.params, g.ctx));
  // the new run record: the plan's picks and the picks kept by hand (so a later rebuild still knows what a kept clip holds), in the
  // order of the request's list (a kept pick keeps its place in it), and the picks that stay out
  const placed = growingRunPicked(plan.record);
  const inRecord = new Map([...g.keptPicks, ...placed].map((x) => [x.key, x] as const));
  const listed = g.order.filter((k) => inRecord.has(k)).map((k) => inRecord.get(k)!);
  const picked = [...listed, ...placed.filter((x) => !g.order.includes(x.key))];
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Rebuild growing up before your eyes: ${plan.steps[0] ?? ''}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { runId, templateId: GROWING_TEMPLATE_ID, templateVersion: GROWING_VERSION, params: recordOf(plan, picked, g.removedPicks), steps: plan.steps, removeClipIds: g.removable, keepIds: g.keepIds, keepSlots: g.keepSlots, ops: plan.ops, slots: plan.slots, recordRanges: true } }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return {
    revision: r.revision, runId, createdIds: out.createdIds ?? [], slots: out.slots ?? [], steps: plan.steps, warnings: plan.warnings, picks: plan.picks, excluded: rebuildExclusions(plan, g),
    replaced: g.removable.length, protected: g.protectedIds, removed: g.removedKeys, movedBack: g.movedKeys,
  };
}
