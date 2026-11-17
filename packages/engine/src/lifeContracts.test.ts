/**
 * The evaluator's hook for the life line (ADR-0021), as far as the lead pre-pass owns it: titles without fields and date
 * stamps without a capture source evaluate exactly as before, and a capture-sourced stamp over a file without a date draws
 * nothing. Both hold for the finished feature too, so nothing here pins a placeholder; resolving fields is W1's and W2's test.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, STAMP_TEXT, type Layer } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `e${n++}_`, actor: 'test', allowInternal });
const video = { kind: 'video' as const, name: 'undated.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
const stampOf = (layers: Layer[], clipId: string) => { const l = layers.find((x) => 'clipId' in x && x.clipId === clipId); return l && 'effects' in l ? l.effects?.find((e) => e.type === 'stylize.date-stamp') : undefined; };

function project() {
  let r = tx(createProject({ id: 'prj_e', name: 'E', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: video } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: 'a {date} b {{c}}', start: f(0), duration: f(60) } }]);
  return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string, titleId: r.results[1]!.output!.clipId as string };
}

describe('evaluator: live fields and the capture-sourced date stamp', () => {
  it('a title without `fields` is drawn verbatim, braces and all, at every time', () => {
    const { doc, titleId } = project();
    for (const frame of [0, 17, 59]) {
      const title = evaluate(doc, f(frame)).layers.find((l) => l.kind === 'text' && l.clipId === titleId);
      expect(title).toMatchObject({ kind: 'text', text: 'a {date} b {{c}}' });
    }
  });
  it('a stamp without a source, or with source text, keeps its typed text and parameters exactly', () => {
    const { doc, clipId } = project();
    const plain = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp' } }]);
    const before = stampOf(evaluate(plain.doc, f(10)).layers, clipId)!;
    expect(before.params.text).toBe("'05 7 14");
    expect(Object.keys(before.params).sort()).toEqual(['color', 'corner', 'glow', 'size', 'text']);
    const typed = tx(plain.doc, [{ op: 'update_effect', args: { clipId, effectId: plain.results[0]!.output!.effectId as string, params: { source: 'text', clock: true, dateOrder: 'dmy', text: '24.12.25' } } }]);
    expect(stampOf(evaluate(typed.doc, f(10)).layers, clipId)!.params).toMatchObject({ text: '24.12.25', source: 'text' });
  });
  it('a capture-sourced stamp over a file without a date has no text, so nothing is drawn; its text always fits the stamp\'s own pattern', () => {
    const { doc, clipId } = project();
    const r = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { source: 'capture', clock: true, text: "'99 1 1" } } }]);
    for (const frame of [0, 30, 59]) {
      const stamp = stampOf(evaluate(r.doc, f(frame)).layers, clipId)!;
      expect(stamp.params.text).toBe('');
      expect(STAMP_TEXT.test(String(stamp.params.text))).toBe(true);
    }
  });
  // W1 and W2 (packages/core/src/fields.test.ts, packages/engine/src/fields.test.ts):
  it.todo('a title with a field and a plain title with the same words give equal text layers on preview-, still- and export-style evaluations');
  it.todo('the stutter and echo paths resolve a title\'s fields at the time they show');
  it.todo('a capture-sourced stamp shows the capture date of its own file, and of the topmost dated picture under an adjustment clip');
});
