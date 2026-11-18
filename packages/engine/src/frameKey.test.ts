/**
 * The frame key of the render cache (ADR-0024, plan §2 with the verifier's corrected note C): canonicalJson, the inputs a frame
 * reads outside its graph, the named Infinity cases (a strobe before its first flash, a snow overlay), the five layer kinds and
 * the keying cost. The edit properties (an edit that changes a frame changes its key; one that cannot reach it does not) are in
 * frameKey.props.test.ts.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { createProject } from '@pulseframe/core';
import { FLASH_SINCE } from './gpu.ts';
import { evaluate, type Layer, type RenderGraph, type TextLayer, type VideoLayer } from './evaluate.ts';
import { canonicalJson, FRAME_KEY_PREFIX, frameInputs, frameKey, frameKeyOfGraph, UnkeyableError } from './frameKey.ts';
import { baseEnv, ctxFor, f, R, richDoc, sha256, sound, tx } from './frameKey.testDocs.ts';

/** JSON.stringify with keys sorted at every level (by code unit, integer-like keys included): the reference canonicalJson must agree with on plain JSON values. */
const sortedStringify = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(sortedStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sortedStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const hasNegZero = (v: unknown): boolean => (typeof v === 'number' ? Object.is(v, -0) : v && typeof v === 'object' ? Object.values(v).some(hasNegZero) : false);
/** A plain value with the same members in a different insertion order, at every level. */
function reorder<V>(v: V, rnd: () => number): V {
  if (Array.isArray(v)) return v.map((x) => reorder(x, rnd)) as V;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as object);
    for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [entries[i], entries[j]] = [entries[j]!, entries[i]!]; }
    return Object.fromEntries(entries.map(([k, x]) => [k, reorder(x, rnd)])) as V;
  }
  return v;
}
const thrown = (fn: () => unknown): unknown => { try { fn(); } catch (e) { return e; } return null; };
const expectUnkeyable = (fn: () => unknown, code: string, path?: RegExp) => {
  const e = thrown(fn);
  expect(e).toBeInstanceOf(UnkeyableError);
  expect((e as UnkeyableError).code).toBe(code);
  if (path) expect((e as UnkeyableError).path).toMatch(path);
};

describe('canonicalJson', () => {
  it('equals JSON.stringify with sorted keys on plain JSON values (no whitespace), whatever the insertion order', () => {
    fc.assert(fc.property(fc.jsonValue(), fc.integer(), (v, s) => {
      fc.pre(!hasNegZero(v));
      const text = canonicalJson(v);
      expect(text).toBe(sortedStringify(v));
      let a = s >>> 0;
      const rnd = () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; };
      expect(canonicalJson(reorder(v, rnd))).toBe(text);
      expect(JSON.parse(text)).toEqual(v);
    }), { numRuns: 300 });
    expect(canonicalJson({ b: 1, a: [1, 'x', null, true], c: { z: 0, y: 'é' } })).toBe('{"a":[1,"x",null,true],"b":1,"c":{"y":"é","z":0}}');
  });

  it('omits undefined object members, but tags undefined in an array slot so [undefined] and [null] differ', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson([undefined])).not.toBe(canonicalJson([null]));
    // eslint-disable-next-line no-sparse-arrays
    expect(canonicalJson([1, , 3])).toBe(canonicalJson([1, undefined, 3]));
  });

  it('encodes NaN, ±Infinity and -0 as tagged tokens no JSON number or string can equal', () => {
    const values: unknown[] = [NaN, Infinity, -Infinity, -0, 0, 1e308, -1e308, null, '#NaN', '#+Inf', '#-Inf', '#-0', 'NaN', 'Infinity', '-0', '0'];
    const texts = values.map((v) => canonicalJson({ v }));
    expect(new Set(texts).size).toBe(values.length);
    expect(canonicalJson(NaN)).toBe('#NaN');
    expect(canonicalJson([Infinity, -Infinity, -0])).toBe('[#+Inf,#-Inf,#-0]');
    expect(canonicalJson({ n: 0 })).toBe('{"n":0}');
  });

  it('equal text exactly when the values are equal (deep, -0 apart from 0, NaN equal to NaN, undefined members absent)', () => {
    const leaf = fc.oneof(fc.constantFrom(NaN, Infinity, -Infinity, -0, 0, 1, 0.1, 'a', '#NaN', true, false, null, undefined), fc.integer({ min: -3, max: 3 }), fc.string({ maxLength: 3 }));
    const { tree } = fc.letrec((tie) => ({ tree: fc.oneof({ depthSize: 'small' }, leaf, fc.array(tie('tree'), { maxLength: 3 }), fc.dictionary(fc.constantFrom('a', 'b', 'c'), tie('tree'), { maxKeys: 3 })) }));
    /** Deep equality the key must agree with: Object.is on numbers, undefined members ignored, array slots compared as they are. */
    const same = (x: unknown, y: unknown): boolean => {
      if (typeof x === 'number' || typeof y === 'number') return Object.is(x, y);
      if (Array.isArray(x) || Array.isArray(y)) return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => same(v, y[i]));
      if (x && y && typeof x === 'object' && typeof y === 'object') {
        const kx = Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined).sort(), ky = Object.keys(y).filter((k) => (y as Record<string, unknown>)[k] !== undefined).sort();
        return kx.length === ky.length && kx.every((k, i) => k === ky[i] && same((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]));
      }
      return x === y;
    };
    fc.assert(fc.property(tree, tree, (x, y) => { expect(canonicalJson(x) === canonicalJson(y)).toBe(same(x, y)); }), { numRuns: 1000 });
  });

  it('throws UnkeyableError(unkeyable_value) with the path for values with no stable encoding', () => {
    class Box { v = 1; }
    const cyclic: Record<string, unknown> = { a: 1 }; cyclic.self = cyclic;
    const cases: [string, unknown][] = [
      ['function', () => 1], ['symbol', Symbol('s')], ['bigint', 1n], ['Map', new Map()], ['Set', new Set()], ['typed array', new Uint8Array(2)],
      ['Float32Array', new Float32Array(1)], ['ArrayBuffer', new ArrayBuffer(2)], ['DataView', new DataView(new ArrayBuffer(2))], ['Date', new Date(0)], ['class instance', new Box()], ['cycle', cyclic],
    ];
    for (const [name, v] of cases) expectUnkeyable(() => canonicalJson({ layers: [{ effects: [{ params: { x: v } }] }] }), 'unkeyable_value', name === 'cycle' ? /^\$\.layers\[0\]\.effects\[0\]\.params\.x/ : /^\$\.layers\[0\]\.effects\[0\]\.params\.x /);
    expectUnkeyable(() => canonicalJson({ [Symbol('k')]: 1 }), 'unkeyable_value');
    expectUnkeyable(() => canonicalJson({ 'a b': [1, () => 1] }), 'unkeyable_value', /^\$\["a b"\]\[1\] /);
    // a null-prototype object is plain; the same object twice (not a cycle) is fine
    const o = Object.assign(Object.create(null) as object, { b: 2, a: 1 });
    expect(canonicalJson(o)).toBe('{"a":1,"b":2}');
    const shared = { x: 1 };
    expect(canonicalJson([shared, shared])).toBe('[{"x":1},{"x":1}]');
  });
});

describe('frame inputs', () => {
  const rich = richDoc();
  const { doc, assets, clips } = rich;
  const ctx = ctxFor(doc);
  const at = (frame: number) => frameInputs(doc, evaluate(doc, f(frame)), ctx);

  it('names every file, font, effect version, transition and the adapter a frame reads', () => {
    // frame 10: file A (with its redaction), the still with a colour table and a wave (GPU passes); music under it (not a picture input)
    expect(at(10)).toEqual({ assets: { [assets.A]: doc.assets[assets.A]!.contentHash, [assets.IMG]: doc.assets[assets.IMG]!.contentHash, [assets.LUT]: doc.assets[assets.LUT]!.contentHash }, fonts: {}, effects: { 'color.lut': 1, 'distort.wave': 1 }, transitions: [], gpu: 'swiftshader|test' });
    // frame 45: two titles and the captions read the default family; the beat-following blur is an effect of the title
    expect(at(45).fonts).toEqual({ Heebo: 'font-heebo-1' });
    expect(at(45).effects['blur.gaussian']).toBe(1);
    // frame 92: the dissolve with A playing on from its handle, B coming in, and the split clip E over them
    expect(at(92)).toMatchObject({ transitions: ['dissolve'], effects: { 'time.split': 1 }, gpu: null });
    expect(Object.keys(at(92).assets).sort()).toEqual([assets.A, assets.B].sort());
    // frame 130: stutter, grain and snow on D; the title with live fields
    expect(at(130).effects).toEqual({ 'time.stutter': 1, 'stylize.grain': 1, 'overlay.snow': 1 });
    // frame 205: the echo (time effect) on C, the adjustment's colour adjust, the strobe (a GPU pass) on T4
    expect(at(205)).toMatchObject({ effects: { 'time.echo': 1, 'color.adjust': 1, 'light.strobe': 1 }, gpu: 'swiftshader|test' });
    expect(at(205).assets).toEqual({ [assets.A]: doc.assets[assets.A]!.contentHash });
    // the sound files are never picture inputs
    for (let frame = 0; frame < 300; frame += 7) { const a = at(frame).assets; expect(a[assets.SONG]).toBeUndefined(); expect(a[assets.SFX]).toBeUndefined(); }
  });

  it('the over-inclusive scan keys any string of the picture that names a library entry', () => {
    const g = evaluate(doc, f(250));
    const planted: RenderGraph = { ...g, layers: g.layers.map((l, i) => (i === 0 && l.kind === 'video' ? { ...l, effects: [{ type: 'future.sticker', params: { picture: assets.IMG, note: 'not an asset' } }] } : l)) };
    const inputs = frameInputs(doc, planted, ctx);
    expect(inputs.assets[assets.IMG]).toBe(doc.assets[assets.IMG]!.contentHash);
    expect(inputs.assets['not an asset']).toBeUndefined();
    expect(inputs.effects['future.sticker']).toBe(1);
    // and a sound file named only in `audio` is not scanned: the compositor never reads graph.audio
    expect(g.audio.some((a) => a.assetId === assets.SONG)).toBe(true);
    expect(frameInputs(doc, g, ctx).assets[assets.SONG]).toBeUndefined();
  });

  it('an unknown layer kind throws unknown_layer_kind; a missing hash throws asset_unhashed', () => {
    const g = evaluate(doc, f(250));
    const odd = { ...g, layers: [...g.layers, { kind: 'hologram' } as unknown as Layer] };
    expectUnkeyable(() => frameInputs(doc, odd, ctx), 'unknown_layer_kind', /layers\[2\]/);
    expectUnkeyable(() => frameKeyOfGraph(doc, odd, ctx), 'unknown_layer_kind');
    const tapOdd = { ...g, layers: g.layers.map((l) => (l.kind === 'video' && l.time ? { ...l, time: { ...l.time, taps: [{ ...l.time.taps[0]!, layer: { kind: 'hologram' } as unknown as VideoLayer }] } } : l)) };
    expectUnkeyable(() => frameInputs(doc, tapOdd, ctx), 'unknown_layer_kind', /taps\[0\]/);
    const env = baseEnv();
    env.assetOverride[assets.LUT] = null;
    expectUnkeyable(() => frameKey(doc, 10, ctxFor(doc, env)), 'asset_unhashed', /asset /);
    expect(() => frameKey(doc, 100, ctxFor(doc, env))).not.toThrow(); // the table is read on 0–59 only
    const noFonts = baseEnv();
    noFonts.fonts = {};
    expectUnkeyable(() => frameKey(doc, 45, ctxFor(doc, noFonts)), 'asset_unhashed', /font Heebo/);
    expect(() => frameKey(doc, 250, ctxFor(doc, noFonts))).not.toThrow();
  });

  it('a GPU pass is keyable only on a software adapter (gpu_not_reproducible otherwise); a frame without one needs no adapter', () => {
    for (const gpu of [null, { adapter: 'nvidia|ampere', software: false }]) {
      const env = baseEnv();
      env.gpu = gpu;
      const c = ctxFor(doc, env);
      for (const frame of [0, 59, 150, 209]) expectUnkeyable(() => frameKey(doc, frame, c), 'gpu_not_reproducible');
      for (const frame of [60, 92, 149, 210, 299]) { expect(() => frameKey(doc, frame, c)).not.toThrow(); expect(frameInputs(doc, evaluate(doc, f(frame)), c).gpu).toBeNull(); }
    }
    expect(at(0).gpu).toBe('swiftshader|test');
  });

  it('frameKeyOfGraph is the digest of the prefix and canonicalJson({ g at the output size without audio, in }); frameKey evaluates the programme frame', () => {
    for (const frame of [0, 45, 92, 130, 205, 299]) {
      const g = evaluate(doc, f(frame));
      const { audio: _a, ...picture } = g;
      const text = FRAME_KEY_PREFIX + canonicalJson({ g: { ...picture, width: 640, height: 360 }, in: frameInputs(doc, g, ctx) });
      expect(frameKeyOfGraph(doc, g, ctx)).toBe(sha256(text));
      expect(frameKey(doc, frame, ctx)).toBe(sha256(text));
      expect(frameKey(doc, frame, ctx)).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(() => frameKey(doc, -1, ctx)).toThrow(RangeError);
    expect(() => frameKey(doc, 1.5, ctx)).toThrow(RangeError);
    // sequenceId: a missing sequence is the evaluator's error, not a key
    expect(() => frameKey(doc, 0, { ...ctx, sequenceId: 'seq_none' })).toThrow(/not found/);
  });

  it('every frame of the rich document keys without throwing, with all five layer kinds, and canonicalJson(evaluate()) never throws', () => {
    const kinds = new Set<string>();
    const keys = new Set<string>();
    for (let frame = 0; frame < 300; frame++) {
      const g = evaluate(doc, f(frame));
      for (const l of g.layers) kinds.add(l.kind);
      expect(() => canonicalJson(g)).not.toThrow();
      keys.add(frameKey(doc, frame, ctx));
    }
    expect([...kinds].sort()).toEqual(['adjust', 'caption', 'image', 'text', 'video']);
    expect(keys.size).toBe(300); // time and frame index are in every graph (stated limit (a) of ADR-0024)
    void clips;
  });
});

describe('Infinity in the graph is cacheable (verifier, corrected note C)', () => {
  it('a light.strobe clip before its first flash keys without throwing, and differently from the same frame with a finite value there', () => {
    // a strobe that follows the music, over frames 0–59; the analysed music starts at frame 30, so frames 0–29 have had no flash
    let r = tx(createProject({ id: 'prj_st', name: 'S', frameRate: R }), [{ op: 'import_asset', args: { asset: sound('song.wav', '9', 30) } }], true);
    const song = r.results[0]!.output!.assetId as string;
    const times = Array.from({ length: 40 }, (_, i) => T.rt(500 * i, 1000));
    r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId: song, kind: 'beats', method: 'test', params: {}, createdAt: 'x', times, bpm: 120 } }], true);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: song, start: f(30) } }, { op: 'add_text', args: { text: 'X', start: f(0), duration: f(60) } }]);
    const title = r.results[1]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'add_effect', args: { clipId: title, type: 'light.strobe', params: { amount: 1, follow: 'music' } } }]);
    const doc = r.doc;
    const ctx = ctxFor(doc);
    const since = (g: RenderGraph) => (g.layers.find((l): l is TextLayer => l.kind === 'text')!.effects!.find((e) => e.type === 'light.strobe')!.params[FLASH_SINCE]);
    let before = 0, after = 0;
    for (let frame = 0; frame < 60; frame++) {
      const g = evaluate(doc, f(frame));
      const key = frameKeyOfGraph(doc, g, ctx);
      if (since(g) === Infinity) {
        before++;
        const finite = { ...g, layers: g.layers.map((l) => (l.kind === 'text' ? { ...l, effects: l.effects!.map((e) => ({ ...e, params: { ...e.params, [FLASH_SINCE]: Number.MAX_VALUE } })) } : l)) };
        expect(frameKeyOfGraph(doc, finite, ctx)).not.toBe(key);
      } else after++;
    }
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
  });

  it('a snow overlay keys without throwing, and differently from the same frame with a finite value in the Infinity place', () => {
    const rich = richDoc();
    const { clips, effects } = rich;
    // the speed limit is Infinity when no setting of the overlay can flash (heldOverlayParams): a faint or empty snow
    const candidates = [{}, { amount: 0.05 }, { density: 0.02 }, { density: 0 }];
    let found = 0;
    for (const params of candidates) {
      const doc = Object.keys(params).length ? tx(rich.doc, [{ op: 'update_effect', args: { clipId: clips.D, effectId: effects.Dsnow, params } }]).doc : rich.doc;
      const ctx = ctxFor(doc);
      const g = evaluate(doc, f(130));
      const snow = (g.layers.find((l) => l.kind === 'video' && l.clipId === clips.D) as VideoLayer).effects!.find((e) => e.type === 'overlay.snow')!;
      const key = frameKeyOfGraph(doc, g, ctx); // never throws, Infinity or not
      const inf = Object.entries(snow.params).filter(([, v]) => v === Infinity).map(([k]) => k);
      if (!inf.length) continue;
      found++;
      const finite = { ...g, layers: g.layers.map((l) => (l.kind === 'video' && l.clipId === clips.D ? { ...l, effects: l.effects!.map((e) => (e.type === 'overlay.snow' ? { ...e, params: { ...e.params, [inf[0]!]: Number.MAX_VALUE } } : e)) } : l)) };
      expect(frameKeyOfGraph(doc, finite, ctx)).not.toBe(key);
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('keying cost (reported, not asserted)', () => {
  it('measures the median time to key one frame of the rich document', () => {
    const { doc } = richDoc();
    const ctx = ctxFor(doc);
    const graphs = Array.from({ length: 300 }, (_, i) => evaluate(doc, f(i)));
    for (let i = 0; i < 300; i++) frameKey(doc, i, ctx); // warm up
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1]!;
    const keyOnly: number[] = [], whole: number[] = [];
    for (let round = 0; round < 5; round++) for (let i = 0; i < 300; i++) {
      let t = performance.now();
      frameKeyOfGraph(doc, graphs[i]!, ctx);
      keyOnly.push(performance.now() - t);
      t = performance.now();
      frameKey(doc, i, ctx);
      whole.push(performance.now() - t);
    }
    const richest = graphs.reduce((a, g) => (canonicalJson(g).length > canonicalJson(a).length ? g : a));
    const richestMs: number[] = [];
    for (let k = 0; k < 500; k++) { const t = performance.now(); frameKeyOfGraph(doc, richest, ctx); richestMs.push(performance.now() - t); }
    console.log(`[frame key cost] median per frame over 300 frames x 5: key of an evaluated graph ${median(keyOnly).toFixed(4)} ms; evaluate + key ${median(whole).toFixed(4)} ms; richest frame (${richest.frameIndex}, ${canonicalJson(richest).length} chars) key only ${median(richestMs).toFixed(4)} ms (target 0.15 ms, verifier note C)`);
    expect(median(whole)).toBeGreaterThan(0);
  }, 120_000);
});
