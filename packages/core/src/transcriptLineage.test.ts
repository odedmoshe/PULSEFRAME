/**
 * Edits by a recording's times (delete_transcript_range, filler and silence cuts through sourceRangesToTimeline, tidy-speech,
 * split_at_scenes, the pacing report) follow a clip that shows a DERIVED copy back to the transcribed or analysed recording
 * (lineage.ts timingRelations). A copy that keeps its timing (provenance.derived.sourceRangeStart) is mapped exactly onto its own
 * clock; a copy made without a recorded time mapping (a reversed or stretched rendition, a generated video) is REFUSED with
 * code untimed_copy, because where the words are in it is unknown and a guess could cut the wrong frames.
 * The derived assets are hand-built fixtures standing in for provider results (labelled: no provider ran).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, findClip, OpError, pacingReport, planRecipe, RecipeError, restoreEntities, sourceRangesToTimeline,
  untimedCopies, validateProject, type MediaClip, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `tl${n++}_`, actor: 'test', allowInternal });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return { code: e.code, message: e.message, hint: e.hint, details: e.details }; throw e; } return { code: 'accepted' }; };
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'talk.mp4', contentHash: hash('1'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const derivedProv = (src: string, extra: Record<string, unknown> = {}, capabilityId = 'comfy.video.enhance') => ({
  origin: 'derived' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test',
  derived: { jobId: 'job_fixture', capabilityId, capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'video', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, logicDigest: hash('a'), ...extra },
});
const identity = (startSeconds: number, seconds: number) => ({ sourceStartFrame: startSeconds * 30, sourceFrameCount: seconds * 30, sourceRate: R, outputRate: R, mapping: 'identity', heldFrames: [] });
/** Kinds of derived copy (fixtures). `start` = provenance.derived.sourceRangeStart in seconds; absent = no recorded time mapping. */
const copies = (vid: string) => ({
  /** an enhanced picture, frame for frame, with the sound copied (frame job, identity mapping) */
  enhanced: { ...video, name: 'enhanced.mp4', contentHash: hash('2'), duration: T.rt(6, 1), video: { ...video.video, width: 1280, height: 720, frameCount: 180 }, provenance: derivedProv(vid, { sourceRangeStart: T.rt(1, 1), audio: 'source-copied', frames: identity(1, 6) }) },
  /** a cleaned-up voice (local tool): sound only, processed, from 0.5 s */
  voice: { kind: 'audio' as const, name: 'clean.wav', contentHash: hash('3'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(7, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: derivedProv(vid, { sourceRangeStart: T.rt(1, 2), audio: 'processed' }, 'local.audio.voice-clean') },
  /** a smoother slow motion: 4 output frames per source frame at 120 fps, time-identical, from 2 s */
  slow: { ...video, name: 'slow.mp4', contentHash: hash('4'), duration: T.rt(4, 1), video: { ...video.video, frameRate: { num: 120, den: 1 }, frameCount: 480 }, provenance: derivedProv(vid, { sourceRangeStart: T.rt(2, 1), audio: 'source-copied', frames: { sourceStartFrame: 60, sourceFrameCount: 120, sourceRate: R, outputRate: { num: 120, den: 1 }, mapping: 'interpolated', multiplier: 4, heldFrames: [] } }) },
  /** a reversed rendition: made from the recording, no recorded time mapping */
  reversed: { ...video, name: 'reversed.mp4', contentHash: hash('5'), provenance: derivedProv(vid, {}, 'comfy.video.reverse') },
  /** a stretched rendition (twice as long), no recorded time mapping */
  stretched: { ...video, name: 'stretched.mp4', contentHash: hash('6'), duration: T.rt(16, 1), video: { ...video.video, frameCount: 480 }, provenance: derivedProv(vid, {}, 'comfy.video.stretch') },
  /** a still grabbed from the recording: no time, never in the way */
  still: { kind: 'image' as const, name: 'grab.png', contentHash: hash('7'), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: derivedProv(vid, {}, 'comfy.image.upscale') },
});
/** Word-timed transcript of talk.mp4: four words at 1.0, 2.0, 3.0 and 4.0 s. */
const WORDS = [[1, 0.5, 'אחת'], [2, 0.5, 'שתיים'], [3, 0.4, 'שלוש'], [4, 0.6, 'ארבע']] as const;
const transcript = (assetId: string, shift = 0) => ({ op: 'set_transcript', args: { assetId, language: 'he', segments: [{ start: T.fromSeconds(String(1 - shift)), duration: T.rt(4, 1), text: WORDS.map((w) => w[2]).join(' '), words: WORDS.map(([s, d, text]) => ({ start: T.fromSeconds(String(s - shift)), duration: T.fromSeconds(String(d)), text })) }] } });

function setup() {
  let r = tx(createProject({ id: 'prj_tl', name: 'TL' }), [{ op: 'import_asset', args: { asset: video } }], true);
  const vid = r.results[0]!.output!.assetId as string;
  const c = copies(vid);
  r = tx(r.doc, Object.values(c).map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  const ids = Object.fromEntries(Object.keys(c).map((k, i) => [k, r.results[i]!.output!.assetId as string])) as Record<keyof typeof c, string>;
  r = tx(r.doc, [transcript(vid)]);
  const words = r.doc.transcripts[vid]!.segments[0]!.words.map((w) => w.id);
  return { doc: r.doc, vid, ids, words };
}
const media = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const undoes = (before: ProjectDocument, after: ProjectDocument) => {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return creativeProjection(back) === creativeProjection(before);
};
const del = (doc: ProjectDocument, assetId: string, from: string, to = from) => tx(doc, [{ op: 'delete_transcript_range', args: { assetId, fromWordId: from, toWordId: to } }]);
/** Every clip on the timeline as [track kind, start frame, length in frames, file, source in-point in seconds]. */
const layout = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips.map((c) => [t.kind, T.frameIndexAt(c.start, R), T.frameIndexAt(c.duration, R), c.type === 'media' ? c.assetId : c.type, c.type === 'media' ? T.toSeconds(c.sourceIn) : null]));
const ranges = (r: ReturnType<typeof tx>) => (r.results[0]!.output!.ranges as { start: T.RationalTime; end: T.RationalTime }[]).map((x) => [T.frameIndexAt(x.start, R), T.frameIndexAt(x.end, R)]);

describe('delete_transcript_range follows a derived copy back to the transcribed recording', () => {
  it('a clip that shows ONLY a time-preserving copy (enhanced picture with its copied sound) is cut at the words, mapped exactly; one transaction; exact undo', () => {
    const s = setup();
    // the copy starts at 1 s of the recording; the clip plays the copy from 0 at frame 0, so "שתיים" (2.0–2.5 s) is at 1.0–1.5 s = frames 30–45
    const placed = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.ids.enhanced, start: f(0), sourceIn: f(0), duration: f(180) } }]);
    const r = del(placed.doc, s.vid, s.words[1]!);
    expect(r.results).toHaveLength(1);
    expect(ranges(r)).toEqual([[30, 45]]);
    expect(layout(r.doc).filter((x) => x[0] !== 'caption')).toEqual([
      ['video', 0, 30, s.ids.enhanced, 0], ['video', 30, 135, s.ids.enhanced, 1.5],
      ['audio', 0, 30, s.ids.enhanced, 0], ['audio', 30, 135, s.ids.enhanced, 1.5],
    ]);
    expect(validateProject(r.doc)).toEqual([]);
    expect(undoes(placed.doc, r.doc)).toBe(true);
  });

  // For each kind, the timeline that shows the copy must come out of the cut exactly as the timeline that shows the recording does.
  const kinds: [string, (s: ReturnType<typeof setup>, clip: string, sound: string) => OpCall[]][] = [
    ['an enhanced picture (replace_clip_asset)', (s, clip) => [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: s.ids.enhanced } }]],
    ['a cleaned-up voice (replace_clip_asset on the sound)', (s, _clip, sound) => [{ op: 'replace_clip_asset', args: { clipId: sound, assetId: s.ids.voice } }]],
    ['both at once', (s, clip, sound) => [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: s.ids.enhanced } }, { op: 'replace_clip_asset', args: { clipId: sound, assetId: s.ids.voice } }]],
    ['a replace_clip_media result that shows the same moments of the copy', (s, clip) => [{ op: 'replace_clip_media', args: { clipId: clip, assetId: s.ids.enhanced, sourceIn: T.rt(1, 2), linked: 'detach' } }]],
  ];
  for (const [what, swap] of kinds)
    it(`${what}: the same frames are cut as on the recording itself, the copy's source in-points stay on its own clock`, () => {
      const s = setup();
      // picture + linked sound from 1.5 s of the recording, 4 s long
      const base = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.vid, start: f(0), sourceIn: f(45), duration: f(120) } }]);
      const clip = base.results[0]!.output!.clipId as string, sound = base.results[0]!.output!.audioClipId as string;
      const shown = tx(base.doc, swap(s, clip, sound));
      const onOriginal = del(base.doc, s.vid, s.words[1]!, s.words[2]!);
      const onCopy = del(shown.doc, s.vid, s.words[1]!, s.words[2]!);
      expect(ranges(onCopy)).toEqual(ranges(onOriginal));
      expect(ranges(onCopy)).toEqual([[15, 57]]); // 2.0 s..3.4 s of the recording, played from 1.5 s at frame 0
      // same places and lengths; each clip's in-point is the recording's in-point moved onto its file's clock
      const offset: Record<string, number> = { [s.vid]: 0, [s.ids.enhanced]: 1, [s.ids.voice]: 0.5 };
      const asOriginal = layout(onCopy.doc).map((x) => (x[3] === s.vid || x[3] === 'caption' ? x : [x[0], x[1], x[2], s.vid, (x[4] as number) + offset[x[3] as string]!]));
      expect(asOriginal).toEqual(layout(onOriginal.doc));
      expect(validateProject(onCopy.doc)).toEqual([]);
      expect(undoes(shown.doc, onCopy.doc)).toBe(true);
    });

  it('a smoother slow motion (interpolated copy played at 1/4 speed): the words are cut over exactly four times their length', () => {
    const s = setup();
    const base = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.vid, start: f(0), sourceIn: f(60), duration: f(60) } }]);
    const clip = base.results[0]!.output!.clipId as string;
    const slow = tx(base.doc, [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: s.ids.slow } }, { op: 'set_clip_speed', args: { clipId: clip, speed: 0.25 } }]);
    expect(T.eq(media(slow.doc, clip).duration, f(240))).toBe(true);
    // "שלוש" is 3.0–3.4 s of the recording = 1.0–1.4 s of the copy, played at 1/4 speed from frame 0: 4.0–5.6 s = frames 120–168
    const r = del(slow.doc, s.vid, s.words[2]!);
    expect(ranges(r)).toEqual([[120, 168]]);
    expect(undoes(slow.doc, r.doc)).toBe(true);
  });

  it('a copy of a copy adds the offsets; a copy played at double speed maps exactly; a copy played backwards is left alone as the recording is', () => {
    const s = setup();
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: { ...copies(s.ids.enhanced).voice, contentHash: hash('8'), duration: T.rt(5, 1) } } }], true);
    const twice = r.results[0]!.output!.assetId as string; // starts at 0.5 s of the enhanced copy = 1.5 s of the recording
    r = tx(r.doc, [
      { op: 'add_clip', args: { assetId: twice, start: f(0), duration: f(90) } }, // 1.5..4.5 s of the recording
      { op: 'add_clip', args: { assetId: s.ids.enhanced, start: f(120), sourceIn: f(0), duration: f(60), withLinkedAudio: false } },
    ]);
    const fast = r.results[1]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'set_clip_speed', args: { clipId: fast, speed: 2 } }]); // plays 1..3 s of the recording in frames 120..150
    // "שתיים" 2.0–2.5 s: in the chained copy at 0.5–1.0 s (frames 15–30); in the fast clip at 1.0–1.5 s of the copy / 2 = frames 135–142.5 → 135–143
    expect(ranges(del(r.doc, s.vid, s.words[1]!))).toEqual([[15, 30], [135, 143]]);
    const back = tx(r.doc, [{ op: 'set_clip_reverse', args: { clipId: fast, reverse: true } }]).doc;
    expect(ranges(del(back, s.vid, s.words[1]!))).toEqual([[15, 30]]);
  });

  it('the copy\'s id may be given: the recording\'s transcript is used; and a transcript made on the voice copy cuts the clips of the recording', () => {
    const s = setup();
    const placed = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.vid, start: f(0), duration: f(240) } }]);
    expect(ranges(del(placed.doc, s.ids.enhanced, s.words[1]!))).toEqual([[60, 75]]);
    // the voice copy (from 0.5 s) transcribed on its own clock: its "שתיים" is 1.5–2.0 s = 2.0–2.5 s of the recording
    const own = tx(placed.doc, [transcript(s.ids.voice, 0.5)]);
    const w = own.doc.transcripts[s.ids.voice]!.segments[0]!.words[1]!.id;
    expect(ranges(del(own.doc, s.ids.voice, w))).toEqual([[60, 75]]);
  });

  it('a conformed recording (the stored file is a conformed copy under the same id) is the recording itself', () => {
    let r = tx(createProject({ id: 'prj_cf', name: 'CF' }), [{ op: 'import_asset', args: { asset: { ...video, conform: { originalContentHash: hash('9'), originalByteSize: 1, reasons: ['variable-frame-rate'], original: { codec: 'h264', width: 640, height: 360, avgFrameRate: '30/1', rFrameRate: '60/1', rotation: 0, frameCount: null, durationSeconds: 8 }, frameMapping: 'cfr-nearest-timestamp', method: 'fixture' } } } }], true);
    const vid = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [transcript(vid), { op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(240) } }]);
    expect(ranges(del(r.doc, vid, r.doc.transcripts[vid]!.segments[0]!.words[1]!.id))).toEqual([[60, 75]]);
  });

  it('DECISION: a clip that shows a copy without a recorded time mapping (reversed or stretched rendition) is refused, with nothing changed; stills and freeze frames are not in the way', () => {
    const s = setup();
    const base = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.vid, start: f(0), duration: f(240) } }]);
    for (const kind of ['reversed', 'stretched'] as const) {
      const r = tx(base.doc, [{ op: 'add_clip', args: { assetId: s.ids[kind], start: f(240), duration: f(60) } }]);
      const clip = r.results[0]!.output!.clipId as string, sound = r.results[0]!.output!.audioClipId as string;
      const got = refusal(() => del(r.doc, s.vid, s.words[1]!));
      expect(got).toMatchObject({ code: 'untimed_copy', message: `clip ${clip} shows a copy of this recording that does not keep its timing, so where these moments are in it is unknown`, details: { clipIds: [clip, sound], assetIds: [s.ids[kind]] } });
      expect((got as { hint: string }).hint).toMatch(/replace_clip_media.*cut_range/);
      // a copy of the untimed copy that keeps ITS timing is still untimed against the recording
      const chained = tx(r.doc, [{ op: 'import_asset', args: { asset: { ...copies(s.ids[kind]).enhanced, contentHash: hash(kind === 'reversed' ? 'b' : 'c') } } }], true);
      const swapped = tx(chained.doc, [{ op: 'delete_clip', args: { clipId: clip } }, { op: 'add_clip', args: { assetId: chained.results[0]!.output!.assetId as string, start: f(240), duration: f(30) } }]);
      expect(refusal(() => del(swapped.doc, s.vid, s.words[1]!)).code).toBe('untimed_copy');
    }
    // a still made from the recording, and a freeze frame of the reversed rendition, play no time: the cut goes ahead
    const stills = tx(base.doc, [{ op: 'add_clip', args: { assetId: s.ids.still, start: f(240), duration: f(30) } }, { op: 'add_clip', args: { assetId: s.ids.reversed, start: f(270), duration: f(60), withLinkedAudio: false } }]);
    const frozen = tx(stills.doc, [{ op: 'freeze_frame', args: { clipId: stills.results[1]!.output!.clipId as string, at: f(270), duration: f(30) } }]).doc;
    const frozenOnly = structuredClone(frozen);
    for (const t of frozenOnly.sequences[frozenOnly.mainSequenceId]!.tracks) t.clips = t.clips.filter((c) => c.type !== 'media' || c.assetId !== s.ids.reversed || c.freeze);
    expect(untimedCopies(frozenOnly, s.vid)).toEqual([]);
    expect(ranges(del(frozenOnly, s.vid, s.words[1]!))).toEqual([[60, 75]]);
  });
});

describe('filler and silence cuts, tidy-speech, scene splits and pacing follow the copy too', () => {
  it('sourceRangesToTimeline maps a source range through clips of time-preserving copies, snapped inward', () => {
    const s = setup();
    const r = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.ids.voice, start: f(0), duration: f(150) } }]); // 0.5..5.5 s of the recording
    // a silence 2.6–3.0 s of the recording with 0.1 s kept each side: 2.7–2.9 s → the copy's 2.2–2.4 s → frames 66–72
    expect(sourceRangesToTimeline(r.doc, s.vid, [{ start: T.rt(13, 5), end: T.rt(3, 1) }], T.rt(1, 10)).map((x) => [T.frameIndexAt(x.start, R), T.frameIndexAt(x.end, R)])).toEqual([[66, 72]]);
    expect(untimedCopies(r.doc, s.vid)).toEqual([]);
  });

  it('tidy-speech cuts the measured pauses out of a clip of the cleaned voice; refused while an untimed copy is on the timeline', () => {
    const s = setup();
    const r = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.ids.voice, start: f(0), duration: f(150) } }]);
    const plan = planRecipe(r.doc, 'tidy-speech', { assetId: s.vid, keepSeconds: 0, loudness: null, captions: false }, { silences: { [s.vid]: [{ start: T.rt(13, 5), end: T.rt(3, 1) }] } });
    expect(plan.ops).toEqual([{ op: 'cut_range', args: { start: f(63), end: f(75) } }]);
    const applied = tx(r.doc, plan.ops);
    expect(applied.results).toHaveLength(1);
    const withUntimed = tx(r.doc, [{ op: 'add_clip', args: { assetId: s.ids.stretched, start: f(150), duration: f(30) } }]).doc;
    let err: unknown;
    try { planRecipe(withUntimed, 'tidy-speech', { assetId: s.vid, loudness: null, captions: false }, { silences: { [s.vid]: [{ start: T.rt(13, 5), end: T.rt(3, 1) }] } }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RecipeError);
    expect((err as RecipeError).code).toBe('untimed_copy');
    expect((err as RecipeError).hint).toBeTruthy();
  });

  it('split_at_scenes on a clip of the enhanced copy uses the recording\'s scene cuts, moved exactly onto the copy\'s clock', () => {
    const s = setup();
    let r = tx(s.doc, [{ op: 'attach_analysis', args: { assetId: s.vid, kind: 'scenes', method: 'fixture', params: {}, createdAt: '2026-11-24T00:00:00Z', times: [T.rt(2, 1), T.rt(9, 2)] } }], true);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: s.ids.enhanced, start: f(30), duration: f(150) } }]); // 1..6 s of the recording at frame 30
    const clip = r.results[0]!.output!.clipId as string;
    const split = tx(r.doc, [{ op: 'split_at_scenes', args: { clipId: clip } }]);
    // cuts at 2 s and 4.5 s of the recording = 1 s and 3.5 s of the copy → frames 60 and 135
    expect((split.results[0]!.output!.cuts as T.RationalTime[]).map((t) => T.frameIndexAt(t, R))).toEqual([60, 135]);
    expect(split.results[0]!.output!.analysedAssetId).toBe(s.vid);
    expect(undoes(r.doc, split.doc)).toBe(true);
    // a reversed rendition has no scene cuts of its own and none it can take: refused as unanalysed, with the way forward
    const rev = tx(r.doc, [{ op: 'add_clip', args: { assetId: s.ids.reversed, start: f(200), duration: f(30), withLinkedAudio: false } }]);
    expect(refusal(() => tx(rev.doc, [{ op: 'split_at_scenes', args: { clipId: rev.results[0]!.output!.clipId as string } }]))).toMatchObject({ code: 'not_found', message: 'this asset has no scene analysis yet' });
  });

  it('the pacing report counts the words of a clip that shows a time-preserving copy, at the same places as the recording\'s', () => {
    const s = setup();
    const onOriginal = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.vid, start: f(0), sourceIn: f(30), duration: f(150), withLinkedAudio: false } }]).doc;
    const onCopy = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.ids.voice, start: f(0), sourceIn: f(15), duration: f(150) } }]).doc;
    const a = pacingReport(onOriginal), b = pacingReport(onCopy);
    expect(a.totals.words).toBe(4);
    expect(b.windows.map((w) => w.words)).toEqual(a.windows.map((w) => w.words));
    expect(b.totals).toEqual(a.totals);
  });
});
