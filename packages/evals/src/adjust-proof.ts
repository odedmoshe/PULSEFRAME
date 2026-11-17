/**
 * proof:adjust (ADR-0016): adjustment layers end to end through the real server: REST transactions, stills through
 * GET /projects/:id/frame (the same evaluate + compositor as preview and export, ADR-0005) and exports.
 *
 *  1. A whole-edit color.adjust over three full-frame clips equals the same effect on each clip: max |Δ| ≤ 1/255 on every
 *     pixel of three stills (one per clip).
 *  2. Opacity 0.5: every pixel within 1 of round((with + without) / 2).
 *  3. Untouched where it must be: pixels outside the mask, frames outside the span, and the caption and title pixels (a title
 *     on a track above the FX track): 0 differing bytes against a render without the adjustment.
 *  4. The FX track moved above the title track: the title's pixels change (> 0), the caption's still do not.
 *  5. Still against exported frame at 3 frames within the parity-suite tolerance (PSNR ≥ 36 dB, SSIM ≥ 0.985).
 *  6. Undo of every adjustment edit gives an equal creativeProjection; replaying the op log equals the live document.
 *  7. A format variant whose override hides the adjustment: that variant's still loses the adjustment, the master keeps it.
 *  8. Flash safety (ADR-0009): a strobe on the adjustment and one on a clip start flashes at least flashGapFrames (11 at
 *     30 fps) apart in the exported file, and the export's photosensitivity check reports 0 failing ranges. Needs a WebGPU
 *     adapter in the render worker (the strobe is a GPU pass); without one this check is BLOCKED, never passed.
 *  9. color.grade (a GPU effect) on an adjustment with the render worker started without WebGPU (PF_RENDER_GPU=off): the
 *     export is refused with the adapter reason, and so is a still; nothing is delivered without the effect.
 * 10. Recorded, not gated: draw milliseconds per frame at 1080×1920 for no adjustment and a whole-edit color.adjust,
 *     blur.gaussian 0.01 and overlay.snow: median and p95 over 30 frames (each a one-frame export, so each sample is one
 *     frame drawn in a fresh render page, its picture decode included), and the mean of a 30-frame export.
 *
 *   pnpm build && pnpm proof:adjust
 * Writes docs/evidence/adjust-proof.json. Synthetic still pictures only; nobody looked at the pictures.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { creativeProjection, type ProjectDocument } from '@pulseframe/core';
import { flashGapFrames, flashSchedule } from '@pulseframe/engine';
import * as T from '@pulseframe/time';
import { startServer, type RunningServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/adjust-proof');
const PORT = 8913, PORT_OFF = 8914;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const W = 640, H = 360;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const measurements: Record<string, unknown> = {};
let blocked: string | null = null;

/** Packed RGB of a PNG still of the given size. */
const pngToRgb = (png: Buffer, w = W, h = H): Buffer => { const rgb = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png); if (rgb.length !== w * h * 3) throw new Error(`still is not ${w}x${h}`); return rgb; };
const maxDiff = (a: Buffer, b: Buffer) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };
/** Bytes that differ among the pixels a mask selects (all pixels without one). */
const differingBytes = (a: Buffer, b: Buffer, mask?: Uint8Array) => { let n = 0; for (let p = 0; p < a.length / 3; p++) { if (mask && !mask[p]) continue; for (let c = 0; c < 3; c++) if (a[p * 3 + c] !== b[p * 3 + c]) n++; } return n; };
const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);
const psnr = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; s += d * d; } const mse = s / a.length; return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse); };
const luma = (b: Buffer) => { const y = new Float64Array(W * H); for (let p = 0; p < W * H; p++) y[p] = 0.299 * b[p * 3]! + 0.587 * b[p * 3 + 1]! + 0.114 * b[p * 3 + 2]!; return y; };
/** SSIM on luma, 8×8 windows every 4 pixels (as the parity suite computes it). */
function ssim(a: Buffer, b: Buffer) {
  const ya = luma(a), yb = luma(b), C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let sum = 0, n = 0;
  for (let y0 = 0; y0 + 8 <= H; y0 += 4)
    for (let x0 = 0; x0 + 8 <= W; x0 += 4) {
      let ma = 0, mb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) { const va = ya[y * W + x]!, vb = yb[y * W + x]!; ma += va; mb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; }
      ma /= 64; mb /= 64;
      const va = saa / 64 - ma * ma, vb = sbb / 64 - mb * mb, cv = sab / 64 - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
    }
  return sum / n;
}
const percentile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN; };
const r2 = (x: number) => Number(x.toFixed(2));

/** A mid-tone scene (no pure white or black, so text colours stand out exactly), with coloured boxes. */
function scene(file: string, bg: string, boxes: string[], w = W, h = H) {
  const draw = boxes.map((c, i) => `drawbox=x=${Math.round(w * (0.08 + 0.3 * i))}:y=${Math.round(h * (0.15 + 0.2 * (i % 2)))}:w=${Math.round(w * 0.22)}:h=${Math.round(h * 0.5)}:color=${c}:t=fill`).join(',');
  ff(['-f', 'lavfi', '-i', `color=c=${bg}:s=${w}x${h}${draw ? `,${draw}` : ''}`, '-frames:v', '1', '-y', file]);
  return file;
}

interface Api {
  call: (p: string, body?: unknown) => Promise<{ status: number; body: any }>;
  tx: (pid: string, ops: unknown[]) => Promise<any>;
  upload: (pid: string, file: string) => Promise<string>;
  docOf: (pid: string) => Promise<{ project: ProjectDocument; revision: number }>;
  newProject: (name: string, width?: number, height?: number) => Promise<string>;
  stillPng: (pid: string, index: number, variant?: string) => Promise<Buffer>;
  waitJob: (id: string) => Promise<any>;
}
function client(s: RunningServer): Api {
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  return {
    call,
    tx: async (pid, ops) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; },
    upload: async (pid, file) => ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string,
    docOf: async (pid) => (await call(`/projects/${pid}`)).body,
    newProject: async (name, width = W, height = H) => (await call('/projects', { name, width, height })).body.project.id as string,
    stillPng: async (pid, index, variant) => { const r = await call(`/projects/${pid}/frame?index=${index}${variant ? `&variant=${variant}` : ''}`); if (r.status !== 200) throw Object.assign(new Error(`still ${index} failed: ${JSON.stringify(r.body).slice(0, 300)}`), { response: r }); return r.body as Buffer; },
    waitJob: async (id) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(150); } },
  };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');

  // ---------- fixtures: full-frame still pictures ----------
  const pics = [
    scene(path.join(art, 'a.png'), '0x4a6f8c', ['0xc0803a', '0x5aa05a', '0x9a4ab0']),
    scene(path.join(art, 'b.png'), '0x8c5a4a', ['0x3a80c0', '0xb0a04a']),
    scene(path.join(art, 'c.png'), '0x5a8c6a', ['0xa04a6a', '0x6a6ab0', '0xc0b07a']),
  ];
  const tall = scene(path.join(art, 'tall.png'), '0x4a6f8c', ['0xc0803a', '0x5aa05a', '0x9a4ab0'], 1080, 1920);

  // The main server: no PF_RENDER_GPU, so the render host finds a launch mode with a graphics device when a frame needs one
  const hadGpuMode = process.env.PF_RENDER_GPU;
  delete process.env.PF_RENDER_GPU;
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data') });
  const { call, tx, upload, docOf, newProject, stillPng, waitJob } = client(s);
  const still = async (pid: string, index: number, variant?: string) => pngToRgb(await stillPng(pid, index, variant));
  let outputs = 0;
  const exportRun = async (pid: string, body: Record<string, unknown>) => {
    const r = await call(`/projects/${pid}/exports`, body);
    if (r.status !== 202 && r.status !== 200) return { job: { status: 'refused', error: r.body?.error ?? r.body } } as { job: any; frames?: Buffer[] };
    return { job: await waitJob(r.body.jobId) };
  };
  const exportFrames = async (pid: string, start: number, end: number, pixFmt: 'rgb24' | 'rgba' = 'rgb24') => {
    const { job } = await exportRun(pid, { range: { startFrame: start, endFrame: end } });
    if (job.status !== 'succeeded') return { job, frames: [] as Buffer[] };
    const file = path.join(art, `out-${++outputs}.mp4`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', pixFmt, '-']);
    const fb = W * H * (pixFmt === 'rgba' ? 4 : 3);
    return { job, file, frames: Array.from({ length: raw.length / fb }, (_, i) => raw.subarray(i * fb, (i + 1) * fb)) };
  };
  /** Three image clips back to back (30 frames each) on V1. */
  const threeClips = async (pid: string) => {
    const ids: string[] = [];
    for (const [i, pic] of pics.entries()) {
      const assetId = await upload(pid, pic);
      ids.push((await tx(pid, [{ op: 'add_clip', args: { assetId, start: f(30 * i), duration: f(30) } }])).results[0].output.clipId as string);
    }
    return ids;
  };
  const addAdjustment = async (pid: string, args: Record<string, unknown>) => {
    const out = (await tx(pid, [{ op: 'add_adjustment', args }])).results[0].output;
    return { adjId: out.clipId as string, fxTrackId: out.trackId as string };
  };
  const tracksOf = async (pid: string) => { const d = (await docOf(pid)).project; return d.sequences[d.mainSequenceId]!.tracks; };

  try {
    // ---------- 1. whole-edit adjustment equals the effect on each clip ----------
    const ADJUST = { type: 'color.adjust', params: { brightness: 1.15, contrast: 1.2, saturation: 0.55, hue: 25 } };
    {
      const perClip = await newProject('adjust-per-clip');
      for (const clipId of await threeClips(perClip)) await tx(perClip, [{ op: 'add_effect', args: { clipId, ...ADJUST } }]);
      const whole = await newProject('adjust-whole-edit');
      await threeClips(whole);
      await addAdjustment(whole, { span: 'edit', effects: [ADJUST] });
      const rows: unknown[] = [];
      let worst = 0;
      for (const F of [15, 45, 75]) {
        const a = await still(whole, F), b = await still(perClip, F);
        const d = maxDiff(a, b);
        worst = Math.max(worst, d);
        rows.push({ frame: F, maxDifference: d });
      }
      check('1. A whole-edit color.adjust over three full-frame clips equals the same effect on each clip: max |Δ| ≤ 1/255 over every pixel of three stills (one per clip)', worst <= 1, rows);
    }

    // ---------- 2. opacity 0.5 ----------
    {
      const pid = await newProject('adjust-opacity');
      await threeClips(pid);
      const without = await still(pid, 45);
      const { adjId } = await addAdjustment(pid, { span: 'edit', effects: [{ type: 'color.invert' }] });
      const full = await still(pid, 45);
      await tx(pid, [{ op: 'set_clip_transform', args: { clipId: adjId, transform: { opacity: 0.5 } } }]);
      const half = await still(pid, 45);
      let worst = 0;
      for (let i = 0; i < half.length; i++) worst = Math.max(worst, Math.abs(half[i]! - Math.round((full[i]! + without[i]!) / 2)));
      check('2. Opacity 0.5: every byte of the still is within 1 of round((with + without) / 2) (a whole-edit color.invert)', worst <= 1 && maxDiff(full, without) > 100, { worstDifference: worst, fullVsWithout: maxDiff(full, without) });
    }

    // ---------- 3a. outside the mask, outside the span ----------
    {
      const pid = await newProject('adjust-mask-span');
      await threeClips(pid);
      const before = new Map<number, Buffer>();
      for (const F of [10, 30, 70]) before.set(F, await still(pid, F));
      const { adjId } = await addAdjustment(pid, { span: { start: f(20), duration: f(40) }, effects: [{ type: 'color.invert' }] });
      // a rectangle half the frame wide and high in the middle: [160, 480) × [90, 270) at 640×360 (frame space, ADR-0016)
      await tx(pid, [{ op: 'set_clip_mask', args: { clipId: adjId, mask: { shape: 'rect', x: 0, y: 0, width: 0.5, height: 0.5, radius: 0, feather: 0, invert: false } } }]);
      const outside = new Uint8Array(W * H), inside = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (x < 159 || x >= 481 || y < 89 || y >= 271) outside[y * W + x] = 1; // more than one pixel from the mask edge
        if (x >= 161 && x < 479 && y >= 91 && y < 269) inside[y * W + x] = 1;
      }
      const at30 = await still(pid, 30), at10 = await still(pid, 10), at70 = await still(pid, 70);
      const outDiff = differingBytes(at30, before.get(30)!, outside), inChanged = differingBytes(at30, before.get(30)!, inside);
      const spanDiff = differingBytes(at10, before.get(10)!) + differingBytes(at70, before.get(70)!);
      check('3a. Pixels outside the mask (frame 30, inside the span) and whole frames outside the span (10 and 70): 0 differing bytes against the render without the adjustment; inside the mask the picture is inverted', outDiff === 0 && spanDiff === 0 && inChanged > 0.9 * 3 * count(inside), { outsidePixels: count(outside), outsideDifferingBytes: outDiff, framesOutsideSpanDifferingBytes: spanDiff, insideChangedBytes: inChanged, insideBytes: 3 * count(inside) });
    }

    // ---------- 3b + 4 + 5. captions and titles ----------
    let textProject = '';
    {
      const pid = (textProject = await newProject('adjust-titles'));
      const assetId = await upload(pid, pics[0]!);
      await tx(pid, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(90) } }]);
      await tx(pid, [{ op: 'add_text', args: { text: 'כותרת גדולה', start: f(0), duration: f(90), style: { color: '#FFFFFF', stroke: '#000000', sizeFrac: 0.12 } } }]);
      const cap = (await tx(pid, [{ op: 'add_caption_track', args: { mode: 'manual', style: { preset: 'classic', background: null, color: '#FFFFFF', stroke: '#000000', sizeFrac: 0.08 } } }])).results[0].output.trackId as string;
      await tx(pid, [{ op: 'add_cue', args: { trackId: cap, start: f(0), duration: f(90), text: 'כתובית שלא משתנה' } }]);
      const titleTrack = (await tracksOf(pid)).find((t) => t.kind === 'text')!.id;
      const A = await still(pid, 30);
      await tx(pid, [{ op: 'update_track', args: { trackId: titleTrack, hidden: true } }, { op: 'update_track', args: { trackId: cap, hidden: true } }]);
      const P = await still(pid, 30);
      await tx(pid, [{ op: 'update_track', args: { trackId: titleTrack, hidden: false } }, { op: 'update_track', args: { trackId: cap, hidden: false } }]);
      // the text's own pixels: drawn by a title or a caption (A ≠ P), exactly the fill or the outline colour, and with all eight
      // neighbours drawn too (the antialiased rim, which mixes with the picture below, is left out)
      const drawn = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) if (A[p * 3] !== P[p * 3] || A[p * 3 + 1] !== P[p * 3 + 1] || A[p * 3 + 2] !== P[p * 3 + 2]) drawn[p] = 1;
      const isInk = (p: number) => (A[p * 3] === 255 && A[p * 3 + 1] === 255 && A[p * 3 + 2] === 255) || (A[p * 3] === 0 && A[p * 3 + 1] === 0 && A[p * 3 + 2] === 0);
      const titleInk = new Uint8Array(W * H), captionInk = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        if (!drawn[p] || !isInk(p)) continue;
        let all = true;
        for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!drawn[p + dy * W + dx]) { all = false; break; }
        if (all) (y > H * 0.7 ? captionInk : titleInk)[p] = 1;
      }
      const { fxTrackId } = await addAdjustment(pid, { span: 'edit', effects: [{ type: 'color.invert' }] });
      const order = (await tracksOf(pid)).map((t) => t.kind);
      const B = await still(pid, 30);
      const titleDiff = differingBytes(B, A, titleInk), captionDiff = differingBytes(B, A, captionInk), pictureChanged = differingBytes(B, A);
      check('3b. Caption pixels and the pixels of a title on a track above the FX track: 0 differing bytes against the render without the adjustment (a whole-edit color.invert that changes the picture under them)', order.join() === 'video,adjustment,text,caption,audio' && count(titleInk) > 200 && count(captionInk) > 100 && titleDiff === 0 && captionDiff === 0 && pictureChanged > W * H, { trackOrder: order, titlePixels: count(titleInk), titleDifferingBytes: titleDiff, captionPixels: count(captionInk), captionDifferingBytes: captionDiff, pictureDifferingBytes: pictureChanged });
      // 4. the FX track moved above the title track: the look covers the title; captions stay last
      await tx(pid, [{ op: 'move_track', args: { trackId: fxTrackId, toIndex: 2 } }]);
      const moved = (await tracksOf(pid)).map((t) => t.kind);
      const C = await still(pid, 30);
      const titleNow = differingBytes(C, A, titleInk), captionNow = differingBytes(C, A, captionInk);
      check('4. The FX track moved above the title track: the title\'s pixels differ (> 0); the caption\'s still do not (captions are drawn last)', moved.join() === 'video,text,adjustment,caption,audio' && titleNow > 0 && captionNow === 0, { trackOrder: moved, titleDifferingBytes: titleNow, captionDifferingBytes: captionNow });
      // 5. still against exported frame
      const exp = await exportFrames(pid, 0, 60);
      const rows: { frame: number; psnr: number; ssim: number }[] = [];
      for (const F of [5, 30, 55]) { const st = await still(pid, F); const e = exp.frames[F]; rows.push({ frame: F, psnr: e ? r2(psnr(st, e)) : 0, ssim: e ? Number(ssim(st, e).toFixed(4)) : 0 }); }
      check('5. Still against the exported frame at frames 5, 30 and 55 within the parity-suite tolerance (PSNR ≥ 36 dB and SSIM ≥ 0.985)', exp.job.status === 'succeeded' && exp.frames.length === 60 && rows.every((r) => r.psnr >= 36 && r.ssim >= 0.985), { status: exp.job.status, error: exp.job.error ?? undefined, frames: exp.frames.length, rows });
    }

    // ---------- 6. undo and replay ----------
    {
      const pid = await newProject('adjust-undo');
      await threeClips(pid);
      const before = creativeProjection((await docOf(pid)).project);
      const { adjId } = await addAdjustment(pid, { span: 'edit', effects: [{ type: 'color.sepia' }, { type: 'blur.gaussian', params: { radius: 0.004 } }], label: 'Look' });
      await tx(pid, [{ op: 'set_clip_transform', args: { clipId: adjId, transform: { opacity: 0.7 } } }]);
      await tx(pid, [{ op: 'set_clip_mask', args: { clipId: adjId, mask: { shape: 'ellipse', x: 0.1, y: 0, width: 0.6, height: 0.8, radius: 0, feather: 0.02, invert: true } } }]);
      await tx(pid, [{ op: 'add_effect', args: { clipId: adjId, type: 'light.vignette' } }]);
      const edited = await docOf(pid);
      const undos: number[] = [];
      for (let i = 0; i < 4; i++) undos.push((await call(`/projects/${pid}/undo`, {})).status);
      const after = await docOf(pid);
      const replay = (await call(`/projects/${pid}?revision=${after.revision}`)).body;
      const replayEdited = (await call(`/projects/${pid}?revision=${edited.revision}`)).body;
      check('6. Undo of the four adjustment edits gives an equal creativeProjection; replaying the op log equals the live document (now and at the edited revision)', undos.every((x) => x === 200) && creativeProjection(after.project) === before && JSON.stringify(replay.project) === JSON.stringify(after.project) && JSON.stringify(replayEdited.project) === JSON.stringify(edited.project), { undoStatuses: undos, revisions: { edited: edited.revision, afterUndo: after.revision } });
    }

    // ---------- 7. a variant hides the adjustment ----------
    {
      const pid = await newProject('adjust-variant');
      await threeClips(pid);
      const variantId = (await tx(pid, [{ op: 'add_variant', args: { name: 'square', width: 360, height: 360, fit: 'cover' } }])).results[0].output.variantId as string;
      const v0 = await stillPng(pid, 45, variantId);
      const { adjId } = await addAdjustment(pid, { span: 'edit', effects: [{ type: 'color.invert' }] });
      const v1 = await stillPng(pid, 45, variantId), m1 = await stillPng(pid, 45);
      await tx(pid, [{ op: 'set_variant_override', args: { variantId, clipId: adjId, hidden: true } }]);
      const v2 = await stillPng(pid, 45, variantId), m2 = await stillPng(pid, 45);
      const sq = (b: Buffer) => pngToRgb(b, 360, 360);
      const vAgain = differingBytes(sq(v2), sq(v0)), vHad = differingBytes(sq(v1), sq(v0)), master = differingBytes(pngToRgb(m2), pngToRgb(m1));
      check('7. A variant\'s hidden override removes the adjustment in that variant\'s still only: the variant still equals its still before the adjustment (0 differing bytes), the master still keeps it (0 differing bytes from before the override)', vHad > 0 && vAgain === 0 && master === 0, { variantWithAdjustmentDiffering: vHad, variantHiddenDiffering: vAgain, masterDiffering: master });
    }

    // ---------- 8. strobes: the adjustment's and a clip's, through the one schedule ----------
    {
      const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
      const page = await browser.newPage();
      await page.goto(`${s.url}/gpu.html`);
      const adapter = await page.evaluate(async () => !!(await (navigator as any).gpu?.requestAdapter()));
      await browser.close();
      const pid = await newProject('adjust-strobes');
      const assetId = await upload(pid, pics[1]!);
      const clipId = (await tx(pid, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(120) } }])).results[0].output.clipId as string;
      await addAdjustment(pid, { span: 'edit', effects: [{ type: 'light.strobe', params: { rate: 3, amount: 0.8 } }] });
      await tx(pid, [{ op: 'add_effect', args: { clipId, type: 'light.strobe', params: { rate: 2.5, amount: 0.8 } } }]);
      const doc = (await docOf(pid)).project;
      const planned = [...new Set([...flashSchedule(doc).shown.values()].flatMap((x) => [...x]))].sort((a, b) => a - b);
      const gap = flashGapFrames(30);
      if (!adapter) {
        blocked = 'the browser gives no WebGPU adapter on this machine (see `pnpm probe:gpu`): the strobe is a GPU pass';
        check('8. BLOCKED: strobes on an adjustment and on a clip, exported (needs a WebGPU adapter in the render worker)', false, { blocked, plannedStarts: planned });
      } else {
        const { job } = await exportRun(pid, {});
        if (job.status !== 'succeeded') check('8. Strobes on an adjustment and on a clip (export)', false, { status: job.status, error: job.error });
        else {
          const file = path.join(art, 'strobes.mp4');
          fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
          const grey = ff(['-i', file, '-vf', 'scale=16:16', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
          const means: number[] = [];
          for (let k = 0; k + 256 <= grey.length; k += 256) { let sum = 0; for (let i = k; i < k + 256; i++) sum += grey[i]!; means.push(sum / 256); }
          const starts = means.flatMap((m, i) => (i > 0 && m - means[i - 1]! > 8) || (i === 0 && m > means[means.length - 1]! + 8) ? [i] : []);
          const spacing = starts.slice(1).map((x, i) => x - starts[i]!);
          const report = job.output?.photosensitivity;
          measurements.strobes = { frames: means.length, flashStarts: starts, plannedStarts: planned, smallestSpacing: spacing.length ? Math.min(...spacing) : null, flashGapFrames: gap, photosensitivity: report ? { verdict: report.verdict, ranges: report.ranges.length } : null };
          check(`8. A strobe on the adjustment (3/s) and a strobe on the clip below (2.5/s): the exported file's flash starts are at least ${gap} frames apart at 30 fps (the one schedule), they keep flashing (≥ 2 starts a second), and the export's photosensitivity check reports 0 failing ranges`, means.length === 120 && starts.length >= 8 && spacing.every((d) => d >= gap) && !!report && report.ranges.length === 0, measurements.strobes);
        }
      }
    }

    // ---------- 10. cost, recorded ----------
    {
      const configs: { name: string; effects: { type: string; params?: Record<string, unknown> }[] | null }[] = [
        { name: 'none', effects: null },
        { name: 'color.adjust', effects: [{ type: 'color.adjust', params: { brightness: 1.1, contrast: 1.1, saturation: 1.2 } }] },
        { name: 'blur.gaussian 0.01', effects: [{ type: 'blur.gaussian', params: { radius: 0.01 } }] },
        { name: 'overlay.snow', effects: [{ type: 'overlay.snow' }] },
      ];
      const rows: Record<string, unknown> = {};
      let allRan = true;
      for (const c of configs) {
        const pid = await newProject(`cost-${c.name}`, 1080, 1920);
        const assetId = await upload(pid, tall);
        await tx(pid, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(30) } }]);
        if (c.effects) await addAdjustment(pid, { span: 'edit', effects: c.effects });
        const per: number[] = [];
        for (let k = 0; k < 30; k++) {
          const { job } = await exportRun(pid, { range: { startFrame: k, endFrame: k + 1 } });
          if (job.status !== 'succeeded' || !job.output?.renderStageMs) { allRan = false; break; }
          per.push(job.output.renderStageMs.draw);
        }
        const { job: whole } = await exportRun(pid, {});
        if (whole.status !== 'succeeded') allRan = false;
        rows[c.name] = { samples: per.length, medianMs: r2(percentile(per, 0.5)), p95Ms: r2(percentile(per, 0.95)), meanOf30FrameExportMs: whole.output?.renderStageMs ? r2(whole.output.renderStageMs.draw / 30) : null };
      }
      measurements.cost = { size: '1080x1920', frames: 30, drawMsPerFrame: rows, note: 'server export, software canvas, this machine under whatever load it had; each per-frame sample is a one-frame export (one frame drawn in a fresh render page, its picture decode included); the mean is the draw stage of one 30-frame export. Recorded, not a target.' };
      check('10. Recorded (not gated): draw milliseconds per frame at 1080×1920 with no adjustment and with a whole-edit color.adjust, blur.gaussian 0.01 and overlay.snow (median and p95 over 30 frames, and a 30-frame export mean)', allRan, measurements.cost);
    }
  } finally {
    await s.close();
  }

  // ---------- 9. no adapter in the render worker ----------
  process.env.PF_RENDER_GPU = 'off';
  const s2 = await startServer({ port: PORT_OFF, dataDir: path.join(art, 'data-off') });
  try {
    const c2 = client(s2);
    const pid = await c2.newProject('adjust-grade-no-gpu');
    const assetId = await c2.upload(pid, pics[2]!);
    await c2.tx(pid, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(30) } }]);
    await c2.tx(pid, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grade', params: { exposure: 0.5 } }] } }]);
    const st = await c2.call(`/projects/${pid}/frame?index=0`);
    const j0 = await c2.call(`/projects/${pid}/exports`, {});
    const job = j0.body?.jobId ? await c2.waitJob(j0.body.jobId) : { status: 'refused', error: j0.body?.error };
    const reason = /gpu_effect_unavailable|graphics adapter/;
    check('9. color.grade on an adjustment with the render worker started without WebGPU (PF_RENDER_GPU=off): the export is refused with the adapter reason, and the still too (nothing is delivered without the effect)', (job.status === 'failed' || job.status === 'refused') && reason.test(JSON.stringify(job.error)) && st.status >= 400 && reason.test(JSON.stringify(st.body)), { exportStatus: job.status, exportError: JSON.stringify(job.error).slice(0, 300), stillStatus: st.status, stillError: JSON.stringify(st.body).slice(0, 300) });
  } finally {
    await s2.close();
    if (hadGpuMode === undefined) delete process.env.PF_RENDER_GPU; else process.env.PF_RENDER_GPU = hadGpuMode;
  }
}

main().catch((e) => { console.error(e); check('the proof ran to the end', false, { error: String(e?.stack ?? e).slice(0, 600) }); }).finally(() => {
  const failed = checks.filter((x) => !x.ok);
  const result = blocked && failed.length === 1 && failed[0]!.name.startsWith('8. BLOCKED') ? 'BLOCKED' : failed.length || checks.length === 0 ? 'FAILED' : 'PASSED';
  const report = {
    ranAt: new Date().toISOString(), result, passed: checks.length - failed.length, total: checks.length, ...(blocked ? { blocked } : {}),
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, node: process.version, ffmpeg: (() => { try { return execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0]; } catch { return null; } })() },
    scope: 'Adjustment layers (ADR-0016) through the real server on synthetic still pictures at 640x360 (1080x1920 for the cost sample): stills, exports, undo and replay, a format variant, strobes through the timeline flash schedule (software WebGPU adapter where the machine has one), a GPU effect without an adapter. Not covered: real footage, the editor preview (proof:editor-interactions), a hardware graphics adapter, the owner\'s laptop.',
    measurements, checks,
  };
  fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/evidence/adjust-proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nAdjust proof ${report.result}: ${report.passed}/${report.total}`);
  process.exitCode = result === 'PASSED' ? 0 : result === 'BLOCKED' ? 2 : 1;
});
