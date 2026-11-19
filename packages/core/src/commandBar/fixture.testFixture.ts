/**
 * The command bar's test project (tests only; plan §9 fixture): at 30 fps, V1 holds three video clips with handles, one whose
 * previous clip has none (c4: c3 uses its whole file), and an image; b.mp4 has sound, so c2 has a linked audio clip; A2 holds
 * music with a beat analysis; T1 holds a title. The playhead is at frame 120 (inside c2) and c2 is selected.
 */
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type BarContext, type IntentId, type OpCall, type ProjectDocument } from '../index.ts';

export const R30 = { num: 30, den: 1 };
/** A fixture transaction; `seed` names its ids, so every fixture builds the same ids whatever ran before it. */
export const tx = (doc: ProjectDocument, ops: OpCall[], seed: string, allowInternal = false) => applyTransaction(doc, ops, { idSeed: seed, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const video = (name: string, hash: string, seconds: number, audio = false, rate = R30) => ({
  kind: 'video' as const, name, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1),
  video: { width: 1920, height: 1080, frameRate: rate, codec: 'h264', rotation: 0, frameCount: Math.ceil((seconds * rate.num) / rate.den) }, ...(audio ? { audio: { sampleRate: 48000, channels: 2, codec: 'aac' } } : {}), provenance,
});
const image = { kind: 'image' as const, name: 'cake.jpg', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'jpeg', mimeType: 'image/jpeg', duration: T.rt(0, 1), video: { width: 1000, height: 1000, frameRate: R30, codec: 'mjpeg', rotation: 0, frameCount: 1 }, provenance };
const music = { kind: 'audio' as const, name: 'song.mp3', contentHash: `sha256:${'f'.repeat(64)}`, byteSize: 1, container: 'mp3', mimeType: 'audio/mpeg', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 2, codec: 'mp3' }, provenance };

export interface Fixture { doc: ProjectDocument; c1: string; c2: string; c2a: string; c3: string; c4: string; c5: string; song: string; title: string; videoTrack: string; musicTrack: string; textTrack: string }

export function fixture(rate: T.Rate = R30, opts: { music?: boolean } = {}): Fixture {
  const f = (n: number) => T.frameTime(n, rate);
  let r = tx(createProject({ id: 'prj_bar', name: 'Bar', width: 1920, height: 1080, frameRate: rate }), [
    { op: 'import_asset', args: { asset: video('a.mp4', 'a', 20, false, rate) } }, { op: 'import_asset', args: { asset: video('b.mp4', 'b', 20, true, rate) } },
    { op: 'import_asset', args: { asset: video('c.mp4', 'c', 3, false, rate) } }, { op: 'import_asset', args: { asset: { ...image, video: { ...image.video, frameRate: rate } } } }, { op: 'import_asset', args: { asset: music } },
  ], 'fx0_', true);
  const [a, b, c, img, m] = r.results.map((x) => x.output!.assetId as string);
  const n = (s: number) => T.nearestFrameIndex(T.rt(s, 1), rate); // whole frames of s seconds
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: a, trackId: 'trk_video', start: f(0), sourceIn: f(n(1)), duration: f(n(3)) } },
    { op: 'add_clip', args: { assetId: b, trackId: 'trk_video', start: f(n(3)), sourceIn: f(n(1)), duration: f(n(3)) } },
    { op: 'add_clip', args: { assetId: c, trackId: 'trk_video', start: f(n(6)), sourceIn: f(0), duration: f(T.frameIndexAt(T.rt(3, 1), rate)) } },
    { op: 'add_clip', args: { assetId: a, trackId: 'trk_video', start: f(n(6) + T.frameIndexAt(T.rt(3, 1), rate)), sourceIn: f(n(5)), duration: f(n(3)) } },
  ], 'fx1_');
  const ids = r.results.map((x) => x.output!.clipId as string);
  const c2a = (r.results[1]!.output!.audioClipId as string | undefined) ?? '';
  const c4end = n(6) + T.frameIndexAt(T.rt(3, 1), rate) + n(3);
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: img, trackId: 'trk_video', start: f(c4end), duration: f(n(3)) } },
    { op: 'add_track', args: { kind: 'audio', name: 'Music' } },
    { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(n(2)), trackId: 'trk_text' } },
  ], 'fx2_');
  const c5 = r.results[0]!.output!.clipId as string;
  const musicTrack = r.results[1]!.output!.trackId as string;
  const title = r.results[2]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: m, trackId: musicTrack, start: f(0), duration: f(c4end + n(3)) } }], 'fx3_');
  const song = r.results[0]!.output!.clipId as string;
  const doc = r.doc;
  if (opts.music !== false) {
    const beats = Array.from({ length: 60 }, (_, k) => T.rt(k, 2));
    doc.analyses[m!] = { assetId: m!, beats: { origin: { method: 'fixture', params: {}, createdAt: '2026-11-18T00:00:00Z', createdBy: 'test', edited: false }, bpm: 120, confidence: 1, beats } } as ProjectDocument['analyses'][string];
  }
  return { doc, c1: ids[0]!, c2: ids[1]!, c2a, c3: ids[2]!, c4: ids[3]!, c5, song, title, videoTrack: 'trk_video', musicTrack, textTrack: 'trk_text' };
}

/** A context on the fixture (main sequence active, so inject changes nothing). */
export function context(doc: ProjectDocument, over: Partial<BarContext> = {}): BarContext {
  return {
    doc, rawDoc: doc, activeSequenceId: doc.mainSequenceId, revision: 7, selection: [], playheadFrame: 120, cutClipId: null, workspace: 'pro', performRecording: false,
    viewVariantId: null, lang: 'he', undoTarget: { transactionId: 'tx_last', ops: ['split_clip'] }, redoTarget: null, inject: (c) => c, ...over,
  };
}

/** Variants of the fixture for the intents that need a different project (all at 30 fps). */
export const variants = {
  /** c5 moved to 600, so c4 has room to slow down and a stretch of empty time [450, 600) is left on every track but music. */
  roomy(fx: Fixture): ProjectDocument {
    return tx(fx.doc, [{ op: 'move_clip', args: { clipId: fx.c5, start: T.frameTime(600, R30) } }], 'vr_').doc;
  },
  /** Empty time on every track: c5 moved to 480 and nothing else there (the song ends at 450). */
  gap(fx: Fixture): ProjectDocument {
    return tx(fx.doc, [{ op: 'move_clip', args: { clipId: fx.c5, start: T.frameTime(480, R30) } }], 'vg_').doc;
  },
  mutedMusic(fx: Fixture): ProjectDocument {
    return tx(fx.doc, [{ op: 'set_track_audio', args: { trackId: fx.musicTrack, muted: true } }], 'vm_').doc;
  },
  emptyTrack(fx: Fixture): ProjectDocument {
    return tx(fx.doc, [{ op: 'add_track', args: { kind: 'video', name: 'V2' } }], 've_').doc;
  },
  /** A second audio track holding the same song (so two tracks are music). */
  twoMusic(fx: Fixture): ProjectDocument {
    const song = fx.doc.sequences.seq_main!.tracks.find((t) => t.id === fx.musicTrack)!.clips[0]! as { assetId: string };
    const r = tx(fx.doc, [{ op: 'add_track', args: { kind: 'audio', name: 'Music 2' } }], 'v2_');
    return tx(r.doc, [{ op: 'add_clip', args: { assetId: song.assetId, trackId: r.results[0]!.output!.trackId as string, start: T.frameTime(0, R30), duration: T.frameTime(90, R30) } }], 'v2b_').doc;
  },
  lockedTrack(doc: ProjectDocument, trackId: string): ProjectDocument {
    return tx(doc, [{ op: 'update_track', args: { trackId, locked: true } }], 'vl_').doc;
  },
};

let shared: Fixture | null = null;
const defaultFixture = () => (shared ??= fixture());
/** The project and editor state each intent's examples are read in (the base: c2 selected, playhead at 120). */
export function ctxFor(intent: IntentId, f: Fixture = defaultFixture()): BarContext {
  const base = { selection: [f.c2] };
  switch (intent) {
    case 'unmute': return context(variants.mutedMusic(f), base);
    case 'close_gaps': return context(variants.gap(f), base);
    case 'speed': return context(variants.roomy(f), { selection: [f.c4], playheadFrame: 300 });
    case 'remove_empty_tracks': return context(variants.emptyTrack(f), base);
    case 'redo': return context(f.doc, { ...base, redoTarget: { transactionId: 'tx_undone', ops: ['split_clip'] } });
    case 'sync_beat': return context(f.doc, { ...base, cutClipId: f.c2 });
    default: return context(f.doc, base);
  }
}

