/**
 * Lead contracts of track cover in core (wave 8 pre-pass): the request and option schemas, the three settled pure rules (noise
 * correction, input-seek position, cache state), the refusal table and the honest not-built state of the W1/W2 stubs. The todo
 * rows are the checks W1 (rankStills, rangeOfClip) and W2 (printFit, defaultCrop, snapCrop, cropFitsPaper, stillDocument) turn on.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  FindSharpBodySchema, noiseCorrected, PAPERS, PPI_TIERS, printFit, rangeOfClip, rankStills, ReadSharpQuerySchema, STILL_EXPORT_BUILT, StillExportSchema,
  stillDocument, STILLS_ALGO, STILLS_LABEL, STILLS_LONG_SIDE, STILLS_MEASURE_BUILT, STILLS_REFUSALS, stillsCacheState, stillsSeekSeconds, StillsRefusal,
} from './index.ts';

const v = (num: number, den: number, startTime?: T.RationalTime) => ({ video: { frameRate: { num, den }, ...(startTime ? { startTime } : {}) } });

describe('cover contract: settled pure rules', () => {
  it('noiseCorrected subtracts round(1.5 σ²) and never goes below 0', () => {
    expect(noiseCorrected(1000, 0)).toBe(1000);
    expect(noiseCorrected(1000, 600)).toBe(1000 - 54); // σ = 6 → 1.5·36 = 54
    expect(noiseCorrected(1000, 1000)).toBe(850); // σ = 10 → 150
    expect(noiseCorrected(10, 1000)).toBe(0);
    expect(noiseCorrected(500, 123)).toBe(500 - Math.round(1.5 * 1.23 * 1.23));
  });
  it('stillsSeekSeconds is half a frame before the frame, from the file\'s own start, with 6 decimals', () => {
    expect(stillsSeekSeconds(v(30, 1), 0)).toBe('0.000000');
    expect(stillsSeekSeconds(v(30, 1), 1)).toBe('0.016667'); // 0.5/30
    expect(stillsSeekSeconds(v(30, 1), 913)).toBe('30.416667'); // 912.5/30
    expect(stillsSeekSeconds(v(30000, 1001), 960)).toBe('32.015317'); // 959.5·1001/30000 = 960459.5/30000 = 32.0153166…
    expect(stillsSeekSeconds(v(240, 1), 2)).toBe('0.006250');
    // a picture that starts 0.1 s after the file's start: frame k is at (k + 3) / 30
    expect(stillsSeekSeconds(v(30, 1, T.rt(1, 10)), 0)).toBe('0.083333');
    expect(() => stillsSeekSeconds({}, 0)).toThrow(RangeError);
    expect(() => stillsSeekSeconds(v(30, 1), -1)).toThrow(RangeError);
  });
  it('stillsCacheState: same algo, long side and ffmpeg build is a hit, anything else a miss', () => {
    const meta = { algo: STILLS_ALGO, longSide: STILLS_LONG_SIDE, ffmpeg: 'ffmpeg version 6.1.1', frames: 10 };
    expect(stillsCacheState(meta, 'ffmpeg version 6.1.1')).toBe('hit');
    expect(stillsCacheState(meta, 'ffmpeg version 8.1')).toBe('miss');
    expect(stillsCacheState({ ...meta, longSide: 1920 }, 'ffmpeg version 6.1.1')).toBe('miss');
    expect(stillsCacheState(null, 'x')).toBe('miss');
  });
});

describe('cover contract: schemas', () => {
  it('FindSharpBody: a clip, or a stretch with both ends; never both, never neither', () => {
    expect(FindSharpBodySchema.safeParse({ assetId: 'a', clipId: 'c' }).success).toBe(true);
    expect(FindSharpBodySchema.safeParse({ assetId: 'a', from: 0, to: 600 }).success).toBe(true);
    expect(FindSharpBodySchema.safeParse({ assetId: 'a' }).success).toBe(false);
    expect(FindSharpBodySchema.safeParse({ assetId: 'a', from: 3 }).success).toBe(false);
    expect(FindSharpBodySchema.safeParse({ assetId: 'a', clipId: 'c', from: 0, to: 3 }).success).toBe(false);
    expect(FindSharpBodySchema.safeParse({ assetId: 'a', clipId: 'c', x: 1 }).success).toBe(false);
    expect(ReadSharpQuerySchema.parse({ assetId: 'a', from: '2', to: '9' })).toEqual({ assetId: 'a', from: 2, to: 9 });
  });
  it('StillExport: strict, crops of at least 16 px and at most 8192, paper with orientation', () => {
    expect(StillExportSchema.safeParse({ assetId: 'a', sourceFrame: 0 }).success).toBe(true);
    expect(StillExportSchema.safeParse({ assetId: 'a', sourceFrame: 0, crop: { x: 0, y: 0, w: 8193, h: 100 } }).success).toBe(false);
    expect(StillExportSchema.safeParse({ assetId: 'a', sourceFrame: 0, orientation: 'portrait' }).success).toBe(false);
    expect(StillExportSchema.safeParse({ assetId: 'a', sourceFrame: 0, paper: '13x18', orientation: 'portrait' }).success).toBe(true);
  });
  it('papers are portrait in tenths of a millimetre; tiers run from highest to 0', () => {
    for (const p of Object.values(PAPERS)) expect(p.w).toBeLessThan(p.h);
    expect(PAPERS['10x15']).toMatchObject({ w: 1016, h: 1524 });
    expect(PPI_TIERS.map((t) => t.min)).toEqual([300, 200, 150, 0]);
  });
});

describe('cover contract: refusals and labels', () => {
  it('every row has a status, a code and a hint (the way forward); the label says heuristic and not checked by eye', () => {
    for (const [k, r] of Object.entries(STILLS_REFUSALS)) { expect(r.code, k).toMatch(/^[a-z_]+$/); expect(r.hint.length, k).toBeGreaterThan(10); }
    expect(STILLS_LABEL.he).toContain('לא נבדק בעין');
    expect(STILLS_LABEL.en).toContain('Not checked by eye');
    for (const s of [STILLS_LABEL.he, STILLS_LABEL.en]) expect(s).not.toMatch(/טוב|good|best|safe|verified/i);
  });
  it('the W1/W2 stubs refuse with the typed not-built refusal until built', () => {
    const asset = { video: { width: 4, height: 4, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 30 } };
    const refused = (f: () => unknown, code: string) => { try { f(); } catch (e) { expect(e).toBeInstanceOf(StillsRefusal); expect((e as StillsRefusal).code).toBe(code); return; } throw new Error('not refused'); };
    if (!STILLS_MEASURE_BUILT) { refused(() => rankStills(asset, [], 0, 1), 'stills_not_built'); refused(() => rangeOfClip({} as never, 'c'), 'stills_not_built'); }
    if (!STILL_EXPORT_BUILT) { refused(() => printFit({ w: 1620, h: 1080 }, '10x15', 'landscape'), 'still_not_built'); refused(() => stillDocument({} as never, 0), 'still_not_built'); }
  });
  it.todo('W1 rankStills: median over every frame; local maxima; sharp desc, motion asc (null last), frame asc; ≥ 1 s apart; at most 3; incomplete range → no candidates');
  it.todo('W1 rankStills: manyClipped above 50‰ white; sharpRatioPermille = round(1000·sharp/max(1, median)); time = sourceTimeOfFrame');
  it.todo('W1 rangeOfClip: speed, reverse and freeze honoured through speed.ts; a 60 fps file in a 30 fps project counts every source frame; over 600 → stills_range_too_long');
  it.todo('W2 printFit: 1920x1080 → 10x15 landscape 1620x1080 = 270 usual; A4 landscape 1527x1080 = 130 soft; 3840x2160 A4 = 261 usual; a table of 12 hand values');
  it.todo('W2 defaultCrop / snapCrop / cropFitsPaper: largest centred paper-shaped rectangle; moves stay inside; ratio within one pixel');
  it.todo('W2 stillDocument: the file\'s own size (odd kept) and rate, fit contain, default transform, sourceIn = sourceTimeOfFrame; refusals over 8192 and outside the file');
});
