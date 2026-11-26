/**
 * The made routes and the service the MCP tools share with them (wave 8 motioncode; contract.ts MADE_ROUTES and its RULES). W2.
 *
 * Order of checks on every route: scope (the caller: need() for REST, run(scope) for MCP) → project (it exists, and the grant covers
 * it) → who may act (agents paused: 403 made_agents_paused; governance 'job' / 'edit': Observe and Propose credentials are refused) →
 * body (core MadeRenderRequestSchema / MadeApplyRequestSchema: 400 invalid_request; the page check: 422 made_bad_page ONLY for
 * checkMadePage problems — size, NUL, not UTF-8 — every other finding comes back as a warning with its offset in the 202 answer) →
 * capacity (429 made_busy with Retry-After) → the runner (W1's MadeRunner; until it is wired, 501 made_not_built).
 *
 * Open semantics (decisions.md motioncode 2): any credential that may edit renders and applies its own result, committed AS that
 * credential (the runner commits apply_made_clip). No owner-only route, no hourly cap. Reading a job (report, stills, file) and acting
 * on it (apply, dismiss) is for the owner's session and for the credential that submitted it; another agent gets 403 made_not_yours.
 * `then` on a render is applied when the job succeeds, as the submitter, through the same runner.apply; if that is refused (agents
 * paused meanwhile, the place taken, the project moved) the result waits in its job and the report says why (autoApply).
 * The page text is kept as a content-addressed blob (text/html) named by its sha256 before the runner starts, so GET …/page, the
 * archive and a re-render find it.
 *
 * Retry-After on made_busy is a polling interval (MADE_BUSY_RETRY_SECONDS), not an estimate of when a render ends.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  checkMadePage, MADE_JOB_TYPE, MADE_LIMITS, MADE_WARNINGS, MadeApplyRequestSchema, madeFieldsCheck, MadeRenderRequestSchema,
  type ApplyMadeClipOutput, type MadeApplyRequest, type MadeAssetPage, type MadeField, type MadeJobReport, type MadeRenderRequest,
} from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import type { Governance } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';
import { madeError, notBuiltMadeRunner, type MadeApp, type MadeRouteDeps, type MadeRunner } from './contract.ts';
import { MADE_TEMPLATES, madeTemplate } from './templates/index.ts';

/** Seconds a busy answer asks the caller to wait before asking again (a polling interval, not a measurement). */
export const MADE_BUSY_RETRY_SECONDS = 15;
/** The job statuses that hold a render slot. */
const ACTIVE = ['queued', 'running', 'cancel-requested'] as const;

/** A warning of the page check in the 202 answer, shaped as MadeJobReport's warnings (why = the key of MADE_WARNINGS; Hebrew made.warn.made_static). */
export interface MadeSubmitWarning { why: 'staticHit'; message: string; what: string; at: number }
/** What a render's `then` came to (kept in memory by this process; the job report carries it as autoApply). */
export type MadeAutoApply = { status: 'waiting' } | { status: 'applied'; revision?: number; output?: ApplyMadeClipOutput } | { status: 'refused'; error: { code: string; message: string; hint?: string } };

/** The made operations behind the REST routes and the MCP tools. The caller has checked the scope. */
export interface MadeService {
  render(p: Principal, projectId: string, body: unknown): Promise<{ jobId: string; warnings: MadeSubmitWarning[] }>;
  report(p: Principal, projectId: string, jobId: string): MadeJobReport & { autoApply?: MadeAutoApply };
  still(p: Principal, projectId: string, jobId: string, index: number): { png: Buffer };
  file(p: Principal, projectId: string, jobId: string): { path: string; bytes: number };
  apply(p: Principal, projectId: string, jobId: string, body: unknown): Promise<{ revision: number; output: ApplyMadeClipOutput }>;
  dismiss(p: Principal, projectId: string, jobId: string): { dismissed: true };
  page(p: Principal, projectId: string, assetId: string): MadeAssetPage;
}

/** The routes' own refusals beside core MADE_API (English; Hebrew in packages/i18n/src/made.ts HE_MADE, checked by made-wording.test.ts). */
export const MADE_ROUTE_REFUSALS = {
  notYours: { status: 403, code: 'made_not_yours', message: () => 'this render was started by another credential', hint: 'Read and apply your own renders; the owner\'s session sees all of them.' },
  noTemplate: { status: 400, code: 'invalid_request', message: (id: string) => `no built-in page is named ${id}`, hint: 'Choose one of GET /api/v1/made/templates, or send the page text.' },
  badValues: { status: 400, code: 'invalid_request', message: () => 'the values do not fit the fields of the page', hint: 'Give each value a field of the page: a colour as #rrggbb, a number within its range, a text within its length.' },
  unknownAssets: { status: 400, code: 'invalid_request', message: () => 'the page names files that are not in this project', hint: 'Name files of this project\'s library (get_summary lists them).' },
} as const;
const refuse = <K extends keyof typeof MADE_ROUTE_REFUSALS>(key: K, details: Record<string, unknown>, ...a: Parameters<(typeof MADE_ROUTE_REFUSALS)[K]['message']>) => {
  const r = MADE_ROUTE_REFUSALS[key];
  return new ApiError(r.status, r.code, (r.message as (...x: unknown[]) => string)(...a), details, r.hint);
};
const notYours = (jobId: string) => refuse('notYours', { jobId });
const parse = <S extends z.ZodType>(schema: S, body: unknown): z.infer<S> => {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError(400, 'invalid_request', z.prettifyError(r.error), { issues: r.error.issues });
  return r.data;
};
const sha = (text: string) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

const services = new WeakMap<Store, MadeService>();
/**
 * The service registerMadeRoutes made for this store (the MCP tools use it, so REST and MCP share one runner, one capacity count and
 * one autoApply table); without the app (an MCP endpoint made alone, some tests) a service over the not-built runner.
 */
export function madeServiceFor(store: Store, gov: Governance): MadeService {
  return services.get(store) ?? createMadeService(store, gov, notBuiltMadeRunner);
}

export function createMadeService(store: Store, gov: Governance, runner: MadeRunner): MadeService {
  /** renders between the capacity check and the job row (start is async) */
  const starting: string[] = [];
  const autoApply = new Map<string, MadeAutoApply>();

  const project = (p: Principal, projectId: string) => { store.getProject(projectId); gov.assertMayAct(p, projectId, 'observe'); };
  const mayAct = (p: Principal, projectId: string, need: 'job' | 'edit') => {
    if (p.kind === 'agent' && gov.isPaused(projectId)) throw madeError('agentsPaused', { projectId });
    gov.assertMayAct(p, projectId, need);
  };
  /** the report, after the reading rule: the owner's session, or the credential that submitted it */
  const ownReport = (p: Principal, projectId: string, jobId: string) => {
    const r = runner.report(p, projectId, jobId);
    if (p.kind !== 'user' && r.submittedBy !== p.actor) throw notYours(jobId);
    return r;
  };
  const capacity = (p: Principal) => {
    const rows = store.db.prepare(`SELECT actor FROM jobs WHERE type = ? AND status IN (${ACTIVE.map(() => '?').join(',')})`).all(MADE_JOB_TYPE, ...ACTIVE) as { actor: string }[];
    const actors = [...rows.map((r) => r.actor), ...starting];
    const mine = actors.filter((a) => a === p.actor).length;
    if (mine >= MADE_LIMITS.activePerCredential || actors.length >= MADE_LIMITS.activeTotal)
      throw madeError('busy', { retryAfterSeconds: MADE_BUSY_RETRY_SECONDS, active: actors.length, activeForYou: mine, limits: { perCredential: MADE_LIMITS.activePerCredential, total: MADE_LIMITS.activeTotal } });
  };
  const keepPage = (text: string, hash: string) => {
    if (fs.existsSync(store.blobPath(hash))) return;
    fs.mkdirSync(store.tmpDir, { recursive: true });
    const tmp = path.join(store.tmpDir, `made-page-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    const bytes = Buffer.from(text, 'utf8');
    fs.writeFileSync(tmp, bytes);
    store.putBlob(hash, tmp, bytes.length, 'text/html');
  };
  const thenToApply = (then: NonNullable<MadeRenderRequest['then']>): MadeApplyRequest =>
    'place' in then ? { place: then.place, ...(then.sequenceId !== undefined ? { sequenceId: then.sequenceId } : {}) } : 'replaceAssetId' in then ? { replaceAssetId: then.replaceAssetId } : { library: true };
  /** apply `then` once the job succeeds, as the submitter; the outcome is kept for the report */
  const watchThen = (p: Principal, projectId: string, jobId: string, req: MadeApplyRequest) => {
    autoApply.set(jobId, { status: 'waiting' });
    const onJob = (row: { id?: string; status?: string }) => {
      if (row?.id !== jobId || !row.status || ACTIVE.includes(row.status as (typeof ACTIVE)[number])) return;
      store.events.off('job', onJob);
      if (row.status !== 'succeeded') { autoApply.delete(jobId); return; }
      void runner.apply(p, projectId, jobId, req).then(
        (r) => autoApply.set(jobId, { status: 'applied', revision: r.revision, output: r.output }),
        (e: unknown) => {
          if (e instanceof ApiError && e.code === 'made_already_applied') autoApply.set(jobId, { status: 'applied' });
          else autoApply.set(jobId, { status: 'refused', error: e instanceof ApiError ? { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } : { code: 'internal_error', message: 'the result could not be applied' } });
        },
      );
    };
    store.events.on('job', onJob);
  };

  return {
    async render(p, projectId, body) {
      project(p, projectId);
      mayAct(p, projectId, 'job');
      const req = parse(MadeRenderRequestSchema, body);
      let text: string, hash: string, fields: MadeField[], tpl: { templateId: string; templateVersion: number } | undefined;
      const warnings: MadeSubmitWarning[] = [];
      if (typeof req.page === 'string') {
        const check = checkMadePage(req.page);
        if (check.problems.length) throw madeError('badPage', { problems: check.problems, warnings: check.warnings });
        for (const w of check.warnings) warnings.push({ why: 'staticHit', message: MADE_WARNINGS.staticHit.message(w.what, w.at), what: w.what, at: w.at });
        text = req.page; hash = sha(text); fields = req.fields ?? [];
      } else {
        const t = madeTemplate(req.page.templateId);
        if (!t) throw refuse('noTemplate', { templateId: req.page.templateId, templates: MADE_TEMPLATES.map((x) => x.id) }, req.page.templateId);
        text = t.page; hash = t.pageSha256; fields = t.fields; tpl = { templateId: t.id, templateVersion: t.version };
      }
      const bad = madeFieldsCheck(fields, req.values ?? {});
      if (bad.length) throw refuse('badValues', { fields: bad });
      const unknownAssets = (req.assetIds ?? []).filter((id) => !Object.hasOwn(store.getProject(projectId).doc.assets, id));
      if (unknownAssets.length) throw refuse('unknownAssets', { assetIds: unknownAssets });
      capacity(p);
      keepPage(text, hash);
      starting.push(p.actor);
      let jobId: string;
      try {
        ({ jobId } = await runner.start(p, projectId, tpl ? { ...req, fields } : req, { text, sha256: hash, ...(tpl ?? {}) }));
      } finally { starting.splice(starting.indexOf(p.actor), 1); }
      if (req.then) watchThen(p, projectId, jobId, thenToApply(req.then));
      return { jobId, warnings };
    },
    report(p, projectId, jobId) {
      project(p, projectId);
      const r = ownReport(p, projectId, jobId);
      const a = autoApply.get(jobId);
      return a ? { ...r, autoApply: a } : r;
    },
    still(p, projectId, jobId, index) {
      project(p, projectId);
      if (index !== 0 && index !== 1 && index !== 2) throw madeError('jobNotFound', { index });
      ownReport(p, projectId, jobId);
      return runner.still(p, projectId, jobId, index);
    },
    file(p, projectId, jobId) {
      project(p, projectId);
      ownReport(p, projectId, jobId);
      return runner.file(p, projectId, jobId);
    },
    async apply(p, projectId, jobId, body) {
      project(p, projectId);
      mayAct(p, projectId, 'edit');
      const req = parse(MadeApplyRequestSchema, body ?? {});
      ownReport(p, projectId, jobId);
      return runner.apply(p, projectId, jobId, req);
    },
    dismiss(p, projectId, jobId) {
      project(p, projectId);
      ownReport(p, projectId, jobId);
      runner.dismiss(p, projectId, jobId);
      return { dismissed: true };
    },
    page(p, projectId, assetId) {
      project(p, projectId);
      const doc = store.getProject(projectId).doc;
      const record = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]!.provenance.made : undefined;
      if (!record) throw madeError('noPage', { assetId });
      let page: string;
      try { page = fs.readFileSync(store.blobPath(record.pageSha256), 'utf8'); } catch { throw madeError('noPage', { assetId, pageSha256: record.pageSha256, reason: 'the page file is missing from storage' }); }
      return { assetId, page, record };
    },
  };
}

export function registerMadeRoutes(app: MadeApp, deps: MadeRouteDeps): void {
  const { store, gov, need } = deps;
  const svc = createMadeService(store, gov, deps.runner ?? notBuiltMadeRunner);
  services.set(store, svc);
  const P = '/api/v1/projects/:id';
  const json = async (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => undefined);

  app.get('/api/v1/made/templates', (c) => { need(c, 'observe'); return c.json({ templates: MADE_TEMPLATES, limits: MADE_LIMITS }); });
  app.post(`${P}/made/render`, async (c) => { const p = need(c, 'edit'); return c.json(await svc.render(p, c.req.param('id'), await json(c)), 202); });
  app.get(`${P}/made/jobs/:jobId`, (c) => { const p = need(c, 'observe'); return c.json(svc.report(p, c.req.param('id'), c.req.param('jobId'))); });
  app.get(`${P}/made/jobs/:jobId/still/:index`, (c) => {
    const p = need(c, 'observe');
    const raw = c.req.param('index');
    const { png } = svc.still(p, c.req.param('id'), c.req.param('jobId'), /^[0-2]$/.test(raw) ? Number(raw) : -1);
    return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
  });
  app.get(`${P}/made/jobs/:jobId/file`, (c) => {
    const p = need(c, 'observe');
    const f = svc.file(p, c.req.param('id'), c.req.param('jobId'));
    const stream = Readable.toWeb(fs.createReadStream(f.path)) as unknown as ReadableStream<Uint8Array>;
    return c.body(stream, 200, { 'content-type': 'video/webm', 'content-length': String(f.bytes), 'cache-control': 'no-store' });
  });
  app.post(`${P}/made/jobs/:jobId/apply`, async (c) => { const p = need(c, 'edit'); return c.json(await svc.apply(p, c.req.param('id'), c.req.param('jobId'), await json(c))); });
  app.post(`${P}/made/jobs/:jobId/dismiss`, (c) => { const p = need(c, 'edit'); return c.json(svc.dismiss(p, c.req.param('id'), c.req.param('jobId'))); });
  app.get(`${P}/made/assets/:assetId/page`, (c) => { const p = need(c, 'observe'); return c.json(svc.page(p, c.req.param('id'), c.req.param('assetId'))); });
}
