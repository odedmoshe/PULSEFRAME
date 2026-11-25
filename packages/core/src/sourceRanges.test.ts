/**
 * Marked source ranges «פנינים» (wave 7 pearls track), builder A: the three operations (every refusal provoked in contract order,
 * exact undo, the stored JSON after add-then-undo), the cascades of remove_asset and remove_person, usage by rule C6 on hand-computed
 * clips (forward, reversed, 2×, ramped, freeze, a 29.97 file in a 30 fps project, a sound clip, a time-preserving and an untimed
 * copy), screen time, search, outward placement, the film window and the validation. The per-frame scan over random documents is
 * sourceRanges.property.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, assetUsage, createProject, creativeProjection, diffEntities, filmWindowOfRange, MAX_SOURCE_RANGES, migrateProject, OpError, placeRangeArgs, rangeListOrder, rangeUsage, restoreEntities,
  screenTime, searchRanges, SOURCE_RANGE_ISSUE, SOURCE_RANGE_REFUSALS, SOURCE_RANGE_SUMMARIES, USAGE_LIMITS, validateProject, validateSourceRanges,
  type MediaClip, type OpCall, type ProjectDocument, type SourceRange, type SourceRangeRefusalKey,
} from './index.ts';

const R = { num: 30, den: 1 };
const NTSC = { num: 30000, den: 1001 };
const f = (n: number) => T.frameTime(n, R);
const hash = (c: string) => `sha256:${c.repeat(64).slice(0, 64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const derivedProv = (src: string, extra: Record<string, unknown> = {}) => ({
  origin: 'derived' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test',
  derived: { jobId: 'job_fixture', capabilityId: 'comfy.video.enhance', capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'video', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, logicDigest: hash('a'), ...extra },
});
const VIDEO = { kind: 'video' as const, name: 'hanukkah.mp4', contentHash: hash('1'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: f(300), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov, capture: { at: '2025-12-20T18:00:00', utcOffsetMinutes: null, source: 'container' as const } };
const NTSC_VIDEO = { ...VIDEO, name: 'ntsc.mp4', contentHash: hash('2'), duration: T.frameTime(300, NTSC), video: { ...VIDEO.video, frameRate: NTSC, frameCount: 300 }, capture: { at: '2024-01-01', utcOffsetMinutes: null, source: 'container' as const } };
const TONE = { kind: 'audio' as const, name: 'tone.wav', contentHash: hash('3'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov };
const STILL = { kind: 'image' as const, name: 'still.png', contentHash: hash('4'), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };
const LUT = { kind: 'lut' as const, name: 'warm.cube', contentHash: hash('5'), byteSize: 1, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, provenance: prov };

let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], o: { internal?: boolean; actor?: string } = {}) => applyTransaction(doc, ops, { idSeed: `sr${n++}_`, actor: o.actor ?? 'user:local', allowInternal: o.internal ?? false });
const refusal = (fn: () => unknown): { code: string; message: string } | 'accepted' => { try { fn(); } catch (e) { if (e instanceof OpError) return { code: e.code, message: e.message }; throw e; } return 'accepted'; };
const expectRefusal = (fn: () => unknown, key: SourceRangeRefusalKey, ...values: string[]) => {
  const r = SOURCE_RANGE_REFUSALS[key] as { code: string; message: (...a: string[]) => string };
  expect(refusal(fn)).toEqual({ code: r.code, message: r.message(...values) });
};
const undo = (before: ProjectDocument, after: ProjectDocument) => {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return back;
};
function setup() {
  let r = tx(createProject({ id: 'prj_sr', name: 'SR' }), [VIDEO, NTSC_VIDEO, TONE, STILL, LUT].map((asset) => ({ op: 'import_asset', args: { asset } })), { internal: true });
  const [vid, ntsc, tone, still, lut] = r.results.map((x) => x.output!.assetId as string) as [string, string, string, string, string];
  r = tx(r.doc, [{ op: 'add_person', args: { name: 'אלף' } }, { op: 'add_person', args: { name: 'בית' } }, { op: 'add_person', args: { name: 'Gimel' } }]);
  const [alef, bet, gimel] = r.results.map((x) => x.output!.personId as string) as [string, string, string];
  return { doc: r.doc, vid, ntsc, tone, still, lut, alef, bet, gimel };
}
const add = (doc: ProjectDocument, args: Record<string, unknown>, actor?: string) => { const r = tx(doc, [{ op: 'add_source_range', args }], { actor }); return { doc: r.doc, id: r.results[0]!.output!.rangeId as string, summary: r.summary }; };

describe('add_source_range', () => {
  it('refuses in the order of SOURCE_RANGE_REFUSALS, each provoked for real', () => {
    const s = setup();
    const a = (args: Record<string, unknown>) => () => tx(s.doc, [{ op: 'add_source_range', args }]);
    const span = { start: f(30), end: f(75) };
    expectRefusal(a({ assetId: 'ast_none', start: f(1), label: 'a\nb' }), 'assetNotFound', 'ast_none');
    expectRefusal(a({ assetId: 'constructor' }), 'assetNotFound', 'constructor');
    expectRefusal(a({ assetId: s.lut, start: f(1) }), 'rangeNoTime');
    expectRefusal(a({ assetId: s.vid, start: f(1), label: 'a\nb' }), 'rangeHalfSpan');
    expectRefusal(a({ assetId: s.still, ...span, label: 'a\nb' }), 'rangeStillSpan');
    expectRefusal(a({ assetId: s.vid, kind: 'presence', ...span, people: [s.alef] }), 'rangeWholeAndSpan');
    expectRefusal(a({ assetId: s.vid, start: f(30), end: f(301), label: 'a\nb' }), 'rangeBounds', '10');
    expectRefusal(a({ assetId: s.vid, start: f(30), end: f(30) }), 'rangeBounds', '10');
    expectRefusal(a({ assetId: s.vid, start: T.rt(-1, 30), end: f(3) }), 'rangeBounds', '10');
    expectRefusal(a({ assetId: s.ntsc, start: f(30), end: f(400) }), 'rangeBounds', '10.01');
    expectRefusal(a({ assetId: s.vid, ...span, label: 'a\rb', people: ['per_none'] }), 'rangeLabelLine');
    expectRefusal(a({ assetId: s.vid, kind: 'presence', people: [] }), 'presenceNeedsPeople');
    expectRefusal(a({ assetId: s.vid, kind: 'presence' }), 'presenceNeedsPeople');
    expectRefusal(a({ assetId: s.vid, kind: 'presence', label: 'x', people: [s.alef] }), 'presenceNeedsPeople');
    expectRefusal(a({ assetId: s.vid, ...span, people: [s.alef, 'constructor'] }), 'rangePersonNotFound', 'constructor');
    const one = add(s.doc, { assetId: s.vid, ...span, label: 'סופגנייה' });
    expectRefusal(() => tx(one.doc, [{ op: 'add_source_range', args: { assetId: s.vid, start: T.rt(1, 1), end: T.rt(5, 2) } }]), 'rangeDuplicate');
    // the same stretch as a presence-free pearl of another kind is not a duplicate; a whole file next to a stretch is not either
    expect(refusal(() => tx(one.doc, [{ op: 'add_source_range', args: { assetId: s.vid } }]))).toBe('accepted');
    const full = structuredClone(one.doc);
    for (let i = 0; i < MAX_SOURCE_RANGES; i++) (full.sourceRanges ??= {})[`rng_f${i}`] = { id: `rng_f${i}`, assetId: s.vid, kind: 'pearl', span: { start: f(i % 299), end: f((i % 299) + 1 + Math.floor(i / 299)) }, label: '', createdBy: 't' };
    expectRefusal(() => tx(full, [{ op: 'add_source_range', args: { assetId: s.tone, start: T.rt(1, 1), end: T.rt(2, 1) } }]), 'tooManyRanges');
  });
  it('stores the range exactly as given, people sorted and unique, the creator from the commit; the summary names the file only', () => {
    const s = setup();
    const word = { start: T.rt(1037, 1000), end: T.rt(2519, 1000) };
    const r = add(s.doc, { assetId: s.vid, ...word, label: 'סופגנייה של דינוזאורים', people: [s.gimel, s.alef, s.gimel] }, 'agent:helper');
    const range = r.doc.sourceRanges![r.id]!;
    expect(range).toEqual({ id: r.id, assetId: s.vid, kind: 'pearl', span: word, label: 'סופגנייה של דינוזאורים', people: [s.alef, s.gimel].sort(), createdBy: 'agent:helper' });
    expect(r.id.startsWith('rng_')).toBe(true);
    expect(r.summary).toBe(SOURCE_RANGE_SUMMARIES.pearl('hanukkah.mp4'));
    expect(r.summary).not.toContain('סופגנייה');
    const p = add(s.doc, { assetId: s.vid, kind: 'presence', people: [s.bet] });
    expect(p.summary).toBe(SOURCE_RANGE_SUMMARIES.presence('hanukkah.mp4'));
    expect(p.doc.sourceRanges![p.id]).toEqual({ id: p.id, assetId: s.vid, kind: 'presence', span: null, label: '', people: [s.bet], createdBy: 'user:local' });
    const still = add(s.doc, { assetId: s.still, label: 'ים' });
    expect(still.doc.sourceRanges![still.id]!.span).toBeNull();
    const noPeople = add(s.doc, { assetId: s.tone, people: [] });
    expect(Object.hasOwn(noPeople.doc.sourceRanges![noPeople.id]!, 'people')).toBe(false);
    for (const d of [r.doc, p.doc, still.doc, noPeople.doc]) expect(validateProject(d)).toEqual([]);
  });
  it('add then undo gives the stored JSON back, also for a document imported with sourceRanges: {}', () => {
    const s = setup();
    for (const start of [s.doc, migrateProject({ ...structuredClone(s.doc), sourceRanges: {} })]) {
      const json = JSON.stringify(start);
      const r = add(start, { assetId: s.vid, start: f(30), end: f(75), label: 'x' });
      expect(JSON.stringify(undo(start, r.doc))).toBe(json);
      const two = add(r.doc, { assetId: s.vid, kind: 'presence', people: [s.alef] });
      expect(JSON.stringify(undo(r.doc, two.doc))).toBe(JSON.stringify(r.doc));
    }
  });
});

describe('update_source_range and remove_source_range', () => {
  it('update refuses in contract order', () => {
    const s = setup();
    const a = add(s.doc, { assetId: s.vid, start: f(30), end: f(75), label: 'א' });
    const b = add(a.doc, { assetId: s.vid, start: f(90), end: f(120) });
    const p = add(b.doc, { assetId: s.vid, kind: 'presence', people: [s.alef] });
    const st = add(p.doc, { assetId: s.still });
    const doc = st.doc;
    const u = (args: Record<string, unknown>) => () => tx(doc, [{ op: 'update_source_range', args }]);
    expectRefusal(u({ rangeId: 'rng_none' }), 'rangeNotFound', 'rng_none');
    expectRefusal(u({ rangeId: 'constructor', label: 'x' }), 'rangeNotFound', 'constructor');
    expectRefusal(u({ rangeId: a.id }), 'rangeNothingToChange');
    expectRefusal(u({ rangeId: a.id, whole: true, start: f(1) }), 'rangeWholeAndSpan');
    expectRefusal(u({ rangeId: a.id, end: f(1), label: 'a\nb' }), 'rangeHalfSpan');
    expectRefusal(u({ rangeId: st.id, start: f(0), end: f(1) }), 'rangeStillSpan');
    expectRefusal(u({ rangeId: p.id, start: f(0), end: f(1) }), 'rangeWholeAndSpan');
    expectRefusal(u({ rangeId: a.id, start: f(10), end: f(5), label: 'a\nb' }), 'rangeBounds', '10');
    expectRefusal(u({ rangeId: a.id, label: 'a\nb', people: ['per_none'] }), 'rangeLabelLine');
    expectRefusal(u({ rangeId: p.id, people: [] }), 'presenceNeedsPeople');
    expectRefusal(u({ rangeId: p.id, label: 'x' }), 'presenceNeedsPeople');
    expectRefusal(u({ rangeId: a.id, people: ['per_none'] }), 'rangePersonNotFound', 'per_none');
    expectRefusal(u({ rangeId: a.id, start: f(90), end: f(120) }), 'rangeDuplicate');
    expectRefusal(u({ rangeId: a.id, start: f(30), end: f(75), label: 'א' }), 'rangeUnchanged');
    expectRefusal(u({ rangeId: st.id, whole: true }), 'rangeUnchanged');
    expectRefusal(u({ rangeId: a.id, people: [] }), 'rangeUnchanged');
  });
  it('update changes span, name and people exactly and undoes exactly; [] clears the people key', () => {
    const s = setup();
    const a = add(s.doc, { assetId: s.vid, start: f(30), end: f(75), label: 'א', people: [s.alef] });
    let r = tx(a.doc, [{ op: 'update_source_range', args: { rangeId: a.id, whole: true, label: 'ב', people: [s.bet, s.alef] } }]);
    expect(r.doc.sourceRanges![a.id]).toMatchObject({ span: null, label: 'ב', people: [s.alef, s.bet].sort() });
    expect(r.summary).toBe(SOURCE_RANGE_SUMMARIES.changed('hanukkah.mp4'));
    expect(JSON.stringify(undo(a.doc, r.doc))).toBe(JSON.stringify(a.doc));
    r = tx(r.doc, [{ op: 'update_source_range', args: { rangeId: a.id, people: [] } }]);
    expect(Object.hasOwn(r.doc.sourceRanges![a.id]!, 'people')).toBe(false);
    expect(validateProject(r.doc)).toEqual([]);
  });
  it('remove deletes the range and the emptied map; undo brings both back', () => {
    const s = setup();
    const a = add(s.doc, { assetId: s.vid, start: f(30), end: f(75) });
    expectRefusal(() => tx(a.doc, [{ op: 'remove_source_range', args: { rangeId: 'rng_x' } }]), 'rangeNotFound', 'rng_x');
    const r = tx(a.doc, [{ op: 'remove_source_range', args: { rangeId: a.id } }]);
    expect(Object.hasOwn(r.doc, 'sourceRanges')).toBe(false);
    expect(r.summary).toBe(SOURCE_RANGE_SUMMARIES.removed('hanukkah.mp4'));
    expect(JSON.stringify(undo(a.doc, r.doc))).toBe(JSON.stringify(a.doc));
  });
});

describe('cascades (P14)', () => {
  it('remove_asset takes the file\'s ranges (tagged ones too); one undo returns them exactly', () => {
    const s = setup();
    let d = add(s.doc, { assetId: s.tone, start: T.rt(1, 1), end: T.rt(2, 1), label: 'צחוק' }).doc;
    d = add(d, { assetId: s.tone, kind: 'presence', people: [s.alef] }).doc;
    const keep = add(d, { assetId: s.vid, start: f(1), end: f(2) });
    d = keep.doc;
    const r = tx(d, [{ op: 'remove_asset', args: { assetId: s.tone } }]);
    expect(Object.keys(r.doc.sourceRanges!)).toEqual([keep.id]);
    expect(r.summary).not.toContain('צחוק');
    expect(validateProject(r.doc)).toEqual([]);
    expect(creativeProjection(undo(d, r.doc))).toBe(creativeProjection(d));
    // the last ranges going with their file take the map with them
    const only = add(s.doc, { assetId: s.tone, start: T.rt(1, 1), end: T.rt(2, 1) }).doc;
    const r2 = tx(only, [{ op: 'remove_asset', args: { assetId: s.tone } }]);
    expect(Object.hasOwn(r2.doc, 'sourceRanges')).toBe(false);
    expect(creativeProjection(undo(only, r2.doc))).toBe(creativeProjection(only));
  });
  it('the owner\'s remove_person untags, removes a presence tag left with nobody, says the count, and undo returns it all', () => {
    const s = setup();
    const a = add(s.doc, { assetId: s.vid, start: f(1), end: f(2), people: [s.alef, s.bet] });
    const b = add(a.doc, { assetId: s.vid, start: f(3), end: f(4), people: [s.alef] });
    const c = add(b.doc, { assetId: s.vid, kind: 'presence', people: [s.alef] });
    const e = add(c.doc, { assetId: s.ntsc, kind: 'presence', people: [s.bet] });
    const d = e.doc;
    const r = tx(d, [{ op: 'remove_person', args: { personId: s.alef } }]);
    expect(r.summary).toBe('Removed "אלף" from the people of the project' + SOURCE_RANGE_SUMMARIES.untagged(3));
    expect(r.doc.sourceRanges![a.id]!.people).toEqual([s.bet]);
    expect(Object.hasOwn(r.doc.sourceRanges![b.id]!, 'people')).toBe(false);
    expect(Object.hasOwn(r.doc.sourceRanges!, c.id)).toBe(false);
    expect(r.doc.sourceRanges![e.id]!.people).toEqual([s.bet]);
    expect(validateProject(r.doc)).toEqual([]);
    expect(creativeProjection(undo(d, r.doc))).toBe(creativeProjection(d));
    // a person on no range: the summary is unchanged
    expect(tx(d, [{ op: 'remove_person', args: { personId: s.gimel } }]).summary).toBe('Removed "Gimel" from the people of the project');
  });
});

// ---------- usage ----------
interface ClipSpec { assetId: string; start: number; frames: number; sourceIn: T.RationalTime; reverse?: boolean; freeze?: boolean; speed?: { num: number; den: number }; speedEnd?: { num: number; den: number }; id?: string }
let clipN = 0;
const clip = (c: ClipSpec): MediaClip => ({
  id: c.id ?? `clp_u${clipN++}`, type: 'media', assetId: c.assetId, start: f(c.start), duration: f(c.frames), sourceIn: c.sourceIn, gain: 1, linkGroupId: null, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  ...(c.reverse ? { reverse: true } : {}), ...(c.freeze ? { freeze: true } : {}), ...(c.speed ? { speed: c.speed } : {}), ...(c.speedEnd ? { speedEnd: c.speedEnd } : {}),
} as MediaClip);
/** A document whose main sequence holds the given clips: video clips on V1 (or V2 hidden), sound clips on A1. */
function withClips(doc: ProjectDocument, video: MediaClip[], audio: MediaClip[] = [], hidden: MediaClip[] = []): ProjectDocument {
  const d = structuredClone(doc);
  const seq = d.sequences[d.mainSequenceId]!;
  seq.tracks = seq.tracks.filter((t) => t.kind !== 'video' && t.kind !== 'audio');
  seq.tracks.unshift({ id: 'trk_v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, clips: video }, { id: 'trk_v2', kind: 'video', name: 'V2', locked: false, muted: false, hidden: true, clips: hidden });
  seq.tracks.push({ id: 'trk_a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, clips: audio });
  return d;
}
const withRange = (doc: ProjectDocument, r: Partial<SourceRange> & { id: string; assetId: string }): ProjectDocument => {
  const d = structuredClone(doc);
  (d.sourceRanges ??= {})[r.id] = { kind: 'pearl', span: null, label: '', createdBy: 't', ...r };
  return d;
};
const usesOf = (doc: ProjectDocument, id: string) => rangeUsage(doc).ranges[id]!.uses.map((u) => [u.clipId, u.medium, u.fromFrame, u.toFrame]);

describe('rangeUsage (C6, hand-computed)', () => {
  const s = setup();
  const pearl = { start: f(30), end: f(75) }; // barcodes 30..74
  it('forward, reversed, 2×, freeze and a clip that does not reach the pearl', () => {
    const doc = withRange(withClips(s.doc, [
      clip({ id: 'clp_fwd', assetId: s.vid, start: 0, frames: 100, sourceIn: f(0) }), // frame i shows i → [30, 75)
      clip({ id: 'clp_rev', assetId: s.vid, start: 100, frames: 100, sourceIn: f(0), reverse: true }), // frame 100+i shows 99−i → i ∈ (24, 69] → [125, 170)
      clip({ id: 'clp_2x', assetId: s.vid, start: 200, frames: 60, sourceIn: f(0), speed: { num: 2, den: 1 } }), // shows 2i → i ∈ [15, 37] → [215, 238)
      clip({ id: 'clp_frz', assetId: s.vid, start: 260, frames: 10, sourceIn: f(40), freeze: true }), // one picture, 40, all ten frames
      clip({ id: 'clp_frz_out', assetId: s.vid, start: 270, frames: 10, sourceIn: f(80), freeze: true }),
      clip({ id: 'clp_late', assetId: s.vid, start: 280, frames: 20, sourceIn: f(200) }),
    ]), { id: 'rng_p', assetId: s.vid, span: pearl });
    expect(usesOf(doc, 'rng_p')).toEqual([['clp_fwd', 'picture', 30, 75], ['clp_rev', 'picture', 125, 170], ['clp_2x', 'picture', 215, 238], ['clp_frz', 'picture', 260, 270]]);
    const u = rangeUsage(doc).ranges.rng_p!;
    expect(u.uses.find((x) => x.clipId === 'clp_frz')!.source).toEqual({ start: f(40), end: f(41) });
    expect(u.usedSource).toEqual([pearl]);
    expect(rangeUsage(doc).limits).toEqual(USAGE_LIMITS);
    expect(rangeUsage(doc)).toBe(rangeUsage(doc)); // memo per document
  });
  it('a span off frame edges counts the source frames it touches (a word edge)', () => {
    // [1.01 s, 1.5 s): kLo = floor(30.3) = 30, kHi = first k with k/30 ≥ 1.5 = 45
    const doc = withRange(withClips(s.doc, [clip({ assetId: s.vid, start: 0, frames: 100, sourceIn: f(0), id: 'clp_w' })]), { id: 'rng_w', assetId: s.vid, span: { start: T.rt(101, 100), end: T.rt(3, 2) } });
    expect(usesOf(doc, 'rng_w')).toEqual([['clp_w', 'picture', 30, 45]]);
    expect(rangeUsage(doc).ranges.rng_w!.uses[0]!.source).toEqual({ start: T.rt(101, 100), end: T.rt(3, 2) });
    // a span inside one source frame still covers that frame
    const tiny = withRange(withClips(s.doc, [clip({ assetId: s.vid, start: 0, frames: 100, sourceIn: f(0), id: 'clp_t' })]), { id: 'rng_t', assetId: s.vid, span: { start: T.rt(1001, 1000), end: T.rt(1002, 1000) } });
    expect(usesOf(tiny, 'rng_t')).toEqual([['clp_t', 'picture', 30, 31]]);
  });
  it('a span marked on 30 fps frames over the 29.97 file, in a 30 fps project', () => {
    // [1 s, 2.5 s) on 30000/1001: kLo = floor(30·0.999) = 29, kHi = ceil(75·0.999) = 75 (74.925…); the clip shows floor(i·1001/1000)
    const doc = withRange(withClips(s.doc, [clip({ assetId: s.ntsc, start: 0, frames: 120, sourceIn: T.ZERO, id: 'clp_n' })]), { id: 'rng_n', assetId: s.ntsc, span: { start: f(30), end: f(75) } });
    const want: number[] = [];
    for (let i = 0; i < 120; i++) { const k = Math.floor((i * 30000) / 30 / 1001 + 1e-12); if (k >= 29 && k < 75) want.push(i); }
    const [[, , from, to]] = usesOf(doc, 'rng_n') as [[string, string, number, number]];
    expect([from, to]).toEqual([want[0], want[want.length - 1]! + 1]);
  });
  it('a ramped clip counts the frames whose source frame is in the span', () => {
    const c = clip({ assetId: s.vid, start: 0, frames: 120, sourceIn: f(0), speed: { num: 1, den: 2 }, speedEnd: { num: 2, den: 1 }, id: 'clp_r' });
    const doc = withRange(withClips(s.doc, [c]), { id: 'rng_r', assetId: s.vid, span: pearl });
    const [[, , from, to]] = usesOf(doc, 'rng_r') as [[string, string, number, number]];
    expect(from).toBeGreaterThan(30); // slower at the start: the pearl arrives later than on a forward clip
    expect(to - from).toBeLessThan(90);
    expect(to - from).toBeGreaterThan(22);
  });
  it('a sound clip counts by the instant rule; a hidden track is listed as hidden', () => {
    const doc = withRange(withClips(s.doc, [], [clip({ assetId: s.tone, start: 0, frames: 300, sourceIn: T.ZERO, id: 'clp_s' })], [clip({ assetId: s.vid, start: 0, frames: 100, sourceIn: f(0), id: 'clp_h' })]), { id: 'rng_s', assetId: s.tone, span: { start: T.rt(101, 100), end: T.rt(3, 2) } });
    expect(usesOf(doc, 'rng_s')).toEqual([['clp_s', 'sound', 31, 45]]); // instants i/30 in [1.01, 1.5)
    const hid = withRange(doc, { id: 'rng_h', assetId: s.vid, span: pearl });
    expect(rangeUsage(hid).ranges.rng_h!.uses.map((u) => [u.clipId, u.hidden, u.fromFrame, u.toFrame])).toEqual([['clp_h', true, 30, 75]]);
  });
  it('a still or a whole range counts every frame; an unused range is listed in list order', () => {
    let doc = withClips(s.doc, [clip({ assetId: s.still, start: 0, frames: 50, sourceIn: T.ZERO, id: 'clp_st' }), clip({ assetId: s.vid, start: 50, frames: 20, sourceIn: f(250), id: 'clp_end' })]);
    doc = withRange(doc, { id: 'rng_st', assetId: s.still });
    doc = withRange(doc, { id: 'rng_whole', assetId: s.vid });
    doc = withRange(doc, { id: 'rng_un2', assetId: s.ntsc, span: pearl });
    doc = withRange(doc, { id: 'rng_un1', assetId: s.vid, span: pearl });
    expect(usesOf(doc, 'rng_st')).toEqual([['clp_st', 'picture', 0, 50]]);
    expect(usesOf(doc, 'rng_whole')).toEqual([['clp_end', 'picture', 50, 70]]);
    // list order: capture wall (2024 file first), asset id, span start, id; undated files last
    expect(rangeUsage(doc).unused).toEqual(['rng_un2', 'rng_un1']);
    expect(rangeListOrder(doc)).toEqual(['rng_un2', 'rng_whole', 'rng_un1', 'rng_st']);
    expect(assetUsage(doc, s.vid)).toEqual([{ start: f(250), end: f(270) }]);
  });
  it('a time-preserving copy counts at its offset; an untimed copy does not count and is named (P8 numbers)', () => {
    let r = tx(s.doc, [
      { op: 'import_asset', args: { asset: { ...VIDEO, name: 'copy.mp4', contentHash: hash('6'), duration: f(200), video: { ...VIDEO.video, frameCount: 200 }, provenance: derivedProv(s.vid, { sourceRangeStart: T.rt(1, 1) }) } } },
      { op: 'import_asset', args: { asset: { ...VIDEO, name: 'reversed.mp4', contentHash: hash('7'), provenance: derivedProv(s.vid) } } },
    ], { internal: true });
    const [copy, rev] = r.results.map((x) => x.output!.assetId as string) as [string, string];
    // pearl [1, 2.5) on the original = [0, 1.5) on the copy (its time zero is the original's 1 s): copy frames 0..44
    let doc = withClips(r.doc, [clip({ assetId: copy, start: 0, frames: 100, sourceIn: f(0), id: 'clp_c' }), clip({ assetId: rev, start: 100, frames: 100, sourceIn: f(0), id: 'clp_rv' })]);
    doc = withRange(doc, { id: 'rng_o', assetId: s.vid, span: pearl });
    // and a pearl marked on the copy counts on the original's clips: copy [0.5, 1) = original [1.5, 2)
    doc = withRange(doc, { id: 'rng_c', assetId: copy, span: { start: f(15), end: f(30) } });
    doc = { ...doc, sequences: { ...doc.sequences } };
    doc.sequences[doc.mainSequenceId]!.tracks[0]!.clips.push(clip({ assetId: s.vid, start: 200, frames: 100, sourceIn: f(0), id: 'clp_orig' }));
    const u = rangeUsage(doc);
    expect(u.ranges.rng_o!.uses.map((x) => [x.clipId, x.fromFrame, x.toFrame])).toEqual([['clp_c', 0, 45], ['clp_orig', 230, 275]]);
    expect(u.ranges.rng_o!.untimedCopies).toEqual([rev]);
    expect(u.ranges.rng_o!.uses[0]!.source).toEqual(pearl); // in the original's own time
    expect(u.ranges.rng_c!.uses.map((x) => [x.clipId, x.fromFrame, x.toFrame])).toEqual([['clp_c', 15, 30], ['clp_orig', 245, 260]]);
    expect(u.ranges.rng_c!.usedSource).toEqual([{ start: f(15), end: f(30) }]);
  });
});

describe('screenTime', () => {
  it('counts tagged picture uses on visible tracks of one sequence, unions overlaps, orders people without localeCompare', () => {
    const s = setup();
    let r = tx(s.doc, [{ op: 'add_person', args: { name: 'gimel2' } }, { op: 'add_person', args: { name: 'aleph' } }]);
    const [, aleph] = r.results.map((x) => x.output!.personId as string) as [string, string];
    let doc = withClips(r.doc, [clip({ assetId: s.vid, start: 0, frames: 100, sourceIn: f(0), id: 'clp_a' }), clip({ assetId: s.ntsc, start: 100, frames: 50, sourceIn: T.ZERO, id: 'clp_b' }), clip({ assetId: s.still, start: 150, frames: 30, sourceIn: T.ZERO, id: 'clp_u' })],
      [clip({ assetId: s.tone, start: 0, frames: 200, sourceIn: T.ZERO, id: 'clp_tone' })], [clip({ assetId: s.ntsc, start: 0, frames: 60, sourceIn: T.ZERO, id: 'clp_hid' })]);
    // a second visible layer over clp_a: [40, 80) of the ntsc file
    doc.sequences[doc.mainSequenceId]!.tracks.splice(1, 0, { id: 'trk_v3', kind: 'video', name: 'V3', locked: false, muted: false, hidden: false, clips: [clip({ assetId: s.ntsc, start: 40, frames: 40, sourceIn: T.ZERO, id: 'clp_over' })] });
    doc = withRange(doc, { id: 'rng_1', assetId: s.vid, span: { start: f(30), end: f(75) }, people: [s.alef] }); // frames [30, 75)
    doc = withRange(doc, { id: 'rng_2', assetId: s.ntsc, kind: 'presence', people: [s.alef, s.bet] }); // clp_b [100,150), clp_over [40,80); clp_hid hidden
    doc = withRange(doc, { id: 'rng_3', assetId: s.tone, span: { start: T.rt(1, 1), end: T.rt(2, 1) }, people: [s.gimel] }); // sound only: no screen time
    const st = screenTime(doc);
    expect(st.sequenceId).toBe(doc.mainSequenceId);
    expect(st.pictureFrames).toBe(180);
    const row = (id: string) => st.people.find((p) => p.personId === id)!;
    expect(row(s.alef)).toEqual({ personId: s.alef, frames: 45 + 50 + 40 - 35, clips: ['clp_a', 'clp_b', 'clp_over'].sort() }); // [30,80) ∪ [100,150)
    expect(row(s.bet)).toEqual({ personId: s.bet, frames: 90, clips: ['clp_b', 'clp_over'].sort() });
    expect(row(s.gimel).frames).toBe(0);
    expect(st.untaggedFrames).toBe(180 - 100);
    // names compared by personNameKey with <, then id: "aleph" < "gimel" < "gimel2" < Hebrew
    expect(st.people.map((p) => p.personId)).toEqual([aleph, s.gimel, r.results[0]!.output!.personId as string, s.alef, s.bet]);
  });
  it('sourceRanges.ts uses no localeCompare and no Intl', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'sourceRanges.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/localeCompare|Intl\.|new Date|Date\.now/);
  });
});

describe('searchRanges, placeRangeArgs, filmWindowOfRange', () => {
  const s = setup();
  let doc = withClips(s.doc, [clip({ assetId: s.vid, start: 0, frames: 60, sourceIn: f(0) })]);
  doc = withRange(doc, { id: 'rng_a', assetId: s.vid, span: { start: f(30), end: f(75) }, label: 'הסוּפְגָּנִייה, של דינוזאורים!', people: [s.alef] });
  doc = withRange(doc, { id: 'rng_b', assetId: s.vid, span: { start: f(200), end: f(210) }, label: 'Noa laughs' });
  doc = withRange(doc, { id: 'rng_c', assetId: s.tone, kind: 'presence', people: [s.gimel] });
  it('matches bare-word tokens of the label and the tagged names, in list order, with filters', () => {
    expect(searchRanges(doc, 'סופגניה')).toEqual([]); // a different spelling is a different word
    expect(searchRanges(doc, 'סופגנייה')).toEqual(['rng_a']); // niqqud, punctuation and a prefix ignored
    expect(searchRanges(doc, 'דינוזאורים סופגנייה')).toEqual(['rng_a']);
    expect(searchRanges(doc, 'noa LAUGH')).toEqual(['rng_b']);
    expect(searchRanges(doc, 'אלף')).toEqual(['rng_a']);
    expect(searchRanges(doc, 'gimel')).toEqual(['rng_c']);
    expect(searchRanges(doc, '')).toEqual(['rng_a', 'rng_b', 'rng_c']);
    expect(searchRanges(doc, '', { kind: 'presence' })).toEqual(['rng_c']);
    expect(searchRanges(doc, '', { unused: true })).toEqual(['rng_b', 'rng_c']);
    expect(searchRanges(doc, '', { unused: false })).toEqual(['rng_a']);
    expect(searchRanges(doc, '', { personId: s.alef })).toEqual(['rng_a']);
    expect(searchRanges(doc, '', { assetId: s.tone })).toEqual(['rng_c']);
  });
  it('places a range snapped outward to project frames and clamped to the file; a whole file by id only', () => {
    const word = withRange(doc, { id: 'rng_w', assetId: s.vid, span: { start: T.rt(1037, 1000), end: T.rt(2519, 1000) } });
    expect(placeRangeArgs(word, word.sourceRanges!.rng_w!, R)).toEqual({ assetId: s.vid, sourceIn: f(31), duration: f(45) }); // [31/30, 76/30) holds [1.037, 2.519)
    expect(placeRangeArgs(doc, doc.sourceRanges!.rng_a!, R)).toEqual({ assetId: s.vid, sourceIn: f(30), duration: f(45) });
    expect(placeRangeArgs(doc, doc.sourceRanges!.rng_c!, R)).toEqual({ assetId: s.tone });
    const atEnd = withRange(doc, { id: 'rng_e', assetId: s.ntsc, span: { start: f(290), end: T.frameTime(300, NTSC) } });
    const p = placeRangeArgs(atEnd, atEnd.sourceRanges!.rng_e!, R) as { sourceIn: T.RationalTime; duration: T.RationalTime };
    expect(p.sourceIn).toEqual(f(290));
    expect(T.lte(T.add(p.sourceIn, p.duration), T.frameTime(300, NTSC))).toBe(true);
    expect(T.isFrameAligned(p.duration, R)).toBe(true);
    // the arguments are accepted by add_clip as they are
    expect(refusal(() => tx(word, [{ op: 'add_clip', args: { ...placeRangeArgs(word, word.sourceRanges!.rng_w!, R), start: f(0), trackId: 'trk_v1' } }]))).not.toBe('accepted'); // V1 is occupied at 0
    expect(refusal(() => tx(word, [{ op: 'add_clip', args: { ...placeRangeArgs(word, word.sourceRanges!.rng_w!, R), start: f(600) } }]))).toBe('accepted');
  });
  it('the film window is in the file\'s own frames; null for a still, a sound file and a whole range', () => {
    const asset = (id: string) => doc.assets[id]!;
    expect(filmWindowOfRange(asset(s.vid), doc.sourceRanges!.rng_a!)).toEqual({ fromFrame: 30, toFrame: 75 });
    expect(filmWindowOfRange(asset(s.ntsc), { ...doc.sourceRanges!.rng_a!, assetId: s.ntsc })).toEqual({ fromFrame: 29, toFrame: 75 });
    expect(filmWindowOfRange(asset(s.vid), { ...doc.sourceRanges!.rng_a!, span: { start: T.rt(101, 100), end: T.rt(1002, 1000) } })).toEqual({ fromFrame: 30, toFrame: 31 });
    expect(filmWindowOfRange(asset(s.tone), { ...doc.sourceRanges!.rng_a!, assetId: s.tone })).toBeNull();
    expect(filmWindowOfRange(asset(s.still), { ...doc.sourceRanges!.rng_a!, span: null })).toBeNull();
    expect(filmWindowOfRange(asset(s.vid), { ...doc.sourceRanges!.rng_a!, span: null })).toBeNull();
  });
});

describe('validateSourceRanges', () => {
  it('names each broken rule with code source_range', () => {
    const s = setup();
    const bad = (r: Partial<SourceRange>) => validateSourceRanges(withRange(s.doc, { id: 'rng_x', assetId: s.vid, ...r })).map((i) => i.message);
    expect(validateSourceRanges(s.doc)).toEqual([]);
    expect(bad({})).toEqual([]);
    expect(bad({ assetId: 'ast_gone' })).toEqual(['marked range rng_x: file ast_gone is not in the library']);
    expect(bad({ assetId: s.lut })).toEqual(['marked range rng_x: a colour table has no time to mark']);
    expect(bad({ assetId: s.still, span: { start: T.ZERO, end: f(1) } })).toContain('marked range rng_x: a photo is marked whole');
    expect(bad({ kind: 'presence', people: [s.alef], span: { start: T.ZERO, end: f(1) } })).toEqual(['marked range rng_x: a "who is in it" tag covers the whole file']);
    expect(bad({ span: { start: f(5), end: f(5) } })).toEqual(['marked range rng_x: the span is outside the file or empty']);
    expect(bad({ span: { start: f(5), end: f(301) } })).toEqual(['marked range rng_x: the span is outside the file or empty']);
    expect(bad({ kind: 'presence' })).toEqual(['marked range rng_x: a "who is in it" tag has people and no name']);
    expect(bad({ kind: 'presence', people: [s.alef], label: 'x' })).toEqual(['marked range rng_x: a "who is in it" tag has people and no name']);
    expect(bad({ people: ['constructor'] })).toEqual(['marked range rng_x: person constructor is not in this project']);
    expect(bad({ people: [s.bet, s.alef].sort().reverse() })).toEqual(['marked range rng_x: people are stored sorted and unique']);
    expect(bad({ people: [s.alef, s.alef] })).toEqual(['marked range rng_x: people are stored sorted and unique']);
    const issues = validateProject(withRange(s.doc, { id: 'rng_x', assetId: 'ast_gone' }));
    expect(issues.map((i) => i.code)).toEqual([SOURCE_RANGE_ISSUE]);
  });
});
