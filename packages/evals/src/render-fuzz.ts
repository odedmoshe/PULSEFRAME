/**
 * Render fuzz: random editing sessions (the generator of ops-fuzz) on a live server with real media, then every
 * resulting project must render — an export that succeeds, decodes without errors and has exactly the timeline's frames,
 * stills at three frames, a sound-only export, and a preflight report — and the same picture on three routes: at three frames the paused editor preview must equal the server still, and the exported frame must be close to it. A project the editor accepts must be exportable.
 *   pnpm build && pnpm conformance:render-fuzz        (PF_RENDER_FUZZ_SEEDS=10, PF_RENDER_FUZZ_STEPS=160 by default; about ten minutes)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { EASINGS, isV1Easing, KEYFRAME_OPS_BUILT } from '@pulseframe/core';
import { createFuzz } from './ops-fuzz.gen.ts';

/** The curves of ADR-0019 (keyframe curves): the dressing step puts them on picture clips so every session renders them. */
const NEW_EASINGS = EASINGS.filter((e) => !isV1Easing(e));
const CUSTOM_HANDLES = [[0.2, -0.3, 0.6, 1.4], [0.42, 0, 0.58, 1], [0.1, 0.8, 0.3, 1.2]];

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/render-fuzz');
const SEEDS = Math.max(1, Number(process.env.PF_RENDER_FUZZ_SEEDS ?? 10));
const STEPS = Math.max(1, Number(process.env.PF_RENDER_FUZZ_STEPS ?? 160)); // short sessions leave thin projects (few clips, no effects)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  // real files in the order the generator expects: video with sound, sound only, still picture, video whose picture starts late
  const video = (await generateBarcodeFixture({ out: path.join(art, 'v.mp4'), frames: 240 })).file;
  const sound = path.join(art, 'm.wav'), picture = path.join(art, 'p.png'), late = path.join(art, 'late.mkv');
  ff(['-f', 'lavfi', '-t', '10', '-i', 'sine=f=330:r=48000', '-af', 'volume=0.4', '-ac', '1', '-c:a', 'pcm_s16le', sound]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=800x600', '-frames:v', '1', picture]);
  const short = (await generateBarcodeFixture({ out: path.join(art, 'short.mp4'), frames: 120 })).file;
  ff(['-itsoffset', '0.5', '-i', short, '-i', short, '-map', '0:v', '-map', '1:a', '-c', 'copy', late]);
  const files = [video, sound, picture, late];

  const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(100); } };
  const rows: any[] = [];
  // the editor's browser gets WebGPU as the render worker's does (apps/renderer index.ts, default mode): without it the preview
  // draws GPU effects (color.grade among them) as unavailable while the server still has them, and the routes cannot agree
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  { const k = await context.newPage(); await k.goto(s.ownerUrl); await k.waitForTimeout(400); await k.close(); } // owner session cookie for the editor pages
  try {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const fz = createFuzz(seed);
      const rate = fz.rate;
      const row: any = { seed, rate: `${rate.num}/${rate.den}` };
      rows.push(row);
      const pid = (await call('/projects', { name: `render-fuzz-${seed}`, width: 640, height: 360, frameRate: rate })).body.project.id;
      for (const file of files) await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json();
      const doc = async () => (await call(`/projects/${pid}`)).body.project;
      const setup = await call(`/projects/${pid}/transactions`, { ops: fz.setup(await doc()) });
      if (setup.status !== 200) throw new Error(`seed ${seed}: set-up failed: ${JSON.stringify(setup.body).slice(0, 300)}`);
      let accepted = 0, refused = 0;
      const ops: string[] = [];
      for (let step = 0; step < STEPS; step++) {
        const op = fz.gen(await doc());
        const r = await call(`/projects/${pid}/transactions`, { ops: [op] });
        if (r.status === 200) { accepted++; ops.push(op.op); }
        else if (r.status >= 500) throw new Error(`seed ${seed} step ${step}: server error on ${JSON.stringify(op).slice(0, 200)}: ${JSON.stringify(r.body).slice(0, 200)}`);
        else refused++;
      }
      // Dressing: transitions rarely survive a random session, so before rendering try one on every picture clip that
      // touches the clip before it, and put an effect, a mask and a blend mode on some clips. Refusals are fine.
      {
        const d0 = await doc();
        let dressed = 0, curved = 0;
        const curveRefusals: string[] = [];
        const fIdx0 = (t: T.RationalTime) => T.frameIndexAt(t, rate);
        for (const t of d0.sequences.seq_main.tracks.filter((x: any) => x.kind === 'video')) {
          const sorted = [...t.clips].sort((x: any, y: any) => T.cmp(x.start, y.start));
          for (let i = 1; i < sorted.length; i++) {
            if (!T.eq(T.add(sorted[i - 1].start, sorted[i - 1].duration), sorted[i].start)) continue;
            const type = ['dissolve', 'dip-black', 'wipe-left', 'push-left'][(seed + i) % 4];
            if ((await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_transition', args: { clipId: sorted[i].id, type, frames: 4 + ((seed + i) % 8) } }] })).status === 200) dressed++;
          }
          for (const [i, c] of sorted.entries()) {
            if (i % 3 === 0) {
              const type = ['blur.gaussian', 'color.grayscale', 'light.vignette'][(seed + i) % 3];
              const r = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_effect', args: { clipId: c.id, type } }] });
              // a refusal for a reason the session made (a locked track) is fine; any other refusal of a valid effect id is a fault
              if (r.status !== 200 && r.body?.error?.code !== 'track_locked') throw new Error(`seed ${seed}: adding ${type} to ${c.id} was refused: ${JSON.stringify(r.body).slice(0, 300)}`);
            }
            if (i % 4 === 1 && c.type === 'media') await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_mask', args: { clipId: c.id, mask: { shape: 'ellipse', x: 0, y: 0, width: 0.7, height: 0.7, feather: 0.1, invert: false } } }] });
            if (i % 5 === 2) await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_blend', args: { clipId: c.id, mode: 'screen' } }] });
            // keyframe curves (ADR-0019): x, scale and rotation over the first half of the clip with the new curves (opacity keeps
            // the v1 ones: turn-back curves are refused there by the flash rule). A refusal (a locked track) is fine.
            const len = fIdx0(c.duration);
            if (KEYFRAME_OPS_BUILT && len >= 4) {
              const at = (k: number) => T.frameTime(k, rate);
              const e = (k: number) => NEW_EASINGS[(seed + i + k) % NEW_EASINGS.length]!;
              const key = (property: string, k: number, value: number, easing: string) => ({ op: 'set_keyframe', args: { clipId: c.id, property, time: at(k), value, easing, ...(easing === 'bezier' ? { bezier: CUSTOM_HANDLES[(seed + i + k) % CUSTOM_HANDLES.length] } : {}) } });
              const mid = Math.floor(len / 2);
              const r = await call(`/projects/${pid}/transactions`, { ops: [
                key('x', 0, -0.2, e(0)), key('x', mid, 0.2, 'linear'),
                key('scale', 0, 0.8, e(1)), key('scale', mid, 1.1, 'linear'),
                key('rotation', 0, 0, e(2)), key('rotation', mid, 12, 'linear'),
              ] });
              // a refusal the session made (a locked track, a clip that takes no transform keys) is fine and counted; a curve
              // rule refusing these allowed curves (invalid_args) is a fault
              if (r.status === 200) curved++;
              else if (r.body?.error?.code === 'invalid_args') throw new Error(`seed ${seed}: curve keys on ${c.id} were refused: ${JSON.stringify(r.body).slice(0, 300)}`);
              else curveRefusals.push(String(r.body?.error?.code ?? r.status));
            }
          }
        }
        row.dressing = { transitionsAdded: dressed, clipsWithCurves: curved, curveRefusals };
      }
      // one version for an audience (wave 8 audiences), calm or grandparents by seed: step 5 renders its still like every linked format
      const aud = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_audience_version', args: { profile: seed % 2 ? 'grandparents' : 'calm' } }] });
      row.audienceVersion = aud.status === 200 ? { profile: seed % 2 ? 'grandparents' : 'calm', variantId: aud.body.results?.[0]?.output?.variantId ?? null } : { refused: aud.body?.error?.code ?? aud.status };
      const d = await doc();
      const tl = (await call(`/projects/${pid}/timeline`)).body;
      const frames = T.frameIndexAt(tl.duration, rate);
      const clips = d.sequences.seq_main.tracks.flatMap((t: any) => t.clips);
      row.session = { accepted, refused, clips: clips.length, frames, seconds: Number(T.toSeconds(tl.duration).toFixed(2)), formats: Object.keys(d.variants ?? {}).length, effects: clips.reduce((n: number, c: any) => n + (c.effects?.length ?? 0), 0), freezes: clips.filter((c: any) => c.freeze).length, sped: clips.filter((c: any) => c.speed).length, transitions: clips.filter((c: any) => c.transition).length, masks: clips.filter((c: any) => c.mask).length, blends: clips.filter((c: any) => c.blend && c.blend !== 'normal').length, captions: clips.filter((c: any) => c.type === 'caption').length, titles: clips.filter((c: any) => c.type === 'text').length };
      const problems: string[] = [];
      if (row.audienceVersion?.refused) problems.push(`audience version refused: ${row.audienceVersion.refused}`);
      if (frames < 1) { row.outcome = 'empty-timeline (nothing to render)'; continue; }
      // 1. preflight answers
      const pre = await call(`/projects/${pid}/preflight`);
      if (pre.status !== 200) problems.push(`preflight ${pre.status}`);
      row.preflight = pre.status === 200 ? { blockers: pre.body.blockers, warnings: pre.body.warnings } : null;
      // 2. stills at the first, a middle and the last frame
      for (const i of [0, Math.floor(frames / 2), frames - 1]) { const st = await call(`/projects/${pid}/frame?index=${i}`); if (st.status !== 200) problems.push(`still ${i}: ${st.body?.error?.code ?? st.status}`); }
      // 3. picture + sound export: succeeds, decodes without errors, has exactly the timeline's frames.
      // A title with a live field the project cannot fill (no capture date, a person removed since) is an honest preflight
      // blocker (ADR-0021), and a person's age needs the people scope this agent credential lacks: both refusals are by design.
      // Each must be the refusal preflight announced; the titles are then made plain text, and the export must succeed.
      let started = await call(`/projects/${pid}/exports`, { quality: 'high' });
      const fieldBlockers = ((pre.body?.issues ?? []) as { code: string; severity: string; ids?: string[] }[]).filter((x) => x.severity === 'blocker' && x.code === 'field_no_data');
      const byDesign = started.status === 422 && started.body?.error?.code === 'render_blocked' && (started.body.error.details?.blockers ?? []).every((b: { code: string }) => b.code === 'field_no_data')
        || started.status === 403 && started.body?.error?.code === 'people_scope_required';
      if (byDesign) {
        if (!fieldBlockers.length) problems.push(`export refused ${started.body.error.code}, but preflight announced no field blocker`);
        row.fieldTitlesMadePlain = { refusal: started.body.error.code, titles: fieldBlockers.flatMap((b) => b.ids ?? []) };
        for (const id of new Set(fieldBlockers.flatMap((b) => b.ids ?? []))) {
          const r = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'update_text', args: { clipId: id, text: 'plain' } }, { op: 'set_text_fields', args: { clipId: id, enabled: false } }] });
          if (r.status !== 200) problems.push(`title ${id} could not be made plain text: ${r.body?.error?.code}`);
        }
        started = await call(`/projects/${pid}/exports`, { quality: 'high' });
      }
      if (started.status >= 400) problems.push(`export refused: ${started.body?.error?.code}`);
      else {
        const job = await waitJob(started.body.jobId);
        if (job.status !== 'succeeded') problems.push(`export ${job.status}: ${String(job.error?.message ?? job.error?.code).slice(0, 160)}`);
        else {
          const out = path.join(art, `seed-${seed}.mp4`);
          fs.writeFileSync(out, (await call(`/jobs/${job.id}/output`)).body);
          let decodeError = '';
          try { execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', out, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e: any) { decodeError = String(e.stderr ?? e).slice(0, 160); }
          const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_packets', out], { encoding: 'utf8' }));
          const vs = probe.streams.find((x: any) => x.codec_type === 'video'), as = probe.streams.find((x: any) => x.codec_type === 'audio');
          row.export = { frames: Number(vs?.nb_read_packets), rate: vs?.r_frame_rate, videoSeconds: Number(Number(vs?.duration).toFixed(3)), audioSeconds: as ? Number(Number(as.duration).toFixed(3)) : null, bytes: fs.statSync(out).size };
          if (decodeError) problems.push(`exported file does not decode cleanly: ${decodeError}`);
          if (Number(vs?.nb_read_packets) !== frames) problems.push(`frame count ${vs?.nb_read_packets} ≠ timeline ${frames}`);
          const [rn, rd] = String(vs?.r_frame_rate).split('/').map(Number);
          if (rn! * rate.den !== rd! * rate.num) problems.push(`frame rate ${vs?.r_frame_rate}`);
          if (as && Math.abs(Number(as.duration) - Number(vs.duration)) > rate.den / rate.num + 0.03) problems.push(`picture ${vs.duration}s and sound ${as.duration}s differ in length`);
          row._export = out;
        }
      }
      // 4. sound-only export
      const wj = await call(`/projects/${pid}/exports`, { format: 'wav' });
      if (wj.status < 400) { const j = await waitJob(wj.body.jobId); if (j.status !== 'succeeded') problems.push(`sound export ${j.status}: ${String(j.error?.message ?? j.error?.code).slice(0, 120)}`); }
      else problems.push(`sound export refused: ${wj.body?.error?.code}`);
      // 5. every linked format renders a still
      for (const v of Object.keys(d.variants ?? {})) { const st = await call(`/projects/${pid}/frame?index=${Math.floor(frames / 2)}&variant=${v}`); if (st.status !== 200) problems.push(`format ${v} still: ${st.body?.error?.code ?? st.status}`); }
      // 6. one picture on three routes: the server still, the same frame of the export, and the paused editor preview
      if (row._export && !problems.length) {
        const W = 640, H = 360, n = W * H * 3;
        // Frames that actually contain a picture: a black frame agrees with itself on every route and proves nothing.
        const level = (buf: Buffer) => { let sum = 0; for (let k = 0; k < buf.length; k += 97) sum += buf[k]!; return sum / Math.ceil(buf.length / 97); };
        const stillOf = async (i: number) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'image2pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: (await call(`/projects/${pid}/frame?index=${i}`)).body as Buffer, maxBuffer: 1 << 28 });
        const stills = new Map<number, Buffer>();
        // What is on the picture tracks at a frame, so the evidence says which features the compared frames actually exercised.
        const fIdx = (t: T.RationalTime) => T.frameIndexAt(t, rate);
        const vclips = d.sequences.seq_main.tracks.filter((x: any) => x.kind === 'video' && !x.hidden).flatMap((x: any) => x.clips).filter((c: any) => c.type === 'media');
        const featuresAt = (i: number): string[] => {
          const out = new Set<string>();
          for (const c of vclips) {
            const a = fIdx(c.start), b = a + fIdx(c.duration);
            if (i < a || i >= b) continue;
            if (c.reverse) out.add('reverse');
            if (c.speed) out.add('speed');
            if (c.freeze) out.add('freeze');
            if (c.effects?.some((e: any) => e.enabled)) out.add('effect');
            if (c.mask) out.add('mask');
            if (c.blend) out.add('blend');
            if (c.keyframes) out.add('keyframes');
            if (Object.values(c.keyframes ?? {}).some((ks: any) => ks?.some((k: any) => !isV1Easing(k.easing)))) out.add('curves');
            if (c.transition && i < a + c.transition.frames) out.add('transition');
          }
          return [...out].sort();
        };
        row.features = { videoClips: vclips.length, reversed: vclips.filter((c: any) => c.reverse).length, speedChanged: vclips.filter((c: any) => c.speed).length, freezeFrames: vclips.filter((c: any) => c.freeze).length, withEffects: vclips.filter((c: any) => c.effects?.length).length, withTransition: vclips.filter((c: any) => c.transition).length };
        // First the middle of up to two clips with a time-mapping feature (reverse, speed, freeze), so these are compared whenever they exist.
        for (const c of vclips.filter((c: any) => c.reverse || c.speed || c.freeze).sort((x: any, y: any) => Number(!!y.reverse) - Number(!!x.reverse)).slice(0, 2)) {
          const i = Math.min(frames - 1, fIdx(c.start) + Math.floor(fIdx(c.duration) / 2));
          if (stills.has(i)) continue;
          const st = await stillOf(i);
          if (level(st) > 0.6) stills.set(i, st);
        }
        // …and the middle of up to two transitions (the dressing step above adds them where two picture clips touch).
        for (const c of vclips.filter((c: any) => c.transition).slice(0, 2)) {
          const i = Math.min(frames - 1, fIdx(c.start) + Math.floor(c.transition.frames / 2));
          if (stills.has(i)) continue;
          const st = await stillOf(i);
          if (level(st) > 0.6) stills.set(i, st);
        }
        // …and a frame inside the curved first half of up to two clips (ADR-0019: the new curves on the three routes).
        for (const c of vclips.filter((c: any) => Object.values(c.keyframes ?? {}).some((ks: any) => ks?.some((k: any) => !isV1Easing(k.easing)))).slice(0, 2)) {
          const i = Math.min(frames - 1, fIdx(c.start) + Math.max(1, Math.floor(fIdx(c.duration) / 5)));
          if (stills.has(i)) continue;
          const st = await stillOf(i);
          if (level(st) > 0.6) stills.set(i, st);
        }
        const wantFrames = stills.size + 3;
        for (const q of [0.5, 0.2, 0.8, 0.35, 0.65, 0.1, 0.9, 0.05, 0.95, 0.27, 0.43, 0.58, 0.73]) {
          const i = Math.min(frames - 1, Math.floor(frames * q));
          if (stills.has(i)) continue;
          const st = await stillOf(i);
          if (level(st) > 0.6) stills.set(i, st); // anything but a black frame: titles on black count
          if (stills.size >= wantFrames) break;
        }
        const targets = [...stills.keys()];
        row.pictureFramesCompared = targets.length;
        const ep = await context.newPage();
        const errs: string[] = [];
        ep.on('pageerror', (e) => errs.push(String(e)));
        const parity: any[] = [];
        try {
          await ep.goto(`${s.url}/?project=${pid}`);
          await ep.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
          for (const i of targets) {
            const still = stills.get(i)!;
            const exported = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', row._export, '-vf', `select=eq(n\\,${i})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
            await ep.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); }, ((i * rate.den) / rate.num) * 90 + 0.5);
            const painted = await ep.waitForFunction((t) => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return cv?.dataset.frame === String(t) && cv?.dataset.quality === 'full'; }, i, { timeout: 20000 }).then(() => true, () => false);
            const b64 = await ep.evaluate(() => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data; const out = new Uint8Array((d.length / 4) * 3); for (let p = 0, q = 0; p < d.length; p += 4) { out[q++] = d[p]!; out[q++] = d[p + 1]!; out[q++] = d[p + 2]!; } let str = ''; for (let k = 0; k < out.length; k += 0x8000) str += String.fromCharCode(...out.subarray(k, k + 0x8000)); return { w: cv.width, h: cv.height, data: btoa(str) }; });
            const preview = Buffer.from(b64.data, 'base64');
            const mad = (x: Buffer, y: Buffer) => { if (x.length !== n || y.length !== n) return 999; let sum = 0; for (let k = 0; k < n; k++) sum += Math.abs(x[k]! - y[k]!); return Number((sum / n).toFixed(2)); };
            const worst = (x: Buffer, y: Buffer) => { if (x.length !== n || y.length !== n) return 999; let m = 0; for (let k = 0; k < n; k++) { const dd = Math.abs(x[k]! - y[k]!); if (dd > m) m = dd; } return m; };
            parity.push({ frame: i, features: featuresAt(i), stillMeanLevel: Number(level(still).toFixed(1)), painted, previewSize: `${b64.w}x${b64.h}`, previewVsStill: { mean: mad(preview, still), worst: worst(preview, still) }, exportVsStill: { mean: mad(exported, still) } });
          }
        } catch (e) { problems.push(`parity check did not run: ${String(e).slice(0, 140)}`); }
        finally { await ep.close(); fs.rmSync(row._export, { force: true }); }
        row.parity = parity;
        // the preview and the still are the same code and both lossless: they must agree almost exactly; the export is lossy H.264
        if (parity.some((p) => !p.painted)) problems.push('preview did not paint a requested frame');
        if (parity.some((p) => p.previewVsStill.mean > 0.5)) problems.push(`preview differs from the server still (mean difference ${Math.max(...parity.map((p) => p.previewVsStill.mean))} of 255)`);
        if (parity.some((p) => p.exportVsStill.mean > 6)) problems.push(`exported frame differs from the server still (mean difference ${Math.max(...parity.map((p) => p.exportVsStill.mean))} of 255)`);
        if (errs.length) problems.push(`page error in the editor: ${errs[0]!.slice(0, 120)}`);
      }
      delete row._export;
      row.outcome = problems.length ? `FAILED (${problems.length})` : 'renders';
      if (problems.length) { row.problems = problems; row.ops = ops; }
      console.log(`seed ${String(seed).padStart(2)} ${row.rate.padEnd(11)} ${String(row.outcome).padEnd(12)} ${JSON.stringify(row.session)}${row.parity ? `\n     parity (frame: preview≈still mean/worst, export≈still mean): ${row.parity.map((p: any) => `${p.frame}: ${p.previewVsStill.mean}/${p.previewVsStill.worst}, ${p.exportVsStill.mean}`).join('  ')}` : ''}${problems.length ? `\n     ${problems.join('\n     ')}` : ''}`);
    }
    const bad = rows.filter((r) => /^FAILED/.test(String(r.outcome)));
    const rendered = rows.filter((r) => r.outcome === 'renders');
    const compared = rendered.reduce((k, r) => k + (r.pictureFramesCompared ?? 0), 0);
    const byFeature: Record<string, number> = {};
    for (const r of rendered) for (const pz of r.parity ?? []) for (const ft of pz.features ?? []) byFeature[ft] = (byFeature[ft] ?? 0) + 1;
    check(`every project produced by a random editing session renders: stills, picture+sound export with exactly the timeline's frames, sound-only export, preflight, linked formats (${rendered.length} of ${rows.length} sessions rendered; ${rows.length - rendered.length - bad.length} had an empty timeline)`, bad.length === 0 && rendered.length > 0, bad.map((r) => ({ seed: r.seed, rate: r.rate, problems: r.problems, session: r.session })));
    check(`on the rendered projects the paused editor preview equals the server still (mean difference ≤ 0.5 of 255) and the exported frame is close to it (≤ 6) at frames that contain a picture (${compared} frames compared in ${rendered.filter((r) => r.pictureFramesCompared).length} projects; frames per feature on the picture: ${JSON.stringify(byFeature)})`, compared >= rendered.length && bad.length === 0, rendered.map((r) => ({ seed: r.seed, frames: (r.parity ?? []).map((p: any) => ({ frame: p.frame, level: p.stillMeanLevel, preview: p.previewVsStill, export: p.exportVsStill.mean })) })));
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: `${SEEDS} random sessions of ${STEPS} steps each, at five frame rates, on synthetic media. Checks that rendering succeeds and has the right shape (frame count, rate, clean decode, equal picture and sound length); it checks that the preview, the server still and the export AGREE on the picture at three frames per project; it does NOT check against an independent reference that the picture or the sound is the right one.`, passed: checks.length - failed.length, total: checks.length, rows, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/render-fuzz.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nRender fuzz ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
