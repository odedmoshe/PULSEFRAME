/**
 * Local tools runner (ADR-0017, route R3) with LABELLED FAKES only: testdata/localtools/fake_pf_tools.py stands in for the tools worker
 * (no torch, no model; it returns marked placeholder text) and testdata/localtools/fake_deep_filter.py for the deep-filter binary (it
 * removes no noise). Descriptors marked TEST COPY are the real ones with test model files or the fake's digest put in; the real
 * engines and models are only run by the lead's proof (pnpm proof:ai-local). ffmpeg is real.
 * The ComputeLane here is an in-test double, because lane.ts lands with the frame-job work in another worktree.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256Hex, type Asset } from '@pulseframe/core';
import { LOCAL_TOOLS, type CapabilityModel, type LocalToolDescriptor } from '@pulseframe/providers';
import * as T from '@pulseframe/time';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ComputeLane, RunRequest } from './aiContracts.ts';
import { loadConfig, type Config } from './config.ts';
import { describeMedia } from './ingest.ts';
import { estimateLag, installedCodeDigest, LocalTools, readWavFrames, readWavInfo, SAMPLE_RATE } from './localtools.ts';
import { ApiError, Store, type JobRow } from './store.ts';

const HERE = import.meta.dirname;
const FAKE_TOOLS = path.join(HERE, 'testdata/localtools/fake_pf_tools.py');
const FAKE_DF = path.join(HERE, 'testdata/localtools/fake_deep_filter.py');
const PYTHON = execFileSync('python3', ['-c', 'import sys; print(sys.executable)']).toString().trim();
const PLATFORM = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}` as 'linux-x64';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const tool = (id: string) => LOCAL_TOOLS.find((d) => d.id === id)!;
const TRANSLATE_HE_EN = tool('local.text.translate-he-en'), VOICE_CLEAN = tool('local.voice.clean'), VOCALS_CLASSIC = tool('local.audio.vocals-classic');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const FAKE_ENV = ['PF_FAKE_TOOLS_MODE', 'PF_FAKE_TOOLS_PIDFILE', 'PF_FAKE_DF_MODE', 'PF_FAKE_DF_PIDFILE', 'PF_FAKE_DF_ARGSFILE'];
afterEach(() => { for (const k of FAKE_ENV) delete process.env[k]; });

/** IN-TEST DOUBLE of ComputeLane (labelled): one holder at a time, FIFO, abortable waits. Not the product's lane.ts. */
class TestLane implements ComputeLane {
  private holder: string | null = null;
  private queue: { label: string; grant: () => void; signal?: AbortSignal }[] = [];
  private hooks: (() => Promise<void> | void)[] = [];
  private exporting = false;
  acquire(label: string, signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const entry = { label, signal, grant: () => { this.holder = label; resolve(() => this.release()); } };
      if (signal?.aborted) return reject(new Error('aborted'));
      signal?.addEventListener('abort', () => { const i = this.queue.indexOf(entry); if (i >= 0) { this.queue.splice(i, 1); reject(new Error('aborted')); } });
      this.queue.push(entry);
      this.pump();
    });
  }
  private release() { this.holder = null; this.pump(); }
  private pump() {
    if (this.holder || !this.queue.length) return;
    const next = this.queue.shift()!;
    this.holder = next.label; // held while the hooks run
    void Promise.all(this.hooks.map((h) => h())).then(() => next.grant());
  }
  onBeforeHeavy(fn: () => Promise<void> | void) { this.hooks.push(fn); }
  busy() { return { holder: this.holder, waiting: this.queue.length }; }
  setExportActive(a: boolean) { this.exporting = a; }
  exportActive() { return this.exporting; }
}

/** 16-bit PCM WAV from per-channel float samples. */
function writeWav(file: string, channels: Float32Array[], rate = SAMPLE_RATE) {
  const n = channels[0]!.length, ch = channels.length;
  const b = Buffer.alloc(44 + n * ch * 2);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + n * ch * 2, 4); b.write('WAVE', 8, 'latin1'); b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(n * ch * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(channels[c]![i]! * 32767))), 44 + (i * ch + c) * 2);
  fs.writeFileSync(file, b);
}
/** Deterministic noise bursts (speech-like on/off envelope), so a correlation has one clear peak. */
function bursts(n: number, seed: number, amp = 0.3) {
  let s = seed >>> 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const env = Math.sin((Math.PI * i) / (SAMPLE_RATE * 0.37)) ** 2;
    out[i] = (s / 2 ** 32 - 0.5) * 2 * amp * env;
  }
  return out;
}

interface Fx { dir: string; store: Store; pid: string; cfg: Config; tools: LocalTools; lane: TestLane | null }
function fixture(over: Partial<Config> = {}, lane = false, worker = FAKE_TOOLS): Fx {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-localtools-'));
  dirs.push(dir);
  const store = new Store(path.join(dir, 'data'));
  const cfg: Config = { ...loadConfig({}), dataDir: path.join(dir, 'data'), toolsPython: PYTHON, toolsModelsDir: path.join(dir, 'tool-models'), toolsKeepSeconds: 0, denoiseBin: FAKE_DF, ...over };
  const l = lane ? new TestLane() : null;
  const tools = new LocalTools(store, cfg, l, { worker });
  const pid = store.createProject({ name: 'local tools' }).doc.id;
  return { dir, store, pid, cfg, tools, lane: l };
}
async function importWav(fx: Fx, file: string, name = path.basename(file)): Promise<string> {
  const bytes = fs.readFileSync(file);
  const contentHash = `sha256:${sha(bytes)}`;
  const meta = await describeMedia(file);
  const tmp = path.join(fx.store.tmpDir, `in_${sha(bytes).slice(0, 8)}`);
  fs.copyFileSync(file, tmp);
  fx.store.putBlob(contentHash, tmp, bytes.length, meta.mimeType);
  const asset: Omit<Asset, 'id'> = { ...meta, name, contentHash, byteSize: bytes.length, provenance: { origin: 'upload', importedAt: new Date().toISOString(), importedBy: 'user:owner' } };
  const c = fx.store.commit({ projectId: fx.pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
  return c.results[0]!.output!.assetId as string;
}
/** Place an audio asset on A1 and return the clip id. */
function place(fx: Fx, assetId: string, extra: Record<string, unknown> = {}): string {
  const c = fx.store.commit({ projectId: fx.pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId, start: T.ZERO, trackId: 'trk_audio', ...extra } }] });
  return (c.results[0]!.output!.clipId ?? c.results[0]!.output!.audioClipId) as string;
}
/** What Capabilities.start does for provider 'local' (W1): prepare synchronously, then create the job with its additions. */
function start(fx: Fx, d: LocalToolDescriptor, req: Omit<RunRequest, 'projectId' | 'capabilityId' | 'actor'> & { actor?: string }): JobRow {
  const full: RunRequest = { projectId: fx.pid, capabilityId: d.id, actor: 'user:owner', ...req };
  return fx.store.createJob(fx.pid, 'capability', full.actor, { capabilityId: d.id, capabilityVersion: d.version, ...fx.tools.prepare(d, full) });
}
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ApiError) return `${e.status}:${e.code}`; throw e; } return 'ok'; };
const assets = (fx: Fx) => Object.keys(fx.store.getProject(fx.pid).doc.assets).length;

/** TEST COPY (labelled) of a descriptor whose model files are small test files written into the models directory. */
function withTestModels(fx: Fx, d: LocalToolDescriptor, names: string[]): LocalToolDescriptor {
  const models: CapabilityModel[] = names.map((n, i) => {
    const content = Buffer.from(`TEST MODEL FILE ${i} for ${d.id}: not a model`);
    const p = `${path.posix.dirname(d.models[0]!.path)}/${n}`;
    fs.mkdirSync(path.join(fx.cfg.toolsModelsDir, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(fx.cfg.toolsModelsDir, p), content);
    return { ...d.models[0]!, path: p, bytes: content.length, sha256: sha(content) };
  });
  return { ...d, models };
}
/** TEST COPY (labelled) of local.voice.clean that lists the fake binary as its reviewed build and uses a test model file. */
function voiceTestCopy(fx: Fx): LocalToolDescriptor {
  const bin = fs.readFileSync(FAKE_DF);
  const d = withTestModels(fx, VOICE_CLEAN, ['DeepFilterNet3_onnx.tar.gz']);
  return { ...d, engine: { ...d.engine, verifiedBinaries: [{ platform: PLATFORM, version: '0.5.6', bytes: bin.length, sha256: sha(bin), source: 'https://example.invalid/test-fake' }] } };
}
const translateTestCopy = (fx: Fx) => withTestModels(fx, TRANSLATE_HE_EN, ['model.safetensors', 'config.json']);
async function done(fx: Fx, jobId: string, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const j = fx.store.getJob(jobId);
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j;
    if (Date.now() - t0 > ms) throw new Error(`job ${jobId} still ${j.status} (${j.stage})`);
    await sleep(25);
  }
}
async function waitFor(cond: () => boolean, ms = 20_000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await sleep(25); } }

describe('setup states (honest, in the order a person fixes them)', () => {
  it('PF_TOOLS_PYTHON unset gives engine_not_configured, and a run is refused before any job exists', async () => {
    const fx = fixture({ toolsPython: null });
    expect((await fx.tools.setup(TRANSLATE_HE_EN)).code).toBe('engine_not_configured');
    expect(refusal(() => fx.tools.prepare(TRANSLATE_HE_EN, { projectId: fx.pid, capabilityId: TRANSLATE_HE_EN.id, params: {}, actor: 'user:owner', source: { assetId: 'ast_x' } }))).toBe('409:engine_not_configured');
    const unset = fixture({ denoiseBin: null });
    expect((await unset.tools.setup(VOICE_CLEAN)).code).toBe('engine_not_configured');
    fx.store.close(); unset.store.close();
  }, 30_000);
  it('a probe exiting 1 gives engine_not_working with the stderr tail; a probe that names a missing import says which', async () => {
    const fx = fixture();
    process.env.PF_FAKE_TOOLS_MODE = 'probe-exit';
    const s = await fx.tools.setup(TRANSLATE_HE_EN);
    expect(s.code).toBe('engine_not_working');
    expect(s.detail).toMatch(/exit 1/);
    expect(s.detail).toMatch(/No module named 'sentencepiece'/);
    process.env.PF_FAKE_TOOLS_MODE = 'probe-missing';
    const fx2 = fixture();
    const s2 = await fx2.tools.setup(TRANSLATE_HE_EN);
    expect(s2.code).toBe('engine_not_working');
    expect(s2.detail).toMatch(/cannot import sentencepiece/);
    fx.store.close(); fx2.store.close();
  }, 30_000);
  it('a binary whose digest is not a reviewed build gives engine_unverified (the product never trusts an unlisted executable)', async () => {
    const fx = fixture();
    const s = await fx.tools.setup(VOICE_CLEAN); // the real descriptor lists only the publisher's build; the fake is something else
    expect(s.code).toBe('engine_unverified');
    expect(s.detail).toContain(sha(fs.readFileSync(FAKE_DF)));
    fx.store.close();
  }, 30_000);
  it('missing models give model_missing with the exact bytes; an unlisted host and a full disk are named', async () => {
    const fx = fixture();
    const d = voiceTestCopy(fx);
    const real = { ...d, models: VOICE_CLEAN.models }; // TEST COPY: the fake engine is verified, the real model file is absent
    const s = await fx.tools.setup(real);
    expect(s).toMatchObject({ code: 'model_missing', missingBytes: VOICE_CLEAN.models[0]!.bytes });
    const tr = await fx.tools.setup(TRANSLATE_HE_EN);
    expect(tr).toMatchObject({ code: 'model_missing', missingBytes: TRANSLATE_HE_EN.resources.downloadBytes });
    const noHosts = fixture({ modelHosts: ['huggingface.co'] });
    expect(await noHosts.tools.setup({ ...voiceTestCopy(noHosts), models: VOICE_CLEAN.models })).toMatchObject({ code: 'host_not_allowed', hosts: ['raw.githubusercontent.com'] });
    const huge = { ...real, models: [{ ...VOICE_CLEAN.models[0]!, bytes: 2 ** 52 }] }; // TEST COPY: a download no disk holds
    expect((await fx.tools.setup(huge)).code).toBe('disk_insufficient');
    expect((await fx.tools.setup(d)).code).toBe('ready');
    fx.store.close(); noHosts.store.close();
  }, 30_000);
  it('a licence-blocked test copy is refused for run (prepare) and reported licence_blocked (the download rule refuses it too)', async () => {
    const fx = fixture();
    const blocked: LocalToolDescriptor = { ...VOICE_CLEAN, models: [{ ...VOICE_CLEAN.models[0]!, commercialUse: 'unknown' }] }; // TEST COPY
    expect((await fx.tools.setup(blocked)).code).toBe('licence_blocked');
    expect(refusal(() => fx.tools.prepare(blocked, { projectId: fx.pid, capabilityId: blocked.id, params: {}, actor: 'user:owner', source: { assetId: 'ast_x' } }))).toBe('409:capability_blocked');
    fx.store.close();
  }, 30_000);
  it('the installed code digest is the reviewed one; a changed digest blocks the run', () => {
    for (const d of [TRANSLATE_HE_EN, VOICE_CLEAN, VOCALS_CLASSIC]) expect(installedCodeDigest(d)).toBe(d.codeDigest);
    const fx = fixture();
    const changed = { ...VOCALS_CLASSIC, codeDigest: `sha256:${'1'.repeat(64)}` }; // TEST COPY with a digest that is not the installed code's
    expect(refusal(() => fx.tools.prepare(changed, { projectId: fx.pid, capabilityId: changed.id, params: {}, actor: 'user:owner', source: { assetId: 'ast_x' } }))).toBe('409:capability_blocked');
    fx.store.close();
  });
});

describe('translation (fake worker)', () => {
  async function withTranscript(fx: Fx, texts: string[], language = 'he') {
    const f = path.join(fx.dir, 'speech.wav');
    writeWav(f, [bursts(SAMPLE_RATE * 3, 7)]);
    const assetId = await importWav(fx, f);
    const c = fx.store.commit({ projectId: fx.pid, actor: 'user:owner', ops: [{ op: 'set_transcript', args: { assetId, language, segments: texts.map((text, i) => ({ start: T.rt(i * 900, 1000), duration: T.rt(800, 1000), text })) } }] });
    return { assetId, segmentIds: c.results[0]!.output!.segmentIds as string[] };
  }
  it('a 3-phrase transcript becomes a language variant with phraseText for each id, review "needed", master hashes recorded; undo removes it exactly', async () => {
    const fx = fixture();
    const d = translateTestCopy(fx);
    const texts = ['שלום לכולם', 'זה משפט שני', '  משפט שלישי  '];
    const { assetId, segmentIds } = await withTranscript(fx, texts);
    const before = fx.store.getProject(fx.pid).doc;
    const job = start(fx, d, { params: {}, source: { assetId } });
    expect(job.input.local).toMatchObject({ task: 'translate', translate: { from: 'he', to: 'en', source: { kind: 'transcript', assetId }, variantId: null, baseVariantId: null, name: 'English (machine translation)' } });
    await fx.tools.drive(job.id, d);
    const j = fx.store.getJob(job.id);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.output.attachment.status).toBe('attached');
    expect(j.output.progress).toEqual({ unit: 'phrases', done: 3, total: 3, basis: 'measured' });
    const v = fx.store.getProject(fx.pid).doc.variants[j.output.attachment.variantId]!;
    expect(v.language).toBe('en');
    expect(v.translation).toMatchObject({ from: 'he', to: 'en', review: 'needed', createdBy: 'user:owner' });
    expect(Object.keys(v.phraseText!).sort()).toEqual([...segmentIds].sort());
    segmentIds.forEach((id, i) => {
      expect(v.phraseText![id]).toBe(`[FAKE he-en] ${texts[i]!.trim()}`);
      expect(v.translation!.sources[id]).toBe(sha256Hex(texts[i]!));
    });
    fx.store.undo(fx.pid, 'user:owner', 'undo');
    expect(fx.store.getProject(fx.pid).doc).toEqual(before);
    fx.store.close();
  }, 60_000);
  it.each(['missing-id', 'extra-id', 'empty'])('a result with %s fails output_invalid and commits nothing', async (mode) => {
    const fx = fixture();
    const d = translateTestCopy(fx);
    const { assetId } = await withTranscript(fx, ['אחת', 'שתיים', 'שלוש']);
    const rev = fx.store.getProject(fx.pid).revision;
    process.env.PF_FAKE_TOOLS_MODE = mode;
    const job = start(fx, d, { params: {}, source: { assetId } });
    await fx.tools.drive(job.id, d);
    const j = fx.store.getJob(job.id);
    expect(j.status).toBe('failed');
    expect(j.error.code).toBe('output_invalid');
    expect(fx.store.getProject(fx.pid).revision).toBe(rev);
    expect(fx.store.getProject(fx.pid).doc.variants).toEqual({});
    fx.store.close();
  }, 60_000);
  it('refuses before a job exists: no transcript, wrong language, a picture-only apply mode, both sources at once', async () => {
    const fx = fixture();
    const d = translateTestCopy(fx);
    const f = path.join(fx.dir, 'plain.wav');
    writeWav(f, [bursts(SAMPLE_RATE, 3)]);
    const bare = await importWav(fx, f, 'bare.wav');
    const { assetId: english } = await withTranscript(fx, ['hello'], 'en');
    const req = (x: Partial<RunRequest>) => ({ projectId: fx.pid, capabilityId: d.id, params: {}, actor: 'user:owner', ...x });
    expect(refusal(() => fx.tools.prepare(d, req({ source: { assetId: bare } })))).toBe('404:no_transcript');
    expect(refusal(() => fx.tools.prepare(d, req({ source: { assetId: english } })))).toBe('422:language_mismatch');
    expect(refusal(() => fx.tools.prepare(d, req({ source: { assetId: english }, apply: 'replace-clip' })))).toBe('422:apply_not_supported');
    expect(refusal(() => fx.tools.prepare(d, req({ source: { assetId: english }, params: { captionTrackId: 'trk_x' } })))).toBe('422:ambiguous_source');
    expect(refusal(() => fx.tools.prepare(d, req({})))).toBe('422:source_required');
    expect(refusal(() => fx.tools.prepare(d, req({ source: { assetId: english }, params: { model: '/tmp/x' } })))).toBe('422:unknown_parameter');
    fx.store.close();
  }, 60_000);
  it('cues of a manual caption track are translated as cue overrides', async () => {
    const fx = fixture();
    const d = translateTestCopy(fx);
    const tr = fx.store.commit({ projectId: fx.pid, actor: 'user:owner', ops: [{ op: 'add_caption_track', args: { mode: 'manual' } }] });
    const trackId = tr.results[0]!.output!.trackId as string;
    const cue = fx.store.commit({ projectId: fx.pid, actor: 'user:owner', ops: [{ op: 'add_cue', args: { trackId, start: T.ZERO, duration: T.rt(1, 1), text: 'כתובית' } }] });
    const cueId = (cue.results[0]!.output!.clipId ?? cue.results[0]!.output!.cueId) as string;
    const job = start(fx, d, { params: { captionTrackId: trackId } });
    await fx.tools.drive(job.id, d);
    const j = fx.store.getJob(job.id);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    const v = fx.store.getProject(fx.pid).doc.variants[j.output.attachment.variantId]!;
    expect(v.overrides[cueId]?.text).toBe('[FAKE he-en] כתובית');
    expect(v.phraseText).toBeUndefined();
    fx.store.close();
  }, 60_000);
});

describe('voice cleanup (fake deep-filter)', () => {
  async function voiceClip(fx: Fx, extra: Record<string, unknown> = {}) {
    const f = path.join(fx.dir, 'voice.wav');
    writeWav(f, [bursts(SAMPLE_RATE * 2, 11)]);
    const assetId = await importWav(fx, f);
    return { assetId, clipId: place(fx, assetId, extra) };
  }
  it('a pass-through result succeeds: exact length, no lag, padded and trimmed, imported with derived provenance and placed in the clip; undo restores the clip', async () => {
    const fx = fixture();
    const d = voiceTestCopy(fx);
    // a clip whose source start falls between two samples: the range is rounded outward, so the result still covers it
    const { assetId, clipId } = await voiceClip(fx, { sourceIn: T.rt(1, 7), duration: T.rt(1, 1) });
    process.env.PF_FAKE_DF_ARGSFILE = path.join(fx.dir, 'df-args.json');
    const job = start(fx, d, { params: {}, source: { clipId }, apply: 'replace-clip' });
    const s0 = Math.floor(SAMPLE_RATE / 7), s1 = Math.ceil((SAMPLE_RATE * 8) / 7);
    expect(job.input.local.audio).toEqual({ assetId, clipId, startSample: s0, endSample: s1, sampleRate: SAMPLE_RATE, channels: 1 });
    const beforePlace = fx.store.getProject(fx.pid).doc.sequences;
    await fx.tools.drive(job.id, d);
    const j = fx.store.getJob(job.id);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.output.validation).toMatchObject({ samples: s1 - s0, lagSamples: 0, engineSamples: s1 - s0 + SAMPLE_RATE - 1440, trimmedSamples: SAMPLE_RATE - 1440, finite: true });
    expect(j.output.attachment.status).toBe('attached');
    const args = JSON.parse(fs.readFileSync(process.env.PF_FAKE_DF_ARGSFILE, 'utf8')) as string[];
    expect(args.slice(0, 7)).toEqual(['-D', '-m', path.join(fx.cfg.toolsModelsDir, d.models[0]!.path), '--atten-lim-db', '100', '--output-dir', path.join(path.dirname(args[7]!), 'cleaned')]);
    const doc = fx.store.getProject(fx.pid).doc;
    const out = doc.assets[j.output.attachment.assetId]!;
    expect(out.kind).toBe('audio');
    expect(out.duration).toEqual(T.normalize(T.rt(s1 - s0, SAMPLE_RATE)));
    expect(out.provenance.derived).toMatchObject({ jobId: job.id, capabilityId: d.id, sourceAssetIds: [assetId], audio: 'processed', sourceRangeStart: T.normalize(T.rt(s0, SAMPLE_RATE)), graphDigest: d.codeDigest, logicDigest: d.codeDigest, models: [{ path: d.models[0]!.path, sha256: d.models[0]!.sha256 }] });
    const clip = doc.sequences[Object.keys(doc.sequences)[0]!]!.tracks.find((t) => t.id === 'trk_audio')!.clips.find((c) => c.id === clipId)!;
    expect(clip.type === 'media' && clip.assetId).toBe(out.id);
    expect(clip.type === 'media' && T.eq(clip.sourceIn, T.sub(T.rt(1, 7), T.rt(s0, SAMPLE_RATE)))).toBe(true);
    // the stored file is the source range, sample for sample (the fake copies it)
    const src = readWavFrames(path.join(fx.dir, 'voice.wav'), readWavInfo(path.join(fx.dir, 'voice.wav')), s0, s1 - s0)[0]!;
    const blob = fx.store.blobPath(out.contentHash);
    const got = readWavFrames(blob, readWavInfo(blob), 0, s1 - s0)[0]!;
    expect(got.length).toBe(s1 - s0);
    expect(got.every((v, i) => Math.abs(v - src[i]!) < 1e-4)).toBe(true);
    fx.store.undo(fx.pid, 'user:owner', 'undo');
    expect(fx.store.getProject(fx.pid).doc.sequences).toEqual(beforePlace);
    fx.store.close();
  }, 60_000);
  it.each([
    ['shift', /out of step/],
    ['silence', /silent/],
    ['truncate', /too short/],
    ['nan', /not numbers/],
  ])('a %s result fails output_invalid and imports nothing', async (mode, why) => {
    const fx = fixture();
    const d = voiceTestCopy(fx);
    const { clipId } = await voiceClip(fx);
    const n = assets(fx);
    process.env.PF_FAKE_DF_MODE = mode;
    const job = start(fx, d, { params: { attenLimitDb: 12 }, source: { clipId }, apply: 'replace-clip' });
    await fx.tools.drive(job.id, d);
    const j = fx.store.getJob(job.id);
    expect(j.status).toBe('failed');
    expect(j.error.code).toBe('output_invalid');
    expect(j.error.message).toMatch(why);
    expect(assets(fx)).toBe(n);
    fx.store.close();
  }, 60_000);
  it('an engine that exits with an error fails the job with its stderr tail', async () => {
    const fx = fixture();
    const d = voiceTestCopy(fx);
    const { clipId } = await voiceClip(fx);
    process.env.PF_FAKE_DF_MODE = 'fail';
    const job = start(fx, d, { params: {}, source: { clipId } });
    await fx.tools.drive(job.id, d);
    const j = fx.store.getJob(job.id);
    expect(j.status).toBe('failed');
    expect(j.error.code).toBe('engine_failed');
    expect(j.error.details.tail).toMatch(/simulated engine failure/);
    fx.store.close();
  }, 60_000);
  it('replace-clip needs a sound clip; an asset range is library-only and rounded outward on the asset clock', async () => {
    const fx = fixture();
    const d = voiceTestCopy(fx);
    const { assetId } = await voiceClip(fx);
    const req = (x: Partial<RunRequest>) => ({ projectId: fx.pid, capabilityId: d.id, params: {}, actor: 'user:owner', ...x });
    expect(refusal(() => fx.tools.prepare(d, req({ source: { assetId }, apply: 'replace-clip' })))).toBe('422:apply_not_supported');
    expect(refusal(() => fx.tools.prepare(d, req({ source: { assetId }, apply: 'new-track' })))).toBe('422:apply_not_supported');
    expect(refusal(() => fx.tools.prepare(d, req({})))).toBe('422:source_required');
    const out = fx.tools.prepare(d, req({ source: { assetId, range: { firstFrame: 7, frameCount: 11 } } })) as { local: { audio: { startSample: number; endSample: number } } };
    // an audio-only asset is counted in project frames (30 fps here): 7/30 s .. 18/30 s
    expect(out.local.audio).toMatchObject({ startSample: 7 * 1600, endSample: 18 * 1600 });
    expect(refusal(() => fx.tools.prepare(d, req({ source: { assetId, range: { firstFrame: 0, frameCount: 61 } } })))).toBe('422:range_outside_asset');
    fx.store.close();
  }, 60_000);
});

describe('classic vocal removal (ffmpeg)', () => {
  it('refuses a mono recording before a job exists, and an effectively mono stereo recording when it runs', async () => {
    const fx = fixture();
    const monoFile = path.join(fx.dir, 'mono.wav');
    writeWav(monoFile, [bursts(SAMPLE_RATE, 5)]);
    const monoId = await importWav(fx, monoFile);
    expect(refusal(() => fx.tools.prepare(VOCALS_CLASSIC, { projectId: fx.pid, capabilityId: VOCALS_CLASSIC.id, params: {}, actor: 'user:owner', source: { assetId: monoId } }))).toBe('422:mono_source');
    const same = bursts(SAMPLE_RATE, 9);
    const dual = path.join(fx.dir, 'dual-mono.wav');
    writeWav(dual, [same, same]);
    const dualId = await importWav(fx, dual);
    const n = assets(fx);
    const job = start(fx, VOCALS_CLASSIC, { params: {}, source: { assetId: dualId } });
    await fx.tools.drive(job.id, VOCALS_CLASSIC);
    const j = fx.store.getJob(job.id);
    expect(j.status).toBe('failed');
    expect(j.error.code).toBe('mono_like_source');
    expect(assets(fx)).toBe(n);
    fx.store.close();
  }, 60_000);
  it('cancels what is identical in both channels and keeps what is not', async () => {
    const fx = fixture();
    const centre = bursts(SAMPLE_RATE * 2, 21, 0.25), left = bursts(SAMPLE_RATE * 2, 22, 0.25);
    const l = centre.map((v, i) => v + left[i]!);
    const file = path.join(fx.dir, 'mix.wav');
    writeWav(file, [l, centre]);
    const assetId = await importWav(fx, file);
    const clipId = place(fx, assetId);
    const job = start(fx, VOCALS_CLASSIC, { params: {}, source: { clipId }, apply: 'replace-clip' });
    await fx.tools.drive(job.id, VOCALS_CLASSIC);
    const j = fx.store.getJob(job.id);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.output.attachment.status).toBe('attached');
    const out = fx.store.getProject(fx.pid).doc.assets[j.output.attachment.assetId]!;
    expect(out.audio?.channels).toBe(2);
    const blob = fx.store.blobPath(out.contentHash);
    const [ol, or] = readWavFrames(blob, readWavInfo(blob), 0, SAMPLE_RATE * 2);
    // left = (centre + left-only) − centre, as 16-bit samples of the source; right is its negative
    const src = readWavFrames(file, readWavInfo(file), 0, SAMPLE_RATE * 2);
    let worst = 0;
    for (let i = 0; i < ol!.length; i++) worst = Math.max(worst, Math.abs(ol![i]! - (src[0]![i]! - src[1]![i]!)), Math.abs(or![i]! + ol![i]!));
    expect(worst).toBeLessThan(2 / 32768);
    fx.store.close();
  }, 60_000);
});

describe('lifecycle: lane, cancel, kept worker, recovery', () => {
  it('a tool waits while the lane is held, says so, and runs when it is released', async () => {
    const fx = fixture({}, true);
    const file = path.join(fx.dir, 'st.wav');
    writeWav(file, [bursts(SAMPLE_RATE, 31), bursts(SAMPLE_RATE, 32)]);
    const assetId = await importWav(fx, file);
    const release = await fx.lane!.acquire('test holder');
    const job = start(fx, VOCALS_CLASSIC, { params: {}, source: { assetId } });
    const p = fx.tools.drive(job.id, VOCALS_CLASSIC);
    await waitFor(() => fx.store.getJob(job.id).stage === 'queued (waiting for compute: test holder)');
    await sleep(200);
    expect(fx.store.getJob(job.id).status).toBe('queued');
    release();
    await p;
    expect(fx.store.getJob(job.id).status).toBe('succeeded');
    fx.store.close();
  }, 60_000);
  it('cancel while waiting for the lane takes the job out of the queue; nothing runs', async () => {
    const fx = fixture({}, true);
    const file = path.join(fx.dir, 'st.wav');
    writeWav(file, [bursts(SAMPLE_RATE, 41), bursts(SAMPLE_RATE, 42)]);
    const assetId = await importWav(fx, file);
    const release = await fx.lane!.acquire('test holder');
    const job = start(fx, VOCALS_CLASSIC, { params: {}, source: { assetId } });
    const p = fx.tools.drive(job.id, VOCALS_CLASSIC);
    await waitFor(() => fx.lane!.busy().waiting === 1);
    expect(fx.tools.cancel(job.id, 'user:owner')).toMatchObject({ status: 'canceled', outcome: 'removed-from-queue' });
    await p;
    expect(fx.lane!.busy().waiting).toBe(0);
    expect(fx.store.getJob(job.id).status).toBe('canceled');
    release();
    fx.store.close();
  }, 60_000);
  it('cancel kills the running fake engine (SIGKILL) and imports nothing', async () => {
    const fx = fixture();
    const d = voiceTestCopy(fx);
    const file = path.join(fx.dir, 'v.wav');
    writeWav(file, [bursts(SAMPLE_RATE, 51)]);
    const assetId = await importWav(fx, file);
    const n = assets(fx);
    process.env.PF_FAKE_DF_MODE = 'slow';
    process.env.PF_FAKE_DF_PIDFILE = path.join(fx.dir, 'df.pid');
    const job = start(fx, d, { params: {}, source: { assetId } });
    const p = fx.tools.drive(job.id, d);
    await waitFor(() => fs.existsSync(process.env.PF_FAKE_DF_PIDFILE!) && fs.readFileSync(process.env.PF_FAKE_DF_PIDFILE!, 'utf8').length > 0);
    const pid = Number(fs.readFileSync(process.env.PF_FAKE_DF_PIDFILE!, 'utf8'));
    expect(alive(pid)).toBe(true);
    expect(fx.tools.cancel(job.id, 'user:owner')).toMatchObject({ status: 'cancel-requested', outcome: 'stopping' });
    await p;
    expect(fx.store.getJob(job.id).status).toBe('canceled');
    await waitFor(() => !alive(pid), 5000);
    expect(assets(fx)).toBe(n);
    fx.store.close();
  }, 60_000);
  it('cancel kills the translation worker and stores no variant', async () => {
    const fx = fixture();
    const d = translateTestCopy(fx);
    const f = path.join(fx.dir, 's.wav');
    writeWav(f, [bursts(SAMPLE_RATE * 3, 8)]);
    const assetId = await importWav(fx, f);
    fx.store.commit({ projectId: fx.pid, actor: 'user:owner', ops: [{ op: 'set_transcript', args: { assetId, language: 'he', segments: [0, 1, 2, 3].map((i) => ({ start: T.rt(i * 500, 1000), duration: T.rt(400, 1000), text: `משפט ${i}` })) } }] });
    process.env.PF_FAKE_TOOLS_MODE = 'slow';
    process.env.PF_FAKE_TOOLS_PIDFILE = path.join(fx.dir, 'tools.pid');
    const job = start(fx, d, { params: {}, source: { assetId } });
    const p = fx.tools.drive(job.id, d);
    await waitFor(() => fx.store.getJob(job.id).stage?.startsWith('translating: 1 of 4') ?? false);
    const pid = Number(fs.readFileSync(process.env.PF_FAKE_TOOLS_PIDFILE!, 'utf8'));
    fx.tools.cancel(job.id, 'user:owner');
    await p;
    expect(fx.store.getJob(job.id).status).toBe('canceled');
    await waitFor(() => !alive(pid), 5000);
    expect(fx.store.getProject(fx.pid).doc.variants).toEqual({});
    fx.store.close();
  }, 60_000);
  it('a kept worker stays loaded between jobs and releaseKept() stops it', async () => {
    const fx = fixture({ toolsKeepSeconds: 60 });
    const d = translateTestCopy(fx);
    const f = path.join(fx.dir, 's.wav');
    writeWav(f, [bursts(SAMPLE_RATE * 2, 9)]);
    const assetId = await importWav(fx, f);
    fx.store.commit({ projectId: fx.pid, actor: 'user:owner', ops: [{ op: 'set_transcript', args: { assetId, language: 'he', segments: [{ start: T.ZERO, duration: T.rt(1, 1), text: 'שלום' }] } }] });
    process.env.PF_FAKE_TOOLS_PIDFILE = path.join(fx.dir, 'kept.pid');
    for (let i = 0; i < 2; i++) {
      const job = start(fx, d, { params: {}, source: { assetId } });
      await fx.tools.drive(job.id, d);
      expect(fx.store.getJob(job.id).status).toBe('succeeded');
    }
    const pid = Number(fs.readFileSync(process.env.PF_FAKE_TOOLS_PIDFILE!, 'utf8'));
    expect(alive(pid)).toBe(true); // the same process served both jobs and is still there
    await fx.tools.releaseKept();
    await waitFor(() => !alive(pid), 5000);
    fx.store.close();
  }, 60_000);
  it('recover: a job that never started runs; an interrupted one fails retryable and is never imported twice; an imported one is closed', async () => {
    const fx = fixture();
    const file = path.join(fx.dir, 'st.wav');
    writeWav(file, [bursts(SAMPLE_RATE, 61), bursts(SAMPLE_RATE, 62)]);
    const assetId = await importWav(fx, file);
    const queued = start(fx, VOCALS_CLASSIC, { params: {}, source: { assetId } });
    const interrupted = start(fx, VOCALS_CLASSIC, { params: {}, source: { assetId } });
    fx.store.updateJob(interrupted.id, { status: 'running', stage: 'cancelling the centre of the stereo picture', attempt: 1 });
    const n = assets(fx);
    fx.tools.recover([fx.store.getJob(queued.id), fx.store.getJob(interrupted.id)]);
    expect(fx.store.getJob(interrupted.id)).toMatchObject({ status: 'failed', error: { code: 'interrupted', retryable: true } });
    const q = await done(fx, queued.id);
    expect(q.status).toBe('succeeded');
    expect(assets(fx)).toBe(n + 1);
    // a run whose result was imported just before the restart is closed with that asset, not imported again
    const imported = start(fx, VOCALS_CLASSIC, { params: {}, source: { assetId } });
    const out = q.output.attachment.assetId as string;
    const doc = fx.store.getProject(fx.pid).doc;
    const copy = { ...doc.assets[out]!, id: undefined, contentHash: `sha256:${'a'.repeat(64)}`, provenance: { ...doc.assets[out]!.provenance, derived: { ...doc.assets[out]!.provenance.derived!, jobId: imported.id } } };
    delete (copy as { id?: string }).id;
    fx.store.commit({ projectId: fx.pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: copy } }] });
    fx.store.updateJob(imported.id, { status: 'running', attempt: 1 });
    const m = assets(fx);
    fx.tools.recover([fx.store.getJob(imported.id)]);
    expect(fx.store.getJob(imported.id)).toMatchObject({ status: 'succeeded', output: { attachment: { status: 'imported' } } });
    expect(assets(fx)).toBe(m);
    fx.store.close();
  }, 60_000);
});

describe('sound checks', () => {
  it('estimateLag finds a shift to the sample and its sign', () => {
    const x = bursts(SAMPLE_RATE, 77);
    for (const shift of [0, 1, 48, 49, 480, -480]) {
      const y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) { const k = i - shift; y[i] = k >= 0 && k < x.length ? x[k]! : 0; }
      const r = estimateLag(x, y, 4800);
      expect(r.lag).toBe(shift);
      expect(r.match).toBeGreaterThan(0.9);
    }
    expect(estimateLag(x, bursts(SAMPLE_RATE, 78), 4800).match).toBeLessThan(0.2);
  });
});
