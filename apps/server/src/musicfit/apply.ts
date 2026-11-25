/**
 * Apply a music fit (wave 7 musicfit, BUILDER B; .artifacts/wave7/musicfit-decisions.md §3, §4). Two commits by the ADR-0022 rule for
 * made media: (1) the made file into the library (internal add_builtin_music or add_fitted_music; skipped when nothing is made or
 * the same bytes are already there), then (2) ONE transaction, one undo: the clip's steps (trim_clip, replace_clip_media, the
 * ending) or the run's regeneration (apply_template). Undoing (2) leaves the made file in the library.
 * - The right to act is checked before anything (a propose-mode agent and a limited grant are refused: routes.ts mayApplyMusicFit),
 *   and again after the file was made. A stale expectedRevision answers 409 stale_revision before anything is made.
 * - The plan is made twice: first as the plan route makes it (on a stand-in of the track, or on the whole song), then on a draft
 *   that holds the made file. Their end frames must agree, else 409 fit_unstable and NOTHING is committed (not even the file).
 * - The licence refusal of a library song comes from the plan, before anything is searched or made; add_fitted_music checks it
 *   again inside (fail-closed, builder A).
 * - The flash rule is checked on the document as commit (2) would leave it: a cut this fit makes closer than flashGapFrames to
 *   another refuses 409 flash_gap; a blocked template slot refuses 409 template_blocked; nothing is committed then.
 */
import { applyTransaction, BUILTIN_MUSIC_ASSET_KEY, type Asset, type KnownGrid, type MusicFitApplyRequest, type MusicFitApplyResult, type OpCall, type ProjectDocument } from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import type { Governance } from '../governance.ts';
import { ApiError, type CommitResult, type Store } from '../store.ts';
import { flashRule, guard, musicFitDeps, prepareMusicFit, type Edit, type Prepared } from './plan.ts';
import { mayApplyMusicFit, musicFitApiError } from './routes.ts';

const staleRevision = (expected: number, current: number) => new ApiError(409, 'stale_revision', `expectedRevision ${expected} is not the current revision ${current}`, { expectedRevision: expected, currentRevision: current }, 'Re-read the timeline at the current revision and plan again.');
const blockingError = (p: Prepared['plan']) => {
  const b = p.blocking[0]!;
  if (b.code === 'flash_gap') return musicFitApiError('flashGap', b.details);
  return new ApiError(409, 'template_blocked', b.message, b.details, typeof b.details.hint === 'string' ? b.details.hint : 'Undo the hand edit of that slot, or delete that clip and regenerate.');
};

export async function applyMusicFit(store: Store, gov: Governance, principal: Principal, projectId: string, req: MusicFitApplyRequest, signal?: AbortSignal): Promise<MusicFitApplyResult> {
  mayApplyMusicFit(gov, principal, projectId);
  const p = store.getProject(projectId);
  if (p.revision !== req.expectedRevision) throw staleRevision(req.expectedRevision, p.revision);
  const { expectedRevision, ...planReq } = req;
  const prepared = await prepareMusicFit(store, projectId, p.doc, p.revision, planReq, signal);
  if (prepared.plan.blocking.length) throw blockingError(prepared.plan);
  return guard(async () => {
    // ----- make the file (nothing is committed yet) -----
    const m = prepared.make;
    let made: { op: OpCall; key?: { key: string; asset: Omit<Asset, 'id'>; analysis?: KnownGrid } } | null = null;
    if (m.kind === 'builtin') {
      const r = await musicFitDeps.makeMusic(store, { styleId: m.styleId, bars: m.bars, seed: m.seed, ...(m.endFrames !== undefined ? { endFrames: m.endFrames } : {}) }, principal.actor);
      made = { op: { op: 'add_builtin_music', args: { asset: r.asset, grid: r.grid } }, key: { key: BUILTIN_MUSIC_ASSET_KEY, asset: r.asset, analysis: r.grid } };
    } else if (m.kind === 'fitted') {
      const fitter = musicFitDeps.songFitter;
      if (!fitter) throw musicFitApiError('notBuilt', { fn: 'song fit (join search and splice)' });
      const r = await fitter.make({ store, projectId, doc: p.doc, assetId: m.sourceAssetId, startAt: m.startAt, removal: m.removal, actor: principal.actor, ...(signal ? { signal } : {}) });
      made = { op: { op: 'add_fitted_music', args: { asset: r.asset, grid: r.grid } } };
    }
    // ----- the second plan, on a draft that holds the made file -----
    const target = (results?: { output?: Record<string, unknown> }[]) => (m.kind === 'none' ? m.assetId ?? '' : String(results?.[0]?.output?.assetId ?? ''));
    let secondDoc = p.doc, secondAsset = target();
    if (made) { const dr = applyTransaction(p.doc, [made.op], { idSeed: 'mfa_', actor: principal.actor, allowInternal: true }); secondDoc = dr.doc; secondAsset = target(dr.results); }
    const second = await prepared.edit(secondDoc, secondAsset, principal, made?.key);
    if (second.endFrame !== prepared.firstEndFrame) throw musicFitApiError('fitUnstable', { firstEndFrame: prepared.firstEndFrame, secondEndFrame: second.endFrame });
    await refuseFlash(store, principal, secondDoc, second);
    // ----- commit (1): the made file; making it took time, so the right to act is checked again first -----
    mayApplyMusicFit(gov, principal, projectId);
    let revision = p.revision, madeAssetId: string | null = null, madeRevision: number | null = null, doc = p.doc, assetId = secondAsset;
    if (made) {
      const hash = (made.op.args as { asset: { contentHash: string } }).asset.contentHash;
      const existing = Object.values(p.doc.assets).find((a) => a.contentHash === hash);
      if (existing && m.kind === 'builtin') assetId = existing.id;
      else {
        const r1 = gov.commitAs(principal, { projectId, expectedRevision, allowInternal: true, label: `Music fit: ${m.kind === 'builtin' ? 'built-in music made to measure' : 'shortened song'}`, ops: [made.op] }) as CommitResult;
        revision = r1.revision;
        madeRevision = r1.revision;
        assetId = String(r1.results[0]?.output?.assetId ?? '');
        madeAssetId = (r1.results[0]?.output?.deduplicated ? null : assetId) || null;
        doc = store.getProject(projectId).doc;
      }
    }
    // ----- commit (2): ONE transaction against the revision after (1) -----
    const edit = await prepared.edit(doc, assetId, principal, made?.key);
    if (edit.endFrame !== second.endFrame) throw musicFitApiError('fitUnstable', { firstEndFrame: second.endFrame, secondEndFrame: edit.endFrame, madeAssetId });
    const ops = await withTemplateAssets(store, principal, edit);
    const r2 = gov.commitAs(principal, { projectId, expectedRevision: revision, allowInternal: edit.allowInternal, label: edit.label, ops }) as CommitResult;
    const plan = { ...prepared.plan, revision: r2.revision };
    return { revision: r2.revision, madeAssetId, madeRevision, transactionId: r2.transactionId ?? '', plan };
  });
}
/** The procedural media a template step still needs (sound effects, elements), made now and carried in its assets. */
async function withTemplateAssets(store: Store, principal: Principal, e: Edit): Promise<OpCall[]> {
  if (!e.needed?.length) return e.ops;
  const extra = await musicFitDeps.makeTemplateAssets(store, principal, { assetsNeeded: e.needed } as Parameters<typeof musicFitDeps.makeTemplateAssets>[2]);
  return e.ops.map((o) => (o.op === 'apply_template' ? { op: o.op, args: { ...(o.args as Record<string, unknown>), assets: [...(((o.args as { assets?: unknown[] }).assets) ?? []), ...extra] } } : o));
}
/** The flash rule on what commit (2) would leave (C10), with the real procedural media when a template needs some. */
async function refuseFlash(store: Store, principal: Principal, doc: ProjectDocument, e: Edit): Promise<void> {
  let after = e.after;
  if (e.needed?.length) after = applyTransaction(doc, await withTemplateAssets(store, principal, e), { idSeed: 'mff_', actor: principal.actor, allowInternal: true }).doc;
  const r = flashRule(doc, after, e.sequenceId);
  if (r.blocking.length) throw musicFitApiError('flashGap', r.blocking[0]!.details);
}
