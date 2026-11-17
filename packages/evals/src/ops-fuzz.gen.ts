/**
 * Shared generator for the operations fuzz: a deterministic source of random operation calls for a project,
 * used by the core-level fuzz (ops-fuzz.test.ts) and the store-level fuzz (store-fuzz.test.ts).
 */
import * as T from '@pulseframe/time';
import { animatableParams, AUDIO_EFFECTS, AUDIO_PRESETS, encodeNoiseProfile, GENERIC_NOISE_PROFILE, knownGridOf, LIFE_OPS_BUILT, MUSIC_GENERATOR, musicLayout, musicProvenanceParams, sha256Hex, transitionDef, type Capture, type OpCall, type ProjectDocument, fingerprint } from '@pulseframe/core';

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

/**
 * Capture dates of the fuzz files, by position in ASSETS (life line, ADR-0021): a video from a Hanukkah evening with its offset
 * (inside the sunset window), a sound file with a day only taken from its name, a picture with a clock time and an assumed
 * zone, and a video without a date. Given to the
 * imported files once the life-line operations are built (LIFE_OPS_BUILT); until then the fuzz runs exactly as before.
 */
const LIFE_CAPTURES: (Capture | undefined)[] = [
  { at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' },
  { at: '2024-12-25', utcOffsetMinutes: null, source: 'filename', circa: true },
  { at: '2024-03-24T11:05:09', utcOffsetMinutes: null, source: 'exif', assumedZone: 'Asia/Jerusalem' },
  undefined,
];
/** The operations of the life line that the fuzz draws (the public ones; attach_asset_capture is internal). */
export const LIFE_FUZZ_OPS = ['set_asset_capture', 'shift_asset_captures', 'set_text_fields', 'cluster_events', 'add_event', 'update_event', 'remove_event'] as const;

/**
 * `setup(doc)` returns the operations that add analysis data, a transcript and a motion track; `gen(doc)` returns the next random
 * call. `setupInternal(doc)` returns the internal operation (needs allowInternal) that attaches measured samples to that motion
 * track, as the tracking job does (ADR-0015); a driver that commits it after `setup` exercises attach_motion_track as well.
 * `genInternal(doc)` returns a random apply_template call (internal: a driver commits it with allowInternal, as the server
 * does; ADR-0016): a small plan with bindings, sometimes malformed, sometimes the regeneration of an earlier template run.
 * `genLife(doc)` returns a random call of the life line (ADR-0021): its seven public operations and the text edits that give titles
 * brace groups. `gen` draws from these rows too once the operations are built (LIFE_OPS_BUILT).
 * `genMusic()` returns a random add_builtin_music call (internal; ADR-0022), for packs-fuzz.test.ts.
 */
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
  const importOps: OpCall[] = ASSETS.map((asset, i) => ({ op: 'import_asset', args: { asset: LIFE_OPS_BUILT && LIFE_CAPTURES[i] ? { ...asset, capture: LIFE_CAPTURES[i] } : asset } }));
  /** Call once the assets exist: remembers their ids and returns the analysis/transcript set-up operations. */
  const setup = (doc: ProjectDocument): OpCall[] => {
    assetIds = Object.keys(doc.assets);
    [vid, aud] = assetIds as [string, string];
    return [
      { op: 'edit_analysis', args: { assetId: vid, kind: 'scenes', add: [T.rt(2, 1), T.rt(4, 1), T.rt(13, 2)] } },
      { op: 'edit_analysis', args: { assetId: aud, kind: 'beats', add: Array.from({ length: 12 }, (_, i) => T.rt(1 + i, 2)), bpm: 120 } },
      { op: 'set_transcript', args: { assetId: vid, language: 'he', segments: [0, 1, 2, 3].map((k) => ({ start: T.rt(k * 2, 1), duration: T.rt(2, 1), text: `מילה ${k} word`, words: [{ start: T.rt(k * 2, 1), duration: T.rt(1, 1), text: 'מילה' }, { start: T.rt(k * 2 + 1, 1), duration: T.rt(1, 1), text: `word${k}` }] })) } },
      // a region track on the video (ADR-0015), seeded by hand at its first frame
      { op: 'create_motion_track', args: { assetId: vid, kind: 'region', frame: 0, x: 5000, y: 5000, w: 2000, h: 2500, name: 'fuzz' } },
    ];
  };
  /**
   * Call after setup (it needs the transcript); internal operations, so they need allowInternal (ADR-0017). Imports derived copies
   * standing in for provider results (labelled fixtures: no provider ran): a whole-file enhanced copy of the video and a partial one,
   * and a processed copy of the music, so that replace_clip_asset is accepted and refused in a run; and a machine translation of the
   * transcript as a language format, so the format operations meet one.
   */
  const aiSetup = (doc: ProjectDocument): OpCall[] => {
    const derived = (src: string, extra: Record<string, unknown>) => ({ origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'fuzz', derived: { jobId: 'job_fuzz', capabilityId: 'fuzz.fixture', capabilityVersion: '0.0.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [src], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, ...extra } });
    const [v, m] = ASSETS as unknown as [typeof ASSETS[0], typeof ASSETS[1]];
    const segs = doc.transcripts?.[vid]?.segments ?? [];
    return [
      { op: 'import_asset', args: { asset: { ...v, name: 'v-enhanced.mp4', contentHash: `sha256:${'5'.repeat(64)}`, video: { ...v.video, width: 1280, height: 720 }, provenance: derived(vid, { sourceRangeStart: T.ZERO, audio: 'source-copied', frames: { sourceStartFrame: 0, sourceFrameCount: 240, sourceRate: SRC, outputRate: SRC, mapping: 'identity', heldFrames: [] } }) } } },
      { op: 'import_asset', args: { asset: { ...v, name: 'v-part.mp4', contentHash: `sha256:${'6'.repeat(64)}`, duration: T.rt(2, 1), video: { ...v.video, frameCount: 60 }, provenance: derived(vid, { sourceRangeStart: T.rt(2, 1), audio: 'source-copied' }) } } },
      { op: 'import_asset', args: { asset: { ...m, name: 'm-clean.wav', contentHash: `sha256:${'7'.repeat(64)}`, provenance: derived(aud, { sourceRangeStart: T.ZERO, audio: 'processed' }) } } },
      ...(segs.length ? [{ op: 'attach_translation', args: { baseVariantId: null, name: 'EN', language: 'en', translation: { from: 'he', to: 'en', engine: 'fixture', model: 'fixture', createdAt: '2026-11-17T00:00:00Z', createdBy: 'fuzz', sources: Object.fromEntries(segs.map((sg) => [sg.id, sha256Hex(sg.text)])) }, phraseText: Object.fromEntries(segs.map((sg, i) => [sg.id, `phrase ${i}`])), cueText: {} } }] : []),
    ];
  };
  /** Measured samples for the motion track `setup` made: source frames 1..199, mostly tracked, with lost, weak and unknown stretches. */
  const setupInternal = (doc: ProjectDocument): OpCall[] => {
    const t = Object.values(doc.motionTracks ?? {}).find((m) => m.assetId === vid);
    if (!t) return [];
    const k = 199, st = Array.from({ length: k }, (_, i) => (i % 50 >= 40 ? 3 : i % 50 >= 35 ? 2 : i % 97 === 5 ? 0 : 1));
    return [{ op: 'attach_motion_track', args: { motionTrackId: t.id, from: 1, x: Array.from({ length: k }, (_, i) => 3000 + i * 20), y: Array.from({ length: k }, (_, i) => 5000 + Math.round(1500 * Math.sin(i / 15))), s: Array.from({ length: k }, (_, i) => 900 + (i % 40) * 5), q: st.map((v) => (v === 1 ? 90 : 30)), st, method: 'fuzz', params: {}, createdAt: '2026-11-17T00:00:00Z' } }];
  };
  const EFFECTS = ['blur.gaussian', 'color.grayscale', 'color.adjust', 'light.vignette', 'time.echo', 'overlay.snow'];
  /** Looks for adjustment layers; the last three are refused on an adjustment (time effect, chroma key, drop shadow). */
  const ADJUST_EFFECTS = ['color.grayscale', 'color.adjust', 'blur.gaussian', 'light.vignette', 'stylize.grain', 'overlay.confetti', 'color.sepia', 'time.echo', 'key.chroma', 'stylize.shadow'];
  const SOUND_FX = AUDIO_EFFECTS.map((e) => e.id);
  /** A small change of a sound effect's main control (its wet amount, or the width), in range most of the time and out of it sometimes. */
  /**
   * The rows of the life line (ADR-0021). Every call has arguments its operation's schema accepts (lifeline-fuzz.test.ts
   * checks that); what is refused is refused by the operation: a day that does not exist, a year out of range, a sound file in
   * an event, the last file of an event, a brace group that is not a field, a day-only date moved by an hour.
   */
  const lifeMenu = (doc: ProjectDocument): (() => OpCall)[] => {
    const lib = Object.values(doc.assets);
    const anyAsset = () => (lib.length && rnd() < 0.95 ? pick(lib).id : 'ast_none');
    const pictures = lib.filter((a) => a.kind === 'video' || a.kind === 'image');
    const picture = () => (pictures.length && rnd() < 0.9 ? pick(pictures).id : anyAsset());
    const dated = lib.filter((a) => a.capture);
    const events = Object.values(doc.events ?? {});
    const eventId = () => (events.length && rnd() < 0.9 ? pick(events).id : 'evt_none');
    const titles = Object.values(doc.sequences).flatMap((sq) => sq.tracks.flatMap((t) => t.clips)).filter((c) => c.type === 'text');
    const titleId = () => (titles.length && rnd() < 0.9 ? pick(titles).id : 'clp_none');
    const some = (from: () => string, most: number) => [...new Set(Array.from({ length: 1 + int(most) }, from))];
    return [
      () => ({ op: 'set_asset_capture', args: { assetId: anyAsset(), capture: rnd() < 0.15 ? null : { at: pick(['2024-12-25T17:30:00', '2024-12-25T21:40:00', '2024-12-26T09:00:00', '2024-12-26', '2023-04-05T19:00:00', '2021-06-01', '2024-02-29T12:00:00', '2024-02-30', '1850-06-01', '2100-12-31T23:59:59']), ...(rnd() < 0.5 ? { utcOffsetMinutes: pick([120, 180, 60, null]) } : {}), ...(rnd() < 0.2 ? { circa: rnd() < 0.8 } : {}) } } }),
      () => ({ op: 'shift_asset_captures', args: { assetIds: some(() => (dated.length && rnd() < 0.85 ? pick(dated).id : anyAsset()), 3), minutes: pick([60, -60, 1440, -2880, 90, 525600, -5256000]) } }),
      // titles with brace groups: fields, escaped braces, a group that is not a field, a brace without its pair
      () => ({ op: 'update_text', args: { clipId: titleId(), text: pick(['{date}', 'צולם ב־{date:numeric}', '{hebrewDate} · {event}', '{hebrewDate:noYear} {hebrewYear}', '{{כך}} {year}', '{date:monthYear-en} {date:long-en}', 'שלום', '{weather}', '{date:fancy}', 'a { b', '{age:per_1}']) } }),
      () => ({ op: 'set_text_fields', args: { clipId: titleId(), enabled: rnd() < 0.7 } }),
      () => ({ op: 'cluster_events', args: rnd() < 0.5 ? {} : { gapMinutes: pick([30, 240, 1440]) } }),
      () => ({ op: 'add_event', args: { assetIds: some(picture, 3), ...(rnd() < 0.5 ? { name: pick(['חנוכה אצל סבתא', 'Trip', '']) } : {}) } }),
      () => {
        const ev = events.length && rnd() < 0.9 ? pick(events) : null;
        const r = rnd();
        return { op: 'update_event', args: { eventId: ev?.id ?? 'evt_none', ...(r < 0.3 ? { name: pick(['יום הולדת', 'Party', '']) } : r < 0.55 ? { afterSunset: pick([true, false, null]) } : r < 0.75 ? { addAssetIds: some(picture, 2) } : r < 0.95 ? { removeAssetIds: ev && rnd() < 0.85 ? [pick(ev.assetIds)] : [anyAsset()] } : {}) } };
      },
      () => ({ op: 'remove_event', args: { eventId: eventId() } }),
    ];
  };
  const genLife = (doc: ProjectDocument): OpCall => pick(lifeMenu(doc))();
  const soundParams = (type: string) => (type === 'utility.width' ? { stereoWidth: Number((rnd() * 2).toFixed(2)) } : { amount: rnd() < 0.1 ? 3 : Number(rnd().toFixed(2)) });

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
    /** sound clips that carry sound effects, and one of their effects */
    const withSoundFx = audioClips.filter((x) => x.c.type === 'media' && x.c.audioFx?.length);
    const soundFxPick = () => { const x = withSoundFx.length && rnd() < 0.9 ? pick(withSoundFx).c : null; const fx = x?.type === 'media' && x.audioFx?.length ? pick(x.audioFx) : undefined; return { clipId: x?.id ?? audioId(), fx }; };
    /** a sound clip or, a third of the time, a picture (resolves to its linked sound) or any clip at all (refused) */
    const soundTarget = () => (rnd() < 0.67 ? audioId() : rnd() < 0.7 ? videoId() : any());
    const wordList = Object.values(doc.transcripts ?? {}).flatMap((t) => t.segments.flatMap((sg) => (sg.words ?? []).map((w) => w.id)));
    const words = Object.values(doc.transcripts ?? {}).flatMap((t) => t.segments.flatMap((s) => (s.words ?? []).map((w) => w.id)));
    const derivedAssets = Object.values(doc.assets).filter((x) => x.provenance.derived);
    // motion tracking (ADR-0015): tracks, clips that can follow one, and video clips that can carry privacy regions
    const motionTracks = Object.values(doc.motionTracks ?? {});
    const mtId = () => (motionTracks.length && rnd() < 0.9 ? pick(motionTracks).id : 'mtk_none');
    const videoTracks = tracks.filter((t) => t.kind === 'video');
    const followers = clips.filter((x) => x.c.type === 'text' || (x.c.type === 'media' && x.t.kind === 'video'));
    const adjusts = clips.filter((x) => x.c.type === 'adjustment');
    const adjustId = () => (adjusts.length && rnd() < 0.9 ? pick(adjusts).c.id : any());
    const menu: (() => OpCall)[] = [
      // ADR-0017: a derived copy in place of a clip's file; mostly a copy made from the clip's own file, sometimes any copy or file (refused)
      () => {
        const x = media.length ? pick(media).c : null;
        const made = x?.type === 'media' ? derivedAssets.filter((a) => a.provenance.derived!.sourceAssetIds.includes(x.assetId)) : [];
        const assetId = made.length && rnd() < 0.85 ? pick(made).id : derivedAssets.length && rnd() < 0.8 ? pick(derivedAssets).id : pick(assetIds);
        return { op: 'replace_clip_asset', args: { clipId: x?.id ?? any(), assetId } };
      },
      () => ({ op: 'add_clip', args: { assetId: pick(assetIds), start: fr(), ...(rnd() < 0.5 ? { duration: dur() } : {}), ...(rnd() < 0.3 ? { sourceIn: T.frameTime(int(120), SRC) } : {}) } }),
      () => ({ op: 'add_clip', args: { assetId: pick(assetIds), start: fr(), trackId: trackId() } }),
      () => { const x = media.length ? pick(media) : null; return { op: 'add_clip', args: { assetId: x && x.c.type === 'media' ? x.c.assetId : pick(assetIds), start: x ? T.add(x.c.start, x.c.duration) : fr(), ...(x ? { trackId: x.t.id } : {}), duration: f(10 + int(60)), sourceIn: T.frameTime(int(60), SRC) } }; },
      () => ({ op: 'add_text', args: { text: pick(['שלום', 'Hello עולם 123', 'בְּרֵאשִׁית']), start: fr(), duration: dur() } }),
      // a finished title in one step (ADR-0022): a text style, an animation and live fields with the add; an unknown style or a
      // text that is not fields refuses the whole add
      () => ({ op: 'add_text', args: {
        text: pick(['נר 3 של חנוכה', 'בן 7', '{hebrewDate}', 'חנוכה שמח {{כן}}', '{weather}']), start: fr(), duration: dur(),
        ...(rnd() < 0.7 ? { presetId: pick(['clean-white', 'neon-tube-pink', 'gradient-gold', 'no-such-style']) } : {}),
        ...(rnd() < 0.5 ? { style: { sizeFrac: pick([0.05, 0.1]) } } : {}),
        ...(rnd() < 0.5 ? { animation: { by: pick(['letter', 'word'] as const), in: pick(['rise', 'pop', null] as const), out: pick(['fade', null] as const), loop: null, inFrames: 1 + int(20), outFrames: 1 + int(20) } } : {}),
        ...(rnd() < 0.4 ? { fields: true as const } : {}),
      } }),
      () => ({ op: 'add_track', args: { kind: pick(['video', 'audio', 'text', 'adjustment'] as const) } }),
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
      () => { const { clipId, fx } = fxPick(); const params = fx ? animatableParams(fx.type) : []; return { op: 'set_effect_keyframe', args: { clipId, effectId: fx?.id ?? 'fx_none', param: params.length ? pick(params) : 'amount', time: local(), value: Number((rnd() * 0.1).toFixed(3)) } }; }, // twice: keys must exist often enough for delete_effect_keyframe to be accepted in a run
      () => {
        // prefer an effect that has keys (when the project has one), so this is not refused almost every time
        const keyed = withFx.flatMap((x) => (x.c.effects ?? []).filter((e) => e.keyframes && Object.keys(e.keyframes).length).map((fx) => ({ clipId: x.c.id, fx })));
        const { clipId, fx } = keyed.length ? pick(keyed) : fxPick();
        const keys = Object.entries(fx?.keyframes ?? {}).flatMap(([p, ks]) => ks.map((k) => ({ param: p, time: k.time }))); const k = keys.length ? pick(keys) : { param: 'amount', time: local() };
        return { op: 'delete_effect_keyframe', args: { clipId, effectId: fx?.id ?? 'fx_none', ...k } };
      },
      () => { const { clipId, fx } = fxPick(); return { op: 'remove_effect', args: { clipId, effectId: fx?.id ?? 'fx_none' } }; },
      () => ({ op: 'set_clip_blend', args: { clipId: any(), mode: pick(['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const) } }),
      () => ({ op: 'set_clip_mask', args: { clipId: mediaId(), mask: rnd() < 0.3 ? null : { shape: pick(['rect', 'ellipse'] as const), x: 0, y: 0, width: 0.6, height: 0.5, feather: 0.05, invert: rnd() < 0.3 } } }),
      () => ({ op: 'set_transition', args: { clipId: touchingVideo.length && rnd() < 0.85 ? pick(touchingVideo).c.id : videoId(), type: rnd() < 0.2 ? null : pick(['cross-dissolve', 'dip-to-black', 'wipe-left', 'slide-left']), frames: 1 + int(30) } }),
      // transition options (ADR-0012): real types with and without colour and seed, then options on clips that carry a transition
      () => ({ op: 'set_transition', args: { clipId: touchingVideo.length && rnd() < 0.85 ? pick(touchingVideo).c.id : videoId(), type: pick(['dissolve', 'slices-h', 'shape-heart', 'film-burn', 'punch-in']), frames: 1 + int(20) } }),
      () => {
        // aim at what the transition allows (ADR-0012): beat lock on 3+ frames, colour and seed only where the type declares them;
        // velocity needs source handles, so it is often refused, and that refusal is exercised too
        const withTr = videoClips.filter((x) => x.c.type === 'media' && !!x.c.transition);
        const target = withTr.length && rnd() < 0.9 ? pick(withTr).c : null;
        const tr = target && target.type === 'media' ? target.transition : undefined;
        const options: readonly string[] = (tr && transitionDef(tr.type)?.options) || [];
        const r = rnd();
        const args: Record<string, unknown> = { clipId: target ? target.id : videoId() };
        if (r < 0.35) args.sync = tr && tr.frames < 3 && rnd() < 0.8 ? null : rnd() < 0.85 ? 'beat' : null;
        else if (r < 0.6) args.velocity = rnd() < 0.3 ? null : pick([2, 3, 4] as const);
        else if (r < 0.8) args.color = options.includes('color') || rnd() < 0.15 ? (rnd() < 0.2 ? null : '#3DE0C8') : null;
        else args.seed = options.includes('seed') || rnd() < 0.15 ? (rnd() < 0.2 ? null : int(10000)) : null;
        return { op: 'set_transition_options', args };
      },
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
      () => {
        // prefer an unlinked sound clip on a sound track (the only kind fit_music accepts); otherwise any clip, to exercise the refusals
        const sounds = tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips.filter((c) => c.type === 'media' && !c.linkGroupId && !c.reverse));
        return { op: 'fit_music', args: { clipId: sounds.length && rnd() < 0.8 ? pick(sounds).id : any(), ...(rnd() < 0.3 ? { to: fr() } : {}) } };
      },
      () => {
        // prefer a pair that can really be linked (a detached picture and sound that still cover the same stretch); otherwise any two clips
        const all = tracks.flatMap((t) => t.clips.filter((c) => c.type === 'media' && !c.linkGroupId).map((c) => ({ c, t: t.id })));
        for (const x of all) { const y = all.find((z) => z.t !== x.t && T.eq(z.c.start, x.c.start) && T.eq(z.c.duration, x.c.duration)); if (y && rnd() < 0.8) return { op: 'link_clips', args: { clipIds: [x.c.id, y.c.id] } }; }
        return { op: 'link_clips', args: { clipIds: [any(), any()] } };
      },
      () => ({ op: 'unlink_clip', args: { clipId: any() } }),
      () => ({ op: 'set_clip_reverse', args: { clipId: any(), reverse: rnd() < 0.75 } }),
      () => ({ op: 'set_clip_pitch', args: { clipId: any(), keepPitch: rnd() < 0.7 } }),
      () => { const a0 = int(40), b0 = a0 + int(60); return { op: 'draw_volume', args: { clipId: audioClips.length && rnd() < 0.9 ? pick(audioClips).c.id : any(), from: f(a0), to: f(b0), keys: Array.from({ length: int(5) }, (_, i) => ({ time: f(Math.min(b0, a0 + i * 7)), value: Number((rnd() * 2).toFixed(2)), ...(rnd() < 0.3 ? { curve: 'smooth' as const } : {}) })).filter((k, i, all) => i === 0 || !T.eq(all[i - 1]!.time, k.time)) } }; },
      () => ({ op: 'set_clip_speed_ramp', args: { clipId: any(), from: pick([0.5, 1, 1.5, 2]), to: pick([0.25, 0.75, 1, 3]), ...(rnd() < 0.4 ? { curve: 'smooth' as const } : {}) } }),
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
      // sound effects (ADR-0010): sound clips, pictures that resolve to their linked sound, and invalid cases (unknown types, bad parameters, ids that do not exist)
      () => { const type = rnd() < 0.06 ? 'voice.chipmunk' : pick(SOUND_FX); return { op: 'add_audio_effect', args: { clipId: soundTarget(), type, ...(rnd() < 0.35 ? { params: soundParams(type) } : {}), ...(rnd() < 0.15 ? { enabled: false } : {}), ...(rnd() < 0.1 ? { includeLinked: false } : {}) } }; },
      () => {
        // a type the sound clip does not have yet, and no second character voice: accepted most of the time, so that effects exist
        // often enough for the other four operations to be accepted in a run
        const x = audioClips.length ? pick(audioClips).c : null;
        const has = x?.type === 'media' ? x.audioFx ?? [] : [];
        const voiced = has.some((h) => AUDIO_EFFECTS.find((e) => e.id === h.type)?.exclusive === 'voice');
        const free = AUDIO_EFFECTS.filter((e) => !has.some((h) => h.type === e.id) && !(voiced && e.exclusive === 'voice')).map((e) => e.id);
        return { op: 'add_audio_effect', args: { clipId: x?.id ?? any(), type: free.length ? pick(free) : pick(SOUND_FX) } };
      },
      () => { const { clipId, fx } = soundFxPick(); return { op: 'update_audio_effect', args: { clipId, effectId: fx?.id ?? 'afx_none', ...(rnd() < 0.6 ? { params: soundParams(fx?.type ?? 'space.echo') } : {}), ...(rnd() < 0.5 ? { enabled: rnd() < 0.5 } : {}) } }; },
      () => { const { clipId, fx } = soundFxPick(); return { op: 'remove_audio_effect', args: { clipId, effectId: fx?.id ?? 'afx_none' } }; },
      () => ({ op: 'apply_audio_preset', args: { clipId: soundTarget(), presetId: rnd() < 0.15 ? null : rnd() < 0.06 ? 'chipmunk' : pick(AUDIO_PRESETS).id, ...(rnd() < 0.1 ? { includeLinked: false } : {}) } }),
      () => {
        const { clipId } = soundFxPick();
        const others = audioClips.filter((x) => x.c.id !== clipId);
        const to = () => (others.length && rnd() < 0.8 ? pick(others).c.id : soundTarget()); // mostly another sound clip; sometimes a picture, the source itself or a clip without sound (refused)
        return { op: 'copy_audio_effects', args: { fromClipId: clipId, toClipIds: [to(), ...(rnd() < 0.3 ? [to()] : [])], ...(rnd() < 0.5 ? { replace: rnd() < 0.7 } : {}) } };
      },
      // voice cleanup (ADR-0013): one strength sets the three cleanup effects; strength 0 removes them; a bad profile or strength is refused
      () => ({ op: 'clean_voice', args: { clipId: soundTarget(), strength: pick([0, 0.25, 0.6, 0.6, 1, 1.5]), ...(rnd() < 0.5 ? { mainsHz: pick(['50', '60', null] as const) } : {}), ...(rnd() < 0.4 ? { profile: rnd() < 0.1 ? 'not-a-profile' : rnd() < 0.5 ? GENERIC_NOISE_PROFILE : encodeNoiseProfile(Array.from({ length: 24 }, () => -40 - int(40))), source: pick(assetIds) } : {}), ...(rnd() < 0.15 ? { denoise: false } : {}), ...(rnd() < 0.15 ? { speech: false } : {}), ...(rnd() < 0.1 ? { includeLinked: false } : {}) } }),
      // colour match writes its grade with set_colour_grade (ADR-0014): replace or merge, out-of-range values refused, animated values refused unless dropped
      () => ({ op: 'set_colour_grade', args: { clipId: rnd() < 0.8 ? videoId() : any(), params: { exposure: Number((rnd() * 2 - 1).toFixed(3)), temperature: Number((rnd() * 1.2 - 0.6).toFixed(3)), ...(rnd() < 0.5 ? { saturation: rnd() < 0.08 ? 3 : Number((0.5 + rnd()).toFixed(3)) } : {}) }, ...(rnd() < 0.4 ? { mode: pick(['replace', 'merge'] as const) } : {}), ...(rnd() < 0.2 ? { dropKeyframes: true } : {}) } }),
      // motion tracking (ADR-0015): tracks made and corrected by hand, clips that follow them, privacy regions; refused cases too
      // (a still or a sound file, a frame past the end, a region without its box, a track of another file, chains)
      () => { const region = rnd() < 0.5; return { op: 'create_motion_track', args: { assetId: rnd() < 0.85 ? vid : pick(assetIds), kind: region ? 'region' : 'point', frame: int(rnd() < 0.9 ? 240 : 400), x: int(10_001), y: int(10_001), ...(region && rnd() < 0.9 ? { w: 10 + int(4000), h: 10 + int(4000) } : {}) } }; },
      () => {
        const t = motionTracks.length && rnd() < 0.9 ? pick(motionTracks) : null;
        const lo = t?.from ?? 0, hi = t ? t.from + t.x.length : 1;
        const span = () => { const a = lo + int(Math.max(1, hi - lo)); return { from: a, to: Math.min(hi + (rnd() < 0.1 ? 5 : 0), a + 1 + int(20)) }; };
        const base = Math.max(0, lo + int(hi - lo + 40) - 20), step = 1 + int(5);
        const set = () => Array.from({ length: 1 + int(6) }, (_, i) => ({ frame: base + i * step, x: int(10_001), y: int(10_001), ...(t?.kind === 'region' && rnd() < 0.6 ? { s: 300 + int(2000) } : {}) }));
        const what = int(5);
        return { op: 'edit_motion_track', args: { motionTrackId: t?.id ?? 'mtk_none', ...(what === 0 ? { set: set() } : what === 1 ? { markLost: span() } : what === 2 ? { interpolate: span() } : what === 3 ? { name: pick(['פנים', 'ball', 'x']) } : { set: set(), interpolate: span() }) } };
      },
      () => ({ op: 'remove_motion_track', args: { motionTrackId: mtId(), ...(rnd() < 0.6 ? { unbind: true } : {}) } }),
      () => {
        const x = followers.length && rnd() < 0.9 ? pick(followers) : null;
        const targets = videoTracks.filter((t) => t.id !== x?.t.id);
        return { op: 'set_clip_follow', args: { clipId: x?.c.id ?? any(), follow: rnd() < 0.15 ? null : { motionTrackId: mtId(), targetTrackId: targets.length && rnd() < 0.9 ? pick(targets).id : trackId(), scale: rnd() < 0.5, smooth: int(5) }, ...(rnd() < 0.4 ? { offset: { x: Number((rnd() * 0.6 - 0.3).toFixed(3)), y: Number((rnd() * 0.6 - 0.3).toFixed(3)) } } : {}) } };
      },
      () => {
        const x = movingVideo.length && rnd() < 0.9 ? pick(movingVideo).c : videoClips.length ? pick(videoClips).c : null;
        const own = x?.type === 'media' ? x.redact ?? [] : [];
        const ofAsset = motionTracks.filter((t) => x?.type === 'media' && t.assetId === x.assetId);
        const look = () => ({ style: pick(['blur', 'pixelate', 'fill'] as const), strength: Number(rnd().toFixed(2)), ...(rnd() < 0.5 ? { onLoss: pick(['frame', 'hold'] as const), weakIsLost: rnd() < 0.5 } : {}) });
        const mode = rnd();
        if (own.length && mode < 0.2) return { op: 'set_redact_region', args: { clipId: x!.id, regionId: pick(own).id, region: null } };
        if (own.length && mode < 0.45) return { op: 'set_redact_region', args: { clipId: x!.id, regionId: pick(own).id, region: look() } };
        return { op: 'set_redact_region', args: { clipId: x?.id ?? any(), region: { motionTrackId: ofAsset.length && rnd() < 0.7 ? pick(ofAsset).id : rnd() < 0.1 ? mtId() : null, ...look() } } };
      },
      // adjustment layers (ADR-0016): over the whole edit or a stretch, with looks (some refused on an adjustment), on a named track
      // or a free one; then effects, masks and opacity on them, and the refused position keys; the timing rows above reach them too
      () => ({ op: 'add_adjustment', args: { span: rnd() < 0.5 ? 'edit' : { start: fr(), duration: rnd() < 0.05 ? f(0) : dur() }, ...(rnd() < 0.7 ? { effects: Array.from({ length: 1 + int(2) }, () => ({ type: pick(ADJUST_EFFECTS) })) } : {}), ...(rnd() < 0.3 ? { opacity: Number(rnd().toFixed(2)) } : {}), ...(rnd() < 0.15 ? { trackId: trackId() } : {}) } }),
      () => ({ op: 'add_effect', args: { clipId: adjustId(), type: pick(ADJUST_EFFECTS) } }),
      () => ({ op: 'set_clip_mask', args: { clipId: adjustId(), mask: rnd() < 0.2 ? null : { shape: pick(['rect', 'ellipse'] as const), x: Number((rnd() - 0.5).toFixed(2)), width: Number((0.2 + rnd() * 0.6).toFixed(2)), invert: rnd() < 0.3 } } }),
      () => (rnd() < 0.5
        ? { op: 'set_keyframe', args: { clipId: adjustId(), property: rnd() < 0.85 ? 'opacity' : pick(['x', 'scale'] as const), time: local(), value: Number(rnd().toFixed(2)) } }
        : { op: 'set_clip_transform', args: { clipId: adjustId(), transform: rnd() < 0.85 ? { opacity: Number(rnd().toFixed(2)) } : { x: 0.1 } } }),
      // replace media (ADR-0016): another of the files for a clip, its linked sound following or detached; refused for a file
      // without what the clip plays, too short, or a still in place of a clip at another speed
      () => ({ op: 'replace_clip_media', args: { clipId: media.length && rnd() < 0.9 ? pick(media).c.id : any(), assetId: pick(assetIds), ...(rnd() < 0.3 ? { sourceIn: T.frameTime(int(150), SRC) } : {}), ...(rnd() < 0.4 ? { linked: pick(['follow', 'detach'] as const) } : {}) } }),
      // life line (ADR-0021): capture dates, events and title fields, once their operations are built
      ...(LIFE_OPS_BUILT ? lifeMenu(doc) : []),
    ];
    return pick(menu)();
  };
  /** A procedural picture as the server would make it for a template (two contents, so the same one is often deduplicated). */
  const templatePicture = (k: number) => ({ kind: 'image' as const, name: `el${k}.png`, contentHash: `sha256:${(k ? 'b' : 'a').repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 200, height: 200, codec: 'png', hasAlpha: true }, provenance: { origin: 'generated' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'system', procedural: { id: 'element.shape.star-5', version: 2, generator: 'fuzz' } } });
  const genInternal = (doc: ProjectDocument): OpCall => {
    const at = int(300), len = 15 + int(60);
    const steps: { op: string; args: unknown; bind?: string }[] = [
      { op: 'add_clip', args: { assetId: { $asset: 'pic' }, start: f(at), duration: f(len) }, bind: 'shot' },
      { op: 'add_clip', args: { assetId: { $asset: rnd() < 0.5 ? 'pic' : 'el' }, start: f(at + len), duration: f(len), trackId: { $ref: 'shot', out: 'trackId' } }, bind: 'next' },
      { op: 'add_text', args: { text: pick(['שלום', 'Hello עולם']), start: f(at), duration: f(len) }, bind: 'title' },
      { op: 'add_adjustment', args: { span: { start: f(at), duration: f(2 * len) }, effects: [{ type: pick(['color.sepia', 'stylize.grain', 'light.vignette']) }] }, bind: 'look' },
    ];
    if (rnd() < 0.5) steps.push({ op: 'update_effect', args: { clipId: { $ref: 'look' }, effectId: { $ref: 'look', out: 'effectIds', at: 0 }, params: { amount: 0.4 } } });
    if (rnd() < 0.5) steps.push({ op: 'set_transition', args: { clipId: { $ref: 'next' }, type: 'dissolve', frames: 1 + int(10) } });
    if (rnd() < 0.5) steps.push({ op: 'apply_motion_preset', args: { clipId: { $ref: 'shot' }, presetId: 'motion.move.ken-burns-in' } });
    if (rnd() < 0.4) steps.push({ op: 'set_keyframe', args: { clipId: { $ref: 'look' }, property: 'opacity', time: f(0), value: 0 } });
    // a malformed plan now and then: a forward or unknown reference, a key beside $ref, an inherited name, an internal step
    const fault = rnd();
    if (fault < 0.04) steps.unshift({ op: 'set_clip_transform', args: { clipId: { $ref: 'shot' }, transform: { x: 0.1 } } });
    else if (fault < 0.08) steps.push({ op: 'set_clip_transform', args: { clipId: { $ref: 'nobody' }, transform: { x: 0.1 } } });
    else if (fault < 0.11) steps.push({ op: 'set_clip_transform', args: { clipId: { $ref: 'shot', extra: 1 }, transform: { x: 0.1 } } });
    else if (fault < 0.14) steps.push({ op: 'add_text', args: { text: { $ref: 'title', out: pick(['toString', 'constructor']) }, start: f(0), duration: f(10) } });
    else if (fault < 0.16) steps.push({ op: 'import_asset', args: { asset: templatePicture(0) } });
    const slots = [{ key: 'shot', kind: 'picture', clipId: { $ref: 'shot' } }, { key: 'next', kind: 'picture', clipId: { $ref: 'next' } }, { key: 'title', kind: 'text', clipId: { $ref: 'title' } }, { key: 'look', kind: 'look', clipId: { $ref: fault > 0.97 ? 'nobody' : 'look' } }];
    // regeneration of an earlier template run: its untouched clips go, the ones edited by hand stay with their slots
    const runs = Object.values(doc.recipeRuns ?? {}).filter((r) => r.recipeId.startsWith('template:'));
    const regen = runs.length && rnd() < 0.4 ? pick(runs) : null;
    const clipNow = (id: string) => Object.values(doc.sequences).flatMap((sq) => sq.tracks.flatMap((t) => t.clips)).find((c) => c.id === id);
    const touched = regen ? regen.createdIds.filter((id) => { const c = clipNow(id); return c && regen.fingerprints[id] && fingerprint(c) !== regen.fingerprints[id]; }) : [];
    const untouched = regen ? regen.createdIds.filter((id) => { const c = clipNow(id); return c && !touched.includes(id); }) : [];
    return {
      op: 'apply_template',
      args: {
        templateId: regen ? regen.recipeId.slice('template:'.length) : pick(['tpl.fuzz', 'tpl.fuzz-two']), templateVersion: 1, params: { seed }, steps: ['fuzz plan'],
        assets: [{ key: 'pic', asset: templatePicture(int(2)) }, { key: 'el', asset: templatePicture(int(2)) }],
        ...(regen ? { runId: regen.id, removeClipIds: untouched, keepIds: touched, keepSlots: (regen.slots ?? []).filter((s) => touched.includes(s.clipId)) } : {}),
        ops: steps, slots: regen ? slots.filter((s) => !(regen.slots ?? []).some((k) => k.key === s.key && touched.includes(k.clipId))) : slots,
      },
    };
  };
  /**
   * A random add_builtin_music call (ADR-0022; internal: a driver commits it with allowInternal, as the server does): a track of
   * a style, a number of bars and a seed with its known grid, sometimes placed on the timeline; now and then the same track
   * again (deduplicated), or a malformed grid or a file that is not built-in music (refused).
   */
  const genMusic = (): OpCall => {
    const styleId = pick(['music.festive', 'music.calm', 'music.cinematic']);
    const layout = musicLayout(styleId, pick([4, 6, 13]));
    const seedOf = int(3);
    const asset = { kind: 'audio' as const, name: `${styleId}.wav`, contentHash: `sha256:${sha256Hex(`${styleId}/${layout.bars}/${seedOf}`)}`, byteSize: 44 + 4 * layout.totalFrames, container: 'wav', mimeType: 'audio/wav', duration: layout.duration, audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'generated' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'system', procedural: { id: styleId, version: 1, generator: MUSIC_GENERATOR, params: musicProvenanceParams(layout, seedOf) } } };
    const grid = knownGridOf(layout, seedOf, '2026-11-17T00:00:00Z');
    const fault = rnd();
    const g = fault < 0.05 ? { ...grid, beats: [...grid.beats].reverse() } : fault < 0.08 ? { ...grid, beats: [...grid.beats, layout.duration] } : fault < 0.1 ? { ...grid, sections: [...grid.sections].reverse() } : grid;
    const a = fault > 0.96 ? { ...asset, provenance: { ...asset.provenance, procedural: { id: 'sfx.pop', version: 1, generator: 'fuzz' } } } : asset;
    return { op: 'add_builtin_music', args: { asset: a, grid: g, ...(rnd() < 0.6 ? { place: { start: rnd() < 0.9 ? fr() : T.rt(1, 1000) } } : {}) } };
  };
  /**
   * The next random call among the named operations: draws from the same menu until one of them comes up (the menu grows with every
   * feature, so a driver that is about a few operations would otherwise meet them too rarely to say anything about them).
   */
  const genFocused = (doc: ProjectDocument, ops: readonly string[]): OpCall => {
    let call = gen(doc);
    for (let i = 0; i < 400 && !ops.includes(call.op); i++) call = gen(doc);
    return call;
  };
  return { rate, f, int, importOps, setup, aiSetup, setupInternal, gen, genFocused, genInternal, genLife, genMusic };
}
