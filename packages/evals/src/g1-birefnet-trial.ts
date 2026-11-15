/**
 * Bounded functional trial authorised by the owner (2026-11-14): ONE small CPU workflow, BiRefNet image matting.
 * Limits enforced here: <= 1 GB of new model downloads, <= 10 minutes of inference. Stops cleanly otherwise.
 * This is NOT GPU qualification and NOT a quality review: the input is a synthetic image with known ground truth.
 *
 *   PF_COMFYUI_URL=http://127.0.0.1:8188 PF_COMFYUI_MODELS_DIR=.artifacts/comfyui/models pnpm trial:birefnet
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComfyUIAdapter } from '@pulseframe/providers';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/g1');
const COMFY = process.env.PF_COMFYUI_URL ?? 'http://127.0.0.1:8188';
const MODELS = path.resolve(root, process.env.PF_COMFYUI_MODELS_DIR ?? '.artifacts/comfyui/models');
const CAP = 'comfy.image.remove-background';
const MAX_DOWNLOAD = 1_000_000_000;
const MAX_INFERENCE_MS = 10 * 60_000;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const outcome: Record<string, unknown> = {};

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const ready = await new ComfyUIAdapter(COMFY).probe();
  if (!ready.reachable) { console.error(`BLOCKED: ComfyUI not reachable at ${COMFY}`); process.exit(2); }
  const s = await startServer({ port: 8796, dataDir: path.join(art, 'data'), comfyuiUrl: COMFY, comfyuiModelsDir: MODELS });
  const origin = s.url;
  const agent = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  // The owner's own session, as the local browser UI obtains it.
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const owner = { cookie, origin, connection: 'close' };
  const call = async (p: string, body?: unknown, headers: Record<string, string> = agent) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const waitJob = async (id: string, timeoutMs: number) => {
    const t0 = Date.now();
    for (;;) {
      const j = (await call(`/jobs/${id}`)).body;
      if (['succeeded', 'failed', 'canceled', 'submission-unknown'].includes(j.status)) return j;
      if (Date.now() - t0 > timeoutMs) return { ...j, timedOut: true };
      await sleep(500);
    }
  };
  try {
    const pid = (await call('/projects', { name: 'g1 trial', width: 640, height: 480 })).body.project.id;
    let cap = (await call('/capabilities')).body.capabilities.find((c: any) => c.id === CAP);
    const m = cap.models[0];
    check('capability is listed as experimental with its open reviews, licence record and separate resource quantities', cap.experimental === true && cap.openReviews.includes('qualityReviewed') && m.license === 'MIT' && cap.resources.downloadBytes === 444473596 && cap.resources.estimatedResidencyBytes === null, { openReviews: cap.openReviews, model: m.status });
    outcome.modelBefore = m.status;
    if (cap.missingDownloadBytes > MAX_DOWNLOAD) { outcome.stopped = `download ${cap.missingDownloadBytes} bytes exceeds the authorised 1 GB`; return; }

    if (!cap.modelsReady) {
      // Synthetic source is needed for the "blocked before download" check below, so make it first.
      const early = await call(`/projects/${pid}/capabilities/${CAP}/runs`, { params: { image: 'ast_none' } });
      check('before download: the capability is not runnable', cap.runnable === false && early.status >= 400, early.body?.error?.code);
      const asAgent = await call(`/projects/${pid}/capabilities/${CAP}/models/download`, { confirmBytes: cap.missingDownloadBytes });
      check('an agent credential cannot start a model download', asAgent.status === 403 && asAgent.body.error.code === 'human_approval_required');
      const wrong = await call(`/projects/${pid}/capabilities/${CAP}/models/download`, { confirmBytes: 1 }, owner);
      check('a download approval for a different byte count is refused', wrong.status === 409 && wrong.body.error.code === 'download_size_mismatch');
      const t0 = Date.now();
      const dl = await call(`/projects/${pid}/capabilities/${CAP}/models/download`, { confirmBytes: cap.missingDownloadBytes }, owner);
      const dj = await waitJob(dl.body.jobId, 20 * 60_000);
      outcome.download = { status: dj.status, bytes: cap.missingDownloadBytes, wallSeconds: (Date.now() - t0) / 1000, error: dj.error };
      check('model downloaded by an explicit owner action and verified by size + SHA-256 before becoming ready', dj.status === 'succeeded' && dj.output.models[0].state === 'ready', outcome.download);
      if (dj.status !== 'succeeded') { outcome.stopped = 'download failed'; return; }
    } else outcome.download = { status: 'already-present-and-verified', bytes: 0 };
    cap = (await call('/capabilities')).body.capabilities.find((c: any) => c.id === CAP);
    check('after verification the capability is runnable and still experimental', cap.modelsReady === true && cap.runnable === true && cap.experimental === true);

    // Synthetic fixture with known ground truth: a shaded disc (r=120 at 320,240) on a soft gradient.
    const src = path.join(art, 'disc.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=640x480', '-vf',
      "geq=r='if(lt(hypot(X-320,Y-240),120),230-0.6*hypot(X-280,Y-200),90+X/16)':g='if(lt(hypot(X-320,Y-240),120),70-0.1*hypot(X-280,Y-200),110+Y/12)':b='if(lt(hypot(X-320,Y-240),120),60,140)'", '-frames:v', '1', src]);
    const up: any = await (await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...agent, 'x-filename': 'disc.png' }, body: fs.readFileSync(src) })).json();
    const run = await call(`/projects/${pid}/capabilities/${CAP}/runs`, { params: { image: up.assetId }, attach: { start: { value: '0', timescale: 30 }, duration: { value: '30', timescale: 30 } } });
    const job = await waitJob(run.body.jobId, MAX_INFERENCE_MS);
    if (job.timedOut) {
      const c = await call(`/jobs/${job.id}/cancel`, {});
      outcome.inference = { status: 'stopped at the 10-minute limit', cancel: c.body };
      check('inference finished inside the authorised 10 minutes', false, outcome.inference);
      return;
    }
    outcome.inference = { status: job.status, stageSeconds: job.output?.stageSeconds, error: job.error };
    check('BiRefNet ran on CPU through the durable job path', job.status === 'succeeded', outcome.inference);
    if (job.status !== 'succeeded') return;
    const cut = job.output.bundle.find((o: any) => o.name === 'cutout');
    const matte = job.output.bundle.find((o: any) => o.name === 'matte');
    check('typed output bundle: RGBA cutout (primary) and matte, both the source size, each digested', cut.width === 640 && cut.height === 480 && cut.hasAlpha === true && matte.width === 640 && matte.role === 'matte' && cut.contentHash !== matte.contentHash, { cutout: { pixFmt: cut.pixFmt, bytes: cut.bytes }, matte: { pixFmt: matte.pixFmt, bytes: matte.bytes } });
    const idx = (name: string) => job.output.bundle.findIndex((o: any) => o.name === name);
    const cutPng = path.join(root, 'docs/evidence/g1-birefnet-cutout-synthetic.png');
    const mattePng = path.join(art, 'matte.png');
    fs.writeFileSync(cutPng, (await call(`/jobs/${job.id}/outputs/${idx('cutout')}`)).body);
    fs.writeFileSync(mattePng, (await call(`/jobs/${job.id}/outputs/${idx('matte')}`)).body);
    const gray = execFileSync('ffmpeg', ['-v', 'error', '-i', mattePng, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
    const alpha = execFileSync('ffmpeg', ['-v', 'error', '-i', cutPng, '-vf', 'alphaextract', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
    const iou = (buf: Buffer) => { let inter = 0, uni = 0; for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) { const t = Math.hypot(x - 320, y - 240) < 120; const p = buf[y * 640 + x]! > 127; if (t && p) inter++; if (t || p) uni++; } return inter / uni; };
    const iouMatte = iou(gray);
    const iouAlpha = iou(alpha);
    outcome.synthetic = { fixture: 'shaded disc r=120 on gradient, 640x480 (synthetic, generated here)', matteIoU: +iouMatte.toFixed(4), cutoutAlphaIoU: +iouAlpha.toFixed(4), note: 'one synthetic image; says nothing about hair, motion blur, occlusion or real footage' };
    check('matte polarity and placement: foreground is white and overlaps the known disc (IoU > 0.9 on this one synthetic image)', iouMatte > 0.9, outcome.synthetic);
    check('cutout alpha agrees with the matte (opaque subject, transparent background)', iouAlpha > 0.9);
    // Through the product: derived asset with lineage, attached, alpha respected by the shared compositor.
    const doc = (await call(`/projects/${pid}`)).body.project;
    const asset = doc.assets[job.output.attachment.assetId];
    check('cutout entered the project as a derived RGBA asset with source lineage and an "experimental" recipe', job.output.attachment.status === 'attached' && asset.image.hasAlpha === true && asset.provenance.derived.sourceAssetIds[0] === up.assetId && job.output.recipe.experimental === true);
    const frame = path.join(art, 'frame.png');
    fs.writeFileSync(frame, Buffer.from(await (await fetch(`${origin}/api/v1/projects/${pid}/frame?index=5`, { headers: agent })).arrayBuffer()));
    const px = (x: number, y: number) => [...execFileSync('ffmpeg', ['-v', 'error', '-i', frame, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
    const inside = px(320, 240);
    const outside = px(40, 40);
    check('compositor honours the alpha: subject pixels visible, removed background shows the project background (black)', inside[0]! > 120 && outside.every((v) => v < 6), { inside, outside });
    const after = (await call('/capabilities')).body.capabilities.find((c: any) => c.id === CAP);
    check('after the run: executed is recorded for this CPU profile; quality review remains open, so it stays experimental', after.qualification.executed.status === 'pass' && /cpu/.test(after.qualification.hardwareQualified.evidence) && after.experimental === true && after.qualification.qualityReviewed.status === 'not_assessed');
  } finally {
    await s.close();
    const failed = checks.filter((c) => !c.ok);
    const report = {
      ranAt: new Date().toISOString(), result: outcome.stopped ? `STOPPED: ${outcome.stopped}` : failed.length ? 'FAILED' : 'PASSED',
      scope: 'Bounded CPU functional trial of one model workflow. Not GPU qualification. Not a quality review. One synthetic input.',
      limits: { maxDownloadBytes: MAX_DOWNLOAD, maxInferenceMs: MAX_INFERENCE_MS },
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: 'none' },
      provider: { comfyui: ready.runtimeVersion, device: ready.device },
      outcome, checks,
    };
    fs.writeFileSync(path.join(root, 'docs/evidence/g1-birefnet-cpu-trial.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${report.result}: ${checks.length - failed.length}/${checks.length} checks. Evidence: docs/evidence/g1-birefnet-cpu-trial.json`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
