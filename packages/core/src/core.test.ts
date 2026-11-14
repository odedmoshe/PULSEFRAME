import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, describeOps, findClip, migrateProject, OpError, ProjectSchema, sequenceDuration, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seedN = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `t${seedN++}_`, actor: 'test', allowInternal });
const assetArgs = (hash: string, seconds = 4, audio = true) => ({
  asset: {
    kind: 'video' as const, name: 'fixture.mp4', contentHash: `sha256:${hash.padStart(64, '0')}`, byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1),
    video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: seconds * 30 },
    ...(audio ? { audio: { sampleRate: 48000, channels: 2, codec: 'aac' } } : {}),
    provenance: { origin: 'fixture' as const, importedAt: '2026-11-14T00:00:00Z', importedBy: 'test' },
  },
});
function withAsset() {
  const r = tx(createProject({ id: 'prj_t', name: 'T' }), [{ op: 'import_asset', args: assetArgs('a1') }], true);
  return { doc: r.doc, assetId: r.results[0]!.output!.assetId as string };
}
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `non-op:${e}`; } return 'ok'; };

describe('operations', () => {
  it('new project is valid and round-trips through JSON + migration', () => {
    const doc = createProject({ id: 'prj_x', name: 'X' });
    expect(validateProject(doc)).toEqual([]);
    expect(migrateProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(() => migrateProject({ ...doc, schemaVersion: 99 })).toThrow(/newer/);
  });
  it('add_clip creates linked picture + audio and is pure', () => {
    const { doc, assetId } = withAsset();
    const before = JSON.stringify(doc);
    const r = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
    expect(JSON.stringify(doc)).toBe(before);
    const v = findClip(r.doc, r.results[0]!.output!.clipId as string)!;
    const a = findClip(r.doc, r.results[0]!.output!.audioClipId as string)!;
    expect(v.track.kind).toBe('video');
    expect(a.track.kind).toBe('audio');
    expect(v.clip.type === 'media' && a.clip.type === 'media' && v.clip.linkGroupId === a.clip.linkGroupId && v.clip.linkGroupId).toBeTruthy();
    expect(T.eq(sequenceDuration(r.doc), T.rt(4, 1))).toBe(true);
    expect(ProjectSchema.safeParse(r.doc).success).toBe(true);
  });
  it('split keeps source mapping exact and links right halves', () => {
    const { doc, assetId } = withAsset();
    const a = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(10), sourceIn: f(15), duration: f(60) } }]);
    const id = a.results[0]!.output!.clipId as string;
    const s = tx(a.doc, [{ op: 'split_clip', args: { clipId: id, at: f(40) } }]);
    const left = findClip(s.doc, id)!.clip;
    const right = findClip(s.doc, s.results[0]!.output!.rightClipId as string)!.clip;
    if (left.type !== 'media' || right.type !== 'media') throw new Error('type');
    expect(T.eq(left.duration, f(30))).toBe(true);
    expect(T.eq(right.sourceIn, f(45))).toBe(true);
    expect(T.eq(right.duration, f(30))).toBe(true);
    expect(right.linkGroupId).not.toBe(left.linkGroupId);
    expect((s.results[0]!.output!.createdClipIds as string[]).length).toBe(2);
  });
  it('trim start advances the source in-point; linked audio follows', () => {
    const { doc, assetId } = withAsset();
    const a = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
    const t = tx(a.doc, [{ op: 'trim_clip', args: { clipId: a.results[0]!.output!.clipId, edge: 'start', to: f(30) } }]);
    for (const k of ['clipId', 'audioClipId']) {
      const c = findClip(t.doc, a.results[0]!.output![k] as string)!.clip;
      expect(c.type === 'media' && T.eq(c.sourceIn, f(30)) && T.eq(c.start, f(30)) && T.eq(c.duration, f(90))).toBe(true);
    }
  });
  it('rejects with typed errors and leaves no partial state', () => {
    const { doc, assetId } = withAsset();
    const a = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
    const id = a.results[0]!.output!.clipId as string;
    expect(code(() => tx(a.doc, [{ op: 'nope', args: {} }]))).toBe('unknown_op');
    expect(code(() => tx(a.doc, [{ op: 'import_asset', args: assetArgs('b2') }]))).toBe('forbidden_op');
    expect(code(() => tx(a.doc, [{ op: 'add_clip', args: { assetId, start: f(30), trackId: 'trk_video' } }]))).toBe('overlap');
    expect(code(() => tx(a.doc, [{ op: 'add_clip', args: { assetId, start: T.rt(1, 7) } }]))).toBe('invalid_args');
    expect(code(() => tx(a.doc, [{ op: 'trim_clip', args: { clipId: id, edge: 'end', to: f(200) } }]))).toBe('out_of_bounds');
    expect(code(() => tx(a.doc, [{ op: 'split_clip', args: { clipId: id, at: f(0) } }]))).toBe('out_of_bounds');
    expect(code(() => tx(a.doc, [{ op: 'delete_clip', args: { clipId: 'clp_missing' } }]))).toBe('not_found');
    expect(code(() => tx(a.doc, [{ op: 'update_text', args: { clipId: id, text: 'x' } }]))).toBe('incompatible');
    expect(code(() => tx(a.doc, [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30), bogus: 1 } }]))).toBe('invalid_args');
    // all-or-nothing: first op valid, second invalid -> original untouched, nothing returned
    const snap = JSON.stringify(a.doc);
    expect(code(() => tx(a.doc, [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } }, { op: 'delete_clip', args: { clipId: 'nope' } }]))).toBe('not_found');
    expect(JSON.stringify(a.doc)).toBe(snap);
    const locked = structuredClone(a.doc);
    locked.sequences.seq_main!.tracks.find((t) => t.kind === 'audio')!.locked = true;
    expect(code(() => tx(locked, [{ op: 'move_clip', args: { clipId: id, start: f(30) } }]))).toBe('track_locked');
  });
  it('ids are a pure function of the logged seed (replayable)', () => {
    const { doc, assetId } = withAsset();
    const ops = [{ op: 'add_clip', args: { assetId, start: f(0) } }, { op: 'add_text', args: { text: 'שלום עולם', start: f(0), duration: f(60) } }];
    const a = applyTransaction(doc, ops, { idSeed: 'same', actor: 'x' });
    const b = applyTransaction(doc, ops, { idSeed: 'same', actor: 'y' });
    expect(a.doc).toEqual(b.doc);
  });
  it('op descriptions export JSON Schema and hide internal ops', () => {
    const d = describeOps();
    expect(d.find((o) => o.name === 'import_asset')).toBeUndefined();
    const split = d.find((o) => o.name === 'split_clip')!;
    expect((split.argsSchema as any).properties.at.properties.value.type).toBe('string');
  });
});

describe('operation sequences (property)', () => {
  const opArb = (clipIds: string[], assetId: string) => {
    const clip = clipIds.length ? fc.constantFrom(...clipIds) : fc.constant('clp_none');
    const fr = fc.integer({ min: 0, max: 200 }).map(f);
    return fc.oneof(
      fc.record({ assetId: fc.constant(assetId), start: fr, sourceIn: fc.integer({ min: 0, max: 119 }).map(f), duration: fc.integer({ min: 1, max: 120 }).map(f) }).map((args) => ({ op: 'add_clip', args })),
      fc.record({ text: fc.constantFrom('שלום', 'Hello עולם 123', 'בְּרֵאשִׁית'), start: fr, duration: fc.integer({ min: 1, max: 90 }).map(f) }).map((args) => ({ op: 'add_text', args })),
      fc.record({ clipId: clip, start: fr }).map((args) => ({ op: 'move_clip', args })),
      fc.record({ clipId: clip, edge: fc.constantFrom('start', 'end'), to: fr }).map((args) => ({ op: 'trim_clip', args })),
      fc.record({ clipId: clip, at: fr }).map((args) => ({ op: 'split_clip', args })),
      fc.record({ clipId: clip }).map((args) => ({ op: 'delete_clip', args })),
    );
  };
  it('every accepted transaction yields a valid document; every rejection is a typed OpError that changes nothing', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(1000), { minLength: 5, maxLength: 40 }), fc.integer(), (picks, seed) => {
        let { doc, assetId } = withAsset();
        let accepted = 0;
        picks.forEach((_, i) => {
          const ids = Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips.map((c) => c.id)));
          const [call] = fc.sample(opArb(ids, assetId), { numRuns: 1, seed: seed + i });
          const before = JSON.stringify(doc);
          try {
            const r = applyTransaction(doc, [call as OpCall], { idSeed: `p${i}_`, actor: 'prop' });
            if (validateProject(r.doc).length || !ProjectSchema.safeParse(r.doc).success) throw new Error('invalid accepted doc');
            if (JSON.stringify(doc) !== before) throw new Error('input mutated');
            doc = r.doc;
            accepted++;
          } catch (e) {
            if (!(e instanceof OpError)) throw e;
            if (JSON.stringify(doc) !== before) throw new Error('rejected op mutated state');
          }
        });
        return accepted >= 0;
      }),
      { numRuns: 150 },
    );
  });
});
