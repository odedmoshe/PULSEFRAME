/**
 * The craft bodies (wave 7 craft track, W1; .artifacts/wave7/craft-decisions.md §2, §4): ripple_trim (C1 order rule on the shared
 * shift with RIPPLE_TRIM_WORDS), paste_attributes (C3), replace_text (C4), typed time (C5), the Q/W target and «משך הקליפ», and
 * the find matcher with its golden (findReplace.golden.json, which the browser side of proof F8 replays too).
 * Every fixture is built here from typed values (no media). Undo is checked the way the store does it: the entity changes of the
 * step restored on the result give back the document before it (creativeProjection).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, CRAFT_REFUSALS, createProject, creativeProjection, diffEntities, durationOps, findClip, findText, getOp, matchText, OpError,
  parseTimeEntry, partnersOf, planPasteAttributes, planReplace, restoreEntities, RIPPLE_TRIM_WORDS, rippleTrimCall, rippleTrimTarget,
  type Clip, type FindQuery, type OpCall, type PasteAttributesOutput, type ProjectDocument, type ReplaceTextOutput, type RippleTrimOutput,
} from './index.ts';
import { tokenizeBar } from './commandBar/match.ts';
import { parseTime } from './commandBar/time.ts';
import { fieldMask, replaceRanges, type MatchFlags } from './findReplace.ts';
import { rippleTrimBy, trimShift } from './craftOps.ts';
import { restoreTarget, saveTarget } from './pasteAttributes.ts';
import GOLDEN from './findReplace.golden.json' with { type: 'json' };

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const fr = (t: T.RationalTime) => T.frameIndexAt(t, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `ct${seed++}_`, actor: 'test', allowInternal: true });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const VIDEO = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const MUSIC = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov };
const STILL = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'3'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 800, height: 600, codec: 'png', hasAlpha: false }, provenance: prov };

/** The step's entity changes restored on its result give back the document before it (the store's undo). */
function undoes(before: ProjectDocument, after: ProjectDocument): boolean {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return creativeProjection(back) === creativeProjection(before);
}
/** The OpError a call is refused with, and that the document did not change. */
function refused(doc: ProjectDocument, ops: OpCall[]): OpError {
  const before = JSON.stringify(doc);
  try { tx(doc, ops); } catch (e) { expect(JSON.stringify(doc)).toBe(before); if (e instanceof OpError) return e; throw e; }
  throw new Error('not refused');
}
const out = <O>(r: ReturnType<typeof tx>) => r.results[r.results.length - 1]!.output as unknown as O;
const clip = (doc: ProjectDocument, id: string) => findClip(doc, id)!.clip;
const startOf = (doc: ProjectDocument, id: string) => fr(clip(doc, id).start);
const span = (doc: ProjectDocument, id: string) => { const c = clip(doc, id); return [fr(c.start), fr(T.add(c.start, c.duration))]; };

/**
 * The film: on V1 three shots A [0,30) B [30,60) C [60,90) of one video (each with its linked sound on A1), a title [40,70) on
 * its own track, music [0,90) on A2, a marker at 70, ripple delete on. `sound: false` leaves the shots without sound.
 */
function film(o: { sound?: boolean } = {}) {
  let doc = createProject({ id: 'prj_craft', name: 'Craft', width: 640, height: 360, frameRate: R });
  doc = tx(doc, [{ op: 'import_asset', args: { asset: VIDEO } }, { op: 'import_asset', args: { asset: MUSIC } }, { op: 'import_asset', args: { asset: STILL } }]).doc;
  const [vid, mus, still] = Object.keys(doc.assets) as [string, string, string];
  const shots: { clipId: string; trackId: string; audioClipId?: string }[] = [];
  for (const [i, at] of [0, 30, 60].entries()) {
    const r = tx(doc, [{ op: 'add_clip', args: { assetId: vid, start: f(at), sourceIn: f(i * 40), duration: f(30), withLinkedAudio: o.sound !== false, ...(shots[0] ? { trackId: shots[0].trackId, ...(shots[0].audioClipId ? { audioTrackId: findClip(doc, shots[0].audioClipId)!.track.id } : {}) } : {}) } }]);
    doc = r.doc; shots.push(out(r));
  }
  let r = tx(doc, [{ op: 'add_text', args: { text: 'שלום נעה', start: f(40), duration: f(30) } }]); doc = r.doc;
  const title = out<{ clipId: string }>(r).clipId;
  r = tx(doc, [{ op: 'add_clip', args: { assetId: mus, start: f(0), duration: f(90) } }]); doc = r.doc;
  const music = out<{ clipId: string }>(r).clipId;
  r = tx(doc, [{ op: 'add_marker', args: { time: f(70), label: 'm' } }, { op: 'set_timeline_behaviour', args: { rippleDelete: true } }]); doc = r.doc;
  const [A, B, C] = shots.map((s) => s.clipId) as [string, string, string];
  const [As, Bs, Cs] = shots.map((s) => s.audioClipId ?? '') as [string, string, string];
  return { doc, vid, mus, still, A, B, C, As, Bs, Cs, title, music, v1: shots[0]!.trackId };
}
const rt = (clipId: string, edge: 'start' | 'end', to: number, extra: object = {}): OpCall => ({ op: 'ripple_trim', args: { clipId, edge, to: f(to), ...extra } });

// ---------------------------------------------------------------- ripple_trim
describe('ripple_trim', () => {
  it('rule: by = new length − old length, and the shift moves every clip at or after the edge by −by, nothing else (exact)', () => {
    expect(rippleTrimBy('end', f(0), f(30), f(20))).toEqual(f(-10));
    expect(rippleTrimBy('end', f(0), f(30), f(42))).toEqual(f(12));
    expect(rippleTrimBy('start', f(10), f(30), f(25))).toEqual(f(-15));
    // 29.97: one-frame times are exact rationals, the sum never rounds
    const ntsc = { num: 30000, den: 1001 };
    expect(rippleTrimBy('end', T.ZERO, T.frameTime(300, ntsc), T.frameTime(1, ntsc))).toEqual(T.sub(T.frameTime(1, ntsc), T.frameTime(300, ntsc)));
    const { doc, v1 } = film();
    const track = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === v1)!;
    const m = trimShift(track, f(30), f(10));
    expect([...m.values()].map((e) => fr(e.by))).toEqual([0, 10, 10]);
  });
  it('W (end edge, shorter): trim first, then later main-track clips and their sound move −k; music, title and marker stay; undo exact', () => {
    const s = film();
    const r = tx(s.doc, [rt(s.A, 'end', 20)]);
    const o = out<RippleTrimOutput>(r);
    expect(fr(o.by)).toBe(-10);
    expect(o.trimmedClipIds.sort()).toEqual([s.A, s.As].sort());
    expect(o.movedClipIds.sort()).toEqual([s.B, s.Bs, s.C, s.Cs].sort());
    expect([span(r.doc, s.A), span(r.doc, s.B), span(r.doc, s.C), span(r.doc, s.Bs)]).toEqual([[0, 20], [20, 50], [50, 80], [20, 50]]);
    expect([span(r.doc, s.title), span(r.doc, s.music)]).toEqual([[40, 70], [0, 90]]);
    expect(fr(Object.values(r.doc.markers)[0]!.time)).toBe(70);
    expect(undoes(s.doc, r.doc)).toBe(true);
  });
  it('Q (start edge): the head goes, the clip keeps its start and shows the source frame that was under the playhead; later clips move −k', () => {
    const s = film();
    const before = clip(s.doc, s.A) as Extract<Clip, { type: 'media' }>;
    const r = tx(s.doc, [rt(s.A, 'start', 12)]);
    const a = clip(r.doc, s.A) as Extract<Clip, { type: 'media' }>;
    expect(span(r.doc, s.A)).toEqual([0, 18]);
    expect(fr(a.sourceIn)).toBe(fr(before.sourceIn) + 12);
    expect(span(r.doc, s.As)).toEqual([0, 18]);
    expect([startOf(r.doc, s.B), startOf(r.doc, s.C), startOf(r.doc, s.Cs)]).toEqual([18, 48, 48]);
    expect(fr(out<RippleTrimOutput>(r).by)).toBe(-12);
    expect(startOf(r.doc, s.title)).toBe(40);
    expect(undoes(s.doc, r.doc)).toBe(true);
  });
  it('W later than the end (longer): the later clips move first, then trim_clip finds the room (trim alone would overlap)', () => {
    const s = film();
    expect(refused(s.doc, [{ op: 'trim_clip', args: { clipId: s.A, edge: 'end', to: f(40) } }]).code).toBe('overlap');
    const r = tx(s.doc, [rt(s.A, 'end', 40)]);
    expect([span(r.doc, s.A), span(r.doc, s.B), span(r.doc, s.C), span(r.doc, s.Cs)]).toEqual([[0, 40], [40, 70], [70, 100], [70, 100]]);
    expect(fr(out<RippleTrimOutput>(r).by)).toBe(10);
    expect(undoes(s.doc, r.doc)).toBe(true);
  });
  it('by = 0 and a start edge moved earlier are refused in the trim words, changing nothing', () => {
    const s = film();
    expect(refused(s.doc, [rt(s.B, 'end', 60)]).message).toBe(CRAFT_REFUSALS.rippleNoChange.message());
    expect(refused(s.doc, [rt(s.B, 'start', 30)]).message).toBe(CRAFT_REFUSALS.rippleNoChange.message());
    const e = refused(s.doc, [rt(s.B, 'start', 20)]);
    expect([e.code, e.message]).toEqual(['invalid_args', CRAFT_REFUSALS.rippleStartLonger.message()]);
    // trim_clip's own refusals pass through: an empty clip, a locked track
    expect(refused(s.doc, [rt(s.A, 'start', 30)]).code).toBe('out_of_bounds');
    const locked = tx(s.doc, [{ op: 'update_track', args: { trackId: s.v1, locked: true } }]).doc;
    expect(refused(locked, [rt(s.A, 'end', 20)]).code).toBe('track_locked');
  });
  it('a J-cut sound that would go before 0 refuses with the trim words (never Delete\'s)', () => {
    const s = film();
    const jcut = tx(s.doc, [{ op: 'move_clip', args: { clipId: s.Bs, start: f(2), includeLinked: false } }]);
    // A's sound is in the way of that move: take it out first
    const doc = tx(s.doc, [{ op: 'delete_clip', args: { clipId: s.As, includeLinked: false } }, { op: 'move_clip', args: { clipId: s.Bs, start: f(2), includeLinked: false } }]).doc;
    void jcut;
    const e = refused(doc, [rt(s.A, 'start', 10)]);
    expect([e.code, e.message, e.hint]).toEqual(['out_of_bounds', RIPPLE_TRIM_WORDS.beforeZero(s.Bs), RIPPLE_TRIM_WORDS.beforeZeroHint]);
  });
  it('a moved sound landing on one that stays refuses with the trim words', () => {
    const s = film({ sound: true });
    const aTrack = findClip(s.doc, s.Bs)!.track.id;
    // a sound of its own in A1 at [20,26) after A's sound is gone: B's sound would slide over it
    let doc = tx(s.doc, [{ op: 'delete_clip', args: { clipId: s.As, includeLinked: false } }]).doc;
    doc = tx(doc, [{ op: 'add_clip', args: { assetId: s.mus, start: f(20), duration: f(6), trackId: aTrack } }]).doc;
    const still = findClip(doc, s.Bs)!.track.clips.find((c) => fr(c.start) === 20)!.id;
    const e = refused(doc, [rt(s.A, 'end', 15)]);
    expect([e.code, e.message, e.hint]).toEqual(['overlap', RIPPLE_TRIM_WORDS.over(s.Bs, still, aTrack), RIPPLE_TRIM_WORDS.overHint]);
  });
  it('linked clips that would move by different amounts, and a partner on a locked track, refuse with the trim words', () => {
    const s = film({ sound: false });
    const doc = structuredClone(s.doc);
    for (const id of [s.A, s.C]) (clip(doc, id) as Extract<Clip, { type: 'media' }>).linkGroupId = 'lnk_x';
    const e = refused(doc, [rt(s.B, 'end', 50)]);
    expect([e.code, e.message, e.hint]).toEqual(['incompatible', RIPPLE_TRIM_WORDS.differentAmounts(s.C, s.A), RIPPLE_TRIM_WORDS.differentAmountsHint]);
    const s2 = film();
    const soundTrack = findClip(s2.doc, s2.Bs)!.track.id;
    const locked = tx(s2.doc, [{ op: 'update_track', args: { trackId: soundTrack, locked: true } }]).doc;
    const l = refused(locked, [rt(s2.A, 'end', 20, { includeLinked: false })]);
    expect([l.code, l.hint]).toEqual(['track_locked', RIPPLE_TRIM_WORDS.lockedPartnerHint]);
  });
  it('includeLinked=false: the sound of the trimmed clip keeps its length, so a later sound that would slide over it refuses', () => {
    const s = film();
    const e = refused(s.doc, [rt(s.A, 'end', 20, { includeLinked: false })]);
    expect([e.code, e.message]).toEqual(['overlap', RIPPLE_TRIM_WORDS.over(s.Bs, s.As, findClip(s.doc, s.As)!.track.id)]);
    const r = tx(s.doc, [rt(s.C, 'end', 80, { includeLinked: false })]);
    expect([span(r.doc, s.C), span(r.doc, s.Cs)]).toEqual([[60, 80], [60, 90]]);
    expect(out<RippleTrimOutput>(r)).toMatchObject({ trimmedClipIds: [s.C], movedClipIds: [] });
  });
});

// ---------------------------------------------------------------- Q / W target and «משך הקליפ»
describe('rippleTrimTarget, rippleTrimCall, durationOps', () => {
  it('the selected clip strictly around the playhead; else the main-track clip under it, only in the main sequence', () => {
    const s = film();
    const main = s.doc.mainSequenceId;
    expect(rippleTrimTarget(s.doc, { clipIds: [s.title], sequenceId: main }, 50)).toEqual({ clipId: s.title });
    expect(rippleTrimTarget(s.doc, { clipIds: [s.title], sequenceId: main }, 40)).toEqual({ clipId: s.B }); // on its edge: the fallback
    expect(rippleTrimTarget(s.doc, { clipIds: [], sequenceId: main }, 30)).toBeNull(); // between two clips: nothing to trim
    expect(rippleTrimTarget(s.doc, { clipIds: [], sequenceId: main }, 75)).toEqual({ clipId: s.C });
    expect(rippleTrimTarget(s.doc, { clipIds: [], sequenceId: 'seq_short' }, 75)).toBeNull();
    expect(rippleTrimTarget(s.doc, { clipIds: [s.A, s.B], sequenceId: main }, 45)).toEqual({ clipId: s.B });
    expect(rippleTrimCall(s.doc, s.B, 'start', 45)).toEqual({ op: 'ripple_trim', args: { clipId: s.B, edge: 'start', to: f(45) } });
  });
  it('durations: ripple_trim on the main track with ripple delete on, trim_clip elsewhere; last clip first; the row stays contiguous', () => {
    const ntsc = { num: 30000, den: 1001 };
    let doc = createProject({ id: 'prj_d', name: 'D', width: 640, height: 360, frameRate: ntsc });
    doc = tx(doc, [{ op: 'import_asset', args: { asset: STILL } }, { op: 'set_timeline_behaviour', args: { rippleDelete: true } }]).doc;
    const still = Object.keys(doc.assets)[0]!;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) { const r = tx(doc, [{ op: 'add_clip', args: { assetId: still, start: T.frameTime(i * 60, ntsc), duration: T.frameTime(60, ntsc) } }]); doc = r.doc; ids.push(out<{ clipId: string }>(r).clipId); }
    const typed = parseTimeEntry('5s', ntsc);
    expect(typed).toEqual({ ok: true, frame: 150, relative: false, rounded: true });
    const ops = durationOps(doc, [...ids].reverse(), (typed as { frame: number }).frame)!;
    expect(ops.map((o) => [o.op, (o.args as { clipId: string }).clipId])).toEqual([...ids].reverse().map((id) => ['ripple_trim', id]));
    const r = tx(doc, ops);
    const starts = ids.map((id) => T.frameIndexAt(clip(r.doc, id).start, ntsc)), lens = ids.map((id) => T.frameIndexAt(clip(r.doc, id).duration, ntsc));
    expect([starts, lens]).toEqual([[0, 150, 300, 450, 600, 750], [150, 150, 150, 150, 150, 150]]);
    expect(undoes(doc, r.doc)).toBe(true);
    // ripple delete off: trim_clip, which cannot lengthen into the next clip (its own refusal)
    const off = tx(doc, [{ op: 'set_timeline_behaviour', args: { rippleDelete: false } }]).doc;
    expect(durationOps(off, ids, 150)!.every((o) => o.op === 'trim_clip')).toBe(true);
    expect(durationOps(doc, ids, 60)).toEqual([]); // already that long
    expect(durationOps(doc, ids, 0)).toBeNull();
    expect(durationOps(doc, Array.from({ length: 201 }, (_, i) => `c${i}`), 10)).toBeNull();
  });
});

// ---------------------------------------------------------------- paste_attributes
const paste = (fromClipId: string, toClipIds: string[], groups: string[]): OpCall => ({ op: 'paste_attributes', args: { fromClipId, toClipIds, groups } });
const noIds = (fx: Clip['effects']) => (fx ?? []).map(({ id: _id, ...rest }) => rest);

describe('paste_attributes', () => {
  /** A graded source A (grade + sepia, a grain with a key and a beat modulator, multiply, a mask), targets B and C with effects of their own. */
  function graded() {
    const s = film();
    let r = tx(s.doc, [
      { op: 'add_effect', args: { clipId: s.A, type: 'color.grade', params: { exposure: 0.4 } } },
      { op: 'add_effect', args: { clipId: s.A, type: 'stylize.grain', params: {} } },
      { op: 'add_effect', args: { clipId: s.A, type: 'color.sepia', params: { amount: 0.5 } } },
      { op: 'set_clip_blend', args: { clipId: s.A, mode: 'multiply' } },
      { op: 'set_clip_mask', args: { clipId: s.A, mask: { shape: 'ellipse' } } },
      { op: 'add_effect', args: { clipId: s.B, type: 'light.vignette', params: {} } },
      { op: 'add_effect', args: { clipId: s.B, type: 'color.sepia', params: { amount: 0.2 } } },
      { op: 'add_effect', args: { clipId: s.B, type: 'stylize.grain', params: {} } },
    ]);
    const grain = clip(r.doc, s.A).effects!.find((e) => e.type === 'stylize.grain')!.id;
    r = tx(r.doc, [{ op: 'set_effect_keyframe', args: { clipId: s.A, effectId: grain, param: 'amount', time: f(0), value: 0.1 } }, { op: 'set_effect_keyframe', args: { clipId: s.A, effectId: grain, param: 'amount', time: f(29), value: 0.6 } }]);
    return { ...s, doc: r.doc };
  }
  it('colour: the target\'s colour effects replaced at the place of the first one, in source order, others untouched; twice = once', () => {
    const s = graded();
    const r = tx(s.doc, [paste(s.A, [s.B, s.C], ['colour'])]);
    const o = out<PasteAttributesOutput>(r);
    expect(o.applied).toEqual([{ clipId: s.B, group: 'colour' }, { clipId: s.C, group: 'colour' }]);
    expect(clip(r.doc, s.B).effects!.map((e) => e.type)).toEqual(['light.vignette', 'color.grade', 'color.sepia', 'stylize.grain']);
    const colours = (doc: ProjectDocument, id: string) => noIds(clip(doc, id).effects!.filter((e) => e.type.startsWith('color.')));
    expect(colours(r.doc, s.B)).toEqual(colours(s.doc, s.A));
    expect(colours(r.doc, s.C)).toEqual(colours(s.doc, s.A));
    const again = tx(r.doc, [paste(s.A, [s.B, s.C], ['colour'])]).doc;
    expect([noIds(clip(again, s.B).effects), noIds(clip(again, s.C).effects)]).toEqual([noIds(clip(r.doc, s.B).effects), noIds(clip(r.doc, s.C).effects)]);
    expect(undoes(s.doc, r.doc)).toBe(true);
  });
  it('effects: other effects with their keys, blend and mask; keys past the target\'s end are left out and counted', () => {
    const s = graded();
    const short = tx(s.doc, [{ op: 'trim_clip', args: { clipId: s.C, edge: 'end', to: f(80) } }]).doc; // C is 20 frames long
    const r = tx(short, [paste(s.A, [s.B, s.C], ['effects'])]);
    const o = out<PasteAttributesOutput>(r);
    expect(o.keysLeftOut).toBe(1); // the grain key at frame 29 does not fit the 20-frame C
    const b = clip(r.doc, s.B), a = clip(s.doc, s.A);
    expect(noIds(b.effects!.filter((e) => !e.type.startsWith('color.')))).toEqual(noIds(a.effects!.filter((e) => !e.type.startsWith('color.'))));
    expect(b.effects!.map((e) => e.type)).toEqual(['stylize.grain', 'color.sepia']); // grain at the vignette's place, the sepia stays
    expect([b.blend, (b as { mask?: unknown }).mask]).toEqual([a.blend, (a as { mask?: unknown }).mask]);
    expect(clip(r.doc, s.C).effects!.find((e) => e.type === 'stylize.grain')!.keyframes!.amount!.length).toBe(1);
  });
  it('a group the source has nothing in never clears a target (source_empty), and alone it is refused as nothing to paste', () => {
    const s = graded();
    const e = refused(s.doc, [paste(s.C, [s.B], ['colour'])]);
    expect([e.code, e.message]).toEqual(['invalid_args', CRAFT_REFUSALS.pasteNothing.message()]);
    const plan = planPasteAttributes(s.doc, { fromClipId: s.C, toClipIds: [s.B], groups: ['colour', 'effects'] });
    expect(plan.skipped.map((k) => [k.group, k.code])).toEqual([['colour', 'source_empty'], ['effects', 'source_empty']]);
    expect(plan.applied).toEqual([]);
  });
  it('transform onto a target with keys is skipped as target_animated unless animation is ticked; then the keys are replaced first', () => {
    const s = film();
    let doc = tx(s.doc, [{ op: 'set_clip_transform', args: { clipId: s.A, transform: { x: 0.2, scale: 1.5 } } }, { op: 'set_keyframe', args: { clipId: s.B, property: 'x', time: f(0), value: -0.3 } }, { op: 'set_keyframe', args: { clipId: s.B, property: 'x', time: f(20), value: 0.3 } }, { op: 'set_keyframe', args: { clipId: s.A, property: 'scale', time: f(5), value: 1.2 } }]).doc;
    const plan = planPasteAttributes(doc, { fromClipId: s.A, toClipIds: [s.B, s.C], groups: ['transform'] });
    expect(plan.skipped.map((k) => [k.clipId, k.code])).toEqual([[s.B, 'target_animated']]);
    expect(plan.applied).toEqual([{ clipId: s.C, group: 'transform' }]);
    const r = tx(doc, [paste(s.A, [s.B], ['transform', 'animation'])]);
    expect(out<PasteAttributesOutput>(r).applied).toEqual([{ clipId: s.B, group: 'animation' }, { clipId: s.B, group: 'transform' }]);
    expect(clip(r.doc, s.B).keyframes?.x).toBeUndefined(); // the source has no x keys: the target's go (the group replaces)
    expect(clip(r.doc, s.B).keyframes?.scale).toEqual(clip(doc, s.A).keyframes!.scale);
    // a source with no keys at all has nothing in the group: the target keeps its keys (source_empty never clears)
    const bare = planPasteAttributes(doc, { fromClipId: s.C, toClipIds: [s.B], groups: ['animation', 'transform'] });
    expect(bare.skipped.map((k) => [k.group, k.code])).toEqual([['animation', 'source_empty']]);
    expect(clip(r.doc, s.B).transform).toEqual(clip(doc, s.A).transform);
    doc = r.doc;
  });
  it('animation: curves copied exactly, a title\'s letter animation between titles, the commit equals the plan', () => {
    const s = film();
    const bez = { time: f(10), value: 1.2, easing: 'bezier' as const, bezier: [0.3, 0, 0.2, 1] as [number, number, number, number] };
    let doc = tx(s.doc, [
      { op: 'replace_clip_keyframes', args: { clipId: s.A, property: 'scale', keys: [{ time: f(0), value: 1, easing: 'ease-in' }, bez, { time: f(29), value: 1.4, easing: 'linear' }] } },
      { op: 'add_text', args: { text: 'second', start: f(75), duration: f(10), animation: { in: 'fade', by: 'letter', inFrames: 5 } } },
    ]).doc;
    const second = Object.values(doc.sequences[doc.mainSequenceId]!.tracks).flatMap((t) => t.clips).find((c) => c.type === 'text' && c.text === 'second')!.id;
    doc = tx(doc, [{ op: 'replace_clip_keyframes', args: { clipId: second, property: 'y', keys: [{ time: f(0), value: 0.1, easing: 'linear' }] } }]).doc;
    const args = { fromClipId: s.A, toClipIds: [s.B, s.title], groups: ['animation' as const] };
    const plan = planPasteAttributes(doc, args);
    const r = tx(doc, [paste(s.A, [s.B, s.title], ['animation'])]);
    const o = out<PasteAttributesOutput>(r);
    expect({ applied: o.applied, skipped: o.skipped, keysLeftOut: o.keysLeftOut }).toEqual({ applied: plan.applied, skipped: plan.skipped, keysLeftOut: plan.keysLeftOut });
    expect(clip(r.doc, s.B).keyframes!.scale).toEqual(clip(doc, s.A).keyframes!.scale);
    const t2 = tx(doc, [paste(second, [s.title], ['animation'])]).doc;
    expect((clip(t2, s.title) as { animation?: unknown }).animation).toEqual((clip(doc, second) as { animation?: unknown }).animation);
  });
  it('sound: gain, fades, volume keys and sound effects onto a sound clip; a title cannot take them (skipped with the op\'s code)', () => {
    const s = film();
    let doc = tx(s.doc, [
      { op: 'set_clip_gain', args: { clipId: s.music, gain: 0.5 } },
      { op: 'set_clip_fades', args: { clipId: s.music, fadeIn: f(5), fadeOut: f(10) } },
      { op: 'draw_volume', args: { clipId: s.music, from: f(0), to: f(80), keys: [{ time: f(0), value: 1 }, { time: f(80), value: 0.2 }] } },
      { op: 'apply_audio_preset', args: { clipId: s.music, presetId: 'radio' } },
    ]).doc;
    const r = tx(doc, [paste(s.music, [s.As, s.title], ['sound'])]);
    const o = out<PasteAttributesOutput>(r);
    expect(o.applied).toEqual([{ clipId: s.As, group: 'sound' }]);
    expect(o.skipped.map((k) => [k.clipId, k.code])).toEqual([[s.title, 'incompatible']]);
    expect(o.keysLeftOut).toBe(1); // the key at 80 lies past the 30-frame sound
    const a = clip(r.doc, s.As) as Extract<Clip, { type: 'media' }>, m = clip(doc, s.music) as Extract<Clip, { type: 'media' }>;
    expect([a.gain, fr(a.fadeIn!), fr(a.fadeOut!), a.volume!.length, a.audioFx!.map((x) => x.type)]).toEqual([0.5, 5, 10, 1, m.audioFx!.map((x) => x.type)]);
    doc = r.doc;
  });
  it('titleStyle onto a title (look fields the source lacks switched off); onto a picture skipped with the op\'s code', () => {
    const s = film();
    let doc = tx(s.doc, [{ op: 'add_text', args: { text: 'src', start: f(75), duration: f(10), style: { color: '#FF0000', sizeFrac: 0.1 } } }, { op: 'update_text', args: { clipId: s.title, style: { tracking: 0.2 } } }]).doc;
    const src = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'text' && c.text === 'src')!.id;
    const r = tx(doc, [paste(src, [s.title, s.A], ['titleStyle'])]);
    expect((clip(r.doc, s.title) as { style: unknown }).style).toEqual((clip(doc, src) as { style: unknown }).style);
    expect(out<PasteAttributesOutput>(r).skipped.map((k) => [k.clipId, k.code])).toEqual([[s.A, 'incompatible']]);
    doc = r.doc;
  });
  it('whole-op refusals: the source among the targets, an unknown clip; a locked target is a skipped row', () => {
    const s = graded();
    expect(refused(s.doc, [paste(s.A, [s.B, s.A], ['colour'])]).message).toBe(CRAFT_REFUSALS.pasteSourceIsTarget.message());
    expect(refused(s.doc, [paste(s.A, ['clp_none'], ['colour'])]).code).toBe('not_found');
    expect(refused(s.doc, [paste('clp_none', [s.B], ['colour'])]).code).toBe('not_found');
    const doc = tx(s.doc, [{ op: 'add_track', args: { kind: 'video' } }]).doc;
    const v2 = doc.sequences[doc.mainSequenceId]!.tracks.filter((t) => t.kind === 'video')[1]!.id;
    const withD = tx(doc, [{ op: 'add_clip', args: { assetId: s.still, start: f(0), duration: f(30), trackId: v2 } }, { op: 'update_track', args: { trackId: v2, locked: true } }]);
    const d = withD.results[0]!.output as { clipId: string };
    const r = tx(withD.doc, [paste(s.A, [s.B, d.clipId], ['colour'])]);
    expect(out<PasteAttributesOutput>(r).skipped.map((k) => [k.clipId, k.code])).toEqual([[d.clipId, 'track_locked']]);
  });
  it('a pair refused half-way is put back exactly: the target and its linked clips, nothing else', () => {
    const s = graded();
    // B already carries 14 more effects: the removal of its sepia and the first copy succeed, the second copy hits the 16 limit
    const fill = Array.from({ length: 13 }, (): OpCall => ({ op: 'add_effect', args: { clipId: s.B, type: 'stylize.grain', params: {} } }));
    const doc = tx(s.doc, fill).doc;
    expect(clip(doc, s.B).effects!.length).toBe(16);
    const r = tx(doc, [paste(s.A, [s.B, s.C], ['colour'])]);
    const o = out<PasteAttributesOutput>(r);
    expect(o.skipped.map((k) => [k.clipId, k.code])).toEqual([[s.B, 'out_of_bounds']]);
    expect(JSON.stringify(clip(r.doc, s.B))).toBe(JSON.stringify(clip(doc, s.B)));
    // saveTarget / restoreTarget: the copies of the target and its partners, put back in place
    const draft = structuredClone(doc);
    const saved = saveTarget(draft, s.B);
    expect(saved.map((x) => x.clip.id).sort()).toEqual([s.B, s.Bs].sort());
    clip(draft, s.B).effects = []; (clip(draft, s.Bs) as Extract<Clip, { type: 'media' }>).gain = 0;
    restoreTarget(saved);
    expect(creativeProjection(draft)).toBe(creativeProjection(doc));
  });
  it('confinement: every op the paste composes changes only the target and the clips linked to it (diffEntities)', () => {
    const s = graded();
    let doc = tx(s.doc, [{ op: 'apply_audio_preset', args: { clipId: s.music, presetId: 'radio' } }, { op: 'set_keyframe', args: { clipId: s.A, property: 'x', time: f(3), value: 0.1 } }]).doc;
    const fx = clip(doc, s.B).effects![0]!.id;
    const allowed = (id: string) => new Set([id, ...partnersOf(doc, clip(doc, id)).map((p) => p.clip.id)]);
    const rows: [string, OpCall][] = [
      [s.B, { op: 'remove_effect', args: { clipId: s.B, effectId: fx } }],
      [s.B, { op: 'add_effect', args: { clipId: s.B, type: 'color.sepia', params: {}, index: 0 } }],
      [s.B, { op: 'update_effect', args: { clipId: s.B, effectId: fx, enabled: false } }],
      [s.B, { op: 'replace_effect_keyframes', args: { clipId: s.B, effectId: fx, param: 'amount', keys: [{ time: f(0), value: 0.2, easing: 'linear' }] } }],
      [s.B, { op: 'set_clip_blend', args: { clipId: s.B, mode: 'screen' } }],
      [s.B, { op: 'set_clip_mask', args: { clipId: s.B, mask: { shape: 'rect' } } }],
      [s.B, { op: 'replace_clip_keyframes', args: { clipId: s.B, property: 'x', keys: [{ time: f(0), value: 0.2, easing: 'linear' }] } }],
      [s.title, { op: 'set_text_animation', args: { clipId: s.title, animation: { in: 'fade' } } }],
      [s.B, { op: 'set_clip_transform', args: { clipId: s.B, transform: { x: 0.1 } } }],
      [s.B, { op: 'set_clip_gain', args: { clipId: s.B, gain: 0.3 } }],
      [s.Bs, { op: 'set_clip_fades', args: { clipId: s.Bs, fadeIn: f(2) } }],
      [s.Bs, { op: 'draw_volume', args: { clipId: s.Bs, from: f(0), to: f(10), keys: [{ time: f(0), value: 0.5 }] } }],
      [s.Bs, { op: 'copy_audio_effects', args: { fromClipId: s.music, toClipIds: [s.Bs], replace: true } }],
      [s.B, { op: 'copy_audio_effects', args: { fromClipId: s.music, toClipIds: [s.B], replace: true } }],
      [s.music, { op: 'apply_audio_preset', args: { clipId: s.music, presetId: null, includeLinked: false } }],
      [s.title, { op: 'update_text', args: { clipId: s.title, style: { color: '#00FF00' } } }],
    ];
    for (const [target, call] of rows) {
      expect(getOp(call.op)!.internal ?? false).toBe(false);
      const changed = diffEntities(doc, tx(doc, [call]).doc).map((c) => c.id);
      const ok = allowed(target);
      expect({ op: call.op, outside: changed.filter((id) => !ok.has(id)) }).toEqual({ op: call.op, outside: [] });
    }
    // and the paste as a whole, every group onto every kind of clip
    for (const target of [s.B, s.Bs, s.title, s.music]) {
      let r;
      try { r = tx(doc, [paste(s.A, [target], ['colour', 'effects', 'transform', 'animation', 'sound', 'titleStyle'])]); } catch (e) { expect(e).toBeInstanceOf(OpError); continue; }
      const changed = diffEntities(doc, r.doc).map((c) => c.id);
      const ok = allowed(target);
      expect(changed.filter((id) => !ok.has(id))).toEqual([]);
    }
    doc = s.doc;
  });
});

// ---------------------------------------------------------------- replace_text
describe('replace_text', () => {
  /** The film plus a cue with word timing, a transcript of the video, and a reviewed translated format with its own wording. */
  function texts() {
    const s = film();
    let r = tx(s.doc, [
      { op: 'add_cue', args: { start: f(0), duration: f(30), text: 'שלום נעה' } },
      { op: 'set_transcript', args: { assetId: s.vid, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(1, 1), text: 'נעה הולכת', words: [{ start: T.rt(0, 1), duration: T.rt(1, 2), text: 'נעה' }, { start: T.rt(1, 2), duration: T.rt(1, 2), text: 'הולכת' }] }] } },
      { op: 'add_variant', args: { width: 360, height: 640, name: 'vertical' } },
    ]);
    let doc = r.doc;
    const cue = (r.results[0]!.output as { clipId: string }).clipId;
    const variantId = (r.results[2]!.output as { variantId: string }).variantId;
    const segmentId = doc.transcripts[s.vid]!.segments[0]!.id;
    r = tx(doc, [{ op: 'set_variant_override', args: { variantId, clipId: s.title, text: 'היי נעה' } }, { op: 'set_variant_phrase_text', args: { variantId, assetId: s.vid, segmentId, text: 'נעה הולכת הביתה' } }]);
    doc = structuredClone(r.doc);
    const c = clip(doc, cue) as Extract<Clip, { type: 'caption' }>;
    c.words = [{ text: 'שלום', start: f(0), duration: f(15) }, { text: 'נעה', start: f(15), duration: f(15) }];
    doc.variants[variantId]!.language = 'en';
    doc.variants[variantId]!.translation = { from: 'he', to: 'en', engine: 'test', model: 'none', createdAt: '2026-11-25T00:00:00Z', createdBy: 'test', review: 'reviewed', reviewedBy: 'owner', reviewedAt: '2026-11-25T00:00:00Z', sources: {} };
    return { ...s, doc, cue, variantId, segmentId };
  }
  const edit = (at: object, was: string, text: string) => ({ at, was, text });
  const rep = (...edits: object[]): OpCall => ({ op: 'replace_text', args: { edits } });

  it('each carrier: title, cue (same count keeps timing), phrase, a format\'s wording (review again); one op; undo exact', () => {
    const s = texts();
    const r = tx(s.doc, [rep(
      edit({ kind: 'title', clipId: s.title }, 'שלום נעה', 'שלום נועה'),
      edit({ kind: 'cue', clipId: s.cue }, 'שלום נעה', 'שלום נועה'),
      edit({ kind: 'phrase', assetId: s.vid, segmentId: s.segmentId }, 'נעה הולכת', 'נועה הולכת'),
      edit({ kind: 'override', variantId: s.variantId, clipId: s.title }, 'היי נעה', 'היי נועה'),
    )]);
    const o = out<ReplaceTextOutput>(r);
    expect(o).toEqual({ changed: 4, lostWordTiming: [], approximated: [], reviewAgain: [s.variantId] });
    expect((clip(r.doc, s.title) as { text: string }).text).toBe('שלום נועה');
    const cue = clip(r.doc, s.cue) as Extract<Clip, { type: 'caption' }>;
    expect([cue.text, cue.words!.map((w) => w.text), fr(cue.words![1]!.start)]).toEqual(['שלום נועה', ['שלום', 'נועה'], 15]);
    const seg = r.doc.transcripts[s.vid]!.segments[0]!;
    expect([seg.text, seg.original, seg.timing]).toEqual(['נועה הולכת', 'נעה הולכת', 'word']);
    expect([r.doc.variants[s.variantId]!.overrides[s.title]!.text, r.doc.variants[s.variantId]!.translation!.review]).toEqual(['היי נועה', 'needed']);
    expect(undoes(s.doc, r.doc)).toBe(true);
  });
  it('a changed word count: the cue loses its word timing and is listed; the phrase gets estimated times and is listed', () => {
    const s = texts();
    const r = tx(s.doc, [rep(edit({ kind: 'cue', clipId: s.cue }, 'שלום נעה', 'שלום לך נעה'), edit({ kind: 'phrase', assetId: s.vid, segmentId: s.segmentId }, 'נעה הולכת', 'נעה'), edit({ kind: 'variantPhrase', variantId: s.variantId, assetId: s.vid, segmentId: s.segmentId }, 'נעה הולכת הביתה', 'נועה הולכת הביתה'))]);
    expect(out<ReplaceTextOutput>(r)).toEqual({ changed: 3, lostWordTiming: [s.cue], approximated: [s.segmentId], reviewAgain: [s.variantId] });
    expect((clip(r.doc, s.cue) as Extract<Clip, { type: 'caption' }>).words).toBeUndefined();
    expect(r.doc.transcripts[s.vid]!.segments[0]!.timing).toBe('approximate');
  });
  it('refusals, each changing nothing: changed since the search, missing, empty, too long per carrier, live fields, named twice', () => {
    const s = texts();
    const t = { kind: 'title', clipId: s.title };
    expect(refused(s.doc, [rep(edit(t, 'stale', 'x'))]).message).toBe(CRAFT_REFUSALS.replaceChanged.message());
    expect(refused(s.doc, [rep(edit({ kind: 'title', clipId: 'clp_none' }, 'a', 'b'))]).message).toBe(CRAFT_REFUSALS.replaceMissing.message(`title clp_none`));
    expect(refused(s.doc, [rep(edit({ kind: 'title', clipId: s.cue }, 'a', 'b'))]).code).toBe('not_found'); // a cue is not a title
    expect(refused(s.doc, [rep(edit({ kind: 'override', variantId: s.variantId, clipId: s.A }, 'a', 'b'))]).code).toBe('not_found'); // never creates a wording
    expect(refused(s.doc, [rep(edit(t, 'שלום נעה', '   '))]).message).toBe(CRAFT_REFUSALS.replaceEmpty.message());
    expect(refused(s.doc, [rep(edit(t, 'שלום נעה', 'א'.repeat(2001)))]).message).toBe(CRAFT_REFUSALS.replaceTooLong.message(2001, 2000));
    // a phrase holds 4000
    const long = tx(s.doc, [rep(edit({ kind: 'phrase', assetId: s.vid, segmentId: s.segmentId }, 'נעה הולכת', 'א'.repeat(4000)))]);
    expect(out<ReplaceTextOutput>(long).changed).toBe(1);
    expect(refused(s.doc, [rep(edit(t, 'שלום נעה', 'a'), edit(t, 'שלום נעה', 'b'))]).message).toBe(CRAFT_REFUSALS.replaceTwice.message());
    // a title with live fields: the {…} tokens must stay as they are
    const withFields = tx(s.doc, [{ op: 'add_text', args: { text: 'נעה {date} {year}', start: f(75), duration: f(10), fields: true } }]);
    const ft = (withFields.results[0]!.output as { clipId: string }).clipId;
    expect(refused(withFields.doc, [rep(edit({ kind: 'title', clipId: ft }, 'נעה {date} {year}', 'נועה {year}'))]).message).toBe(CRAFT_REFUSALS.replaceFields.message());
    expect(out<ReplaceTextOutput>(tx(withFields.doc, [rep(edit({ kind: 'title', clipId: ft }, 'נעה {date} {year}', 'נועה {date} {year}'))])).changed).toBe(1);
  });
});

// ---------------------------------------------------------------- typed time
describe('parseTimeEntry', () => {
  const ntsc = { num: 30000, den: 1001 };
  it('the shared golden with the command bar\'s reader: every form both read gives the same frame', () => {
    const forms = ['00:00:10:00', '1:10', '0:01', '1:00:00', '3 שניות', 'שנייה וחצי', 'דקה ועשר', '10 פריימים', 'שנייה ו־12 פריימים', '2 דקות', '3 s', '90 f', 'שעה'];
    for (const rate of [R, ntsc, { num: 25, den: 1 }, { num: 24000, den: 1001 }]) for (const form of forms) {
      const bar = parseTime(tokenizeBar(form).tokens, 0, rate);
      const entry = parseTimeEntry(form, rate);
      expect({ form, rate, entry }).toEqual({ form, rate, entry: { ok: true, frame: (bar as { time: { frame: number } }).time.frame, relative: false, rounded: (bar as { time: { rounded: boolean } }).time.rounded } });
    }
  });
  it('R6: timecode, m:ss, sign, suffix, a bare number = frames', () => {
    expect(parseTimeEntry('00:00:10:00', ntsc)).toEqual({ ok: true, frame: 300, relative: false, rounded: false });
    expect(parseTimeEntry('1:10', ntsc)).toEqual({ ok: true, frame: 2098, relative: false, rounded: true });
    expect(parseTimeEntry('+12', ntsc, 100)).toEqual({ ok: true, frame: 112, relative: true, rounded: false });
    expect(parseTimeEntry('-1:00', ntsc, 2000)).toEqual({ ok: true, frame: 2000 - 1798, relative: true, rounded: true });
    expect(parseTimeEntry('−5', ntsc, 10)).toEqual({ ok: true, frame: 5, relative: true, rounded: false });
    expect(parseTimeEntry('90', ntsc)).toEqual({ ok: true, frame: 90, relative: false, rounded: false });
    expect(parseTimeEntry('90f', ntsc)).toEqual(parseTimeEntry('90 f', ntsc));
    expect(parseTimeEntry('5s', ntsc)).toEqual({ ok: true, frame: 150, relative: false, rounded: true });
    expect(parseTimeEntry(' 2min ', R)).toEqual({ ok: true, frame: 3600, relative: false, rounded: false });
  });
  it('one rounding, ties up: half a frame of seconds goes to the later frame', () => {
    expect(parseTimeEntry('0.25s', { num: 2, den: 1 })).toEqual({ ok: true, frame: 1, relative: false, rounded: true });
    expect(parseTimeEntry('0.75s', { num: 2, den: 1 })).toEqual({ ok: true, frame: 2, relative: false, rounded: true });
  });
  it('every refusal: unreadable, negative, not whole frames, too large', () => {
    for (const [text, reason] of [['abc', 'unreadable'], ['', 'unreadable'], ['++3', 'unreadable'], ['3 שניות ועוד', 'unreadable'], ['0.5f', 'not_whole_frames'], ['1.5', 'not_whole_frames'], ['חצי פריים', 'not_whole_frames'], ['25:00:00', 'too_large'], ['3000000', 'too_large']] as const)
      expect({ text, r: parseTimeEntry(text, R) }).toEqual({ text, r: { ok: false, reason } });
    expect(parseTimeEntry('-20', R, 10)).toEqual({ ok: false, reason: 'negative' });
    expect(parseTimeEntry('-1', R)).toEqual({ ok: false, reason: 'negative' });
    expect(parseTimeEntry('+1', R, 24 * 3600 * 30)).toEqual({ ok: false, reason: 'too_large' });
  });
});

// ---------------------------------------------------------------- find
const FL = (o: Partial<MatchFlags> = {}): MatchFlags => ({ wholeWord: false, ignoreMarks: true, finalsEqual: true, ignoreCase: false, ...o });
describe('matchText, findText, planReplace', () => {
  it('the golden: findReplace.golden.json (200+ cases) gives the recorded ranges', () => {
    const cases = (GOLDEN as { cases: { text: string; needle: string; flags: MatchFlags; ranges: [number, number][] }[] }).cases;
    expect(cases.length).toBeGreaterThanOrEqual(200);
    for (const c of cases) expect({ c: [c.text, c.needle, c.flags], r: matchText(c.text, c.needle, c.flags) }).toEqual({ c: [c.text, c.needle, c.flags], r: c.ranges });
  });
  it('F2 marks ignored only when asked; the range covers the marks, so a replacement leaves none behind', () => {
    expect(matchText('שָׁלוֹם', 'שלום', FL())).toEqual([[0, 7]]);
    expect(matchText('שָׁלוֹם', 'שלום', FL({ ignoreMarks: false }))).toEqual([]);
    expect(matchText('שָׁלוֹם', 'שָׁלוֹם', FL({ ignoreMarks: false }))).toEqual([[0, 7]]);
    expect(matchText('שׁ', 'שׁ', FL({ ignoreMarks: false }))).toEqual([[0, 2]]);
    expect(replaceRanges('אמר שָׁלוֹם!', matchText('אמר שָׁלוֹם!', 'שלום', FL()), 'היי').text).toBe('אמר היי!');
  });
  it('F3 finals equal only when asked; F4 whole word finds neither ילדים nor הילד; Latin case A–Z only; ״ = "', () => {
    expect([matchText('מלך', 'מלכ', FL()), matchText('מלך', 'מלכ', FL({ finalsEqual: false }))]).toEqual([[[0, 3]], []]);
    expect(matchText('ילדים הילד ילד.', 'ילד', FL({ wholeWord: true }))).toEqual([[11, 14]]);
    expect(matchText('ילדים הילד', 'ילד', FL())).toEqual([[0, 3], [7, 10]]);
    expect([matchText('Noa NOA', 'noa', FL({ ignoreCase: true })), matchText('Noa', 'noa', FL())]).toEqual([[[0, 3], [4, 7]], []]);
    expect(matchText('צה"ל', 'צה״ל', FL())).toEqual([[0, 4]]);
    expect(matchText('ג׳ורג׳ ג', 'ג', FL({ wholeWord: true }))).toEqual([[7, 8]]); // ׳ between letters is part of the word
  });
  it('direction characters are ignored in matching; isolates inside a replaced run are kept, in order, after the new text', () => {
    expect(matchText('שלום \u2067נ\u200fעה\u2069!', 'נעה', FL())).toEqual([[6, 10]]);
    const t = 'שלום א\u2067נעה\u2069';
    const r = matchText(t, 'אנעה', FL());
    expect(r).toEqual([[5, 10]]);
    expect(replaceRanges(t, r, 'X')).toEqual({ text: 'שלום X\u2067\u2069', spans: [[5, 6]] });
    // a mark or a joiner inside the run goes with it; only isolates and embeddings stay
    expect(replaceRanges('אָ\u200dב', [[0, 4]], 'ג').text).toBe('ג');
  });
  it('F5 a field token is masked: never found, never crossed', () => {
    expect(fieldMask('a {name:p1} b {{c}}').map((m) => (m ? 1 : 0)).join('')).toBe('0011111111100011011');
    const s = film();
    const doc = tx(s.doc, [{ op: 'add_text', args: { text: 'name {date} name', start: f(75), duration: f(10), fields: true } }]).doc;
    const q: FindQuery = { text: 'date', wholeWord: false, ignoreMarks: true, finalsEqual: true, ignoreCase: false, scope: 'project', formats: 'all' };
    expect(findText(doc, q)).toEqual([]);
    expect(findText(doc, { ...q, text: 'name' })[0]!.ranges).toEqual([[0, 4], [12, 16]]);
  });
  it('findText over every carrier, grouped by sequence, kind and format; planReplace gives the edits and the notes; F1 one transaction', () => {
    const s = film();
    let r = tx(s.doc, [
      { op: 'add_cue', args: { start: f(0), duration: f(30), text: 'נעה כאן' } },
      { op: 'set_transcript', args: { assetId: s.vid, language: 'he', segments: [{ start: T.rt(1, 2), duration: T.rt(1, 1), text: 'נעה הולכת', words: [{ start: T.rt(1, 2), duration: T.rt(1, 2), text: 'נעה' }, { start: T.rt(1, 1), duration: T.rt(1, 2), text: 'הולכת' }] }] } },
      { op: 'add_variant', args: { width: 360, height: 640, name: 'vertical' } },
    ]);
    const cue = (r.results[0]!.output as { clipId: string }).clipId, variantId = (r.results[2]!.output as { variantId: string }).variantId;
    r = tx(r.doc, [{ op: 'set_variant_override', args: { variantId, clipId: s.title, text: 'נעה בפורמט' } }]);
    const doc = r.doc;
    const q: FindQuery = { text: 'נעה', wholeWord: true, ignoreMarks: true, finalsEqual: true, ignoreCase: false, scope: 'project', formats: 'all' };
    const m = findText(doc, q);
    expect(m.map((x) => x.kind)).toEqual(['title', 'cue', 'phrase', 'override']);
    // the phrase is placed where its clip shows it: A shows the video from 0, the phrase starts at 0.5 s
    expect(m.map((x) => x.frame)).toEqual([40, 0, 15, 40]);
    expect(findText(doc, { ...q, formats: 'master' }).map((x) => x.kind)).toEqual(['title', 'cue', 'phrase']);
    expect(findText(doc, { ...q, formats: 'viewed', variantId }).map((x) => x.kind)).toEqual(['cue', 'phrase', 'override']);
    expect(findText(doc, { ...q, scope: 'clips', clipIds: [cue] }).map((x) => x.kind)).toEqual(['cue']);
    const plan = planReplace(doc, q, 'נועה', [0, 1, 2]);
    expect(plan.edits.map((e) => e.text)).toEqual(['שלום נועה', 'נועה כאן', 'נועה הולכת']);
    expect([plan.lostWordTiming, plan.approximated, plan.reviewAgain, plan.finalMidWord]).toEqual([[], [], [], 0]);
    const done = tx(doc, [{ op: 'replace_text', args: { edits: plan.edits } }]);
    expect(out<ReplaceTextOutput>(done).changed).toBe(3);
    expect(findText(done.doc, q).map((x) => x.kind)).toEqual(['override']); // the unticked one is untouched
    expect(undoes(doc, done.doc)).toBe(true);
    // the labelled check: a final letter that ends up inside a word
    expect(planReplace(doc, { ...q, wholeWord: false }, 'מלךה', [1]).finalMidWord).toBe(1);
    expect(findText(tx(doc, [{ op: 'update_text', args: { clipId: s.title, text: 'מלךים' } }]).doc, { ...q, text: 'מלכים', wholeWord: false })[0]!.notes).toEqual(['final_mid_word']);
  });
});
