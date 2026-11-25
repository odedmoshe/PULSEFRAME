/**
 * Built-in music with an exact ending (wave 7 musicfit, decisions §2.2–2.3; builder A): a track of exactly L sample frames is K whole
 * bars and an ending of 2 to 6 beats. Measured here: the file's length in frames, the arranger's ending notes (onset K·bar, gate
 * endFrames, nothing later), the level of the held chord in the 100 ms before the two-beat fade and the trailing digital silence,
 * the bytes of the default ending (unchanged), determinism, the queue key, the name and params of the stored file. Nobody here listens.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { exactLayoutFor, knownGridOf, MUSICFIT, musicLayout, sampleFramesFor } from '@pulseframe/core';
import { createMusicQueue, exactEnding, makeMusic, musicFileName, resolveMusicRequest, validateMusic } from './music.ts';
import { arrange, ENDING_T60, endingT60 } from './music/arrange.ts';
import { compose } from './music/compose.ts';
import { renderMusic } from './music/render.ts';
import { styleSpec } from './music/styles.ts';
import { readWavSamples } from './music/wav.ts';
import { Store } from './store.ts';

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
const rms = (s: Int16Array, from: number, to: number) => { let e = 0; for (let n = 2 * from; n < 2 * to; n++) e += s[n]! * s[n]!; return Math.sqrt(e / Math.max(1, 2 * (to - from))) / 32768; };
/** Frames of trailing digital silence (both channels exactly 0). */
const trailingSilence = (s: Int16Array) => { let n = s.length / 2; while (n > 0 && s[2 * n - 1] === 0 && s[2 * n - 2] === 0) n--; return s.length / 2 - n; };

describe('the arranger of an exact ending', () => {
  it('every ending note starts at K·bar with gate endFrames, and no note starts later (three styles, lengths from the minimum to 40 s)', () => {
    for (const id of ['music.cinematic', 'music.birthday', 'music.pop']) {
      const spec = styleSpec(id);
      for (const seconds of [11.7, 13.37, 20, 29.97, 40]) {
        const L = sampleFramesFor(T.rt(Math.round(seconds * 1000), 1000));
        let k: { bars: number; endFrames: number };
        try { k = exactLayoutFor(id, L); } catch { continue; } // shorter than the style's minimum
        const layout = musicLayout(id, k.bars, k.endFrames);
        expect(layout.totalFrames).toBe(L);
        const K = k.bars - 1, bar = 4 * layout.samplesPerBeat;
        const notes = arrange(spec, layout, compose(spec, layout, 3), 3);
        const ending = notes.filter((n) => n.at >= K * bar);
        expect(ending.length).toBeGreaterThan(0);
        expect(ending.every((n) => n.at === K * bar)).toBe(true);
        const held = ending.filter((n) => n.voice.kind !== 'kick' && n.voice.kind !== 'crash');
        expect(held.every((n) => n.gate === k.endFrames)).toBe(true);
        expect(layout.beats.every((b) => T.lt(b, layout.duration))).toBe(true);
      }
    }
  });
  it('the ending ring time: ENDING_T60 for one bar (bytes unchanged), six times the hold before the fade otherwise', () => {
    const one = musicLayout('music.cinematic', 8);
    expect(endingT60(one)).toBe(ENDING_T60);
    const six = musicLayout('music.cinematic', 8, 6 * 40000);
    expect(endingT60(six)).toBeCloseTo((6 * 4 * 40000) / 48000, 12);
    expect(endingT60(musicLayout('music.pop', 8, 2 * 22500))).toBe(ENDING_T60);
  });
});

describe('renderMusic with endFrames', () => {
  it('the default ending (absent or one bar) gives the same bytes', async () => {
    const a = await renderMusic('music.birthday', 4, 2);
    const b = await renderMusic('music.birthday', 4, 2, { endFrames: 4 * 24000 });
    expect(a.wav.equals(b.wav)).toBe(true);
  });
  it('an exact ending: exactly L frames, valid, the same bytes twice; the held chord in the 100 ms before the fade and the trailing silence measured', async () => {
    const rows: string[] = [];
    for (const [id, seconds] of [['music.cinematic', 14.95], ['music.birthday', 9.03], ['music.pop', 12.1]] as const) {
      const L = sampleFramesFor(T.rt(Math.round(seconds * 1000), 1000));
      const { bars, endFrames } = exactLayoutFor(id, L);
      const r = await renderMusic(id, bars, 1, { endFrames });
      expect(r.layout.totalFrames).toBe(L);
      expect(r.wav.length).toBe(44 + 4 * L);
      validateMusic(r);
      const again = await renderMusic(id, bars, 1, { endFrames });
      expect(again.wav.equals(r.wav)).toBe(true);
      const s = readWavSamples(r.wav), S = r.layout.samplesPerBeat, fadeFrom = L - 2 * S;
      const before = db(rms(s, fadeFrom - 4800, fadeFrom));
      const silenceMs = (trailingSilence(s) * 1000) / 48000;
      rows.push(`${id} ${seconds} s: ending ${(endFrames / S).toFixed(2)} beats; RMS of the 100 ms before the fade ${before.toFixed(1)} dBFS; trailing digital silence ${silenceMs.toFixed(2)} ms`);
      expect(before).toBeGreaterThanOrEqual(MUSICFIT.fadeRmsMinDbfs);
      expect(silenceMs).toBeLessThanOrEqual(MUSICFIT.trailSilenceMaxMs);
    }
    console.log(rows.join('\n'));
  }, 120_000);
  it('the longest ending of the slowest style (just under 6 beats at 72 BPM) keeps the held chord above −45 dBFS before the fade', async () => {
    const { bars, endFrames } = exactLayoutFor('music.cinematic', 3 * 160000 + 6 * 40000 - 1);
    expect(endFrames).toBe(6 * 40000 - 1);
    const r = await renderMusic('music.cinematic', bars, 4, { endFrames });
    const s = readWavSamples(r.wav), fadeFrom = r.layout.totalFrames - 80000;
    const before = db(rms(s, fadeFrom - 4800, fadeFrom));
    console.log(`music.cinematic, ending ${endFrames} frames: RMS of the 100 ms before the fade ${before.toFixed(1)} dBFS`);
    expect(before).toBeGreaterThanOrEqual(MUSICFIT.fadeRmsMinDbfs);
  }, 60_000);
});

describe('the server half', () => {
  let dir: string, store: Store;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-music-exact-')); store = new Store(dir); });
  afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('a request with endFrames is made (no 501); one bar is today\'s request; endFrames with fitSeconds stays 400', () => {
    const r = resolveMusicRequest({ styleId: 'music.birthday', bars: 10, endFrames: 60000, seed: 1 });
    expect([r.layout.totalFrames, exactEnding(r.layout)]).toEqual([9 * 96000 + 60000, 60000]);
    expect(exactEnding(resolveMusicRequest({ styleId: 'music.birthday', bars: 10, endFrames: 96000, seed: 1 }).layout)).toBeUndefined();
    expect(() => resolveMusicRequest({ styleId: 'music.birthday', fitSeconds: '8', endFrames: 60000, seed: 1 })).toThrow(expect.objectContaining({ status: 400, code: 'invalid_option' }));
    expect(() => resolveMusicRequest({ styleId: 'music.birthday', bars: 10, endFrames: 30000, seed: 1 })).toThrow(expect.objectContaining({ status: 400, code: 'invalid_option' }));
  });
  it('the name says the whole bars and the ending; the default name is unchanged', () => {
    const style = { name: { he: 'x', en: 'Cheerful birthday' } };
    expect(musicFileName(style, musicLayout('music.birthday', 10))).toBe('Cheerful birthday · 10 bars.wav');
    expect(musicFileName(style, musicLayout('music.birthday', 10, 67_200))).toBe('Cheerful birthday · 9 bars + ending 1.4 s.wav');
  });
  it('the queue keys an exact ending apart from the default and passes it to the renderer', async () => {
    const seen: (number | undefined)[] = [];
    const q = createMusicQueue({}, async (id, bars, seed, opts) => { seen.push(opts.endFrames); return renderMusic(id, bars, seed, opts); });
    const a = await q.render('music.pop', 4, 1, 'preview');
    const b = await q.render('music.pop', 4, 1, 'preview', undefined, 2 * 22500);
    expect(seen).toEqual([undefined, 45000]);
    expect(a.layout.totalFrames).toBe(4 * 90000);
    expect(b.layout.totalFrames).toBe(3 * 90000 + 45000);
  });
  it('makeMusic stores an exact track: duration exact, params.end, the known grid of its layout, a name with the ending', async () => {
    const q = createMusicQueue();
    const made = await makeMusic(store, { styleId: 'music.birthday', bars: 5, endFrames: 60000, seed: 2 }, 'owner', q);
    expect(made.asset.duration).toEqual(T.rt(4 * 96000 + 60000, 48000));
    expect(made.asset.byteSize).toBe(44 + 4 * (4 * 96000 + 60000));
    expect(made.asset.provenance.procedural?.params).toEqual({ bars: 5, seed: 2, bpm: 120, meter: 4, synth: 1, end: 60000 });
    expect(made.asset.name).toBe('Cheerful birthday · 4 bars + ending 1.3 s.wav');
    expect(made.grid).toEqual(knownGridOf(made.layout, 2, made.asset.provenance.importedAt));
    const plain = await makeMusic(store, { styleId: 'music.birthday', bars: 5, endFrames: 96000, seed: 2 }, 'owner', q);
    expect(plain.asset.name).toBe('Cheerful birthday · 5 bars.wav');
    expect(plain.asset.provenance.procedural?.params).toEqual({ bars: 5, seed: 2, bpm: 120, meter: 4, synth: 1 });
  }, 60_000);
});
