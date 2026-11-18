/**
 * The analysis of pnpm proof:fonts on drawn rectangles (no browser): a point in its zone passes; a point missing, misplaced
 * sideways, on the wrong side or in a fallback place fails; the control logic rejects what it must; the golden helpers.
 */
import { describe, expect, it } from 'vitest';
import { RULES, checkMark, compareGolden, controlRejects, penOriginRejects, duplicateHashes, GOLDEN_LINE, TASK_LINE, MARKS, EM, type Img } from './fonts-proof.ts';

const W = 600, H = 600;
const blank = (): Img => ({ w: W, h: H, d: new Uint8Array(W * H * 4) });
const rect = (m: Img, x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * W + x) * 4; m.d[i] = m.d[i + 1] = m.d[i + 2] = 255; m.d[i + 3] = 255; } return m; };
// a letter 100 px wide and 140 px tall: box x 250..349, y 200..339 (baseline row 339)
const letter = () => rect(blank(), 250, 200, 349, 339);
const withMark = (x0: number, y0: number, x1: number, y1: number) => rect(letter(), x0, y0, x1, y1);
const M = (cp: number) => MARKS.find((m) => m.cp === cp)!;

describe('checkMark', () => {
  it('passes a below-point under its letter and fails it above, beside or missing', () => {
    expect(checkMark(letter(), withMark(280, 350, 320, 370), M(0x5b7)).pass).toBe(true);
    expect(checkMark(letter(), withMark(280, 150, 320, 170), M(0x5b7)).pass).toBe(false);
    expect(checkMark(letter(), withMark(480, 350, 520, 370), M(0x5b7)).pass).toBe(false);
    const r = checkMark(letter(), letter(), M(0x5b7));
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/not drawn/);
  });
  it('holam above, dagesh inside, shin dot right, sin dot left', () => {
    expect(checkMark(letter(), withMark(260, 160, 290, 190), M(0x5b9)).pass).toBe(true);
    expect(checkMark(letter(), withMark(280, 350, 320, 370), M(0x5b9)).pass).toBe(false);
    // dagesh inside an empty counter: draw the letter with a hole in the alone picture
    const alone = letter(); for (let y = 250; y < 290; y++) for (let x = 280; x < 320; x++) { const i = (y * W + x) * 4; alone.d[i] = alone.d[i + 1] = alone.d[i + 2] = 0; }
    expect(checkMark(alone, rect({ ...alone, d: alone.d.slice() }, 290, 260, 310, 280), M(0x5bc)).pass).toBe(true);
    expect(checkMark(alone, rect({ ...alone, d: alone.d.slice() }, 290, 350, 310, 380), M(0x5bc)).pass).toBe(false);
    expect(checkMark(letter(), withMark(310, 170, 340, 195), M(0x5c1)).pass).toBe(true);
    expect(checkMark(letter(), withMark(255, 170, 285, 195), M(0x5c1)).pass).toBe(false);
    expect(checkMark(letter(), withMark(255, 170, 285, 195), M(0x5c2)).pass).toBe(true);
  });
  it('records the room each rule left', () => {
    const r = checkMark(letter(), withMark(280, 350, 320, 370), M(0x5b7));
    expect(r.margins.belowBaseline).toBe(350 - (339 - RULES.belowSlack * EM));
    expect(r.centreOffsetEm).toBeCloseTo(0, 1);
  });
});

describe('a point hanging off the letter\'s edge (drawn at the pen origin) is rejected', () => {
  it('below, beside and above the edges', () => {
    expect(checkMark(letter(), withMark(220, 350, 260, 370), M(0x5b7)).pass).toBe(false);
    expect(checkMark(letter(), withMark(340, 350, 380, 370), M(0x5b7)).pass).toBe(false);
    // a holam belongs at the upper left corner (its centre on the left edge, as every catalogue face draws it); on the right edge it is rejected
    expect(checkMark(letter(), withMark(235, 160, 265, 190), M(0x5b9)).pass).toBe(true);
    expect(checkMark(letter(), withMark(335, 160, 365, 190), M(0x5b9)).pass).toBe(false);
    expect(checkMark(letter(), withMark(280, 350, 320, 370), M(0x5b7)).pass).toBe(true);
    expect(checkMark(letter(), withMark(260, 160, 290, 190), M(0x5b9)).pass).toBe(true);
  });
  it('a holam is judged by its side, not by its distance from the middle: below the letter or past the ink box it still fails', () => {
    expect(checkMark(letter(), withMark(235, 350, 265, 370), M(0x5b9)).pass).toBe(false);
    expect(checkMark(letter(), withMark(180, 160, 210, 190), M(0x5b9)).pass).toBe(false);
  });
  it('penOriginRejects is satisfied by edge-centred points and not by points in place', () => {
    expect(penOriginRejects(letter(), withMark(330, 350, 370, 370), withMark(230, 350, 270, 370), M(0x5b7))).toEqual({ ok: true, rightRejected: true, leftRejected: true, drawn: true });
    const inPlace = withMark(280, 350, 320, 370);
    expect(penOriginRejects(letter(), inPlace, inPlace, M(0x5b7)).ok).toBe(false);
    // a holam: the right edge must be rejected; the left edge is where it belongs
    expect(penOriginRejects(letter(), withMark(335, 160, 365, 190), withMark(235, 160, 265, 190), M(0x5b9))).toEqual({ ok: true, rightRejected: true, leftRejected: false, drawn: true });
    const holamInPlace = withMark(235, 160, 265, 190);
    expect(penOriginRejects(letter(), holamInPlace, holamInPlace, M(0x5b9)).ok).toBe(false);
    // the shin dot: the left edge must be rejected
    expect(penOriginRejects(letter(), withMark(335, 170, 365, 195), withMark(235, 170, 265, 195), M(0x5c1)).ok).toBe(true);
    expect(penOriginRejects(letter(), withMark(320, 170, 345, 195), withMark(320, 170, 345, 195), M(0x5c1)).ok).toBe(false);
  });
});

describe('controlRejects', () => {
  it('is satisfied only when the sideways and a vertical displacement are rejected', () => {
    const c = controlRejects(letter(), withMark(480, 350, 520, 370), withMark(280, 150, 320, 170), withMark(280, 450, 320, 470), M(0x5b7));
    expect(c).toEqual({ ok: true, sidewaysRejected: true, verticalRejected: true, drawn: true });
  });
  it('is not when the check cannot reject (a displacement that stays in its zone) or the point is not drawn', () => {
    const inZone = withMark(280, 350, 320, 370);
    expect(controlRejects(letter(), inZone, inZone, inZone, M(0x5b7)).ok).toBe(false);
    expect(controlRejects(letter(), letter(), letter(), letter(), M(0x5b7)).drawn).toBe(false);
  });
});

describe('goldens', () => {
  it('finds equal hashes and differences', () => {
    expect(duplicateHashes({ a: 'x', b: 'y', c: 'x' })).toEqual([['a', 'c']]);
    expect(compareGolden({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual({ differ: ['b'], missing: [], extra: ['c'] });
    expect(compareGolden({ a: '1', gone: '9' }, { a: '1' }).missing).toEqual(['gone']);
  });
  it('the golden line starts and ends with an unpointed letter and holds the task line', () => {
    expect(GOLDEN_LINE.startsWith('ש ')).toBe(true);
    expect(GOLDEN_LINE.endsWith(' ש')).toBe(true);
    expect(GOLDEN_LINE).toContain(TASK_LINE);
  });
  it('the sixteen points are U+05B0-05BC, 05C1, 05C2, 05C7', () => {
    expect(MARKS.map((m) => m.cp)).toEqual([0x5b0, 0x5b1, 0x5b2, 0x5b3, 0x5b4, 0x5b5, 0x5b6, 0x5b7, 0x5b8, 0x5b9, 0x5ba, 0x5bb, 0x5bc, 0x5c1, 0x5c2, 0x5c7]);
  });
});
