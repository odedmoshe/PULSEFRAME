/**
 * B1's tests of the qc rules (qcChecks.ts; .artifacts/wave8/qc-b1.md). Named after the plan's checks and the verifier's corrections;
 * every one fails before its rule exists (the pre-pass stub returned no issue and explained nothing). Times compared exactly
 * (T.cmp / whole frames from T.frameIndexAt), never as float seconds. Documents are built with ops, then a field is set by hand
 * where no op makes the case (a pure function under test, as exportChecks.test.ts does).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, assembleChecks, createProject, creativeProjection, diffEntities, documentChecks, EXPLAINED_FOR, explainFindings, findClip, QC_BUILT, restoreEntities,
  type ExportChecks, type ExportFinding, type MediaClip, type OpCall, type ProjectDocument, type TextClip,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `qc${seed++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
let hashN = 0;
const hash = () => `sha256:${(hashN++ % 16).toString(16).repeat(64)}`;
/** A video asset: `frames` pictures at `rate`, `durationFrames` (of the file's rate) long (more = the sound runs on), optional late start. */
const video = (name: string, frames: number, opts: { durationFrames?: number; rate?: T.Rate; startTime?: T.RationalTime; sound?: boolean; derived?: unknown } = {}) => {
  const rate = opts.rate ?? R;
  return {
    kind: 'video' as const, name, contentHash: hash(), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(opts.durationFrames ?? frames, rate),
    video: { width: 640, height: 360, frameRate: rate, codec: 'h264', rotation: 0, frameCount: frames, ...(opts.startTime ? { startTime: opts.startTime } : {}) },
    ...(opts.sound !== false ? { audio: { sampleRate: 48000, channels: 2, codec: 'aac' } } : {}),
    provenance: opts.derived ? { ...prov, origin: 'derived' as const, derived: opts.derived } : prov,
  };
};
const sound = (name: string, seconds: number, derived?: unknown) => ({ kind: 'audio' as const, name, contentHash: hash(), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(seconds, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: derived ? { ...prov, origin: 'derived' as const, derived } : prov });
const image = (name: string) => ({ kind: 'image' as const, name, contentHash: hash(), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov });

function project(assets: unknown[], frameRate: T.Rate = R) {
  const r = tx(createProject({ id: 'prj_qc', name: 'qc', frameRate }), assets.map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  const doc = { ...r.doc, settings: { ...r.doc.settings, width: 640, height: 360 } };
  return { doc, ids: r.results.map((x) => x.output!.assetId as string) };
}
const add = (doc: ProjectDocument, ops: OpCall[]) => { const r = tx(doc, ops); return { doc: r.doc, out: r.results.map((x) => x.output ?? {}) as any[] }; };
const mut = <C,>(doc: ProjectDocument, id: string, patch: Partial<C>): ProjectDocument => { const d = structuredClone(doc); Object.assign(findClip(d, id)!.clip, patch); return d; };
const of = (doc: ProjectDocument, code: string) => documentChecks(doc).issues.filter((i) => i.code === code);
const seqTracks = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks;

it('QC_BUILT is set once every rule is in, and documentChecks says it looked (built: true)', () => {
  expect(QC_BUILT).toBe(true);
  expect(documentChecks(createProject({ id: 'prj_e', name: 'e' }))).toEqual({ built: true, issues: [], skipped: [] });
});

describe('documentChecks — flash_clip (C10)', () => {
  const three = (mid: number, rate = R) => {
    const { doc, ids } = project([video('a.mp4', 900, { sound: false, rate })], rate);
    const g = (n: number) => T.frameTime(n, rate);
    return add(doc, [
      { op: 'add_clip', args: { assetId: ids[0]!, start: g(0), sourceIn: g(0), duration: g(60), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: ids[0]!, start: g(60), sourceIn: g(100), duration: g(mid), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: ids[0]!, start: g(60 + mid), sourceIn: g(300), duration: g(60), withLinkedAudio: false } },
    ]);
  };
  it('Q1: a 2-frame clip between two longer clips at 30 fps is one warning with measured {frames: 2, minFrames: 3}, its range and no fix', () => {
    const { doc, out } = three(2);
    const x = of(doc, 'flash_clip');
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ severity: 'warning', ids: [out[1].clipId, out[0].clipId, out[2].clipId], range: { startFrame: 60, endFrame: 62 }, measured: { frames: 2, minFrames: 3 } });
    expect(x[0]!.fix).toBeUndefined();
  });
  it('Q2: a 3-frame and a 4-frame clip are not flagged; at 60 fps a 5-frame clip is (minFrames 6)', () => {
    expect(of(three(3).doc, 'flash_clip')).toEqual([]);
    expect(of(three(4).doc, 'flash_clip')).toEqual([]);
    const R60 = { num: 60, den: 1 };
    expect(of(three(5, R60).doc, 'flash_clip').map((i) => i.measured)).toEqual([{ frames: 5, minFrames: 6 }]);
  });
  it('a short clip fully under a covering clip, or inside a transition overlap, is not flagged', () => {
    const { doc, out } = three(2);
    // cover: an opaque full-frame photo on a track above, over the short clip
    const d = tx(doc, [{ op: 'import_asset', args: { asset: image('p.png') } }], true);
    const pid = d.results[0]!.output!.assetId as string;
    const t = add(d.doc, [{ op: 'add_track', args: { kind: 'video' } }]);
    const covered = add(t.doc, [{ op: 'add_clip', args: { assetId: pid, trackId: t.out[0].trackId, start: f(50), duration: f(20) } }]);
    expect(of(covered.doc, 'flash_clip')).toEqual([]);
    // a cover with a motion effect does not cover (C3's guard)
    const shaken = mut<MediaClip>(covered.doc, covered.out[0].clipId, { effects: [{ id: 'fx1', type: 'motion.shake', enabled: true, params: {} }] });
    expect(of(shaken, 'flash_clip')).toHaveLength(1);
    // the next clip starts with a transition: the short picture plays on under it
    const next = mut<MediaClip>(doc, out[2].clipId, { transition: { type: 'dissolve', frames: 10 } as MediaClip['transition'] });
    expect(of(next, 'flash_clip')).toEqual([]);
    // the short clip carries a transition itself
    expect(of(mut<MediaClip>(doc, out[1].clipId, { transition: { type: 'dissolve', frames: 2 } as MediaClip['transition'] }), 'flash_clip')).toEqual([]);
  });
  it('a short title on a text track is flagged too; a hidden track is not looked at', () => {
    const { doc } = project([]);
    const t = add(doc, [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(2) } }]);
    expect(of(t.doc, 'flash_clip').map((i) => i.measured)).toEqual([{ frames: 2, minFrames: 3 }]);
    const hidden = structuredClone(t.doc); seqTracks(hidden).forEach((tr) => { tr.hidden = true; });
    expect(of(hidden, 'flash_clip')).toEqual([]);
  });
});

describe('documentChecks — held_past_picture (C1)', () => {
  /** a 10 s picture (300 frames at the file's rate) whose sound runs 12.5 s */
  const heldDoc = (rate: T.Rate, pictures: number, durationFrames: number, clip: (assetId: string) => OpCall) => {
    const { doc, ids } = project([video('phone.mp4', pictures, { rate, durationFrames })]);
    return add(doc, [clip(ids[0]!)]);
  };
  it('Q3: an asset whose duration is its sound, held for 2.5 s, gives one note with heldFrames 75 and the first held frame pinned exactly', () => {
    const { doc, out } = heldDoc(R, 300, 375, (a) => ({ op: 'add_clip', args: { assetId: a, start: f(0), duration: f(375), withLinkedAudio: false } }));
    const x = of(doc, 'held_past_picture');
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ severity: 'note', ids: [out[0].clipId], range: { startFrame: 300, endFrame: 375 }, measured: { heldFrames: 75, atStart: 0, firstHeldFrame: 300 } });
  });
  it('the first held frame is pinned for forward, reversed and 2× clips, in the FILE\'s frame rate (not the project\'s)', () => {
    // a 25 fps file: 250 pictures = 10 s, sound 12.5 s (312.5 → 312 frames at 25 = 12.48 s); the project runs at 30
    const R25 = { num: 25, den: 1 };
    const fwd = heldDoc(R25, 250, 312, (a) => ({ op: 'add_clip', args: { assetId: a, start: f(0), duration: f(374), withLinkedAudio: false } }));
    // source time k/30 ≥ 10 s ⇔ k ≥ 300 exactly; frame 299 (9.9667 s) is the last picture
    expect(of(fwd.doc, 'held_past_picture').map((i) => [i.range, i.measured.heldFrames])).toEqual([[{ startFrame: 300, endFrame: 374 }, 74]]);
    // reversed: frame k shows sourceIn + (duration − 1 frame − k)/30, held while ≥ 10 s ⇔ k ≤ 373 − 300 = 73 → frames [0, 74)
    const rev = mut<MediaClip>(fwd.doc, fwd.out[0].clipId, { reverse: true });
    const r = of(rev, 'held_past_picture');
    expect(r.map((i) => [i.range, i.measured.heldFrames, i.measured.firstHeldFrame])).toEqual([[{ startFrame: 0, endFrame: 74 }, 74, 73]]);
    expect(r[0]!.fix).toBeUndefined(); // reversed: no fix, the words say why
    // 2×: source 2k/30 ≥ 10 ⇔ k ≥ 150
    const two = heldDoc(R25, 250, 312, (a) => ({ op: 'add_clip', args: { assetId: a, start: f(0), duration: f(187), withLinkedAudio: false } }));
    const d2 = mut<MediaClip>(two.doc, two.out[0].clipId, { speed: { num: 2, den: 1 } });
    expect(of(d2, 'held_past_picture').map((i) => i.range)).toEqual([{ startFrame: 150, endFrame: 187 }]);
  });
  it('a late picture start (video.startTime > 0) holds the first picture: a note with atStart 1 and no fix', () => {
    const { doc, ids } = project([video('late.mkv', 300, { startTime: T.rt(1, 10), durationFrames: 303 })]);
    const t = add(doc, [{ op: 'add_clip', args: { assetId: ids[0]!, start: f(0), duration: f(303), withLinkedAudio: false } }]);
    const x = of(t.doc, 'held_past_picture');
    expect(x.map((i) => [i.range, i.measured.heldFrames, i.measured.atStart, !!i.fix])).toEqual([[{ startFrame: 0, endFrame: 3 }, 3, 1, false]]);
  });
  it('the forward fix trims the picture alone (includeLinked: false); applying it removes the issue; one undo restores the document hash', () => {
    const { doc, ids } = project([video('phone.mp4', 300, { durationFrames: 375 })]);
    const t = add(doc, [{ op: 'add_clip', args: { assetId: ids[0]!, start: f(0), duration: f(375) } }]);
    const x = of(t.doc, 'held_past_picture')[0]!;
    expect(x.fix!.ops).toEqual([{ op: 'trim_clip', args: { clipId: x.ids[0], edge: 'end', to: f(300), includeLinked: false } }]);
    const r = tx(t.doc, x.fix!.ops);
    expect(of(r.doc, 'held_past_picture')).toEqual([]);
    const sound = seqTracks(r.doc).find((tr) => tr.kind === 'audio')!.clips[0]!;
    expect(T.eq(sound.duration, f(375))).toBe(true); // the sound keeps its length
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(t.doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(t.doc));
  });
  it('a ramped clip (speedEnd) is skipped and named, not flagged; a file without a held tail is silent', () => {
    const { doc, ids } = project([video('phone.mp4', 300, { durationFrames: 375 }), video('plain.mp4', 300)]);
    const t = add(doc, [{ op: 'add_clip', args: { assetId: ids[0]!, start: f(0), duration: f(100), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: ids[1]!, start: f(100), duration: f(300), withLinkedAudio: false } }]);
    const ramped = mut<MediaClip>(t.doc, t.out[0].clipId, { speedEnd: { num: 2, den: 1 } });
    const res = documentChecks(ramped);
    expect(res.issues.filter((i) => i.code === 'held_past_picture')).toEqual([]);
    expect(res.skipped).toEqual([{ clipId: t.out[0].clipId, reason: 'ramped' }]);
  });
});

describe('documentChecks — title_hidden (C3)', () => {
  /** a title on a text track, then a video track above with an opaque full-frame photo over [from, to) */
  const setup = (from: number, to: number) => {
    const { doc, ids } = project([image('p.png')]);
    const t = add(doc, [{ op: 'add_text', args: { text: 'כותרת', start: f(30), duration: f(60) } }, { op: 'add_track', args: { kind: 'video' } }]);
    const c = add(t.doc, [{ op: 'add_clip', args: { assetId: ids[0]!, trackId: t.out[1].trackId, start: f(from), duration: f(to - from) } }]);
    const tracks = seqTracks(c.doc);
    const [moved] = tracks.splice(tracks.findIndex((x) => x.id === t.out[1].trackId), 1);
    tracks.push(moved!); // the picture track drawn last, above the title's track
    expect(tracks.findIndex((x) => x.id === t.out[1].trackId)).toBeGreaterThan(tracks.findIndex((x) => x.clips.some((y) => y.id === t.out[0].clipId)));
    return { doc: c.doc, title: t.out[0].clipId as string, cover: c.out[0].clipId as string, coverTrack: t.out[1].trackId as string };
  };
  it('Q4: a title under an opaque full-frame video for its whole length is one warning with ids [title, coverer]; moved above it, none', () => {
    const s = setup(0, 120);
    const x = of(s.doc, 'title_hidden');
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ severity: 'warning', ids: [s.title, s.cover], range: { startFrame: 30, endFrame: 90 } });
    // the cover track moved below the title's track
    const below = structuredClone(s.doc);
    const tr = seqTracks(below), i = tr.findIndex((t) => t.id === s.coverTrack), [moved] = tr.splice(i, 1);
    tr.unshift(moved!);
    expect(of(below, 'title_hidden')).toEqual([]);
  });
  it('a coverer with key.chroma, motion.shake/sway/spin or distort.* does not cover; one with only color.* / blur.gaussian / stylize.grain does', () => {
    const s = setup(0, 120);
    for (const type of ['key.chroma', 'motion.shake', 'motion.sway', 'motion.spin', 'distort.wave']) expect(of(mut<MediaClip>(s.doc, s.cover, { effects: [{ id: 'fx', type, enabled: true, params: {} }] }), 'title_hidden'), type).toEqual([]);
    for (const type of ['color.adjust', 'blur.gaussian', 'stylize.grain']) expect(of(mut<MediaClip>(s.doc, s.cover, { effects: [{ id: 'fx', type, enabled: true, params: {} }] }), 'title_hidden'), type).toHaveLength(1);
    // a disabled moving effect does not uncover
    expect(of(mut<MediaClip>(s.doc, s.cover, { effects: [{ id: 'fx', type: 'motion.shake', enabled: false, params: {} }] }), 'title_hidden')).toHaveLength(1);
  });
  it('frames inside an incoming transition span of the coverer are never covered, so a title shown through the transition is not hidden', () => {
    const s = setup(30, 120);
    expect(of(s.doc, 'title_hidden')).toHaveLength(1);
    expect(of(mut<MediaClip>(s.doc, s.cover, { transition: { type: 'dissolve', frames: 10 } as MediaClip['transition'] }), 'title_hidden')).toEqual([]);
  });
  it('a partly covered title is not flagged (whole length only)', () => {
    expect(of(setup(40, 120).doc, 'title_hidden')).toEqual([]);
    expect(of(setup(0, 89).doc, 'title_hidden')).toEqual([]);
  });
});

describe('documentChecks — ends_mid_word / cut_mid_word (C5)', () => {
  /** words of 0.4 s each starting every 0.5 s on the file's clock: word k = [0.5k, 0.5k + 0.4) */
  const words = (n: number) => Array.from({ length: n }, (_, k) => ({ id: `w${k}`, text: `מילה${k}`, start: T.rt(k * 5, 10), duration: T.rt(4, 10), confidence: null }));
  const withTranscript = (doc: ProjectDocument, assetId: string, timing: 'word' | 'segment' | 'approximate' = 'word') => {
    const d = structuredClone(doc);
    d.transcripts = { ...(d.transcripts ?? {}), [assetId]: { assetId, language: 'he', origin: { kind: 'manual', provider: null, model: null, createdAt: '2026-11-26T00:00:00Z', createdBy: 'test' }, segments: [{ id: 'seg1', start: T.ZERO, duration: T.rt(20, 1), text: 'x', original: null, speaker: null, timing, words: timing === 'segment' ? [] : words(40) }] } };
    return d;
  };
  /** a sound clip [0, durFrames) of the file from source 0, with its picture */
  const film = (durFrames: number) => {
    const { doc, ids } = project([video('talk.mp4', 600)]);
    const t = add(doc, [{ op: 'add_clip', args: { assetId: ids[0]!, start: f(0), duration: f(durFrames) } }]);
    const sound = seqTracks(t.doc).find((x) => x.kind === 'audio')!.clips[0]!.id;
    return { doc: withTranscript(t.doc, ids[0]!), asset: ids[0]!, sound, picture: t.out[0].clipId as string };
  };
  it('Q10: the film ending ≥ 1 frame inside a word is one ends_mid_word warning; a cut on a word edge gives none; 2 frames inside gives one note', () => {
    // word 2 = [1.0, 1.4) s = frames [30, 42); the film ends at frame 36: inside by 6 frames on each side
    const e = film(36);
    const x = of(e.doc, 'ends_mid_word');
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ severity: 'warning', ids: [e.sound], range: { startFrame: 30, endFrame: 36 }, measured: { wordStartMs: 1000, wordEndMs: 1400, cutMs: 1200, approximate: 0 } });
    // ending exactly on a word edge (frame 42 = 1.4 s) or in the gap: none
    expect(of(film(42).doc, 'ends_mid_word')).toEqual([]);
    expect(of(film(44).doc, 'ends_mid_word')).toEqual([]);
    // exactly one frame inside (frame 41 is 1/30 s before the word ends) counts
    expect(of(film(41).doc, 'ends_mid_word')).toHaveLength(1);
  });
  it('a cut inside a word that is not the film\'s end is a cut_mid_word note; on a word edge it is none', () => {
    const m = film(90);
    // the sound clip ends at frame 32 (2 frames inside word 2), the picture runs to 90
    const cutDoc = tx(m.doc, [{ op: 'trim_clip', args: { clipId: m.sound, edge: 'end', to: f(32), includeLinked: false } }]).doc;
    const x = of(cutDoc, 'cut_mid_word');
    expect(x.map((i) => [i.severity, i.measured])).toEqual([['note', { wordStartMs: 1000, wordEndMs: 1400, cutMs: 1067, approximate: 0 }]]);
    expect(of(cutDoc, 'ends_mid_word')).toEqual([]);
    const edge = tx(m.doc, [{ op: 'trim_clip', args: { clipId: m.sound, edge: 'end', to: f(30), includeLinked: false } }]).doc;
    expect(of(edge, 'cut_mid_word')).toEqual([]);
  });
  it('a sound clip ending with fadeOut, or a volume key near 0 at that edge, is excused', () => {
    const e = film(36);
    expect(of(mut<MediaClip>(e.doc, e.sound, { fadeOut: f(6) }), 'ends_mid_word')).toEqual([]);
    expect(of(mut<MediaClip>(e.doc, e.sound, { volume: [{ time: f(0), value: 1 }, { time: f(35), value: 0 }] }), 'ends_mid_word')).toEqual([]);
    // a key that only lowers the level a little is not an excuse
    expect(of(mut<MediaClip>(e.doc, e.sound, { volume: [{ time: f(0), value: 1 }, { time: f(35), value: 0.5 }] }), 'ends_mid_word')).toHaveLength(1);
  });
  it('a razor split (same asset, sourceIn = previous sourceEnd, same speed, back to back) is not a cut', () => {
    const e = film(90);
    const split = tx(e.doc, [{ op: 'split_clip', args: { clipId: e.sound, at: f(36) } }]).doc;
    expect(seqTracks(split).find((t) => t.kind === 'audio')!.clips).toHaveLength(2);
    expect(of(split, 'cut_mid_word')).toEqual([]);
  });
  it('timing "segment" is skipped and named (segment_timing); approximate word times give a note only, with approximate: 1', () => {
    const e = film(36);
    const seg = withTranscript(e.doc, e.asset, 'segment');
    const r = documentChecks(seg);
    expect(r.issues.filter((i) => i.code === 'ends_mid_word')).toEqual([]);
    expect(r.skipped).toEqual([{ clipId: e.sound, reason: 'segment_timing' }]);
    const ap = of(withTranscript(e.doc, e.asset, 'approximate'), 'ends_mid_word');
    expect(ap.map((i) => [i.severity, i.measured.approximate])).toEqual([['note', 1]]);
  });
  it('a derived copy with sourceRangeStart maps word times through lineage (transcriptFor); an untimed copy is skipped and named (untimed_copy)', () => {
    const e = film(36);
    // a time-preserving copy made from source time 1 s on: its time 0.2 s is the root's 1.2 s, inside word 2
    const der = (extra: Record<string, unknown>) => ({ jobId: 'job1', capabilityId: 'c', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: [e.asset], outputName: 'o', outputRole: 'r', encoding: 'mp4', provider: {}, ...extra });
    const r = tx(e.doc, [{ op: 'import_asset', args: { asset: sound('copy.wav', 10, der({ sourceRangeStart: T.rt(1, 1) })) } }, { op: 'import_asset', args: { asset: sound('rev.wav', 10, der({})) } }], true);
    const [copy, untimed] = r.results.map((x) => x.output!.assetId as string);
    const placed = add(r.doc, [{ op: 'add_track', args: { kind: 'audio' } }]);
    const a2 = placed.out[0].trackId;
    // the copy plays [0, 6) frames = its 0–0.2 s… placed so its end is the film's end is not needed: as a mid-film cut
    const p = add(placed.doc, [
      { op: 'add_clip', args: { assetId: copy!, trackId: a2, start: f(0), duration: f(6) } },
      { op: 'add_clip', args: { assetId: untimed!, trackId: a2, start: f(10), duration: f(6) } },
    ]);
    const res = documentChecks(p.doc);
    const cut = res.issues.filter((i) => i.code === 'cut_mid_word' && i.ids[0] === p.out[0].clipId);
    expect(cut.map((i) => i.measured)).toEqual([{ wordStartMs: 0, wordEndMs: 400, cutMs: 200, approximate: 0 }]); // root word 2 [1.0, 1.4) on the copy's clock
    expect(res.skipped).toContainEqual({ clipId: p.out[1].clipId, reason: 'untimed_copy' });
  });
  it('no issue message quotes a transcript word (C5)', () => {
    const e = film(36), m = film(90);
    const cutDoc = tx(m.doc, [{ op: 'trim_clip', args: { clipId: m.sound, edge: 'end', to: f(32), includeLinked: false } }]).doc;
    for (const i of [...documentChecks(e.doc).issues, ...documentChecks(cutDoc).issues]) expect(i.message).not.toMatch(/מילה|w\d/);
  });
  it('more than 20 cut_mid_word issues are listed as 20 rows plus one summary row', () => {
    const { doc, ids } = project([sound('talk.wav', 20), video('pic.mp4', 600, { sound: false })]);
    // 25 sound clips of 6 frames, each from a different source word, ending 3 frames inside it; a picture longer than all
    const ops: OpCall[] = [{ op: 'add_clip', args: { assetId: ids[1]!, start: f(0), duration: f(400), withLinkedAudio: false } }, { op: 'add_track', args: { kind: 'audio' } }];
    const t = add(doc, ops);
    const a = t.out[1].trackId;
    const clips = Array.from({ length: 25 }, (_, k): OpCall => ({ op: 'add_clip', args: { assetId: ids[0]!, trackId: a, start: f(k * 10), sourceIn: f(k * 15 + 3), duration: f(3) } }));
    const d = withTranscript(add(t.doc, clips).doc, ids[0]!);
    const x = of(d, 'cut_mid_word');
    // each clip starts 3 frames inside word k' and ends 0 frames later... both edges inside: 25 clips × 2 edges = 50 cuts
    expect(x).toHaveLength(21);
    expect(x[20]!.measured).toEqual({ more: 30, listed: 20 });
    expect(x.slice(0, 20).every((i) => i.measured.more === undefined)).toBe(true);
  });
});

describe('documentChecks — properties', () => {
  it('Q11: the clean control document has no qc issue; Q14: on a variant and on a short each range is in that output\'s own frames', () => {
    const { doc, ids } = project([video('a.mp4', 900)]);
    const t = add(doc, [
      { op: 'add_clip', args: { assetId: ids[0]!, start: f(0), sourceIn: f(0), duration: f(120) } },
      { op: 'add_clip', args: { assetId: ids[0]!, start: f(120), sourceIn: f(200), duration: f(120) } },
      { op: 'add_text', args: { text: 'שלום', start: f(30), duration: f(60) } },
    ]);
    expect(documentChecks(t.doc).issues).toEqual([]);
    // Q14 is about the projected document: a document whose film starts later (a short's own sequence starts at 0) keeps ranges in its own frames
    const shifted = structuredClone(t.doc);
    for (const tr of seqTracks(shifted)) tr.clips.forEach((c) => { c.start = T.add(c.start, f(100)); });
    const flash = tx(t.doc, [{ op: 'add_clip', args: { assetId: ids[0]!, start: f(240), sourceIn: f(500), duration: f(2), withLinkedAudio: false } }]).doc;
    expect(of(flash, 'flash_clip').map((i) => i.range)).toEqual([{ startFrame: 240, endFrame: 242 }]);
  });
  it('Q17: one timing sample on a synthetic 10-minute, 600-clip document is recorded (not gated)', () => {
    const { doc, ids } = project([video('a.mp4', 18000, { durationFrames: 18300 }), image('p.png')]);
    const d = structuredClone(doc);
    const v1 = seqTracks(d).find((t) => t.kind === 'video')!;
    const base = { transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, gain: 1, linkGroupId: null } as const;
    for (let k = 0; k < 600; k++) v1.clips.push({ ...base, id: `c${k}`, type: 'media', assetId: ids[0]!, start: f(k * 30), duration: f(30), sourceIn: f((k * 30) % 17000) } as MediaClip);
    const t0 = performance.now();
    const r = documentChecks(d);
    const msTaken = performance.now() - t0;
    console.log(`Q17 sample: documentChecks on 600 clips / 18000 frames took ${msTaken.toFixed(1)} ms (one sample, not gated)`);
    expect(r.built).toBe(true);
  });
});

// ---------- explainFindings ----------
const black = (from: number, to: number, context: 'gap' | 'picture' = 'picture'): ExportFinding => ({ kind: 'black', from: f(from), to: f(to), context, measured: { frames: to - from } });
const frozen = (from: number, to: number): ExportFinding => ({ kind: 'frozen', from: f(from), to: f(to), measured: { frames: to - from } });
const silence = (fromS: number, toS: number): ExportFinding => ({ kind: 'silence', from: T.rt(fromS * 4800, 48000), to: T.rt(toS * 4800, 48000), soundPlays: false, measured: { blocks: toS - fromS } });
const report = (picture: ExportFinding[], sound: ExportFinding[] = []): ExportChecks => assembleChecks({ method: 'm', status: 'measured', findings: picture }, { method: 's', status: 'measured', findings: sound });
const reasons = (c: ExportChecks) => [...c.picture.findings, ...c.sound.findings].map((x) => x.explained ?? null);

describe('explainFindings (C6, C9, C14)', () => {
  const plain = () => {
    const { doc, ids } = project([video('a.mp4', 900, { sound: false })]);
    return { ...add(doc, [{ op: 'add_clip', args: { assetId: ids[0]!, start: f(0), duration: f(120), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: ids[0]!, start: f(120), sourceIn: f(300), duration: f(120), withLinkedAudio: false } }]), assetId: ids[0]! };
  };
  it('Q6: a black run wholly inside a dip-black transition span is dip_transition; one reaching past it is not', () => {
    const p = plain();
    const d = mut<MediaClip>(p.doc, p.out[1].clipId, { transition: { type: 'dip-black', frames: 20 } as MediaClip['transition'] });
    expect(reasons(explainFindings(d, 0, report([black(122, 137), black(125, 145)])))).toEqual(['dip_transition', null]);
  });
  it('Q5: a black run at the end within the frames where the fading clip\'s opacity is < 1 plus at most 0.5 s is fade_edge; a 20 s black clip after the fade is not (C9)', () => {
    const p = plain();
    // opacity 1 at local 78 → 0 at local 99 (the last 0.7 s fades), held 0 to the end at 240
    const d = mut<MediaClip>(p.doc, p.out[1].clipId, { keyframes: { opacity: [{ time: f(78), value: 1, easing: 'linear' }, { time: f(99), value: 0, easing: 'linear' }] } as MediaClip['keyframes'] });
    expect(reasons(explainFindings(d, 0, report([black(220, 240)])))).toEqual(['fade_edge']);
    // the same black run mid-film (not at an edge) is not explained
    expect(reasons(explainFindings(d, 0, report([black(200, 220)])))).toEqual([null]);
    // a 20 s black clip (a lossless black video) after the faded clip: the run reaches 600 frames past the fade + 15 frames of slack
    const r = tx(d, [{ op: 'import_asset', args: { asset: video('black.mp4', 900, { sound: false }) } }], true);
    const b = add(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(240), duration: f(600), withLinkedAudio: false } }]).doc;
    expect(reasons(explainFindings(b, 0, report([black(225, 840)])))).toEqual([null]);
  });
  it('a title\'s own entrance or exit animation at the edge counts for fade_edge; a gap at the very start is not explained (it is empty_picture)', () => {
    const { doc } = project([]);
    const t = add(doc, [{ op: 'add_text', args: { text: 'סוף', start: f(0), duration: f(60) } }]);
    const anim = mut<TextClip>(t.doc, t.out[0].clipId, { animation: { by: 'word', in: null, out: 'fade', loop: null, inFrames: 20, outFrames: 20 } });
    expect(reasons(explainFindings(anim, 0, report([black(42, 60)])))).toEqual(['fade_edge']);
    expect(reasons(explainFindings(t.doc, 0, report([black(42, 60)])))).toEqual([null]);
    // a gap at the very start before a fade-in title is empty_picture before export: not also explained
    const late = structuredClone(anim); (findClip(late, t.out[0].clipId)!.clip as TextClip).animation = { by: 'word', in: 'fade', out: null, loop: null, inFrames: 20, outFrames: 15 };
    findClip(late, t.out[0].clipId)!.clip.start = f(10);
    expect(reasons(explainFindings(late, 0, report([black(0, 20, 'gap')])))).toEqual([null]);
  });
  it('Q7: a silence wholly inside a freeze clip\'s span is freeze_hold', () => {
    const p = plain();
    const d = mut<MediaClip>(p.doc, p.out[1].clipId, { freeze: true }); // frames 120–240 = 4–8 s
    // assembleChecks orders by start: [3.0, 5.0) first (not inside the freeze), then [4.1, 7.9) (inside)
    expect(reasons(explainFindings(d, 0, report([], [silence(41, 79), silence(30, 50)])))).toEqual([null, 'freeze_hold']);
  });
  it('a frozen run inside a held_past_picture run is picture_ends; one where a source frame lasts ≥ 2 s is slow_speed; one on a derived asset made from an image is still_source', () => {
    const { doc, ids } = project([video('phone.mp4', 300, { durationFrames: 375, sound: false }), image('p.png')]);
    const t = add(doc, [{ op: 'add_clip', args: { assetId: ids[0]!, start: f(0), duration: f(375), withLinkedAudio: false } }]);
    // the frozen run starts on the last real picture (299) and the held frames follow
    expect(reasons(explainFindings(t.doc, 0, report([frozen(299, 375), frozen(200, 299)])))).toEqual([null, 'picture_ends']);
    // slow: speed 1/60 of a 30 fps file → one source frame lasts 2 s
    const slow = mut<MediaClip>(t.doc, t.out[0].clipId, { speed: { num: 1, den: 60 }, sourceIn: T.ZERO, duration: f(300) });
    expect(reasons(explainFindings(slow, 0, report([frozen(0, 90)])))).toEqual(['slow_speed']);
    const notSlow = mut<MediaClip>(t.doc, t.out[0].clipId, { speed: { num: 1, den: 59 }, duration: f(300) });
    expect(reasons(explainFindings(notSlow, 0, report([frozen(0, 90)])))).toEqual([null]);
    // still_source: a video made from a photo
    const der = { jobId: 'j', capabilityId: 'c', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: [ids[1]!], outputName: 'o', outputRole: 'r', encoding: 'mp4', provider: {} };
    const r = tx(t.doc, [{ op: 'import_asset', args: { asset: video('slide.mp4', 300, { sound: false, derived: der }) } }], true);
    const s = add(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(375), duration: f(120), withLinkedAudio: false } }]).doc;
    expect(reasons(explainFindings(s, 0, report([frozen(380, 480)])))).toEqual(['still_source']);
  });
  it('it never removes, reorders or changes the measured numbers of a finding, and only uses a reason for the kind EXPLAINED_FOR names', () => {
    const p = plain();
    const d = mut<MediaClip>(p.doc, p.out[1].clipId, { freeze: true, transition: { type: 'dip-black', frames: 20 } as MediaClip['transition'] });
    const input = report([black(122, 137), frozen(125, 140), black(0, 10), { kind: 'clipped', from: f(130), to: f(133), measured: { samples: 9 } }], [silence(45, 70), { kind: 'clipped', from: T.rt(216000, 48000), to: T.rt(220800, 48000), measured: { samples: 3 } }]);
    const frozenInput = structuredClone(input);
    const out = explainFindings(d, 0, input);
    expect(input).toEqual(frozenInput); // pure
    const strip = (c: ExportChecks) => [...c.picture.findings, ...c.sound.findings].map(({ explained: _e, ...rest }) => rest);
    expect(strip(out)).toEqual(strip(input));
    for (const x of [...out.picture.findings, ...out.sound.findings]) if (x.explained) expect(EXPLAINED_FOR[x.explained]).toBe(x.kind);
    expect(reasons(out).filter(Boolean).length).toBeGreaterThan(0);
  });
  it('the same input gives the same output on the export, the fast export and the loudness route (Q13, K4): one pure function, byte-equal', () => {
    const p = plain();
    const d = mut<MediaClip>(p.doc, p.out[1].clipId, { freeze: true });
    const input = report([black(0, 20)], [silence(41, 79)]);
    const a = explainFindings(d, 0, input), b = explainFindings(structuredClone(d), 0, structuredClone(input));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // the loudness route explains the sound half with a not-measured picture: the sound findings are byte-equal to the export's
    const loud = explainFindings(d, 0, assembleChecks({ method: 'x', status: 'not_measured', findings: [] }, input.sound));
    expect(JSON.stringify(loud.sound.findings)).toBe(JSON.stringify(a.sound.findings));
  });
});
