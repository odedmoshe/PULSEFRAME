/** Level envelope (multicam, ADR-0020): timing on the file's own clock, independent channels, byte-identical builds, the store. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { decodeEnvelope, encodeEnvelope, isDualMono, levelAt, type Asset } from '@pulseframe/core';
import { Derivatives } from './derive.ts';
import { buildEnvelope, envelopeMeasurer, envelopeOf, envelopeStatus, storedEnvelope } from './envelope.ts';
import { Store } from './store.ts';

let dir = '', late = '';
const ff = (args: string[]) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); };
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-envelope-'));
  late = path.join(dir, 'late.mkv');
  // picture from file time 1.4 s; the sound starts 0.5 s later; a 1 kHz burst 1.0 s into the sound = SOURCE time 1.5 s
  ff(['-f', 'lavfi', '-i', 'color=c=gray:s=64x36:r=30:d=4', '-itsoffset', '0.5', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,1,1.05),0.5*sin(2*PI*1000*t),0)':s=48000:d=3", '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'pcm_s16le', '-output_ts_offset', '1.4', late]);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const lateAsset = { id: 'ast_late', timeOrigin: T.fromSeconds('1.4'), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' } } as Pick<Asset, 'id' | 'timeOrigin' | 'audio'>;

describe('level envelope', () => {
  it('a burst in a file whose sound starts late (timeOrigin 1.4 s) lands at envelope index round(t·100) ±1', async () => {
    const e = await buildEnvelope(late, lateAsset);
    const onset = e.mix.findIndex((v) => v > -2000);
    expect(Math.abs(onset - 150)).toBeLessThanOrEqual(1);
    expect(levelAt(e, null, T.rt(1520, 1000))).toBeGreaterThan(-12);
    expect(levelAt(e, null, T.rt(1, 1))).toBe(-120); // digital silence is the floor
    expect(levelAt(e, null, T.rt(99, 1))).toBe(-120); // outside the file
    // the flux peaks at the onset too (512-point window: within two frames)
    let best = 0;
    for (let i = 1; i < e.frames; i++) if (e.flux[i]! > e.flux[best]!) best = i;
    expect(Math.abs(best - 150)).toBeLessThanOrEqual(2);
    expect(e.frames).toBeGreaterThanOrEqual(345); // 0.5 s padded before + 3 s of sound
  });
  it('two builds are byte-identical, and the encoding round-trips exactly', async () => {
    const a = encodeEnvelope(await buildEnvelope(late, lateAsset)), b = encodeEnvelope(await buildEnvelope(late, lateAsset));
    expect(createHash('sha256').update(a).digest('hex')).toBe(createHash('sha256').update(b).digest('hex'));
    expect(encodeEnvelope(decodeEnvelope('x', a))).toEqual(a);
    expect(() => decodeEnvelope('x', a.subarray(0, a.length - 1))).toThrow(/truncated/);
  });
  it('dual-mono L/R channels are independent, and are detected (never applied) as dual mono', () => {
    const sr = 16000, secs = 20, x = new Float32Array(sr * secs * 2);
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
    for (let i = 0; i < sr * secs; i++) {
      const t = i / sr, turn = Math.floor(t / 2) % 2; // host on L for 2 s, then guest on R for 2 s
      const voice = 0.3 * Math.sin(2 * Math.PI * (180 + 40 * Math.sin(t * 3)) * t) * (0.6 + 0.4 * Math.sin(t * 9)) + 0.05 * rnd();
      x[2 * i] = turn === 0 ? voice : 0.001 * rnd();
      x[2 * i + 1] = turn === 1 ? voice : 0.001 * rnd();
    }
    const m = envelopeMeasurer('ast_dm', 2);
    for (let o = 0; o < x.length; o += 2 * 1234) m.samples(x.subarray(o, Math.min(x.length, o + 2 * 1234))); // odd chunking
    const e = m.finish();
    expect(e.channels).toHaveLength(2);
    expect(e.frames).toBe(2000);
    expect(levelAt(e, 0, T.rt(1, 1))).toBeGreaterThan(-20);
    expect(levelAt(e, 1, T.rt(1, 1))).toBeLessThan(-50);
    expect(levelAt(e, 1, T.rt(3, 1))).toBeGreaterThan(-20);
    expect(levelAt(e, 0, T.rt(3, 1))).toBeLessThan(-50);
    expect(isDualMono(e)).toBe(true);
    // the same voice on both channels is not dual mono
    const y = new Float32Array(x.length);
    for (let i = 0; i < sr * secs; i++) y[2 * i] = y[2 * i + 1] = x[2 * i]! + x[2 * i + 1]!;
    const m2 = envelopeMeasurer('ast_st', 2);
    m2.samples(y);
    expect(isDualMono(m2.finish())).toBe(false);
  });
  it('chunking does not change a single value', () => {
    const x = Float32Array.from({ length: 16000 * 3 }, (_, i) => Math.sin(i * 0.05) * Math.sin(i * 0.0007));
    const whole = envelopeMeasurer('a', 1); whole.samples(x);
    const parts = envelopeMeasurer('a', 1);
    const b = Buffer.from(x.buffer);
    for (let o = 0; o < b.length; o += 777) parts.bytes(b.subarray(o, Math.min(b.length, o + 777))); // splits inside samples
    expect(encodeEnvelope(parts.finish())).toEqual(encodeEnvelope(whole.finish()));
  });
  it('is stored as a derivative (not queued on import), read back without decoding again', async () => {
    const store = new Store(path.join(dir, 'store'));
    const d = new Derivatives(store);
    try {
      const bytes = fs.readFileSync(late);
      const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const tmp = path.join(dir, 'blob.tmp');
      fs.copyFileSync(late, tmp);
      store.putBlob(hash, tmp, bytes.length, 'video/x-matroska');
      const asset = { ...lateAsset, contentHash: hash } as Asset;
      const seen: string[] = [];
      store.events.on('derivative', (r: { kind: string; status: string }) => { if (r.kind === 'envelope') seen.push(r.status); });
      expect(envelopeStatus(d, asset)).toBe('missing');
      const e = await envelopeOf(store, d, asset);
      expect(seen).toEqual(['running', 'ready']); // announced over SSE (the 'derivative' event)
      expect(envelopeStatus(d, asset)).toBe('ready');
      expect(encodeEnvelope(storedEnvelope(store, d, asset)!)).toEqual(encodeEnvelope(e));
      expect(d.get(hash, 'envelope')!.meta).toMatchObject({ version: 1, rate: 100, decodeRate: 16000, channels: 1 });
      await envelopeOf(store, d, asset);
      expect(seen).toEqual(['running', 'ready']); // read, not rebuilt
    } finally { await d.stop(); store.close(); }
  });
});
