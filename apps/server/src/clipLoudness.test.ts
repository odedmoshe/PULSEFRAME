/**
 * Track send, worker A, on the server (send-decisions C9, C11–C13, C15), through the real ffmpeg on synthetic sound (lavfi):
 *  - measure_clip_loudness: each clip alone as export mixes it; too_short / short / silent; revision; median; refusals; the match
 *    committed with that revision re-measures on target; an old revision is refused;
 *  - the master chain: without a limiter the WAV is byte-identical to unchanged mixToRaw + the conversion command of before wave 7
 *    (a frozen copy below); with a limiter no 16-bit sample passes ⌊10^(c/20)·32767⌋ and samples away from the limiting equal the
 *    unlimited export; a range equals the full export 125 ms after its start; a loudness target the static gain missed is reached;
 *  - sound checks read from the written WAV, at timeline times (the range's first sample added), with soundPlays;
 *  - programmeLoudness returns the limiter export would run and the same sound checks as the export.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { audioPlan, type AudioPlan, type PlannedAudioClip } from '@pulseframe/engine';
import { masterLookaheadFrames, measureLoudness, mixToRaw, normalisationGain, renderMix, soundChecksOfWav, wavLayout } from './audiomix.ts';
import { measureClipLoudness } from './clipLoudness.ts';
import { programmeLoudness } from './programmeLoudness.ts';
import { ApiError, Store } from './store.ts';

const SR = 48000;
let dir = '';
let store: Store;
const files: Record<string, string> = {};
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
const gen = (name: string, expr: string, seconds: number) => { const f = path.join(dir, `${name}.wav`); ff(['-f', 'lavfi', '-i', `aevalsrc=${expr}|${expr}:s=48000:d=${seconds}`, '-c:a', 'pcm_f32le', f]); files[name] = f; return f; };
/** 16-bit samples of a WAV (interleaved stereo) */
const pcm16 = (wav: string) => { const w = wavLayout(wav); const b = fs.readFileSync(wav).subarray(w.dataOffset, w.dataOffset + w.dataBytes); return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-send-sound-'));
  gen('quiet', '0.1*sin(2*PI*220*t)', 6);
  gen('loud', '0.4*sin(2*PI*220*t)', 6);
  gen('blip', '0.4*sin(2*PI*220*t)', 0.3);
  gen('two', '0.2*sin(2*PI*220*t)', 2);
  gen('hot', '0.9*sin(2*PI*110*t)', 4); // over the ceiling at gain 2 (+6 dB)
  gen('bed', '0.25*sin(2*PI*110*t)', 8);
  store = new Store(path.join(dir, 'store'));
}, 60_000);
afterAll(() => { store?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// ---------- plan-level helpers (no store) ----------
const blob = (assetId: string) => files[assetId]!;
const clip = (id: string, asset: string, at: number, length: number, gain = 1, source = 0): PlannedAudioClip => ({ clipId: id, trackId: 't', assetId: asset, at, length, source, speed: 1, gain, pan: 0, fade: [{ s: 0, g: 1 }, { s: length, g: 1 }], duck: [{ s: 0, g: 1 }, { s: length, g: 1 }] });
const planOf = (clips: PlannedAudioClip[], total: number, extra: Partial<AudioPlan> = {}): AudioPlan => ({ sampleRate: SR, totalSamples: total, clips, loudness: null, cutTails: [], missingFx: [], ...extra });
/** A bed under the whole programme, a +6 dB hot stretch from 1.0 s to 1.5 s (over full scale), silence after 6 s. */
const hotPlan = (extra: Partial<AudioPlan> = {}) => planOf([clip('bed', 'bed', 0, 6 * SR), clip('hot', 'hot', SR, SR / 2, 2)], 9 * SR, extra);
/** The conversion of before wave 7, frozen here (send-decisions C13): raw float → (volume) → 16-bit WAV. */
const frozenConvert = (raw: string, gainDb: number, out: string) => ff(['-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', raw, ...(gainDb !== 0 ? ['-af', `volume=${gainDb.toFixed(4)}dB`] : []), '-c:a', 'pcm_s16le', '-f', 'wav', out]);

describe('master chain', () => {
  it('without a limiter the WAV is byte-identical to unchanged mixToRaw + the frozen conversion command (with and without a loudness target)', async () => {
    for (const loudness of [null, { target: -16, truePeak: -1 }]) {
      const plan = hotPlan({ loudness });
      expect(masterLookaheadFrames(plan)).toBe(0);
      const wav = path.join(dir, `nolim_${!!loudness}.wav`), raw = path.join(dir, 'ref.f32'), ref = path.join(dir, `ref_${!!loudness}.wav`);
      const r = await renderMix(plan, blob, 0, plan.totalSamples, wav);
      expect(r.limiter).toBeUndefined();
      await mixToRaw(plan, blob, 0, plan.totalSamples, raw);
      // the gain of before wave 7: one static gain to the target, stopped by the true-peak ceiling
      const gainDb = loudness ? normalisationGain(await measureLoudness(raw, SR), loudness.target, loudness.truePeak).gainDb : 0;
      if (loudness) expect(gainDb).not.toBe(0);
      frozenConvert(raw, gainDb, ref);
      expect(sha(wav)).toBe(sha(ref));
      fs.rmSync(raw);
    }
  }, 60_000);

  it('with a limiter: no 16-bit sample passes floor(10^(c/20)·32767), the stretch away from the limiting equals the unlimited export, the report is measured', async () => {
    const ceiling = -1, top = Math.floor(10 ** (ceiling / 20) * 32767);
    const off = path.join(dir, 'unlim.wav'), on = path.join(dir, 'lim.wav');
    const plain = await renderMix(hotPlan(), blob, 0, 9 * SR, off);
    const lim = await renderMix(hotPlan({ limiter: { ceiling } }), blob, 0, 9 * SR, on);
    expect(plain.clipped).toBe(true);
    const a = pcm16(off), b = pcm16(on);
    expect(b.length).toBe(9 * SR * 2);
    let peak = 0;
    for (const v of b) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(top);
    expect(peak).toBeGreaterThan(top - 40); // the limiter holds at the ceiling, it does not over-squash
    // limiting can start M − 1 samples before the first sample over the ceiling and ends 2M + release after the last
    const M = 240, rel = 5760, firstOver = SR, lastOver = SR + SR / 2;
    let diff = 0, inside = 0;
    for (let i = 0; i < 9 * SR; i++) {
      const away = i < firstOver - M || i > lastOver + 2 * M + rel;
      if (away && (a[i * 2] !== b[i * 2] || a[i * 2 + 1] !== b[i * 2 + 1])) diff++;
      if (!away && a[i * 2] !== b[i * 2]) inside++;
    }
    expect(diff).toBe(0);
    expect(inside).toBeGreaterThan(0);
    const L = lim.limiter!;
    expect(L.ceiling).toBe(ceiling);
    expect(L.maxReductionDb).toBeLessThan(-5);
    expect(L.secondsLimited).toBeGreaterThan(0.4);
    expect(L.trimDb).toBe(0); // a 110 Hz tone: its true peak sits on its samples, so no trim was needed (stated, measured)
    expect(L.truePeakDbtp!).toBeLessThanOrEqual(ceiling + 0.05);
    expect(lim.clipped).toBe(false);
    expect(lim.checks!.findings.filter((f) => f.kind === 'clipped')).toEqual([]);
    expect(plain.checks!.findings.filter((f) => f.kind === 'clipped').length).toBe(1);
  }, 60_000);

  it('a range export with a limiter equals the full export from 125 ms after its start', async () => {
    const full = path.join(dir, 'full.wav'), part = path.join(dir, 'part.wav');
    const plan = hotPlan({ limiter: { ceiling: -2 } });
    await renderMix(plan, blob, 0, 9 * SR, full);
    const first = SR + 12_345; // inside the hot stretch, where the limiter is holding
    await renderMix(plan, blob, first, 2 * SR, part);
    const a = pcm16(full), b = pcm16(part), from = Math.round(0.125 * SR);
    let diff = 0;
    for (let j = from * 2; j < b.length; j++) if (b[j] !== a[first * 2 + j]) diff++;
    expect(diff).toBe(0);
  }, 60_000);

  it('a loudness target the static gain misses (stopped by the peak) is reached with the limiter, and the report is the written file measured', async () => {
    const loudness = { target: -12, truePeak: -1 };
    const plain = await renderMix(hotPlan({ loudness }), blob, 0, 9 * SR, path.join(dir, 'l0.wav'));
    expect(plain.loudness!.limitedByPeak).toBe(true);
    const wav = path.join(dir, 'l1.wav');
    const r = await renderMix(hotPlan({ loudness, limiter: { ceiling: -1 } }), blob, 0, 9 * SR, wav);
    const m = await measureLoudness(wav, SR, { wav: true });
    expect(Math.abs(m.integratedLufs! - loudness.target)).toBeLessThanOrEqual(0.5);
    expect([r.limiter!.achievedLufs, r.limiter!.truePeakDbtp]).toEqual([m.integratedLufs, m.truePeakDbtp]);
    expect(r.loudness!.ceiling).toBe(-1);
    expect(r.loudness!.method).toMatch(/not consulted/);
  }, 60_000);

  it('sharp clicks whose true peak passes the sample ceiling: the second pass lowers the sample ceiling (no trim of the whole film); the true peak holds and the report is the file measured', async () => {
    // rectangular 2 ms clicks: their true peak is 0.8 dB over their samples, and they carry much of the loudness, so limiting them
    // takes loudness away the one correction cannot give back: the target is NOT reached here, and the report says what was (a limit)
    const e = '0.05*sin(2*PI*220*t)+if(lt(mod(t\\,0.5)\\,0.002)\\,0.9\\,0)';
    gen('clicks', e, 6);
    const plan = planOf([clip('p', 'clicks', 0, 6 * SR)], 6 * SR, { loudness: { target: -14, truePeak: -1 }, limiter: { ceiling: -1 } });
    const wav = path.join(dir, 'clicks.wav');
    const r = await renderMix(plan, blob, 0, plan.totalSamples, wav);
    const m = await measureLoudness(wav, SR, { wav: true });
    expect(m.truePeakDbtp!).toBeLessThanOrEqual(-1 + 0.05);
    expect([r.limiter!.achievedLufs, r.limiter!.truePeakDbtp]).toEqual([m.integratedLufs, m.truePeakDbtp]);
    expect(r.limiter!.method).toMatch(/true-peak overshoot/);
    expect(r.limiter!.trimDb).toBe(0);
    let peak = 0;
    for (const v of pcm16(wav)) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(Math.floor(10 ** (-1 / 20) * 32767));
  }, 60_000);

  it('a bed with short loud bursts (the loudness is the bed): the target the static gain missed is reached within 0.5 LU', async () => {
    const e = '0.1*sin(2*PI*220*t)+if(lt(mod(t\\,2)\\,0.005)\\,0.9*sin(2*PI*1000*t)\\,0)';
    gen('bursts', e, 8);
    const loudness = { target: -14, truePeak: -1 };
    const plain = await renderMix(planOf([clip('b', 'bursts', 0, 8 * SR)], 8 * SR, { loudness }), blob, 0, 8 * SR, path.join(dir, 'b0.wav'));
    expect(plain.loudness!.limitedByPeak).toBe(true);
    const wav = path.join(dir, 'b1.wav');
    const r = await renderMix(planOf([clip('b', 'bursts', 0, 8 * SR)], 8 * SR, { loudness, limiter: { ceiling: -1 } }), blob, 0, 8 * SR, wav);
    const m = await measureLoudness(wav, SR, { wav: true });
    expect(Math.abs(m.integratedLufs! - loudness.target)).toBeLessThanOrEqual(0.5);
    expect(m.truePeakDbtp!).toBeLessThanOrEqual(-1 + 0.05);
    expect(r.limiter!.achievedLufs).toBe(m.integratedLufs);
  }, 60_000);

  it('sound checks are read from the written WAV at timeline times (the range start added), with soundPlays', async () => {
    // bed 0–2 s, nothing 2–5 s (silence, no clip plays), bed 5–5.5 s, a clip of digital nothing 5.5–8 s (silence while a clip
    // plays), hot 8–8.5 s at gain 2 (clipped), 0.5 s of nothing at the end (too short to report)
    gen('zero', '0', 3);
    const plan = planOf([clip('bed', 'bed', 0, 2 * SR), clip('bed2', 'bed', 5 * SR, SR / 2), clip('z', 'zero', 5.5 * SR, 2.5 * SR), clip('hot', 'hot', 8 * SR, SR / 2, 2)], 9 * SR);
    const first = 4800; // a range starting at 0.1 s: findings stay timeline times
    const wav = path.join(dir, 'checks.wav');
    const r = await renderMix(plan, blob, first, plan.totalSamples - first, wav);
    const f = r.checks!.findings.map((x) => [x.kind, T.toSeconds(x.from), T.toSeconds(x.to), x.soundPlays ?? null, x.from.timescale]);
    expect(f).toEqual([
      ['silence', 2, 5, false, SR],
      ['silence', 5.5, 8, true, SR],
      ['clipped', 8, 8.5, null, SR],
    ]);
    expect(r.checks!.status).toBe('measured');
    expect(r.checks!.method).toMatch(/16-bit/);
    expect(soundChecksOfWav(wav, plan, first).checks).toEqual(r.checks);
  }, 60_000);
});

// ---------- store-level: clip measurement, the match, programme loudness ----------
function importAudio(pid: string, name: string, seconds: number) {
  const bytes = fs.readFileSync(files[name]!);
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tmp = path.join(dir, `${name}.blob`);
  fs.copyFileSync(files[name]!, tmp);
  store.putBlob(hash, tmp, bytes.length, 'audio/wav');
  const asset = { kind: 'audio' as const, name: `${name}.wav`, contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.fromSeconds(String(seconds)), audio: { sampleRate: SR, channels: 2, codec: 'pcm_f32le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } };
  return store.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
}
const R30 = { num: 30, den: 1 };
function soundProject(name: string) {
  const pid = store.createProject({ name, width: 320, height: 180, frameRate: R30 }).doc.id;
  const tr = store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'add_track', args: { kind: 'audio', name: 'a' } }] }).results[0]!.output!.trackId as string;
  const add = (asset: string, startFrame: number, frames: number) => { const o = store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'add_clip', args: { assetId: asset, trackId: tr, start: T.frameTime(startFrame, R30), duration: T.frameTime(frames, R30) } }] }).results[0]!.output!; return (o.audioClipId ?? o.clipId) as string; };
  return { pid, tr, add };
}

describe('measure_clip_loudness', () => {
  it('each clip alone, as export mixes it: within 0.1 LU of ffmpeg on the same sound; too_short / short; revision; median; refusals; the match re-measures on target', async () => {
    const { pid, add } = soundProject('clips');
    const q = add(importAudio(pid, 'quiet', 6), 0, 150), l = add(importAudio(pid, 'loud', 6), 150, 150), b = add(importAudio(pid, 'blip', 0.3), 300, 9), t = add(importAudio(pid, 'two', 2), 330, 60);
    const res = await measureClipLoudness(store, pid, { clipIds: [q, l, b, t] });
    expect(res.revision).toBe(store.getProject(pid).revision);
    const byId = Object.fromEntries(res.clips.map((c) => [c.clipId, c]));
    // the reference: ffmpeg's R128 of the first 5 s of each source (the clip plays it at gain 1, centred), rounded as ffmpeg prints it
    const ref = async (name: string, s: number) => { const raw = path.join(dir, `${name}.ref.f32`); ff(['-i', files[name]!, '-t', String(s), '-f', 'f32le', '-ac', '2', raw]); const m = await measureLoudness(raw, SR); fs.rmSync(raw); return m.integratedLufs!; };
    expect(Math.abs(byId[q]!.measuredLufs! - (await ref('quiet', 5)))).toBeLessThanOrEqual(0.1);
    expect(Math.abs(byId[l]!.measuredLufs! - (await ref('loud', 5)))).toBeLessThanOrEqual(0.1);
    expect(Math.abs(byId[l]!.measuredLufs! - byId[q]!.measuredLufs! - 20 * Math.log10(4))).toBeLessThanOrEqual(0.1);
    expect(byId[l]!.peakDbfs).toBeCloseTo(20 * Math.log10(0.4), 1);
    expect([byId[q]!.status, byId[l]!.status, byId[b]!.status, byId[t]!.status]).toEqual(['measured', 'measured', 'too_short', 'short']);
    expect(byId[b]!.measuredLufs).toBeNull();
    expect(byId[q]!.gain).toBe(1);
    expect(byId[t]!.seconds).toBe(2);
    expect(res.medianLufs).not.toBeNull();
    // refusals: unknown clip, a repeated clip
    await expect(measureClipLoudness(store, pid, { clipIds: ['clp_none'] })).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(measureClipLoudness(store, pid, { clipIds: [q, q] })).rejects.toBeInstanceOf(ApiError);
    // the match with the measurement's revision, then measured again
    const target = -20;
    const clips = [q, l].map((id) => ({ clipId: id, measuredLufs: byId[id]!.measuredLufs!, peakDbfs: byId[id]!.peakDbfs!, gain: byId[id]!.gain }));
    store.commit({ projectId: pid, actor: 'test', expectedRevision: res.revision, ops: [{ op: 'match_clip_loudness', args: { target, clips } }] });
    const again = await measureClipLoudness(store, pid, { clipIds: [q, l] });
    for (const c of again.clips) expect(Math.abs(c.measuredLufs! - target), c.clipId).toBeLessThanOrEqual(0.1);
    // an old revision is refused by the transaction
    expect(() => store.commit({ projectId: pid, actor: 'test', expectedRevision: res.revision, ops: [{ op: 'match_clip_loudness', args: { target, clips } }] })).toThrow();
  }, 120_000);

  it('a clip that is not a sound clip on a sound track is refused with the op\'s wording', async () => {
    const pid = store.createProject({ name: 'text', width: 320, height: 180, frameRate: R30 }).doc.id;
    const o = store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'add_text', args: { text: 'x', start: T.ZERO, duration: T.frameTime(30, R30) } }] }).results[0]!.output!;
    await expect(measureClipLoudness(store, pid, { clipIds: [o.clipId as string] })).rejects.toMatchObject({ status: 422, code: 'incompatible' });
  });
});

describe('programmeLoudness', () => {
  it('returns the limiter export would run (null without one) and the sound checks the export writes', async () => {
    const { pid, add } = soundProject('prog');
    add(importAudio(pid, 'bed', 8), 0, 60); // 2 s of sound, then nothing until the hot clip
    const hot = add(importAudio(pid, 'hot', 4), 150, 60);
    store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'set_clip_gain', args: { clipId: hot, gain: 2 } }] });
    const a: any = await programmeLoudness(store, pid);
    expect(a.limiter).toBeNull();
    expect(a.soundChecks.findings.map((f: any) => f.kind)).toEqual(['silence', 'clipped']);
    // the same findings as the export's own mix of this document
    const doc = store.getProject(pid).doc, plan = audioPlan(doc);
    const wav = path.join(dir, 'prog.wav');
    const r = await renderMix(plan, (id) => store.blobPath(doc.assets[id]!.contentHash), 0, plan.totalSamples, wav);
    expect(a.soundChecks).toEqual(r.checks);
    store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'set_master_limiter', args: { ceiling: -1 } }] });
    const b: any = await programmeLoudness(store, pid);
    expect(b.limiter.ceiling).toBe(-1);
    expect(b.limiter.maxReductionDb).toBeLessThan(-3);
    expect(b.soundChecks.findings.map((f: any) => f.kind)).toEqual(['silence']);
    expect(b.integratedLufs).toBe(a.integratedLufs); // the measured numbers are still those of the mix before any gain
  }, 120_000);
});
