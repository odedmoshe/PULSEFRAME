/**
 * Frame jobs (ADR-0017, route R2) driven end to end against a LABELLED MOCK ComfyUI adapter (MockComfy below): no ComfyUI runs and no
 * model is loaded. The mock "executes" a staged chunk with ffmpeg (ImageInvert → negate; FrameInterpolate → each source frame repeated
 * m−1 times, which has the right counts but is not interpolation) and serves the frames as PNGs, like PreviewImage. Everything else is the
 * product's own code: extraction, chunk records, the lane, assembly, validation, import and placement through Store.commit.
 * The proof (packages/evals/src/ai-frames-proof.ts) runs the same path against a real ComfyUI.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { canonical, findClip, type MediaClip } from '@pulseframe/core';
import { ComfyDescriptorSchema, graphDigest, VIDEO_SMOOTH_SLOWMO, type CollectedOutput, type ComfyDescriptor, type ComfyGraph, type ProviderAdapter, type RemoteState } from '@pulseframe/providers';
import { Capabilities } from './capabilities.ts';
import { loadConfig } from './config.ts';
import { mayInterrupt, validateFrameOutput } from './framejobs.ts';
import { ingestUpload } from './ingest.ts';
import { FifoComputeLane } from './lane.ts';
import { Store } from './store.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-framejobs-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args]);
const R = { num: 30000, den: 1001 };
const FRAMES = 20;

/** Test-only descriptor (labelled, never in BUILTIN): ImageInvert per frame, in chunks of 8. */
const invertGraph: ComfyGraph = {
  '1': { class_type: 'LoadVideo', inputs: { file: 'pulseframe_input.mkv' } },
  '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
  '3': { class_type: 'ImageInvert', inputs: { image: ['2', 0] } },
  '4': { class_type: 'PreviewImage', inputs: { images: ['3', 0] } },
};
const pass = { status: 'pass' as const, evidence: 'test fixture' };
const INVERT: ComfyDescriptor = ComfyDescriptorSchema.parse({
  id: 'test.frames.invert', version: '0.0.1', provider: 'comfyui', state: 'published',
  title: { he: 'בדיקה: היפוך צבעים לכל פריים', en: 'Test only: invert every frame' }, description: { he: 'מתאר לבדיקות בלבד', en: 'Test-only descriptor' },
  source: { repository: null, commit: null, notices: 'test fixture' }, graph: invertGraph, graphDigest: graphDigest(invertGraph),
  inputs: [{ name: 'video', label: { he: 'וידאו', en: 'Video' }, type: 'video', binding: { nodeId: '1', input: 'file' }, required: true, reviewed: true }],
  outputs: [{ name: 'video', role: 'primary', mediaType: 'video', nodeId: '4', encoding: 'display', reviewed: true, expectSize: { sameAsInput: 'video' }, expectFrames: 'same' }],
  requiredNodes: ['LoadVideo', 'GetVideoComponents', 'ImageInvert', 'PreviewImage'].map((classType) => ({ classType, pack: 'core', packVersion: null })),
  models: [], runtime: { comfyuiCommit: null, imageDigest: null }, limits: { maxFrames: 300, maxPixels: 1280 * 720 },
  resources: { downloadBytes: 0, estimatedResidencyBytes: 0, hostRamBytes: null, measuredProfiles: [] },
  frames: { input: 'video', mode: 'per-frame', chunkFrames: 8, maxOutputRate: 120 },
  egress: 'none', languages: [], limitations: ['test only'],
  qualification: { schemaValid: pass, dependencyReady: pass, licenseReviewed: pass, executed: pass, qualityReviewed: pass, hebrewQualified: { status: 'not_applicable' }, hardwareQualified: pass },
});
/** The reviewed slow-motion descriptor with test-only small chunks and no model file (the mock needs none). Same graph and digest. */
const SLOWMO: ComfyDescriptor = { ...VIDEO_SMOOTH_SLOWMO, models: [], resources: { ...VIDEO_SMOOTH_SLOWMO.resources, downloadBytes: 0 }, frames: { ...VIDEO_SMOOTH_SLOWMO.frames!, chunkFrames: 8 } };
const REGISTRY = [INVERT, SLOWMO];

interface Prompt { id: string; requestId: string; graph: any; state: 'queued' | 'running' | 'succeeded' | 'failed'; k: number }
/** LABELLED MOCK of ComfyUI (see the file header). Knobs: hold chunk k running, forget prompts (provider restart), faults. */
class MockComfy implements ProviderAdapter {
  readonly id = 'mock-comfyui (test double)';
  prompts = new Map<string, Prompt>();
  submissions: string[] = [];
  cancels: string[] = [];
  hold = new Set<number>();
  foreignRunning = false;
  extraFrame = false;
  wrongSize = false;
  constructor(public inputDir: string) { fs.mkdirSync(inputDir, { recursive: true }); }
  private seq = 0;
  probe = async () => ({ reachable: true, wokeWorker: false as const, runtimeVersion: 'mock', device: { name: 'mock-cpu', type: 'cpu', vramTotalBytes: null }, hostRamBytes: null, missingNodeClasses: [], missingModels: [], problems: [] });
  estimate = () => ({ downloadBytes: 0, durationSeconds: null, costUsd: null, basis: 'none' as const });
  async stage(local: string, name: string) { fs.copyFileSync(local, path.join(this.inputDir, name)); return name; }
  async submit(graph: Record<string, unknown>, requestId: string) {
    const k = Number(/:(\d+)(?::r\d+)?$/.exec(requestId)![1]);
    const id = `mock_${++this.seq}`;
    this.prompts.set(id, { id, requestId, graph, state: this.hold.has(k) ? 'running' : 'succeeded', k });
    this.submissions.push(requestId);
    return { providerJobId: id, clientRequestId: requestId };
  }
  async status(id: string): Promise<RemoteState> {
    const p = this.prompts.get(id);
    if (!p) return { state: 'unknown' };
    return p.state === 'failed' ? { state: 'failed', message: 'interrupted' } : p.state === 'queued' ? { state: 'queued', position: 0 } : { state: p.state };
  }
  async findByClientRequestId(r: string) { for (const p of this.prompts.values()) if (p.requestId === r) return p.id; return null; }
  async cancel(id: string) { this.cancels.push(id); const p = this.prompts.get(id); if (p) p.state = 'failed'; return 'interrupt-requested' as const; }
  async running() {
    const ours = [...this.prompts.values()].filter((p) => p.state === 'running').map((p) => ({ promptId: p.id, clientRequestId: p.requestId }));
    return this.foreignRunning ? [...ours, { promptId: 'someone_else', clientRequestId: null }] : ours;
  }
  release(k: number) { for (const p of this.prompts.values()) if (p.k === k && p.state === 'running') p.state = 'succeeded'; this.hold.delete(k); }
  forget() { this.prompts.clear(); }
  async collect(_d: ComfyDescriptor, id: string, destDir: string): Promise<CollectedOutput[]> {
    const p = this.prompts.get(id)!;
    const nodes = Object.values(p.graph) as { class_type: string; inputs: any }[];
    const file = path.join(this.inputDir, nodes.find((n) => n.class_type === 'LoadVideo')!.inputs.file);
    const tmp = path.join(destDir, 'decoded');
    fs.mkdirSync(tmp, { recursive: true });
    const vf = [...(nodes.some((n) => n.class_type === 'ImageInvert') ? ['negate'] : []), ...(this.wrongSize ? ['scale=iw+2:ih'] : []), 'format=rgb24'].join(',');
    ff(['-i', file, '-vf', vf, '-fps_mode', 'passthrough', path.join(tmp, '%06d.png')]);
    const decoded = fs.readdirSync(tmp).sort().map((f) => path.join(tmp, f));
    const m = Number(nodes.find((n) => n.class_type === 'FrameInterpolate')?.inputs.multiplier ?? 1);
    const order: string[] = [];
    decoded.forEach((f, i) => { order.push(f); if (i < decoded.length - 1) for (let j = 1; j < m; j++) order.push(f); }); // NOT interpolation: counts only
    if (this.extraFrame) order.push(decoded.at(-1)!);
    return order.map((f, i) => {
      const out = path.join(destDir, `out_${String(i).padStart(6, '0')}_ComfyUI_temp_${i}.png`);
      fs.copyFileSync(f, out);
      const bytes = fs.readFileSync(out);
      return { name: 'video', role: 'primary', mediaType: 'video', encoding: 'display', fileName: `ComfyUI_temp_${i}.png`, path: out, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
  }
}

let sourceFile = '';
beforeAll(() => {
  sourceFile = path.join(root, 'source.mp4');
  const seconds = (FRAMES * R.den) / R.num;
  ff(['-f', 'lavfi', '-i', `testsrc2=s=64x36:r=${R.num}/${R.den}`, '-f', 'lavfi', '-i', `sine=f=440:r=48000:d=${seconds}`, '-frames:v', String(FRAMES), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bf', '0', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', sourceFile]);
}, 60_000);

let envN = 0;
async function setup(opts: { lane?: FifoComputeLane } = {}) {
  const dir = path.join(root, `env${envN++}`);
  const mock = new MockComfy(path.join(dir, 'comfy-input'));
  const cfg = { ...loadConfig({}), dataDir: path.join(dir, 'data') };
  const store = new Store(cfg.dataDir);
  const mk = (s: Store) => new Capabilities(s, cfg, mock, { registry: () => REGISTRY, lane: opts.lane ?? null, pollMs: 10, providerInputDir: mock.inputDir, freeBytes: () => 1e12 });
  const caps = mk(store);
  const pid = store.createProject({ name: 'frames', width: 64, height: 36, frameRate: R }).doc.id;
  const asset = await ingestUpload(store, Readable.toWeb(fs.createReadStream(sourceFile)) as any, 'source.mp4', 'user:owner', 1 << 26);
  const assetId = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
  const placed = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId, start: T.ZERO } }] });
  return { dir, mock, cfg, store, caps, pid, assetId, clipId: placed.results[0]!.output!.clipId as string, audioClipId: placed.results[0]!.output!.audioClipId as string, mk };
}
const settle = async (store: Store, jobId: string, until = ['succeeded', 'failed', 'canceled'], ms = 60_000) => {
  const t0 = Date.now();
  for (;;) {
    const j = store.getJob(jobId);
    if (until.includes(j.status)) return j;
    if (Date.now() - t0 > ms) throw new Error(`job ${jobId} stuck in ${j.status} (${j.stage})`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const until = async (cond: () => boolean, ms = 30_000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('condition not reached'); await new Promise((r) => setTimeout(r, 15)); } };
const decodeRaw = (file: string, vf = 'format=rgb24') => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-vf', vf, '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 28 });

describe('frame driver: a per-frame job end to end (mock provider)', () => {
  it('3 chunks of 8/8/4 frames: exact count and rate, sound copied back, derived provenance, replace-clip and exact undo, scratch deleted', async () => {
    const lane = new FifoComputeLane();
    const holders: string[] = [];
    lane.onBeforeHeavy((label) => { holders.push(label); });
    const s = await setup({ lane });
    try {
      const before = canonical(s.store.getProject(s.pid).doc);
      const job = s.caps.start({ projectId: s.pid, capabilityId: INVERT.id, params: {}, actor: 'user:owner', source: { clipId: s.clipId }, apply: 'replace-clip' });
      expect(job.input.frames).toMatchObject({ mode: 'per-frame', firstFrame: 0, frameCount: FRAMES, expectedOutputFrames: FRAMES, rate: R, outputRate: R });
      expect(job.input.frames.chunks.map((c: any) => c.count)).toEqual([8, 8, 4]);
      const done = await settle(s.store, job.id);
      expect(done.status, JSON.stringify(done.error)).toBe('succeeded');
      expect(s.mock.submissions).toEqual([0, 1, 2].map((k) => `${job.input.clientRequestId}:${k}`));
      expect(holders.filter((h) => h.includes(job.id))).toHaveLength(3); // the lane was taken once per chunk
      expect(done.output.frames.chunks.map((c: any) => c.frames)).toEqual([8, 8, 4]);
      expect(done.output.progress).toEqual({ unit: 'frames', done: FRAMES, total: FRAMES, basis: 'measured' });
      expect(done.output.attachment).toMatchObject({ status: 'attached', mode: 'replace-clip', clipId: s.clipId });
      const doc = s.store.getProject(s.pid).doc;
      const asset = doc.assets[done.output.attachment.assetId]!;
      expect(asset.video).toMatchObject({ width: 64, height: 36, frameRate: R, frameCount: FRAMES });
      expect(asset.audio).toMatchObject({ sampleRate: 48000 });
      expect(asset.provenance.derived).toMatchObject({ capabilityId: INVERT.id, sourceAssetIds: [s.assetId], audio: 'source-copied', logicDigest: INVERT.graphDigest, frames: { sourceStartFrame: 0, sourceFrameCount: FRAMES, sourceRate: R, outputRate: R, mapping: 'identity', heldFrames: [] } });
      expect(T.eq(asset.provenance.derived!.sourceRangeStart!, T.ZERO)).toBe(true);
      // the clip now shows the derived copy; its linked sound keeps the original file
      expect((findClip(doc, s.clipId)!.clip as MediaClip).assetId).toBe(asset.id);
      expect((findClip(doc, s.audioClipId)!.clip as MediaClip).assetId).toBe(s.assetId);
      // the picture is the inverted source, frame for frame: far closer to it than to the source itself (both went through H.264 and
      // 4:2:0 twice on a 64x36 test pattern, so they are not equal). The source is untagged and read as BT.709, as the editor reads it.
      const raw = (f: string, extra = '') => decodeRaw(f, `scale=in_color_matrix=bt709,format=rgb24${extra}`);
      const result = raw(s.store.blobPath(asset.contentHash));
      const mad = (x: Buffer) => { let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i]! - result[i]!); return d / x.length; };
      const inverted = raw(sourceFile, ',negate'), original = raw(sourceFile);
      expect(result.length).toBe(inverted.length);
      expect(mad(inverted)).toBeLessThan(10);
      expect(mad(original)).toBeGreaterThan(10 * mad(inverted));
      // scratch and staged chunks are gone
      expect(fs.existsSync(path.join(s.store.tmpDir, `frames_${job.id}`))).toBe(false);
      expect(fs.readdirSync(s.mock.inputDir).filter((f) => f.includes(job.id))).toEqual([]);
      // undo of the placement restores the clip exactly; the asset import stays (as for every provider result)
      s.store.undo(s.pid, 'user:owner', 'undo');
      const back = s.store.getProject(s.pid).doc;
      expect((findClip(back, s.clipId)!.clip as MediaClip).assetId).toBe(s.assetId);
      const { [asset.id]: _imported, ...assets } = back.assets;
      expect(canonical({ ...back, assets })).toBe(before);
      // undoing the import as well returns the document to exactly what it was
      s.store.undo(s.pid, 'user:owner', 'undo');
      expect(canonical(s.store.getProject(s.pid).doc)).toBe(before);
    } finally { await s.caps.stop(); s.store.close(); }
  }, 120_000);

  it('pairwise slow motion ×2: N·m frames at r·m, trailing hold, placed with set_clip_speed(1/m) so the clip is exactly m times longer', async () => {
    const s = await setup();
    try {
      const clipBefore = findClip(s.store.getProject(s.pid).doc, s.clipId)!.clip as MediaClip;
      const job = s.caps.start({ projectId: s.pid, capabilityId: SLOWMO.id, params: { multiplier: 2 }, actor: 'user:owner', source: { clipId: s.clipId }, apply: 'replace-clip' });
      expect(job.input.frames).toMatchObject({ mode: 'pairwise', multiplier: 2, expectedOutputFrames: 2 * FRAMES, outputRate: { num: 60000, den: 1001 }, heldFrames: [2 * FRAMES - 1] });
      expect(job.input.frames.chunks.map((c: any) => [c.first, c.count, c.overlapIn])).toEqual([[0, 8, 0], [7, 8, 1], [14, 6, 1]]);
      const done = await settle(s.store, job.id);
      expect(done.status, JSON.stringify(done.error)).toBe('succeeded');
      const doc = s.store.getProject(s.pid).doc;
      const asset = doc.assets[done.output.attachment.assetId]!;
      expect(asset.video).toMatchObject({ frameRate: { num: 60000, den: 1001 }, frameCount: 2 * FRAMES });
      expect(asset.provenance.derived!.frames).toMatchObject({ mapping: 'interpolated', multiplier: 2, heldFrames: [2 * FRAMES - 1] });
      const clip = findClip(doc, s.clipId)!.clip as MediaClip;
      expect(clip.assetId).toBe(asset.id);
      expect(clip.speed).toEqual({ num: 1, den: 2 });
      expect(T.eq(clip.duration, T.add(clipBefore.duration, clipBefore.duration))).toBe(true);
      expect(done.output.attachment).toMatchObject({ status: 'attached', mode: 'replace-clip', speed: 0.5 });
    } finally { await s.caps.stop(); s.store.close(); }
  }, 120_000);
});

describe('frame driver: restart, cancel and the interrupt rule', () => {
  it('after a simulated restart it re-verifies the recorded chunk digests and resumes at chunk 2 (resubmitted as :r2, recorded)', async () => {
    const s = await setup();
    s.mock.hold.add(1);
    const job = s.caps.start({ projectId: s.pid, capabilityId: INVERT.id, params: {}, actor: 'user:owner', source: { assetId: s.assetId } });
    const base = job.input.clientRequestId as string;
    await until(() => s.store.getJob(job.id).output?.frames?.current?.k === 1 && !!s.store.getJob(job.id).output.frames.current.providerJobId);
    await s.caps.stop(); // the server stops while chunk 2 runs at the provider
    const mid = s.store.getJob(job.id);
    expect(mid.status).toBe('running');
    expect(mid.output.frames.chunks.map((c: any) => c.k)).toEqual([0]);
    s.store.close();
    // restart: a new store and service on the same data; the provider restarted too and lost the running prompt
    s.mock.forget();
    s.mock.hold.clear();
    s.mock.submissions.length = 0;
    const store = new Store(s.cfg.dataDir);
    const caps = s.mk(store);
    try {
      await caps.recover();
      const done = await settle(store, job.id);
      expect(done.status, JSON.stringify(done.error)).toBe('succeeded');
      expect(s.mock.submissions).toEqual([`${base}:1:r2`, `${base}:2`]); // chunk 1 was not redone
      expect(done.output.frames.reverified).toMatchObject({ checked: 1, kept: 1 });
      expect(done.output.frames.resubmitted).toEqual([expect.objectContaining({ k: 1, from: `${base}:1`, requestId: `${base}:1:r2` })]);
      expect(done.output.frames.chunks.map((c: any) => [c.k, c.requestId])).toEqual([[0, `${base}:0`], [1, `${base}:1:r2`], [2, `${base}:2`]]);
      expect(store.getProject(s.pid).doc.assets[done.output.attachment.assetId]!.video!.frameCount).toBe(FRAMES);
    } finally { await caps.stop(); store.close(); }
  }, 120_000);

  it('a recorded chunk whose frames changed on disk is redone; a prompt the provider still has is reconciled by its request id, not resubmitted', async () => {
    const s = await setup();
    s.mock.hold.add(1);
    const job = s.caps.start({ projectId: s.pid, capabilityId: INVERT.id, params: {}, actor: 'user:owner', source: { assetId: s.assetId } });
    const base = job.input.clientRequestId as string;
    await until(() => s.store.getJob(job.id).output?.frames?.current?.k === 1 && !!s.store.getJob(job.id).output.frames.current.providerJobId);
    await s.caps.stop();
    fs.appendFileSync(path.join(s.store.tmpDir, `frames_${job.id}`, 'frames', '0', '000003.png'), 'tampered');
    s.mock.release(1); // the provider kept running and finished chunk 2 meanwhile
    s.mock.submissions.length = 0;
    const caps = s.mk(s.store);
    try {
      await caps.recover();
      const done = await settle(s.store, job.id);
      expect(done.status, JSON.stringify(done.error)).toBe('succeeded');
      expect(done.output.frames.reverified).toMatchObject({ checked: 1, kept: 0 });
      // chunk 1 is redone; the in-flight chunk 2 was no longer "current" once chunk 1 was dropped, so it is submitted afresh
      expect(s.mock.submissions[0]).toBe(`${base}:0`);
    } finally { await caps.stop(); s.store.close(); }
  }, 120_000);

  it('cancel between chunks: the running chunk is interrupted (every running prompt is ours), nothing is attached, scratch is emptied', async () => {
    const s = await setup();
    s.mock.hold.add(1);
    const job = s.caps.start({ projectId: s.pid, capabilityId: INVERT.id, params: {}, actor: 'user:owner', source: { clipId: s.clipId }, apply: 'replace-clip' });
    await until(() => s.store.getJob(job.id).output?.frames?.chunks?.length === 1 && !!s.store.getJob(job.id).output.frames.current?.providerJobId);
    const assetsBefore = Object.keys(s.store.getProject(s.pid).doc.assets);
    try {
      const r = await s.caps.cancel(job.id, 'user:owner');
      expect(r.outcome).toBe('interrupt-requested');
      expect(s.mock.cancels).toHaveLength(1);
      const done = await settle(s.store, job.id);
      expect(done.status).toBe('canceled');
      expect(done.output.attachment).toMatchObject({ status: 'not-attached' });
      expect(Object.keys(s.store.getProject(s.pid).doc.assets)).toEqual(assetsBefore);
      expect((findClip(s.store.getProject(s.pid).doc, s.clipId)!.clip as MediaClip).assetId).toBe(s.assetId);
      expect(fs.existsSync(path.join(s.store.tmpDir, `frames_${job.id}`))).toBe(false);
      expect(fs.readdirSync(s.mock.inputDir).filter((f) => f.includes(job.id))).toEqual([]);
      expect(s.mock.submissions).toHaveLength(2); // chunk 3 was never dispatched
    } finally { await s.caps.stop(); s.store.close(); }
  }, 120_000);

  it('interrupt is sent only when every running prompt is the job\'s own; otherwise the chunk finishes and is discarded', async () => {
    expect(mayInterrupt([{ clientRequestId: 'b:1' }], 'b')).toBe(true);
    expect(mayInterrupt([{ clientRequestId: 'b:1' }, { clientRequestId: 'b:2:r2' }], 'b')).toBe(true);
    expect(mayInterrupt([{ clientRequestId: 'b:1' }, { clientRequestId: null }], 'b')).toBe(false);
    expect(mayInterrupt([{ clientRequestId: 'bb:1' }], 'b')).toBe(false);
    expect(mayInterrupt([], 'b')).toBe(false);
    const s = await setup();
    s.mock.hold.add(0);
    s.mock.foreignRunning = true;
    const job = s.caps.start({ projectId: s.pid, capabilityId: INVERT.id, params: {}, actor: 'user:owner', source: { assetId: s.assetId } });
    await until(() => !!s.store.getJob(job.id).output?.frames?.current?.providerJobId);
    try {
      const r = await s.caps.cancel(job.id, 'user:owner');
      expect(r.outcome).toMatch(/not-interrupted/);
      expect(s.mock.cancels).toEqual([]);
      expect(s.store.getJob(job.id).status).toBe('cancel-requested');
      s.mock.release(0);
      const done = await settle(s.store, job.id);
      expect(done.status).toBe('canceled');
      expect(s.mock.submissions).toHaveLength(1);
      expect(Object.values(s.store.getProject(s.pid).doc.assets).filter((a) => a.provenance.origin === 'derived')).toEqual([]);
    } finally { await s.caps.stop(); s.store.close(); }
  }, 120_000);

  it('an active server export pauses chunk dispatch until it ends', async () => {
    const lane = new FifoComputeLane();
    const s = await setup({ lane });
    try {
      lane.setExportActive(true);
      const job = s.caps.start({ projectId: s.pid, capabilityId: INVERT.id, params: {}, actor: 'user:owner', source: { assetId: s.assetId } });
      await until(() => /an export is running/.test(s.store.getJob(job.id).stage ?? ''));
      await new Promise((r) => setTimeout(r, 150));
      expect(s.mock.submissions).toEqual([]);
      lane.setExportActive(false);
      expect((await settle(s.store, job.id)).status).toBe('succeeded');
      expect(s.mock.submissions).toHaveLength(3);
    } finally { await s.caps.stop(); s.store.close(); }
  }, 120_000);
});

describe('frame driver: results that fail validation are never imported', () => {
  it('a frame-count mismatch from the provider gives output_invalid', async () => {
    const s = await setup();
    s.mock.extraFrame = true;
    try {
      const job = s.caps.start({ projectId: s.pid, capabilityId: INVERT.id, params: {}, actor: 'user:owner', source: { assetId: s.assetId } });
      const done = await settle(s.store, job.id);
      expect(done.status).toBe('failed');
      expect(done.error.code).toBe('output_invalid');
      expect(done.error.message).toMatch(/returned 9 frames, expected exactly 8/);
      expect(fs.existsSync(path.join(s.store.tmpDir, `frames_${job.id}`))).toBe(false);
    } finally { await s.caps.stop(); s.store.close(); }
  }, 120_000);
  it('frames of the wrong size give output_invalid', async () => {
    const s = await setup();
    s.mock.wrongSize = true;
    try {
      const job = s.caps.start({ projectId: s.pid, capabilityId: INVERT.id, params: {}, actor: 'user:owner', source: { assetId: s.assetId } });
      const done = await settle(s.store, job.id);
      expect(done.status).toBe('failed');
      expect(done.error.code).toBe('output_invalid');
      expect(done.error.message).toMatch(/is 66x36, expected 64x36/);
      expect(Object.values(s.store.getProject(s.pid).doc.assets).filter((a) => a.provenance.origin === 'derived')).toEqual([]);
    } finally { await s.caps.stop(); s.store.close(); }
  }, 120_000);
});

describe('validateFrameOutput (files made with ffmpeg)', () => {
  const make = (name: string, args: string[]) => { const f = path.join(root, name); ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30000/1001', '-frames:v', '12', ...args, f]); return f; };
  const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => e.code as string);
  const want = { frames: 12, rate: { num: 30000, den: 1001 }, width: 64, height: 36, audio: false };
  it('the exact file passes; 30/1 delivered for 30000/1001 is output_invalid; so are a wrong size, count or sound', async () => {
    const ok = make('ok.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
    expect(await code(validateFrameOutput(ok, want))).toBe('ok');
    const thirty = path.join(root, 'thirty.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30', '-frames:v', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', thirty]);
    expect(await code(validateFrameOutput(thirty, want))).toBe('output_invalid');
    expect(await code(validateFrameOutput(ok, { ...want, width: 128, height: 72 }))).toBe('output_invalid');
    expect(await code(validateFrameOutput(ok, { ...want, frames: 13 }))).toBe('output_invalid');
    expect(await code(validateFrameOutput(ok, { ...want, audio: true }))).toBe('output_invalid');
  });
  it('a 4:4:4 or a variable-rate result is output_not_editable', async () => {
    const yuv444 = make('yuv444.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv444p']);
    expect(await code(validateFrameOutput(yuv444, want))).toBe('output_not_editable');
    // variable rate: frame timestamps with uneven gaps
    const vfr = path.join(root, 'vfr.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30', '-frames:v', '12', '-vf', "setpts='if(lt(N,6),N,N*2)/30/TB'", '-fps_mode', 'passthrough', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vfr]);
    expect(await code(validateFrameOutput(vfr, { ...want, rate: { num: 30, den: 1 } }))).toBe('output_not_editable');
  });
});
