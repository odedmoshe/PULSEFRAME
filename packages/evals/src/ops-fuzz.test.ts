/**
 * Fuzz of the editing operations as a whole (SPEC §6, Appendix C3 "Model"): random sequences drawn from 45 operations,
 * at five project frame rates, with these oracles after every step:
 *  - an accepted transaction yields a document that passes validation and the schema, and did not mutate its input;
 *  - a refusal is a typed OpError and leaves the document unchanged; nothing else may be thrown;
 *  - the document can be evaluated (picture graph, audio plan, timeline and summary queries, every linked format);
 *  - the entity diff of the step, applied backwards, restores the previous document exactly (the undo path).
 * Deterministic: seeds 1..PF_FUZZ_SEEDS (default 60), PF_FUZZ_STEPS steps each (default 70). A failure names seed, step and op.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, OpError, ProjectSchema, projectVariant, restoreEntities, summarize, timeline, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, evaluate } from '@pulseframe/engine';

const SEEDS = Math.max(1, Number(process.env.PF_FUZZ_SEEDS ?? 60));
const STEPS = Math.max(1, Number(process.env.PF_FUZZ_STEPS ?? 70));
const RATES = [{ num: 30, den: 1 }, { num: 25, den: 1 }, { num: 24000, den: 1001 }, { num: 30000, den: 1001 }, { num: 60, den: 1 }];

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
  { kind: 'video' as const, name: 'late.mkv', contentHash: `sha256:${'4'.repeat(64)}`, byteSize: 1, container: 'matroska', mimeType: 'video/x-matroska', duration: T.frameTime(135, SRC), video: { width: 640, height: 360, frameRate: SRC, codec: 'h264', rotation: 0, frameCount: 120, startTime: T.fromSeconds('0.5') }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov },
];

function run(seed: number) {
  const rnd = mulberry32(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <X,>(xs: readonly X[]): X => xs[int(xs.length)]!;
  const rate = RATES[seed % RATES.length]!;
  const f = (n: number) => T.frameTime(n, rate);
  const fr = () => f(int(360));
  const dur = () => f(1 + int(120));
  let n = 0;
  const ctx = (allowInternal = false) => ({ idSeed: `z${seed}_${n++}_`, actor: 'fuzz', allowInternal });
  let doc = applyTransaction(createProject({ id: 'prj_fuzz', name: 'fuzz', width: 640, height: 360, frameRate: rate }), ASSETS.map((asset) => ({ op: 'import_asset', args: { asset } })), ctx(true)).doc;
  const assetIds = Object.keys(doc.assets);
  const [vid, aud] = assetIds as [string, string];
  // analysis and a transcript so the analysis- and speech-based operations have something to act on
  doc = applyTransaction(doc, [
    { op: 'edit_analysis', args: { assetId: vid, kind: 'scenes', add: [T.rt(2, 1), T.rt(4, 1), T.rt(13, 2)] } },
    { op: 'edit_analysis', args: { assetId: aud, kind: 'beats', add: Array.from({ length: 12 }, (_, i) => T.rt(1 + i, 2)), bpm: 120 } },
    { op: 'set_transcript', args: { assetId: vid, language: 'he', segments: [0, 1, 2, 3].map((k) => ({ start: T.rt(k * 2, 1), duration: T.rt(2, 1), text: `מילה ${k} word`, words: [{ start: T.rt(k * 2, 1), duration: T.rt(1, 1), text: 'מילה' }, { start: T.rt(k * 2 + 1, 1), duration: T.rt(1, 1), text: `word${k}` }] })) } },
  ], ctx()).doc;
  const EFFECTS = ['blur.gaussian', 'color.grayscale', 'color.brightness', 'stylize.vignette'];

  const gen = (): OpCall => {
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
    const trackId = () => pick(tracks).id;
    const audioTracks = tracks.filter((t) => t.kind === 'audio');
    const local = () => f(int(90));
    /** A frame that matters: an edge of or a point inside an existing clip half the time, anywhere otherwise. */
    const at = () => { if (!clips.length || rnd() < 0.4) return fr(); const c = pick(clips).c; const a0 = T.frameIndexAt(c.start, rate), len = Math.max(1, T.frameIndexAt(c.duration, rate)); return f(a0 + pick([0, len, int(len), int(len), int(len)])); };
    /** An existing transform keyframe, when there is one. */
    const keyed = clips.flatMap((x) => Object.entries(x.c.keyframes ?? {}).flatMap(([p, ks]) => (ks ?? []).map((k) => ({ clipId: x.c.id, property: p, time: k.time }))));
    const words = Object.values(doc.transcripts ?? {}).flatMap((t) => t.segments.flatMap((s) => (s.words ?? []).map((w) => w.id)));
    const menu: (() => OpCall)[] = [
      () => ({ op: 'add_clip', args: { assetId: pick(assetIds), start: fr(), ...(rnd() < 0.5 ? { duration: dur() } : {}), ...(rnd() < 0.3 ? { sourceIn: T.frameTime(int(120), SRC) } : {}) } }),
      () => ({ op: 'add_clip', args: { assetId: pick(assetIds), start: fr(), trackId: trackId() } }),
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
      () => { const x = videoClips.length ? pick(videoClips).c : null; return { op: 'freeze_frame', args: { clipId: x?.id ?? 'clp_none', at: x && rnd() < 0.8 ? f(T.frameIndexAt(x.start, rate) + int(Math.max(1, T.frameIndexAt(x.duration, rate)))) : fr(), duration: f(1 + int(45)) } }; },
      () => ({ op: 'set_clip_fades', args: { clipId: audioId(), fadeIn: T.rt(int(3000), 1000), fadeOut: T.rt(int(3000), 1000) } }),
      () => ({ op: 'set_audio_crossfade', args: { clipId: audioId(), duration: f(int(40)) } }),
      () => ({ op: 'set_clip_gain', args: { clipId: mediaId(), gain: Number((rnd() * 2).toFixed(2)) } }),
      () => ({ op: 'set_volume_keyframe', args: { clipId: audioId(), time: local(), value: Number((rnd() * 2).toFixed(2)) } }),
      () => ({ op: 'delete_volume_keyframe', args: { clipId: audioId(), ...(rnd() < 0.5 ? { time: local() } : {}) } }),
      () => ({ op: 'set_keyframe', args: { clipId: any(), property: pick(['x', 'y', 'scale', 'rotation', 'opacity'] as const), time: local(), value: Number((rnd() * 0.8 + 0.1).toFixed(3)), easing: pick(['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'] as const) } }),
      () => (keyed.length && rnd() < 0.8 ? { op: 'delete_keyframe', args: pick(keyed) } : { op: 'delete_keyframe', args: { clipId: any(), property: pick(['x', 'y', 'scale', 'rotation', 'opacity'] as const), time: local() } }),
      () => ({ op: 'clear_keyframes', args: { clipId: any() } }),
      () => ({ op: 'set_clip_transform', args: { clipId: any(), transform: { x: Number((rnd() - 0.5).toFixed(3)), scale: Number((0.2 + rnd() * 2).toFixed(3)) } } }),
      () => ({ op: 'animate_clip', args: { clipId: any(), in: pick(['none', 'fade', 'pop', 'slide-up', 'slide-down'] as const), out: pick(['none', 'fade', 'pop'] as const), inFrames: 1 + int(30), outFrames: 1 + int(30) } }),
      () => ({ op: 'add_effect', args: { clipId: any(), type: pick(EFFECTS) } }),
      () => { const x = withFx.length ? pick(withFx).c : null; return { op: 'update_effect', args: { clipId: x?.id ?? any(), effectId: x?.effects?.[0]?.id ?? 'fx_none', enabled: rnd() < 0.5, ...(rnd() < 0.5 ? { index: int(3) } : {}) } }; },
      () => { const x = withFx.length ? pick(withFx).c : null; const fx = x?.effects?.[0]; return { op: 'set_effect_keyframe', args: { clipId: x?.id ?? any(), effectId: fx?.id ?? 'fx_none', param: fx?.type === 'blur.gaussian' ? 'radius' : fx?.type === 'color.brightness' ? 'amount' : 'amount', time: local(), value: Number((rnd() * 0.1).toFixed(3)) } }; },
      () => { const x = withFx.length ? pick(withFx).c : null; return { op: 'remove_effect', args: { clipId: x?.id ?? any(), effectId: x?.effects?.[0]?.id ?? 'fx_none' } }; },
      () => ({ op: 'set_clip_blend', args: { clipId: any(), mode: pick(['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const) } }),
      () => ({ op: 'set_clip_mask', args: { clipId: mediaId(), mask: rnd() < 0.3 ? null : { shape: pick(['rect', 'ellipse'] as const), x: 0, y: 0, width: 0.6, height: 0.5, feather: 0.05, invert: rnd() < 0.3 } } }),
      () => ({ op: 'set_transition', args: { clipId: videoId(), type: rnd() < 0.2 ? null : pick(['cross-dissolve', 'dip-to-black', 'wipe-left', 'slide-left']), frames: 1 + int(30) } }),
      () => ({ op: 'add_marker', args: { time: at(), label: pick(['', 'note', 'סמן']) } }),
      () => ({ op: 'update_marker', args: { markerId: markers.length ? pick(markers) : 'mrk_none', time: fr(), color: pick(['blue', 'green', 'yellow', 'red', 'purple'] as const) } }),
      () => ({ op: 'remove_marker', args: { markerId: markers.length ? pick(markers) : 'mrk_none' } }),
      () => ({ op: 'add_variant', args: pick([{ profileId: 'vertical-9x16' }, { width: 360, height: 360, name: 'sq' }, { width: 361, height: 640 }]) }),
      () => ({ op: 'set_variant_override', args: { variantId: variants.length ? pick(variants) : 'var_none', clipId: any(), ...(rnd() < 0.5 ? { transform: rnd() < 0.2 ? null : { x: 0.1, scale: 1.3 } } : { hidden: rnd() < 0.5 }) } }),
      () => ({ op: 'update_variant', args: { variantId: variants.length ? pick(variants) : 'var_none', ...(rnd() < 0.5 ? { captionStyle: rnd() < 0.3 ? null : { sizeFrac: 0.08, position: 'top' } } : { fit: pick(['contain', 'cover'] as const) }) } }),
      () => ({ op: 'remove_variant', args: { variantId: variants.length ? pick(variants) : 'var_none' } }),
      () => ({ op: 'add_caption_track', args: { mode: pick(['manual', 'transcript'] as const) } }),
      () => ({ op: 'add_cue', args: { start: at(), duration: dur(), text: pick(['שלום', 'line one\nline two', 'x']) } }),
      () => ({ op: 'update_cue', args: { clipId: cueId(), text: 'עודכן' } }),
      () => ({ op: 'merge_cues', args: { clipId: cueId() } }),
      () => ({ op: 'split_at_scenes', args: { clipId: videoId() } }),
      () => ({ op: 'delete_transcript_range', args: { assetId: vid, fromWordId: words.length ? pick(words) : 'w_none', toWordId: words.length ? pick(words) : 'w_none' } }),
      () => ({ op: 'set_track_audio', args: { trackId: audioTracks.length ? pick(audioTracks).id : trackId(), gain: Number((rnd() * 2).toFixed(2)), pan: Number((rnd() * 2 - 1).toFixed(2)) } }),
      () => ({ op: 'set_ducking', args: { trackId: audioTracks.length ? pick(audioTracks).id : trackId(), sourceTrackIds: rnd() < 0.2 ? null : [audioTracks.length ? pick(audioTracks).id : trackId()] } }),
      () => ({ op: 'set_loudness_target', args: { target: pick([null, -14, -16, -23]) } }),
      () => ({ op: 'edit_analysis', args: { assetId: vid, kind: 'scenes', add: [T.frameTime(1 + int(230), SRC)] } }),
    ];
    return pick(menu)();
  };

  const stats = { accepted: 0, refused: 0, byOp: {} as Record<string, [number, number]> };
  for (let step = 0; step < STEPS; step++) {
    const call = gen();
    const where = `seed ${seed} (${rate.num}/${rate.den}) step ${step}: ${JSON.stringify(call).slice(0, 300)}`;
    const before = doc;
    const beforeJson = JSON.stringify(doc);
    const tally = (stats.byOp[call.op] ??= [0, 0]);
    let next: ProjectDocument;
    try {
      next = applyTransaction(doc, [call], ctx()).doc;
    } catch (e) {
      if (!(e instanceof OpError)) throw new Error(`${where}\n  threw something that is not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 600)}`);
      if (JSON.stringify(doc) !== beforeJson) throw new Error(`${where}\n  a refused operation changed the document`);
      stats.refused++; tally[1]++;
      continue;
    }
    stats.accepted++; tally[0]++;
    if (JSON.stringify(before) !== beforeJson) throw new Error(`${where}\n  the operation mutated its input document`);
    const issues = validateProject(next);
    if (issues.length) throw new Error(`${where}\n  accepted, but the document is invalid: ${JSON.stringify(issues.slice(0, 3))}`);
    const parsed = ProjectSchema.safeParse(next);
    if (!parsed.success) throw new Error(`${where}\n  accepted, but the document fails the schema: ${JSON.stringify(parsed.error.issues.slice(0, 2))}`);
    try {
      const total = T.frameIndexAt(timeline(next)!.duration, rate);
      for (const i of [0, int(Math.max(1, total)), Math.max(0, total - 1)]) evaluate(next, f(i));
      const plan = audioPlan(next);
      for (const c of plan.clips) {
        if (!(c.length > 0) || !Number.isFinite(c.gain) || !(c.speed > 0)) throw new Error(`audio plan clip ${c.clipId} has length ${c.length}, gain ${c.gain}, speed ${c.speed}`);
        for (const env of [c.fade, c.duck, c.vol ?? []]) for (let k = 1; k < env.length; k++) if (env[k]!.s < env[k - 1]!.s || !Number.isFinite(env[k]!.g)) throw new Error(`audio plan clip ${c.clipId} has a non-monotonic or non-finite envelope`);
      }
      summarize(next);
      for (const v of Object.keys(next.variants ?? {})) { const pv = projectVariant(next, v); const vi = validateProject(pv); if (vi.length) throw new Error(`format ${v} projects to an invalid document: ${JSON.stringify(vi.slice(0, 2))}`); evaluate(pv, f(0)); }
    } catch (e) { throw new Error(`${where}\n  accepted, but the document cannot be used: ${String((e as Error)?.stack ?? e).slice(0, 700)}`); }
    // undo path: the step's entity changes, applied backwards, restore the previous document
    const changes = diffEntities(before, next);
    const back = structuredClone(next);
    try { restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before }))); } catch (e) { throw new Error(`${where}\n  the step could not be undone: ${String(e).slice(0, 300)}`); }
    if (creativeProjection(back) !== creativeProjection(before)) throw new Error(`${where}\n  undoing the step does not restore the previous document (entities changed: ${changes.map((c) => c.id).slice(0, 8).join(', ')})`);
    doc = next;
  }
  return stats;
}

describe('fuzz: all editing operations, five frame rates', () => {
  const total = { accepted: 0, refused: 0, byOp: {} as Record<string, [number, number]> };
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}`, () => {
      const s = run(seed);
      total.accepted += s.accepted; total.refused += s.refused;
      for (const [k, [a, r]] of Object.entries(s.byOp)) { const t = (total.byOp[k] ??= [0, 0]); t[0] += a; t[1] += r; }
    });
  }
  it('the fuzz exercised every operation it knows, and each was accepted at least once', () => {
    const never = Object.entries(total.byOp).filter(([, [a]]) => a === 0).map(([k]) => k);
    console.log(`fuzz totals: ${total.accepted} accepted, ${total.refused} refused over ${SEEDS} seeds × ${STEPS} steps; never accepted: ${never.join(', ') || 'none'}`);
    expect(Object.keys(total.byOp).length).toBeGreaterThanOrEqual(40);
    if (SEEDS >= 40) expect(never).toEqual([]);
  });
});
