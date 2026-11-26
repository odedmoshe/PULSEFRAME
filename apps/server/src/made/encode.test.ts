/**
 * The made-clip encode and file check (wave 8 motioncode, W1; plan §4.2, verify C2). No browser: synthetic RGBA PNG frames made here
 * with ffmpeg stand in for the browser's screenshots (labelled). The working folder is deleted.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffprobe, videoHasAlpha } from '../ingest.ts';
import { MadeEncoder, madeEncodeArgs, madePlateArgs, runMadeFfmpeg } from './encode.ts';
import { checkMadeFile, compareRgba, differingPixels, frameFails, MADE_RGB_TOLERANCE } from './validate.ts';

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-made-enc-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** Stand-in for the browser's screenshots: `n` RGBA PNGs from an ffmpeg source graph. */
function pngs(graph: string, n: number): Buffer[] {
  const all = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', graph, '-frames:v', String(n), '-pix_fmt', 'rgba', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], { maxBuffer: 1 << 28 });
  const out: Buffer[] = [];
  let at = 0;
  while (at < all.length) { const end = all.indexOf('IEND', at) + 8; out.push(all.subarray(at, end)); at = end; }
  return out;
}
const W = 64, H = 48, rate = { num: 30, den: 1 };
/** A blue-ish plate whose left half is fully transparent, with a moving bar so frames differ. */
const half = `color=c=0x2060e0:s=${W}x${H}:r=30,format=rgba,geq=r='if(lt(mod(X+N*2,64),8),250,32)':g='96':b='224':a='if(lt(X,32),0,255)'`;
async function encode(frames: Buffer[], name: string, r = rate) {
  const out = path.join(dir, name);
  const enc = new MadeEncoder({ width: W, height: H, rate: r, out });
  for (const f of frames) await enc.push(f);
  return { out, analysis: await enc.finish() };
}

describe('made encode', () => {
  it('converts with the BT.709 matrix and tags BT.709 (G1: the default BT.601 matrix tagged 709 draws about 8 levels off)', () => {
    const a = madeEncodeArgs({ width: W, height: H, rate, out: 'x.webm' }).join(' ');
    expect(a).toContain('out_color_matrix=bt709');
    expect(a).toContain('-colorspace bt709 -color_primaries bt709 -color_trc bt709');
    expect(a).toContain('-pix_fmt yuva420p');
    expect(a).toContain('alpha_mode=1');
    expect(a).toContain('-protocol_whitelist pipe,file');
    expect(madePlateArgs('a.webm', 'b.webm').slice(0, 10)).toContain('libvpx-vp9'); // decoder named before -i: the native one drops alpha
  });

  it('encodes a transparent clip: VP9 with alpha, exact frame count, the drawn pixels come back within the tolerances (measured numbers kept)', async () => {
    const frames = pngs(half, 12);
    expect(frames).toHaveLength(12);
    const { out, analysis } = await encode(frames, 'half.webm');
    expect(analysis).toMatchObject({ frames: 12, alpha: true, drawnFrames: 12, emptyEnds: { first: false, last: false } });
    expect(analysis.flash.black.general).toBeLessThanOrEqual(3);
    const v = (await ffprobe(out)).streams[0];
    expect(v.codec_name).toBe('vp9');
    expect(videoHasAlpha(v)).toBe(true);
    expect(v.color_space).toBe('bt709');
    const check = await checkMadeFile(out, { width: W, height: H, rate, frames: 12, alpha: true, samples: [0, 6, 11].map((f) => ({ frame: f, png: frames[f]! })) });
    expect(check.ok, JSON.stringify(check)).toBe(true);
    if (check.ok) for (const c of check.compared) {
      console.log(`made decode-back (one run, 64x48 synthetic): frame ${c.frame} alpha mean ${c.alphaMean.toFixed(3)}, coverage ${c.coverageA.toFixed(4)}/${c.coverageB.toFixed(4)}, rgb mean ${c.rgbMean.toFixed(3)} (tolerance ${MADE_RGB_TOLERANCE})`);
      expect(Math.abs(c.coverageA - c.coverageB)).toBeLessThanOrEqual(0.01);
    }
  }, 120_000);

  it('a full-frame plate is found opaque and re-encodes without alpha', async () => {
    const frames = pngs(`color=c=0x1d2a44:s=${W}x${H}:r=30,format=rgba`, 6);
    const { out, analysis } = await encode(frames, 'plate-a.webm');
    expect(analysis.alpha).toBe(false);
    const plate = path.join(dir, 'plate.webm');
    await runMadeFfmpeg(madePlateArgs(out, plate));
    const v = (await ffprobe(plate)).streams[0];
    expect(videoHasAlpha(v)).toBe(false);
    expect(v.pix_fmt).toBe('yuv420p');
    const check = await checkMadeFile(plate, { width: W, height: H, rate, frames: 6, alpha: false, samples: [{ frame: 0, png: frames[0]! }] });
    expect(check.ok, JSON.stringify(check)).toBe(true);
  }, 120_000);

  it('an empty clip draws no frame (made_empty is the job\'s)', async () => {
    const { analysis } = await encode(pngs(`color=c=black@0:s=${W}x${H}:r=30,format=rgba,geq=r=0:g=0:b=0:a=0`, 4), 'empty.webm');
    expect(analysis.drawnFrames).toBe(0);
    expect(analysis.framesWithPixels).toBe(0);
    expect(analysis.emptyEnds).toEqual({ first: true, last: true });
  }, 120_000);

  it('a small drawing is not empty (proof:made G4.4: a 10×10 square on 640×360 is below the 0.1% share but was drawn)', async () => {
    const { analysis } = await encode(pngs(`color=c=black@0:s=${W}x${H}:r=30,format=rgba,geq=r=255:g=255:b=255:a='if(lt(X,1)*lt(Y,1),255,0)'`, 3), 'dot.webm');
    expect(analysis.drawnFrames).toBe(0); // under the share: reported as a near-empty frame
    expect(analysis.framesWithPixels).toBe(3); // but something was drawn: not made_empty
  }, 120_000);

  it('white and transparent every 2 frames at 30 fps measures above 3 flashes a second over black (a warning, decision 3)', async () => {
    const { analysis } = await encode(pngs(`color=c=white:s=${W}x${H}:r=30,format=rgba,geq=r=255:g=255:b=255:a='if(lt(mod(N,4),2),255,0)'`, 45), 'flash.webm');
    console.log(`made flash (one run, synthetic): over black ${JSON.stringify(analysis.flash.black)}, over white ${JSON.stringify(analysis.flash.white)}`);
    expect(analysis.flash.black.general).toBeGreaterThan(3);
    expect(analysis.flash.white.general).toBeLessThanOrEqual(3); // white over white does not change
  }, 120_000);

  it('a 30000/1001 clip keeps its rate and frame count', async () => {
    const r = { num: 30000, den: 1001 };
    const frames = pngs(half.replace('r=30', 'r=30000/1001'), 9);
    const { out } = await encode(frames, 'ntsc.webm', r);
    const check = await checkMadeFile(out, { width: W, height: H, rate: r, frames: 9, alpha: true, samples: [{ frame: 4, png: frames[4]! }] });
    expect(check.ok, JSON.stringify(check)).toBe(true);
  }, 120_000);

  it('the file check fails on a wrong frame count and on a file that lost its alpha', async () => {
    const frames = pngs(half, 6);
    const { out } = await encode(frames, 'six.webm');
    const wrong = await checkMadeFile(out, { width: W, height: H, rate, frames: 7, alpha: true, samples: [] });
    expect(wrong).toMatchObject({ ok: false, why: 'frameCount', got: 6, want: 7 });
    const flat = path.join(dir, 'flat.webm'); // the alpha dropped (as the native decoder would)
    await runMadeFfmpeg(['-v', 'error', '-i', out, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-y', flat]);
    const lost = await checkMadeFile(flat, { width: W, height: H, rate, frames: 6, alpha: true, samples: [{ frame: 0, png: frames[0]! }] });
    expect(lost.ok).toBe(false);
  }, 120_000);

  it('a file converted with the default (BT.601) matrix but tagged BT.709 fails the colour comparison (why the encode names the matrix)', async () => {
    const frames = pngs(half, 3);
    const src = path.join(dir, 'src-%03d.png');
    frames.forEach((f, i) => fs.writeFileSync(src.replace('%03d', String(i).padStart(3, '0')), f));
    const wrong = path.join(dir, 'bt601.webm');
    await runMadeFfmpeg(['-v', 'error', '-framerate', '30', '-i', src, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '20', '-b:v', '0', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-metadata:s:v:0', 'alpha_mode=1', '-y', wrong]);
    const check = await checkMadeFile(wrong, { width: W, height: H, rate, frames: 3, alpha: true, samples: [{ frame: 0, png: frames[0]! }] });
    console.log(`made decode-back of a BT.601-converted file (one run): ${JSON.stringify(check)}`);
    expect(check).toMatchObject({ ok: false, why: 'decodeBack' });
  }, 120_000);

  it('compares pixels: alpha, coverage, colour; and counts differing pixels', async () => {
    const a = new Uint8Array([10, 20, 30, 255, 0, 0, 0, 0]);
    const b = new Uint8Array([10, 20, 30, 255, 0, 0, 0, 200]);
    const c = compareRgba(a, b, 3, 2);
    expect(c).toMatchObject({ frame: 3, alphaMean: 100, coverageA: 0.5, coverageB: 1, blocks: 0 });
    expect(frameFails(c)).toBe(true);
    const [p0, p1] = pngs(half, 2);
    expect(await differingPixels(p0!, p0!)).toBe(0);
    expect(await differingPixels(p0!, p1!)).toBeGreaterThan(0);
  }, 60_000);
});
