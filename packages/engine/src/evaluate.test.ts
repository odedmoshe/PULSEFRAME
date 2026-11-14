import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject } from '@pulseframe/core';
import { evaluate, resolveDirection } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
function project() {
  const asset = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1), video: { width: 640, height: 360, frameRate: { num: 30000, den: 1001 }, codec: 'h264', rotation: 0, frameCount: 119 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: { origin: 'fixture' as const, importedAt: 'x', importedBy: 'x' } };
  const a = applyTransaction(createProject({ id: 'p', name: 'p' }), [{ op: 'import_asset', args: { asset } }], { idSeed: 'a', actor: 't', allowInternal: true });
  const assetId = a.results[0]!.output!.assetId as string;
  return applyTransaction(a.doc, [
    { op: 'add_clip', args: { assetId, start: f(30), sourceIn: T.rt(1, 1), duration: f(60) } },
    { op: 'add_text', args: { text: 'שלום', start: f(45), duration: f(15) } },
  ], { idSeed: 'b', actor: 't' }).doc;
}
describe('evaluate', () => {
  it('uses half-open clip intervals and exact source mapping across differing rates', () => {
    const doc = project();
    expect(evaluate(doc, f(29)).layers).toEqual([]);
    const g = evaluate(doc, f(30));
    expect(g.layers.map((l) => l.kind)).toEqual(['video']);
    const v = g.layers[0]!;
    // sourceTime 1s at 30000/1001 fps -> floor(29.97) = frame 29
    expect(v.kind === 'video' && v.sourceFrameIndex).toBe(29);
    expect(evaluate(doc, f(45)).layers.map((l) => l.kind)).toEqual(['video', 'text']);
    expect(evaluate(doc, f(60)).layers.map((l) => l.kind)).toEqual(['video']);
    expect(evaluate(doc, f(90)).layers).toEqual([]);
    expect(evaluate(doc, f(30)).audio.length).toBe(1);
  });
  it('random access equals sequential evaluation (stateless)', () => {
    const doc = project();
    const seq = Array.from({ length: 100 }, (_, i) => JSON.stringify(evaluate(doc, f(i))));
    for (const i of [77, 3, 45, 30, 89, 0]) expect(JSON.stringify(evaluate(doc, f(i)))).toBe(seq[i]);
  });
  it('resolves paragraph direction from the first strong character', () => {
    expect(resolveDirection('שלום world', 'auto')).toBe('rtl');
    expect(resolveDirection('123 שלום', 'auto')).toBe('rtl');
    expect(resolveDirection('Hello שלום', 'auto')).toBe('ltr');
    expect(resolveDirection('שלום', 'ltr')).toBe('ltr');
  });
});

describe('animated layers', () => {
  it('evaluate applies keyframes per frame and is identical for random and sequential access', () => {
    let doc = project();
    const text = doc.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips[0]!;
    doc = applyTransaction(doc, [
      { op: 'set_keyframe', args: { clipId: text.id, property: 'y', time: f(0), value: 0.4 } },
      { op: 'set_keyframe', args: { clipId: text.id, property: 'y', time: f(10), value: -0.1, easing: 'ease-out' } },
      { op: 'set_keyframe', args: { clipId: text.id, property: 'opacity', time: f(0), value: 0 } },
      { op: 'set_keyframe', args: { clipId: text.id, property: 'opacity', time: f(5), value: 1 } },
    ], { idSeed: 'k', actor: 't' }).doc;
    const layer = (frame: number) => evaluate(doc, f(frame)).layers.find((l) => l.kind === 'text')!;
    expect(layer(45).transform).toMatchObject({ y: 0.4, opacity: 0 });
    expect(layer(50).transform.y).toBeCloseTo(0.15, 10);
    expect(layer(50).transform.opacity).toBe(1);
    expect(layer(55).transform.y).toBeCloseTo(-0.1, 10);
    const seq = Array.from({ length: 15 }, (_, i) => JSON.stringify(layer(45 + i).transform));
    for (const i of [14, 0, 7, 3, 11]) expect(JSON.stringify(layer(45 + i).transform)).toBe(seq[i]);
  });
});
