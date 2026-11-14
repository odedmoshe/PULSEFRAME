import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, diffEntities, migrateProject, OpError, restoreEntities, sequenceDuration, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seedN = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `c${seedN++}_`, actor: 'test', allowInternal });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `non-op:${e}`; } return 'ok'; };
const asset = {
  kind: 'video' as const, name: 'talk.mp4', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-14T00:00:00Z', importedBy: 'test' },
};
/** 10 s clip; one word per second: w0 at [0.2,0.7), w1 at [1.2,1.7) ... */
function talk() {
  let r = tx(createProject({ id: 'prj_c', name: 'C' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  const words = Array.from({ length: 10 }, (_, i) => ({ text: `w${i}`, start: T.rt(i * 1000 + 200, 1000), duration: T.rt(500, 1000) }));
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId, start: f(0) } },
    { op: 'set_transcript', args: { assetId, language: 'en', segments: [{ start: T.rt(0, 1), duration: T.rt(5, 1), text: 'w0 w1 w2 w3 w4', words: words.slice(0, 5) }, { start: T.rt(5, 1), duration: T.rt(5, 1), text: 'w5 w6 w7 w8 w9', words: words.slice(5) }] } },
    { op: 'add_caption_track', args: { mode: 'transcript' } },
  ]);
  const wordIds = (r.results[1]!.output!.wordIds as string[][]).flat();
  return { doc: r.doc, assetId, wordIds };
}
const media = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips.filter((c) => c.type === 'media').map((c) => ({ kind: t.kind, ...c })));

describe('captions and transcripts', () => {
  it('schema: transcript and caption track validate, migrate and round-trip; old documents gain transcripts', () => {
    const { doc } = talk();
    expect(validateProject(doc)).toEqual([]);
    expect(migrateProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const old = JSON.parse(JSON.stringify(createProject({ id: 'p', name: 'p' })));
    delete old.transcripts;
    expect(migrateProject(old).transcripts).toEqual({});
  });
  it('transcript is one undoable entity', () => {
    const { doc, assetId } = talk();
    const seg = doc.transcripts[assetId]!.segments[0]!;
    const r = tx(doc, [{ op: 'correct_transcript', args: { assetId, segmentId: seg.id, text: 'a b c d e' } }]);
    const diff = diffEntities(doc, r.doc);
    expect(diff.map((d) => d.id)).toEqual([`transcript:${assetId}`]);
    const back = structuredClone(r.doc);
    restoreEntities(back, diff.map((d) => ({ id: d.id, state: d.before })));
    expect(back).toEqual(doc);
  });
  it('correct_transcript keeps word times when the count matches and marks estimates otherwise', () => {
    const { doc, assetId } = talk();
    const seg = doc.transcripts[assetId]!.segments[0]!;
    const same = tx(doc, [{ op: 'correct_transcript', args: { assetId, segmentId: seg.id, text: 'שלום b c d e' } }]).doc.transcripts[assetId]!.segments[0]!;
    expect(same.timing).toBe('word');
    expect(same.original).toBe('w0 w1 w2 w3 w4');
    expect(same.words.map((w) => w.start)).toEqual(seg.words.map((w) => w.start));
    const r2 = tx(doc, [{ op: 'correct_transcript', args: { assetId, segmentId: seg.id, text: 'only three words' } }]);
    const changed = r2.doc.transcripts[assetId]!.segments[0]!;
    expect(changed.timing).toBe('approximate');
    expect(changed.words).toHaveLength(3);
    expect(validateProject(r2.doc)).toEqual([]);
    // estimated word times must not drive a precise cut
    expect(code(() => tx(r2.doc, [{ op: 'delete_transcript_range', args: { assetId, fromWordId: changed.words[0]!.id, toWordId: changed.words[1]!.id } }]))).toBe('incompatible');
  });
  it('delete_transcript_range cuts picture and sound together at the word times and closes the gap', () => {
    const { doc, assetId, wordIds } = talk();
    // remove w2..w3 = source [2.2, 3.7) -> frames 66..111
    const r = tx(doc, [{ op: 'delete_transcript_range', args: { assetId, fromWordId: wordIds[2], toWordId: wordIds[3] } }]);
    expect(validateProject(r.doc)).toEqual([]);
    expect(r.results[0]!.output!.ranges).toEqual([{ start: f(66), end: f(111) }]);
    const clips = media(r.doc);
    for (const kind of ['video', 'audio']) {
      const cs = clips.filter((c) => c.kind === kind);
      expect(cs.map((c) => [c.start, c.duration, (c as any).sourceIn])).toEqual([[f(0), f(66), f(0)], [f(66), f(300 - 111), f(111)]]);
    }
    // the right halves are linked to each other, not to the left halves
    const [vl, vr] = clips.filter((c) => c.kind === 'video') as any[];
    const [al, ar] = clips.filter((c) => c.kind === 'audio') as any[];
    expect(vl.linkGroupId).toBe(al.linkGroupId);
    expect(vr.linkGroupId).toBe(ar.linkGroupId);
    expect(vr.linkGroupId).not.toBe(vl.linkGroupId);
    expect(T.eq(sequenceDuration(r.doc), f(300 - 45))).toBe(true);
    // deleting the same words again finds nothing on the timeline
    expect(code(() => tx(r.doc, [{ op: 'delete_transcript_range', args: { assetId, fromWordId: wordIds[2], toWordId: wordIds[3] } }]))).toBe('not_found');
  });
  it('cut_range: locked track fails instead of drifting; ripple=false leaves a gap; keyframes stay on content', () => {
    const { doc } = talk();
    const seq = doc.sequences[doc.mainSequenceId]!;
    const locked = structuredClone(doc);
    locked.sequences[locked.mainSequenceId]!.tracks.find((t) => t.kind === 'audio')!.locked = true;
    expect(code(() => tx(locked, [{ op: 'cut_range', args: { start: f(30), end: f(60) } }]))).toBe('track_locked');
    expect(code(() => tx(doc, [{ op: 'cut_range', args: { start: T.rt(1, 7), end: f(60) } }]))).toBe('invalid_args');
    const gap = tx(doc, [{ op: 'cut_range', args: { start: f(30), end: f(60), ripple: false } }]).doc;
    expect(media(gap).filter((c) => c.kind === 'video').map((c) => c.start)).toEqual([f(0), f(60)]);
    const vid = seq.tracks.find((t) => t.kind === 'video')!.clips[0]!;
    const keyed = tx(doc, [{ op: 'set_keyframe', args: { clipId: vid.id, property: 'opacity', time: f(90), value: 0.5 } }, { op: 'cut_range', args: { start: f(30), end: f(60) } }]).doc;
    const right = media(keyed).filter((c) => c.kind === 'video')[1]!;
    // key was at clip-local frame 90 (source frame 90); the right half starts at source frame 60, so the key is 30 frames in
    expect(right.keyframes!.opacity![0]!.time).toEqual(f(30));
  });
  it('property: any sequence of ripple cuts keeps the document valid and every remaining frame mapped to its original source frame', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 280 }), fc.integer({ min: 1, max: 40 })), { minLength: 1, maxLength: 6 }), (cuts) => {
      let { doc } = talk();
      // model: list of surviving source frames
      let model = Array.from({ length: 300 }, (_, i) => i);
      for (const [s, n] of cuts) {
        if (s >= model.length) continue;
        const e = Math.min(model.length, s + n);
        doc = tx(doc, [{ op: 'cut_range', args: { start: f(s), end: f(e) } }]).doc;
        model = [...model.slice(0, s), ...model.slice(e)];
        expect(validateProject(doc)).toEqual([]);
      }
      for (const kind of ['video', 'audio']) {
        const got: number[] = [];
        for (const c of media(doc).filter((x) => x.kind === kind)) {
          const s0 = T.frameIndexAt(c.start, R), n = T.frameIndexAt(c.duration, R), src = T.frameIndexAt((c as any).sourceIn, R);
          for (let i = 0; i < n; i++) got[s0 + i] = src + i;
        }
        expect(got).toEqual(model);
      }
    }), { numRuns: 60 });
  });
  it('manual cues: add, overlap rejection, merge, import SRT with frame snapping, track-kind rules', () => {
    const { doc } = talk();
    const a = tx(doc, [{ op: 'add_cue', args: { start: f(0), duration: f(30), text: 'שלום עולם' } }, { op: 'add_cue', args: { start: f(30), duration: f(30), text: 'second' } }]);
    const trackId = a.results[0]!.output!.trackId as string;
    expect(a.results[1]!.output!.trackId).toBe(trackId); // reuses the manual track, not the transcript one
    expect(code(() => tx(a.doc, [{ op: 'add_cue', args: { trackId, start: f(15), duration: f(30), text: 'x' } }]))).toBe('overlap');
    const m = tx(a.doc, [{ op: 'merge_cues', args: { clipId: a.results[0]!.output!.clipId } }]).doc;
    const cues = m.sequences[m.mainSequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ text: 'שלום עולם second', start: f(0), duration: f(60) });
    const transcriptTrack = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'caption')!.id;
    expect(code(() => tx(doc, [{ op: 'add_cue', args: { trackId: transcriptTrack, start: f(0), duration: f(30), text: 'x' } }]))).toBe('incompatible');
    const srt = '1\n00:00:01,010 --> 00:00:02,490\nשלום\n\n2\n00:00:03,000 --> 00:00:04,000\nHello 123\n';
    const imp = tx(doc, [{ op: 'import_captions', args: { content: srt } }]);
    const out = imp.results[0]!.output!;
    expect(out.format).toBe('srt');
    expect(out.maxShiftSeconds as number).toBeLessThanOrEqual(1 / 60 + 1e-9);
    const impCues = imp.doc.sequences[imp.doc.mainSequenceId]!.tracks.find((t) => t.id === out.trackId)!.clips;
    expect(impCues.map((c) => [c.start, c.duration])).toEqual([[f(30), f(45)], [f(90), f(30)]]);
    expect(validateProject(imp.doc)).toEqual([]);
    expect(code(() => tx(doc, [{ op: 'import_captions', args: { content: 'not subtitles' } }]))).toBe('invalid_args');
  });
  it('import_transcript gives phrase timing only, and refuses assets without audio', () => {
    const { doc, assetId } = talk();
    const r = tx(doc, [{ op: 'import_transcript', args: { assetId, language: 'he', content: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nשלום לכולם\n' } }]);
    expect(r.doc.transcripts[assetId]!.segments[0]).toMatchObject({ timing: 'segment', words: [], text: 'שלום לכולם' });
    expect(code(() => tx(doc, [{ op: 'set_transcript', args: { assetId: 'ast_missing', language: 'en', segments: [{ start: f(0), duration: f(30), text: 'x' }] } }]))).toBe('not_found');
    expect(code(() => tx(doc, [{ op: 'set_transcript', args: { assetId, language: 'en', origin: 'asr', segments: [{ start: f(0), duration: f(30), text: 'x' }] } }]))).toBe('invalid_args');
  });
});
