/**
 * Built-in music styles and layouts (ADR-0022, core musicStyles.ts): the arithmetic every track is made to, and the form
 * rules of plan §4.5, for every style and every bar count from 4 to 64. Pure: nothing is synthesised here.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  barsForDuration, findMusicStyle, knownGridOf, KnownGridSchema, listMusicStyles, MUSIC_BPMS, MUSIC_MAX_SECONDS, MUSIC_METHOD, MUSIC_SAMPLE_RATE, MUSIC_STYLES, MUSIC_SYNTH_VERSION,
  MUSIC_UNHEARD_LABEL, maxMusicBars, musicLayout, summarizeMusicStyle,
} from './index.ts';

/** The form of plan §4.5 written out again, independently of musicLayout: [kind, level, bars] runs. */
function expectedForm(N: number): [string, number, number][] {
  const I = N >= 24 ? 4 : N >= 12 ? 2 : N >= 6 ? 1 : 0;
  const body = N - I - 1;
  const c = Math.max(1, Math.round(body / 16)); // halves round up (body/16 = x.5 only for body = 8, 24, 40 …)
  const out: [string, number, number][] = [];
  if (I) out.push(['intro', 0, I]);
  for (let j = 0; j < c; j++) {
    const L = Math.floor(body / c) + (j < body % c ? 1 : 0);
    const build = Math.max(1, Math.floor((3 * L) / 8));
    const brk = j > 0 && L >= 8 ? 2 : 0;
    if (brk) out.push(['break', 0, brk]);
    if (build - brk > 0) out.push(['build', 1, build - brk]);
    out.push(['peak', j === c - 1 ? 3 : 2, L - build]);
  }
  out.push(['ending', 3, 1]);
  return out.filter((x) => x[2] > 0);
}

describe('styles', () => {
  it('six styles, every tempo a whole number of samples a beat, every one unheard until the owner listens', () => {
    expect(MUSIC_STYLES.map((s) => s.id)).toEqual(['music.festive', 'music.birthday', 'music.calm', 'music.pop', 'music.lofi', 'music.cinematic']);
    for (const b of MUSIC_BPMS) expect((MUSIC_SAMPLE_RATE * 60) % b).toBe(0);
    for (const s of MUSIC_STYLES) {
      expect(MUSIC_BPMS).toContain(s.bpm);
      expect(s.review).toBe('unheard');
      expect(s.meter).toBe(4);
      expect(findMusicStyle(s.id)).toBe(s);
      const sum = summarizeMusicStyle(s);
      expect(sum.label).toEqual(MUSIC_UNHEARD_LABEL);
      expect(sum.bytesPerBar).toBe(16 * (2_880_000 / s.bpm));
      expect(sum.barSeconds).toBe(240 / s.bpm);
      expect(sum.maxBars).toBe(maxMusicBars(s));
      expect((240 * sum.maxBars) / s.bpm).toBeLessThanOrEqual(MUSIC_MAX_SECONDS);
      expect((240 * (sum.maxBars + 1)) / s.bpm).toBeGreaterThan(MUSIC_MAX_SECONDS);
    }
    expect(listMusicStyles()).toHaveLength(6);
    expect(findMusicStyle('music.nothing')).toBeUndefined();
  });
});

describe('musicLayout: exact timing and the form for 4..64 bars', () => {
  it.each(MUSIC_STYLES.map((s) => s.id))('%s', (id) => {
    const style = findMusicStyle(id)!;
    for (let N = style.minBars; N <= Math.min(64, maxMusicBars(style)); N++) {
      const L = musicLayout(id, N);
      const S = 2_880_000 / style.bpm;
      expect([L.bars, L.bpm, L.meter, L.samplesPerBeat, L.totalFrames, L.version]).toEqual([N, style.bpm, 4, S, 4 * N * S, style.version]);
      expect(T.eq(L.duration, T.rt(240 * N, style.bpm))).toBe(true);
      expect(T.eq(L.duration, T.rt(L.totalFrames, MUSIC_SAMPLE_RATE))).toBe(true);
      expect(L.beats).toHaveLength(4 * N);
      L.beats.forEach((b, k) => expect(T.eq(b, T.rt(60 * k, style.bpm))).toBe(true));
      expect(L.downbeats).toEqual(L.beats.filter((_, k) => k % 4 === 0));
      // sections: contiguous from bar 0 to the end, the ending one bar at level 3, as plan §4.5 says
      expect(L.sections.map((s) => [s.kind, s.level, s.bars])).toEqual(expectedForm(N));
      let bar = 0;
      for (const s of L.sections) {
        expect(s.startBar).toBe(bar);
        expect(T.eq(s.start, T.rt(240 * bar, style.bpm))).toBe(true);
        bar += s.bars;
      }
      expect(bar).toBe(N);
      const last = L.sections.at(-1)!;
      expect([last.kind, last.bars, last.level]).toEqual(['ending', 1, 3]);
      const peaks = L.sections.filter((s) => s.kind === 'peak');
      expect(peaks.length).toBeGreaterThanOrEqual(1);
      expect(peaks.at(-1)!.level).toBe(3);
      expect(L.sections.filter((s) => s.kind === 'intro').reduce((a, s) => a + s.bars, 0)).toBe(N >= 24 ? 4 : N >= 12 ? 2 : N >= 6 ? 1 : 0);
      // every section start is a bar start, and lies inside the track
      for (const s of L.sections) expect(L.downbeats.some((d) => T.eq(d, s.start))).toBe(true);
      // the known grid of the layout is valid as the schema reads it
      const grid = knownGridOf(L, 7, '2026-11-17T00:00:00Z');
      expect(KnownGridSchema.parse(grid)).toEqual(grid);
      expect(grid.method).toBe(MUSIC_METHOD);
      expect(grid.params).toEqual({ styleId: id, version: style.version, bars: N, seed: 7, bpm: style.bpm, meter: 4, synth: MUSIC_SYNTH_VERSION });
    }
  });
  it('the plan\'s example: 16 bars are intro 0–2, build 2–6, peak 6–15, ending 15–16; and a later cycle opens with a break', () => {
    expect(musicLayout('music.pop', 16).sections.map((s) => [s.kind, s.startBar, s.startBar + s.bars])).toEqual([['intro', 0, 2], ['build', 2, 6], ['peak', 6, 15], ['ending', 15, 16]]);
    const long = musicLayout('music.pop', 64).sections;
    expect(long.filter((s) => s.kind === 'break').length).toBeGreaterThan(0);
    expect(long.filter((s) => s.kind === 'peak').map((s) => s.level)).toEqual([...Array(long.filter((s) => s.kind === 'peak').length - 1).fill(2), 3]);
  });
  it('refuses what cannot be made: an unknown style, fewer bars than the minimum, part bars, more than 300 s', () => {
    expect(() => musicLayout('music.none', 8)).toThrow(RangeError);
    expect(() => musicLayout('music.pop', 3)).toThrow(RangeError);
    expect(() => musicLayout('music.pop', 4.5)).toThrow(RangeError);
    expect(() => musicLayout('music.cinematic', 91)).toThrow(/at most 300 s/);
    expect(musicLayout('music.cinematic', 90).totalFrames).toBe(90 * 4 * 40_000); // exactly 300 s
  });
});

describe('barsForDuration', () => {
  it('rounds up to whole bars in exact arithmetic, never below the style\'s minimum', () => {
    expect(barsForDuration('music.birthday', T.rt(10, 1))).toBe(5); // 10 · 120 / 240 = 5 exactly
    expect(barsForDuration('music.birthday', T.rt(10_000_001, 1_000_000))).toBe(6); // a microsecond more is a bar more
    expect(barsForDuration('music.cinematic', T.rt(40, 3))).toBe(4); // 4 bars at 72 BPM are 40/3 s
    expect(barsForDuration('music.cinematic', T.rt(41, 3))).toBe(5);
    expect(barsForDuration('music.festive', T.ZERO)).toBe(4);
    for (const s of MUSIC_STYLES) for (let N = s.minBars; N <= 40; N++) expect(barsForDuration(s.id, musicLayout(s.id, N).duration)).toBe(N);
    expect(() => barsForDuration('music.none', T.rt(1, 1))).toThrow(RangeError);
    expect(() => barsForDuration('music.pop', T.rt(-1, 1))).toThrow(RangeError);
  });
});
