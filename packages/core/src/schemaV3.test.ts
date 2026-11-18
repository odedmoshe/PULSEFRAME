/**
 * Schema version 3 and keyframe curves (ADR-0019 W1). The track adds no version of its own (wave4-decisions.md): the new
 * easings and `bezier` are additive under v3, whose identity MIGRATIONS[2] belongs to ADR-0018. Here: a v2 document with
 * animation migrates to a deep-equal document at v3 (apart from the version), its keys sample exactly as before, a v3 document
 * with every new curve parses and validates, and a v4 document is refused with "newer than supported".
 * The replay of whole fuzz op logs through the migration is packages/evals/src/schemaV3-replay.test.ts.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, EASINGS, findClip, migrateProject, ProjectSchema, SCHEMA_VERSION, transformAt, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `s3${n++}_`, actor: 't' });

function animated() {
  const r = tx(createProject({ id: 'p', name: 'p' }), [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(90) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  const fx = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }]);
  const effectId = fx.results[0]!.output!.effectId as string;
  const doc = tx(fx.doc, [
    { op: 'set_keyframe', args: { clipId, property: 'x', time: f(0), value: -0.3, easing: 'ease-in' } },
    { op: 'set_keyframe', args: { clipId, property: 'x', time: f(30), value: 0.3, easing: 'hold' } },
    { op: 'set_keyframe', args: { clipId, property: 'x', time: f(60), value: 0 } },
    { op: 'set_keyframe', args: { clipId, property: 'opacity', time: f(0), value: 0, easing: 'ease-in-out' } },
    { op: 'set_keyframe', args: { clipId, property: 'opacity', time: f(12), value: 1 } },
    { op: 'set_effect_keyframe', args: { clipId, effectId, param: 'radius', time: f(0), value: 0.01, easing: 'ease-out' } },
    { op: 'set_effect_keyframe', args: { clipId, effectId, param: 'radius', time: f(45), value: 0.08 } },
  ]).doc;
  return { doc, clipId, effectId };
}

describe('schema v3 and keyframe curves', () => {
  it('SCHEMA_VERSION is 3 (no bump by this track)', () => expect(SCHEMA_VERSION).toBe(3));
  it('a v2 document with v1 animation migrates to a deep-equal document at v3, and samples exactly as before', () => {
    const { doc, clipId } = animated();
    const v2 = { ...JSON.parse(JSON.stringify(doc)), schemaVersion: 2 };
    const migrated = migrateProject(v2);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated).toEqual(JSON.parse(JSON.stringify(doc)));
    expect(validateProject(migrated)).toEqual([]);
    for (let fr = 0; fr < 90; fr++) expect(Object.is(transformAt(findClip(migrated, clipId)!.clip, f(fr)).x, transformAt(findClip(doc, clipId)!.clip, f(fr)).x)).toBe(true);
    // keys gain no field on the way: a v1 key is exactly {time, value, easing}
    for (const k of findClip(migrated, clipId)!.clip.keyframes!.x!) expect(Object.keys(k)).toEqual(['time', 'value', 'easing']);
  });
  it('a v3 document with every new curve (handles included) parses, validates and reads back unchanged', () => {
    const { doc, clipId } = animated();
    let d = doc;
    let fr = 0;
    for (const easing of EASINGS) d = tx(d, [{ op: 'set_keyframe', args: { clipId, property: 'scale', time: f((fr += 5)), value: 1 + fr / 100, easing, ...(easing === 'bezier' ? { bezier: [0.2, -0.4, 0.7, 1.6] } : {}) } }]).doc;
    expect(validateProject(d)).toEqual([]);
    const stored = JSON.parse(JSON.stringify(d));
    expect(ProjectSchema.safeParse(stored).success).toBe(true);
    expect(migrateProject(stored)).toEqual(stored);
    expect(findClip(d, clipId)!.clip.keyframes!.scale!.map((k) => k.easing)).toEqual([...EASINGS]);
  });
  it('a v4 document is refused with "newer than supported"', () => {
    const v4 = { ...JSON.parse(JSON.stringify(animated().doc)), schemaVersion: 4 };
    expect(() => migrateProject(v4)).toThrow(/newer than supported/);
  });
});
