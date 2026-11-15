import { describe, expect, it } from 'vitest';
import { BEAT_SR, detectBeats, estimateBars } from './beats.ts';
import { beatF1, drumLoop } from './beats.fixtures.ts';

describe('beat tracking (synthetic drum loops)', () => {
  it.each([[90], [100], [120], [128], [140]])('finds %d BPM and its beat positions', (bpm) => {
    const { x, beats } = drumLoop(() => bpm, 24);
    const r = detectBeats(x);
    expect(Math.abs(r.bpm! - bpm)).toBeLessThan(1.5);
    expect(beatF1(r.beats, beats).f1).toBeGreaterThan(0.92);
    expect(r.confidence).toBeGreaterThan(0.2);
  });
  it('follows a slow tempo drift (120 → 127 BPM)', () => {
    const { x, beats } = drumLoop((t) => 120 + (7 * t) / 24, 24);
    expect(beatF1(detectBeats(x).beats, beats).f1).toBeGreaterThan(0.9);
  });
  it('beat times are accurate to about one analysis hop', () => {
    const { x, beats } = drumLoop(() => 120, 24);
    const found = detectBeats(x).beats;
    const errs = beats.map((b) => Math.min(...found.map((f) => Math.abs(f - b))));
    errs.sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length / 2)]).toBeLessThan(0.015);
  });
  it('is deterministic and reports nothing for silence or very short audio', () => {
    const { x } = drumLoop(() => 120, 12);
    expect(detectBeats(x)).toEqual(detectBeats(x));
    expect(detectBeats(new Float32Array(BEAT_SR * 10)).beats.length).toBeLessThanOrEqual(1);
    expect(detectBeats(new Float32Array(BEAT_SR * 10)).confidence).toBe(0);
    expect(detectBeats(new Float32Array(BEAT_SR * 2))).toEqual({ bpm: null, confidence: 0, beats: [], downbeats: [], meter: null, barConfidence: 0 });
  });
});

describe('bars (synthetic drum loops with an accent on the first beat of the bar)', () => {
  const near = (found: number[], truth: number[], tol = 0.07) => found.filter((x) => truth.some((t) => Math.abs(t - x) <= tol)).length;
  it('four beats to the bar: the accented beats are reported as bar starts, whatever beat the recording starts on', () => {
    for (const [bpm, first] of [[120, 0.37], [96, 0.2], [140, 0.5]] as const) {
      const { x, downbeats } = drumLoop(() => bpm, 30, first, 3, 4);
      const r = detectBeats(x);
      expect(r.meter, `${bpm} BPM`).toBe(4);
      expect(r.barConfidence).toBeGreaterThanOrEqual(0.9);
      expect(near(r.downbeats, downbeats) / r.downbeats.length, `${bpm} BPM precision`).toBeGreaterThanOrEqual(0.95);
      expect(near(r.downbeats, downbeats) / downbeats.length, `${bpm} BPM recall`).toBeGreaterThanOrEqual(0.85);
    }
  });
  it('three beats to the bar is recognised as three', () => {
    const { x, downbeats } = drumLoop(() => 132, 30, 0.3, 5, 3);
    const r = detectBeats(x);
    expect(r.meter).toBe(3);
    expect(near(r.downbeats, downbeats) / r.downbeats.length).toBeGreaterThanOrEqual(0.95);
  });
  it('a loop with no accent gets no bars rather than a guess; every bar start is one of the beats', () => {
    const plain = detectBeats(drumLoop(() => 120, 30).x);
    expect([plain.meter, plain.downbeats.length, plain.barConfidence]).toEqual([null, 0, 0]);
    const r = detectBeats(drumLoop(() => 120, 30, 0.37, 3, 4).x);
    expect(r.downbeats.every((d) => r.beats.includes(d))).toBe(true);
  });
  it('the bar estimate needs the accent in at least 70 % of the bars', () => {
    const bars = (weak: number) => Array.from({ length: 40 }, (_, i) => (i % 4 === 1 ? (Math.floor(i / 4) < weak ? 0.5 : 3) : 1 + (i % 3) * 0.1));
    expect(estimateBars(bars(0))).toMatchObject({ meter: 4, phase: 1 });
    expect(estimateBars(bars(2))).toMatchObject({ meter: 4, phase: 1 });
    expect(estimateBars(bars(5))).toBeNull();
    expect(estimateBars([1, 2, 3])).toBeNull();
  });
});

describe('beat tracking of a file in consecutive windows', () => {
  it('a 48-second loop analysed in 12-second windows gives one continuous grid: the same beats as the reference, no doubles at the window edges', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const { detectBeatsOfFile } = await import('./analysis.ts');
    const { x, beats } = drumLoop(() => 120, 48);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-beatwin-'));
    try {
      const wav = Buffer.alloc(44 + x.length * 2);
      wav.write('RIFF', 0); wav.writeUInt32LE(36 + x.length * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(BEAT_SR, 24); wav.writeUInt32LE(BEAT_SR * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(x.length * 2, 40);
      for (let i = 0; i < x.length; i++) wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i]! * 30000))), 44 + i * 2);
      const file = path.join(dir, 'loop.wav');
      fs.writeFileSync(file, wav);
      const whole = await detectBeatsOfFile(file, 0, 48, 1200);
      const windowed = await detectBeatsOfFile(file, 0, 48, 12);
      expect([whole.windows, windowed.windows]).toEqual([1, 4]);
      expect(Math.abs(windowed.bpm! - 120)).toBeLessThan(1.5);
      expect(beatF1(windowed.beats, beats).f1).toBeGreaterThan(0.9);
      expect(Math.abs(windowed.beats.length - whole.beats.length)).toBeLessThanOrEqual(4);
      const gaps = windowed.beats.slice(1).map((b, i) => b - windowed.beats[i]!);
      expect(Math.min(...gaps)).toBeGreaterThan(0.3); // no doubled beat where two windows meet
      expect(Math.max(...gaps)).toBeLessThan(1.1); // and no hole wider than two beats
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});

