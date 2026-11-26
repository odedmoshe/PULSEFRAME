import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject } from '@pulseframe/core';
import { moveClipOp, trackMoveRefusalText, trackMoveTarget } from './trackMove.ts';

const R = { num: 30, den: 1 };
const applyOps = (d: never, ops: never) => applyTransaction(d, ops, { idSeed: 'm_', actor: 'test' });
const V1 = { id: 'v1', kind: 'video', name: 'V1' }, V2 = { id: 'v2', kind: 'video', name: 'V2' };
const A1 = { id: 'a1', kind: 'audio', name: 'A1' }, LOCKED = { id: 'v3', kind: 'video', name: 'V3', locked: true };

describe('dragging a clip to another track', () => {
  it('lands on the track under the pointer when it is of the same kind and unlocked; on its own track otherwise', () => {
    expect(trackMoveTarget(V1, null)).toEqual({ trackId: 'v1', refusal: null });
    expect(trackMoveTarget(V1, V1)).toEqual({ trackId: 'v1', refusal: null });
    expect(trackMoveTarget(V1, V2)).toEqual({ trackId: 'v2', refusal: null });
    expect(trackMoveTarget(V1, A1)).toEqual({ trackId: 'a1', refusal: 'kind' });
    expect(trackMoveTarget(V1, LOCKED)).toEqual({ trackId: 'v3', refusal: 'locked' });
    expect(trackMoveTarget({ id: 'x', kind: 'adjustment', name: 'X' }, V2).refusal).toBe('kind');
  });
  it('a refusal says why and what to do, in Hebrew and English, naming the track', () => {
    expect(trackMoveRefusalText('he', 'locked', V1, LOCKED)).toMatch(/V3.*נעולה.*בטלו/);
    expect(trackMoveRefusalText('he', 'kind', V1, A1)).toMatch(/וידאו.*גררו/);
    expect(trackMoveRefusalText('en', 'locked', V1, LOCKED)).toMatch(/\u2068V3\u2069 is locked.*unlock/);
  });
  it('the move is ONE move_clip; trackId only when the track changes; the real core puts the clip on V2 at the new start', () => {
    expect(moveClipOp('c', T.frameTime(30, R), 'v1', 'v1').args).toEqual({ clipId: 'c', start: T.frameTime(30, R) });
    let doc = createProject({ id: 'prj_move', name: 'p', width: 640, height: 360, frameRate: R });
    const r0 = applyOps(doc as never, [{ op: 'add_text', args: { text: 'a', start: T.ZERO, duration: T.frameTime(60, R) } }] as never);
    doc = r0.doc;
    const seq = doc.sequences[doc.mainSequenceId]!;
    const text = seq.tracks.find((t) => t.clips.length > 0)!;
    const other = seq.tracks.find((t) => t.kind === text.kind && t.id !== text.id);
    // a second track of the clip's kind
    const withTwo = other ? doc : applyOps(doc as never, [{ op: 'add_track', args: { kind: text.kind } }] as never).doc;
    const s2 = withTwo.sequences[withTwo.mainSequenceId]!;
    const from = s2.tracks.find((t) => t.clips.length > 0)!, to = s2.tracks.find((t) => t.kind === from.kind && t.id !== from.id)!;
    const clipId = from.clips[0]!.id;
    const moved = applyOps(withTwo as never, [moveClipOp(clipId, T.frameTime(30, R), from.id, to.id)] as never).doc;
    const ms = moved.sequences[moved.mainSequenceId]!;
    expect(ms.tracks.find((t) => t.id === to.id)!.clips.map((c) => [c.id, T.frameIndexAt(c.start, R)])).toEqual([[clipId, 30]]);
    expect(ms.tracks.find((t) => t.id === from.id)!.clips).toEqual([]);
  });
});
