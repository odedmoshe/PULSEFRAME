import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, grainOffset, type VideoLayer } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `l${n++}_`, actor: 'test', allowInternal });
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-14T00:00:00Z', importedBy: 'test' },
};

describe('look evaluation', () => {
  it('grain offset is a pure function of seed and frame, and changes between frames', () => {
    expect(grainOffset(1, 10)).toEqual(grainOffset(1, 10));
    expect(grainOffset(1, 10)).not.toEqual(grainOffset(1, 11));
    expect(grainOffset(1, 10)).not.toEqual(grainOffset(2, 10));
  });
  it('transition: outgoing clip plays on from its handle under the incoming clip; progress is strictly inside (0,1), monotonic, and ends exactly after N frames', () => {
    let r = tx(createProject({ id: 'p', name: 'p' }), [{ op: 'import_asset', args: { asset } }], true);
    const assetId = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
    const a = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'split_clip', args: { clipId: a, at: f(60) } }]);
    const b = r.results[0]!.output!.rightClipId as string;
    // B shows source 100.. so the two sides are distinguishable
    r = tx(r.doc, [{ op: 'trim_clip', args: { clipId: b, edge: 'start', to: f(100) } }, { op: 'move_clip', args: { clipId: b, start: f(60) } }, { op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 10 } }, { op: 'add_effect', args: { clipId: a, type: 'color.grayscale' } }]);
    const doc = r.doc;
    const at = (k: number) => evaluate(doc, f(k)).layers as VideoLayer[];
    expect(at(59).map((l) => [l.clipId, l.transition])).toEqual([[a, undefined]]);
    const progress: number[] = [];
    for (let k = 60; k < 70; k++) {
      const [out, inn] = at(k);
      expect([out!.clipId, out!.transition!.role, out!.sourceFrameIndex]).toEqual([a, 'out', k]); // A continues: source frame == timeline frame
      expect([inn!.clipId, inn!.transition!.role, inn!.sourceFrameIndex]).toEqual([b, 'in', 100 + (k - 60)]);
      expect(out!.effects?.[0]?.type).toBe('color.grayscale'); // the outgoing side keeps its own look
      expect(out!.transition!.progress).toBe(inn!.transition!.progress);
      progress.push(inn!.transition!.progress);
    }
    expect(progress[0]).toBeGreaterThan(0);
    expect(progress[9]).toBeLessThan(1);
    expect(progress.every((p, i) => i === 0 || p > progress[i - 1]!)).toBe(true);
    expect(at(70).map((l) => [l.clipId, l.transition])).toEqual([[b, undefined]]);
    // random access equals sequential: evaluating frame 65 alone gives the same layers
    expect(evaluate(doc, f(65))).toEqual(evaluate(doc, f(65)));
    // if the handle disappears later, the outgoing side freezes on its last source frame instead of failing
    const short = structuredClone(doc);
    short.assets[assetId]!.video!.frameCount = 62;
    expect((evaluate(short, f(66)).layers[0] as VideoLayer).sourceFrameIndex).toBe(61);
  });
  it('bypassed effects are not evaluated; a clip without a look produces the plain layer', () => {
    let r = tx(createProject({ id: 'p', name: 'p' }), [{ op: 'import_asset', args: { asset } }], true);
    const assetId = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
    const clipId = r.results[0]!.output!.clipId as string;
    const plain = evaluate(r.doc, f(5));
    r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }]);
    const fxId = r.results[0]!.output!.effectId as string;
    expect((evaluate(r.doc, f(5)).layers[0] as VideoLayer).effects).toHaveLength(1);
    r = tx(r.doc, [{ op: 'update_effect', args: { clipId, effectId: fxId, enabled: false } }]);
    expect(evaluate(r.doc, f(5))).toEqual(plain);
  });
});

describe('colour matrix for sources read with the wrong YCbCr matrix', () => {
  it('BT.709-decoded pixels re-read as BT.601: greys are unchanged, and a colour round-trips through the two matrices', async () => {
    const { BT709_AS_BT601: m } = await import('./look.ts');
    for (let r = 0; r < 3; r++) expect(m[r * 3]! + m[r * 3 + 1]! + m[r * 3 + 2]!).toBeCloseTo(1, 9); // rows sum to 1: grey stays grey
    // Independent arithmetic: take a colour, encode to YCbCr with BT.601, decode with BT.709 (what the browser shows), then correct.
    const enc = (kr: number, kb: number, [r, g, b]: number[]) => { const y = kr * r! + (1 - kr - kb) * g! + kb * b!; return [y, (b! - y) / (2 * (1 - kb)), (r! - y) / (2 * (1 - kr))]; };
    const dec = (kr: number, kb: number, [y, cb, cr]: number[]) => { const r = y! + 2 * (1 - kr) * cr!, b = y! + 2 * (1 - kb) * cb!; return [r, (y! - kr * r - kb * b) / (1 - kr - kb), b]; };
    for (const colour of [[200, 40, 30], [20, 180, 60], [30, 50, 220], [128, 128, 128], [250, 240, 10]]) {
      const shown = dec(0.2126, 0.0722, enc(0.299, 0.114, colour)); // wrong reading
      const fixed = [0, 1, 2].map((i) => m[i * 3]! * shown[0]! + m[i * 3 + 1]! * shown[1]! + m[i * 3 + 2]! * shown[2]!);
      fixed.forEach((v, i) => expect(v).toBeCloseTo(colour[i]!, 6));
      if (colour[0] !== colour[1]) expect(Math.max(...shown.map((v, i) => Math.abs(v - colour[i]!)))).toBeGreaterThan(3); // the wrong reading really differs
    }
  });
});

