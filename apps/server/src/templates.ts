/**
 * Templates on the server (ADR-0016), mirroring recipes.ts: plan (read-only), apply (ONE internal apply_template committed
 * through governance against the revision the plan was built from), regenerate (replace what the last run made and nobody
 * touched; keep what was edited by hand, by content fingerprint). Rule-based; no model.
 * - Templates that need a model this build does not have (MODEL_GATED_TEMPLATES) are listed as unavailable and refused with
 *   409 needs_capability before anything is planned; nothing is downloaded for them.
 * - The procedural media a plan needs (sound effects, graphic elements, built-in music) are made here (makeSfx, makeElement,
 *   makeMusic) and travel inside the op's arguments, so replay never reads the template catalogue or the synthesisers. A
 *   built-in music track travels with its known beat grid (assets[].analysis, ADR-0022).
 * - Agents in propose mode are refused (403 insufficient_scope): a template is applied through an internal op, which a proposal
 *   cannot carry (governance.ts propose/decide commit without internal ops). A grant limited to tracks or a time range is
 *   refused too (403 out_of_scope): a template adds tracks, assets and run records.
 */
import * as T from '@pulseframe/time';
import {
  clipEnd, findClip, findGatedTemplate, findTemplate, fingerprint, gatedTemplateError, gatedTemplateSummary, MODEL_GATED_TEMPLATES, planTemplate, summarizeTemplate, TemplateError, TEMPLATE_METHOD, TEMPLATES,
  type Asset, type KnownGrid, type ProjectDocument, type SlotRecord, type TemplateApplyResult, type TemplateDef, type TemplatePlan, type TemplatePlanView, type TemplateRegenerateResult, type TemplateSummary,
} from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { canRasteriseSvg, makeElement } from './elements.ts';
import type { Governance } from './governance.ts';
import { makeSfx } from './sfx.ts';
import { makeMusic } from './music.ts';
import { ApiError, type Store } from './store.ts';

const STATUS: Record<TemplateError['code'], number> = { not_found: 404, needs_analysis: 409, needs_capability: 409, invalid_args: 400, nothing_to_do: 409 };
const CODE: Record<TemplateError['code'], string> = { not_found: 'not_found', needs_analysis: 'needs_analysis', needs_capability: 'needs_capability', invalid_args: 'invalid_request', nothing_to_do: 'nothing_to_do' };
/** A TemplateError as the API reports it. */
export const templateApiError = (e: TemplateError) => new ApiError(STATUS[e.code], CODE[e.code], e.message, {}, e.hint);
const wrap = <R>(fn: () => R): R => {
  try { return fn(); } catch (e) {
    if (e instanceof TemplateError) throw templateApiError(e);
    throw e;
  }
};

// ---------- whether graphic elements can be drawn here ----------
let elementsKnown: boolean | undefined;
/** Ask (once; elements.ts remembers) whether this machine's ffmpeg can draw graphic elements, and remember the answer here too. */
export const probeElements = (): Promise<boolean> => canRasteriseSvg().then((v) => (elementsKnown = v));

// ---------- the gallery ----------
const gallery = (elementsAvailable: boolean): TemplateSummary[] => [...TEMPLATES.map((d) => summarizeTemplate(d, { elementsAvailable })), ...MODEL_GATED_TEMPLATES.map(gatedTemplateSummary)];
/** GET /api/v1/templates: the built-ins, then the model-gated templates (unavailable, with their reason). */
export async function listTemplates(): Promise<TemplateSummary[]> {
  return gallery(await probeElements());
}
/**
 * The same list for catalog(), which answers without waiting. Until the one-time check of ffmpeg has answered (it is started
 * when the app is made), a template that places graphic elements says that it is being checked instead of claiming either way.
 */
export function templateCatalog(): TemplateSummary[] {
  if (elementsKnown !== undefined) return gallery(elementsKnown);
  void probeElements();
  return gallery(true).map((s) => (s.needs.elements ? { ...s, available: false, unavailableReason: 'this server is still checking whether its ffmpeg can draw graphic elements; ask again in a moment' } : s));
}

/** The template a request names: a model-gated one is refused (409 needs_capability) before anything else; an unknown one is 404. */
function templateOf(templateId: string): TemplateDef {
  const gated = findGatedTemplate(templateId);
  if (gated) throw templateApiError(gatedTemplateError(gated));
  const def = findTemplate(templateId);
  if (!def) throw new ApiError(404, 'not_found', `template "${templateId}" does not exist`, { templateId }, `Available: ${TEMPLATES.map((t) => t.id).join(', ') || 'none in this build'} (GET /api/v1/templates).`);
  return def;
}

const NOTE = 'Nothing was changed. Apply it to make these edits as one undoable step; everything it makes stays an ordinary editable clip.';
const view = (revision: number, plan: TemplatePlan): TemplatePlanView => ({
  revision, templateId: plan.templateId, version: plan.version, params: plan.params, steps: plan.steps, basis: plan.basis, warnings: plan.warnings, notices: plan.notices, blocking: plan.blocking,
  alternatives: plan.alternatives, operations: plan.ops.length, predicted: plan.predicted, method: TEMPLATE_METHOD, note: plan.blocking.length ? 'Nothing was changed. This plan cannot be applied as it is: see blocking.' : NOTE,
});
const refuseBlocked = (plan: TemplatePlan) => {
  if (plan.blocking.length) throw new ApiError(409, 'template_blocked', `the template cannot apply like this: ${plan.blocking[0]!.message}`, { blocking: plan.blocking }, 'Choose longer media for that slot, another tempo, or fewer slots (see the plan).');
};

/** Read-only: what the template would do to this project now, and at which revision. */
export async function planTemplateFor(store: Store, gov: Governance, principal: Principal, projectId: string, templateId: string, params: unknown): Promise<TemplatePlanView> {
  gov.assertMayAct(principal, projectId, 'observe');
  const def = templateOf(templateId);
  const p = store.getProject(projectId);
  const elementsAvailable = def.elements.length ? await probeElements() : true;
  return view(p.revision, wrap(() => planTemplate(p.doc, def, params, { elementsAvailable })));
}

/** The procedural media of a plan, made now (content-addressed, so the same sound or picture is stored once). */
async function makeAssets(store: Store, principal: Principal, plan: TemplatePlan): Promise<{ key: string; asset: Omit<Asset, 'id'>; analysis?: KnownGrid }[]> {
  const out: { key: string; asset: Omit<Asset, 'id'>; analysis?: KnownGrid }[] = [];
  for (const n of plan.assetsNeeded) {
    if (n.kind === 'music') {
      // built-in music, made to measure: exactly the plan's bars, with the grid known from its recipe (ADR-0022)
      const made = await makeMusic(store, { styleId: n.id, bars: n.bars, seed: n.seed }, principal.actor);
      out.push({ key: n.key, asset: made.asset, analysis: made.grid });
    } else if (n.kind === 'sfx') out.push({ key: n.key, asset: await makeSfx(store, n.id, principal.actor) });
    else out.push({ key: n.key, asset: await makeElement(store, n.id, { ...(n.color ? { color: n.color } : {}), ...(n.color2 ? { color2: n.color2 } : {}) }, principal.actor) });
  }
  return out;
}
/** Checks before a template may change a project: edit rights (propose mode refused), not paused, no track/range limit. */
function mayApply(gov: Governance, principal: Principal, projectId: string) {
  gov.assertMayAct(principal, projectId, 'observe'); // the grant covers this project at all (403 out_of_scope otherwise)
  // governance's own refusal suggests a proposal, which cannot carry a template: say what can be done instead
  if (principal.kind === 'agent' && principal.mode === 'propose') throw new ApiError(403, 'insufficient_scope', 'this credential may only propose edits, and a template cannot be proposed: it is applied through an internal step that a proposal does not carry', { mode: 'propose' }, 'Ask the project owner to apply the template, or for a grant in edit mode. plan_template still shows what it would do.');
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'apply a template (it adds tracks, media and a run record)');
}
async function elementsFor(def: TemplateDef): Promise<boolean> {
  if (!def.elements.length) return true;
  const ok = await probeElements();
  if (!ok) throw new ApiError(409, 'needs_capability', `template ${def.id} places graphic elements, which this machine cannot draw: its ffmpeg has no SVG decoder (librsvg)`, { templateId: def.id, needs: 'ffmpeg built with librsvg' }, 'Install an ffmpeg build with librsvg and restart the server, or choose a template without elements.');
  return ok;
}
type CommitOut = { revision: number; results?: { output?: { runId?: string; createdIds?: string[]; slots?: TemplateApplyResult['slots'] } }[] };

/** Apply: re-plan against the current revision and commit ONE apply_template against exactly that revision (or `expectedRevision`). */
export async function applyTemplateFor(store: Store, gov: Governance, principal: Principal, projectId: string, templateId: string, params: unknown, expectedRevision?: number): Promise<TemplateApplyResult> {
  mayApply(gov, principal, projectId);
  const def = templateOf(templateId);
  const p = store.getProject(projectId);
  const elementsAvailable = await elementsFor(def);
  const plan = wrap(() => planTemplate(p.doc, def, params, { elementsAvailable }));
  refuseBlocked(plan);
  const assets = await makeAssets(store, principal, plan);
  // Making the media took time: the right to act is checked again before anything is written (as attachGenerated does).
  mayApply(gov, principal, projectId);
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Template: ${def.name.en}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { templateId: def.id, templateVersion: def.version, params: plan.params, steps: plan.steps, ...(assets.length ? { assets } : {}), ops: plan.ops, slots: plan.slots } }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return { revision: r.revision, runId: out.runId ?? '', createdIds: out.createdIds ?? [], slots: out.slots ?? [], steps: plan.steps, warnings: plan.warnings, notices: plan.notices };
}

/**
 * The clips of a run kept on regeneration: those whose content fingerprint differs from the one the run recorded (edited by
 * hand), together with every clip of the run linked to one of them. A slot that keeps its own sound is a picture linked to its
 * sound; an edit to either keeps both, so the kept slot stays whole (still linked, its own sound under its own picture) and its
 * key is not made again.
 */
function keptByHand(doc: ProjectDocument, live: readonly string[], fingerprints: Readonly<Record<string, string>>): string[] {
  const clip = (id: string) => findClip(doc, id)!.clip;
  const edited = live.filter((id) => fingerprint(clip(id)) !== fingerprints[id]);
  const groups = new Set(edited.map((id) => clip(id)).flatMap((c) => (c.type === 'media' && c.linkGroupId ? [c.linkGroupId] : [])));
  return live.filter((id) => { const c = clip(id); return edited.includes(id) || (c.type === 'media' && !!c.linkGroupId && groups.has(c.linkGroupId)); });
}
/**
 * A picture slot kept by hand stays where it is, so it must lie exactly on the range the new plan gives that slot: otherwise
 * (another tempo re-times the slots, or the clip was moved or trimmed) the new pictures would leave frames without a picture and
 * could cover the kept one from a higher track. Refused with 409 template_blocked, naming each such slot.
 */
function refuseMovedKeptPictures(doc: ProjectDocument, plan: TemplatePlan, keepSlots: readonly SlotRecord[], runParams: Readonly<Record<string, unknown>>) {
  const rate = doc.settings.frameRate;
  const moved = keepSlots.filter((s) => s.kind === 'picture').flatMap((s) => {
    const c = findClip(doc, s.clipId)!.clip;
    const startFrame = T.nearestFrameIndex(c.start, rate), frames = T.nearestFrameIndex(clipEnd(c), rate) - startFrame;
    const planned = plan.predicted.slots.find((x) => x.key === s.key);
    const fits = planned && T.eq(c.start, T.frameTime(planned.startFrame, rate)) && T.eq(clipEnd(c), T.frameTime(planned.startFrame + planned.frames, rate));
    return fits ? [] : [{ key: s.key, clipId: s.clipId, startFrame, frames, plannedStartFrame: planned?.startFrame ?? null, plannedFrames: planned?.frames ?? null }];
  });
  if (!moved.length) return;
  const keys = moved.map((m) => m.key).join(', ');
  const tempo = typeof runParams.tempo === 'string' ? runParams.tempo : 'normal';
  throw new ApiError(409, 'template_blocked', `the template cannot regenerate like this: slot(s) ${keys} were edited by hand and are kept where they are, but no longer lie exactly on the range this plan gives them, so the new pictures would leave frames without a picture`, { kept: moved },
    `Regenerate with the run's tempo (${tempo}), undo the hand edit that moved or trimmed slot(s) ${keys}, or delete that clip so the template fills the slot again.`);
}

/**
 * Regenerate a template run, optionally with changed parameters (shuffle, another tempo): clips the run made that nobody
 * changed are replaced; clips edited by hand since (their content fingerprint differs), and the clips linked to them, are kept
 * exactly as they are, with their slot records, and the planner does not make those items again. A kept picture that would no
 * longer lie on its slot (another tempo, or the clip was moved or trimmed) is refused with 409 template_blocked.
 */
export async function regenerateTemplateFor(store: Store, gov: Governance, principal: Principal, projectId: string, runId: string, newParams?: unknown, expectedRevision?: number): Promise<TemplateRegenerateResult> {
  mayApply(gov, principal, projectId);
  const p = store.getProject(projectId);
  const run = Object.hasOwn(p.doc.recipeRuns, runId) ? p.doc.recipeRuns[runId] : undefined;
  if (!run || !run.recipeId.startsWith('template:')) throw new ApiError(404, 'not_found', `template run ${runId} not found`, { runId }, 'A template run id is returned by apply (runId).');
  if (newParams !== undefined && (typeof newParams !== 'object' || newParams === null || Array.isArray(newParams))) throw new ApiError(400, 'invalid_request', 'params must be an object of template parameters to change');
  const def = templateOf(run.recipeId.slice('template:'.length));
  const live = run.createdIds.filter((id) => !!findClip(p.doc, id));
  const protectedIds = keptByHand(p.doc, live, run.fingerprints ?? {});
  const removable = live.filter((id) => !protectedIds.includes(id));
  const keepSlots = (run.slots ?? []).filter((s) => protectedIds.includes(s.clipId));
  // Plan against the document as it will be once the untouched clips are gone; `at` and the other parameters come from the run.
  const without = structuredClone(p.doc);
  for (const id of removable) { const f = findClip(without, id); if (f) f.track.clips.splice(f.index, 1); }
  const { templateVersion: _v, ...previous } = run.params;
  const params = { ...previous, ...(newParams as Record<string, unknown> | undefined) };
  const elementsAvailable = await elementsFor(def);
  const plan = wrap(() => planTemplate(without, def, params, { keepKeys: keepSlots.map((s) => s.key), elementsAvailable }));
  refuseMovedKeptPictures(p.doc, plan, keepSlots, run.params);
  refuseBlocked(plan);
  const assets = await makeAssets(store, principal, plan);
  mayApply(gov, principal, projectId);
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Regenerate template: ${def.name.en}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { runId, templateId: def.id, templateVersion: def.version, params: plan.params, steps: plan.steps, ...(assets.length ? { assets } : {}), removeClipIds: removable, keepIds: protectedIds, keepSlots, ops: plan.ops, slots: plan.slots } }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return { revision: r.revision, runId, createdIds: out.createdIds ?? [], slots: out.slots ?? [], steps: plan.steps, warnings: plan.warnings, notices: plan.notices, replaced: removable.length, protected: protectedIds };
}
