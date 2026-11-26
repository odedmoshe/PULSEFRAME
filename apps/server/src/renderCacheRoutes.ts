/**
 * The render cache's routes and the segment plan service (ADR-0024; lead wiring). Mounted from http.ts with one line; the MCP
 * tools plan_export (mode=incremental) and get_render_cache call the same service.
 *   POST   /api/v1/projects/:id/exports/segments/plan   observe; the export options (mode incremental); the same blockers as the
 *                                                       export plan (422 render_blocked); → SegmentPlanView
 *   GET    /api/v1/storage/render-cache                 observe; → RenderCacheStatus
 *   DELETE /api/v1/storage/render-cache                 the owner's own session only; segments of an export running now are kept
 * The plan keys the job's render document (renderDocFor), as the export will, with the env of this machine and build. Keying is
 * memoised by (project, revision, what the credential may read, options, engine, encoder): the document of a revision never
 * changes, so only the cached/render state of each segment is looked up again on every request. One plan keys at a time.
 */
import type { Context, Hono } from 'hono';
import { canonical, type ProjectDocument, type RenderCacheStatus, type SegmentPlanView } from '@pulseframe/core';
import { limiter } from './analysis.ts';
import type { Principal, Scope } from './auth.ts';
import { GENERIC_BLOCKER_HINT, renderDocFor, type Exporter, type Manifest } from './export.ts';
import { planSegments, planView, type SegmentEnv, type SegmentPlan } from './exportSegments.ts';
import { peopleAccess } from './peoplePrivacy.ts';
import { frameKeyFor, segmentEnvFor, type SegmentEnvSource } from './renderCacheEnv.ts';
import type { SegmentStore } from './segmentStore.ts';
import { ApiError, type Store } from './store.ts';
import { actsAsOwner } from './autonomy.ts';

export interface RenderCacheService {
  readonly store: SegmentStore;
  status(): RenderCacheStatus;
  /** Owner only (403 owner_required). */
  clear(by: Principal): ReturnType<SegmentStore['clear']> & { status: RenderCacheStatus };
  /** The segment plan of the project as the credential may read it, for these export options. */
  plan(by: Principal, projectId: string, rawOptions: unknown): Promise<SegmentPlanView>;
  env(doc: ProjectDocument, manifest: Manifest): Promise<SegmentEnv>;
}

const MEMO = 8;
export function createRenderCacheService(deps: { store: Store; exporter: Exporter; segments: SegmentStore; envSource: SegmentEnvSource; status?: () => RenderCacheStatus }): RenderCacheService {
  const { store, exporter, segments } = deps;
  const one = limiter(1, 8); // keying a long project takes a while; plans wait their turn (429 busy beyond eight)
  const memo = new Map<string, SegmentPlan>();
  const env = (doc: ProjectDocument, manifest: Manifest) => segmentEnvFor(deps.envSource, doc, manifest);
  return {
    store: segments,
    status: () => (deps.status ?? (() => segments.status()))(),
    clear(by) {
      if (!actsAsOwner(by)) throw new ApiError(403, 'owner_required', 'only the owner can clear the render cache');
      return { ...segments.clear(), status: (deps.status ?? (() => segments.status()))() };
    },
    async plan(by, projectId, rawOptions) {
      const raw = (rawOptions && typeof rawOptions === 'object' ? rawOptions : {}) as Record<string, unknown>;
      if (raw.mode !== undefined && raw.mode !== 'incremental') throw new ApiError(400, 'invalid_request', 'the segment plan is the plan of a fast export: send mode "incremental" or leave it out', { mode: String(raw.mode).slice(0, 32) });
      const p = store.getProject(projectId); // as this credential may read it: the same document its export would snapshot
      const { manifest, blockers, warnings } = exporter.plan(p.doc, p.revision, { ...raw, mode: 'incremental' });
      if (blockers.length) throw new ApiError(422, 'render_blocked', `export cannot start: ${blockers[0]!.message}`, { blockers, warnings }, blockers[0]!.hint ?? GENERIC_BLOCKER_HINT);
      const doc = renderDocFor(p.doc, manifest.options);
      return one(async () => {
        const e = await env(doc, manifest);
        const key = canonical([projectId, p.revision, peopleAccess(by), manifest.options, e.engine, e.encoderId]);
        let plan = memo.get(key);
        if (plan) memo.delete(key);
        else plan = await planSegments(doc, manifest, e, segments, frameKeyFor(doc, manifest, e));
        memo.set(key, plan);
        while (memo.size > MEMO) memo.delete(memo.keys().next().value!);
        // The keys of a revision never change; whether each is stored does.
        const now: SegmentPlan = { ...plan, segments: plan.segments.map((s) => (s.key && s.state !== 'uncacheable' ? { ...s, state: segments.has(s.key) ? 'cached' as const : 'render' as const } : s)) };
        return planView(now, manifest, segments);
      });
    },
    env,
  };
}

export function registerRenderCacheRoutes(app: Hono<{ Variables: { principal: Principal } }>, cache: RenderCacheService, need: (c: Context<{ Variables: { principal: Principal } }>, scope: Scope) => Principal) {
  app.post('/api/v1/projects/:id/exports/segments/plan', async (c) => {
    const who = need(c, 'observe');
    return c.json(await cache.plan(who, c.req.param('id'), await c.req.json().catch(() => ({}))));
  });
  app.get('/api/v1/storage/render-cache', (c) => { need(c, 'observe'); return c.json(cache.status()); });
  app.delete('/api/v1/storage/render-cache', (c) => c.json(cache.clear(need(c, 'observe'))));
}
