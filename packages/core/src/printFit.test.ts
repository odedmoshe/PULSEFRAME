/**
 * «שמירת התמונה» print maths (wave 8 cover W2): printFit, defaultCrop, snapCrop, cropFitsPaper. Every expected number below was
 * worked out by hand from the formula in printFit.ts (ppi = floor(min(w·254/PW, h·254/PH)), landscape swaps the paper's sides)
 * and typed here; none is computed by the code under test. Replaces the W2 todo rows of stillsContracts.test.ts
 * ("W2 printFit: …" and "W2 defaultCrop / snapCrop / cropFitsPaper: …").
 */
import { describe, expect, it } from 'vitest';
import { cropFitsPaper, defaultCrop, PAPERS, PPI_TIERS, printFit, snapCrop, type Orientation, type PaperId } from './index.ts';

describe('printFit: a hand table', () => {
  // [w, h, paper, orientation, ppi, tier]
  const table: [number, number, PaperId, Orientation, number, string][] = [
    [1620, 1080, '10x15', 'landscape', 270, 'usual'], // 1920x1080 → 10x15 landscape: 1620·254/1524 = 270, 1080·254/1016 = 270
    [1527, 1080, 'a4', 'landscape', 130, 'soft'], // 1527·254/2970 = 130.59, 1080·254/2100 = 130.63
    [3055, 2160, 'a4', 'landscape', 261, 'usual'], // 3840x2160 → A4 landscape; divisor 2970 tenths (C13: never 15240)
    [3054, 2160, 'a4', 'landscape', 261, 'usual'],
    [1080, 1620, '10x15', 'portrait', 270, 'usual'],
    [1200, 1800, '10x15', 'portrait', 300, 'dense'], // exactly 300: the dense tier starts at its min
    [1800, 1200, '10x15', 'landscape', 300, 'dense'],
    [2480, 3508, 'a4', 'portrait', 299, 'usual'], // "A4 at 300 dpi" is 299.96 across: floor gives 299
    [1500, 2100, '13x18', 'portrait', 300, 'dense'],
    [1000, 1400, '13x18', 'portrait', 200, 'usual'], // exactly 200
    [600, 900, '10x15', 'portrait', 150, 'borderline'], // exactly 150
    [599, 899, '10x15', 'portrait', 149, 'soft'], // 599·254/1016 = 149.75
    [4000, 6000, '10x15', 'portrait', 1000, 'dense'],
    [1080, 1512, '13x18', 'portrait', 216, 'usual'],
    [800, 1131, 'a4', 'portrait', 96, 'soft'], // 96.76 and 96.73: the smaller side decides
    [1499, 2250, '10x15', 'portrait', 374, 'dense'], // 374.75 against 375
  ];
  it.each(table)('%i x %i on %s %s → %i ppi %s', (w, h, paper, orientation, ppi, tier) => {
    expect(printFit({ w, h }, paper, orientation)).toEqual({ ppi, tier });
  });
  it('the tiers come from PPI_TIERS and no tier is called good', () => {
    expect(PPI_TIERS.map((t) => t.key)).toEqual(['dense', 'usual', 'borderline', 'soft']);
    for (const t of PPI_TIERS) expect(t.key).not.toMatch(/good|best|sharp|safe/);
  });
  it('a crop that is not whole pixels is refused (RangeError), not rounded', () => {
    expect(() => printFit({ w: 0, h: 10 }, 'a4', 'portrait')).toThrow(RangeError);
    expect(() => printFit({ w: 10.5, h: 10 }, 'a4', 'portrait')).toThrow(RangeError);
  });
});

describe('defaultCrop: the largest centred rectangle of the paper\'s shape', () => {
  const table: [number, number, PaperId, Orientation, { x: number; y: number; w: number; h: number }][] = [
    [1920, 1080, '10x15', 'landscape', { x: 150, y: 0, w: 1620, h: 1080 }], // 1080·1524/1016 = 1620 exactly
    [1920, 1080, 'a4', 'landscape', { x: 196, y: 0, w: 1527, h: 1080 }], // 1080·2970/2100 = 1527.43 → 1527; (1920−1527)/2 = 196.5 → 196
    [3840, 2160, 'a4', 'landscape', { x: 392, y: 0, w: 3055, h: 2160 }], // 3054.86 → 3055
    [1920, 1080, '10x15', 'portrait', { x: 600, y: 0, w: 720, h: 1080 }],
    [1080, 1920, '10x15', 'portrait', { x: 0, y: 150, w: 1080, h: 1620 }], // a vertical film keeps its width
    [3001, 2001, '13x18', 'landscape', { x: 100, y: 0, w: 2801, h: 2001 }], // 2001·1778/1270 = 2801.4 → 2801
    [1620, 1080, '10x15', 'landscape', { x: 0, y: 0, w: 1620, h: 1080 }], // already the shape: the whole picture
  ];
  it.each(table)('%i x %i, %s %s', (w, h, paper, o, want) => {
    const c = defaultCrop(w, h, paper, o);
    expect(c).toEqual(want);
    expect(cropFitsPaper(c, paper, o)).toBe(true);
    expect(c.x + c.w).toBeLessThanOrEqual(w);
    expect(c.y + c.h).toBeLessThanOrEqual(h);
  });
});

describe('cropFitsPaper: within one pixel, |w·PH − h·PW| ≤ max(PW, PH)', () => {
  it('10x15 landscape (PW 1524, PH 1016): 1620x1080 fits, 1621 fits (one pixel off), 1622 does not', () => {
    expect(cropFitsPaper({ w: 1620, h: 1080 }, '10x15', 'landscape')).toBe(true);
    expect(cropFitsPaper({ w: 1621, h: 1080 }, '10x15', 'landscape')).toBe(true); // |1621·1016 − 1080·1524| = 1016 ≤ 1524
    expect(cropFitsPaper({ w: 1622, h: 1080 }, '10x15', 'landscape')).toBe(false); // 2032 > 1524
    expect(cropFitsPaper({ w: 1620, h: 1081 }, '10x15', 'landscape')).toBe(true); // 1524 ≤ 1524: the height is one pixel off
    expect(cropFitsPaper({ w: 1620, h: 1082 }, '10x15', 'landscape')).toBe(false); // 3048
  });
  it('orientation matters: a landscape crop is not a portrait one; A4 1527x1080 is, 1529x1080 is not', () => {
    expect(cropFitsPaper({ w: 1620, h: 1080 }, '10x15', 'portrait')).toBe(false);
    expect(cropFitsPaper({ w: 1527, h: 1080 }, 'a4', 'landscape')).toBe(true); // |1527·2100 − 1080·2970| = 900
    expect(cropFitsPaper({ w: 1529, h: 1080 }, 'a4', 'landscape')).toBe(false); // 5100 > 2970
  });
  it('not whole pixels never fit', () => {
    expect(cropFitsPaper({ w: 1620.5, h: 1080 }, '10x15', 'landscape')).toBe(false);
    expect(cropFitsPaper({ w: 0, h: 0 }, '10x15', 'landscape')).toBe(false);
  });
});

describe('snapCrop: back inside the picture, in the paper\'s shape, size and centre kept as far as possible', () => {
  const W = 1920, H = 1080;
  it('a moved paper-shaped crop only moves (its size kept exactly), clamped to the picture\'s edges', () => {
    expect(snapCrop({ x: 10, y: 0, w: 1620, h: 1080 }, W, H, '10x15', 'landscape')).toEqual({ x: 10, y: 0, w: 1620, h: 1080 });
    expect(snapCrop({ x: 400, y: 0, w: 1620, h: 1080 }, W, H, '10x15', 'landscape')).toEqual({ x: 300, y: 0, w: 1620, h: 1080 });
    expect(snapCrop({ x: -40, y: -3, w: 900, h: 600 }, W, H, '10x15', 'landscape')).toEqual({ x: 0, y: 0, w: 900, h: 600 });
    expect(snapCrop({ x: 1500, y: 900, w: 900, h: 600 }, W, H, '10x15', 'landscape')).toEqual({ x: 1020, y: 480, w: 900, h: 600 });
  });
  it('a crop larger than the picture becomes the largest one, centred on where it was', () => {
    expect(snapCrop({ x: 0, y: 0, w: 4000, h: 3000 }, W, H, '10x15', 'landscape')).toEqual({ x: 300, y: 0, w: 1620, h: 1080 }); // its centre (2000, 1500) is outside: clamped to the right edge
  });
  it('a crop of another shape: the side it is relatively longer in leads, the other follows to the nearest pixel, the centre stays', () => {
    // 1000x400 is wider than 3:2 → width leads: h = round(1000·1016/1524) = round(666.67) = 667; centre (500+500, 300+200) = (1000, 500)
    expect(snapCrop({ x: 500, y: 300, w: 1000, h: 400 }, W, H, '10x15', 'landscape')).toEqual({ x: 500, y: 167, w: 1000, h: 667 });
    // 300x900 is taller than 3:2 portrait (2:3) → height leads: w = round(900·1016/1524) = 600; centre (850, 450) → x = 550
    expect(snapCrop({ x: 700, y: 0, w: 300, h: 900 }, W, H, '10x15', 'portrait')).toEqual({ x: 550, y: 0, w: 600, h: 900 });
  });
  it('a side under 16 pixels is raised to the export\'s least', () => {
    expect(snapCrop({ x: 100, y: 100, w: 6, h: 4 }, W, H, '10x15', 'landscape')).toEqual({ x: 91, y: 94, w: 24, h: 16 });
  });
  it('every snapped crop fits the paper and the picture (a sweep)', () => {
    const papers = Object.keys(PAPERS) as PaperId[];
    for (const paper of papers) for (const o of ['portrait', 'landscape'] as const)
      for (const [pw, ph] of [[1920, 1080], [3001, 2001], [1080, 1920], [640, 480], [17, 4000]] as const)
        for (const c of [{ x: 0, y: 0, w: 50, h: 50 }, { x: 999, y: 999, w: 777, h: 333 }, { x: -5, y: 7, w: 9000, h: 20 }, { x: 3, y: 1, w: 1527, h: 1080 }]) {
          const s = snapCrop(c, pw, ph, paper, o);
          expect(cropFitsPaper(s, paper, o), JSON.stringify({ paper, o, pw, ph, c, s })).toBe(true);
          expect(s.x >= 0 && s.y >= 0 && s.x + s.w <= pw && s.y + s.h <= ph, JSON.stringify({ paper, o, pw, ph, c, s })).toBe(true);
          expect(Number.isInteger(s.x) && Number.isInteger(s.y) && Number.isInteger(s.w) && Number.isInteger(s.h)).toBe(true);
        }
  });
});
