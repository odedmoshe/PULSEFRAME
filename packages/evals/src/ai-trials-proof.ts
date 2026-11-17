/**
 * pnpm proof:ai-trials: the wave-1 ComfyUI capabilities on this CPU (ADR-0017), with their real model files.
 *
 * 1. RIFE v4.25 is fetched through the product's owner-approval download path (an agent asks, the owner approves the exact bytes, the
 *    file is verified by size and SHA-256) and then reads ready. Real-ESRGAN x4plus and general-x4v3 must already be placed (the lead
 *    placed them under the owner's grant); without them, or without ComfyUI, the proof exits 2 (BLOCKED).
 * 2. Smooth slow motion: a 60-frame 640×360 moving disc at 4x gives 240 frames at 4r; on the PNG path every 4th frame is bit-identical
 *    to its source frame and the midpoint disc centroid is within 1 px of linear motion (a smoke check, not a quality review); placed with
 *    replace_clip_asset + set_clip_speed(0.25) the clip becomes exactly 4x longer.
 * 3. Photo upscale x4plus: 320×240 gives 1280×960, and scale 0.75 gives 960×720.
 * 4. Video enhance x4v3: 2 s at 320×180 gives 1280×720 with the exact frame count and rate; a static input gives identical consecutive
 *    output frames.
 * Writes docs/evidence/ai-trials-cpu.json: wall seconds, seconds per output frame (median and p95 over chunks), the peak RSS of the
 * ComfyUI process sampled from /proc, output digests and device 'cpu'. Every figure is for this 4-vCPU machine only.
 *
 *   PF_COMFYUI_URL=http://127.0.0.1:8188 PF_COMFYUI_MODELS_DIR=.artifacts/comfyui/models pnpm proof:ai-trials
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import * as T from '@pulseframe/time';
import { findClip, type MediaClip } from '@pulseframe/core';
import { ComfyUIAdapter, IMAGE_UPSCALE, resolveGraph, VIDEO_ENHANCE, VIDEO_SMOOTH_SLOWMO } from '@pulseframe/providers';
import { startServer } from '@pulseframe/server';
import { Capabilities } from '@pulseframe/server/capabilities.ts';
import { loadConfig } from '@pulseframe/server/config.ts';
import { extractChunk } from '@pulseframe/server/framejobs.ts';
import { ffprobe, ingestUpload } from '@pulseframe/server/ingest.ts';
import { FifoComputeLane } from '@pulseframe/server/lane.ts';
import { ModelStore } from '@pulseframe/server/models.ts';
import { Store, type JobRow } from '@pulseframe/server/store.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/ai-trials');
const evidenceFile = path.join(root, 'docs/evidence/ai-trials-cpu.json');
const COMFY = process.env.PF_COMFYUI_URL ?? 'http://127.0.0.1:8188';
const MODELS = path.resolve(root, process.env.PF_COMFYUI_MODELS_DIR ?? '.artifacts/comfyui/models');
const PORT = Number(process.env.PF_PROOF_PORT ?? 8799);
const NTSC = { num: 30000, den: 1001 };
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 30 });
const raw = (file: string) => ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
const blocked = (why: string): never => { console.error(`BLOCKED: ${why}`); process.exit(2); };
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]! : null; };
const round = (x: number | null, d = 3) => (x === null ? null : Number(x.toFixed(d)));

/** The ComfyUI process on this machine (PF_COMFYUI_PID, or the python process running main.py from a ComfyUI folder), for RSS sampling. */
function comfyPid(): number | null {
  if (process.env.PF_COMFYUI_PID) return Number(process.env.PF_COMFYUI_PID);
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0');
      if (!cmd.some((a) => a.endsWith('main.py'))) continue;
      const cwd = fs.readlinkSync(`/proc/${d}/cwd`);
      if (/comfyui/i.test(cwd) || cmd.some((a) => /comfyui/i.test(a))) return Number(d);
    } catch { /* gone or not ours */ }
  }
  return null;
}
const statusKb = (pid: number, key: string) => { try { const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? Number(m[1]) * 1024 : null; } catch { return null; } };
/** Sample the ComfyUI process's resident memory every 200 ms while `fn` runs. */
async function sampled<R>(pid: number | null, fn: () => Promise<R>): Promise<{ result: R; peakRssBytes: number | null; wallSeconds: number }> {
  let peak: number | null = null;
  const timer = pid ? setInterval(() => { const v = statusKb(pid, 'VmRSS'); if (v !== null && (peak === null || v > peak)) peak = v; }, 200) : null;
  const t0 = Date.now();
  try { return { result: await fn(), peakRssBytes: peak, wallSeconds: (Date.now() - t0) / 1000 }; } finally { if (timer) clearInterval(timer); }
}
/** Disc centroid (pixels brighter than 150 in all channels) of one rgb24 frame. */
function centroid(buf: Buffer, w: number, h: number, frame: number): { x: number; y: number } | null {
  let n = 0, sx = 0, sy = 0;
  const base = frame * w * h * 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = base + (y * w + x) * 3;
    if (buf[o]! > 150 && buf[o + 1]! > 150 && buf[o + 2]! > 150) { n++; sx += x; sy += y; }
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const adapter = new ComfyUIAdapter(COMFY);
  const ready = await adapter.probe(VIDEO_SMOOTH_SLOWMO);
  if (!ready.reachable) blocked(`ComfyUI is not reachable at ${COMFY} (${ready.problems.join('; ')})`);
  for (const d of [IMAGE_UPSCALE, VIDEO_ENHANCE, VIDEO_SMOOTH_SLOWMO]) {
    const r = await adapter.probe(d);
    if (r.missingNodeClasses.length) blocked(`ComfyUI lacks ${r.missingNodeClasses.join(', ')} (needed by ${d.id})`);
  }
  const placed = new ModelStore(MODELS, []);
  for (const m of [IMAGE_UPSCALE.models[0]!, VIDEO_ENHANCE.models[0]!]) {
    const st = await placed.status(m);
    if (st.state !== 'ready') blocked(`${m.path} is ${st.state} in ${MODELS} (${st.detail}); it is placed by hand under the owner's grant`);
  }
  check('ComfyUI runs on the CPU here', ready.device?.type === 'cpu', ready.device);
  const pid = comfyPid();
  const evidence: Record<string, any> = {
    generatedAt: new Date().toISOString(),
    label: 'Measured on this 4-vCPU container, CPU only, with short synthetic inputs. Every figure applies to this machine only; this is not hardware qualification and not a quality review.',
    machine: { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? null, totalRamBytes: os.totalmem(), platform: `${os.platform()} ${os.release()}` },
    comfyui: { version: ready.runtimeVersion, device: 'cpu', deviceReported: ready.device, pidSampled: pid, rssBasis: pid ? 'VmRSS of the ComfyUI process from /proc, sampled every 200 ms during each run' : 'ComfyUI process not found on this machine; no RSS sampled' },
    runs: [] as unknown[],
  };

  console.log('\n# RIFE v4.25 through the owner-approval download path');
  {
    const s = await startServer({ port: PORT, dataDir: path.join(art, 'server'), comfyuiUrl: COMFY, comfyuiModelsDir: MODELS });
    const origin = s.url;
    const agent = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
    const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
    const owner = { cookie, origin, connection: 'close' };
    const call = async (p: string, body?: unknown, headers: Record<string, string> = agent) => {
      const r = await fetch(`${origin}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null } as { status: number; body: any };
    };
    try {
      const pidP = (await call('/projects', { name: 'ai trials' })).body.project.id;
      const capOf = async () => (await call('/capabilities')).body.capabilities.find((c: any) => c.id === VIDEO_SMOOTH_SLOWMO.id);
      let cap = await capOf();
      const rife = VIDEO_SMOOTH_SLOWMO.models[0]!;
      if (!cap.modelsReady) {
        check('before the download: slow motion is not runnable; its setup names the exact missing bytes', cap.runnable === false && cap.setup?.code === 'model_missing' && cap.missingDownloadBytes === rife.bytes, cap.setup);
        const direct = await call(`/projects/${pidP}/capabilities/${VIDEO_SMOOTH_SLOWMO.id}/models/download`, { confirmBytes: cap.missingDownloadBytes });
        check('an agent cannot start the download itself (403)', direct.status === 403 && direct.body.error.code === 'human_approval_required');
        const asked = await call(`/projects/${pidP}/capabilities/${VIDEO_SMOOTH_SLOWMO.id}/models/request`, {});
        check('an agent asks: an approval for exactly the RIFE bytes is created, and no download starts', asked.status === 201 && asked.body.approval.action.bytes === rife.bytes && !fs.existsSync(path.join(MODELS, `${rife.path}.part`)), asked.body.approval?.action);
        const agentApproves = await call(`/projects/${pidP}/approvals/${asked.body.approval.id}/approve`, {});
        check('the agent cannot approve its own request', agentApproves.status === 403);
        const t0 = Date.now();
        const approved = await call(`/projects/${pidP}/approvals/${asked.body.approval.id}/approve`, {}, owner);
        let dj: any = null;
        for (let i = 0; i < 3600 && approved.body?.jobId; i++) { dj = (await call(`/jobs/${approved.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(dj.status)) break; await sleep(500); }
        evidence.rifeDownload = { status: dj?.status ?? 'not-started', bytes: rife.bytes, sha256: rife.sha256, wallSeconds: (Date.now() - t0) / 1000, error: dj?.error ?? approved.body?.error ?? null };
        if (dj?.status !== 'succeeded') blocked(`the RIFE download did not complete: ${JSON.stringify(evidence.rifeDownload)}`);
        check('the owner approves: RIFE is downloaded and verified by size and SHA-256', dj.output.models[0].state === 'ready', evidence.rifeDownload);
      } else evidence.rifeDownload = { status: 'already-present-and-verified', bytes: 0 };
      cap = await capOf();
      check('RIFE reads ready: slow motion is runnable', cap.modelsReady === true && cap.runnable === true && cap.setup?.code === 'ready', cap.setup);
    } finally { await s.close(); }
  }

  // ---- runs, in-process, with the compute lane ----
  const cfg = { ...loadConfig({}), dataDir: path.join(art, 'data'), comfyuiUrl: COMFY, comfyuiModelsDir: MODELS };
  const store = new Store(cfg.dataDir);
  const caps = new Capabilities(store, cfg, adapter, { lane: new FifoComputeLane() });
  const project = store.createProject({ name: 'trials', width: 640, height: 360, frameRate: NTSC }).doc.id;
  const ingest = async (file: string) => {
    const a = await ingestUpload(store, Readable.toWeb(fs.createReadStream(file)) as any, path.basename(file), 'user:local', 1 << 30);
    return store.commit({ projectId: project, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: a } }] }).results[0]!.output!.assetId as string;
  };
  const waitJob = async (id: string): Promise<JobRow> => { for (;;) { const j = store.getJob(id); if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(250); } };
  const record = (capability: string, workload: string, run: { result: JobRow; peakRssBytes: number | null; wallSeconds: number }) => {
    const j = run.result;
    const chunks: { frames: number; seconds: number }[] = j.output?.frames?.chunks ?? [];
    const perFrame = chunks.map((c) => c.seconds / c.frames);
    const out = j.output?.bundle?.[0];
    evidence.runs.push({
      capability, workload, device: 'cpu', status: j.status, wallSeconds: round(run.wallSeconds, 2),
      secondsPerOutputFrame: chunks.length ? { median: round(quantile(perFrame, 0.5)), p95: round(quantile(perFrame, 0.95)), chunks: chunks.length, basis: 'per chunk: chunk wall seconds (extract, stage, inference, collect) / output frames kept from it' } : null,
      peakRssBytes: run.peakRssBytes, output: out ? { sha256: out.contentHash, bytes: out.bytes, width: out.width, height: out.height, frames: out.frames ?? 1, rFrameRate: out.rFrameRate ?? null } : null, error: j.error ?? null,
    });
  };
  try {
    console.log('\n# smooth slow motion: a moving disc at 4x');
    const disc = path.join(art, 'disc.mp4');
    ff(['-f', 'lavfi', '-i', `color=c=black:s=640x360:r=${NTSC.num}/${NTSC.den}`, '-vf', "format=yuv420p,geq=lum='if(lt(hypot(X-(120+6*N),Y-180),40),235,30+X/32)':cb=128:cr=128", '-frames:v', '60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', disc]);
    {
      // The PNG path, provider only: 8 source frames → (8 − 1)·4 + 1 = 29 frames
      const chunk = path.join(art, 'disc_chunk.mkv');
      await extractChunk(disc, chunk, { first: 0, count: 8 }, 'auto', NTSC);
      const staged = await adapter.stage(chunk, 'pf_trials_disc.mkv', 'video/x-matroska');
      const { graph } = resolveGraph(VIDEO_SMOOTH_SLOWMO, { video: 'ast_disc', multiplier: 4 });
      graph['1']!.inputs.file = staged;
      const { providerJobId } = await adapter.submit(graph, `ai-trials-proof:disc:${Date.now()}`);
      for (;;) { const s = await adapter.status(providerJobId); if (s.state === 'succeeded') break; if (s.state === 'failed') throw new Error(s.message); await sleep(200); }
      const files = await adapter.collect(VIDEO_SMOOTH_SLOWMO, providerJobId, path.join(art, 'disc_png'));
      const src = raw(chunk);
      const outs = files.map((f) => raw(f.path));
      const fb = 640 * 360 * 3;
      const identical = Array.from({ length: 8 }, (_, i) => outs[4 * i]?.equals(src.subarray(i * fb, (i + 1) * fb)) ?? false);
      check('PNG path: 29 frames for 8 source frames at 4x, and every 4th frame is bit-identical to its source frame', files.length === 29 && identical.every(Boolean), { frames: files.length, identical });
      const errors: number[] = [];
      for (let i = 0; i < 7; i++) {
        const a = centroid(src, 640, 360, i), b = centroid(src, 640, 360, i + 1), mid = outs[4 * i + 2] ? centroid(outs[4 * i + 2]!, 640, 360, 0) : null;
        errors.push(a && b && mid ? Math.hypot(mid.x - (a.x + b.x) / 2, mid.y - (a.y + b.y) / 2) : Infinity);
      }
      check('smoke check (not a quality review): the midpoint disc centroid is within 1 px of linear motion', errors.every((e) => e <= 1), { maxErrorPx: round(Math.max(...errors), 3) });
      evidence.slowmoPngPath = { sourceFrames: 8, outputFrames: files.length, everyFourthIdentical: identical.every(Boolean), midpointCentroidMaxErrorPx: round(Math.max(...errors), 3) };
      const input = path.join(path.dirname(MODELS), 'input');
      if (fs.existsSync(input)) fs.rmSync(path.join(input, 'pf_trials_disc.mkv'), { force: true });
    }
    const discId = await ingest(disc);
    const discClip = store.commit({ projectId: project, actor: 'user:local', ops: [{ op: 'add_clip', args: { assetId: discId, start: T.ZERO } }] }).results[0]!.output!.clipId as string;
    const lengthBefore = (findClip(store.getProject(project).doc, discClip)!.clip as MediaClip).duration;
    const slow = await sampled(pid, async () => waitJob(caps.start({ projectId: project, capabilityId: VIDEO_SMOOTH_SLOWMO.id, params: { multiplier: 4 }, actor: 'user:local', source: { clipId: discClip }, apply: 'replace-clip' }).id));
    record(VIDEO_SMOOTH_SLOWMO.id, '60 frames 640x360 at 30000/1001, multiplier 4 (240 output frames)', slow);
    check('slow motion succeeds', slow.result.status === 'succeeded', slow.result.error);
    if (slow.result.status === 'succeeded') {
      const out = slow.result.output.bundle[0];
      check('60 frames at 4x give 240 frames at 4r (120000/1001)', out.frames === 240 && out.rFrameRate === '120000/1001', { frames: out.frames, rate: out.rFrameRate });
      const clip = findClip(store.getProject(project).doc, discClip)!.clip as MediaClip;
      check('replace_clip_asset + set_clip_speed(0.25): the clip shows the result and is exactly 4x longer', clip.assetId === slow.result.output.attachment.assetId && clip.speed?.num === 1 && clip.speed?.den === 4 && T.eq(clip.duration, T.add(T.add(lengthBefore, lengthBefore), T.add(lengthBefore, lengthBefore))), { before: lengthBefore, after: clip.duration, speed: clip.speed });
    }

    console.log('\n# photo upscale with x4plus');
    const photo = path.join(art, 'photo.png');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x240', '-frames:v', '1', photo]);
    const photoId = await ingest(photo);
    for (const [scale, w, h] of [[1, 1280, 960], [0.75, 960, 720]] as const) {
      const run = await sampled(pid, async () => waitJob(caps.start({ projectId: project, capabilityId: IMAGE_UPSCALE.id, params: { image: photoId, scale }, actor: 'user:local' }).id));
      record(IMAGE_UPSCALE.id, `one 320x240 photo, scale ${scale}`, run);
      const out = run.result.output?.bundle?.[0];
      check(`x4plus at scale ${scale}: 320x240 gives ${w}x${h}`, run.result.status === 'succeeded' && out?.width === w && out?.height === h, run.result.error ?? { width: out?.width, height: out?.height });
    }

    console.log('\n# video enhance with general-x4v3');
    const clip2s = path.join(art, 'enhance.mp4');
    ff(['-f', 'lavfi', '-i', `testsrc2=s=320x180:r=${NTSC.num}/${NTSC.den}`, '-f', 'lavfi', '-i', `sine=f=330:r=48000:d=${(60 * NTSC.den) / NTSC.num}`, '-frames:v', '60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', clip2s]);
    const enhId = await ingest(clip2s);
    const enh = await sampled(pid, async () => waitJob(caps.start({ projectId: project, capabilityId: VIDEO_ENHANCE.id, params: { scale: 1 }, actor: 'user:local', source: { assetId: enhId } }).id));
    record(VIDEO_ENHANCE.id, '60 frames (2 s) 320x180 at 30000/1001 with sound, scale 1 (1280x720)', enh);
    const eo = enh.result.output?.bundle?.[0];
    check('x4v3: 2 s at 320x180 gives 1280x720 with exactly 60 frames at 30000/1001', enh.result.status === 'succeeded' && eo?.width === 1280 && eo?.height === 720 && eo?.frames === 60 && eo?.rFrameRate === '30000/1001', enh.result.error ?? eo);
    if (enh.result.status === 'succeeded') {
      const p = await ffprobe(store.blobPath(eo.contentHash));
      check('the enhanced result keeps the source sound', p.streams.some((x: any) => x.codec_type === 'audio'));
    }
    // A static input: one picture repeated, encoded losslessly so every source frame decodes to the same pixels.
    const still = path.join(art, 'static.mp4');
    ff(['-loop', '1', '-i', photo, '-vf', 'scale=320:180,format=yuv420p', '-r', `${NTSC.num}/${NTSC.den}`, '-frames:v', '12', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', still]);
    const staticId = await ingest(still);
    const st = await sampled(pid, async () => waitJob(caps.start({ projectId: project, capabilityId: VIDEO_ENHANCE.id, params: { scale: 0.5 }, actor: 'user:local', source: { assetId: staticId } }).id));
    record(VIDEO_ENHANCE.id, '12 identical frames 320x180, scale 0.5 (640x360)', st);
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const srcFrames = raw(still), fb = 320 * 180 * 3;
    const srcDigests = new Set(Array.from({ length: 12 }, (_, i) => sha(srcFrames.subarray(i * fb, (i + 1) * fb))));
    const outDigests = new Set<string>((st.result.output?.frames?.chunks ?? []).flatMap((c: any) => c.sha256));
    check('a static input gives identical consecutive output frames (one digest for all 12 collected frames)', st.result.status === 'succeeded' && srcDigests.size === 1 && outDigests.size === 1, { sourceDistinct: srcDigests.size, outputDistinct: outDigests.size, error: st.result.error });
  } finally {
    await caps.stop();
    store.close();
    const failed = checks.filter((c) => !c.ok);
    evidence.checks = checks;
    evidence.verdict = failed.length ? `FAILED (${failed.length} of ${checks.length} checks)` : `passed (${checks.length} checks)`;
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed; evidence written to ${path.relative(root, evidenceFile)}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
