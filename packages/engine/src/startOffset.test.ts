import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, startOffsetFrames, validateProject } from '@pulseframe/core';
import { evaluate } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
/** A 120-frame video whose first picture sits `start` seconds after the file's time zero. */
function project(start: string | null) {
  const frames = 120, lead = start ? Math.round(Number(start) * 30) : 0;
  const asset = {
    kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames + lead, R),
    video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: frames, ...(start ? { startTime: T.fromSeconds(start) } : {}) },
    provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' },
  };
  let n = 0;
  const tx = (doc: any, ops: any[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `so${n++}_`, actor: 'test', allowInternal });
  const a = tx(createProject({ id: 'prj_so', name: 'so', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset } }], true);
  const d = tx(a.doc, [{ op: 'add_clip', args: { assetId: a.results[0]!.output!.assetId, start: f(0) } }]).doc;
  expect(validateProject(d)).toEqual([]);
  return d;
}
const shown = (d: any, frame: number) => { const l = evaluate(d, f(frame)).layers.find((x) => x.kind === 'video'); return l && l.kind === 'video' ? [l.sourceFrameIndex, Number(l.sourceSeekSeconds.toFixed(4))] : null; };

describe('sources whose first picture is not at time 0', () => {
  it('the offset is rounded to the nearest whole frame', () => {
    expect(startOffsetFrames({ frameRate: R })).toBe(0);
    expect(startOffsetFrames({ frameRate: R, startTime: T.fromSeconds('0.010') })).toBe(0);
    expect(startOffsetFrames({ frameRate: R, startTime: T.fromSeconds('0.021029') })).toBe(1);
    expect(startOffsetFrames({ frameRate: R, startTime: T.fromSeconds('0.5') })).toBe(15);
    expect(startOffsetFrames({ frameRate: { num: 30000, den: 1001 }, startTime: T.fromSeconds('0.0667') })).toBe(2);
  });
  it('zero start: frame k at timeline frame k; the seek time is the middle of the frame, counted from the first frame', () => {
    const d = project(null);
    expect(shown(d, 0)).toEqual([0, 0.0167]);
    expect(shown(d, 59)).toEqual([59, 1.9833]);
    expect(shown(d, 119)).toEqual([119, 3.9833]);
  });
  it('late start: the first frame is held until the picture starts, then every frame appears once, up to the last; seek times stay relative to the first frame', () => {
    const d = project('0.5'); // 15 frames
    expect(shown(d, 0)).toEqual([0, 0.0167]);
    expect(shown(d, 15)).toEqual([0, 0.0167]);
    expect(shown(d, 16)).toEqual([1, 0.05]);
    expect(shown(d, 134)).toEqual([119, 3.9833]);
    const all = Array.from({ length: 135 }, (_, i) => shown(d, i)![0]);
    expect(all.slice(15)).toEqual(Array.from({ length: 120 }, (_, k) => k));
  });
  it('a sub-frame offset over half a frame places the picture one frame later; under half a frame it changes nothing', () => {
    expect(shown(project('0.021029'), 1)).toEqual([0, 0.0167]);
    expect(shown(project('0.021029'), 2)).toEqual([1, 0.05]);
    expect(shown(project('0.010'), 1)).toEqual([1, 0.05]);
  });
});
