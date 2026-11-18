/**
 * Shorts on the server (ADR-0018): find candidate moments (read-only; a durable 'analysis' job of kind 'shorts-candidates'
 * when the audio features are not cached), plan (read-only), make (ONE internal apply_sequence_plan committed through
 * governance against the planned revision, as recipes.ts applyRecipe does), and plan a reframe of an existing short.
 * Contract: core shortsContract.ts; routes: http.ts (/projects/:id/shorts/*, /sequences/*), MCP: mcp.ts.
 *
 * - The finder reads the project as the caller may (store.getProject): the transcript (doc.transcripts[assetId], own
 *   property) as statements and timed words, findFillers, the scene cuts of doc.analyses, the measured sound
 *   (shortsFeatures.ts) and the excerpts of the shorts already made from the file (origin.kind 'short'). The score is a
 *   relative heuristic within one video, never a forecast of views.
 * - Candidates the finder returned are remembered in this process (by project and candidate id), so a pick that names one
 *   carries the candidate's measured score and reasons into the short's origin; a candidate id the server cannot find again
 *   is passed to the planner without them. A client never supplies a score.
 * - applyShorts commits gov.commitAs({ projectId, expectedRevision: body.expectedRevision ?? the planned revision,
 *   allowInternal: true, label: 'Make shorts', ops: [apply_sequence_plan] }). Propose mode is refused with 403
 *   insufficient_scope (SHORTS_PROPOSE_REFUSED): a proposal cannot carry the internal op.
 * - A ShortsError goes through shortsApiError (SHORTS_STATUS). A part of the track this build lacks answers 501 not_built.
 */
import * as T from '@pulseframe/time';
import {
  BuildShortsBodySchema, FindShortsBodySchema, findFillers, planShorts, rankShortCandidates, reframeOps, ReframePlanBodySchema, SHORTS_PROPOSE_REFUSED, SHORTS_RANK_METHOD,
  ShortsError, SHORTS_STATUS, shortsRefusal, transcriptStatements,
  type ApplySequencePlanArgs, type ApplySequencePlanOutput, type Asset, type AudioFeatures, type BuildShortsBody, type FindShortsBody, type HighlightInputsWithWords,
  type ProjectDocument, type ReframePlanView, type ShortCandidate, type ShortCandidatesView, type ShortsApplyResult, type ShortsPlan, type ShortsPlanContext, type ShortsPlanView,
} from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { audioFeaturesOf, cachedAudioFeatures, FeaturesAbandoned } from './shortsFeatures.ts';
import { ApiError, type Store } from './store.ts';

/** ShortsError → ApiError (lead-owned mapping, core SHORTS_STATUS): not_found 404, invalid_args 400, needs_video 422, needs_measurement 409, not_verbatim 422, off_word_boundary 422, plan_too_large 422, tracking_not_available 409, not_built 501. */
export function shortsApiError(e: ShortsError): ApiError {
  return new ApiError(SHORTS_STATUS[e.code], e.code, e.message, e.details, e.hint);
}
/** Run `fn`, turning a ShortsError into its ApiError. */
export function withShortsErrors<R>(fn: () => R): R {
  try {
    const r = fn();
    if (r instanceof Promise) return r.catch((e: unknown) => { throw e instanceof ShortsError ? shortsApiError(e) : e; }) as R;
    return r;
  } catch (e) {
    throw e instanceof ShortsError ? shortsApiError(e) : e;
  }
}
/** A core part of the track that this build has only as a stub (it throws '<name> is not built yet') refuses as 501 not_built. */
function built<R>(what: string, fn: () => R): R {
  try { return fn(); } catch (e) {
    if (!(e instanceof ShortsError) && e instanceof Error && / is not built yet \(shorts W\d\)/.test(e.message)) throw shortsRefusal('notBuilt', { part: what }, what);
    throw e;
  }
}

// ---------- candidates remembered in this process ----------
const REMEMBERED_MAX = 4000;
const remembered = new Map<string, ShortCandidate>();
const key = (projectId: string, candidateId: string) => `${projectId}|${candidateId}`;
function remember(projectId: string, cands: readonly ShortCandidate[]) {
  for (const c of cands) { const k = key(projectId, c.id); remembered.delete(k); remembered.set(k, c); }
  while (remembered.size > REMEMBERED_MAX) remembered.delete(remembered.keys().next().value!);
}

// ---------- the finder ----------
function videoAsset(doc: ProjectDocument, assetId: string): Asset {
  const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]! : null;
  if (!asset) throw shortsRefusal('assetNotFound', { assetId }, assetId);
  if (asset.kind !== 'video' || !asset.video) throw shortsRefusal('needsVideo', { assetId, kind: asset.kind });
  return asset;
}
/** The finder's inputs for one asset of `doc`, with `features` (null when the file has no sound or it was not measured). */
export function finderInputs(doc: ProjectDocument, asset: Asset, features: AudioFeatures | null): HighlightInputsWithWords {
  const tr = Object.hasOwn(doc.transcripts, asset.id) ? doc.transcripts[asset.id]! : null;
  const analysis = Object.hasOwn(doc.analyses, asset.id) ? doc.analyses[asset.id]! : null;
  const existingShorts = Object.values(doc.sequences).flatMap((s) => (s.origin?.kind === 'short' && s.origin.assetId === asset.id ? [{ start: s.origin.excerpt.start, end: s.origin.excerpt.end }] : []));
  return {
    assetId: asset.id, assetDuration: asset.duration,
    statements: tr ? transcriptStatements(tr, { fileDuration: asset.duration }) : null,
    fillers: tr ? findFillers(tr).candidates : null,
    features, sceneCuts: analysis?.scenes ? analysis.scenes.cuts : null, existingShorts,
    words: tr ? tr.segments.flatMap((s) => (s.timing === 'word' ? s.words.map((w) => ({ id: w.id, text: w.text, start: w.start, end: T.add(w.start, w.duration), confidence: w.confidence })) : [])) : null,
  };
}
function rankView(projectId: string, revision: number, doc: ProjectDocument, asset: Asset, features: AudioFeatures | null, body: FindShortsBody): ShortCandidatesView {
  const r = rankShortCandidates(finderInputs(doc, asset, features), body);
  remember(projectId, r.candidates);
  return { ...r, revision, assetId: asset.id, features: features ? { hops: features.hops, partial: features.partial } : null };
}

/** The ranked candidates when the features of the asset are cached (200), else null (the route then starts the job, 202). */
export function cachedShortCandidates(store: Store, projectId: string, body: FindShortsBody): ShortCandidatesView | null {
  const p = store.getProject(projectId);
  const asset = videoAsset(p.doc, body.assetId);
  const features = asset.audio ? cachedAudioFeatures(store, asset) : null;
  if (asset.audio && !features) return null;
  return rankView(projectId, p.revision, p.doc, asset, features, body);
}
/** Measure what is missing and rank (the 'shorts-candidates' analysis job runs this). Checks `abandoned()` between windows. */
export async function findShortCandidates(store: Store, projectId: string, body: FindShortsBody, abandoned?: () => boolean): Promise<ShortCandidatesView> {
  const first = store.getProject(projectId);
  const asset = videoAsset(first.doc, body.assetId);
  let features: AudioFeatures | null = null;
  if (asset.audio) {
    try { features = await audioFeaturesOf(store, asset, abandoned); } catch (e) {
      // canceled between windows: the job runner discards this answer and marks the job canceled; nothing was ranked
      if (e instanceof FeaturesAbandoned) return { candidates: [], excluded: [], basis: [], method: SHORTS_RANK_METHOD, note: 'Canceled before the sound was measured to the end: nothing was ranked.', revision: first.revision, assetId: asset.id, features: null };
      throw e;
    }
  }
  // rank against the project as it is now (measuring takes time)
  const p = store.getProject(projectId);
  return rankView(projectId, p.revision, p.doc, videoAsset(p.doc, body.assetId), features, body);
}

// ---------- plan and make ----------
function parseBuild(body: unknown): BuildShortsBody {
  const r = BuildShortsBodySchema.safeParse(body ?? {});
  if (!r.success) throw new ShortsError('invalid_args', `the shorts request is not valid: ${r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')}`.slice(0, 400), { issues: r.error.issues.slice(0, 10) });
  return r.data;
}
/** The planner's context: the time, the candidates the picks name (as this server measured them), the cached sound. */
export function planContext(store: Store, projectId: string, doc: ProjectDocument, body: BuildShortsBody, createdAt = new Date().toISOString()): ShortsPlanContext {
  const candidates = new Map<string, ShortCandidate>();
  const features = new Map<string, AudioFeatures>();
  for (const pick of body.picks) {
    const asset = Object.hasOwn(doc.assets, pick.assetId) ? doc.assets[pick.assetId]! : null;
    if (!asset) continue; // the planner refuses it with its own words
    if (asset.audio && !features.has(asset.id)) { const f = cachedAudioFeatures(store, asset); if (f) features.set(asset.id, f); }
    if (!pick.candidateId || candidates.has(pick.candidateId)) continue;
    let c = remembered.get(key(projectId, pick.candidateId)) ?? null;
    if (!c && asset.kind === 'video' && asset.video && (!asset.audio || features.has(asset.id))) {
      // not remembered (another process found it): rank the file again with the default settings and look for it
      const again = rankShortCandidates(finderInputs(doc, asset, features.get(asset.id) ?? null), FindShortsBodySchema.parse({ assetId: asset.id, count: 40 }));
      remember(projectId, again.candidates);
      c = again.candidates.find((x) => x.id === pick.candidateId) ?? null;
    }
    if (c && c.assetId === pick.assetId) candidates.set(c.id, c);
  }
  return { createdAt, candidates, features };
}
const PLAN_METHOD = 'rule-based plan from the transcript, the measured sound and the scene cuts; no model';
function planFor(store: Store, projectId: string, doc: ProjectDocument, body: BuildShortsBody): ShortsPlan {
  const ctx = planContext(store, projectId, doc, body);
  return built('planning shorts', () => planShorts(doc, body, ctx));
}

/** The plan view of BuildShortsBody (read-only). */
export async function planShortsFor(store: Store, projectId: string, body: unknown): Promise<ShortsPlanView> {
  const b = parseBuild(body);
  const p = store.getProject(projectId);
  const plan = planFor(store, projectId, p.doc, b);
  return { revision: p.revision, steps: plan.steps, basis: plan.basis, shorts: plan.shorts, warnings: plan.warnings, operations: plan.ops.length, method: PLAN_METHOD, note: 'Nothing was changed. Make the shorts to apply these edits as one undoable step (pass this revision as expectedRevision).' };
}

const proposeRefused = () => new ApiError(403, 'insufficient_scope', SHORTS_PROPOSE_REFUSED, { mode: 'propose' }, 'plan_shorts still shows what would be made.');
/** Make the shorts as one undoable step (synchronous; 409 needs_measurement when tightening needs uncached features). */
export async function applyShorts(store: Store, gov: Governance, principal: Principal, projectId: string, body: unknown): Promise<ShortsApplyResult> {
  gov.assertMayAct(principal, projectId, 'observe'); // the grant covers this project at all
  if (principal.kind === 'agent' && principal.mode === 'propose') throw proposeRefused();
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'make shorts (it adds sequences with their tracks and clips)');
  const b = parseBuild(body);
  const p = store.getProject(projectId);
  const plan = planFor(store, projectId, p.doc, b);
  const { expectedRevision, ...params } = b;
  const args: ApplySequencePlanArgs = {
    planKind: 'shorts', params: params as Record<string, unknown>, steps: plan.steps.slice(0, 50).map((s) => s.slice(0, 400)),
    ...(b.replaceSequenceIds?.length ? { removeSequenceIds: b.replaceSequenceIds } : {}),
    ops: plan.ops, origins: plan.origins,
  };
  // The plan was built from revision p.revision; committing against exactly that revision means a concurrent edit cannot be silently built upon.
  const r = gov.commitAs(principal, { projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: 'Make shorts', ops: [{ op: 'apply_sequence_plan', args }] }) as { revision: number; proposal?: unknown; results?: { output?: Partial<ApplySequencePlanOutput> }[] };
  if (r.proposal !== undefined || !r.results) throw proposeRefused();
  const out = r.results[0]?.output ?? {};
  return { revision: r.revision, runId: out.runId ?? '', sequenceIds: out.sequenceIds ?? [], createdIds: out.createdIds ?? [], steps: plan.steps, warnings: plan.warnings };
}

/** At most MAX_REFRAME_OPS replace_clip_keyframes calls that reframe an existing short (read-only; the client commits them). */
export function planReframeFor(store: Store, projectId: string, sequenceId: string, body: unknown): ReframePlanView {
  const parsed = ReframePlanBodySchema.safeParse(body ?? {});
  if (!parsed.success) throw new ShortsError('invalid_args', `the reframe request is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')}`.slice(0, 400), { issues: parsed.error.issues.slice(0, 10) });
  const p = store.getProject(projectId);
  if (!Object.hasOwn(p.doc.sequences, sequenceId)) throw shortsRefusal('sequenceNotFound', { sequenceId }, sequenceId);
  const r = built('planning a reframe', () => reframeOps(p.doc, sequenceId, parsed.data));
  return { revision: p.revision, sequenceId, operations: r.ops, shots: r.shots, warnings: r.warnings, note: 'Nothing was changed. Apply these operations in one apply_transaction (with baseRevision) to reframe the short.' };
}
