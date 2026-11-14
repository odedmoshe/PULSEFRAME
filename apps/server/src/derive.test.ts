import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Asset } from '@pulseframe/core';
import { generateBarcodeFixture, readBarcode } from '../../../packages/fixtures/src/index.ts';
import { Derivatives } from './derive.ts';
import { describeMedia, ffprobe } from './ingest.ts';
import { Store } from './store.ts';

const exec = promisify(execFile);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-derive-'));
const store = new Store(path.join(root, 'data'));
let fixture = '';
let asset: Asset;
let d: Derivatives;
let wallMs = 0;

const sha = (file: string) => `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
/** Store a copy of `file` (putBlob moves it) and describe it as an Asset. */
async function makeAsset(file: string): Promise<Asset> {
  const copy = path.join(store.tmpDir, `in_${randomBytes(4).toString('hex')}`);
  fs.copyFileSync(file, copy);
  const meta = await describeMedia(file);
  const contentHash = sha(file);
  const byteSize = fs.statSync(file).size;
  store.putBlob(contentHash, copy, byteSize, meta.mimeType);
  return { ...meta, id: 'ast_test', name: path.basename(file), contentHash, byteSize, provenance: { origin: 'upload', importedAt: new Date().toISOString(), importedBy: 'test' } } as Asset;
}
async function decodeRgb(file: string, extra: string[] = []): Promise<Buffer> {
  const { stdout } = await exec('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, ...extra, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 400 << 20 });
  return stdout;
}

beforeAll(async () => {
  fixture = path.join(root, 'fx.mp4');
  await generateBarcodeFixture({ out: fixture, frames: 90 });
  asset = await makeAsset(fixture);
  d = new Derivatives(store);
  const t0 = performance.now();
  d.ensure(asset);
  await d.idle();
  wallMs = performance.now() - t0;
  console.log(`derivatives wall time (90 frames, all three): ${Math.round(wallMs)} ms`);
}, 60_000);
afterAll(async () => {
  await d.stop();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Derivatives', () => {
  it('produces all three, with blobs on disk, and ensure is idempotent', async () => {
    const rows = d.list(asset.contentHash);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([['proxy', 'ready'], ['thumbnails', 'ready'], ['waveform', 'ready']]);
    for (const r of rows) {
      expect(fs.statSync(store.blobPath(r.blobHash!)).size).toBe(r.bytes);
      expect(sha(store.blobPath(r.blobHash!))).toBe(r.blobHash);
    }
    const again = d.ensure(asset);
    await d.idle();
    expect(again.map((r) => [r.kind, r.blobHash, r.updatedAt])).toEqual(rows.map((r) => [r.kind, r.blobHash, r.updatedAt]));
    expect(d.list(asset.contentHash).map((r) => r.blobHash)).toEqual(rows.map((r) => r.blobHash));
  });

  it('proxy keeps every frame: barcode of frame i is i, same count and rate as the original', async () => {
    const row = d.get(asset.contentHash, 'proxy')!;
    const m = row.meta as any;
    expect(m.frameMapping).toBe('identity');
    expect(m.original).toMatchObject({ width: 640, height: 360, frameCount: 90, frameRate: { num: 30, den: 1 } });
    expect(m.proxy.height).toBeLessThanOrEqual(540);
    expect(m.proxy.gop).toBe(15);
    const pv = (await ffprobe(store.blobPath(row.blobHash!))).streams.find((s: any) => s.codec_type === 'video');
    const ov = (await ffprobe(fixture)).streams.find((s: any) => s.codec_type === 'video');
    expect(pv.nb_frames).toBe(ov.nb_frames);
    expect(pv.r_frame_rate).toBe(ov.r_frame_rate);
    const { width: w, height: h } = m.proxy;
    const raw = await decodeRgb(store.blobPath(row.blobHash!));
    expect(raw.length).toBe(90 * w * h * 3);
    for (let i = 0; i < 90; i++) expect(readBarcode(raw.subarray(i * w * h * 3, (i + 1) * w * h * 3), w, 3, { x: 0, y: 0, w, h })).toBe(i);
  });

  it('thumbnail tiles carry the frame index recorded in meta', async () => {
    const row = d.get(asset.contentHash, 'thumbnails')!;
    const m = row.meta as any;
    expect(m.count).toBe(3);
    expect(m.frameIndices).toEqual([0, 30, 60]);
    expect(m.tileHeight).toBe(90);
    const W = m.columns * m.tileWidth;
    const H = m.rows * m.tileHeight;
    const raw = await decodeRgb(store.blobPath(row.blobHash!));
    expect(raw.length).toBe(W * H * 3);
    for (let i = 0; i < m.count; i++) {
      const x = (i % m.columns) * m.tileWidth;
      const y = Math.floor(i / m.columns) * m.tileHeight;
      expect(readBarcode(raw, W, 3, { x, y, w: m.tileWidth, h: m.tileHeight })).toBe(m.frameIndices[i]);
    }
  });

  it('waveform peaks locate the beeps and the levels are laid out as meta says', () => {
    const row = d.get(asset.contentHash, 'waveform')!;
    const m = row.meta as any;
    const blob = fs.readFileSync(store.blobPath(row.blobHash!));
    expect(m.sampleRate).toBe(48000);
    expect(m.levels.map((l: any) => l.samplesPerBucket)).toEqual([256, 1024, 4096]);
    let expectOffset = 0;
    for (const l of m.levels) {
      expect(l.byteOffset).toBe(expectOffset);
      expect(l.buckets).toBe(Math.ceil(m.totalSamples / l.samplesPerBucket));
      expectOffset += l.buckets * 4;
    }
    expect(blob.length).toBe(expectOffset);
    expect(Math.abs(m.totalSamples - 144000)).toBeLessThan(2048);
    const l0 = m.levels[0];
    const pairs = Array.from({ length: l0.buckets }, (_, i) => [blob.readInt16LE(l0.byteOffset + i * 4), blob.readInt16LE(l0.byteOffset + i * 4 + 2)] as const);
    const loud = pairs.map(([lo, hi]) => Math.max(-lo, hi) > 0.25 * 32767);
    const runs: { start: number; len: number }[] = [];
    loud.forEach((x, i) => { if (x) { if (i > 0 && loud[i - 1]) runs[runs.length - 1]!.len++; else runs.push({ start: i, len: 1 }); } });
    expect(runs).toHaveLength(3);
    [0, 48000, 96000].forEach((s, k) => {
      expect(Math.abs(runs[k]!.start * 256 - s)).toBeLessThanOrEqual(256);
      expect(Math.abs(runs[k]!.len - 4800 / 256)).toBeLessThanOrEqual(2);
    });
    pairs.forEach(([lo, hi], i) => {
      const nearBeep = [0, 48000, 96000].some((s) => i * 256 > s - 3 * 256 && i * 256 < s + 4800 + 3 * 256);
      if (!nearBeep) expect(Math.max(-lo, hi)).toBeLessThan(0.02 * 32767);
    });
  });

  it('audio-only assets get a waveform and nothing else', async () => {
    const wav = path.join(root, 'tone.wav');
    await exec('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '48000', '-y', wav]);
    const a = await makeAsset(wav);
    d.ensure(a);
    await d.idle();
    const by = Object.fromEntries(d.list(a.contentHash).map((r) => [r.kind, r.status]));
    expect(by).toEqual({ thumbnails: 'not-applicable', proxy: 'not-applicable', waveform: 'ready' });
  });

  it('recovers rows left running after a restart', async () => {
    const wav = path.join(root, 'tone3.wav');
    await exec('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', '-ar', '48000', '-y', wav]);
    const b = await makeAsset(wav);
    store.db.prepare("INSERT INTO derivatives (asset_hash, kind, status, updated_at) VALUES (?, 'waveform', 'running', ?)").run(b.contentHash, new Date().toISOString());
    const d2 = new Derivatives(store);
    d2.recover();
    await d2.idle();
    expect(d2.get(b.contentHash, 'waveform')?.status).toBe('ready');
    await d2.stop();
  });

  it('records failures per derivative for a corrupt blob and still goes idle', async () => {
    const junk = path.join(store.tmpDir, 'junk');
    fs.writeFileSync(junk, randomBytes(4096));
    const contentHash = sha(junk);
    store.putBlob(contentHash, junk, 4096, 'video/mp4');
    const bad = { kind: 'video', contentHash, audio: { sampleRate: 48000, channels: 2, codec: 'aac' } } as unknown as Asset;
    d.ensure(bad);
    await d.idle();
    for (const r of d.list(contentHash)) {
      expect(r.status).toBe('failed');
      expect(r.error).toEqual(expect.any(String));
    }
  });
});
