/**
 * No metadata beyond the allow-list (wave 7 send, C8; proof S11): the three kinds of MP4 output — the single pass, the segmented
 * join and the fitted file — are made here with the export's own argument lists from synthetic frames, and carry only
 * ALLOWED_OUTPUT_TAGS. A file with a title or a creation time fails the check (so the check can fail).
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLOWED_OUTPUT_TAGS } from '@pulseframe/core';
import { singlePassArgs } from './export.ts';
import { concatList, encodeSegmentFile, joinArgs, silentWav } from './exportSegments.ts';
import { assertOutputTags, outputTagProblems, twoPassArgs } from './sizeFit.ts';

const exec = promisify(execFile);
const R = { num: 30, den: 1 }, W = 160, H = 90, N = 30;
let dir: string, wav: string;
const frame = (k: number) => { const f = new Uint8Array(W * H * 4); for (let i = 0; i < f.length; i += 4) { f[i] = (i / 4 + k * 7) % 256; f[i + 1] = k * 8; f[i + 2] = 128; f[i + 3] = 255; } return f; };
const ffmpeg = (args: string[], stdin?: Uint8Array[]) => new Promise<void>((resolve, reject) => {
  const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err))));
  for (const f of stdin ?? []) p.stdin.write(f);
  p.stdin.end();
});

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-meta-'));
  wav = path.join(dir, 'mix.wav');
  silentWav(wav, 48000, 48000);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('MP4 outputs carry only the allowed tags (C8)', () => {
  it('B: every MP4 output carries only ALLOWED_OUTPUT_TAGS: single pass, segmented join, fitted file', async () => {
    const single = path.join(dir, 'single.mp4');
    await ffmpeg(singlePassArgs({ format: 'mp4-h264-aac', quality: 'draft', width: W, height: H, frameRate: R, wav, outFile: single }), Array.from({ length: N }, (_, k) => frame(k)));
    const segs = [path.join(dir, 's0.mp4'), path.join(dir, 's1.mp4')];
    await encodeSegmentFile(Array.from({ length: 15 }, (_, k) => frame(k)), { width: W, height: H, frameRate: R, quality: 'draft', threads: 1, outFile: segs[0]! });
    await encodeSegmentFile(Array.from({ length: 15 }, (_, k) => frame(15 + k)), { width: W, height: H, frameRate: R, quality: 'draft', threads: 1, outFile: segs[1]! });
    const list = path.join(dir, 'list.ffconcat');
    fs.writeFileSync(list, concatList(segs));
    const joined = path.join(dir, 'joined.mp4');
    await ffmpeg(joinArgs({ listFile: list, wav, outFile: joined, frameRate: R }));
    const fitted = path.join(dir, 'fitted.mp4');
    const [p1, p2] = twoPassArgs({ intermediate: single, wav, passLog: path.join(dir, 'pass'), videoBitrate: 200_000, audioBitrate: 64_000, frameRate: R, outFile: fitted });
    await ffmpeg(p1);
    await ffmpeg(p2);
    for (const f of [single, joined, fitted]) {
      expect(await outputTagProblems(f), path.basename(f)).toEqual([]);
      await expect(assertOutputTags(f)).resolves.toBeUndefined();
    }
    // the fit pass drops what an input carries (a title, a creation time) instead of copying it
    const tagged = path.join(dir, 'tagged.mp4');
    await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', single, '-c', 'copy', '-metadata', 'title=family', '-metadata', 'creation_time=2026-01-01T00:00:00Z', tagged]);
    expect(await outputTagProblems(tagged)).toEqual(expect.arrayContaining(['format:title', 'format:creation_time']));
    await expect(assertOutputTags(tagged)).rejects.toThrow(/export failed validation: the file carries tags outside the allow-list/);
    const refit = path.join(dir, 'refit.mp4');
    const [q1, q2] = twoPassArgs({ intermediate: tagged, wav, passLog: path.join(dir, 'pass2'), videoBitrate: 200_000, audioBitrate: 64_000, frameRate: R, outFile: refit });
    await ffmpeg(q1);
    await ffmpeg(q2);
    expect(await outputTagProblems(refit)).toEqual([]);
    expect(ALLOWED_OUTPUT_TAGS).toContain('encoder');
  }, 60_000);
});
