import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { placementLabel, placementOps } from './placement.range.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
describe('placement.range: the three placements of a stretch', () => {
  const base = { assetId: 'a1', range: { sourceIn: f(30), duration: f(45) }, at: f(100), trackId: 'v1', audioTrackId: 'a1t' };
  it('add: one add_clip with the stretch and the named tracks', () => {
    expect(placementOps({ ...base, mode: 'add' })).toEqual([{ op: 'add_clip', args: { assetId: 'a1', start: f(100), sourceIn: f(30), duration: f(45), trackId: 'v1', audioTrackId: 'a1t' } }]);
  });
  it('insert: a gap of the stretch\'s length at the playhead, then the clip (a ripple insert)', () => {
    expect(placementOps({ ...base, mode: 'insert' })).toEqual([
      { op: 'insert_gap', args: { at: f(100), duration: f(45) } },
      { op: 'add_clip', args: { assetId: 'a1', start: f(100), sourceIn: f(30), duration: f(45), trackId: 'v1', audioTrackId: 'a1t' } },
    ]);
  });
  it('overwrite: clears the target tracks over the length without a ripple, then the clip; no tracks to clear, no cut', () => {
    const ops = placementOps({ ...base, mode: 'overwrite', clearTrackIds: ['v1', 'a1t'] });
    expect(ops[0]).toEqual({ op: 'cut_range', args: { start: f(100), end: T.add(f(100), f(45)), ripple: false, trackIds: ['v1', 'a1t'] } });
    expect(ops).toHaveLength(2);
    expect(placementOps({ ...base, mode: 'overwrite' }).map((o) => o.op)).toEqual(['add_clip']);
  });
  it('the whole file: add_clip names no sourceIn and no duration; insert and overwrite need the whole length', () => {
    const whole = { assetId: 'a1', range: null, at: f(0), wholeDuration: f(90) };
    expect(placementOps({ ...whole, mode: 'add' })).toEqual([{ op: 'add_clip', args: { assetId: 'a1', start: f(0) } }]);
    expect(placementOps({ ...whole, mode: 'insert' }).map((o) => o.op)).toEqual(['insert_gap', 'add_clip']);
    expect(placementOps({ assetId: 'a1', range: null, at: f(0), mode: 'insert' })).toEqual([]);
  });
  it('an empty stretch places nothing; no track key is written when none is named', () => {
    expect(placementOps({ assetId: 'a1', range: { sourceIn: f(0), duration: T.ZERO }, at: f(0), mode: 'insert' })).toEqual([]);
    expect(placementOps({ assetId: 'a1', range: { sourceIn: f(0), duration: f(3) }, at: f(0), mode: 'add' })[0]!.args).not.toHaveProperty('trackId');
  });
  it('labels', () => { expect(['add', 'insert', 'overwrite'].map((m) => placementLabel(m as 'add'))).toEqual(['Add clip', 'Insert clip', 'Overwrite with clip']); });
});
