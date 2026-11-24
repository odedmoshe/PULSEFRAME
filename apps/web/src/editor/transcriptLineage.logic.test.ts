/**
 * The transcript and filler panels find the transcript of a clip that shows a derived copy through core transcriptFor, and place its
 * words through every clip that plays the recording on a known clock. Derived assets are hand-built fixtures (no provider ran).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { recordingAt, recordingToTimeline, skippedNotes, speechClipsOf, transcriptOfSelection } from './transcriptLineage.logic.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `wl${n++}_`, actor: 'test', allowInternal });
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test' };
const talk = { kind: 'video' as const, name: 'talk.mp4', contentHash: hash('1'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const derived = (src: string, extra: Record<string, unknown>) => ({ origin: 'derived' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_fixture', capabilityId: 'local.audio.voice-clean', capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, ...extra } });

function setup() {
  let r = tx(createProject({ id: 'prj_wl', name: 'WL' }), [{ op: 'import_asset', args: { asset: talk } }], true);
  const vid = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [
    { op: 'import_asset', args: { asset: { kind: 'audio', name: 'clean.wav', contentHash: hash('2'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(7, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: derived(vid, { sourceRangeStart: T.rt(1, 2), audio: 'processed' }) } } },
    { op: 'import_asset', args: { asset: { ...talk, name: 'reversed.mp4', contentHash: hash('3'), provenance: derived(vid, {}) } } },
  ], true);
  const [clean, rev] = r.results.map((x) => x.output!.assetId as string) as [string, string];
  r = tx(r.doc, [
    { op: 'set_transcript', args: { assetId: vid, language: 'he', segments: [{ start: T.rt(2, 1), duration: T.rt(1, 2), text: 'שלום', words: [{ start: T.rt(2, 1), duration: T.rt(1, 2), text: 'שלום' }] }] } },
    { op: 'add_clip', args: { assetId: clean, start: f(0), duration: f(150) } }, // 0.5..5.5 s of the recording
    { op: 'add_clip', args: { assetId: rev, start: f(150), duration: f(30), withLinkedAudio: false } },
  ]);
  return { doc: r.doc, vid, clean, rev, cleanClip: r.results[1]!.output!.clipId as string, revClip: r.results[2]!.output!.clipId as string };
}

describe('the transcript of a clip that shows a derived copy', () => {
  it('selecting the clip of the cleaned voice shows the recording\'s transcript; an untimed copy and an unrelated file have none', () => {
    const s = setup();
    expect(transcriptOfSelection(s.doc, s.clean)).toMatchObject({ assetId: s.vid, transcript: { assetId: s.vid } });
    expect(transcriptOfSelection(s.doc, s.vid)?.assetId).toBe(s.vid);
    expect(transcriptOfSelection(s.doc, null)?.assetId).toBe(s.vid);
    expect(transcriptOfSelection(s.doc, s.rev)).toBeNull();
    expect(transcriptOfSelection(s.doc, 'ast_missing')).toBeNull();
    expect(transcriptOfSelection(createProject({ id: 'prj_e', name: 'E' }), null)).toBeNull();
  });
  it('the words are placed through the copy\'s clip on its own clock, exactly; the reversed rendition places nothing', () => {
    const s = setup();
    const clips = speechClipsOf(s.doc, s.vid);
    expect(clips.map((c) => c.clip.id)).toEqual([s.cleanClip]);
    // "שלום" at 2.0 s of the recording = 1.5 s of the copy = timeline 1.5 s (frame 45)
    expect(T.eq(recordingToTimeline(clips, T.rt(2, 1))!, f(45))).toBe(true);
    expect(recordingToTimeline(clips, T.rt(6, 1))).toBeNull(); // past the copy's clip
    expect(T.eq(recordingAt(clips, f(45))!, T.rt(2, 1))).toBe(true);
    expect(recordingAt(clips, f(160))).toBeNull(); // the reversed rendition plays there
  });
  it('a skipped clip becomes one note per file, with its name, in both languages', () => {
    const s = setup();
    const skipped = [{ clipId: s.revClip, assetId: s.rev }, { clipId: 'clp_sound', assetId: s.rev }];
    expect(skippedNotes(s.doc, skipped, dictionaries.he['transcript.untimedSkipped'])).toEqual(['הקליפ reversed.mp4 לא נחתך לפי ההקלטה: הוא מציג עותק שלא שומר על התזמון שלה']);
    expect(skippedNotes(s.doc, skipped, dictionaries.en['transcript.untimedSkipped'])).toEqual(['Clip reversed.mp4 was not cut by the recording\'s times: it shows a copy that does not keep its timing']);
    expect(skippedNotes(s.doc, undefined, dictionaries.en['transcript.untimedSkipped'])).toEqual([]);
  });
});
