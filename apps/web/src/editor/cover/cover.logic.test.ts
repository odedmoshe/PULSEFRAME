/**
 * Logic of the «הפריים הכי חד» block and the «שמירת התמונה» dialog. LABELLED FIXTURES: the answers below are hand-made (not measured by
 * anything), and PAPER_STANDIN is a stand-in for core's printFit / defaultCrop / snapCrop (their bodies belong to W2) with the
 * documented formula; the real ones run at integration (proof U3).
 */
import { describe, expect, it } from 'vitest';
import { STILLS_LABEL, type Asset, type SharpAnswer, type StillCrop } from '@pulseframe/core';
import * as C from './cover.logic.ts';
import { coverT } from './cover.strings.ts';

const rate60 = { num: 60, den: 1 };
// FIXTURE: a 1920x1080 60 fps file of 1200 frames starting at its time zero
const asset = { id: 'a1', kind: 'video', name: 'x.mp4', duration: { value: '1200', timescale: 60 }, video: { width: 1920, height: 1080, frameRate: rate60, codec: 'h264', rotation: 0, frameCount: 1200 } } as unknown as Asset;
const photo = { id: 'p1', kind: 'image', name: 'p.jpg', duration: { value: '0', timescale: 1 }, image: { width: 3000, height: 2000, codec: 'mjpeg', hasAlpha: false } } as unknown as Asset;
const rec = (frame: number, sharp: number, o: Partial<{ sigma100: number; motion: number | null; hi: number; lo: number }> = {}) => ({ frame, sobel: sharp + 10, sigma100: o.sigma100 ?? 250, sharp, motion: o.motion === undefined ? 12 : o.motion, hi: o.hi ?? 20, lo: o.lo ?? 5 });
const answer = (): SharpAnswer => ({
  assetId: 'a1', from: 100, to: 104, measuredFrames: 3, complete: false, median: 200,
  candidates: [{ frame: 101, time: { value: '101', timescale: 60 }, sharp: 262, sobel: 272, sigma100: 250, sharpRatioPermille: 1310, motion: 12, hi: 20, lo: 5, manyClipped: false }],
  frames: [rec(100, 150, { motion: null }), rec(101, 262), rec(103, 90, { hi: 120 })],
  source: { width: 1920, height: 1080, rate: rate60, conformed: null }, method: 'm', label: STILLS_LABEL, heuristic: true,
});

describe('number words', () => {
  it('ratio, sigma and percent are integers formatted, not floats', () => {
    expect(C.ratioText(1310)).toBe('1.31'); expect(C.ratioText(995)).toBe('1.00'); expect(C.ratioText(1004)).toBe('1.00'); expect(C.ratioText(0)).toBe('0.00');
    expect(C.sigmaText(600)).toBe('6.00'); expect(C.sigmaText(5)).toBe('0.05');
    expect(C.percentText(125)).toBe('12.5'); expect(C.percentText(0)).toBe('0.0'); expect(C.percentText(1000)).toBe('100.0');
  });
  it('rates: 60, 59.94, 29.97, 24; equal rates do not differ', () => {
    expect(C.fpsText(rate60)).toBe('60'); expect(C.fpsText({ num: 60000, den: 1001 })).toBe('59.94'); expect(C.fpsText({ num: 30000, den: 1001 })).toBe('29.97'); expect(C.fpsText({ num: 24, den: 1 })).toBe('24');
    expect(C.ratesDiffer(rate60, { num: 30, den: 1 })).toBe(true); expect(C.ratesDiffer({ num: 60, den: 2 }, { num: 30, den: 1 })).toBe(false);
  });
});

describe('the numbers of a frame', () => {
  it('a candidate shows its own numbers; a stepped frame is the record against the same median; no record says so', () => {
    const a = answer();
    expect(C.frameNumbers(a, 101)).toMatchObject({ measured: true, ratioPermille: 1310, sharp: 262, sigma100: 250, motion: 12 });
    const stepped = C.frameNumbers(a, 103);
    expect(stepped).toMatchObject({ measured: true, ratioPermille: 450, hi: 120, manyClipped: true });
    expect(C.frameNumbers(a, 102)).toMatchObject({ measured: false, ratioPermille: null, sharp: null });
    expect(C.frameNumbers(a, 100)).toMatchObject({ firstFrame: true, motion: null });
    expect(C.frameNumbers(null, 5).measured).toBe(false);
  });
  it('no median (not complete): the ratio is absent, never invented', () => { expect(C.frameNumbers({ ...answer(), median: null }, 103).ratioPermille).toBeNull(); });
  it('recordOf finds by frame in the ascending list', () => { expect(C.recordOf(answer(), 103)?.sharp).toBe(90); expect(C.recordOf(answer(), 99)).toBeNull(); });
});

describe('stepping', () => {
  it('← one source frame earlier, → one later; Shift one second of the FILE (60 frames); kept inside the file', () => {
    expect(C.steppedFrame(500, 'ArrowRight', false, asset)).toBe(501); expect(C.steppedFrame(500, 'ArrowLeft', false, asset)).toBe(499);
    expect(C.steppedFrame(500, 'ArrowRight', true, asset)).toBe(560); expect(C.steppedFrame(30, 'ArrowLeft', true, asset)).toBe(0);
    expect(C.steppedFrame(1199, 'ArrowRight', false, asset)).toBe(1199); expect(C.steppedFrame(5, 'a', false, asset)).toBeNull();
  });
  it('the key hint names the later arrow in both languages', () => {
    for (const lang of ['he', 'en'] as const) expect(coverT(lang)('keyHint', { later: C.LATER_ARROW })).toContain(C.LATER_ARROW);
  });
});

describe('the job', () => {
  it('progress keeps its count; a finished job without an answer is a failure', () => {
    expect(C.stillsProgress('measuring sharpness 3/12')).toEqual({ done: 3, total: 12, percent: 25 }); expect(C.stillsProgress('measure')).toBeNull();
    expect(C.settledOf({ status: 'running' })).toEqual({ kind: 'open' }); expect(C.settledOf({ status: 'succeeded', output: { answer: answer() } }).kind).toBe('done');
    expect(C.settledOf({ status: 'succeeded', output: null }).kind).toBe('failed');
    expect(C.settledOf({ status: 'failed', error: { code: 'frame_count_mismatch', message: 'm' } })).toEqual({ kind: 'failed', code: 'frame_count_mismatch', message: 'm' });
    expect(C.settledOf({ status: 'canceled' }).kind).toBe('canceled');
  });
  it('panel states', () => {
    const a = { ...answer(), complete: true };
    expect(C.panelState({ kind: 'picture', measuring: false, refused: false, answer: null })).toBe('picture');
    expect(C.panelState({ kind: 'video', measuring: true, refused: true, answer: a })).toBe('measuring');
    expect(C.panelState({ kind: 'video', measuring: false, refused: true, answer: a })).toBe('refused');
    expect(C.panelState({ kind: 'video', measuring: false, refused: false, answer: a })).toBe('found');
    expect(C.panelState({ kind: 'video', measuring: false, refused: false, answer: answer() })).toBe('idle');
  });
  it('block kind', () => { expect(C.blockKind(asset)).toBe('video'); expect(C.blockKind(photo)).toBe('picture'); expect(C.blockKind(undefined)).toBe('none'); });
});

// STAND-IN (labelled): the documented formula of core printFit.ts and a naive snap; not core's bodies.
const PAPER_STANDIN: C.CropMath = {
  printFit: (crop, paper, o) => {
    const p = { '10x15': [1016, 1524], '13x18': [1270, 1778], a4: [2100, 2970] }[paper]!; const [W, H] = o === 'landscape' ? [p[1]!, p[0]!] : [p[0]!, p[1]!];
    const ppi = Math.floor(Math.min((crop.w * 254) / W!, (crop.h * 254) / H!));
    return { ppi, tier: ppi >= 300 ? 'dense' : ppi >= 200 ? 'usual' : ppi >= 150 ? 'borderline' : 'soft' };
  },
  defaultCrop: (w, h, paper, o) => { const r = { '10x15': 1016 / 1524, '13x18': 1270 / 1778, a4: 2100 / 2970 }[paper]!; const ar = o === 'landscape' ? 1 / r : r; const cw = Math.min(w, Math.floor(h * ar)), ch = Math.round(cw / ar); return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch }; },
  snapCrop: (c, w, h) => ({ ...c, x: Math.max(0, Math.min(c.x, w - c.w)), y: Math.max(0, Math.min(c.y, h - c.h)) }),
};
describe('the crop frame (stand-in paper maths)', () => {
  const size = { width: 1920, height: 1080 };
  const sel: C.Selection = { paper: '10x15', orientation: 'landscape' };
  const crop0: StillCrop = C.cropOf(sel, size, PAPER_STANDIN);
  it('whole frame needs no paper maths; a paper uses defaultCrop', () => { expect(C.cropOf({ paper: null, orientation: 'landscape' }, size)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 }); expect(crop0.w).toBe(1620); });
  it('arrows move 1 % of the picture, Shift 10 %, at least one pixel; other keys do nothing', () => {
    expect(C.moveStep(1920, false)).toBe(19); expect(C.moveStep(1920, true)).toBe(192); expect(C.moveStep(50, false)).toBe(1);
    const moved = C.movedCrop(crop0, 'ArrowLeft', false, size, sel, PAPER_STANDIN)!; expect(moved.x).toBe(crop0.x - 19); expect(moved.y).toBe(crop0.y);
    expect(C.movedCrop(crop0, 'ArrowDown', true, size, sel, PAPER_STANDIN)!.y).toBe(Math.min(crop0.y + 108, size.height - crop0.h));
    expect(C.movedCrop(crop0, 'a', false, size, sel, PAPER_STANDIN)).toBeNull(); expect(C.movedCrop(crop0, 'ArrowLeft', false, size, { paper: null, orientation: 'landscape' }, PAPER_STANDIN)).toBeNull();
  });
  it('+ and − resize keeping the shape and the centre', () => {
    const big = C.resizedCrop({ x: 400, y: 200, w: 800, h: 533 }, 1, size, sel, PAPER_STANDIN); const small = C.resizedCrop({ x: 400, y: 200, w: 800, h: 533 }, -1, size, sel, PAPER_STANDIN);
    expect(big.w).toBe(838); expect(small.w).toBe(762); expect(Math.abs(big.h / big.w - 533 / 800)).toBeLessThan(0.002);
    expect(big.x + big.w / 2).toBeCloseTo(800, 0);
    expect(C.resizeSign('+')).toBe(1); expect(C.resizeSign('-')).toBe(-1); expect(C.resizeSign('x')).toBeNull();
  });
  it('a drag moves by source pixels from where it began', () => { expect(C.draggedCrop(crop0, 10, 0, size, sel, PAPER_STANDIN).x).toBe(Math.min(crop0.x + 10, size.width - crop0.w)); });
  it('one ppi line per paper for the current crop (formula examples: 270 usual; A4 130 soft)', () => {
    const rows = C.ppiRows({ w: 1620, h: 1080 }, 'landscape', PAPER_STANDIN);
    expect(rows.map((r) => r.paper)).toEqual(['10x15', '13x18', 'a4']); expect(rows[0]).toMatchObject({ ppi: 270, tier: 'usual' });
    expect(C.ppiRows({ w: 1527, h: 1080 }, 'landscape', PAPER_STANDIN)[2]).toMatchObject({ ppi: 130, tier: 'soft' });
  });
  it('the frame is drawn in percent of the picture', () => { expect(C.cropBox({ x: 150, y: 0, w: 1620, h: 1080 }, size)).toEqual({ left: 7.8, top: 0, width: 84.4, height: 100 }); });
  it('the body: whole frame carries no crop; a paper carries crop, paper and orientation; never a date', () => {
    expect(C.stillBody('a1', 7, { paper: null, orientation: 'landscape' }, C.wholeCrop(size))).toEqual({ assetId: 'a1', sourceFrame: 7 });
    expect(C.stillBody('a1', 7, sel, crop0)).toEqual({ assetId: 'a1', sourceFrame: 7, crop: crop0, paper: '10x15', orientation: 'landscape' });
  });
});

describe('the standing notes', () => {
  it('always the pixel size and the browser reading, own colours and no date; conformed and untried only when true', () => {
    const keys = (n: C.StillNote[]) => n.map((x) => x.key);
    expect(keys(C.stillNotes(asset, { width: 1920, height: 1080 }, null))).toEqual(['fileSize', 'browserReading', 'ownColours', 'noDate']);
    const conf = { ...asset, conform: { reasons: ['hdr', 'rotation'] } } as unknown as Asset;
    expect(keys(C.stillNotes(conf, { width: 1920, height: 1080 }, null))).toEqual(['fileSize', 'browserReading', 'conformed', 'conformedHdr', 'ownColours', 'noDate']);
    expect(keys(C.stillNotes(asset, { width: 6000, height: 4001 }, null))).toContain('untriedSize'); expect(keys(C.stillNotes(asset, { width: 6000, height: 4000 }, null))).not.toContain('untriedSize');
    const viaAnswer = { ...answer(), source: { ...answer().source, conformed: ['codec'] } } as SharpAnswer;
    expect(keys(C.stillNotes(asset, { width: 10, height: 10 }, viaAnswer))).toContain('conformed');
  });
  it('a side over 8192 is said before asking (the refusal sentence); the file name keeps its extension', () => {
    expect(C.tooLargeSentence({ width: 9248, height: 6936 })).toContain('9248x6936'); expect(C.tooLargeSentence({ width: 8192, height: 100 })).toBeNull();
    expect(C.downloadName({ fileName: 'x · 00', format: 'jpeg' })).toBe('x · 00.jpg'); expect(C.downloadName({ fileName: 'x.png', format: 'png' })).toBe('x.png');
  });
});

describe('words', () => {
  it('no sentence of the block calls a frame or a print good, best or sharp as a verdict; Hebrew has no star', () => {
    const he = ['label', 'notByEye', 'oneClip', 'rule', 'foundNone', 'found', 'tier.dense', 'tier.usual', 'tier.borderline', 'tier.soft'].map((k) => coverT('he')(k, { n: 1 })).join(' ');
    expect(he).not.toMatch(/הכי טוב|★|⭐|מושלם/);
    const en = ['label', 'rule', 'tier.usual', 'foundNone'].map((k) => coverT('en')(k)).join(' ');
    expect(en).not.toMatch(/\b(best|perfect|good)\b|★/i);
  });
  it('the dialog\'s extra words exist in both languages', () => {
    for (const k of ['range', 'cropLabel', 'cropGrow', 'cropShrink', 'saved', 'close', 'reason.hdr', 'measureStopped']) for (const l of ['he', 'en'] as const) expect(coverT(l)(k, {}), `${l} ${k}`).not.toBe(k);
  });
});
