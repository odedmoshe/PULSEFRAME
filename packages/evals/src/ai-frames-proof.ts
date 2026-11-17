/**
 * pnpm proof:ai-frames: the frame-job path (ADR-0017, route R2) against a REAL ComfyUI, with no model.
 *
 * The capability is the proof-only descriptor `test.frames.invert` (ComfyUI core ImageInvert, per frame, chunks of 24), defined in this
 * file, LABELLED as a test descriptor and injected through Capabilities' registry override. It is never added to BUILTIN_CAPABILITIES.
 * Input: a 2 s 320×180 testsrc2 at 30000/1001 with AAC sound (60 frames).
 * Checks: the PNG-in-MKV path is bit-exact (invert = 255 − x per byte, invert of invert = x), 60 frames collected and assembled,
 * r_frame_rate 30000/1001, sound within one AAC frame, describeMedia accepts the result, provenance.derived.frames recorded,
 * replace_clip_asset and undo restore the document exactly, cancel after chunk 1 attaches nothing, and a server restart resumes at chunk 2.
 * Exits 0 when every check passes, 1 when one fails, 2 (BLOCKED) when ComfyUI is not reachable.
 *
 *   PF_COMFYUI_URL=http://127.0.0.1:8188 PF_COMFYUI_MODELS_DIR=.artifacts/comfyui/models pnpm proof:ai-frames
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import * as T from '@pulseframe/time';
import { canonical, findClip, type MediaClip } from '@pulseframe/core';
import { ComfyDescriptorSchema, ComfyUIAdapter, graphDigest, type ComfyDescriptor, type ComfyGraph } from '@pulseframe/providers';
import { Capabilities } from '@pulseframe/server/capabilities.ts';
import { loadConfig } from '@pulseframe/server/config.ts';
import { extractChunk } from '@pulseframe/server/framejobs.ts';
import { describeMedia, ffprobe, ingestUpload } from '@pulseframe/server/ingest.ts';
import { FifoComputeLane } from '@pulseframe/server/lane.ts';
import { Store } from '@pulseframe/server/store.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/ai-frames');
const COMFY = process.env.PF_COMFYUI_URL ?? 'http://127.0.0.1:8188';
const MODELS = path.resolve(root, process.env.PF_COMFYUI_MODELS_DIR ?? '.artifacts/comfyui/models');
const R = { num: 30000, den: 1001 };
const FRAMES = 60;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 30 });
const raw = (file: string) => ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);

/** PROOF-ONLY descriptor (labelled; never in BUILTIN_CAPABILITIES): ImageInvert on every frame, model-free. */
const invertGraph: ComfyGraph = {
  '1': { class_type: 'LoadVideo', inputs: { file: 'pulseframe_input.mkv' } },
  '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
  '3': { class_type: 'ImageInvert', inputs: { image: ['2', 0] } },
  '4': { class_type: 'PreviewImage', inputs: { images: ['3', 0] } },
};
const pass = { status: 'pass' as const, evidence: 'proof-only descriptor' };
const TEST_FRAMES_INVERT: ComfyDescriptor = ComfyDescriptorSchema.parse({
  id: 'test.frames.invert', version: '0.0.1', provider: 'comfyui', state: 'published',
  title: { he: 'בדיקה בלבד: היפוך צבעים לכל פריים', en: 'Proof only: invert every frame' }, description: { he: 'מתאר להוכחה בלבד; לא ברשימת היכולות', en: 'Proof-only descriptor; not in the registry' },
  source: { repository: null, commit: null, notices: 'Proof-only graph from ComfyUI core nodes.' }, graph: invertGraph, graphDigest: graphDigest(invertGraph),
  inputs: [{ name: 'video', label: { he: 'וידאו', en: 'Video' }, type: 'video', binding: { nodeId: '1', input: 'file' }, required: true, reviewed: true }],
  outputs: [{ name: 'video', role: 'primary', mediaType: 'video', nodeId: '4', encoding: 'display', reviewed: true, expectSize: { sameAsInput: 'video' }, expectFrames: 'same' }],
  requiredNodes: ['LoadVideo', 'GetVideoComponents', 'ImageInvert', 'PreviewImage'].map((classType) => ({ classType, pack: 'core', packVersion: null })),
  models: [], runtime: { comfyuiCommit: null, imageDigest: null }, limits: { maxFrames: 300, maxPixels: 1280 * 720 },
  resources: { downloadBytes: 0, estimatedResidencyBytes: 0, hostRamBytes: null, measuredProfiles: [] },
  frames: { input: 'video', mode: 'per-frame', chunkFrames: 24, maxOutputRate: 120 },
  egress: 'none', languages: [], limitations: ['Proof only.'],
  qualification: { schemaValid: pass, dependencyReady: pass, licenseReviewed: pass, executed: pass, qualityReviewed: pass, hebrewQualified: { status: 'not_applicable' }, hardwareQualified: pass },
});

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const adapter = new ComfyUIAdapter(COMFY);
  const ready = await adapter.probe(TEST_FRAMES_INVERT);
  if (!ready.reachable) { console.error(`BLOCKED: ComfyUI is not reachable at ${COMFY} (${ready.problems.join('; ')}). Start it (docs/INTEGRATIONS.md) and rerun.`); process.exit(2); }
  if (ready.missingNodeClasses.length) { console.error(`BLOCKED: ComfyUI lacks ${ready.missingNodeClasses.join(', ')}`); process.exit(2); }
  const comfy = async (p: string) => (await fetch(`${COMFY}${p}`)).json() as Promise<any>;
  const requestIds = async (base: string) => Object.values<any>(await comfy('/history?max_items=10000')).map((h) => h.prompt?.[3]?.pulseframe_request).filter((r: unknown): r is string => typeof r === 'string' && r.startsWith(`${base}:`)).sort();

  // ---- fixture: 2 s 320x180 testsrc2 at 30000/1001 with AAC ----
  const src = path.join(art, 'source.mp4');
  ff(['-f', 'lavfi', '-i', `testsrc2=s=320x180:r=${R.num}/${R.den}`, '-f', 'lavfi', '-i', `sine=f=440:r=48000:d=${(FRAMES * R.den) / R.num}`, '-frames:v', String(FRAMES), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', src]);

  console.log('\n# the PNG-in-MKV path through ComfyUI is bit-exact');
  {
    const run = async (file: string, tag: string) => {
      const staged = await adapter.stage(file, `pf_proof_${tag}.mkv`, 'video/x-matroska');
      const graph = structuredClone(TEST_FRAMES_INVERT.graph);
      graph['1']!.inputs.file = staged;
      const { providerJobId } = await adapter.submit(graph, `ai-frames-proof:${tag}:${Date.now()}`);
      for (let i = 0; i < 1200; i++) { const s = await adapter.status(providerJobId); if (s.state === 'succeeded') break; if (s.state === 'failed') throw new Error(s.message); await sleep(100); }
      const dir = path.join(art, `png_${tag}`);
      const files = await adapter.collect(TEST_FRAMES_INVERT, providerJobId, dir);
      return files.map((f) => f.path);
    };
    const a = path.join(art, 'png_a.mkv');
    const packets = await extractChunk(src, a, { first: 0, count: 10 }, 'bt709', R);
    check('extracted chunk: PNG in Matroska, rgb24, exactly the 10 frames asked for', packets === 10 && (await ffprobe(a)).streams[0].pix_fmt === 'rgb24' && (await ffprobe(a)).streams[0].codec_name === 'png', { packets });
    const A = raw(a);
    const bFiles = await run(a, 'invert1');
    const B = Buffer.concat(bFiles.map(raw));
    let inv = B.length === A.length;
    for (let i = 0; inv && i < A.length; i++) if (B[i] !== 255 - A[i]!) inv = false;
    check('ImageInvert of the staged frames is exactly 255 − x for every byte of all 10 frames', inv && bFiles.length === 10, { frames: bFiles.length, bytes: B.length });
    const seq = path.join(art, 'png_b_seq');
    fs.mkdirSync(seq);
    bFiles.forEach((f, i) => fs.copyFileSync(f, path.join(seq, `${String(i).padStart(6, '0')}.png`)));
    const b = path.join(art, 'png_b.mkv');
    ff(['-framerate', `${R.num}/${R.den}`, '-i', path.join(seq, '%06d.png'), '-c:v', 'png', '-pix_fmt', 'rgb24', '-f', 'matroska', b]);
    const C = Buffer.concat((await run(b, 'invert2')).map(raw));
    check('invert of invert on the decoded PNG path is bit-exact (equals the staged source frames)', C.equals(A), { bytes: C.length });
    // the two chunks this check staged by hand (the frame jobs below delete their own)
    const input = path.join(path.dirname(MODELS), 'input');
    if (fs.existsSync(input)) for (const f of ['pf_proof_invert1.mkv', 'pf_proof_invert2.mkv']) fs.rmSync(path.join(input, f), { force: true });
  }

  // ---- the frame job, in-process (Store + Capabilities with the real adapter, the compute lane, and the proof-only registry) ----
  const cfg = { ...loadConfig({}), dataDir: path.join(art, 'data'), comfyuiUrl: COMFY, comfyuiModelsDir: fs.existsSync(MODELS) ? MODELS : null };
  let store = new Store(cfg.dataDir);
  const lane = new FifoComputeLane();
  const hooks: ((label: string) => Promise<void> | void)[] = [];
  lane.onBeforeHeavy(async (label) => { for (const h of hooks) await h(label); });
  const make = (s: Store, l: FifoComputeLane) => new Capabilities(s, cfg, adapter, { registry: () => [TEST_FRAMES_INVERT], lane: l });
  let caps = make(store, lane);
  const waitJob = async (id: string, ms = 600_000) => { const t0 = Date.now(); for (;;) { const j = store.getJob(id); if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > ms) return { ...j, timedOut: true }; await sleep(100); } };
  const report: Record<string, unknown> = {};
  try {
    const pid = store.createProject({ name: 'ai-frames', width: 320, height: 180, frameRate: R }).doc.id;
    const asset = await ingestUpload(store, Readable.toWeb(fs.createReadStream(src)) as any, 'source.mp4', 'user:local', 1 << 28);
    const assetId = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
    const clipId = store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_clip', args: { assetId, start: T.ZERO } }] }).results[0]!.output!.clipId as string;

    console.log('\n# a 60-frame job in place of the clip');
    const before = canonical(store.getProject(pid).doc);
    const t0 = Date.now();
    const job = caps.start({ projectId: pid, capabilityId: TEST_FRAMES_INVERT.id, params: {}, actor: 'user:local', source: { clipId }, apply: 'replace-clip' });
    const done = await waitJob(job.id);
    report.job = { status: done.status, error: done.error, wallSeconds: (Date.now() - t0) / 1000, chunks: done.output?.frames?.chunks?.map((c: any) => ({ k: c.k, frames: c.frames, seconds: c.seconds })) };
    check('the job succeeds', done.status === 'succeeded', done.error ?? report.job);
    if (done.status !== 'succeeded') return;
    const collected = done.output.frames.chunks.reduce((n: number, c: any) => n + c.frames, 0);
    const doc = store.getProject(pid).doc;
    const out = doc.assets[done.output.attachment.assetId]!;
    const file = store.blobPath(out.contentHash);
    const probe = await ffprobe(file);
    const v = probe.streams.find((x: any) => x.codec_type === 'video'), a = probe.streams.find((x: any) => x.codec_type === 'audio');
    const packets = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]).toString().trim());
    check('60 frames collected (3 chunks: 24, 24, 12) and 60 assembled', collected === FRAMES && packets === FRAMES && done.output.frames.chunks.map((c: any) => c.frames).join() === '24,24,12', { collected, packets });
    check('r_frame_rate is exactly 30000/1001', v.r_frame_rate === '30000/1001' && v.avg_frame_rate === '30000/1001', { r: v.r_frame_rate, avg: v.avg_frame_rate });
    const want = (FRAMES * R.den) / R.num, got = Number(a?.duration);
    check('the sound is copied back and lasts the range within one AAC frame (1024 samples)', !!a && Math.abs(got - want) <= 1024 / Number(a.sample_rate), { audioSeconds: got, expected: want });
    let meta: unknown = null, metaErr: unknown = null;
    try { meta = await describeMedia(file); } catch (e) { metaErr = (e as Error).message; }
    check('describeMedia accepts the result as editable (no conform)', !!meta && !metaErr && (meta as any).video.frameCount === FRAMES, metaErr ?? undefined);
    check('provenance.derived.frames is recorded (identity mapping, exact rates, no held frames)', canonical(out.provenance.derived?.frames) === canonical({ sourceStartFrame: 0, sourceFrameCount: FRAMES, sourceRate: R, outputRate: R, mapping: 'identity', heldFrames: [] }) && out.provenance.derived?.audio === 'source-copied' && T.isZero(out.provenance.derived!.sourceRangeStart!), out.provenance.derived);
    check('replace_clip_asset placed the result in the clip; its linked sound keeps the original file', done.output.attachment.status === 'attached' && (findClip(doc, clipId)!.clip as MediaClip).assetId === out.id, done.output.attachment);
    check('scratch and staged chunks are deleted', !fs.existsSync(path.join(store.tmpDir, `frames_${job.id}`)) && (!cfg.comfyuiModelsDir || !fs.readdirSync(path.join(path.dirname(cfg.comfyuiModelsDir), 'input')).some((f) => f.includes(job.id))));
    store.undo(pid, 'user:local', 'undo');
    const afterUndo = store.getProject(pid).doc;
    const { [out.id]: _kept, ...assetsWithoutResult } = afterUndo.assets;
    check('undo of the placement restores the clip exactly (the result stays in the library)', canonical({ ...afterUndo, assets: assetsWithoutResult }) === before && !!afterUndo.assets[out.id]);
    store.undo(pid, 'user:local', 'undo');
    check('undoing the import too returns the document to exactly what it was', canonical(store.getProject(pid).doc) === before);

    console.log('\n# cancel after chunk 1 attaches nothing');
    let cancelId = '';
    hooks.push(async (label) => { if (cancelId && label.includes(cancelId) && label.includes('chunk 2/')) await caps.cancel(cancelId, 'user:local'); });
    const assetsBefore = Object.keys(store.getProject(pid).doc.assets).sort().join();
    const cj = caps.start({ projectId: pid, capabilityId: TEST_FRAMES_INVERT.id, params: {}, actor: 'user:local', source: { assetId } });
    cancelId = cj.id;
    const canceled = await waitJob(cj.id);
    check('canceled at the chunk boundary after chunk 1: nothing imported, scratch removed, chunks 2 and 3 never submitted', canceled.status === 'canceled' && Object.keys(store.getProject(pid).doc.assets).sort().join() === assetsBefore && !fs.existsSync(path.join(store.tmpDir, `frames_${cj.id}`)) && (await requestIds(cj.input.clientRequestId)).join() === `${cj.input.clientRequestId}:0`, { status: canceled.status, requests: await requestIds(cj.input.clientRequestId), cancel: canceled.output?.cancel });

    console.log('\n# a server restart resumes at chunk 2');
    let restartId = '';
    let stopping: Promise<void> | null = null;
    hooks.push((label) => { if (restartId && label.includes(restartId) && label.includes('chunk 2/') && !stopping) stopping = caps.stop(); });
    const rj = caps.start({ projectId: pid, capabilityId: TEST_FRAMES_INVERT.id, params: {}, actor: 'user:local', source: { assetId } });
    restartId = rj.id;
    for (let i = 0; i < 6000 && !stopping; i++) await sleep(50);
    await stopping;
    const mid = store.getJob(rj.id);
    check('the server stopped after chunk 1 was recorded; the job row is still running with one chunk record', mid.status === 'running' && mid.output.frames.chunks.length === 1, { status: mid.status, chunks: mid.output?.frames?.chunks?.length });
    store.close();
    store = new Store(cfg.dataDir); // a new process would open the same data
    caps = make(store, new FifoComputeLane());
    await caps.recover();
    const resumed = await waitJob(rj.id);
    const reqs = await requestIds(rj.input.clientRequestId);
    const base = rj.input.clientRequestId;
    check('after the restart: chunk 1 re-verified by its digests and not redone; chunks 2 and 3 run once each; the job succeeds', resumed.status === 'succeeded' && resumed.output.frames.reverified?.kept === 1 && reqs.join() === [`${base}:0`, `${base}:1`, `${base}:2`].join(), { status: resumed.status, reverified: resumed.output?.frames?.reverified, requests: reqs, error: resumed.error });
  } finally {
    await caps.stop();
    store.close();
    const failed = checks.filter((c) => !c.ok);
    fs.writeFileSync(path.join(art, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), comfyui: { url: COMFY, version: ready.runtimeVersion, device: ready.device }, scope: 'ADR-0017 frame jobs, model-free (proof-only ImageInvert descriptor); CPU; not a quality or hardware qualification', report, checks }, null, 2));
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
