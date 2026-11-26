/**
 * ADR-0017 time lineage in the engine: a clip given a derived copy of its file (replace_clip_asset) keeps its captions and its
 * ducking, because the copy speaks its source's transcript. Derived assets are hand-built fixtures (labelled: no provider ran).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { captionAt, captionCues } from './captions.ts';
import { speechRanges } from './audio.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `cl${n++}_`, actor: 'test', allowInternal });
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'talk.mp4', contentHash: hash('1'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const copyOf = (src: string, c: string, start: number, seconds: number, extra: Record<string, unknown> = {}, rate = R) => ({
  ...video, name: 'copy.mp4', contentHash: hash(c), duration: T.rt(seconds, 1), video: { ...video.video, frameRate: rate, frameCount: (seconds * rate.num) / rate.den },
  provenance: { origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_fixture', capabilityId: 'comfy.video.enhance', capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'video', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, sourceRangeStart: T.rt(start, 1), audio: 'source-copied' as const, ...extra } },
});

function project() {
  let r = tx(createProject({ id: 'prj_cl', name: 'CL', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset: video } }], true);
  const vid = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [
    { op: 'set_transcript', args: { assetId: vid, language: 'he', segments: [
      { start: T.rt(1, 1), duration: T.rt(2, 1), text: 'שלום לכולם', words: [{ start: T.rt(1, 1), duration: T.rt(1, 1), text: 'שלום' }, { start: T.rt(2, 1), duration: T.rt(1, 1), text: 'לכולם' }] },
      { start: T.rt(3, 1), duration: T.rt(2, 1), text: 'ותודה רבה' },
    ] } },
    { op: 'add_clip', args: { assetId: vid, start: f(0), sourceIn: f(45), duration: f(90) } }, // plays 1.5 s..4.5 s of the source
    { op: 'add_caption_track', args: { mode: 'transcript' } },
    { op: 'add_track', args: { kind: 'audio' } },
  ]);
  const clip = r.results[1]!.output!.clipId as string, sound = r.results[1]!.output!.audioClipId as string;
  return { doc: r.doc, vid, clip, sound };
}
const seqOf = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!;
const captionTrack = (d: ProjectDocument) => seqOf(d).tracks.find((t) => t.kind === 'caption')!;
const cues = (d: ProjectDocument) => captionCues(d, seqOf(d), captionTrack(d)).map((c) => ({ start: T.frameIndexAt(c.start, R), end: T.frameIndexAt(c.end, R), text: c.text }));
const shown = (d: ProjectDocument, frames: number[]) => frames.map((i) => captionAt(d, seqOf(d), captionTrack(d), f(i))?.words.map((w) => `${w.text}:${w.state}`).join(' ') ?? null);
const speech = (d: ProjectDocument) => { const a = seqOf(d).tracks.find((t) => t.kind === 'audio')!; return speechRanges(d, seqOf(d), [a.id]); };

describe('captions and ducking follow a clip onto a derived copy of its file', () => {
  it('an enhanced copy (identity frames, starting 1 s into the source) shows the same captions, word states and speech ranges', () => {
    const s = project();
    const before = { cues: cues(s.doc), shown: shown(s.doc, [0, 10, 20, 40, 60, 89]), speech: speech(s.doc) };
    expect(before.cues.length).toBeGreaterThan(0);
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: copyOf(s.vid, '2', 1, 5) } }], true);
    const copy = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId: s.clip, assetId: copy } }, { op: 'replace_clip_asset', args: { clipId: s.sound, assetId: copy } }]);
    expect({ cues: cues(r.doc), shown: shown(r.doc, [0, 10, 20, 40, 60, 89]), speech: speech(r.doc) }).toEqual(before);
  });
  it('smooth slow motion: the interpolated copy at four times the rate, slowed to 1/4, captions exactly like the original slowed to 1/4', () => {
    const s = project();
    const slowedOriginal = tx(s.doc, [{ op: 'set_clip_speed', args: { clipId: s.clip, speed: 0.25 } }]).doc;
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: copyOf(s.vid, '3', 1, 4, { frames: { sourceStartFrame: 45, sourceFrameCount: 90, sourceRate: R, outputRate: { num: 120, den: 1 }, mapping: 'interpolated', multiplier: 4, heldFrames: [357, 358, 359] } }, { num: 120, den: 1 }) } }], true);
    const copy = r.results[0]!.output!.assetId as string;
    // the copy covers 1 s..5 s; replace both clips, then slow them as the capability's placement does
    r = tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId: s.clip, assetId: copy } }, { op: 'replace_clip_asset', args: { clipId: s.sound, assetId: copy } }, { op: 'set_clip_speed', args: { clipId: s.clip, speed: 0.25 } }]);
    expect(cues(r.doc)).toEqual(cues(slowedOriginal));
    expect(shown(r.doc, [0, 50, 120, 200, 300, 359])).toEqual(shown(slowedOriginal, [0, 50, 120, 200, 300, 359]));
    expect(speech(r.doc)).toEqual(speech(slowedOriginal));
  });
  it('a copy that does not keep the timing has no captions of its own (nothing is guessed)', () => {
    const s = project();
    const untimed = copyOf(s.vid, '4', 0, 8);
    delete (untimed.provenance.derived as { sourceRangeStart?: unknown }).sourceRangeStart;
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: untimed } }], true);
    const copy = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: copy, start: f(120), duration: f(30), withLinkedAudio: false } }]);
    expect(shown(r.doc, [130])).toEqual([null]);
  });
});
