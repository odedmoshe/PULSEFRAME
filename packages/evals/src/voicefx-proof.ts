/**
 * Sound effects «אפקטי קול» (ADR-0010) on the export routes: checks A, B, C, E, F, G, H and the manifest part of J of the plan
 * (.artifacts/audio-plan.md section 9). CPU only: ffmpeg and headless Chromium. Every signal is synthetic (ffmpeg lavfi); every
 * number below is measured on what the routes produced. Nobody has listened to these effects: nothing here says they sound right.
 *
 *   A  server WAV per effect: the section-4 measurements, taken on the decoded export (or, where a measurement needs floats
 *      below 16-bit resolution, on the same server mix in floating point, mixToRaw, which is what export encodes)
 *   B  a range equals the same part of the full export for every effect (bit-exact inside the warm-up)
 *   C  browser export against server export (onsets, third-octave levels, residual of linear effects, radio crackle, range)
 *   E  sync over 60 s with telephone + echo; a reversed clip with reverb is mirrored
 *   F  loudness target with bass boost; measure_loudness equals the export's own measurement
 *   G  cutting clips with effects (mid-clip, and in the middle of a reverb tail) does not change the sound
 *   H  null tests: disabled, amount 0, width 1 + 2^-20
 *   J  the export manifest lists the effect versions; an effect this build cannot run blocks the export
 *
 *   pnpm build && tsx packages/evals/src/voicefx-proof.ts
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import * as T from '@pulseframe/time';
import { timeOriginSeconds, type ProjectDocument } from '@pulseframe/core';
import { AUDIO_FX_ENGINE, audioPlan, chainReach } from '@pulseframe/engine';
import { startServer, type RunningServer } from '@pulseframe/server';
import { mixToRaw } from '@pulseframe/server/audiomix.ts';
import { Exporter } from '@pulseframe/server/export.ts';
import { goertzel, makeFxFixtures, onsets, schroederRt60, thirdOctaveLevelsDb } from './voicefx-fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/voicefx');
const SR = 48000, FPS = { num: 30, den: 1 }, SPF = SR / 30; // samples per frame
const f = (n: number) => T.frameTime(n, FPS);
const LSB = 1 / 32768;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 30 });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const measurements: Record<string, unknown> = {};
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 600)}` : ''}`); };
const r3 = (x: number) => Number(x.toFixed(3));
const dB = (x: number) => 20 * Math.log10(Math.max(1e-12, x));

// ---- signals ---------------------------------------------------------------------------------------------------------
/** Interleaved stereo float PCM of a file at its own rate (16-bit WAV samples become v/32768 exactly). */
const pcmOf = (file: string, rate?: number) => { const b = ff(['-i', file, '-f', 'f32le', '-ac', '2', ...(rate ? ['-ar', String(rate)] : []), '-']); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const channel = (x: Float32Array, ch: 0 | 1, from = 0, to = x.length / 2) => { const o = new Float32Array(Math.max(0, to - from)); for (let i = from; i < to; i++) o[i - from] = x[i * 2 + ch]!; return o; };
const rms = (x: Float32Array, from: number, to: number) => { let s = 0; for (let i = from * 2; i < to * 2; i++) s += x[i]! * x[i]!; return Math.sqrt(s / Math.max(1, (to - from) * 2)); };
const amp = (x: Float32Array, hz: number, at: number, win: number, ch: 0 | 1 = 0) => goertzel(x, ch, hz, at, SR, win);
const maxDiff = (a: Float32Array, aFrom: number, b: Float32Array, bFrom: number, frames: number) => { let m = 0; for (let i = 0; i < frames * 2; i++) m = Math.max(m, Math.abs((a[aFrom * 2 + i] ?? 0) - (b[bFrom * 2 + i] ?? 0))); return m; };
const identical = (a: Float32Array, aFrom: number, b: Float32Array, bFrom: number, frames: number) => { for (let i = 0; i < frames * 2; i++) if (!Object.is(a[aFrom * 2 + i], b[bFrom * 2 + i])) return false; return true; };
const peakOf = (x: Float32Array, from = 0, to = x.length / 2) => { let m = 0; for (let i = from * 2; i < to * 2; i++) m = Math.max(m, Math.abs(x[i]!)); return m; };
const corr = (x: Float32Array, from: number, to: number) => {
  let sl = 0, sr = 0, sll = 0, srr = 0, slr = 0;
  const n = to - from;
  for (let i = from; i < to; i++) { const l = x[i * 2]!, r = x[i * 2 + 1]!; sl += l; sr += r; sll += l * l; srr += r * r; slr += l * r; }
  return (slr - (sl * sr) / n) / Math.sqrt(Math.max(1e-30, (sll - (sl * sl) / n) * (srr - (sr * sr) / n)));
};
/** RBJ band-pass (0 dB peak), for the high-frequency reverberation time. */
function bandpass(x: Float32Array, f0: number, q: number): Float32Array {
  const w = (2 * Math.PI * f0) / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i]! + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]!; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
/** |H| in dB of an RBJ peaking filter (the megaphone's horn peak as the plan specifies it). */
function peakingDb(fHz: number, f0: number, q: number, gainDb: number): number {
  const A = 10 ** (gainDb / 40), w0 = (2 * Math.PI * f0) / SR, al = Math.sin(w0) / (2 * q), c = Math.cos(w0);
  const b = [1 + al * A, -2 * c, 1 - al * A], a = [1 + al / A, -2 * c, 1 - al / A];
  const w = (2 * Math.PI * fHz) / SR;
  const ev = (k: number[]) => { const re = k[0]! + k[1]! * Math.cos(w) + k[2]! * Math.cos(2 * w), im = -k[1]! * Math.sin(w) - k[2]! * Math.sin(2 * w); return Math.hypot(re, im); };
  return dB(ev(b) / ev(a));
}
/** Click positions (left channel): where the sample-to-sample step exceeds `thr` (default 8× its median), at least 200 samples apart. */
function crackleThreshold(x: Float32Array, from: number, to: number): number {
  const d = new Float32Array(to - from - 1);
  for (let n = from + 1; n < to; n++) d[n - from - 1] = Math.abs(x[n * 2]! - x[(n - 1) * 2]!);
  return Math.max(8 * d.sort()[d.length >> 1]!, 1e-4);
}
function crackles(x: Float32Array, from: number, to: number, thr = crackleThreshold(x, from, to)): number[] {
  const d = new Float32Array(to - from - 1);
  for (let n = from + 1; n < to; n++) d[n - from - 1] = Math.abs(x[n * 2]! - x[(n - 1) * 2]!);
  const out: number[] = [];
  let last = -1e9;
  for (let i = 0; i < d.length; i++) { const n = from + 1 + i; if (d[i]! > thr && n - last > 200) { out.push(n); last = n; } }
  return out;
}
// tone steps: 100 steps of 0.2 s, 50 Hz · 2^(i/12) (50 Hz .. 15.7 kHz), at -20 dBFS
const STEP = 0.2, STEPS = 100;
const stepHz = (i: number) => 50 * 2 ** (i / 12);
/** Response in dB (wet over dry) at each step, from the steady middle of the step. */
const response = (wet: Float32Array, dry: Float32Array) => Array.from({ length: STEPS }, (_, i) => dB(amp(wet, stepHz(i), i * STEP + 0.04, 0.12) / amp(dry, stepHz(i), i * STEP + 0.04, 0.12)));
const respAt = (resp: number[], hz: number) => { const x = 12 * Math.log2(hz / 50), i = Math.min(STEPS - 2, Math.max(0, Math.floor(x))), t = x - i; return resp[i]! + (resp[i + 1]! - resp[i]!) * t; };
/** −3 dB points relative to the largest response between refLo and refHi Hz (interpolated in log frequency). */
function edges(resp: number[], refLo: number, refHi: number) {
  let ref = -Infinity;
  for (let i = 0; i < STEPS; i++) if (stepHz(i) >= refLo && stepHz(i) <= refHi) ref = Math.max(ref, resp[i]!);
  const lvl = ref - 3;
  const cross = (i: number, j: number) => stepHz(i) * 2 ** (((lvl - resp[i]!) / (resp[j]! - resp[i]!)) * ((j - i) / 12));
  let lo = NaN, hi = NaN;
  for (let i = 1; i < STEPS; i++) if (resp[i]! >= lvl && resp[i - 1]! < lvl) { lo = cross(i - 1, i); break; }
  for (let i = STEPS - 2; i >= 0; i--) if (resp[i]! >= lvl && resp[i + 1]! < lvl) { hi = cross(i, i + 1); break; }
  return { ref: r3(ref), lo: r3(lo), hi: r3(hi) };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fxDir = path.join(art, 'fixtures');
  const std = await makeFxFixtures(fxDir);
  const gen = (name: string, l: string, r: string, seconds: number) => { const file = path.join(fxDir, `${name}.wav`); ff(['-f', 'lavfi', '-i', `aevalsrc=${l}|${r}:s=48000:d=${seconds}`, '-c:a', 'pcm_f32le', file]); return file; };
  const steps = (() => { const e = '0.1*sin(2*PI*50*pow(2\\,floor(t/0.2)/12)*t)'; return gen('steps', e, e, STEPS * STEP); })();
  const tones = (() => { const e = '0.05*if(lt(t\\,3)\\,sin(2*PI*30*t)\\,sin(2*PI*2000*t))'; return gen('tones', e, e, 6); })();
  const tone1k = gen('tone1k', '0.5*sin(2*PI*1000*t)', '0.5*sin(2*PI*1000*t)', 4);
  const tone1kLow = gen('tone1kLow', '0.1*sin(2*PI*1000*t)', '0.1*sin(2*PI*1000*t)', 8);
  const tone1kRobot = gen('tone1kRobot', '0.25*sin(2*PI*1000*t)', '0.25*sin(2*PI*1000*t)', 3);
  const dc = gen('dc', '0.5', '0.5', 3);
  const silence = gen('silence', '0', '0', 10);
  const wide = gen('wide', '0.3*sin(2*PI*440*t)', '0.3*sin(2*PI*660*t)', 10);
  // mostly 1 kHz with a little 100 Hz: after the boost the loudness target is reached without touching the true-peak ceiling
  const loud = gen('loud', '0.02*sin(2*PI*100*t)+0.1*sin(2*PI*1000*t)', '0.02*sin(2*PI*100*t)+0.1*sin(2*PI*1000*t)', 8);
  const beeps60 = (() => { const e = 'if(lt(mod(t\\,2)\\,0.05)\\,0.5*sin(2*PI*1000*t)\\,0)'; return gen('beeps60', e, e, 60); })();

  const s: RunningServer = await startServer({ port: 8857, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction refused: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const newProject = async (name: string) => (await call('/projects', { name, width: 320, height: 180 })).body.project.id as string;
  const assetsOf = new Map<string, Map<string, string>>(); // project -> file -> asset id
  const upload = async (pid: string, file: string) => {
    const m = assetsOf.get(pid) ?? new Map<string, string>();
    assetsOf.set(pid, m);
    if (m.has(file)) return m.get(file)!;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json();
    if (!up.assetId) throw new Error(`upload failed: ${JSON.stringify(up).slice(0, 300)}`);
    m.set(file, up.assetId);
    return up.assetId as string;
  };
  const addTrack = async (pid: string, name: string) => (await tx(pid, [{ op: 'add_track', args: { kind: 'audio', name } }])).results[0].output.trackId as string;
  /** A clip of `file` on a new track: start and duration in frames, source offset in frames. */
  const addClip = async (pid: string, file: string, start: number, duration?: number, sourceIn?: number) => {
    const assetId = await upload(pid, file);
    const trackId = await addTrack(pid, path.basename(file));
    const out = (await tx(pid, [{ op: 'add_clip', args: { assetId, trackId, start: f(start), ...(duration !== undefined ? { duration: f(duration) } : {}), ...(sourceIn !== undefined ? { sourceIn: f(sourceIn) } : {}) } }])).results[0].output;
    return (out.audioClipId ?? out.clipId) as string;
  };
  const addFx = async (pid: string, clipId: string, type: string, params: Record<string, unknown> = {}) => (await tx(pid, [{ op: 'add_audio_effect', args: { clipId, type, params } }])).results[0].output.effects[0].effectId as string;
  const setFx = async (pid: string, clipId: string, effectId: string, patch: { params?: Record<string, unknown>; enabled?: boolean }) => tx(pid, [{ op: 'update_audio_effect', args: { clipId, effectId, ...patch } }]);
  const docOf = async (pid: string) => (await call(`/projects/${pid}`)).body.project as ProjectDocument;
  const exportJob = async (pid: string, name: string, options: Record<string, unknown> = {}) => {
    const r = await call(`/projects/${pid}/exports`, { format: 'wav', ...options });
    if (!r.body.jobId) throw new Error(`export refused: ${JSON.stringify(r.body).slice(0, 400)}`);
    let job: any;
    for (;;) { job = (await call(`/jobs/${r.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
    if (job.status !== 'succeeded') throw new Error(`export ${job.status}: ${JSON.stringify(job.error)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${r.body.jobId}/output`)).body);
    return { file, job };
  };
  const exportPcm = async (pid: string, name: string, options: Record<string, unknown> = {}) => pcmOf((await exportJob(pid, name, options)).file);
  const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  /** The server mix of the current document in floating point (the same mixToRaw export encodes to 16-bit). */
  const floatMix = async (pid: string) => {
    const d = await docOf(pid);
    const plan = audioPlan(d);
    const raw = path.join(art, `float_${pid}_${Date.now()}.f32`);
    await mixToRaw(plan, (id) => s.store.blobPath(d.assets[id]!.contentHash), 0, plan.totalSamples, raw, undefined, (id) => timeOriginSeconds(d.assets[id]), (id) => d.assets[id]?.audio?.channels === 1);
    const b = fs.readFileSync(raw);
    fs.rmSync(raw);
    return { pcm: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(), plan, doc: d };
  };
  /** A project with one clip of `file` (at frame `start`) carrying one effect. */
  const single = async (name: string, file: string, type: string, params: Record<string, unknown> = {}, o: { start?: number; duration?: number; sourceIn?: number; until?: number } = {}) => {
    const pid = await newProject(name);
    const clipId = await addClip(pid, file, o.start ?? 0, o.duration, o.sourceIn);
    if (o.until) await addClip(pid, silence, 0, o.until); // a silent clip that makes the programme this long, so tails can ring
    const effectId = await addFx(pid, clipId, type, params);
    return { pid, clipId, effectId };
  };
  const dryWet = async (p: { pid: string; clipId: string; effectId: string }, name: string) => {
    const wet = await exportPcm(p.pid, `${name}-wet.wav`);
    await setFx(p.pid, p.clipId, p.effectId, { enabled: false });
    const dry = await exportPcm(p.pid, `${name}-dry.wav`);
    await setFx(p.pid, p.clipId, p.effectId, { enabled: true });
    return { wet, dry };
  };

  const browsers: Browser[] = []; // closed at the end
  /** One block of checks; a block that throws is a failed check and the others still run. */
  const section = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { console.error(e); check(`${name}: the block ran to its end`, false, String((e as Error)?.stack ?? e).slice(0, 800)); } };
  try {
    // ============================== A. server WAV per effect ==============================
    console.log('# A. each effect, measured on the server export');
    const A: Record<string, unknown> = {};
    measurements.A = A;
    await section('A tone.bassboost', async () => {
      const p = await single('bass boost', tones, 'tone.bassboost', { gainDb: 8 });
      const { wet, dry } = await dryWet(p, 'bass');
      const g30 = dB(amp(wet, 30, 1, 1) / amp(dry, 30, 1, 1)), g2k = dB(amp(wet, 2000, 4, 0.5) / amp(dry, 2000, 4, 0.5));
      A.bassboost = { gain30HzDb: r3(g30), gain2kHzDb: r3(g2k), want30: r3((8 * 2) / 3), want2k: r3(-8 / 3) };
      check('A tone.bassboost (gain 8 dB, at -26 dBFS): 30 Hz gain within 1 dB of gainDb·2/3, 2 kHz gain -gainDb/3 ± 0.3 dB', Math.abs(g30 - 16 / 3) <= 1 && Math.abs(g2k + 8 / 3) <= 0.3, A.bassboost);
    });
    let telResp: number[] = [];
    await section('A voice.telephone response', async () => {
      const p = await single('telephone response', steps, 'voice.telephone', { grit: 0, hiss: 0 });
      const { wet, dry } = await dryWet(p, 'tel');
      telResp = response(wet, dry);
      const e = edges(telResp, 500, 3000);
      const d100 = respAt(telResp, 100) - e.ref, d8k = respAt(telResp, 8000) - e.ref;
      A.telephone = { edges: e, at100HzDb: r3(d100), at8kHzDb: r3(d8k) };
      check('A voice.telephone (grit 0, no hiss, -20 dBFS tone steps): -3 dB points at 300 ± 30 Hz and 3400 ± 100 Hz; at least 24 dB down at 100 Hz and 8 kHz', Math.abs(e.lo - 300) <= 30 && Math.abs(e.hi - 3400) <= 100 && d100 <= -24 && d8k <= -24, A.telephone);
    });
    await section('A voice.telephone hiss', async () => {
      const p = await single('telephone hiss', silence, 'voice.telephone', { grit: 0, hiss: 0.3, seed: 1 }, { duration: 120 });
      const a = await exportJob(p.pid, 'hiss-a.wav'), b = await exportJob(p.pid, 'hiss-b.wav');
      const x = pcmOf(a.file);
      const measured = dB(rms(x, SR / 2, SR * 3.5));
      const generated = -60 + 24 * 0.3;
      // white hiss added where the plan says (before the band filters) leaves the export band-limited by the measured response
      let band = 0;
      for (let i = 0; i < STEPS; i++) band += 10 ** (telResp[i]! / 10) * stepHz(i) * (2 ** (1 / 24) - 2 ** (-1 / 24));
      const bandLimited = generated + 10 * Math.log10(band / (SR / 2));
      await setFx(p.pid, p.clipId, p.effectId, { params: { grit: 0, hiss: 0.3, seed: 2 } });
      const other = pcmOf((await exportJob(p.pid, 'hiss-c.wav')).file);
      const differs = maxDiff(x, SR, other, SR, SR) > 0;
      A.telephoneHiss = { measuredDbfs: r3(measured), generatedDbfs: r3(generated), bandLimitedDbfs: r3(bandLimited), sameSeedSameBytes: sha(a.file) === sha(b.file), otherSeedDiffers: differs, matched: Math.abs(measured - bandLimited) <= 1.5 ? 'added before the band filters (as the plan says)' : Math.abs(measured - generated) <= 1.5 ? 'calibrated at the output' : 'neither' };
      check('A voice.telephone hiss 0.3 on silence: RMS within ± 1.5 dB of its calibrated level (-60 + 24·hiss dBFS added before the band filters, so band-limited by the measured response; or that level at the output); the same seed gives the same bytes, another seed differs', (Math.abs(measured - bandLimited) <= 1.5 || Math.abs(measured - generated) <= 1.5) && sha(a.file) === sha(b.file) && differs, A.telephoneHiss);
    });
    await section('A voice.megaphone', async () => {
      const p = await single('megaphone thd', tone1k, 'voice.megaphone', { drive: 0.6 });
      const wet = await exportPcm(p.pid, 'mega-thd.wav');
      const hs = Array.from({ length: 9 }, (_, k) => amp(wet, 1000 * (k + 1), 1, 1));
      const thd = Math.sqrt(hs.slice(1).reduce((a, v) => a + v * v, 0)) / hs[0]!;
      const q = await single('megaphone response', steps, 'voice.megaphone', { drive: 0 });
      const { wet: w2, dry: d2 } = await dryWet(q, 'mega');
      const resp = response(w2, d2);
      const D = Math.round(0.003 * SR);
      const comb = (hz: number) => 10 * Math.log10(1 + 0.35 * 0.35 + 0.7 * Math.cos((2 * Math.PI * hz * D) / SR)); // the plan's 2-tap horn comb x + 0.35·x[n − 3 ms]
      const noComb = resp.map((v, i) => v - comb(stepHz(i)));
      const peak = respAt(noComb, 1800);
      const filtersOnly = noComb.map((v, i) => v - peakingDb(stepHz(i), 1800, 1.5, 6));
      const e = edges(filtersOnly, 800, 2500);
      A.megaphone = { thdAt1kHzMinus6dBFS: r3(thd), peakAt1800HzDb: r3(peak), bandEdges: e, note: 'response at drive 0 and -20 dBFS; the plan\'s horn comb and +6 dB peak are divided out analytically to find the band edges of the filters' };
      check('A voice.megaphone: THD of 1 kHz at -6 dBFS at least 10 % at drive 0.6; at low level the peak at 1.8 kHz is +6 ± 1 dB; band edges 500 Hz and 4 kHz ± 10 %', thd >= 0.1 && Math.abs(peak - 6) <= 1 && Math.abs(e.lo - 500) <= 50 && Math.abs(e.hi - 4000) <= 400, A.megaphone);
    });
    await section('A voice.radio', async () => {
      const p = await single('radio response', steps, 'voice.radio', { noise: 0 });
      const { wet, dry } = await dryWet(p, 'radio');
      const e = edges(response(wet, dry), 600, 3000);
      const am = await single('radio am', tone1kLow, 'voice.radio', { noise: 0 });
      const y = await exportPcm(am.pid, 'radio-am.wav');
      const env: number[] = [];
      for (let t = 1; t + 0.05 <= 7; t += 0.05) env.push(dB(rms(y, Math.round(t * SR), Math.round((t + 0.05) * SR))));
      const depth = (Math.max(...env) - Math.min(...env)) / 2;
      const cr = await single('radio crackle', silence, 'voice.radio', { noise: 0.4 }, { duration: 180 });
      const full = await exportPcm(cr.pid, 'radio-crackle-full.wav');
      const part = await exportPcm(cr.pid, 'radio-crackle-range.wav', { range: { startFrame: 45, endFrame: 135 } });
      const lo = 45 * SPF + 400, hi = 135 * SPF - 400;
      const thr = crackleThreshold(full, lo, hi);
      const inFull = crackles(full, lo, hi, thr), inPart = crackles(part, 400, 90 * SPF - 400, thr).map((n) => n + 45 * SPF);
      A.radio = { bandEdges: e, amDepthDb: r3(depth), cracklesFull: inFull.length, cracklesRange: inPart.length, perSecond: r3(inFull.length / ((hi - lo) / SR)) };
      check('A voice.radio: band edges 200 Hz and 5 kHz ± 10 % (no static, -20 dBFS); slow level wobble ± 0.5 dB within 0.1 dB; crackle positions in a range export are exactly those of the full export', Math.abs(e.lo - 200) <= 20 && Math.abs(e.hi - 5000) <= 500 && Math.abs(depth - 0.5) <= 0.1 && inFull.length > 0 && JSON.stringify(inFull) === JSON.stringify(inPart), A.radio);
    });
    await section('A voice.robot', async () => {
      const p = await single('robot', tone1kRobot, 'voice.robot', { metal: 0, amount: 1, pitchHz: 90 });
      const y = await exportPcm(p.pid, 'robot.wav');
      const a1000 = amp(y, 1000, 1, 1), lines = [910, 1090].map((hz) => amp(y, hz, 1, 1));
      // the two strongest lines between 500 and 1500 Hz
      const scan: [number, number][] = [];
      for (let hz = 500; hz <= 1500; hz += 2) scan.push([hz, amp(y, hz, 1, 1)]);
      const peaks = scan.filter((v, i) => i > 0 && i < scan.length - 1 && v[1] >= scan[i - 1]![1] && v[1] >= scan[i + 1]![1]).sort((a, b) => b[1] - a[1]).slice(0, 2).map((v) => v[0]).sort((a, b) => a - b);
      const carrierDown = dB(a1000 / Math.max(...lines));
      // the carrier phase: with a constant input the output changes sign exactly where sin(2π·pitch·(at + n)/sr) does
      const q = await single('robot phase', dc, 'voice.robot', { metal: 0, amount: 1, pitchHz: 90 });
      const z = await exportPcm(q.pid, 'robot-dc.wav');
      const half = SR / (2 * 90);
      // a sign change is counted at the first sample of the new sign (a sample that is exactly 0, where the carrier phase is exactly 0, is skipped)
      let crossings = 0, worst = 0, sign = 0;
      for (let n = 200; n < z.length / 2 - 200; n++) {
        const v = z[n * 2]!;
        if (v === 0) continue;
        const sg = v < 0 ? -1 : 1;
        if (sign !== 0 && sg !== sign) { crossings++; worst = Math.max(worst, Math.abs(n - Math.round(n / half) * half)); }
        sign = sg;
      }
      const want = Math.round((z.length / 2 - 400) / half);
      A.robot = { strongestLinesHz: peaks, line1000VsSidebandsDb: r3(carrierDown), carrierCrossings: crossings, expectedCrossings: want, worstCrossingOffsetSamples: r3(worst) };
      check('A voice.robot (metal 0, amount 1, 90 Hz): a 1 kHz sine becomes 910 and 1090 Hz (± 2 Hz) and the 1000 Hz line is at least 40 dB down; the carrier phase is the closed form ((pitch·(at + n)) mod sr)/sr (sign changes within 1 sample)', peaks.length === 2 && Math.abs(peaks[0]! - 910) <= 2 && Math.abs(peaks[1]! - 1090) <= 2 && carrierDown <= -40 && Math.abs(crossings - want) <= 2 && worst <= 1, A.robot);
    });
    await section('A texture.8bit', async () => {
      const p = await single('8-bit', std.speechLike, 'texture.8bit', { bits: 6, rateKhz: 8 });
      const y = await exportPcm(p.pid, '8bit.wav');
      const k = Math.round(SR / 8000);
      const distinct = [0, 1].map((ch) => new Set(channel(y, ch as 0 | 1)).size);
      let held = 0, total = 0;
      for (let n = 1; n < y.length / 2; n++) if (n % k !== 0) { total++; if (y[n * 2] === y[(n - 1) * 2] && y[n * 2 + 1] === y[(n - 1) * 2 + 1]) held++; }
      A.bitcrush = { distinctValues: distinct, holdSamples: k, heldFraction: r3(held / total) };
      check('A texture.8bit (6 bits, 8 kHz): at most 2^6 distinct values per channel; runs of 6 equal samples aligned to the timeline grid', distinct.every((n) => n <= 64) && held === total, A.bitcrush);
    });
    await section('A space.echo', async () => {
      // an impulse 1 s into a clip that ends at 1.2 s; the programme lasts 4 s, so the echo rings on past the clip
      const p = await single('echo impulse', std.impulse, 'space.echo', { amount: 0.5, delayMs: 250, repeats: 4, feedback: 0.5, tone: 0, pingPong: false }, { duration: 36, until: 120 });
      const { pcm: x } = await floatMix(p.pid);
      const D = Math.round((250 * SR) / 1000);
      const taps = [1, 2, 3, 4].map((j) => x[(SR + j * D) * 2]!);
      const wantTaps = [1, 2, 3, 4].map((j) => 0.5 * 0.5 ** j);
      let others = 0;
      for (let n = 0; n < x.length / 2; n++) if (n !== SR && !(n > SR && (n - SR) % D === 0 && (n - SR) / D <= 4)) others = Math.max(others, Math.abs(x[n * 2]!), Math.abs(x[n * 2 + 1]!));
      const wav = await exportPcm(p.pid, 'echo-impulse.wav');
      const range = await exportPcm(p.pid, 'echo-impulse-tail.wav', { range: { startFrame: 42, endFrame: 120 } });
      const rangeTaps = [2, 3, 4].map((j) => range[(SR + j * D - 42 * SPF) * 2]!);
      // beeps: each echo is the beep delayed by exactly j·D (cross-correlation with the dry beep)
      const b = await single('echo beeps', std.beeps, 'space.echo', { amount: 0.5, delayMs: 250, repeats: 4, feedback: 0.5 });
      const y = await exportPcm(b.pid, 'echo-beeps.wav');
      const tpl = channel(pcmOf(std.beeps), 0, 0, 2400);
      let worstLag = 0;
      for (let beep = 0; beep < 5; beep++) for (let j = 1; j <= 4; j++) {
        const at = beep * 2 * SR + j * D;
        let best = 0, bestLag = 0;
        for (let lag = -20; lag <= 20; lag++) { let c = 0; for (let m = 0; m < 2400; m++) c += y[(at + lag + m) * 2]! * tpl[m]!; if (c > best) { best = c; bestLag = lag; } }
        worstLag = Math.max(worstLag, Math.abs(bestLag));
      }
      A.echo = { taps: taps.map((v) => Number(v.toPrecision(7))), want: wantTaps, largestOtherSample: others, wavTapsWithin16bit: taps.every((v, j) => Math.abs(wav[(SR + (j + 1) * D) * 2]! - v) <= LSB), tailRangeTaps: rangeTaps.map((v) => Number(v.toPrecision(5))), beepEchoWorstLagSamples: worstLag };
      check('A space.echo: an impulse gives exactly 4 taps at j·250 ms with gain amount·feedback^j (± 1e-6, float mix) and nothing else; the WAV agrees within 16-bit; a range starting after the clip end holds the remaining taps; beep echoes land at k·delay ± 1 sample',
        taps.every((v, j) => Math.abs(v - wantTaps[j]!) <= 1e-6) && others <= 1e-9 && (A.echo as any).wavTapsWithin16bit && rangeTaps.every((v, j) => Math.abs(v - wantTaps[j + 1]!) <= LSB) && worstLag <= 1, A.echo);
    });
    await section('A space.reverb', async () => {
      const p = await single('reverb ir', std.impulse, 'space.reverb', { room: 'hall', decaySeconds: 1.5, damping: 0, amount: 1, predelayMs: 20, spread: 1 });
      const ir = async () => { const m = await floatMix(p.pid); const w = m.pcm.slice(); w[SR * 2] = w[SR * 2]! - 1; w[SR * 2 + 1] = w[SR * 2 + 1]! - 1; return { w, m }; }; // y = x + amount·wet: remove the dry impulse
      const { w: w0, m } = await ir();
      const left0 = channel(w0, 0, SR);
      const rt = schroederRt60(left0, SR);
      const chain = m.plan.clips.find((c) => c.clipId === p.clipId)!.voice!.chain;
      const declared = chainReach(chain, SR).tail;
      let after = 0;
      for (let n = SR + declared; n < w0.length / 2; n++) after = Math.max(after, Math.abs(w0[n * 2]!), Math.abs(w0[n * 2 + 1]!));
      const c = corr(w0, Math.round(1.05 * SR), Math.round(2.05 * SR));
      await setFx(p.pid, p.clipId, p.effectId, { params: { room: 'hall', decaySeconds: 1.5, damping: 1, amount: 1, predelayMs: 20, spread: 1 } });
      const { w: w1 } = await ir();
      const hf = (w: Float32Array) => schroederRt60(bandpass(channel(w, 0, SR), 6000, 2), SR);
      const rtHf0 = hf(w0), rtHf1 = hf(w1);
      A.reverb = { rt60Seconds: r3(rt), set: 1.5, highFrequencyRt60: { damping0: r3(rtHf0), damping1: r3(rtHf1) }, tailCorrelation: r3(c), declaredTailSeconds: r3(declared / SR), largestAfterDeclaredTail: after };
      check('A space.reverb (hall, 1.5 s): Schroeder T30 within ± 10 % of the set decay at damping 0; high-frequency decay shorter at damping 1; tail correlation below 0.5 at spread 1; the response is below 2^-24 after the declared tail', Math.abs(rt - 1.5) <= 0.15 && rtHf1 < rtHf0 && c < 0.5 && after <= 2 ** -24, A.reverb);
    });
    await section('A utility.width', async () => {
      const p = await single('width', wide, 'utility.width', { stereoWidth: 0 }, { duration: 120 });
      const mono = await exportPcm(p.pid, 'width-0.wav');
      let same = true;
      for (let n = 0; n < mono.length / 2; n++) if (mono[n * 2] !== mono[n * 2 + 1]) { same = false; break; }
      const cs: number[] = [];
      for (const w of [0, 0.5, 1, 1.5, 2]) { await setFx(p.pid, p.clipId, p.effectId, { params: { stereoWidth: w } }); cs.push(r3(corr(await exportPcm(p.pid, `width-${w}.wav`), SR, 3 * SR))); }
      A.width = { leftEqualsRightAtZero: same, correlationByWidth: { 0: cs[0], 0.5: cs[1], 1: cs[2], 1.5: cs[3], 2: cs[4] } };
      check('A utility.width: width 0 gives L === R exactly; the L/R correlation falls steadily as the width grows (0, 0.5, 1, 1.5, 2)', same && cs.every((v, i) => i === 0 || v < cs[i - 1]!), A.width);
    });

    // ============================== B. range equals full ==============================
    console.log('# B. a range of the export equals that part of the full export, for every effect');
    const B: Record<string, unknown> = {};
    measurements.B = B;
    const SPACE = new Set(['space.echo', 'space.reverb']);
    for (const type of ['tone.bassboost', 'voice.telephone', 'voice.megaphone', 'voice.radio', 'voice.robot', 'texture.8bit', 'space.echo', 'space.reverb', 'utility.width']) await section(`B ${type}`, async () => {
      // the clip plays 0.5 s .. 5.5 s; the programme lasts 8 s, so tails ring after the clip
      const p = await single(`range ${type}`, type === 'utility.width' ? wide : std.speechLike, type, type === 'utility.width' ? { stereoWidth: 1.6 } : {}, { start: 15, duration: 150, until: 240 });
      const full = await exportPcm(p.pid, `range-${type}-full.wav`);
      const ranges: { name: string; a: number; b: number; exact: boolean }[] = [
        { name: 'from the clip start', a: 15, b: 45, exact: true },
        { name: 'middle of the clip', a: 75, b: 120, exact: type === 'voice.robot' || type === 'texture.8bit' },
        { name: 'across chunk boundaries', a: 29, b: 61, exact: false },
        ...(SPACE.has(type) ? [{ name: 'inside the ring warm-up', a: 25, b: 55, exact: true }, { name: 'in the tail after the clip end', a: 170, b: 200, exact: false }] : []),
      ];
      const res: Record<string, unknown> = {};
      let ok = true;
      for (const r of ranges) {
        const part = await exportPcm(p.pid, `range-${type}-${r.a}.wav`, { range: { startFrame: r.a, endFrame: r.b } });
        const n = (r.b - r.a) * SPF;
        const md = maxDiff(part, 0, full, r.a * SPF, n), ex = identical(part, 0, full, r.a * SPF, n), audible = peakOf(part) > 1e-3;
        res[r.name] = { maxDifference: md, identical: ex, audible };
        ok &&= part.length === n * 2 && md <= 2 * LSB && (!r.exact || ex) && audible;
      }
      B[type] = res;
      check(`B ${type}: ranges from the clip start, mid-clip, across chunk boundaries${SPACE.has(type) ? ', inside the ring warm-up and in the tail after the clip end' : ''} equal the full export within 2/32768${type === 'voice.robot' || type === 'texture.8bit' ? ' (bit for bit: finite memory)' : ''}; bit for bit where they start within the warm-up`, ok, res);
    });

    // ============================== C. browser export against server export ==============================
    console.log('# C. browser export against server export');
    const pageErrors: string[] = [];
    type BrowserResult = { encoded: Float32Array; mix: Float32Array; sampleRate: number; codec: string };
    const page: { run?: (pid: string, name: string, options?: Record<string, unknown>) => Promise<BrowserResult> } = {};
    await section('C browser export page', async () => {
    const browser = await chromium.launch();
    browsers.push(browser);
    const bp = await browser.newPage();
    bp.on('pageerror', (e) => pageErrors.push(String(e)));
    await bp.goto(`${s.url}/browser-export.html?key=${s.auth.tokens.owner}`);
    await bp.evaluate(() => (window as any).__pfBrowserExport.ready);
    /** Browser export of a project: the encoded file (decoded at 48 kHz) and the mix as it went into the encoder (the tap). */
    page.run = async (pid: string, name: string, options: Record<string, unknown> = {}) => {
      await bp.evaluate(() => { (window as any).__pfExportAudioTap = {}; });
      const r: any = await bp.evaluate(([p, o]) => (window as any).__pfBrowserExport.tryRun(p, o), [pid, { quality: 'high', ...options }] as const);
      if (!r.ok) throw new Error(`browser export did not run: ${JSON.stringify(r).slice(0, 300)}`);
      const file = path.join(art, `${name}.${r.result.container}`);
      fs.writeFileSync(file, Buffer.from(r.result.base64, 'base64'));
      const tap: any = await bp.evaluate(() => { const t = (window as any).__pfExportAudioTap.last; const u = new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength); let x = ''; for (let i = 0; i < u.length; i += 0x8000) x += String.fromCharCode(...u.subarray(i, i + 0x8000)); return { b64: btoa(x), sampleRate: t.sampleRate, frames: t.frames }; });
      const tb = Buffer.from(tap.b64, 'base64');
      return { encoded: pcmOf(file, SR), mix: new Float32Array(tb.buffer, tb.byteOffset, tb.byteLength / 4).slice(), sampleRate: tap.sampleRate as number, codec: `${r.result.container}/${r.result.audioCodec}` };
    };
    });
    const C: Record<string, unknown> = {};
    measurements.C = C;
    const browserRun = (pid: string, name: string, options?: Record<string, unknown>) => { if (!page.run) throw new Error('the browser export page could not be opened'); return page.run(pid, name, options); };
    await section('C linear effects', async () => {
      // the linear effects together: echo on beeps, reverb on an impulse, width on a stereo pair, bass boost below its limiter
      const pid = await newProject('browser linear');
      const echo = await addClip(pid, std.beeps, 0, 240);
      await addFx(pid, echo, 'space.echo', { delayMs: 250, repeats: 3 });
      const rev = await addClip(pid, std.impulse, 0, 240);
      await addFx(pid, rev, 'space.reverb', { room: 'room', decaySeconds: 0.8, amount: 0.4 });
      const wd = await addClip(pid, wide, 0, 240);
      await addFx(pid, wd, 'utility.width', { stereoWidth: 1.5 });
      const bass = await addClip(pid, tones, 0, 180);
      await addFx(pid, bass, 'tone.bassboost', { gainDb: 6 });
      // the steady tones stay below the onset threshold, so the onsets compared are the beeps, their echoes and the impulse
      await tx(pid, [{ op: 'set_clip_gain', args: { clipId: wd, gain: 0.05 } }, { op: 'set_clip_gain', args: { clipId: bass, gain: 0.3 } }]);
      const server = await exportPcm(pid, 'browser-linear-server.wav');
      const b = await browserRun(pid, 'browser-linear-browser');
      const n = Math.min(server.length, b.mix.length) / 2;
      const so = onsets(server, SR), bo = onsets(b.encoded, SR);
      const onsetOk = so.length === bo.length && so.every((t, i) => Math.abs(t - bo[i]!) < 1 / 30);
      const ls = thirdOctaveLevelsDb(server, SR, 1, 7), lb = thirdOctaveLevelsDb(b.encoded, SR, 1, 7);
      const bands = ls.map((v, i) => ({ v, d: lb[i]! - v })).filter((x) => x.v > Math.max(...ls) - 50);
      const worstBand = Math.max(...bands.map((x) => Math.abs(x.d)));
      let e = 0, sgn = 0;
      for (let i = 0; i < n * 2; i++) { const d = b.mix[i]! - server[i]!; e += d * d; sgn += server[i]! * server[i]!; }
      const residualDb = 10 * Math.log10(Math.max(1e-30, e) / sgn);
      // a range of the browser export against the browser's own full export (before encoding)
      const br = await browserRun(pid, 'browser-linear-range', { range: { startFrame: 60, endFrame: 150 } });
      const rangeDiff = maxDiff(br.mix, 0, b.mix, 60 * SPF, 90 * SPF);
      C.linear = { codec: b.codec, mixRate: b.sampleRate, serverOnsets: so.map(r3), browserOnsets: bo.map(r3), serverBandsDb: ls.map((v) => Number(v.toFixed(1))), browserBandsDb: lb.map((v) => Number(v.toFixed(1))), bandsCompared: bands.length, worstBandDifferenceDb: r3(worstBand), residualDbBeforeEncoding: r3(residualDb), browserRangeVsFull: rangeDiff, framesCompared: n };
      check('C linear effects (echo, reverb, width, bass boost): browser onsets within one frame of the server export; third-octave levels within ± 1.5 dB (the bands within 50 dB of the loudest); the browser mix before encoding leaves a residual at least 45 dB down against the server WAV; a browser range equals the browser full export within 2/32768',
        onsetOk && so.length > 0 && worstBand <= 1.5 && residualDb <= -45 && rangeDiff <= 2 * LSB && b.sampleRate === SR, C.linear);
    });
    await section('C radio and telephone', async () => {
      const pid = await newProject('browser radio');
      const clip = await addClip(pid, silence, 0, 180);
      await addFx(pid, clip, 'voice.radio', { noise: 0.4 });
      const tel = await addClip(pid, std.speechLike, 0, 180);
      await addFx(pid, tel, 'voice.telephone', { hiss: 0 });
      // crackle is measured on the radio alone: the telephone clip is muted for that export
      const server = await exportPcm(pid, 'browser-radio-server.wav');
      const b = await browserRun(pid, 'browser-radio-browser');
      // The effect's sound is compared on the browser's mix before encoding (the same DSP on both routes), over every band
      // within 50 dB of the loudest; the encoded file only within 30 dB, because below that a lossy codec's own noise floor
      // decides the level (measured: the 25–80 Hz bands, which the telephone removes, sit 30–45 dB down at the codec's floor).
      const ls = thirdOctaveLevelsDb(server, SR, 1, 5), lm = thirdOctaveLevelsDb(b.mix, b.sampleRate, 1, 5), lb = thirdOctaveLevelsDb(b.encoded, SR, 1, 5);
      const bands = ls.map((v, i) => ({ v, d: lm[i]! - v })).filter((x) => x.v > Math.max(...ls) - 50);
      const worstBand = Math.max(...bands.map((x) => Math.abs(x.d)));
      const codecBands = ls.map((v, i) => ({ v, d: lb[i]! - v })).filter((x) => x.v > Math.max(...ls) - 30);
      const worstCodecBand = Math.max(...codecBands.map((x) => Math.abs(x.d)));
      const d0 = await docOf(pid);
      const telTrack = d0.sequences[d0.mainSequenceId]!.tracks.find((t) => t.clips.some((c) => c.id === tel))!.id;
      await tx(pid, [{ op: 'set_track_audio', args: { trackId: telTrack, muted: true } }]);
      const sr2 = await exportPcm(pid, 'browser-radio-only-server.wav');
      const b2 = await browserRun(pid, 'browser-radio-only-browser');
      const thr = crackleThreshold(sr2, SR, 5 * SR);
      const cs = crackles(sr2, SR, 5 * SR, thr), cb = crackles(b2.mix, SR, 5 * SR, thr);
      const crackleOk = cs.length > 0 && cs.length === cb.length && cs.every((n, i) => Math.abs(n - cb[i]!) <= 1);
      C.radio = { codec: b.codec, crackleServer: cs.length, crackleBrowser: cb.length, worstCrackleOffset: cs.length === cb.length ? Math.max(0, ...cs.map((n, i) => Math.abs(n - cb[i]!))) : null, telephoneBands: bands.length, worstBandDifferenceDb: r3(worstBand), encodedBands: codecBands.length, worstEncodedBandDifferenceDb: r3(worstCodecBand) };
      check('C seeded and nonlinear effects: radio crackle positions in the browser mix agree with the server export within ± 1 sample; with a telephone voice, third-octave levels of the browser mix (before encoding) within ± 1.5 dB of the server export in every band within 50 dB of the loudest, and of the encoded file within ± 1.5 dB in every band within 30 dB', crackleOk && worstBand <= 1.5 && worstCodecBand <= 1.5, C.radio);
    });
    check('C the browser export page raised no errors', pageErrors.length === 0, pageErrors.slice(0, 3));

    // ============================== E. sync ==============================
    console.log('# E. sync');
    await section('E sync', async () => {
      const pid = await newProject('sync 60 s');
      const clip = await addClip(pid, beeps60, 0);
      await addFx(pid, clip, 'voice.telephone', { hiss: 0 });
      await addFx(pid, clip, 'space.echo', {});
      const y = await exportPcm(pid, 'sync60.wav');
      const on = onsets(y, SR, 0.05, 0.1);
      const offsets = Array.from({ length: 30 }, (_, k) => { const near = on.reduce((b, t) => (Math.abs(t - 2 * k) < Math.abs(b - 2 * k) ? t : b), Infinity); return (near - 2 * k) * 1000; });
      const third = 10, mean = (xs: number[]) => xs.reduce((a, v) => a + v, 0) / xs.length;
      const drift = mean(offsets.slice(-third)) - mean(offsets.slice(0, third));
      const worst = Math.max(...offsets.map(Math.abs));
      const rev = await single('reversed reverb', std.beeps, 'space.reverb', { room: 'hall', amount: 0.3 });
      await tx(rev.pid, [{ op: 'set_clip_reverse', args: { clipId: rev.clipId, reverse: true } }]);
      const r = await exportPcm(rev.pid, 'reversed-reverb.wav');
      const ro = onsets(r, SR, 0.05, 0.1);
      const want = [1.95, 3.95, 5.95, 7.95, 9.95, 11.95];
      const mirrored = want.map((w) => { const near = ro.reduce((b, t) => (Math.abs(t - w) < Math.abs(b - w) ? t : b), Infinity); return r3((near - w) * 1000); });
      measurements.E = { beeps: offsets.length, worstOffsetMs: r3(worst), driftFirstToLastThirdMs: r3(drift), reversedOnsetOffsetsMs: mirrored };
      check('E 60 s of beeps with telephone + echo: every beep starts within one frame in the server export, and the first and last thirds differ by under 1 ms (no drift)', worst < 1000 / 30 && Math.abs(drift) < 1, measurements.E);
      check('E a reversed clip with reverb: the mirrored beeps start within 3 ms of their mirrored positions', mirrored.every((d) => Math.abs(d) <= 3), { reversedOnsetOffsetsMs: mirrored });
    });

    // ============================== F. loudness ==============================
    console.log('# F. loudness');
    await section('F loudness', async () => {
      const p = await single('loudness', loud, 'tone.bassboost', { gainDb: 8 });
      await tx(p.pid, [{ op: 'set_loudness_target', args: { target: -14 } }]);
      const { file, job } = await exportJob(p.pid, 'loudness.wav');
      const lufs = measureLufs(file);
      const exportMeasured = job.output.audio?.loudness?.measuredLufs as number;
      const m = (await call(`/projects/${p.pid}/analysis/loudness`, {})).body;
      measurements.F = { exportedLufs: lufs, exportMeasuredBeforeGain: exportMeasured, appliedGainDb: job.output.audio?.loudness?.appliedGainDb, limitedByPeak: job.output.audio?.loudness?.limitedByPeak, measureLoudness: m.integratedLufs };
      // the same mix without the boost measures differently, so the measurement hears the effect
      await setFx(p.pid, p.clipId, p.effectId, { enabled: false });
      const dryMeasured = (await call(`/projects/${p.pid}/analysis/loudness`, {})).body.integratedLufs as number;
      (measurements.F as any).measureLoudnessWithoutTheEffect = dryMeasured;
      check('F bass boost with a -14 LUFS target: the exported WAV measures -14 ± 0.5 LUFS (not limited by the true-peak ceiling); measure_loudness equals the export\'s own measurement within ± 0.1 LU, and hears the effect (it differs without it)', lufs !== null && Math.abs(lufs + 14) <= 0.5 && job.output.audio?.loudness?.limitedByPeak === false && Math.abs(m.integratedLufs - exportMeasured) <= 0.1 && Math.abs(dryMeasured - m.integratedLufs) > 0.3, measurements.F);
    });

    // ============================== G. cuts ==============================
    console.log('# G. cuts');
    await section('G cuts', async () => {
      const pid = await newProject('cuts');
      const tel = await addClip(pid, std.speechLike, 15, 165);
      await addFx(pid, tel, 'voice.telephone', {});
      const rev = await addClip(pid, std.beeps, 0, 240);
      await addFx(pid, rev, 'space.reverb', { room: 'hall', decaySeconds: 2, amount: 0.5 });
      await addClip(pid, silence, 0, 270);
      const before = await exportPcm(pid, 'cuts-before.wav');
      const s1 = await tx(pid, [{ op: 'split_clip', args: { clipId: tel, at: f(100) } }, { op: 'split_clip', args: { clipId: rev, at: f(75) } }]);
      const d = await docOf(pid);
      const parts = d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c: any) => c.audioFx?.length);
      const after = await exportPcm(pid, 'cuts-after.wav');
      const md = maxDiff(after, 0, before, 0, before.length / 2);
      measurements.G = { partsWithEffects: parts.length, sameEffectIds: parts.every((c: any) => c.audioFx.every((x: any) => parts.some((o: any) => o.id !== c.id && o.audioFx.some((y: any) => y.id === x.id)))), maxDifference: md, revision: s1.revision };
      check('G cutting a telephone clip mid-clip and a reverbed clip in the middle of a reverb tail: four parts carry the effects (same ids, so the same noise), and the export is unchanged within 2/32768', parts.length === 4 && md <= 2 * LSB && before.length === after.length, measurements.G);
    });

    // ============================== H. null tests ==============================
    console.log('# H. null tests');
    await section('H null tests', async () => {
      const pid = await newProject('null');
      const a = await addClip(pid, std.speechLike, 0, 240);
      const b = await addClip(pid, std.beeps, 0, 240);
      const plain = await exportJob(pid, 'null-plain.wav');
      const ids = [[a, await addFx(pid, a, 'voice.telephone', {})], [a, await addFx(pid, a, 'space.echo', {})], [b, await addFx(pid, b, 'space.reverb', {})], [b, await addFx(pid, b, 'tone.bassboost', {})]] as const;
      for (const [c, e] of ids) await setFx(pid, c, e, { enabled: false });
      const disabled = await exportJob(pid, 'null-disabled.wav');
      for (const [c, e] of ids) await setFx(pid, c, e, { enabled: true, params: { amount: 0 } });
      const zero = await exportJob(pid, 'null-amount0.wav');
      const w = await single('width 1 + 2^-20', wide, 'utility.width', { stereoWidth: 1 + 2 ** -20 }, { duration: 120 });
      const fx = await floatMix(w.pid);
      const wavFx = await exportPcm(w.pid, 'width-nearly-1.wav');
      await setFx(w.pid, w.clipId, w.effectId, { enabled: false });
      const dryFloat = await floatMix(w.pid);
      const wavDry = await exportPcm(w.pid, 'width-dry.wav');
      const floatDiff = maxDiff(fx.pcm, 0, dryFloat.pcm, 0, dryFloat.pcm.length / 2), wavDiff = maxDiff(wavFx, 0, wavDry, 0, wavDry.length / 2);
      measurements.H = { plainSha: sha(plain.file), disabledSha: sha(disabled.file), amountZeroSha: sha(zero.file), widthNearlyOne: { voicePlanned: !!fx.plan.clips.find((c) => c.clipId === w.clipId)?.voice, floatMaxDifference: floatDiff, wavMaxDifference: wavDiff } };
      check('H null tests: all effects disabled gives the WAV of the project without them (SHA-256); amount 0 too', sha(disabled.file) === sha(plain.file) && sha(zero.file) === sha(plain.file), measurements.H);
      check('H width 1 + 2^-20 runs the engine time-map path and stays within 1e-5 of the plain path (float mix; the WAV within one 16-bit step)', !!fx.plan.clips.find((c) => c.clipId === w.clipId)?.voice && floatDiff <= 1e-5 && wavDiff <= LSB, (measurements.H as any).widthNearlyOne);
    });

    // ============================== J. manifest ==============================
    console.log('# J. export manifest');
    await section('J manifest', async () => {
      const p = await single('manifest', std.speechLike, 'voice.robot', {}, { duration: 90 });
      await addFx(p.pid, p.clipId, 'space.echo', {});
      const plan = (await call(`/projects/${p.pid}/exports/plan`, { format: 'wav' })).body;
      const { job } = await exportJob(p.pid, 'manifest.wav');
      const listed = plan.manifest.audioEffects as { type: string; version: number; clips: number }[];
      const d = await docOf(p.pid);
      // an effect this build has no implementation for cannot be added by any op; a document carrying one (from a newer build) is refused at planning
      const refusedOp = await call(`/projects/${p.pid}/transactions`, { ops: [{ op: 'add_audio_effect', args: { clipId: p.clipId, type: 'voice.from_a_newer_build' } }] });
      const foreign = structuredClone(d);
      for (const t of foreign.sequences[foreign.mainSequenceId]!.tracks) for (const c of t.clips) if (c.id === p.clipId) (c as any).audioFx.push({ id: 'afx_future', type: 'voice.from_a_newer_build', enabled: true, params: {} });
      const blocked = new Exporter(s.store, null as any, () => '', path.join(root, 'apps/web/dist')).plan(foreign, 1, { format: 'wav' }).blockers;
      measurements.J = { engine: plan.manifest.engine, audioEffects: listed, jobManifestAudioEffects: job.output.manifest.audioEffects, opRefusal: { status: refusedOp.status, code: refusedOp.body?.error?.code }, blockers: blocked.map((x) => x.code) };
      check('J the export manifest names the audio runtime (plan/2 voice/1) and lists each sound effect with its version, in the plan and in the finished job; an effect this build cannot run is refused by the op and blocks the export of a document that carries it',
        plan.manifest.engine.audio === `plan/2 ${AUDIO_FX_ENGINE}` && JSON.stringify(listed.map((x) => [x.type, x.version, x.clips])) === JSON.stringify([['space.echo', 1, 1], ['voice.robot', 1, 1]]) && JSON.stringify(job.output.manifest.audioEffects) === JSON.stringify(listed) && refusedOp.status >= 400 && blocked.some((x) => x.code === 'unknown_audio_effect'), measurements.J);
    });
  } catch (e) {
    console.error(e);
    check('run completed', false, String((e as Error)?.stack ?? e).slice(0, 800));
  } finally {
    for (const b of browsers) await b.close().catch(() => {});
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED',
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' },
      scope: 'Synthetic signals only (ffmpeg lavfi: tone steps, tones, beeps, an impulse, silence, a buzzy formant signal). Each wave-1 sound effect measured on the server export (16-bit WAV, or the same server mix in floating point where a measurement needs it), range exports against full exports, the browser export against the server export (the browser mix compared before lossy encoding, the encoded file for onsets and band levels), sync over 60 s, loudness normalisation, cuts and null tests. No speech, no music, and nobody has listened: this shows the effects are what the plan specifies and that every route makes the same sound, not that they sound good.',
      passed: checks.length - failed.length, total: checks.length, checks, measurements,
    };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/voicefx-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nSound effects proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}

/** Integrated loudness of a file (ffmpeg ebur128), or null for silence. */
function measureLufs(file: string): number | null {
  const err = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr ?? '';
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(err.slice(err.lastIndexOf('Summary:')));
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > -69.9 ? v : null;
}

main().catch((e) => { console.error(e); process.exit(1); });
