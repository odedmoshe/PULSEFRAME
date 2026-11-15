import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, entityMap, sameEntity, sameEntityCanonical, type EntityState, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `q${n++}_`, actor: 'test', allowInternal }).doc;

describe('entity comparison', () => {
  it('the fast structural comparison agrees with the canonical-string reference on real entities and on mutated copies', () => {
    let d = tx(createProject({ id: 'p', name: 'p' }), [{ op: 'add_text', args: { text: 'א', start: f(0), duration: f(30) } }, { op: 'add_text', args: { text: 'ב', start: f(30), duration: f(30) } }, { op: 'add_variant', args: { profileId: 'square-1x1' } }]);
    const clipId = d.sequences.seq_main!.tracks.flatMap((t) => t.clips)[0]!.id;
    d = tx(d, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: f(3), value: 0.2 } }, { op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }]);
    const ents = [...entityMap(d).values()];
    const mutate = (e: EntityState, k: number): EntityState => {
      const c = structuredClone(e) as any;
      const leaf = (o: any, depth: number): boolean => {
        const keys = Object.keys(o);
        if (!keys.length) return false;
        const key = keys[k % keys.length]!;
        if (o[key] && typeof o[key] === 'object' && depth < 4 && leaf(o[key], depth + 1)) return true;
        if (typeof o[key] === 'number') { o[key] += 1; return true; }
        if (typeof o[key] === 'string') { o[key] += 'x'; return true; }
        if (typeof o[key] === 'boolean') { o[key] = !o[key]; return true; }
        return false;
      };
      leaf(c, 0);
      return c;
    };
    for (const a of ents) for (const b of ents) expect(sameEntity(a, b)).toBe(sameEntityCanonical(a, b));
    fc.assert(fc.property(fc.integer({ min: 0, max: ents.length - 1 }), fc.integer({ min: 0, max: 50 }), (i, k) => {
      const e = ents[i]!, m = mutate(e, k);
      return sameEntity(e, m) === sameEntityCanonical(e, m) && sameEntity(e, structuredClone(e));
    }), { numRuns: 300 });
  });
  it('key order, equal instants in different timescales and undefined properties do not count as changes; track position does not either', () => {
    const a = { kind: 'clip', sequenceId: 's', trackId: 't', clip: { id: 'c', start: T.rt(1, 2), duration: T.rt(30, 30), x: undefined } } as unknown as EntityState;
    const b = { trackId: 't', kind: 'clip', clip: { duration: T.rt(1, 1), start: T.rt(15, 30), id: 'c' }, sequenceId: 's' } as unknown as EntityState;
    expect(sameEntity(a, b)).toBe(true);
    // The string reference writes an explicit `undefined` property as null, so it would call these different; a property that is
    // undefined disappears when the document is stored as JSON, so treating it as absent is the correct reading.
    const a2 = structuredClone(a) as any; delete a2.clip.x;
    expect(sameEntityCanonical(a2, b)).toBe(true);
    const t1 = { kind: 'track', sequenceId: 's', index: 0, track: { id: 't' } } as unknown as EntityState, t2 = { kind: 'track', sequenceId: 's', index: 3, track: { id: 't' } } as unknown as EntityState;
    expect(sameEntity(t1, t2)).toBe(true);
    expect(sameEntity(a, null)).toBe(false);
    expect(sameEntity(null, undefined)).toBe(true);
  });
});
