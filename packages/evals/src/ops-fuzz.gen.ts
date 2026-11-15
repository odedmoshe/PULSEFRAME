/**
 * Shared generator for the operations fuzz: a deterministic source of random operation calls for a project,
 * used by the core-level fuzz (ops-fuzz.test.ts) and the store-level fuzz (store-fuzz.test.ts).
 */
import * as T from '@pulseframe/time';
import { animatableParams, type OpCall, type ProjectDocument } from '@pulseframe/core';

export const RATES = [{ num: 30, den: 1 }, { num: 25, den: 1 }, { num: 24000, den: 1001 }, { num: 30000, den: 1001 }, { num: 60, den: 1 }];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SRC = { num: 30, den: 1 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'fuzz' };
const ASSETS = [
  { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: SRC, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov },
  { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov },
  { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'3'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 800, height: 600, codec: 'png', hasAlpha: false }, provenance: prov },
  { kind: 'video' as const, name: 'late.mkv', contentHash: `sha256:${'4'.repeat(64)}`, byteSize: 1, container: 'matroska', mimeType: 'video/x-matroska', duration: T.frameTime(135, SRC), video: { width: 640, height: 360, frameRate: SRC, codec: 'h264', rotation: 0, frameCount: 120, startTime: T.fromSeconds('0.5'), untaggedColour: true as const }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov },
];

/** `setup(assetIds)` returns the operations that add analysis data and a transcript; `gen(doc)` returns the next random call. */
export function createFuzz(seed: number) {
  const rnd = mulberry32(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <X,>(xs: readonly X[]): X => xs[int(xs.length)]!;
  const rate = RATES[seed % RATES.length]!;
  const f = (n: number) => T.frameTime(n, rate);
  const fr = () => f(int(360));
  const dur = () => f(1 + int(120));
  let assetIds: string[] = [], vid = '', aud = '';
  /** Operations that import the fuzz assets (internal op: needs allowInternal). */
  const importOps: OpCall[] = ASSETS.map((asset) => ({ op: 'import_asset', args: { asset } }));
  /** Call once the assets exist: remembers their ids and returns the analysis/transcript set-up operations. */
  const setup = (doc: ProjectDocument): OpCall[] => {
    assetIds = Object.keys(doc.assets);
    [vid, aud] = assetIds as [string, string];
    return [
      { op: 'edit_analysis', args: { assetId: vid, kind: 'scenes', add: [T.rt(2, 1), T.rt(4, 1), T.rt(13, 2)] } },
      { op: 'edit_analysis', args: { assetId: aud, kind: 'beats', add: Array.from({ length: 12 }, (_, i) => T.rt(1 + i, 2)), bpm: 120 } },
      { op: 'set_transcript', args: { assetId: vid, language: 'he', segments: [0, 1, 2, 3].map((k) => ({ start: T.rt(k * 2, 1), duration: T.rt(2, 1), text: `מילה ${k} word`, words: [{ start: T.rt(k * 2, 1), duration: T.rt(1, 1), text: 'מילה' }, { start: T.rt(k * 2 + 1, 1), duration: T.rt(1, 1), text: `word${k}` }] })) } },
    ];
  };
  const EFFECTS = ['blur.gaussian', 'color.grayscale', 'color.brightness', 'stylize.vignette'];

  const gen = (doc: ProjectDocument): OpCall => {
    const seq = Object.values(doc.sequences)[0]!;
    const tracks = seq.tracks;
    const clips = tracks.flatMap((t) => t.clips.map((c) => ({ c, t })));
    const any = () => (clips.length ? pick(clips).c.id : 'clp_none');
    const media = clips.filter((x) => x.c.type === 'media');
    const mediaId = () => (media.length ? pick(media).c.id : any());
    const audioClips = clips.filter((x) => x.t.kind === 'audio');
    const audioId = () => (audioClips.length ? pick(audioClips).c.id : any());
    const videoClips = clips.filter((x) => x.t.kind === 'video');
    const videoId = () => (videoClips.length ? pick(videoClips).c.id : any());
    const cues = clips.filter((x) => x.c.type === 'caption');
    const cueId = () => (cues.length ? pick(cues).c.id : any());
    const withFx = clips.filter((x) => x.c.effects?.length);
    const markers = Object.keys(doc.markers ?? {});
    const variants = Object.keys(doc.variants ?? {});
    const trackId = () => (tracks.length ? pick(tracks).id : 'trk_none'); // a session may have removed every track
    const audioTracks = tracks.filter((t) => t.kind === 'audio');
    const local = () => f(int(90));
    /** A frame that matters: an edge of or a point inside an existing clip half the time, anywhere otherwise. */
    const at = () => { if (!clips.length || rnd() < 0.4) return fr(); const c = pick(clips).c; const a0 = T.frameIndexAt(c.start, rate), len = Math.max(1, T.frameIndexAt(c.duration, rate)); return f(a0 + pick([0, len, int(len), int(len), int(len)])); };
    /** An existing transform keyframe, when there is one. */
    const keyed = clips.flatMap((x) => Object.entries(x.c.keyframes ?? {}).flatMap(([p, ks]) => (ks ?? []).map((k) => ({ clipId: x.c.id, property: p, time: k.time }))));
    // Situations some operations need, so they are not refused almost every time:
    /** clips that start exactly where another clip on the same track ends (transitions, crossfades) */
    const touching = clips.filter((x) => x.t.clips.some((o) => o.id !== x.c.id && T.eq(T.add(o.start, o.duration), x.c.start)));
    const touchingAudio = touching.filter((x) => x.t.kind === 'audio');
    const touchingVideo = touching.filter((x) => x.t.kind === 'video');
    /** real video clips (not stills, not holds) and clips of the asset that has scene analysis and a transcript */
    const movingVideo = videoClips.filter((x) => x.c.type === 'media' && !x.c.freeze && doc.assets[x.c.assetId]?.kind === 'video');
    const ofVid = movingVideo.filter((x) => x.c.type === 'media' && x.c.assetId === vid);
    const volumeKeyed = audioClips.filter((x) => x.c.type === 'media' && x.c.volume?.length);
    const fxPick = () => { const x = withFx.length ? pick(withFx).c : null; const fx = x?.effects?.length ? pick(x.effects) : undefined; return { clipId: x?.id ?? any(), fx }; };
    const wordList = Object.values(doc.transcripts ?? {}).flatMap((t) => t.segments.flatMap((sg) => (sg.words ?? []).map((w) => w.id)));
    const words = Object.values(doc.transcripts ?? {}).flatMap((t) => t.segments.flatMap((s) => (s.words ?? []).map((w) => w.id)));
    const menu: (() => OpCall)[] = [
      () => ({ op: 'add_clip', args: { assetId: pick(assetIds), start: fr(), ...(rnd() < 0.5 ? { duration: dur() } : {}), ...(rnd() < 0.3 ? { sourceIn: T.frameTime(int(120), SRC) } : {}) } }),
      () => ({ op: 'add_clip', args: { assetId: pick(assetIds), start: fr(), trackId: trackId() } }),
      () => { const x = media.length ? pick(media) : null; return { op: 'add_clip', args: { assetId: x && x.c.type === 'media' ? x.c.assetId : pick(assetIds), start: x ? T.add(x.c.start, x.c.duration) : fr(), ...(x ? { trackId: x.t.id } : {}), duration: f(10 + int(60)), sourceIn: T.frameTime(int(60), SRC) } }; },
      () => ({ op: 'add_text', args: { text: pick(['שלום', 'Hello עולם 123', 'בְּרֵאשִׁית']), start: fr(), duration: dur() } }),
      () => ({ op: 'add_track', args: { kind: pick(['video', 'audio', 'text'] as const) } }),
      () => ({ op: 'move_clip', args: { clipId: any(), start: fr(), ...(rnd() < 0.2 ? { trackId: trackId() } : {}) } }),
      () => ({ op: 'move_clips', args: { clipIds: [any(), any()], delta: f(int(121) - 60) } }),
      () => ({ op: 'trim_clip', args: { clipId: any(), edge: pick(['start', 'end'] as const), to: at() } }),
      () => { const x = clips.length ? pick(clips).c : null; const len = x ? Math.max(2, T.frameIndexAt(x.duration, rate)) : 2; return { op: 'split_clip', args: { clipId: x?.id ?? 'clp_none', at: x && rnd() < 0.8 ? f(T.frameIndexAt(x.start, rate) + 1 + int(len - 1)) : fr() } }; },
      () => ({ op: 'delete_clip', args: { clipId: any(), ...(rnd() < 0.2 ? { includeLinked: false } : {}) } }),
      () => ({ op: 'duplicate_clips', args: { clipIds: [any()], ...(rnd() < 0.5 ? { at: fr() } : {}) } }),
      () => { const a = int(300); return { op: 'cut_range', args: { start: f(a), end: f(a + 1 + int(60)), ...(rnd() < 0.3 ? { ripple: false } : {}) } }; },
      () => ({ op: 'set_clip_speed', args: { clipId: mediaId(), speed: pick([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3.337, 8]) } }),
      () => { const x = movingVideo.length ? pick(movingVideo).c : videoClips.length ? pick(videoClips).c : null; return { op: 'freeze_frame', args: { clipId: x?.id ?? 'clp_none', at: x && rnd() < 0.8 ? f(T.frameIndexAt(x.start, rate) + int(Math.max(1, T.frameIndexAt(x.duration, rate)))) : fr(), duration: f(1 + int(45)) } }; },
      () => ({ op: 'set_clip_fades', args: { clipId: audioId(), fadeIn: T.rt(int(1500), 1000), fadeOut: T.rt(int(1500), 1000) } }),
      () => ({ op: 'set_audio_crossfade', args: { clipId: touchingAudio.length && rnd() < 0.85 ? pick(touchingAudio).c.id : audioId(), duration: f(int(rnd() < 0.7 ? 12 : 40)) } }),
      () => ({ op: 'set_clip_gain', args: { clipId: mediaId(), gain: Number((rnd() * 2).toFixed(2)) } }),
      () => ({ op: 'set_volume_keyframe', args: { clipId: audioId(), time: local(), value: Number((rnd() * 2).toFixed(2)) } }),
      () => { const x = volumeKeyed.length && rnd() < 0.8 ? pick(volumeKeyed).c : null; return { op: 'delete_volume_keyframe', args: { clipId: x?.id ?? audioId(), ...(rnd() < 0.6 ? { time: x && x.type === 'media' && x.volume ? pick(x.volume).time : local() } : {}) } }; },
      () => ({ op: 'set_keyframe', args: { clipId: any(), property: pick(['x', 'y', 'scale', 'rotation', 'opacity'] as const), time: local(), value: Number((rnd() * 0.8 + 0.1).toFixed(3)), easing: pick(['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'] as const) } }),
      () => (keyed.length && rnd() < 0.8 ? { op: 'delete_keyframe', args: pick(keyed) } : { op: 'delete_keyframe', args: { clipId: any(), property: pick(['x', 'y', 'scale', 'rotation', 'opacity'] as const), time: local() } }),
      () => ({ op: 'clear_keyframes', args: { clipId: any() } }),
      () => ({ op: 'set_clip_transform', args: { clipId: any(), transform: { x: Number((rnd() - 0.5).toFixed(3)), scale: Number((0.2 + rnd() * 2).toFixed(3)) } } }),
      () => ({ op: 'animate_clip', args: { clipId: any(), in: pick(['none', 'fade', 'pop', 'slide-up', 'slide-down'] as const), out: pick(['none', 'fade', 'pop'] as const), inFrames: 1 + int(30), outFrames: 1 + int(30) } }),
      () => ({ op: 'add_effect', args: { clipId: any(), type: pick(EFFECTS) } }),
      () => ({ op: 'add_effect', args: { clipId: videoClips.length ? pick(videoClips).c.id : any(), type: pick(EFFECTS) } }),
      () => { const { clipId, fx } = fxPick(); return { op: 'update_effect', args: { clipId, effectId: fx?.id ?? 'fx_none', enabled: rnd() < 0.5, ...(rnd() < 0.3 ? { index: 0 } : {}) } }; },
      () => { const { clipId, fx } = fxPick(); const params = fx ? animatableParams(fx.type) : []; return { op: 'set_effect_keyframe', args: { clipId, effectId: fx?.id ?? 'fx_none', param: params.length ? pick(params) : 'amount', time: local(), value: Number((rnd() * 0.1).toFixed(3)) } }; },
      () => { const { clipId, fx } = fxPick(); const keys = Object.entries(fx?.keyframes ?? {}).flatMap(([p, ks]) => ks.map((k) => ({ param: p, time: k.time }))); const k = keys.length ? pick(keys) : { param: 'amount', time: local() }; return { op: 'delete_effect_keyframe', args: { clipId, effectId: fx?.id ?? 'fx_none', ...k } }; },
      () => { const { clipId, fx } = fxPick(); return { op: 'remove_effect', args: { clipId, effectId: fx?.id ?? 'fx_none' } }; },
      () => ({ op: 'set_clip_blend', args: { clipId: any(), mode: pick(['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const) } }),
      () => ({ op: 'set_clip_mask', args: { clipId: mediaId(), mask: rnd() < 0.3 ? null : { shape: pick(['rect', 'ellipse'] as const), x: 0, y: 0, width: 0.6, height: 0.5, feather: 0.05, invert: rnd() < 0.3 } } }),
      () => ({ op: 'set_transition', args: { clipId: touchingVideo.length && rnd() < 0.85 ? pick(touchingVideo).c.id : videoId(), type: rnd() < 0.2 ? null : pick(['cross-dissolve', 'dip-to-black', 'wipe-left', 'slide-left']), frames: 1 + int(30) } }),
      () => ({ op: 'add_marker', args: { time: at(), label: pick(['', 'note', 'סמן']) } }),
      () => ({ op: 'update_marker', args: { markerId: markers.length ? pick(markers) : 'mrk_none', time: fr(), color: pick(['blue', 'green', 'yellow', 'red', 'purple'] as const) } }),
      () => { const t = tracks.length ? pick(tracks) : { id: 'trk_none', kind: 'video' as const }; return { op: 'update_track', args: { trackId: t.id, ...(rnd() < 0.4 ? { locked: rnd() < 0.25 } : rnd() < 0.5 ? (t.kind === 'audio' || rnd() < 0.1 ? { muted: rnd() < 0.4 } : { hidden: rnd() < 0.4 }) : { name: pick(['A', 'רצועה', 'B-roll']) }) } }; },
      () => ({ op: 'set_project_format', args: pick([{ background: '#203040' }, { fit: pick(['contain', 'cover'] as const) }, { width: 640, height: 360 }, { width: 641 }]) }),
      () => ({ op: 'set_asset_colour', args: { assetId: pick(assetIds), readAs: pick(['auto', 'bt601'] as const) } }),
      () => ({ op: 'rename_asset', args: { assetId: pick(assetIds), name: pick(['a.mp4', 'קובץ', 'x']) } }),
      () => ({ op: 'remove_asset', args: { assetId: pick(assetIds) } }),
      () => ({ op: 'move_track', args: { trackId: trackId(), toIndex: int(tracks.length + 1) } }),
      () => ({ op: 'remove_track', args: { trackId: trackId() } }),
      () => ({ op: 'speed_ramp', args: { clipId: any(), from: pick([0.5, 1, 2]), to: pick([0.25, 1, 3]), steps: 2 + int(5) } }),
      () => ({ op: 'fit_music', args: { clipId: any(), ...(rnd() < 0.3 ? { to: fr() } : {}) } }),
      () => {
        // prefer a pair that can really be linked (a detached picture and sound that still cover the same stretch); otherwise any two clips
        const all = tracks.flatMap((t) => t.clips.filter((c) => c.type === 'media' && !c.linkGroupId).map((c) => ({ c, t: t.id })));
        for (const x of all) { const y = all.find((z) => z.t !== x.t && T.eq(z.c.start, x.c.start) && T.eq(z.c.duration, x.c.duration)); if (y && rnd() < 0.8) return { op: 'link_clips', args: { clipIds: [x.c.id, y.c.id] } }; }
        return { op: 'link_clips', args: { clipIds: [any(), any()] } };
      },
      () => ({ op: 'unlink_clip', args: { clipId: any() } }),
      () => ({ op: 'set_clip_reverse', args: { clipId: any(), reverse: rnd() < 0.75 } }),
      () => ({ op: 'slip_clip', args: { clipId: any(), by: rnd() < 0.5 ? f(1 + int(40)) : T.sub(T.ZERO, f(1 + int(40))), ...(rnd() < 0.2 ? { includeLinked: false } : {}) } }),
      () => ({ op: 'close_gaps', args: rnd() < 0.7 ? {} : { from: f(int(200)), to: f(200 + int(300)) } }),
      () => ({ op: 'insert_gap', args: { at: f(int(400)), duration: rnd() < 0.1 ? f(0) : f(1 + int(90)) } }),
      () => ({ op: 'remove_marker', args: { markerId: markers.length ? pick(markers) : 'mrk_none' } }),
      () => ({ op: 'add_variant', args: pick([{ profileId: 'vertical-9x16' }, { width: 360, height: 360, name: 'sq' }, { width: 361, height: 640 }]) }),
      () => ({ op: 'set_variant_override', args: { variantId: variants.length ? pick(variants) : 'var_none', clipId: any(), ...(rnd() < 0.5 ? { transform: rnd() < 0.15 ? null : { x: Number((rnd() - 0.5).toFixed(2)), scale: 1.3 } } : rnd() < 0.5 ? { hidden: rnd() < 0.7 } : { text: rnd() < 0.2 ? null : 'קצר short', textStyle: rnd() < 0.2 ? null : { sizeFrac: 0.1 } }) } }),
      () => { const segs = Object.values(doc.transcripts ?? {}).flatMap((t) => t.segments.map((sg) => ({ assetId: t.assetId, segmentId: sg.id }))); const sg = segs.length && rnd() < 0.9 ? pick(segs) : { assetId: 'ast_none', segmentId: 'seg_none' };
        return { op: 'set_variant_phrase_text', args: { variantId: variants.length ? pick(variants) : 'var_none', ...sg, text: rnd() < 0.25 ? null : 'קצר short' } }; },
      () => ({ op: 'update_variant', args: { variantId: variants.length ? pick(variants) : 'var_none', ...(rnd() < 0.5 ? { captionStyle: rnd() < 0.3 ? null : { sizeFrac: 0.08, position: 'top' } } : { fit: pick(['contain', 'cover'] as const) }) } }),
      () => ({ op: 'remove_variant', args: { variantId: variants.length ? pick(variants) : 'var_none' } }),
      () => ({ op: 'add_caption_track', args: { mode: pick(['manual', 'transcript'] as const) } }),
      () => ({ op: 'add_cue', args: { start: at(), duration: dur(), text: pick(['שלום', 'line one\nline two', 'x']) } }),
      () => ({ op: 'update_cue', args: { clipId: cueId(), text: 'עודכן' } }),
      () => ({ op: 'merge_cues', args: { clipId: cueId() } }),
      () => ({ op: 'split_at_scenes', args: { clipId: ofVid.length && rnd() < 0.85 ? pick(ofVid).c.id : videoId() } }),
      () => { if (!wordList.length) return { op: 'delete_transcript_range', args: { assetId: vid, fromWordId: 'w_none', toWordId: 'w_none' } }; const a0 = int(wordList.length), b0 = Math.min(wordList.length - 1, a0 + int(2)); return { op: 'delete_transcript_range', args: { assetId: vid, fromWordId: wordList[a0]!, toWordId: wordList[b0]! } }; },
      () => ({ op: 'set_track_audio', args: { trackId: audioTracks.length ? pick(audioTracks).id : trackId(), gain: Number((rnd() * 2).toFixed(2)), pan: Number((rnd() * 2 - 1).toFixed(2)) } }),
      () => ({ op: 'set_ducking', args: { trackId: audioTracks.length ? pick(audioTracks).id : trackId(), sourceTrackIds: rnd() < 0.2 ? null : [audioTracks.length ? pick(audioTracks).id : trackId()] } }),
      () => ({ op: 'set_loudness_target', args: { target: pick([null, -14, -16, -23]) } }),
      () => ({ op: 'edit_analysis', args: { assetId: vid, kind: 'scenes', add: [T.frameTime(1 + int(230), SRC)] } }),
    ];
    return pick(menu)();
  };
  return { rate, f, int, importOps, setup, gen };
}
