/**
 * The evaluator's hook for the life line (ADR-0021), as far as the lead pre-pass owns it: titles without fields and date
 * stamps without a capture source evaluate exactly as before, and a capture-sourced stamp over a file without a date draws
 * nothing. Both hold for the finished feature too, so nothing here pins a placeholder; resolving fields is W1's and W2's test.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { LIFE_OPS_BUILT, applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
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
  // W2's part (packages/engine/src/fields.test.ts holds the full cases: eight kinds of field, formats, animations, every frame).
  // These need the core bodies of the life line (resolveFields, stampText), so they run once those are built (LIFE_OPS_BUILT).
  // The dates are written onto the files directly: what is tested is the evaluator, not the operations.
  /** The project above with its file dated `at`, on an Israeli winter clock. 26 December 2024, 10:00 is daytime: 25 Kislev 5785. */
  const dated = (at: string) => { const p = project(); const doc = structuredClone(p.doc); for (const a of Object.values(doc.assets)) a.capture = { at, utcOffsetMinutes: 120, source: 'container' }; return { ...p, doc }; };
  const retitled = (doc: ProjectDocument, titleId: string, text: string, fields: boolean) => { const d = structuredClone(doc); for (const t of d.sequences[d.mainSequenceId]!.tracks) for (const c of t.clips) if (c.id === titleId && c.type === 'text') { c.text = text; if (fields) c.fields = true; else delete c.fields; } return d; };
  it.runIf(LIFE_OPS_BUILT)('a title with a field and a plain title with the same words give equal text layers on preview-, still- and export-style evaluations', () => {
    const { doc, titleId } = dated('2024-12-26T10:00:00');
    for (const [stored, words] of [['a {date} b {{c}}', 'a 26 בדצמבר 2024 b {c}'], ['{hebrewDate} / {year}', 'כ״ה בכסלו תשפ״ה / 2024']] as const) {
      const field = retitled(doc, titleId, stored, true), plain = retitled(doc, titleId, words, false);
      for (const frame of [0, 17, 59]) {
        expect(evaluate(structuredClone(field), f(frame)), `still ${frame}`).toEqual(evaluate(plain, f(frame)));            // a snapshot nobody evaluated before
        expect(evaluate(field, T.add(f(frame), T.rt(1, 90))), `preview ${frame}`).toEqual(evaluate(plain, T.add(f(frame), T.rt(1, 90)))); // the editor's own object, between two frames
      }
      const sent = JSON.parse(JSON.stringify(field)) as ProjectDocument, sentPlain = JSON.parse(JSON.stringify(plain)) as ProjectDocument; // as the render page receives it
      for (let frame = 0; frame < 60; frame++) expect(evaluate(sent, f(frame)), `export ${frame}`).toEqual(evaluate(sentPlain, f(frame)));
      expect(evaluate(field, f(17)).layers.find((l) => l.kind === 'text' && l.clipId === titleId)).toMatchObject({ text: words });
    }
  });
  it.runIf(LIFE_OPS_BUILT)('the stutter and echo paths resolve a title\'s fields at the time they show', () => {
    // the file's clock passes midnight 30 frames into the clip (23:59:59 + 1 s), so the date under the title changes at frame 30
    const { doc, titleId } = dated('2024-12-25T23:59:59');
    const wordsAt = (frame: number) => (frame < 30 ? '25.12.2024' : '26.12.2024');
    const field = retitled(doc, titleId, '{date:numeric}', true);
    const stutter = tx(field, [{ op: 'add_effect', args: { clipId: titleId, type: 'time.stutter', params: { hold: 7 } } }]).doc;
    let held = 0;
    for (let frame = 0; frame < 60; frame++) {
      const l = evaluate(stutter, f(frame)).layers.find((x) => x.kind === 'text' && x.clipId === titleId);
      if (l?.kind !== 'text') throw new Error('no title layer');
      expect(l.text, `stutter ${frame} shows ${l.remap!.shownFrame}`).toBe(wordsAt(l.remap!.shownFrame));
      if (l.remap!.shownFrame < 30 && frame >= 30) held++;
    }
    expect(held).toBeGreaterThan(0); // frames after midnight that still show the title of before it
    const echo = tx(field, [{ op: 'add_effect', args: { clipId: titleId, type: 'time.echo', params: { count: 4, delay: 3 } } }]).doc;
    let both = 0;
    for (let frame = 0; frame < 60; frame++) {
      const l = evaluate(echo, f(frame)).layers.find((x) => x.kind === 'text' && x.clipId === titleId);
      if (l?.kind !== 'text') throw new Error('no title layer');
      expect(l.text).toBe(wordsAt(frame));
      const shown = l.time!.taps.map((tap) => { const at = T.frameIndexAt(tap.time, R); expect(tap.layer.kind === 'text' && tap.layer.text, `echo ${frame}, tap at ${at}`).toBe(wordsAt(at)); return at < 30; });
      if (new Set(shown).size === 2) both++;
    }
    expect(both).toBeGreaterThan(0);
  });
  it.runIf(LIFE_OPS_BUILT)('a capture-sourced stamp shows the capture date of its own file, and of the topmost dated picture under an adjustment clip', () => {
    const { doc, clipId } = dated('2024-12-25T18:15:59');
    const own = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { source: 'capture', text: "'99 1 1" } } }]);
    for (const frame of [0, 30, 59]) {
      const stamp = stampOf(evaluate(own.doc, f(frame)).layers, clipId)!;
      expect(stamp.params.text).toBe("'24 12 25"); // the typed text is not shown while the source is the capture date
      expect(STAMP_TEXT.test(String(stamp.params.text))).toBe(true);
    }
    // with the clock, the minute moves on with the source: one second into the file it is 18:16:00
    const clocked = tx(own.doc, [{ op: 'update_effect', args: { clipId, effectId: own.results[0]!.output!.effectId as string, params: { clock: true, dateOrder: 'dmy' } } }]);
    expect(stampOf(evaluate(clocked.doc, f(0)).layers, clipId)!.params.text).toBe('25.12.2024 18:15');
    expect(stampOf(evaluate(clocked.doc, f(29)).layers, clipId)!.params.text).toBe('25.12.2024 18:15');
    expect(stampOf(evaluate(clocked.doc, f(30)).layers, clipId)!.params.text).toBe('25.12.2024 18:16');
    // an adjustment clip reads the topmost dated picture under it; where none lies under it, it draws nothing
    const adj = tx(doc, [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(90) }, effects: [{ type: 'stylize.date-stamp', params: { source: 'capture' } }] } }]);
    const adjId = adj.results[0]!.output!.clipId as string;
    const adjText = (frame: number) => { const l = evaluate(adj.doc, f(frame)).layers.find((x) => x.kind === 'adjust' && x.clipId === adjId); return l && 'effects' in l ? l.effects?.find((e) => e.type === 'stylize.date-stamp')?.params.text : undefined; };
    expect(adjText(10)).toBe("'24 12 25");
    expect(adjText(75)).toBe(''); // past the end of the picture
  });
});
