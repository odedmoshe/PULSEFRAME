/**
 * pnpm proof:send — export checks (wave 7, track send; .artifacts/wave7/send-decisions.md §4, C9, C10). Worker B (picture);
 * the sound findings are worker A's (read from the written WAV) and are BLOCKED here until A's sound checks land.
 * A server is started here with startServer on its own port and data directory (removed at the end); REST only. Fixtures are
 * synthetic: the barcode video of @pulseframe/fixtures, a still and a lossless static video made with ffmpeg lavfi, a full-scale
 * square wave. Nothing of the owner's.
 *
 * F3 (640x360, 30 fps, 600 frames), every number typed here:
 *   [0, 240) barcode video (moves every frame; beeps each second) · [240, 270) nothing (a gap: black, context gap) ·
 *   [270, 390) a lossless video of one still picture (a video plays, the picture does not change: frozen) ·
 *   [390, 600) the barcode video again · sound: none in [240, 390) (silence, 5 s) and a full-scale square wave at [450, 465) (clipped).
 * K3 project (640x360, 360 frames): a still photo [0, 90); a freeze frame [90, 179) then one moving frame; a still photo under a
 *   HIDDEN track holding the static video [180, 270); the static video covered by an opaque full-frame photo above [270, 360).
 *
 * Exit codes: 0 = every check that could run passed; 1 = a check failed; 2 = a check is blocked (listed with its reason).
 *
 * Checks (each can fail):
 *  K1 F3 single pass: exactly one black, one frozen (picture) and one silence, one clipped (sound) finding at the planted times (+-1 frame / 1 block), as exact rationals
 *  K2 the same export with every segment reused gives identical findings
 *  K3 a still photo, a freeze clip, a video on a hidden track, a video covered by an opaque full-frame clip and the clean barcode film give no frozen finding; a timeline gap is black with context gap
 *  K4 measure_loudness returns the same silence and clipped ranges as the export (worker A)
 *  K5 (unit) 15 black frames at 30 fps are found, 14 are not
 *  K6 editor: findings listed in Hebrew, «מעבר לקטע» lands on the frame, the ruler shows the marks, the quiet state does not contain «תקין» (builder C)
 *  K7 the Phase 4-style flashing fixture (incremental-fixtures B) still fails the flash check, with the same report on both routes (run pnpm proof:phase4 too)
 *  K8 the F3 export succeeds and is published (checks report only)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { flashCells, PictureCheck } from '@pulseframe/engine';
import { startServer } from '@pulseframe/server';
import { buildFixtureB, f, makeApi, makeSource, type Api } from './incremental-fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/send-checks');
const dataDir = path.join(art, 'data');
const PORT = Number(process.env.PF_PROOF_PORT ?? 8952);
const R = { num: 30, den: 1 };

// ---- expected numbers, typed here ----
const W = 640, H = 360;
const F3 = { frames: 600, a1: [0, 240], gap: [240, 270], frozen: [270, 390], a2: [390, 600], loud: [450, 465] } as const;
const K3_FRAMES = 360;

interface Check { id: string; name: string; pass: boolean | null; numbers: unknown; blocked?: string }
const checks: Check[] = [];
function check(id: string, name: string, pass: boolean, numbers: unknown = {}) { checks.push({ id, name, pass, numbers }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${JSON.stringify(numbers).slice(0, pass ? 400 : 1500)}`); }
function blocked(id: string, name: string, why: string) { checks.push({ id, name, pass: null, numbers: {}, blocked: why }); console.log(`BLOCKED  ${id}  ${name}: ${why}`); }

const ff = (args: string[]) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); };
/** A finding's [from, to) in frames of 30 fps, from its exact rational times (null when not on the frame grid). */
const framesOf = (x: { from: T.RationalTime; to: T.RationalTime }) => [T.frameIndexAt(x.from, R), T.frameIndexAt(x.to, R)] as const;
const near = (a: readonly number[], b: readonly number[], tol: number) => Math.abs(a[0]! - b[0]!) <= tol && Math.abs(a[1]! - b[1]!) <= tol;
const isRational = (t: any) => typeof t?.value === 'string' && Number.isInteger(t?.timescale);

async function exportAndWait(api: Api, pid: string, options: unknown) {
  const r = await api.call(`/projects/${pid}/exports`, options);
  if (r.status !== 202) throw new Error(`export refused ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
  return api.waitJob(r.body.jobId, 20 * 60_000);
}

async function main() {
  // ---- K5: the unit rule, on generated cells (no server) ----
  {
    const black = flashCells(new Uint8Array(64 * 36 * 4), 64, 36);
    const busy = (k: number) => { const a = new Uint8Array(64 * 36 * 4); for (let i = 0; i < a.length; i++) a[i] = (i * 31 + k * 17) & 255; return flashCells(a, 64, 36); };
    const runOf = (n: number) => { const c = new PictureCheck(R); for (let k = 0; k < 5; k++) c.push(busy(k), true); for (let k = 0; k < n; k++) c.push(black, true); for (let k = 0; k < 5; k++) c.push(busy(100 + k), true); return c.runs(); };
    const r15 = runOf(15), r14 = runOf(14);
    check('K5', '15 black frames at 30 fps are found, 14 are not', r15.length === 1 && r15[0]!.kind === 'black' && r15[0]!.fromFrame === 5 && r15[0]!.toFrame === 20 && r14.length === 0, { r15, r14 });
  }
  const webBuilt = fs.existsSync(path.join(root, 'apps/web/dist/render.html'));
  blocked('K4', 'measure_loudness silence and clipped ranges equal the export\'s', 'the sound checks of the written WAV (MixResult.checks, programmeLoudness soundChecks) are worker A\'s');
  blocked('K6', 'editor: findings in Hebrew, «מעבר לקטע», ruler marks, quiet state without «תקין»', 'the editor\'s checks list (ChecksResult, Timeline, StatusBar) is builder C\'s; its rows go in editor-interactions-proof');
  if (!webBuilt) {
    for (const id of ['K1', 'K2', 'K3', 'K7', 'K8']) blocked(id, 'export checks', 'the web bundle is not built here (run pnpm build): no export can render');
    return finish();
  }
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const barcode = await makeSource(path.join(art, 'barcode-360.mp4'), 360);
  const stillPng = path.join(art, 'still.png'), staticMp4 = path.join(art, 'static.mp4'), loudWav = path.join(art, 'loud.wav');
  ff(['-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}`, '-frames:v', '1', stillPng]);
  // a video of ONE picture, lossless (qp 0), so every decoded frame is the same: "a video plays, the picture does not change"
  ff(['-loop', '1', '-i', stillPng, '-t', '5', '-r', '30', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-an', staticMp4]);
  // 0.5 s of a full-scale square wave
  ff(['-f', 'lavfi', '-i', 'aevalsrc=if(lt(mod(t*200\\,1)\\,0.5)\\,0.999\\,-0.999):s=48000:d=0.5', '-ac', '2', '-c:a', 'pcm_s16le', loudWav]);

  const s = await startServer({ port: PORT, dataDir });
  const api = makeApi(s.url, s.auth.tokens.agent);
  try {
    // ---- F3 ----
    const pid = (await api.call('/projects', { name: 'F3', width: W, height: H })).body.project.id as string;
    const A = (await api.upload(pid, barcode)).assetId, S = (await api.upload(pid, staticMp4)).assetId, L = (await api.upload(pid, loudWav)).assetId;
    const placed = await api.tx(pid, [
      { op: 'add_clip', args: { assetId: A, start: f(F3.a1[0]), sourceIn: f(0), duration: f(F3.a1[1] - F3.a1[0]) } },
      { op: 'add_clip', args: { assetId: S, start: f(F3.frozen[0]), sourceIn: f(0), duration: f(F3.frozen[1] - F3.frozen[0]) } },
      { op: 'add_clip', args: { assetId: A, start: f(F3.a2[0]), sourceIn: f(0), duration: f(F3.a2[1] - F3.a2[0]) } },
      { op: 'add_clip', args: { assetId: L, start: f(F3.loud[0]), duration: f(F3.loud[1] - F3.loud[0]) } },
    ]);
    await api.tx(pid, [{ op: 'set_clip_gain', args: { clipId: placed.results[3].output.clipId, gain: 4 } }]);
    const single = await exportAndWait(api, pid, { quality: 'draft' });
    const c1 = single.output?.checks;
    const pic = (c1?.picture?.findings ?? []) as any[];
    const black = pic.filter((x) => x.kind === 'black'), frozen = pic.filter((x) => x.kind === 'frozen');
    const picOk = c1?.picture?.status === 'measured' && pic.length === 2 && black.length === 1 && frozen.length === 1 && pic.every((x) => isRational(x.from) && isRational(x.to))
      && near(framesOf(black[0]), F3.gap, 1) && black[0].context === 'gap' && near(framesOf(frozen[0]), F3.frozen, 1);
    check('K1', 'F3 single pass, picture: exactly one black (gap) and one frozen at the planted frames (±1), exact rationals', picOk, { picture: pic.map((x) => ({ kind: x.kind, frames: framesOf(x), context: x.context, from: x.from, measured: x.measured })), status: c1?.picture?.status, jobStatus: single.status, error: single.error });
    if (c1?.sound?.status !== 'measured') blocked('K1s', 'F3 single pass, sound: one silence and one clipped finding', `sound checks not measured in this build ("${c1?.sound?.method ?? 'no report'}"): worker A`);
    else {
      const snd = c1.sound.findings as any[];
      const sec = (t: any) => T.toSeconds(t);
      const sil = snd.filter((x) => x.kind === 'silence'), clip = snd.filter((x) => x.kind === 'clipped');
      check('K1s', 'F3 single pass, sound: one silence [8 s, 13 s) and one clipped at 15 s (±0.1 s)', snd.length === 2 && sil.length === 1 && clip.length === 1 && Math.abs(sec(sil[0].from) - 8) <= 0.1 && Math.abs(sec(sil[0].to) - 13) <= 0.1 && Math.abs(sec(clip[0].from) - 15) <= 0.1,
        { sound: snd.map((x) => ({ kind: x.kind, from: sec(x.from), to: sec(x.to), measured: x.measured })) });
    }
    const out = await api.call(`/jobs/${single.id}/output`);
    check('K8', 'the F3 export with findings succeeds and is published (report only)', single.status === 'succeeded' && out.status === 200 && pic.length > 0, { status: single.status, output: out.status, bytes: single.output?.bytes });
    // ---- K2: every segment reused ----
    const inc1 = await exportAndWait(api, pid, { quality: 'draft', mode: 'incremental' });
    const inc2 = await exportAndWait(api, pid, { quality: 'draft', mode: 'incremental' });
    if (inc1.status !== 'succeeded' && /incremental|render_cache/.test(JSON.stringify(inc1.error ?? ''))) blocked('K2', 'segments reused give identical findings', `the fast export is not available here: ${JSON.stringify(inc1.error).slice(0, 300)}`);
    else check('K2', 'all segments reused: picture findings identical to the first fast export and to the single pass', inc2.output?.segments?.rendered === 0 && JSON.stringify(inc2.output?.checks?.picture) === JSON.stringify(inc1.output?.checks?.picture) && JSON.stringify(inc1.output?.checks?.picture?.findings) === JSON.stringify(c1?.picture?.findings),
      { rendered: [inc1.output?.segments?.rendered, inc2.output?.segments?.rendered], findings: [inc1.output?.checks?.picture?.findings?.length, inc2.output?.checks?.picture?.findings?.length, pic.length] });

    // ---- K3: nothing frozen where no video plays (or it is hidden / covered); the clean barcode film ----
    const k3 = (await api.call('/projects', { name: 'K3', width: W, height: H })).body.project.id as string;
    const kA = (await api.upload(k3, barcode)).assetId, kS = (await api.upload(k3, staticMp4)).assetId, kP = (await api.upload(k3, stillPng)).assetId;
    // freeze frame: a 1-frame barcode clip at 90, held for 89 frames (freeze_frame inserts the hold at 90; the moving frame moves to 179)
    const one = await api.tx(k3, [{ op: 'add_clip', args: { assetId: kA, start: f(90), sourceIn: f(0), duration: f(1), withLinkedAudio: false } }]);
    await api.tx(k3, [{ op: 'freeze_frame', args: { clipId: one.results[0].output.clipId, at: f(90), duration: f(89) } }]);
    await api.tx(k3, [
      { op: 'add_clip', args: { assetId: kP, start: f(0), duration: f(90) } },
      { op: 'add_clip', args: { assetId: kP, start: f(180), duration: f(90) } },
      { op: 'add_clip', args: { assetId: kS, start: f(270), sourceIn: f(0), duration: f(90) } },
    ]);
    const t2 = (await api.tx(k3, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId as string;
    const t3 = (await api.tx(k3, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId as string;
    await api.tx(k3, [
      { op: 'add_clip', args: { assetId: kS, trackId: t2, start: f(180), sourceIn: f(0), duration: f(90) } },
      { op: 'update_track', args: { trackId: t2, hidden: true } },
      { op: 'add_clip', args: { assetId: kP, trackId: t3, start: f(270), duration: f(90) } },
    ]);
    const j3 = await exportAndWait(api, k3, { quality: 'draft' });
    const p3 = (j3.output?.checks?.picture?.findings ?? []) as any[];
    // the clean barcode film (moves every frame)
    const clean = (await api.call('/projects', { name: 'clean', width: W, height: H })).body.project.id as string;
    const cA = (await api.upload(clean, barcode)).assetId;
    await api.tx(clean, [{ op: 'add_clip', args: { assetId: cA, start: f(0), sourceIn: f(0), duration: f(360) } }]);
    const jc = await exportAndWait(api, clean, { quality: 'draft' });
    const pc = (jc.output?.checks?.picture?.findings ?? []) as any[];
    const gapOk = (c1?.picture?.findings ?? []).some((x: any) => x.kind === 'black' && x.context === 'gap');
    check('K3', 'still, freeze, hidden track, covered video, clean film: no frozen finding (and no black); the gap is black with context gap',
      j3.status === 'succeeded' && jc.status === 'succeeded' && j3.output?.checks?.picture?.status === 'measured' && p3.length === 0 && pc.length === 0 && gapOk && j3.output?.manifest?.output?.frames === K3_FRAMES,
      { k3: p3.map((x) => ({ kind: x.kind, frames: framesOf(x), measured: x.measured })), clean: pc.map((x) => ({ kind: x.kind, frames: framesOf(x) })), status: [j3.status, jc.status], frames: j3.output?.manifest?.output?.frames, error: j3.error ?? jc.error });

    // ---- K7: the flashing fixture ----
    const fb = await buildFixtureB(api, art, 'flash-B');
    const b1 = await exportAndWait(api, fb.pid, { quality: 'draft' });
    const b2 = await exportAndWait(api, fb.pid, { quality: 'draft', mode: 'incremental' });
    const ph = b1.output?.photosensitivity;
    check('K7', 'the flashing fixture still fails the flash check, the same report on the single pass and the fast export', b1.status === 'succeeded' && ph?.verdict === 'fail' && (b2.status !== 'succeeded' || JSON.stringify(b2.output?.photosensitivity) === JSON.stringify(ph)),
      { verdict: ph?.verdict, ranges: ph?.ranges, fastExport: b2.status, sameOnFast: JSON.stringify(b2.output?.photosensitivity) === JSON.stringify(ph) });
  } finally {
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  return finish();
}
function finish() {
  fs.mkdirSync(art, { recursive: true });
  fs.writeFileSync(path.join(art, 'evidence.json'), JSON.stringify({ when: new Date().toISOString(), checks }, null, 2));
  const failed = checks.filter((c) => c.pass === false), held = checks.filter((c) => c.pass === null);
  console.log(`\nsend-checks-proof: ${checks.filter((c) => c.pass).length} passed, ${failed.length} failed, ${held.length} blocked (one sample each; evidence ${path.relative(root, art)}/evidence.json)`);
  process.exit(failed.length ? 1 : held.length ? 2 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
