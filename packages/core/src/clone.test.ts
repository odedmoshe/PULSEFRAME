/**
 * cloneDocument (clone.ts) against structuredClone, the copy applyTransaction made before it: on random values (plain data with
 * undefined, -0, NaN, bigints, shared and cyclic references, null-prototype objects, holes, "__proto__" keys, Dates, Maps,
 * class instances, functions) and on real project documents, the two copies have the same shape down to key order, prototypes,
 * -0, holes and which objects are shared; and when structuredClone throws, cloneDocument throws the same error.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { cloneDocument } from './clone.ts';
import { applyTransaction, createProject } from './index.ts';

/** A full description of a value graph: every object gets an index the first time it is met, later meetings name the index. */
function shape(v: unknown, ids = new Map<object, number>()): unknown {
  if (typeof v !== 'object' || v === null) {
    if (typeof v === 'number') return { number: Object.is(v, -0) ? '-0' : String(v) };
    if (typeof v === 'bigint') return { bigint: String(v) };
    return { [typeof v]: v === undefined ? 'undefined' : String(v) };
  }
  const seen = ids.get(v);
  if (seen !== undefined) return { ref: seen };
  ids.set(v, ids.size);
  const proto = Object.getPrototypeOf(v);
  const kind = proto === null ? 'null' : proto === Object.prototype ? 'Object' : proto === Array.prototype ? 'Array' : (proto.constructor?.name ?? '?');
  if (v instanceof Date) return { kind, time: v.getTime() };
  if (v instanceof Map) return { kind, entries: [...v].map(([k, x]) => [shape(k, ids), shape(x, ids)]) };
  const own = Reflect.ownKeys(v).map(String);
  return { kind, ...(Array.isArray(v) ? { length: v.length } : {}), keys: own, values: Object.keys(v).map((k) => shape((v as Record<string, unknown>)[k], ids)) };
}
const outcome = (fn: () => unknown) => { try { return { ok: shape(fn()) }; } catch (e) { return { error: (e as Error).name, message: (e as Error).message }; } };

class Thing { constructor(public a = 1) {} }
const leaf = fc.oneof(
  fc.integer(), fc.double(), fc.constantFrom(-0, NaN, Infinity, 0), fc.string(), fc.boolean(), fc.constant(null), fc.constant(undefined), fc.bigInt(),
  fc.constantFrom('__proto__', 'constructor', '0', '10', 'b', 'a'),
);
const rare = fc.oneof(
  fc.constant(new Date(5)), fc.constant(new Map([[1, 2]])), fc.constant(new Thing()), fc.constant(() => 1), fc.constant(Symbol('s')),
  fc.constant(Object.assign(Object.create(null), { x: 1 })), fc.constant(JSON.parse('{"__proto__": 1, "a": 2}')),
  // eslint-disable-next-line no-sparse-arrays
  fc.constant([1, , 3]), fc.constant(Object.assign([1, 2], { extra: true })), fc.constant(new Uint8Array([1, 2])),
);
const { tree } = fc.letrec((tie) => ({
  tree: fc.oneof({ depthSize: 'small' }, leaf, tie('object'), tie('array')),
  object: fc.dictionary(fc.oneof(fc.string(), fc.constantFrom('0', '7', 'z', 'a', 'value', 'timescale')), tie('tree'), { maxKeys: 5 }),
  array: fc.array(tie('tree'), { maxLength: 5 }),
}));
/** Make some objects of the tree shared (and sometimes cyclic), as an in-memory document may hold them. */
function share(v: unknown, pick: number[], cyclic: boolean): unknown {
  const objects: Record<string, unknown>[] = [];
  const visit = (x: unknown) => { if (x && typeof x === 'object' && !Array.isArray(x)) { objects.push(x as Record<string, unknown>); for (const y of Object.values(x)) visit(y); } else if (Array.isArray(x)) x.forEach(visit); };
  visit(v);
  if (objects.length > 1) for (const [i, p] of pick.entries()) objects[p % objects.length]![`s${i}`] = objects[(p * 7 + 1) % objects.length];
  if (cyclic && objects.length) objects[0]!.self = objects[0];
  return v;
}

describe('cloneDocument answers exactly as structuredClone', () => {
  it('plain trees, with shared and cyclic references', () => {
    fc.assert(fc.property(tree, fc.array(fc.nat(), { maxLength: 3 }), fc.boolean(), (t, pick, cyclic) => {
      const v = share({ root: t }, pick, cyclic);
      expect(outcome(() => cloneDocument(v))).toEqual(outcome(() => structuredClone(v)));
    }), { numRuns: 3000 });
  });
  it('trees holding something that is not plain data (it hands those to structuredClone, which copies or throws)', () => {
    fc.assert(fc.property(tree, rare, fc.nat(), (t, odd, where) => {
      const v = { a: t, b: [t, where % 2 ? odd : 1], c: where % 3 ? odd : null };
      expect(outcome(() => cloneDocument(v))).toEqual(outcome(() => structuredClone(v)));
    }), { numRuns: 1000 });
  });
  it('a copy is a copy: the input is untouched and nothing is shared with it', () => {
    const doc = applyTransaction(createProject({ id: 'prj_c', name: 'c', width: 640, height: 360, frameRate: { num: 30, den: 1 } }), [{ op: 'add_text', args: { text: 'שלום', start: T.ZERO, duration: T.rt(1, 1) } }], { idSeed: 'c', actor: 't' }).doc;
    const before = JSON.stringify(doc);
    const copy = cloneDocument(doc);
    expect(shape(copy)).toEqual(shape(structuredClone(doc)));
    expect(JSON.stringify(copy)).toBe(before);
    const all = new Set<object>();
    const walk = (x: unknown) => { if (x && typeof x === 'object') { all.add(x); Object.values(x).forEach(walk); } };
    walk(doc);
    const leak = (x: unknown): boolean => !!x && typeof x === 'object' && (all.has(x) || Object.values(x).some(leak));
    expect(leak(copy)).toBe(false);
    (copy.sequences[copy.mainSequenceId]!.tracks.flatMap((t) => t.clips)[0]!.transform as { x: number }).x = 0.5;
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('with an enumerable property added to Object.prototype it still answers as structuredClone', () => {
    const v = { a: { b: [1, { c: 2 }] } };
    (Object.prototype as Record<string, unknown>).pfPolluted = 1;
    try { expect(outcome(() => cloneDocument(v))).toEqual(outcome(() => structuredClone(v))); }
    finally { delete (Object.prototype as Record<string, unknown>).pfPolluted; }
  });
});
