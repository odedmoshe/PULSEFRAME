/**
 * Capabilities (ADR-0017): one registry dispatched by provider, start/estimate, placement modes, every declared output imported,
 * model downloads (owner only, exact bytes, hosts, free disk), agent caps and evidence by logic digest.
 * Providers are LABELLED FAKES in this file (FakeComfy writes PNGs of the size a test asks for; FakeLocalTools records calls).
 * No ComfyUI, no model file, no network: no test here reaches a download.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { canonical, findClip, type MediaClip } from '@pulseframe/core';
import {
  DescriptorSchema, IMAGE_REMOVE_BACKGROUND, IMAGE_UPSCALE, VIDEO_SMOOTH_SLOWMO, type CapabilityDescriptor, type CollectedOutput, type ComfyDescriptor, type LocalToolDescriptor, type ProviderAdapter,
} from '@pulseframe/providers';
import type { LocalToolRunner, RunRequest, SetupState } from './aiContracts.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { ingestUpload } from './ingest.ts';
import { ModelStore } from './models.ts';
import { ApiError, Store, type JobRow } from './store.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-caps-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args]);
/** A PNG of a given size; `look` picks the picture, so different outputs (and the source) have different bytes. */
const png = (w: number, h: number, look = 0) => {
  const f = path.join(root, `p_${w}x${h}_${look}.png`);
  if (!fs.existsSync(f)) ff(['-f', 'lavfi', '-i', [`testsrc2=s=${w}x${h}`, `color=c=gray:s=${w}x${h}`, `testsrc=s=${w}x${h}`][look]!, '-frames:v', '1', f]);
  return f;
};
const refused = async (fn: () => unknown) => { try { await fn(); } catch (e) { if (e instanceof ApiError) return `${e.status}:${e.code}`; throw e; } return 'accepted'; };
const pass = { status: 'pass' as const };
const passAll = { schemaValid: pass, dependencyReady: pass, licenseReviewed: pass, executed: pass, qualityReviewed: pass, hebrewQualified: { status: 'not_applicable' as const }, hardwareQualified: pass };

/** Test copies (labelled) of reviewed descriptors with no model file, so the fake provider can run them. Same graphs. */
const UPSCALE_NO_MODEL: ComfyDescriptor = { ...IMAGE_UPSCALE, models: [], resources: { ...IMAGE_UPSCALE.resources, downloadBytes: 0 } };
const MATTE_NO_MODEL: ComfyDescriptor = { ...IMAGE_REMOVE_BACKGROUND, models: [], resources: { ...IMAGE_REMOVE_BACKGROUND.resources, downloadBytes: 0 } };
const SLOWMO_NO_MODEL: ComfyDescriptor = { ...VIDEO_SMOOTH_SLOWMO, models: [], resources: { ...VIDEO_SMOOTH_SLOWMO.resources, downloadBytes: 0 }, limits: { maxFrames: 1000, maxPixels: 1280 * 720 } };
/** Test fixture (labelled): a local tool shaped like the voice-cleanup descriptor W2 adds. */
const LOCAL: LocalToolDescriptor = DescriptorSchema.parse({
  id: 'test.local.voice', version: '0.1.0', provider: 'local', state: 'published', title: { he: 'בדיקה', en: 'Fixture' }, description: { he: 'בדיקה', en: 'Fixture' },
  source: { repository: null, commit: null, notices: null },
  inputs: [{ name: 'attenLimitDb', label: { he: 'הנחתה', en: 'Attenuation' }, type: 'int', binding: null, required: false, default: 24, allowed: [6, 12, 24, 100], reviewed: true }],
  outputs: [{ name: 'audio', role: 'audio', mediaType: 'audio', nodeId: null, reviewed: true }],
  models: [], limits: { maxFrames: null, maxPixels: null }, resources: { downloadBytes: 0, estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
  egress: 'none', languages: [], limitations: [], qualification: passAll,
  engine: { kind: 'binary', configVar: 'PF_DENOISE_BIN' }, task: 'voice-clean', codeFiles: ['apps/server/tools/pf_tools.py'], codeDigest: `sha256:${'c'.repeat(64)}`,
}) as LocalToolDescriptor;

/** LABELLED FAKE ComfyUI: every prompt succeeds at once (or stays running when `hold`), and returns PNGs of the sizes in `produce`. */
class FakeComfy implements ProviderAdapter {
  readonly id = 'fake-comfyui (test double)';
  produce: Record<string, { width: number; height: number }> = {};
  hold = false;
  private n = 0;
  probe = async () => ({ reachable: true, wokeWorker: false as const, runtimeVersion: 'fake', device: { name: 'fake-cpu', type: 'cpu', vramTotalBytes: null }, hostRamBytes: null, missingNodeClasses: [], missingModels: [], problems: [] });
  estimate = () => ({ downloadBytes: 0, durationSeconds: null, costUsd: null, basis: 'none' as const });
  stage = async (_p: string, name: string) => name;
  submit = async (_g: unknown, clientRequestId: string) => ({ providerJobId: `fake_${++this.n}`, clientRequestId });
  status = async () => (this.hold ? { state: 'running' as const } : { state: 'succeeded' as const });
  findByClientRequestId = async () => null;
  cancel = async () => 'not-supported' as const;
  running = async () => [];
  async collect(d: ComfyDescriptor, _id: string, destDir: string): Promise<CollectedOutput[]> {
    fs.mkdirSync(destDir, { recursive: true });
    return d.outputs.map((o, i) => {
      const size = this.produce[o.name] ?? { width: 8, height: 8 };
      const out = path.join(destDir, `out_${i}.png`);
      fs.copyFileSync(png(size.width, size.height, i % 2), out);
      const bytes = fs.readFileSync(out);
      return { name: o.name, role: o.role, mediaType: o.mediaType as 'image', encoding: o.encoding, fileName: `out_${i}.png`, path: out, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
  }
}
/** LABELLED FAKE LocalToolRunner (W2 implements the real one in localtools.ts): records what Capabilities calls. */
class FakeLocalTools implements LocalToolRunner {
  calls: string[] = [];
  constructor(private store: Store, private dir: string) {}
  setup = async (): Promise<SetupState> => ({ code: 'ready', detail: 'fake engine', device: 'cpu', versions: { fake: '1' } });
  models = () => new ModelStore(this.dir, []);
  prepare(_d: LocalToolDescriptor, req: RunRequest) {
    this.calls.push('prepare');
    if (!req.source) throw new ApiError(422, 'source_required', 'this tool reads a clip or a library asset');
    return { range: { firstSample: 0, samples: 48_000 }, capabilityId: 'must-not-override' };
  }
  async drive(jobId: string) { this.calls.push(`drive ${jobId}`); this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: { fake: true } }); }
  cancel(jobId: string) { this.calls.push(`cancel ${jobId}`); return { jobId, status: 'canceled', outcome: 'killed' }; }
  recover(jobs: JobRow[]) { this.calls.push(`recover ${jobs.map((j) => j.id).join(',')}`); }
  releaseKept = async () => {};
}

let envN = 0;
async function setup(o: { registry?: CapabilityDescriptor[]; cfg?: Partial<Config>; adapter?: ProviderAdapter | null; local?: boolean; freeBytes?: number } = {}) {
  const dir = path.join(root, `env${envN++}`);
  const cfg: Config = { ...loadConfig({}), dataDir: path.join(dir, 'data'), comfyuiModelsDir: path.join(dir, 'models'), toolsModelsDir: path.join(dir, 'tool-models'), ...o.cfg };
  const store = new Store(cfg.dataDir);
  const fake = new FakeComfy();
  const local = o.local ? new FakeLocalTools(store, cfg.toolsModelsDir) : null;
  const caps = new Capabilities(store, cfg, o.adapter === null ? undefined : (o.adapter ?? fake), { registry: o.registry ? () => o.registry! : undefined, localTools: local, pollMs: 10, freeBytes: () => o.freeBytes ?? 1e12, providerInputDir: null });
  const pid = store.createProject({ name: 'caps', width: 64, height: 36 }).doc.id;
  const ingest = async (file: string, name: string) => {
    const asset = await ingestUpload(store, Readable.toWeb(fs.createReadStream(file)) as any, name, 'user:owner', 1 << 26);
    return store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
  };
  return { dir, cfg, store, caps, fake, local, pid, ingest };
}
const settle = async (store: Store, jobId: string) => {
  for (let i = 0; i < 3000; i++) { const j = store.getJob(jobId); if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('job did not settle');
};

describe('model downloads: owner only, exact bytes, allowed hosts, free disk (refused before any byte moves)', () => {
  it('an agent gets 403; a confirmBytes mismatch 409; an unlisted host host_not_allowed; low free space disk_insufficient', async () => {
    const bytes = IMAGE_UPSCALE.models[0]!.bytes!;
    let s = await setup();
    try {
      expect(await refused(() => s.caps.startDownload(s.pid, IMAGE_UPSCALE.id, bytes, 'agent:local'))).toBe('403:human_approval_required');
      expect(await refused(() => s.caps.startDownload(s.pid, IMAGE_UPSCALE.id, bytes - 1, 'user:local'))).toBe('409:download_size_mismatch');
      expect(await refused(() => s.caps.startDownload(s.pid, 'nope.nope', bytes, 'user:local'))).toBe('404:capability_not_found');
    } finally { await s.caps.stop(); s.store.close(); }
    s = await setup({ cfg: { modelHosts: ['huggingface.co', '.hf.co'] } });
    try {
      const e = await s.caps.startDownload(s.pid, IMAGE_UPSCALE.id, bytes, 'user:local').catch((x) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect(e).toMatchObject({ status: 409, code: 'host_not_allowed', details: { hosts: ['github.com'] } });
      expect((await s.caps.estimate({ projectId: s.pid, capabilityId: IMAGE_UPSCALE.id, params: {}, actor: 'user:local' })).setup).toMatchObject({ code: 'host_not_allowed', hosts: ['github.com'] });
      expect(s.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'model-download'").get()).toEqual({ n: 0 });
    } finally { await s.caps.stop(); s.store.close(); }
    s = await setup({ freeBytes: 1_000_000 });
    try {
      const e = await s.caps.startDownload(s.pid, IMAGE_UPSCALE.id, bytes, 'user:local').catch((x) => x);
      expect(e).toMatchObject({ status: 409, code: 'disk_insufficient', details: { freeBytes: 1_000_000, missingBytes: bytes } });
      expect((await s.caps.estimate({ projectId: s.pid, capabilityId: IMAGE_UPSCALE.id, params: {}, actor: 'user:local' })).setup.code).toBe('disk_insufficient');
    } finally { await s.caps.stop(); s.store.close(); }
  });
  it('with room and allowed hosts the setup state names the exact missing bytes; a local tool without a runner cannot download', async () => {
    const s = await setup({ registry: [IMAGE_UPSCALE, LOCAL] });
    try {
      const est = await s.caps.estimate({ projectId: s.pid, capabilityId: IMAGE_UPSCALE.id, params: {}, actor: 'user:local' });
      expect(est.setup).toMatchObject({ code: 'model_missing', missingBytes: IMAGE_UPSCALE.models[0]!.bytes });
      expect(est.missingDownloadBytes).toBe(IMAGE_UPSCALE.models[0]!.bytes);
      expect(await refused(() => s.caps.startDownload(s.pid, LOCAL.id, 1, 'user:local'))).toBe('503:engine_not_configured');
    } finally { await s.caps.stop(); s.store.close(); }
  });
});

describe('setup states and estimates', () => {
  it('no provider → provider_not_configured; licence-blocked models → licence_blocked; a frame plan is estimated with no measured time', async () => {
    let s = await setup({ adapter: null, cfg: { comfyuiUrl: null } });
    try {
      expect((await s.caps.estimate({ projectId: s.pid, capabilityId: IMAGE_UPSCALE.id, params: {}, actor: 'user:local' })).setup.code).toBe('provider_not_configured');
    } finally { await s.caps.stop(); s.store.close(); }
    const pending = { ...IMAGE_UPSCALE, models: [{ ...IMAGE_UPSCALE.models[0]!, commercialUse: 'unknown' as const }] };
    s = await setup({ registry: [pending, SLOWMO_NO_MODEL] });
    try {
      expect((await s.caps.estimate({ projectId: s.pid, capabilityId: pending.id, params: {}, actor: 'user:local' })).setup.code).toBe('licence_blocked');
      const video = path.join(s.dir, 'v.mp4');
      ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30', '-frames:v', '90', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
      const assetId = await s.ingest(video, 'v.mp4');
      const est = await s.caps.estimate({ projectId: s.pid, capabilityId: SLOWMO_NO_MODEL.id, params: { multiplier: 4 }, actor: 'user:local', source: { assetId } });
      expect(est).toMatchObject({ setup: { code: 'ready', device: 'fake-cpu' }, frames: 90, chunks: 2, seconds: null, basis: 'none', needsConfirm: false, missingDownloadBytes: 0 });
      expect(est.scratchBytes).toBeGreaterThan(0);
      // the first run on this machine is capped at 60 frames: listed as a blocker, and start refuses it before a job exists
      expect(est.blockers.map((b) => b.code)).toEqual(['first_run_limit']);
      expect(await refused(() => s.caps.start({ projectId: s.pid, capabilityId: SLOWMO_NO_MODEL.id, params: { multiplier: 4 }, actor: 'user:local', source: { assetId } }))).toBe('409:first_run_limit');
      expect(s.store.openJobs('capability')).toEqual([]);
      const short = await s.caps.estimate({ projectId: s.pid, capabilityId: SLOWMO_NO_MODEL.id, params: { multiplier: 4 }, actor: 'user:local', source: { assetId, range: { firstFrame: 0, frameCount: 60 } } });
      expect(short.blockers).toEqual([]);
    } finally { await s.caps.stop(); s.store.close(); }
  }, 60_000);
});

describe('agent caps', () => {
  it('an agent over 300 frames gets 409 agent_limit; an agent may have at most 2 AI jobs waiting or running', async () => {
    const s = await setup({ registry: [SLOWMO_NO_MODEL], cfg: { aiFirstRunMaxFrames: 1000 } });
    try {
      // a long video asset record (fixture: start only plans from the document, it reads no file before the job exists)
      const longAsset = { kind: 'video' as const, name: 'long.mp4', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(400, { num: 30, den: 1 }), video: { width: 64, height: 36, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 400 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
      const assetId = s.store.commit({ projectId: s.pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: longAsset } }] }).results[0]!.output!.assetId as string;
      const run = (actor: string, frameCount: number) => s.caps.start({ projectId: s.pid, capabilityId: SLOWMO_NO_MODEL.id, params: { multiplier: 2 }, actor, source: { assetId, range: { firstFrame: 0, frameCount } } });
      expect(await refused(() => run('agent:local', 301))).toBe('409:agent_limit');
      s.fake.hold = true; // the provider keeps every prompt running, so the jobs stay open
      expect(await refused(() => run('agent:local', 10))).toBe('accepted');
      expect(await refused(() => run('agent:local', 10))).toBe('accepted');
      expect(await refused(() => run('agent:local', 10))).toBe('409:agent_limit');
      expect(await refused(() => run('user:local', 301))).toBe('accepted'); // the owner is not capped
    } finally { await s.caps.stop(); s.store.close(); }
  }, 60_000);
});

describe('stills: source, placement modes, every declared output, mime by container, evidence by logic digest', () => {
  it('upscale 2x in place of a still clip (replace_clip_asset), exact undo; a wrong size never reaches the project', async () => {
    const s = await setup({ registry: [UPSCALE_NO_MODEL] });
    try {
      const assetId = await s.ingest(png(16, 12, 2), 'photo.png');
      const clipId = s.store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId, start: T.ZERO } }] }).results[0]!.output!.clipId as string;
      const before = canonical(s.store.getProject(s.pid).doc);
      s.fake.produce = { image: { width: 32, height: 24 } };
      const job = s.caps.start({ projectId: s.pid, capabilityId: UPSCALE_NO_MODEL.id, params: { scale: 0.5 }, actor: 'user:owner', source: { clipId }, apply: 'replace-clip' });
      expect(job.input).toMatchObject({ params: { image: assetId, scale: 0.5 }, placement: { mode: 'replace-clip', clipId }, logicDigest: IMAGE_UPSCALE.graphDigest });
      const done = await settle(s.store, job.id);
      expect(done.status, JSON.stringify(done.error)).toBe('succeeded');
      expect(done.output.bundle[0]).toMatchObject({ mimeType: 'image/png', width: 32, height: 24 });
      expect(done.output.attachment).toMatchObject({ status: 'attached', mode: 'replace-clip', clipId, previousAssetId: assetId });
      const doc = s.store.getProject(s.pid).doc;
      const derived = doc.assets[done.output.attachment.assetId]!;
      expect((findClip(doc, clipId)!.clip as MediaClip).assetId).toBe(derived.id);
      expect(derived.provenance.derived).toMatchObject({ sourceAssetIds: [assetId], logicDigest: IMAGE_UPSCALE.graphDigest, models: [] });
      s.store.undo(s.pid, 'user:owner', 'undo');
      const back = s.store.getProject(s.pid).doc;
      const { [derived.id]: _x, ...assets } = back.assets;
      expect(canonical({ ...back, assets })).toBe(before);
      // evidence: the recorded run is found by the logic digest
      const listed = (await s.caps.list()).capabilities.find((c) => c.id === UPSCALE_NO_MODEL.id)!;
      expect(listed.qualification.executed.status).toBe('pass');
      expect(listed.logicDigest).toBe(IMAGE_UPSCALE.graphDigest);
      // 3x was asked for but the provider sent 4x: output_invalid, nothing imported
      s.fake.produce = { image: { width: 64, height: 48 } };
      const bad = await settle(s.store, s.caps.start({ projectId: s.pid, capabilityId: UPSCALE_NO_MODEL.id, params: { scale: 0.75 }, actor: 'user:owner', source: { assetId } }).id);
      expect(bad).toMatchObject({ status: 'failed', error: { code: 'output_invalid', message: 'output "image" is 64x48, expected 48x36' } });
    } finally { await s.caps.stop(); s.store.close(); }
  }, 60_000);
  it('new-track places the result at the clip\'s start on another track; a stale clip makes it a proposal', async () => {
    const s = await setup({ registry: [UPSCALE_NO_MODEL] });
    try {
      const assetId = await s.ingest(png(16, 12, 2), 'photo.png');
      const clipId = s.store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId, start: T.rt(1, 1) } }] }).results[0]!.output!.clipId as string;
      s.fake.produce = { image: { width: 64, height: 48 } };
      const done = await settle(s.store, s.caps.start({ projectId: s.pid, capabilityId: UPSCALE_NO_MODEL.id, params: { scale: 1 }, actor: 'user:owner', source: { clipId }, apply: 'new-track' }).id);
      expect(done.output.attachment).toMatchObject({ status: 'attached', mode: 'new-track' });
      const doc = s.store.getProject(s.pid).doc;
      const placed = findClip(doc, done.output.attachment.clipId)!;
      const orig = findClip(doc, clipId)!;
      expect(placed.track.id).not.toBe(orig.track.id);
      expect(T.eq(placed.clip.start, orig.clip.start) && T.eq(placed.clip.duration, orig.clip.duration)).toBe(true);
      // replace-clip, but the clip is edited while the job runs: kept as a proposal, the newer edit wins
      s.fake.hold = true;
      const job = s.caps.start({ projectId: s.pid, capabilityId: UPSCALE_NO_MODEL.id, params: { scale: 1 }, actor: 'user:owner', source: { clipId }, apply: 'replace-clip' });
      s.store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'move_clip', args: { clipId, start: T.rt(2, 1) } }] });
      s.fake.hold = false;
      const late = await settle(s.store, job.id);
      expect(late.output.attachment).toMatchObject({ status: 'proposed', conflicts: [expect.objectContaining({ entityId: clipId })] });
      expect((findClip(s.store.getProject(s.pid).doc, clipId)!.clip as MediaClip).assetId).toBe(assetId);
    } finally { await s.caps.stop(); s.store.close(); }
  }, 60_000);
  it('every declared output is imported (cutout and matte), with its role', async () => {
    const s = await setup({ registry: [MATTE_NO_MODEL] });
    try {
      const assetId = await s.ingest(png(16, 12, 2), 'photo.png');
      s.fake.produce = { cutout: { width: 16, height: 12 }, matte: { width: 16, height: 12 } };
      const done = await settle(s.store, s.caps.start({ projectId: s.pid, capabilityId: MATTE_NO_MODEL.id, params: { image: assetId }, actor: 'user:owner' }).id);
      expect(done.status, JSON.stringify(done.error)).toBe('succeeded');
      expect(done.output.attachment.assets.map((a: any) => [a.name, a.role])).toEqual([['cutout', 'primary'], ['matte', 'matte']]);
      const doc = s.store.getProject(s.pid).doc;
      expect(done.output.attachment.assetId).toBe(done.output.attachment.assets[0].assetId);
      expect(doc.assets[done.output.attachment.assets[1].assetId]!.provenance.derived).toMatchObject({ outputName: 'matte', outputRole: 'matte' });
    } finally { await s.caps.stop(); s.store.close(); }
  }, 60_000);
  it('placement needs a clip source; a range on a still is refused; slow motion cannot go on a new track', async () => {
    const s = await setup({ registry: [UPSCALE_NO_MODEL, SLOWMO_NO_MODEL] });
    try {
      const assetId = await s.ingest(png(16, 12, 2), 'photo.png');
      const req = { projectId: s.pid, capabilityId: UPSCALE_NO_MODEL.id, params: {}, actor: 'user:owner' };
      expect(await refused(() => s.caps.start({ ...req, source: { assetId }, apply: 'replace-clip' }))).toBe('422:invalid_request');
      expect(await refused(() => s.caps.start({ ...req, source: { assetId, range: { firstFrame: 0, frameCount: 1 } } }))).toBe('422:invalid_request');
      expect(await refused(() => s.caps.start({ ...req, params: { image: assetId, scale: 0.6 } }))).toBe('422:invalid_parameter');
      const video = path.join(s.dir, 'v.mp4');
      ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30', '-frames:v', '10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
      const vid = await s.ingest(video, 'v.mp4');
      const clipId = s.store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId: vid, start: T.ZERO } }] }).results[0]!.output!.clipId as string;
      expect(await refused(() => s.caps.start({ projectId: s.pid, capabilityId: SLOWMO_NO_MODEL.id, params: { multiplier: 2 }, actor: 'user:owner', source: { clipId }, apply: 'new-track' }))).toBe('422:invalid_request');
      expect(await refused(() => s.caps.start({ projectId: s.pid, capabilityId: SLOWMO_NO_MODEL.id, params: { multiplier: 2 }, actor: 'user:owner' }))).toBe('422:invalid_request'); // no source
      expect(await refused(() => s.caps.start({ projectId: s.pid, capabilityId: SLOWMO_NO_MODEL.id, params: { multiplier: 2, video: assetId }, actor: 'user:owner', source: { clipId } }))).toBe('422:invalid_request'); // two different sources
    } finally { await s.caps.stop(); s.store.close(); }
  }, 60_000);
});

describe('provider local: dispatched to the injected LocalToolRunner', () => {
  it('prepare runs synchronously before the job exists and its additions are persisted; drive, cancel and recover go to the runner', async () => {
    const s = await setup({ registry: [LOCAL], local: true });
    try {
      const req = { projectId: s.pid, capabilityId: LOCAL.id, params: { attenLimitDb: 12 }, actor: 'user:owner' };
      expect(await refused(() => s.caps.start(req))).toBe('422:source_required');
      expect(s.store.openJobs('capability')).toEqual([]);
      expect(await refused(() => s.caps.start({ ...req, params: { attenLimitDb: 13 }, source: { assetId: 'ast_x' } }))).toBe('422:invalid_parameter');
      const job = s.caps.start({ ...req, source: { assetId: 'ast_x' } });
      expect(job.input).toMatchObject({ provider: 'local', capabilityId: LOCAL.id, graphDigest: LOCAL.codeDigest, logicDigest: LOCAL.codeDigest, params: { attenLimitDb: 12 }, range: { firstSample: 0, samples: 48_000 }, source: { assetId: 'ast_x' }, apply: 'library' });
      await settle(s.store, job.id);
      expect(s.local!.calls).toContain(`drive ${job.id}`);
      const listed = (await s.caps.list()).capabilities.find((c) => c.id === LOCAL.id)!;
      expect(listed).toMatchObject({ provider: 'local', task: 'voice-clean', setup: { code: 'ready' }, runnable: true });
      // cancel and recover of open local jobs go to the runner
      const open = s.store.createJob(s.pid, 'capability', 'user:owner', { provider: 'local', capabilityId: LOCAL.id });
      expect(await s.caps.cancel(open.id, 'user:owner')).toEqual({ jobId: open.id, status: 'canceled', outcome: 'killed' });
      await s.caps.recover();
      expect(s.local!.calls).toContain(`recover ${open.id}`);
    } finally { await s.caps.stop(); s.store.close(); }
  });
  it('without a runner a local tool is engine_not_configured, listed as not runnable, and refused with 503', async () => {
    const s = await setup({ registry: [LOCAL] });
    try {
      const listed = (await s.caps.list()).capabilities.find((c) => c.id === LOCAL.id)!;
      expect(listed).toMatchObject({ setup: { code: 'engine_not_configured' }, runnable: false });
      expect(await refused(() => s.caps.start({ projectId: s.pid, capabilityId: LOCAL.id, params: {}, actor: 'user:owner', source: { assetId: 'ast_x' } }))).toBe('503:engine_not_configured');
    } finally { await s.caps.stop(); s.store.close(); }
  });
});
