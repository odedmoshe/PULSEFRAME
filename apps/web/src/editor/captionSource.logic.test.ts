import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, type CaptionLayer } from '@pulseframe/engine';
import { captionSource, firstCaptionTrack, laneCues, showTranscriptOps, transcriptNotShown } from './captionSource.logic.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `cs${n++}_`, actor: 'test', allowInternal }).doc;
const asset = {
  kind: 'video' as const, name: 'trip.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 1080, height: 1920, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' },
};
const W = ['שלום', 'לכולם', 'זה', 'הטיול', 'שלנו', 'לים', 'המלח', 'היום'];
const word = (k: number) => ({ text: W[k]!, start: T.rt(k * 1000, 1000), duration: T.rt(700, 1000) });
const transcript = (assetId: string): OpCall => ({ op: 'set_transcript', args: { assetId, language: 'he', segments: [
  { start: T.rt(0, 1), duration: T.rt(4, 1), text: W.slice(0, 4).join(' '), words: [0, 1, 2, 3].map(word) },
  { start: T.rt(4, 1), duration: T.rt(4, 1), text: W.slice(4).join(' '), words: [4, 5, 6, 7].map(word) },
] } });
/** A portrait project with one clip with its own sound (V1 + A1). */
function project() {
  const r = applyTransaction(createProject({ id: 'prj_cs', name: 'cs', width: 1080, height: 1920, frameRate: R }), [{ op: 'import_asset', args: { asset } }], { idSeed: 'cs_a_', actor: 'test', allowInternal: true });
  const assetId = r.results[0]!.output!.assetId as string;
  return { doc: tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]), assetId };
}
const capAt = (d: ProjectDocument, frame: number) => evaluate(d, f(frame)).layers.find((l) => l.kind === 'caption') as CaptionLayer | undefined;
const seq = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!;

describe('caption source (owner report 2026-11-26)', () => {
  it('order A: a caption track made before the transcript is manual and empty; a look styles it and nothing is shown', () => {
    const { doc, assetId } = project();
    let d = tx(doc, [{ op: 'add_caption_track', args: { mode: 'manual' } }]); // what «הוספת רצועת כתוביות» commits with no transcript
    expect(captionSource(d).kind).toBe('manual');
    d = tx(d, [transcript(assetId)]);
    const tid = firstCaptionTrack(d)!.id;
    d = tx(d, [{ op: 'apply_caption_look', args: { trackId: tid, lookId: 'caption.outline-only' } }]);
    expect(capAt(d, 45)).toBeUndefined();
    expect(captionSource(d)).toEqual({ kind: 'unlinked', trackId: tid, locked: false });
    expect(transcriptNotShown(d)).toBe(true);
  });
  it('the repair is one commit that keeps the name and the look, and the caption is then in the frame', () => {
    const { doc, assetId } = project();
    let d = tx(doc, [{ op: 'add_caption_track', args: { mode: 'manual' } }, transcript(assetId)]);
    d = tx(d, [{ op: 'apply_caption_look', args: { trackId: firstCaptionTrack(d)!.id, lookId: 'caption.outline-only' } }]);
    const style = firstCaptionTrack(d)!.caption!.style;
    const ops = showTranscriptOps(d)!;
    expect(ops.map((o) => o.op)).toEqual(['remove_track', 'add_caption_track']);
    const r = applyTransaction(d, ops, { idSeed: 'cs_fix_', actor: 'test' });
    const t = firstCaptionTrack(r.doc)!;
    expect(seq(r.doc).tracks.filter((x) => x.kind === 'caption')).toHaveLength(1);
    expect(t.name).toBe('C1');
    expect(t.caption).toEqual({ mode: 'transcript', linkedTrackId: null, style });
    expect(capAt(r.doc, 45)?.words.map((w) => w.text)).toEqual(['שלום', 'לכולם', 'זה', 'הטיול']);
    expect(captionSource(r.doc).kind).toBe('transcript');
    expect(transcriptNotShown(r.doc)).toBe(false);
    expect(showTranscriptOps(r.doc)).toBeNull();
  });
  it('never replaces a manual track that has cues, nor a locked one', () => {
    const { doc, assetId } = project();
    let d = tx(doc, [{ op: 'add_caption_track', args: { mode: 'manual' } }, transcript(assetId)]);
    const tid = firstCaptionTrack(d)!.id;
    const withCue = tx(d, [{ op: 'add_cue', args: { trackId: tid, start: f(0), duration: f(30), text: 'כתובית ביד' } }]);
    expect(captionSource(withCue)).toEqual({ kind: 'manual', trackId: tid, cues: 1 });
    expect(showTranscriptOps(withCue)).toBeNull();
    expect(transcriptNotShown(withCue)).toBe(false);
    d = tx(d, [{ op: 'update_track', args: { trackId: tid, locked: true } }]);
    expect(captionSource(d)).toEqual({ kind: 'unlinked', trackId: tid, locked: true });
    expect(showTranscriptOps(d)).toBeNull();
  });
  it('no caption track: one add; a hidden transcript track: shown again; no transcript: nothing to do', () => {
    const { doc, assetId } = project();
    expect(showTranscriptOps(doc)).toBeNull();
    expect(transcriptNotShown(doc)).toBe(false);
    expect(captionSource(tx(doc, [{ op: 'add_caption_track', args: { mode: 'manual' } }])).kind).toBe('manual'); // empty, no transcript: not "unlinked"
    let d = tx(doc, [transcript(assetId)]);
    expect(showTranscriptOps(d)).toEqual([{ op: 'add_caption_track', args: { mode: 'transcript' } }]);
    d = tx(d, showTranscriptOps(d)!);
    expect(capAt(d, 45)).toBeDefined();
    const tid = firstCaptionTrack(d)!.id;
    d = tx(d, [{ op: 'update_track', args: { trackId: tid, hidden: true } }]);
    expect(capAt(d, 45)).toBeUndefined();
    expect(transcriptNotShown(d)).toBe(true);
    d = tx(d, showTranscriptOps(d)!);
    expect(capAt(d, 45)).toBeDefined();
  });
  it('lane: a transcript track with no linked track shows the phrases where they play (it used to show nothing), once though the clip is on V1 and A1', () => {
    const { doc, assetId } = project();
    const d = tx(doc, [transcript(assetId), { op: 'add_caption_track', args: { mode: 'transcript' } }]);
    const cues = laneCues(d, seq(d), firstCaptionTrack(d)!, R);
    expect(cues.map((c) => [c.start, c.end, c.frame, c.text])).toEqual([[0, 4, 0, 'שלום לכולם זה הטיול'], [4, 8, 120, 'שלנו לים המלח היום']]);
  });
  it('lane: a linked transcript track still shows its phrases; a manual track gets none here', () => {
    const { doc, assetId } = project();
    const v1 = seq(doc).tracks.find((t) => t.kind === 'video')!.id;
    const d = tx(doc, [transcript(assetId), { op: 'add_caption_track', args: { mode: 'transcript', linkedTrackId: v1 } }, { op: 'add_caption_track', args: { mode: 'manual' } }]);
    const [linked, manual] = seq(d).tracks.filter((t) => t.kind === 'caption');
    expect(laneCues(d, seq(d), linked!, R).map((c) => c.text)).toEqual(['שלום לכולם זה הטיול', 'שלנו לים המלח היום']);
    expect(laneCues(d, seq(d), manual!, R)).toEqual([]);
  });
});

describe('caption source words', () => {
  it('every new word is in Hebrew and English, and the Hebrew asks in the plural', async () => {
    const { CAP_STRINGS } = await import('./captions.strings.ts');
    expect(Object.keys(CAP_STRINGS.he).sort()).toEqual(Object.keys(CAP_STRINGS.en).sort());
    expect(CAP_STRINGS.he.sourceManual(3)).toBe('מקור: כתוביות שנכתבו ביד (3)');
    expect(CAP_STRINGS.he.locked).toMatch(/פתחו .* ולחצו/);
    for (const k of ['unlinked', 'hidden', 'locked', 'showTranscript', 'showOnVideo', 'showHidden', 'sourceTranscript'] as const) expect(CAP_STRINGS.en[k]).toMatch(/[a-z]/i);
  });
});
