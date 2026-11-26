/**
 * The durable job `made.render` («קליפ מקוד», wave 8 motioncode, W1; plan §3.6 with verify C7 and C10 as amended): fetch the page's
 * internet files once, draw every frame in the made browser (apps/renderer made.ts), encode in one pass (encode.ts), check the file
 * (validate.ts), keep the result in the job row until it is applied or dismissed.
 *
 * - Capacity, not permission: at most MADE_LIMITS.activePerCredential active renders per credential and activeTotal in all (429
 *   made_busy). The render takes the compute lane; an agent's render waits while an owner's render waits for the lane (agent jobs
 *   yield to the owner's own made renders; yielding to the owner's other lane work is not built: the lane is FIFO).
 * - Facts fail the job (MADE_JOB_FAILURES): a frame not finished in time, a crash, navigation, the job budget, an empty clip, a file
 *   with the wrong frame count or that does not decode back, an ordinary page that draws a compared frame differently twice, an
 *   internet file that could not be fetched, a restart, a cancel. Everything else is a WARNING with its numbers (MADE_WARNINGS):
 *   flashing (over black and over white), the clock, fonts outside the catalogue, no sandbox, a WebGL page that differs.
 * - The wire carries the table KEYS, as the contract type says (lead, 2026-11-26, after W2): warnings[].why and failure.why are
 *   keys of MADE_WARNINGS / MADE_JOB_FAILURES (`flash`, `frameTimeout`, …); the stored failure also carries the row's `code`
 *   (`made_frame_timeout`, …) for the generic job views.
 * - `then` (apply on success) is done by the routes' watcher (W2, made/routes.ts) as the submitter, never here.
 * - A finished job's output: { fileSha256, pageSha256, record, stills: [sha×3], report }. storage.ts jobPins keeps these blobs until
 *   the job is applied (appliedAssetId), dismissed, or 7 days after it finished; a failed or canceled job keeps nothing.
 * - After a restart a job that was running ends failed (made_restarted); it never resumes.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import {
  FONT_CATALOG, MADE_JOB_FAILURES, MADE_JOB_TYPE, MADE_LIMITS, MADE_OP, MADE_WARNINGS, frameOf, madeFramesFor, madeSizeFor,
  type ApplyMadeClipOutput, type MadeApplyRequest, type MadeField, type MadeJobReport, type MadeRecord, type MadeRenderRequest,
} from '@pulseframe/core';
import { MadeDrawError, MadeHost, madeCompareFrames, type MadeDrawResult } from '@pulseframe/renderer';
import type { ComputeLane } from '../aiContracts.ts';
import type { Principal } from '../governance.ts';
import { describeMedia } from '../ingest.ts';
import { assertStorageRoom } from '../storage.ts';
import { ApiError, type JobRow, type Store } from '../store.ts';
import { madeError } from './contract.ts';
import { MadeEncoder, MadeEncodeError, madePlateArgs, runMadeFfmpeg } from './encode.ts';
import { MadeFetchError, fetchOnce, librariesServed, madeFileResolver, madeFonts, namedAddresses, namedAssetIds, namedFamilies, rewriteAddresses } from './libs.ts';
import { checkMadeFile, differingPixels } from './validate.ts';

type Failure = keyof typeof MADE_JOB_FAILURES;
type Warning = keyof typeof MADE_WARNINGS;
export interface MadeWarningOut { why: string; message: string; at?: number }
export interface MadeFailureOut { code: string; why: string; message: string; hint: string; detail?: string }
const warn = <K extends Warning>(k: K, ...a: Parameters<(typeof MADE_WARNINGS)[K]['message']>): MadeWarningOut => ({ why: k, message: (MADE_WARNINGS[k].message as (...x: unknown[]) => string)(...a) });
const failOut = <K extends Failure>(k: K, a: Parameters<(typeof MADE_JOB_FAILURES)[K]['message']>, detail?: string): MadeFailureOut => {
  const r = MADE_JOB_FAILURES[k];
  return { code: r.code, why: k, message: (r.message as (...x: unknown[]) => string)(...a), hint: r.hint, ...(detail ? { detail: detail.slice(0, 600) } : {}) };
};
class JobFailure extends Error { constructor(readonly out: MadeFailureOut) { super(out.message); } }

/** What the job row's input holds (the page text is a blob named by pageSha256). */
export interface MadeJobInput {
  pageSha256: string; pageBytes: number; templateId?: string; templateVersion?: number;
  name: string; width: number; height: number; rate: T.Rate; frames: number; seed: string;
  fields: MadeField[]; values: Record<string, string>; assetIds: string[];
  capabilities?: MadeRenderRequest['capabilities']; then?: MadeRenderRequest['then'];
  submittedKind: Principal['kind'];
}
export interface MadeJobDeps {
  store: Store; lane: ComputeLane; host: MadeHost;
  /** commit apply_made_clip as `p` (allowInternal); the default commits through the store */
  fetch?: typeof fetch;
  /** budgets (MADE_LIMITS in the product; tests may give a frame more time on a loaded machine) */
  frameMs?: number; jobMs?: number;
}

const ACTIVE = ['queued', 'running', 'cancel-requested'];
/** Typed values for PF.fields: text as string, colour '#rrggbb', number as number (fields only; values for no field are dropped). */
export function typedValues(fields: readonly MadeField[], values: Record<string, string>): { typed: Record<string, string | number>; kept: Record<string, string> } {
  const typed: Record<string, string | number> = {}; const kept: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key] ?? f.default;
    kept[f.key] = v;
    typed[f.key] = f.kind === 'number' ? (Number.isFinite(Number(v)) ? Number(v) : Number(f.default) || 0) : v;
  }
  return { typed, kept };
}
const blobOf = (store: Store, bytes: Buffer, mime: string): string => {
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (!fs.existsSync(store.blobPath(hash))) {
    const tmp = path.join(store.tmpDir, `made-${randomBytes(6).toString('hex')}`);
    fs.mkdirSync(store.tmpDir, { recursive: true });
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    store.putBlob(hash, tmp, bytes.length, mime);
  }
  return hash;
};

export class MadeJobs {
  private running = new Map<string, AbortController>();
  private ownerWaiting = 0;
  private runs = new Set<Promise<void>>();
  private stopping = false;
  private ownerIdle: (() => void)[] = [];
  constructor(private readonly d: MadeJobDeps) {}

  /** Server shutdown: running renders are stopped and their rows left as they are (recover() fails them at the next start). */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const ac of this.running.values()) ac.abort(new Error('shutdown'));
    await Promise.allSettled([...this.runs]);
  }
  /** Jobs cut off by a restart end failed (never resumed). */
  recover(): number {
    let n = 0;
    for (const j of this.d.store.openJobs(MADE_JOB_TYPE)) { this.d.store.updateJob(j.id, { status: 'failed', stage: null, error: failOut('restarted', []) }); n++; }
    return n;
  }

  /** Create the job and start it in the background (scope, project, body and page checks are the route's). */
  start(p: Principal, projectId: string, req: MadeRenderRequest, page: { text: string; sha256: string; templateId?: string; templateVersion?: number; fields?: MadeField[] }): { jobId: string } {
    const store = this.d.store;
    const active = (store.db.prepare(`SELECT actor FROM jobs WHERE type = ? AND status IN (${ACTIVE.map(() => '?').join(',')})`).all(MADE_JOB_TYPE, ...ACTIVE) as { actor: string }[]);
    if (active.filter((r) => r.actor === p.actor).length >= MADE_LIMITS.activePerCredential || active.length >= MADE_LIMITS.activeTotal) throw madeError('busy', { active: active.length, yours: active.filter((r) => r.actor === p.actor).length, retryAfterSeconds: 30 });
    const { doc } = store.getProject(projectId);
    const seqId = req.then && 'place' in req.then ? req.then.sequenceId : undefined;
    const frame = frameOf(doc, seqId && doc.sequences[seqId] ? seqId : doc.mainSequenceId);
    const size = madeSizeFor(frame.width, frame.height);
    const rate = doc.settings.frameRate;
    const frames = madeFramesFor(req.seconds, rate);
    const fields = req.fields ?? page.fields ?? [];
    const { kept } = typedValues(fields, req.values ?? {});
    const bytes = Buffer.from(page.text, 'utf8');
    const pageSha256 = blobOf(store, bytes, 'text/html; charset=utf-8');
    if (pageSha256 !== page.sha256) throw new ApiError(500, 'made_page_hash', 'the page hash does not match its text', { pageSha256, given: page.sha256 });
    const input: MadeJobInput = {
      pageSha256, pageBytes: bytes.length, ...(page.templateId ? { templateId: page.templateId, templateVersion: page.templateVersion ?? 1 } : {}),
      name: req.name, width: size.width, height: size.height, rate, frames, seed: randomBytes(8).toString('hex'), fields, values: kept,
      assetIds: [...new Set(req.assetIds ?? [])], ...(req.capabilities ? { capabilities: req.capabilities } : {}), ...(req.then ? { then: req.then } : {}), submittedKind: p.kind,
    };
    const job = store.createJob(projectId, MADE_JOB_TYPE, p.actor, input);
    store.updateJob(job.id, { stage: 'queued', output: { progress: { frame: 0, frames } } });
    const r = this.run(job.id).catch(() => {});
    this.runs.add(r); void r.finally(() => this.runs.delete(r));
    return { jobId: job.id };
  }

  cancel(jobId: string, actor: string): { jobId: string; status: string; outcome: string } {
    const j = this.d.store.getJob(jobId);
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
    const ac = this.running.get(jobId);
    this.d.store.updateJob(jobId, { status: 'cancel-requested', output: { ...j.output, cancel: { by: actor } } });
    if (ac) { ac.abort(new Error('canceled')); return { jobId, status: 'cancel-requested', outcome: 'interrupt-requested' }; }
    this.d.store.updateJob(jobId, { status: 'canceled', stage: null, error: failOut('canceled', []) });
    return { jobId, status: 'canceled', outcome: 'removed-from-queue' };
  }

  /** Mark a job dismissed (its blobs are let go by the collector); a running job is canceled first. */
  dismiss(jobId: string, actor: string): void {
    const j = this.d.store.getJob(jobId);
    if (ACTIVE.includes(j.status)) this.cancel(jobId, actor);
    const now = this.d.store.getJob(jobId);
    this.d.store.updateJob(jobId, { output: { ...now.output, dismissed: true, dismissedBy: actor } });
  }

  /** Report of a job (the wire carries codes). */
  report(j: JobRow): MadeJobReport {
    const o = j.output ?? {};
    const status = j.status === 'cancel-requested' ? 'running' : (j.status as MadeJobReport['status']);
    const r: MadeJobReport = {
      jobId: j.id, status, stage: (j.status === 'succeeded' ? 'done' : (j.stage ?? 'queued')) as MadeJobReport['stage'],
      progress: o.progress ?? null, submittedBy: j.actor, warnings: (o.report?.warnings ?? o.warnings ?? []) as MadeJobReport['warnings'],
      ...(o.fileSha256 ? { fileSha256: o.fileSha256, record: o.record, stills: o.stills } : {}),
      ...(o.appliedAssetId ? { appliedAssetId: o.appliedAssetId } : {}),
      ...(j.error && j.status !== 'succeeded' ? { failure: { why: j.error.why ?? j.error.code, message: j.error.message, hint: j.error.hint ?? '' } as MadeJobReport['failure'] } : {}),
      ...(typeof o.report?.seconds === 'number' ? { seconds: o.report.seconds } : {}),
    };
    return r;
  }

  /** The asset apply_made_clip imports, built from a finished job (never from caller-supplied pixels). */
  async assetFor(j: JobRow, actor: string): Promise<Record<string, unknown>> {
    const o = j.output; const input = j.input as MadeJobInput;
    const file = this.d.store.blobPath(o.fileSha256);
    const meta = await describeMedia(file);
    const record = o.record as MadeRecord;
    return {
      ...meta, name: input.name.slice(0, 256), contentHash: o.fileSha256, byteSize: fs.statSync(file).size,
      duration: T.frameTime(record.frames, input.rate),
      video: { ...meta.video!, frameRate: input.rate, frameCount: record.frames, width: record.width, height: record.height },
      provenance: { origin: 'generated', importedAt: new Date().toISOString(), importedBy: actor, made: record },
    };
  }

  /** Commit apply_made_clip as `p` (one transaction) and record the asset on the job. */
  async apply(p: Principal, j: JobRow, req: MadeApplyRequest): Promise<{ revision: number; output: ApplyMadeClipOutput }> {
    if (j.status !== 'succeeded') throw madeError('jobNotDone', { jobId: j.id, status: j.status });
    if (j.output?.appliedAssetId) throw madeError('alreadyApplied', { jobId: j.id, assetId: j.output.appliedAssetId });
    if (j.output?.dismissed) throw madeError('jobNotDone', { jobId: j.id, dismissed: true });
    const asset = await this.assetFor(j, p.actor);
    const args = { asset, ...(req.sequenceId ? { sequenceId: req.sequenceId } : {}), ...(req.place ? { place: req.place } : {}), ...(req.replaceAssetId ? { replaceAssetId: req.replaceAssetId } : {}) };
    const c = this.d.store.commit({ projectId: j.projectId, actor: p.actor, allowInternal: true, label: `Made clip: ${(j.input as MadeJobInput).name}`.slice(0, 120), ...(req.expectedRevision !== undefined ? { expectedRevision: req.expectedRevision } : {}), ops: [{ op: MADE_OP, args }] });
    const output = c.results[0]!.output as unknown as ApplyMadeClipOutput;
    const now = this.d.store.getJob(j.id);
    this.d.store.updateJob(j.id, { output: { ...now.output, appliedAssetId: output.assetId, appliedBy: p.actor, appliedRevision: c.revision } });
    return { revision: c.revision, output };
  }

  private async waitTurn(kind: Principal['kind'], signal: AbortSignal): Promise<void> {
    if (kind === 'user') return;
    while (this.ownerWaiting > 0) {
      await new Promise<void>((resolve, reject) => { this.ownerIdle.push(resolve); signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    }
  }

  private async run(jobId: string): Promise<void> {
    const store = this.d.store;
    const ac = new AbortController();
    this.running.set(jobId, ac);
    const j0 = store.getJob(jobId);
    const input = j0.input as MadeJobInput;
    const owner = input.submittedKind === 'user';
    if (owner) this.ownerWaiting++;
    let release: (() => void) | null = null;
    const work = path.join(store.tmpDir, `made-${jobId}`);
    const started = Date.now();
    const set = (patch: Parameters<Store['updateJob']>[1]) => { const cur = store.getJob(jobId); store.updateJob(jobId, { ...patch, ...(patch.output ? { output: { ...cur.output, ...(patch.output as object) } } : {}) }); };
    try {
      await this.waitTurn(input.submittedKind, ac.signal);
      release = await this.d.lane.acquire(`made.render ${jobId}`, ac.signal);
      if (owner) { this.ownerWaiting--; if (this.ownerWaiting === 0) for (const f of this.ownerIdle.splice(0)) f(); }
      if (ac.signal.aborted) throw new JobFailure(failOut('canceled', []));
      set({ status: 'running', stage: 'fetching' });
      fs.mkdirSync(work, { recursive: true });
      const out = await this.render(jobId, input, ac.signal, work, (patch) => set(patch));
      set({ status: 'succeeded', stage: 'done', output: { ...out, report: { ...out.report, seconds: Math.round((Date.now() - started) / 100) / 10 } } });
    } catch (e: any) {
      if (this.stopping) return;
      const canceled = ac.signal.aborted || store.getJob(jobId).status === 'cancel-requested';
      const f: MadeFailureOut = canceled ? failOut('canceled', [])
        : e instanceof JobFailure ? e.out
        : e instanceof MadeDrawError ? (e.why === 'frameTimeout' ? failOut('frameTimeout', [e.frame ?? 0, this.d.frameMs ?? MADE_LIMITS.frameMs], e.detail)
          : e.why === 'jobTimeout' ? failOut('jobTimeout', [Math.round((this.d.jobMs ?? MADE_LIMITS.jobMs) / 60000)])
          : e.why === 'navigated' ? failOut('navigated', [])
          : e.why === 'canceled' ? failOut('canceled', []) : failOut('crashed', [], e.detail ?? e.message))
        : e instanceof MadeFetchError ? failOut('fetchFailed', [e.url], e.message)
        : failOut('crashed', [], `${e?.code ?? ''} ${e?.message ?? e}`.trim());
      store.updateJob(jobId, { status: canceled ? 'canceled' : 'failed', stage: null, error: f });
    } finally {
      if (owner && release === null) { this.ownerWaiting = Math.max(0, this.ownerWaiting - 1); if (this.ownerWaiting === 0) for (const f of this.ownerIdle.splice(0)) f(); }
      release?.();
      this.running.delete(jobId);
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  /** Fetch, draw, encode, check. Returns the job output (blobs stored). */
  private async render(jobId: string, input: MadeJobInput, signal: AbortSignal, work: string, set: (p: Parameters<Store['updateJob']>[1]) => void) {
    const store = this.d.store;
    const j = store.getJob(jobId);
    const original = fs.readFileSync(store.blobPath(input.pageSha256), 'utf8');
    // internet files: fetched once, before drawing
    const urls = namedAddresses(original);
    const fetched = urls.length ? await fetchOnce(urls, { signal, ...(this.d.fetch ? { fetch: this.d.fetch } : {}) }) : [];
    const page = rewriteAddresses(original, fetched.map((f) => f.url));
    // the owner's media, read-only
    const { doc } = store.getProject(j.projectId);
    const assets = new Map<string, { file: string; mime: string }>();
    for (const id of new Set([...input.assetIds, ...namedAssetIds(original)])) {
      const a = Object.hasOwn(doc.assets, id) ? doc.assets[id] : undefined;
      if (a && fs.existsSync(store.blobPath(a.contentHash))) assets.set(id, { file: store.blobPath(a.contentHash), mime: a.mimeType });
    }
    const { typed } = typedValues(input.fields, input.values);
    const fonts = madeFonts();
    const named = namedFamilies(original);
    const n = input.frames;
    const stillsAt = [0, Math.floor(n / 2), n - 1];
    const stills = new Map<number, Buffer>();
    const encoded = path.join(work, 'out.webm');
    const encoder = new MadeEncoder({ width: input.width, height: input.height, rate: input.rate, out: encoded, signal });
    set({ stage: 'drawing', output: { progress: { frame: 0, frames: n } } });
    let lastProgress = 0;
    let drawn: MadeDrawResult;
    try {
      drawn = await this.d.host.draw({
        page, width: input.width, height: input.height, fps: input.rate, frames: n, fields: typed,
        file: madeFileResolver({ fetched, assets }),
        fonts: fonts.faces.map((f) => ({ family: f.family, weight: f.weight, url: f.url, ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}), preload: named.has(f.family) })),
        catalogueFamilies: FONT_CATALOG.map((f) => f.family),
        compareFrames: madeCompareFrames(n, input.seed, MADE_LIMITS.determinismFrames),
        frameMs: this.d.frameMs ?? MADE_LIMITS.frameMs, jobMs: this.d.jobMs ?? MADE_LIMITS.jobMs, signal,
        onFrame: async (i, png) => {
          if (stillsAt.includes(i)) stills.set(i, png);
          await encoder.push(png);
          if (Date.now() - lastProgress > 1000 || i === n - 1) { lastProgress = Date.now(); set({ output: { progress: { frame: i + 1, frames: n } } }); }
        },
      });
    } catch (e) { encoder.kill(); throw e; }
    set({ stage: 'encoding' });
    let analysis;
    try { analysis = await encoder.finish(); } catch (e) { throw e instanceof MadeEncodeError && e.message === 'canceled' ? new JobFailure(failOut('canceled', [])) : new JobFailure(failOut('decodeBack', [0], (e as Error).message)); }
    if (analysis.drawnFrames === 0) throw new JobFailure(failOut('empty', []));
    if (analysis.frames !== n) throw new JobFailure(failOut('frameCount', [analysis.frames, n]));
    // determinism: an ordinary page fails; a WebGL page warns with the pixel count
    const webgl = drawn.webgl || !!input.capabilities?.webgl;
    const warnings: ReturnType<typeof warn>[] = [];
    let differing = 0;
    for (const c of drawn.compared) {
      if (c.equalBytes) continue;
      const px = await differingPixels(c.a, c.b);
      if (px === 0) continue;
      if (!webgl) throw new JobFailure(failOut('notDeterministic', [c.frame], `${px} pixels differ`));
      differing += px;
      warnings.push({ ...warn('webglDiffers', px, c.frame), at: c.frame });
    }
    if (drawn.sandbox === 'none') warnings.push(warn('noSandbox'));
    for (const u of drawn.clock) warnings.push({ ...warn('clock', u.api, u.frame), at: u.frame });
    for (const f of drawn.missingFonts) warnings.push(warn('fontMissing', f));
    const fl = analysis.flash;
    if (Math.max(fl.black.general, fl.black.red) > MADE_LIMITS.flashPerSecond) warnings.push(warn('flash', String(Math.max(fl.black.general, fl.black.red)), 'black'));
    if (Math.max(fl.white.general, fl.white.red) > MADE_LIMITS.flashPerSecond) warnings.push(warn('flash', String(Math.max(fl.white.general, fl.white.red)), 'white'));
    // a full-frame plate is encoded again without alpha
    let file = encoded;
    if (!analysis.alpha) { file = path.join(work, 'plate.webm'); await runMadeFfmpeg(madePlateArgs(encoded, file), signal); }
    set({ stage: 'checking-file' });
    const check = await checkMadeFile(file, { width: input.width, height: input.height, rate: input.rate, frames: n, alpha: analysis.alpha, samples: stillsAt.filter((f, i, a) => a.indexOf(f) === i).map((f) => ({ frame: f, png: stills.get(f)! })), signal });
    if (!check.ok) throw new JobFailure(check.why === 'frameCount' ? failOut('frameCount', [check.got, check.want], check.detail) : failOut('decodeBack', [check.frame], check.detail));
    // keep the results
    const bytes = fs.readFileSync(file);
    assertStorageRoom(store, bytes.length, 'keep the made clip');
    const fileSha256 = blobOf(store, bytes, 'video/webm');
    const stillShas = stillsAt.map((f) => blobOf(store, stills.get(f)!, 'image/png')) as [string, string, string];
    const libraries = librariesServed(drawn.served);
    const usedAssets = [...assets.keys()];
    const record: MadeRecord = {
      v: 1, pageSha256: input.pageSha256, pageBytes: input.pageBytes,
      ...(input.templateId ? { templateId: input.templateId, templateVersion: input.templateVersion ?? 1 } : {}),
      fields: input.fields, values: input.values, frames: n, width: input.width, height: input.height,
      browser: drawn.browser.slice(0, 80), sandbox: drawn.sandbox, ...(webgl ? { webgl: true as const } : {}),
      ...(libraries.length ? { libraries } : {}), ...(usedAssets.length ? { assetIds: usedAssets } : {}),
      ...(fetched.length ? { fetched: fetched.map((f) => ({ url: f.url, sha256: f.sha256, bytes: f.bytes })) } : {}),
      checks: { determinism: { frames: drawn.compared.map((c) => c.frame), ...(webgl ? { differingPixels: differing } : {}) }, flash: { black: fl.black, white: fl.white }, alpha: analysis.alpha },
    };
    return {
      fileSha256, pageSha256: input.pageSha256, record, stills: stillShas, progress: { frame: n, frames: n },
      report: { warnings, fontsChecked: drawn.fontsChecked, decodeBack: check.compared, emptyEnds: analysis.emptyEnds, drawnFrames: analysis.drawnFrames, maxAnimations: drawn.maxAnimations, pageErrors: drawn.pageErrors, sandbox: drawn.sandbox, ...(drawn.sandboxWarning ? { sandboxWarning: drawn.sandboxWarning } : {}) },
    };
  }
}
