/**
 * "Apply to: the whole edit" and "cover the whole edit" (ADR-0016), as the editor builds them (commands.ts): checked against
 * the real ops, each a single transaction, and against the palette registry.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, COLOR_LOOKS, createProject, findClip, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { COMMANDS, coverEditOps, editEnd, keyframeProps, wholeEditAdjustment, wholeEditOps } from './commands.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `we${n++}_`, actor: 'test', allowInternal });
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };

/** A picture 0–60 and a title 30–90: the edit ends at frame 90. */
function edit() {
  let r = tx(createProject({ id: 'prj_we', name: 'W' }), [{ op: 'import_asset', args: { asset: still } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: 'כותרת', start: f(30), duration: f(60) } }]);
  return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string };
}
const adjustments = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'adjustment');

describe('apply to the whole edit', () => {
  it('the end of the edit is the end of the last picture or title clip, as add_adjustment span "edit" measures it', () => {
    const { doc } = edit();
    expect(T.frameIndexAt(editEnd(doc), R)).toBe(90);
    expect(T.eq(editEnd(createProject({ id: 'p', name: 'p' })), T.ZERO)).toBe(true);
  });
  it('without a whole-edit adjustment: one add_adjustment carrying the effect; with one: one add_effect on it', () => {
    const { doc } = edit();
    expect(wholeEditAdjustment(doc)).toBeNull();
    const first = wholeEditOps(doc, { kind: 'effect', type: 'color.grayscale' })!;
    expect(first).toEqual([{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grayscale' }] } }]);
    const d1 = tx(doc, first).doc;
    expect(validateProject(d1)).toEqual([]);
    const adj = wholeEditAdjustment(d1)!;
    expect(adj.clip.effects!.map((e) => e.type)).toEqual(['color.grayscale']);
    expect([T.frameIndexAt(adj.clip.start, R), T.frameIndexAt(adj.clip.duration, R)]).toEqual([0, 90]);
    const second = wholeEditOps(d1, { kind: 'effect', type: 'blur.gaussian', params: { radius: 0.02 } })!;
    expect(second).toEqual([{ op: 'add_effect', args: { clipId: adj.clip.id, type: 'blur.gaussian', params: { radius: 0.02 } } }]);
    const d2 = tx(d1, second).doc;
    expect(adjustments(d2)).toHaveLength(1);
    expect(wholeEditAdjustment(d2)!.clip.effects!.map((e) => e.type)).toEqual(['color.grayscale', 'blur.gaussian']);
  });
  it('a colour look: add_adjustment with its color.grade settings, or apply_look on the existing layer', () => {
    const { doc } = edit();
    const look = COLOR_LOOKS[0]!;
    const ops = wholeEditOps(doc, { kind: 'look', lookId: look.id })!;
    expect(ops).toEqual([{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grade', params: { ...look.params } }] } }]);
    const d1 = tx(doc, ops).doc;
    const adj = wholeEditAdjustment(d1)!;
    expect(wholeEditOps(d1, { kind: 'look', lookId: look.id })).toEqual([{ op: 'apply_look', args: { clipId: adj.clip.id, lookId: look.id } }]);
    expect(wholeEditOps(d1, { kind: 'look', lookId: 'no-such-look' })).toBeNull();
  });
  it('nothing for an empty edit or an effect an adjustment refuses (time effects, chroma key, shadow)', () => {
    expect(wholeEditOps(createProject({ id: 'p', name: 'p' }), { kind: 'effect', type: 'color.grayscale' })).toBeNull();
    const { doc } = edit();
    for (const type of ['time.echo', 'key.chroma', 'stylize.shadow']) expect(wholeEditOps(doc, { kind: 'effect', type })).toBeNull();
  });
  it('a layer that no longer covers the whole edit, or sits on a hidden or locked track, is not the whole-edit layer', () => {
    const { doc } = edit();
    const d1 = tx(doc, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.sepia' }] } }]).doc;
    const adj = wholeEditAdjustment(d1)!;
    const longer = tx(d1, [{ op: 'add_text', args: { text: 'סוף', start: f(90), duration: f(30) } }]).doc;
    expect(wholeEditAdjustment(longer)).toBeNull();
    const hidden = tx(d1, [{ op: 'update_track', args: { trackId: adj.track.id, hidden: true } }]).doc;
    expect(wholeEditAdjustment(hidden)).toBeNull();
    const locked = tx(d1, [{ op: 'update_track', args: { trackId: adj.track.id, locked: true } }]).doc;
    expect(wholeEditAdjustment(locked)).toBeNull();
  });
});

describe('cover the whole edit', () => {
  it('trims an adjustment to [0, end of the edit) in one transaction; nothing when it already covers it', () => {
    const { doc } = edit();
    const r = tx(doc, [{ op: 'add_adjustment', args: { span: { start: f(20), duration: f(10) }, effects: [{ type: 'color.invert' }] } }]);
    const id = r.results[0]!.output!.clipId as string;
    const ops = coverEditOps(r.doc, id)!;
    expect(ops.map((o) => (o.args as { edge: string }).edge)).toEqual(['start', 'end']);
    const covered = tx(r.doc, ops).doc;
    const c = findClip(covered, id)!.clip;
    expect([T.frameIndexAt(c.start, R), T.frameIndexAt(T.add(c.start, c.duration), R)]).toEqual([0, 90]);
    expect(validateProject(covered)).toEqual([]);
    expect(coverEditOps(covered, id)).toBeNull();
    // a layer that runs past the end is shortened to it
    const past = tx(doc, [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(150) }, effects: [{ type: 'color.invert' }] } }]);
    const pid = past.results[0]!.output!.clipId as string;
    expect(coverEditOps(past.doc, pid)).toEqual([{ op: 'trim_clip', args: { clipId: pid, edge: 'end', to: f(90) } }]);
  });
  it('only for adjustment clips', () => {
    const { doc, clipId } = edit();
    expect(coverEditOps(doc, clipId)).toBeNull();
  });
});

describe('keyframes and the palette', () => {
  it('an adjustment clip keys opacity only; other clips key the whole transform', () => {
    const { doc } = edit();
    const r = tx(doc, [{ op: 'add_adjustment', args: { span: 'edit' } }]);
    expect(keyframeProps(findClip(r.doc, r.results[0]!.output!.clipId as string)!.clip)).toEqual(['opacity']);
    expect(keyframeProps(findClip(doc, edit().clipId)?.clip ?? doc.sequences[doc.mainSequenceId]!.tracks[0]!.clips[0]!)).toEqual(['x', 'y', 'scale', 'rotation', 'opacity']);
  });
  it('the palette offers an adjustment layer over the whole edit and the templates, worded in both languages', () => {
    const add = COMMANDS.find((c) => c.id === 'edit.addAdjustment')!, open = COMMANDS.find((c) => c.id === 'view.openTemplates')!;
    expect([add.label, open.label]).toEqual(['cmd.addAdjustment', 'cmd.openTemplates']);
    for (const c of [add, open]) { expect(dictionaries.he[c.label]).toBeTruthy(); expect(dictionaries.en[c.label]).toBeTruthy(); expect(c.keys).toEqual([]); }
  });
});
