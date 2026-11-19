import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { flashCells } from '@pulseframe/engine';
import { FrameFlashCheck, reportFromCells } from './flashCheck.ts';

const W = 64, H = 36, R = { num: 30, den: 1 };
const frame = (v: number) => new Uint8Array(W * H * 4).fill(v).map((x, i) => (i % 4 === 3 ? 255 : x));
const batch = (frames: Uint8Array[]) => { const out = new Uint8Array(frames.length * W * H * 4); frames.forEach((f, i) => out.set(f, i * W * H * 4)); return out; };

describe('photosensitivity check of an export', () => {
  it('a stretch of five flashes a second is reported in timeline time; batches of any size give the same report', () => {
    const black = frame(0), white = frame(255), grey = frame(90);
    // 2 s grey, 2 s of black/white every 3 frames (5 flashes a second), 2 s grey; the export starts at timeline frame 300
    const frames = Array.from({ length: 180 }, (_, k) => (k >= 60 && k < 120 ? (Math.floor(k / 3) % 2 ? white : black) : grey));
    const a = new FrameFlashCheck(W, H, R);
    a.feed(batch(frames));
    const b = new FrameFlashCheck(W, H, R);
    for (let i = 0; i < frames.length; i += 7) b.feed(batch(frames.slice(i, i + 7)));
    const ra = a.report(300), rb = b.report(300);
    expect(ra).toEqual(rb);
    expect(ra.verdict).toBe('fail');
    expect(ra.frames).toBe(180);
    expect(ra.ranges).toHaveLength(1);
    const range = ra.ranges[0]!;
    expect(range.kind).toBe('general');
    expect(range.flashesPerSecond).toBeGreaterThanOrEqual(4);
    expect(T.toSeconds(range.from)).toBeGreaterThanOrEqual(10 + 1); // not before the flashing starts at timeline 12 s, less the one-second window
    expect(T.toSeconds(range.to)).toBeLessThanOrEqual(14 + 1);
    expect(range.area).toBe(1);
  });
  it('slow changes pass', () => {
    const a = new FrameFlashCheck(W, H, R);
    a.feed(batch(Array.from({ length: 150 }, (_, k) => frame(Math.floor(k / 15) % 2 ? 255 : 0)))); // one change every half second
    expect(a.report(0)).toMatchObject({ verdict: 'pass', ranges: [] });
  });
  it('reportFromCells (ADR-0024): cells of every frame in order give the single-pass report, also when a flash sequence straddles segment joins', () => {
    const black = frame(0), white = frame(255), grey = frame(90);
    // strobe from frame 50 to 130: across joins at 60 and 120 of a 60-frame grid
    const frames = Array.from({ length: 180 }, (_, k) => (k >= 50 && k < 130 ? (Math.floor(k / 3) % 2 ? white : black) : grey));
    const single = new FrameFlashCheck(W, H, R);
    single.feed(batch(frames));
    // the cells as a segmented export gathers them: per segment, stored or fresh, then all programme frames in order
    const segments = [frames.slice(0, 60), frames.slice(60, 120), frames.slice(120)].map((seg) => seg.map((f) => flashCells(f, W, H)));
    const fromCells = reportFromCells(segments.flat(), R, 300);
    expect(fromCells).toEqual(single.report(300));
    expect(fromCells.verdict).toBe('fail');
    // per segment the strobe is shorter, but the whole-film verdict is not the sum of per-segment verdicts
    expect(reportFromCells(segments[0]!, R, 300).frames).toBe(60);
  });
});
