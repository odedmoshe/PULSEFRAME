/**
 * Add keyframe (K) writes the master clip's own values, whatever format is viewed: a per-format override stays in its format
 * and never leaks into the master's keyframes (a format override leaves the master untouched).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { COMMANDS } from './commands.ts';
import { Editor } from './store.ts';

const rate = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, rate);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `k${n++}_`, actor: 'test' });

/** An Editor with only the state K reads; commit records the ops instead of sending them. */
function editorOn(doc: ProjectDocument, clipId: string, viewVariantId: string | null, frame: number) {
  const e = Object.create(Editor.prototype) as Editor;
  const sent: OpCall[][] = [];
  Object.assign(e, {
    state: { doc, viewVariantId, selection: [clipId] },
    viewCache: null,
    player: { frame, playing: false },
    commit: (ops: OpCall[] | (() => OpCall[] | null)) => { const list = typeof ops === 'function' ? ops() : ops; if (list) sent.push(list); return Promise.resolve(null); },
  });
  return { e, sent };
}

describe('Add keyframe (K) while a format is viewed', () => {
  let doc = createProject({ id: 'prj_k', name: 'K' });
  const added = tx(doc, [{ op: 'add_text', args: { text: 'א', start: f(0), duration: f(90) } }]);
  doc = added.doc;
  const clipId = added.results[0]!.affectedIds[0]!;
  const v = tx(doc, [{ op: 'add_variant', args: { width: 720, height: 1280, fit: 'cover' } }]);
  const variantId = v.results[0]!.output!.variantId as string;
  doc = tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId, transform: { x: 0.3, scale: 1.5 } } }]).doc;
  const run = COMMANDS.find((c) => c.id === 'keyframe.add')!.run;
  const valueOf = (ops: OpCall[], property: string) => (ops.find((o) => (o.args as { property: string }).property === property)!.args as { value: number }).value;

  it('keys the master clip with the master values, not the format override', () => {
    const { e, sent } = editorOn(doc, clipId, variantId, 30);
    void run(e);
    expect(sent).toHaveLength(1);
    const ops = sent[0]!;
    expect(ops.every((o) => o.op === 'set_keyframe' && (o.args as { clipId: string }).clipId === clipId)).toBe(true);
    expect(valueOf(ops, 'x')).toBe(0);
    expect(valueOf(ops, 'scale')).toBe(1);
  });

  it('writes the same keys as with the master viewed', () => {
    const a = editorOn(doc, clipId, variantId, 30), b = editorOn(doc, clipId, null, 30);
    void run(a.e); void run(b.e);
    expect(a.sent).toEqual(b.sent);
  });
});
