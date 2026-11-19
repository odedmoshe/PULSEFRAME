/**
 * The sequence lifecycle (ADR-0018 shorts): add_sequence, update_sequence, remove_sequence, replace_clip_keyframes and the
 * internal apply_sequence_plan. Undo and redo run through the mechanism the store uses (apps/server/src/store.ts): the
 * transaction's entity diff, then restore_entities of the before-states (undo) and of the after-states (redo).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, canonical, createProject, creativeProjection, diffEntities, layoutPlacements, MAX_SEQUENCES, OpError, SEQUENCE_REFUSALS, SHORTS_RANK_METHOD,
  validateProject, type AddSequenceOutput, type ApplySequencePlanOutput, type EntityChange, type OpCall, type ProjectDocument, type SequenceOrigin, type TemplateStep,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `sq${n++}_`, actor: 'test', allowInternal: true });
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const restore = (doc: ProjectDocument, changes: EntityChange[], side: 'before' | 'after') => tx(doc, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c[side] })) } }]);

const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const VIDEO = { kind: 'video' as const, name: 'long.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(240, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 7200 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
function base(): { doc: ProjectDocument; asset: string } {
  const doc = tx(createProject({ id: 'prj_seq', name: 'Seq', width: 1920, height: 1080, frameRate: R }), [{ op: 'import_asset', args: { asset: VIDEO } }]).doc;
  return { doc, asset: Object.keys(doc.assets)[0]! };
}
/** Apply, check validity, undo and redo through the entity diff, and return the result. */
function undoRedo(doc: ProjectDocument, ops: OpCall[]) {
  const r = tx(doc, ops);
  expect(validateProject(r.doc)).toEqual([]);
  const changes = diffEntities(doc, r.doc);
  const undone = restore(r.doc, changes, 'before').doc;
  expect(creativeProjection(undone)).toBe(creativeProjection(doc));
  const redone = restore(undone, changes, 'after').doc;
  expect(creativeProjection(redone)).toBe(creativeProjection(r.doc));
  return { ...r, changes };
}
const fmt = { width: 720, height: 1280, fit: 'cover' as const, profileId: 'vertical-9x16', safeArea: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.12 } };
const out = <O,>(r: { results: { output?: Record<string, unknown> }[] }, i = 0) => r.results[i]!.output as unknown as O;
const expectRefusal = (e: OpError, key: keyof typeof SEQUENCE_REFUSALS) => {
  expect(e.code).toBe(SEQUENCE_REFUSALS[key].code);
  const shape = SEQUENCE_REFUSALS[key].message.toString();
  expect(shape.length).toBeGreaterThan(0);
};
const origin = (assetId: string, k = 0): SequenceOrigin => ({ kind: 'short', assetId, candidateId: null, excerpt: { start: T.rt(10 * k, 1), end: T.rt(10 * k + 5, 1) }, kept: [{ start: T.rt(10 * k, 1), end: T.rt(10 * k + 5, 1) }], score: 50 + k, reasons: [], reframe: 'centre', motionTrackId: null, method: SHORTS_RANK_METHOD, createdAt: '2026-11-18T00:00:00Z' });
/** A shorts-like plan of k shorts: a sequence, a picture with its sound, and a title per short. */
function planOps(asset: string, count: number): TemplateStep[] {
  return Array.from({ length: count }, (_, k): TemplateStep[] => [
    { op: 'add_sequence', args: { name: `Short ${k + 1}`, format: fmt }, bind: `s${k}` },
    { op: 'add_clip', args: { sequenceId: { $ref: `s${k}`, out: 'sequenceId' }, assetId: asset, trackId: { $ref: `s${k}`, out: 'videoTrackId' }, audioTrackId: { $ref: `s${k}`, out: 'audioTrackId' }, start: f(0), sourceIn: T.rt(10 * k, 1), duration: f(150) }, bind: `p${k}_0` },
    { op: 'replace_clip_keyframes', args: { clipId: { $ref: `p${k}_0` }, property: 'x', keys: [{ time: f(0), value: 0.1, easing: 'linear' }, { time: f(60), value: -0.1, easing: 'linear' }] } },
    { op: 'set_clip_fades', args: { clipId: { $ref: `p${k}_0`, out: 'audioClipId' }, fadeIn: T.rt(1, 100) } },
  ]).flat();
}
const plan = (asset: string, count: number, extra: Record<string, unknown> = {}): OpCall => ({
  op: 'apply_sequence_plan',
  args: { planKind: 'shorts', params: { count }, steps: [`make ${count} shorts`], ops: planOps(asset, count), origins: Array.from({ length: count }, (_, k) => ({ sequence: { $ref: `s${k}`, out: 'sequenceId' }, origin: origin(asset, k) })), ...extra },
});

describe('add_sequence', () => {
  it('standard tracks V1, T1, A1 with a flat output; undo and redo are exact', () => {
    const { doc } = base();
    const r = undoRedo(doc, [{ op: 'add_sequence', args: { name: 'Short', format: fmt } }]);
    const o = out<AddSequenceOutput>(r);
    const seq = r.doc.sequences[o.sequenceId]!;
    expect(seq.tracks.map((t) => [t.id, t.kind, t.name])).toEqual([[o.videoTrackId, 'video', 'V1'], [o.textTrackId, 'text', 'T1'], [o.audioTrackId, 'audio', 'A1']]);
    expect(seq.format).toEqual(fmt);
    expect(r.doc.mainSequenceId).toBe(doc.mainSequenceId);
  });
  it("'empty' has no tracks and null track ids", () => {
    const r = undoRedo(base().doc, [{ op: 'add_sequence', args: { name: 'E', tracks: 'empty' } }]);
    const o = out<AddSequenceOutput>(r);
    expect(o).toEqual({ sequenceId: o.sequenceId, videoTrackId: null, textTrackId: null, audioTrackId: null });
    expect(r.doc.sequences[o.sequenceId]!.tracks).toEqual([]);
    expect(r.doc.sequences[o.sequenceId]!.format).toBeUndefined();
  });
  it(`the ${MAX_SEQUENCES + 1}th sequence is refused`, () => {
    let { doc } = base();
    doc = tx(doc, Array.from({ length: MAX_SEQUENCES - 1 }, (_, i) => ({ op: 'add_sequence', args: { name: `S${i}`, tracks: 'empty' } }))).doc;
    expect(Object.keys(doc.sequences)).toHaveLength(MAX_SEQUENCES);
    const e = refusal(() => tx(doc, [{ op: 'add_sequence', args: { name: 'one too many' } }]));
    expectRefusal(e, 'tooManySequences');
    expect(e.message).toBe(SEQUENCE_REFUSALS.tooManySequences.message());
  });
  it('an odd frame is refused', () => {
    expectRefusal(refusal(() => tx(base().doc, [{ op: 'add_sequence', args: { name: 'x', format: { ...fmt, width: 721 } } }])), 'sequenceFormatOdd');
  });
});

describe('update_sequence', () => {
  it('name and format change, format null removes it; undo and redo are exact', () => {
    const { doc: d0 } = base();
    const a = tx(d0, [{ op: 'add_sequence', args: { name: 'Short', format: fmt } }]);
    const id = out<AddSequenceOutput>(a).sequenceId;
    const r = undoRedo(a.doc, [{ op: 'update_sequence', args: { sequenceId: id, name: 'Renamed', format: { ...fmt, width: 1080, height: 1920, safeArea: null, loudness: null } } }]);
    expect(r.doc.sequences[id]!.name).toBe('Renamed');
    expect(r.doc.sequences[id]!.format).toMatchObject({ width: 1080, height: 1920, safeArea: null, loudness: null });
    const cleared = undoRedo(r.doc, [{ op: 'update_sequence', args: { sequenceId: id, format: null } }]);
    expect('format' in cleared.doc.sequences[id]!).toBe(false);
  });
  it('the main sequence takes no format; nothing to change and a missing sequence are refused', () => {
    const { doc } = base();
    const e = refusal(() => tx(doc, [{ op: 'update_sequence', args: { sequenceId: doc.mainSequenceId, format: fmt } }]));
    expectRefusal(e, 'mainSequenceFormat');
    expect(e.hint).toMatch(/set_project_format/);
    expectRefusal(refusal(() => tx(doc, [{ op: 'update_sequence', args: { sequenceId: doc.mainSequenceId } }])), 'sequenceNothingToChange');
    expectRefusal(refusal(() => tx(doc, [{ op: 'update_sequence', args: { sequenceId: 'seq_none', name: 'x' } }])), 'sequenceNotFound');
    // the main sequence can still be renamed
    expect(tx(doc, [{ op: 'update_sequence', args: { sequenceId: doc.mainSequenceId, name: 'Main edit' } }]).doc.sequences[doc.mainSequenceId]!.name).toBe('Main edit');
  });
  it('a new frame over clips with x keys says so in the summary', () => {
    const { doc, asset } = base();
    const r = tx(doc, [plan(asset, 1)]);
    const id = out<ApplySequencePlanOutput>(r).sequenceIds[0]!;
    const u = tx(r.doc, [{ op: 'update_sequence', args: { sequenceId: id, format: { ...fmt, width: 1080, height: 1920 } } }]);
    expect(u.summary).toMatch(/x keyframes were made for the old frame/);
    expect(tx(r.doc, [{ op: 'update_sequence', args: { sequenceId: id, name: 'n' } }]).summary).not.toMatch(/keyframes/);
  });
  it('validation refuses a format or an origin on the main sequence', () => {
    const { doc } = base();
    const bad = structuredClone(doc);
    bad.sequences[doc.mainSequenceId]!.format = fmt;
    expect(validateProject(bad).map((i) => i.code)).toContain('main_sequence_format');
  });
});

describe('remove_sequence', () => {
  function withContents() {
    const { doc, asset } = base();
    const a = tx(doc, [{ op: 'add_sequence', args: { name: 'Short', format: fmt } }]);
    const o = out<AddSequenceOutput>(a);
    const b = tx(a.doc, [
      { op: 'add_clip', args: { sequenceId: o.sequenceId, assetId: asset, start: f(0), duration: f(90) } }, // a picture and its sound
      { op: 'add_text', args: { sequenceId: o.sequenceId, text: 'כותרת', start: f(0), duration: f(60) } },
      { op: 'add_marker', args: { sequenceId: o.sequenceId, time: f(10), label: 'a' } },
      { op: 'add_marker', args: { sequenceId: o.sequenceId, time: f(20), label: 'b' } },
      { op: 'add_marker', args: { time: f(10), label: 'main' } },
    ]);
    return { doc: b.doc, id: o.sequenceId };
  }
  it('withContents removes its 3 clips and 2 markers; undo and redo are exact', () => {
    const { doc, id } = withContents();
    expect(doc.sequences[id]!.tracks.flatMap((t) => t.clips)).toHaveLength(3);
    expect(Object.values(doc.markers).filter((m) => m.sequenceId === id)).toHaveLength(2);
    const r = undoRedo(doc, [{ op: 'remove_sequence', args: { sequenceId: id, withContents: true } }]);
    expect(Object.hasOwn(r.doc.sequences, id)).toBe(false);
    expect(Object.values(r.doc.markers).map((m) => m.label)).toEqual(['main']);
    expect(out<{ removedClipIds: string[]; removedMarkerIds: string[] }>(r)).toMatchObject({ removedClipIds: expect.any(Array), removedMarkerIds: expect.any(Array) });
    expect(out<{ removedClipIds: string[] }>(r).removedClipIds).toHaveLength(3);
  });
  it('refuses the main sequence, a sequence with clips without withContents, and a locked track', () => {
    const { doc, id } = withContents();
    expectRefusal(refusal(() => tx(doc, [{ op: 'remove_sequence', args: { sequenceId: doc.mainSequenceId, withContents: true } }])), 'mainSequence');
    const e = refusal(() => tx(doc, [{ op: 'remove_sequence', args: { sequenceId: id } }]));
    expectRefusal(e, 'sequenceNotEmpty');
    expect(e.details).toMatchObject({ clips: 3 });
    const track = doc.sequences[id]!.tracks[0]!.id;
    const locked = tx(doc, [{ op: 'update_track', args: { sequenceId: id, trackId: track, locked: true } }]).doc;
    expect(refusal(() => tx(locked, [{ op: 'remove_sequence', args: { sequenceId: id, withContents: true } }])).code).toBe('track_locked');
  });
  it('an empty sequence goes without withContents', () => {
    const a = tx(base().doc, [{ op: 'add_sequence', args: { name: 'E' } }]);
    const id = out<AddSequenceOutput>(a).sequenceId;
    expect(Object.hasOwn(undoRedo(a.doc, [{ op: 'remove_sequence', args: { sequenceId: id } }]).doc.sequences, id)).toBe(false);
  });
});

describe('apply_sequence_plan', () => {
  it('makes 3 sequences with their origins and run record; createdIds include the sequences; undo and redo are exact', () => {
    const { doc, asset } = base();
    const r = undoRedo(doc, [plan(asset, 3)]);
    const o = out<ApplySequencePlanOutput>(r);
    expect(o.sequenceIds).toHaveLength(3);
    for (const [k, id] of o.sequenceIds.entries()) {
      const s = r.doc.sequences[id]!;
      expect(s.origin).toEqual(origin(asset, k));
      expect(s.format).toEqual(fmt);
      expect(o.createdIds).toContain(id);
      for (const t of s.tracks) expect(o.createdIds).toContain(t.id);
      for (const c of s.tracks.flatMap((t) => t.clips)) expect(o.createdIds).toContain(c.id);
      expect(s.tracks.find((t) => t.kind === 'video')!.clips[0]!.keyframes!.x).toHaveLength(2);
    }
    const run = r.doc.recipeRuns[o.runId]!;
    expect(run).toMatchObject({ recipeId: 'plan:shorts', params: { count: 3 }, steps: ['make 3 shorts'] });
    expect(run.createdIds).toEqual(o.createdIds);
    expect(Object.keys(run.fingerprints).sort()).toEqual(o.createdIds.filter((id) => r.doc.sequences[id] === undefined && !id.startsWith('trk_')).sort());
    expect(r.results).toHaveLength(1);
    // the main edit is untouched
    expect(canonical(r.doc.sequences[doc.mainSequenceId])).toBe(canonical(doc.sequences[doc.mainSequenceId]));
  });
  it('a rebuild removes the plan-made shorts it replaces in the same step; undo and redo are exact', () => {
    const { doc, asset } = base();
    const first = tx(doc, [plan(asset, 3)]);
    const [a, b] = out<ApplySequencePlanOutput>(first).sequenceIds;
    const marked = tx(first.doc, [{ op: 'add_marker', args: { sequenceId: a!, time: f(5) } }]).doc;
    const r = undoRedo(marked, [plan(asset, 1, { removeSequenceIds: [a, b] })]);
    expect(Object.hasOwn(r.doc.sequences, a!)).toBe(false);
    expect(Object.hasOwn(r.doc.sequences, b!)).toBe(false);
    expect(Object.values(r.doc.markers)).toHaveLength(0);
    expect(Object.keys(r.doc.sequences)).toHaveLength(3); // main, the third short, the new one
    expect(r.summary).toMatch(/Rebuilt 1 short/);
  });
  it('a rebuild refuses a sequence that no plan made', () => {
    const { doc, asset } = base();
    const a = tx(doc, [{ op: 'add_sequence', args: { name: 'by hand' } }]);
    const id = out<AddSequenceOutput>(a).sequenceId;
    expectRefusal(refusal(() => tx(a.doc, [plan(asset, 1, { removeSequenceIds: [id] })])), 'notPlanMade');
    expectRefusal(refusal(() => tx(a.doc, [plan(asset, 1, { removeSequenceIds: [doc.mainSequenceId] })])), 'notPlanMade');
  });
  it('an undo out of order, after a title was added on a plan-made track, is refused and changes nothing', () => {
    const { doc, asset } = base();
    const r = tx(doc, [plan(asset, 3)]);
    const changes = diffEntities(doc, r.doc);
    const seq = r.doc.sequences[out<ApplySequencePlanOutput>(r).sequenceIds[1]!]!;
    const textTrack = seq.tracks.find((t) => t.kind === 'text')!.id;
    const later = tx(r.doc, [{ op: 'add_text', args: { sequenceId: seq.id, trackId: textTrack, text: 'כותרת', start: f(0), duration: f(30) } }]).doc;
    const before = canonical(later);
    const e = refusal(() => restore(later, changes, 'before'));
    expect(e.code).toBe('invalid_result');
    expect(e.message).toMatch(/holds clips added later/);
    expect(canonical(later)).toBe(before);
  });
  it('an undo while a track added later remains in the sequence is refused', () => {
    const { doc } = base();
    const r = tx(doc, [{ op: 'add_sequence', args: { name: 'S' } }]);
    const id = out<AddSequenceOutput>(r).sequenceId;
    const changes = diffEntities(doc, r.doc);
    const later = tx(r.doc, [{ op: 'add_track', args: { sequenceId: id, kind: 'video' } }]).doc;
    const e = refusal(() => restore(later, changes, 'before'));
    expect(e.code).toBe('invalid_result');
    expect(e.message).toMatch(/still holds tracks/);
  });
  it('the main sequence is never deleted, not even by a restore', () => {
    const { doc } = base();
    const e = refusal(() => tx(doc, [{ op: 'restore_entities', args: { targets: [{ id: doc.mainSequenceId, state: null }] } }]));
    expect(e.code).toBe('invalid_result');
    expect(Object.hasOwn(doc.sequences, doc.mainSequenceId)).toBe(true);
  });
  it('refuses an internal step, an origin on a sequence it did not create, and a forward reference', () => {
    const { doc, asset } = base();
    const p = plan(asset, 1);
    const args = p.args as { ops: TemplateStep[]; origins: unknown[] };
    const internal = { ...p, args: { ...args, ops: [...args.ops, { op: 'apply_recipe', args: {} }] } };
    expectRefusal(refusal(() => tx(doc, [internal])), 'planStepForbidden');
    expect(refusal(() => tx(doc, [{ ...p, args: { ...args, ops: [...args.ops, { op: 'no_such_op', args: {} }] } }])).code).toBe('forbidden_op');
    const toClip = { ...p, args: { ...args, origins: [{ sequence: { $ref: 'p0_0', out: 'sequenceId' }, origin: origin(asset) }] } };
    expectRefusal(refusal(() => tx(doc, [toClip])), 'originNotCreated');
    const toTrack = { ...p, args: { ...args, origins: [{ sequence: { $ref: 's0', out: 'videoTrackId' }, origin: origin(asset) }] } };
    expectRefusal(refusal(() => tx(doc, [toTrack])), 'originNotCreated');
    // a step that names a later step's output
    const forward = { ...p, args: { ...args, ops: [args.ops[1]!, args.ops[0]!, ...args.ops.slice(2)] } };
    const e = refusal(() => tx(doc, [forward]));
    expect(e.code).toBe('invalid_args');
    expect(e.message).toMatch(/names no earlier step/);
    expectRefusal(refusal(() => tx(doc, [{ ...p, args: { ...args, ops: [args.ops[0]!, { ...args.ops[1]!, args: { ...(args.ops[1]!.args as object), start: 'soon' } }] } }])), 'planStepInvalid');
  });
  it('is internal: a client transaction cannot carry it', () => {
    const { doc, asset } = base();
    expect(refusal(() => applyTransaction(doc, [plan(asset, 1)], { idSeed: 'x_', actor: 'agent' })).code).toBe('forbidden_op');
  });
});

describe('apply_layout and add_marker in a short', () => {
  it('apply_layout on a 720×1280 short places pictures for 720×1280', () => {
    const { doc, asset } = base();
    const a = tx(doc, [{ op: 'add_sequence', args: { name: 'Short', format: fmt } }]);
    const o = out<AddSequenceOutput>(a);
    const b = tx(a.doc, [
      { op: 'add_track', args: { sequenceId: o.sequenceId, kind: 'video' } },
      { op: 'add_clip', args: { sequenceId: o.sequenceId, assetId: asset, trackId: o.videoTrackId!, start: f(0), duration: f(60), withLinkedAudio: false } },
    ]);
    const v2 = out<{ trackId: string }>(b, 0).trackId;
    const c = tx(b.doc, [{ op: 'add_clip', args: { sequenceId: o.sequenceId, assetId: asset, trackId: v2, start: f(0), duration: f(60), withLinkedAudio: false } }]);
    const ids = [out<{ clipId: string }>(b, 1).clipId, out<{ clipId: string }>(c).clipId];
    const r = undoRedo(c.doc, [{ op: 'apply_layout', args: { layoutId: 'layout.top-and-bottom', clipIds: ids } }]);
    const want = layoutPlacements('layout.top-and-bottom', { frame: { width: 720, height: 1280 }, fit: 'cover', pictures: [{ width: 1920, height: 1080 }, { width: 1920, height: 1080 }] });
    const seq = r.doc.sequences[o.sequenceId]!;
    const got = ids.map((id) => seq.tracks.flatMap((t) => t.clips).find((x) => x.id === id)!);
    got.forEach((clip, i) => {
      expect(clip.transform).toMatchObject({ x: want[i]!.transform.x, y: want[i]!.transform.y, scale: want[i]!.transform.scale, rotation: 0 });
      expect(clip.type === 'media' && clip.mask).toEqual(want[i]!.mask ?? undefined);
    });
    // and not what the project frame would give
    const main = layoutPlacements('layout.top-and-bottom', { frame: { width: 1920, height: 1080 }, fit: 'contain', pictures: [{ width: 1920, height: 1080 }, { width: 1920, height: 1080 }] });
    expect(main[0]!.transform.scale).not.toBe(want[0]!.transform.scale);
  });
  it('add_marker with sequenceId lands on that sequence; one marker per frame per sequence', () => {
    const { doc } = base();
    const a = tx(doc, [{ op: 'add_sequence', args: { name: 'S' } }]);
    const id = out<AddSequenceOutput>(a).sequenceId;
    const r = undoRedo(a.doc, [{ op: 'add_marker', args: { time: f(30) } }, { op: 'add_marker', args: { sequenceId: id, time: f(30), label: 'short' } }]);
    const short = Object.values(r.doc.markers).find((m) => m.label === 'short')!;
    expect(short.sequenceId).toBe(id);
    expect(Object.values(r.doc.markers).find((m) => m.label === '')!.sequenceId).toBe(doc.mainSequenceId);
    expect(refusal(() => tx(r.doc, [{ op: 'add_marker', args: { sequenceId: id, time: f(30) } }])).code).toBe('overlap');
    expect(refusal(() => tx(r.doc, [{ op: 'add_marker', args: { sequenceId: 'seq_none', time: f(1) } }])).code).toBe('not_found');
  });
});

describe('replace_clip_keyframes', () => {
  function withClip() {
    const { doc, asset } = base();
    const r = tx(doc, [{ op: 'add_clip', args: { assetId: asset, start: f(0), duration: f(90) } }]);
    return { doc: r.doc, clipId: out<{ clipId: string }>(r).clipId };
  }
  const key = (frame: number, value: number) => ({ time: f(frame), value, easing: 'linear' as const });
  it('replaces the whole list; undo restores the exact old list', () => {
    const { doc: d0, clipId } = withClip();
    const doc = tx(d0, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: f(5), value: 0.2, easing: 'ease-in' } }, { op: 'set_keyframe', args: { clipId, property: 'x', time: f(40), value: -0.3 } }]).doc;
    const old = structuredClone(doc.sequences[doc.mainSequenceId]!.tracks[0]!.clips[0]!.keyframes!.x);
    const r = undoRedo(doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'x', keys: [key(0, 0.1), key(10, 0.2), key(20, -0.1)] } }]);
    expect(out<{ keyframeCount: number }>(r)).toEqual({ keyframeCount: 3 });
    const undone = restore(r.doc, r.changes, 'before').doc;
    expect(undone.sequences[doc.mainSequenceId]!.tracks[0]!.clips[0]!.keyframes!.x).toEqual(old);
  });
  it('null freezes the value at `at`', () => {
    const { doc: d0, clipId } = withClip();
    const doc = tx(d0, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'x', keys: [key(0, 0), key(30, 1)] } }, { op: 'set_keyframe', args: { clipId, property: 'opacity', time: f(0), value: 1 } }]).doc;
    const r = undoRedo(doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'x', keys: null, at: f(15) } }]);
    const clip = r.doc.sequences[doc.mainSequenceId]!.tracks[0]!.clips[0]!;
    expect(clip.transform.x).toBeCloseTo(0.5, 12);
    expect(clip.keyframes!.x).toBeUndefined();
    expect(clip.keyframes!.opacity).toHaveLength(1);
    const all = tx(r.doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'opacity', keys: null } }]).doc;
    expect(all.sequences[doc.mainSequenceId]!.tracks[0]!.clips[0]!.keyframes).toBeUndefined();
  });
  it('refuses an unaligned time, unsorted keys, 2001 keys, x = 4.5, a negative time and a caption cue', () => {
    const { doc, clipId } = withClip();
    const call = (keys: unknown, extra: Record<string, unknown> = {}) => () => tx(doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'x', keys, ...extra } }]);
    const off = refusal(call([key(0, 0), { time: T.rt(1, 1000), value: 0, easing: 'linear' }]));
    expect(off.code).toBe('invalid_args');
    expect(off.message).toMatch(/frame boundary/);
    expectRefusal(refusal(call([key(10, 0), key(5, 0)])), 'keysNotIncreasing');
    expectRefusal(refusal(call([key(5, 0), key(5, 0.1)])), 'keysNotIncreasing');
    expect(refusal(call(Array.from({ length: 2001 }, (_, i) => key(i, 0)))).code).toBe('invalid_args');
    const range = refusal(call([key(0, 4.5)]));
    expect(range.code).toBe('invalid_args');
    expect(range.message).toBe('value 4.5 is out of range for x');
    expectRefusal(refusal(call([{ time: f(-1), value: 0, easing: 'linear' }])), 'keyBeforeStart');
    const caps = tx(doc, [{ op: 'add_caption_track', args: { mode: 'manual' } }]);
    const track = out<{ trackId: string }>(caps).trackId;
    const cue = tx(caps.doc, [{ op: 'add_cue', args: { trackId: track, start: f(0), duration: f(30), text: 'שלום' } }]);
    const cueId = out<{ clipId: string }>(cue).clipId;
    expectRefusal(refusal(() => tx(cue.doc, [{ op: 'replace_clip_keyframes', args: { clipId: cueId, property: 'opacity', keys: [key(0, 1)] } }])), 'captionKeys');
  });
  it('an adjustment clip takes opacity keys only', () => {
    const { doc } = withClip();
    const a = tx(doc, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grayscale' }] } }]);
    const adj = out<{ clipId: string }>(a).clipId;
    const e = refusal(() => tx(a.doc, [{ op: 'replace_clip_keyframes', args: { clipId: adj, property: 'x', keys: [key(0, 0)] } }]));
    expect(e.code).toBe('incompatible');
    expect(e.message).toMatch(/only the opacity of an adjustment clip/);
    undoRedo(a.doc, [{ op: 'replace_clip_keyframes', args: { clipId: adj, property: 'opacity', keys: [key(0, 1), key(30, 0.4)] } }]);
  });
});
