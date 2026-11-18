/**
 * Audio features for shorts (ADR-0018): levels, flatness and flux per 100 ms hop from real ffmpeg decodes of generated test
 * signals (lavfi), plus the pure per-hop measurer on synthetic samples. The truth of every signal is computed here from its
 * formula. TEST SIGNALS ONLY: nothing measured is faked in the product code.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import type { Asset } from '@pulseframe/core';
import { Store } from './store.ts';

// Count ffmpeg runs of the code under test (the test's own encodes use execFileSync, which is not counted).
const spawned = vi.hoisted(() => ({ n: 0 }));
vi.mock('node:child_process', async (orig) => {
  const m = await orig<typeof import('node:child_process')>();
  return { ...m, spawn: ((...a: Parameters<typeof m.spawn>) => { spawned.n++; return m.spawn(...a); }) as typeof m.spawn };
});
const { execFileSync } = await import('node:child_process');
const { audioFeaturesOf, cachedAudioFeatures, featuresCachePaths, FeaturesAbandoned, hopMeasurer, hopPlan, readCachedFeatures } = await import('./shortsFeatures.ts');

let dir: string, store: Store;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-features-')); store = new Store(dir); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

/** Encode a lavfi source with ffmpeg and put it in the store as an asset (its metadata written here, as a probe would). */
function asset(name: string, lavfi: string, seconds: number, extra: { channels?: number; outArgs?: string[]; ext?: string; timeOrigin?: T.RationalTime } = {}): Asset {
  const file = path.join(dir, `${name}.${extra.ext ?? 'wav'}`);
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', lavfi, ...(extra.outArgs ?? ['-c:a', 'pcm_s16le']), file]);
  const hash = `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  fs.copyFileSync(file, store.blobPath(hash));
  return {
    id: `ast_${name}`, kind: 'audio', name, contentHash: hash, byteSize: fs.statSync(file).size, container: extra.ext ?? 'wav', mimeType: 'audio/wav', duration: T.rt(seconds, 1),
    audio: { sampleRate: 16000, channels: extra.channels ?? 1, codec: 'pcm_s16le' }, ...(extra.timeOrigin ? { timeOrigin: extra.timeOrigin } : {}),
    provenance: { origin: 'fixture', importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' },
  } as Asset;
}
const median = (xs: ArrayLike<number>) => { const s = Array.from(xs).sort((a, b) => a - b); return s[s.length >> 1]!; };

describe('the per-hop measurer (pure)', () => {
  const frames = (x: Float32Array, hops: number) => { const m = hopMeasurer(); return Array.from({ length: hops }, (_, h) => m((k) => x[h * 1600 - 224 + k] ?? 0)); };
  it('white noise has flatness ≥ 0.8; a sine has flatness ≤ 0.05', () => {
    let s = 7; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
    const noise = Float32Array.from({ length: 16000 * 3 }, () => 0.3 * rnd());
    const sine = Float32Array.from({ length: 16000 * 3 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    expect(median(frames(noise, 30).slice(2, 28).map((f) => f.flatness))).toBeGreaterThanOrEqual(0.8);
    const sf = frames(sine, 30).slice(2, 28);
    expect(Math.max(...sf.map((f) => f.flatness))).toBeLessThanOrEqual(0.05);
    expect(median(sf.map((f) => f.rmsDb))).toBeCloseTo(-23.01, 1);
  });
  it('a click train peaks in flux at the click hops ±1', () => {
    const x = new Float32Array(16000 * 6);
    const clicks = [8500, 25000, 41700, 58000, 74321];
    for (const c of clicks) x[c] = 0.9;
    const f = frames(x, 60);
    for (const c of clicks) {
      const hop = Math.floor(c / 1600);
      const near = f.slice(Math.max(0, hop - 4), hop + 5).map((v) => v.flux);
      const peak = Math.max(hop - 4, 0) + near.indexOf(Math.max(...near));
      expect(Math.abs(peak - hop)).toBeLessThanOrEqual(1);
      expect(f[peak]!.flux).toBeGreaterThan(1);
    }
    // between clicks nothing rises
    expect(f[20]!.flux).toBe(0);
  });
  it('digital silence: floor level, flatness 0, no flux', () => {
    const f = frames(new Float32Array(16000), 5);
    expect(f.every((v) => v.rmsDb === -100 && v.flatness === 0 && v.flux === 0)).toBe(true);
  });
  it('hops cover the file; a partial last hop counts; at most 4 h', () => {
    expect(hopPlan(T.rt(1500, 1))).toEqual({ hops: 15000, analysedSeconds: 1500, partial: false });
    expect(hopPlan(T.rt(12345, 1000)).hops).toBe(124);
    expect(hopPlan(T.rt(5 * 3600, 1))).toEqual({ hops: 144000, analysedSeconds: 14400, partial: true });
  });
});

describe('audioFeaturesOf (ffmpeg)', () => {
  it('a sine of −20 dBFS peak gives rmsDb −23.01 ± 0.1 (also from equal stereo channels)', async () => {
    const mono = asset('sine', 'sine=f=440:d=10:sample_rate=16000,volume=0.8', 10);
    const f = await audioFeaturesOf(store, mono);
    expect(f.hops).toBe(100);
    expect(Math.abs(median(f.rmsDb.subarray(5, 95)) - -23.01)).toBeLessThanOrEqual(0.1);
    expect(Math.max(...f.flatness.subarray(5, 95))).toBeLessThanOrEqual(0.05);
    const stereo = asset('sine2', 'sine=f=440:d=4:sample_rate=48000,volume=0.8,pan=stereo|c0=c0|c1=c0', 4, { channels: 2 });
    expect(Math.abs(median((await audioFeaturesOf(store, stereo)).rmsDb.subarray(5, 35)) - -23.01)).toBeLessThanOrEqual(0.1);
  }, 120_000);
  it('white noise from the decoder has flatness ≥ 0.8', async () => {
    const f = await audioFeaturesOf(store, asset('noise', 'anoisesrc=color=white:amplitude=0.3:sample_rate=16000:seed=3:duration=5', 5));
    expect(median(f.flatness.subarray(3, 47))).toBeGreaterThanOrEqual(0.8);
  }, 120_000);
  it('a file with start_time 1.5 s is aligned to its origin', async () => {
    const burst = "aevalsrc='if(between(t,1,1.3),0.5*sin(2*PI*440*t),0)':s=16000:d=4";
    const offset = { ext: 'mkv', outArgs: ['-c:a', 'pcm_s16le', '-output_ts_offset', '1.5'] };
    const a = asset('late', burst, 4, { ...offset, timeOrigin: T.rt(3, 2) });
    expect(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', path.join(dir, 'late.mkv')], { encoding: 'utf8' }).trim())).toBeCloseTo(1.5, 3);
    const f = await audioFeaturesOf(store, a);
    const loud = Array.from(f.rmsDb).flatMap((v, h) => (v > -20 ? [h] : []));
    expect(loud[0]).toBe(10);
    expect(loud.at(-1)).toBeLessThanOrEqual(13);
    expect(f.hops).toBe(40);
  }, 120_000);
  it('a 25-minute ramp tone gives exactly 15000 hops with no gap, duplicate or different value at the 1200 s seam; then cached', async () => {
    // amplitude rises from 0.05 to 0.45 within every second, so each hop of a second has its own level
    const a = asset('ramp', "aevalsrc='(0.05+0.4*(t-floor(t)))*sin(2*PI*440*t)':s=16000:d=1500", 1500, { ext: 'flac', outArgs: ['-c:a', 'flac'] });
    const before = spawned.n;
    const f = await audioFeaturesOf(store, a);
    expect(spawned.n - before).toBe(2); // two windows: 1200 s + 300 s
    expect(f.hops).toBe(15000);
    const expected = (h: number) => { const a0 = 0.05 + 0.4 * ((h % 10) / 10), a1 = a0 + 0.04; return 10 * Math.log10((a0 * a0 + a0 * a1 + a1 * a1) / 3 / 2); };
    let worst = 0;
    for (let h = 1; h < 15000; h++) worst = Math.max(worst, Math.abs(f.rmsDb[h]! - expected(h)));
    expect(worst).toBeLessThan(0.1);
    for (let h = 11990; h < 12010; h++) expect(Math.abs(f.rmsDb[h]! - expected(h))).toBeLessThan(0.05);
    // the flux pattern repeats every second across the seam (each second rises the same way)
    for (let h = 11990; h < 12010; h++) expect(f.flux[h]!).toBeCloseTo(f.flux[h - 10]!, 3);
    // second call: read from the cache, no ffmpeg
    const n = spawned.n;
    const again = await audioFeaturesOf(store, a);
    expect(spawned.n).toBe(n);
    expect(Array.from(again.rmsDb)).toEqual(Array.from(f.rmsDb));
    expect(cachedAudioFeatures(store, a)!.hops).toBe(15000);
    // another version is a miss; a cache whose description says another version is a miss too
    expect(readCachedFeatures(store, a, 2)).toBeNull();
    const p = featuresCachePaths(store, a.contentHash);
    const meta = JSON.parse(fs.readFileSync(p.json, 'utf8'));
    fs.writeFileSync(p.json, JSON.stringify({ ...meta, version: 0 }));
    expect(cachedAudioFeatures(store, a)).toBeNull();
    fs.writeFileSync(p.json, JSON.stringify(meta));
    expect(cachedAudioFeatures(store, a)).not.toBeNull();
  }, 600_000);
  it('abandoned() stops before the next window and caches nothing', async () => {
    const a = asset('ramp2', "aevalsrc='0.2*sin(2*PI*330*t)':s=16000:d=1260", 1260, { ext: 'flac', outArgs: ['-c:a', 'flac'] });
    let checks = 0;
    const before = spawned.n;
    await expect(audioFeaturesOf(store, a, () => ++checks > 1)).rejects.toBeInstanceOf(FeaturesAbandoned);
    expect(spawned.n - before).toBe(1); // the first window ran, the second never started
    expect(cachedAudioFeatures(store, a)).toBeNull();
  }, 600_000);
  it('a file without sound is refused; nothing cached is read for it', async () => {
    const a = { ...asset('sine', 'sine=f=440:d=10:sample_rate=16000,volume=0.8', 10), audio: undefined } as Asset;
    expect(cachedAudioFeatures(store, a)).toBeNull();
    await expect(audioFeaturesOf(store, a)).rejects.toMatchObject({ status: 422, code: 'no_audio' });
  }, 120_000);
});
