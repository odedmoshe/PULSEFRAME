/**
 * The family film fixtures (ADR-0026): what truth.json says is what the files hold. The chroma-only barcode reads back as
 * (clip << 12 | frame) on every frame from decoded RGB, its strip rows have a constant grey (so the moments measurement and
 * the flash analyser do not see it), the two cell colours have equal luma and relative luminance and neither is saturated red,
 * the late clip's picture starts 15 frames late, the silent clips have no sound stream, the dark stretch is dark, the decoy is
 * fast enough, and the capture times are in an order different from the file names. Needs ffmpeg and ffprobe.
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BARCODE } from './index.ts';
import { FILM_BARCODE, FILM_FIXTURE, filmBarcodeValue, filmClipSamples, filmFixtureTruth, generateFilmFixtures, readFilmBarcode, type FilmFixtureTruth } from './film.ts';

let dir = '';
let truth: FilmFixtureTruth;
const probe = (file: string) => new Promise<any>((resolve, reject) => execFile('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], (e, out) => (e ? reject(e) : resolve(JSON.parse(String(out))))));
/** Every decoded frame of a file at 640×360 in the given pixel format. */
function decode(file: string, pixFmt: 'rgb24' | 'gray'): Promise<Buffer[]> {
  const size = 640 * 360 * (pixFmt === 'rgb24' ? 3 : 1);
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `format=${pixFmt}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg ${code}`));
      const all = Buffer.concat(chunks), frames: Buffer[] = [];
      for (let o = 0; o + size <= all.length; o += size) frames.push(all.subarray(o, o + size));
      resolve(frames);
    });
  });
}
const rect = { x: 0, y: 0, w: 640, h: 360 };
const lin = (v: number) => { const c = Math.max(0, Math.min(255, v)) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const decodeYuv = (y: number, u: number, v: number, m: 709 | 601) => {
  const l = 1.164 * (y - 16);
  return m === 709 ? [l + 1.793 * (v - 128), l - 0.213 * (u - 128) - 0.533 * (v - 128), l + 2.112 * (u - 128)] : [l + 1.596 * (v - 128), l - 0.392 * (u - 128) - 0.813 * (v - 128), l + 2.017 * (u - 128)];
};
const relLum = ([r, g, b]: number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-film-fixtures-'));
  truth = await generateFilmFixtures({ outDir: dir });
}, 300_000);
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe('film fixtures', () => {
  it('writes six clips, a still, the music and truth.json equal to the formulas', () => {
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'))).toEqual(filmFixtureTruth());
    expect(truth.clips.map((c) => c.name)).toEqual(['film-a.mp4', 'film-b.mp4', 'film-c.mp4', 'film-d.mp4', 'film-e.mp4', 'film-f.mp4']);
    for (const c of truth.clips) {
      expect(fs.existsSync(path.join(dir, c.name))).toBe(true);
      expect(c.frames / 30).toBeGreaterThanOrEqual(12);
      expect(c.frames / 30).toBeLessThanOrEqual(16);
      if (c.truth) expect(c.truth.toFrame - c.truth.fromFrame).toBe(180); // 6 s
    }
    expect(fs.existsSync(path.join(dir, truth.still.name))).toBe(true);
    expect(fs.existsSync(path.join(dir, truth.music!.name))).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.'))).toEqual([]);
    // the roles the proof needs
    expect(truth.clips.filter((c) => c.decoy).length).toBe(1);
    expect(truth.clips.filter((c) => c.dark).length).toBe(1);
    expect(truth.clips.filter((c) => !c.sound && c.truth).length).toBe(1);
    expect(truth.clips.filter((c) => !c.sound && !c.truth && c.activeShare === 0).length).toBe(1);
    expect(truth.clips.filter((c) => c.startOffsetFrames === 15).length).toBe(1);
    expect(truth.clips.find((c) => !c.truth && c.activeShare >= 0.8)).toBeDefined();
  });
  it('capture times run in an order different from the file names', () => {
    const byName = [...truth.clips].sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.name);
    const byCapture = [...truth.clips].sort((a, b) => a.capture.localeCompare(b.capture)).map((c) => c.name);
    expect(byCapture).not.toEqual(byName);
    expect(new Set(truth.clips.map((c) => c.capture)).size).toBe(6);
  });
  it('the containers hold what truth says: frames, rate, a late picture, sound streams and creation_time', async () => {
    for (const c of truth.clips) {
      const p = await probe(path.join(dir, c.name));
      const v = p.streams.find((s: any) => s.codec_type === 'video'), a = p.streams.find((s: any) => s.codec_type === 'audio');
      expect(Number(v.nb_frames)).toBe(c.frames);
      expect(v.r_frame_rate).toBe('30/1');
      expect([v.width, v.height]).toEqual([640, 360]);
      expect(Math.round((Number(v.start_time) - Number(a?.start_time ?? 0)) * 30)).toBe(c.startOffsetFrames);
      expect(!!a).toBe(c.sound);
      expect(p.format.tags.creation_time.slice(0, 19)).toBe(c.capture.slice(0, 19));
    }
    const s = await probe(path.join(dir, truth.still.name));
    expect(s.streams[0].codec_name).toBe('png');
  }, 60_000);
  it('the chroma barcode reads (clip << 12 | frame) on every frame from decoded RGB, also on the late clip', async () => {
    for (const c of truth.clips.filter((x) => x.decoy || x.startOffsetFrames)) {
      const frames = await decode(path.join(dir, c.name), 'rgb24');
      expect(frames.length).toBe(c.frames);
      const wrong = frames.map((f, i) => readFilmBarcode(f, 640, 3, rect) === filmBarcodeValue(c.clip, i)).filter((ok) => !ok).length;
      expect(wrong).toBe(0);
    }
  }, 120_000);
  it('the strip is invisible to grey: its rows keep one mean grey (within 2 levels) on every frame of every clip', async () => {
    const strip = Math.round(360 * BARCODE.stripFrac);
    for (const c of truth.clips) {
      const means = (await decode(path.join(dir, c.name), 'gray')).map((f) => { let s = 0; for (let i = 0; i < strip * 640; i++) s += f[i]!; return s / (strip * 640); });
      expect(Math.max(...means) - Math.min(...means)).toBeLessThanOrEqual(2);
      expect(Math.abs(means[0]! - FILM_BARCODE.grey)).toBeLessThanOrEqual(2);
    }
  }, 180_000);
  it('the cell colours have equal luma and relative luminance (BT.709 and BT.601 decode), read apart on blue, not saturated red', () => {
    const { y, one, zero } = FILM_BARCODE;
    for (const m of [709, 601] as const) {
      const a = decodeYuv(y, one.u, one.v, m), b = decodeYuv(y, zero.u, zero.v, m);
      expect(Math.abs(relLum(a) - relLum(b))).toBeLessThan(0.001);
      expect(a[2]!).toBeGreaterThan(170);
      expect(b[2]!).toBeLessThan(86);
      for (const rgb of [a, b]) { for (const ch of rgb) expect(ch).toBeGreaterThanOrEqual(0); expect(rgb[0]! / (rgb[0]! + rgb[1]! + rgb[2]!)).toBeLessThan(0.8); }
    }
  });
  it('the dark stretch is dark for the whole frame; the decoy pans at 1200 permille of the width per second or more', async () => {
    const c = truth.clips.find((x) => x.dark)!;
    const frames = await decode(path.join(dir, c.name), 'gray');
    for (let f = c.dark!.fromFrame; f < c.dark!.toFrame; f += 7) { let s = 0; for (const v of frames[f]!) s += v; expect(s / frames[f]!.length).toBeLessThan(20); }
    expect((FILM_FIXTURE.decoyPxPerFrame * 30 * 1000) / 640).toBeGreaterThanOrEqual(1200);
  }, 60_000);
  it('sound: −40 dBFS noise with −6 dBFS 1 kHz bursts inside the truth window only', () => {
    for (const c of truth.clips) {
      const s = filmClipSamples(c.clip);
      expect(!!s).toBe(c.sound);
      if (!s) continue;
      const peak = (t0: number, t1: number) => { let m = 0; for (let i = Math.round(t0 * 48000); i < Math.round(t1 * 48000); i++) m = Math.max(m, Math.abs(s[i]!)); return m; };
      const t = (f: number) => (f + c.startOffsetFrames) / 30;
      if (c.truth) {
        expect(peak(t(c.truth.fromFrame), t(c.truth.toFrame))).toBeGreaterThan(0.4);
        expect(peak(0, t(c.truth.fromFrame) - 0.01)).toBeLessThanOrEqual(0.01);
        expect(peak(t(c.truth.toFrame) + 0.01, s.length / 48000)).toBeLessThanOrEqual(0.01);
      } else expect(peak(0, s.length / 48000)).toBeLessThanOrEqual(0.01);
    }
  });
});
