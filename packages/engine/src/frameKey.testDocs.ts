/**
 * Test documents for the frame key (ADR-0024; frameKey.test.ts and frameKey.props.test.ts). Test support only: built through
 * the registered operations (core applyTransaction), never imported by product code, and not taken from packages/evals.
 *
 * The rich document is 300 frames at 30 fps and holds every layer kind and every thing the key must see:
 *
 *   frames   0 ─────── 60 ─────── 90 ─────── 120 ────── 150 ────── 180 ────── 210 ────── 240 ────── 300
 *   V1       A1 (file A, redaction on a motion track) │ B1 (file B, dissolve 10 frames in) │ C1 echo ┊ C2 echo (a cut of C1)
 *   V2       IMG (still, colour table + wave: GPU)    │ E (file A, time.split)  │ D (file B, stutter, grain, snow)
 *   adjust                                                                     │ ADJ 200–260 (colour adjust)
 *   titles   T1 20–70 (keyframed x, blur that follows the beat) · T3 30–80 (follows the motion track on V1)
 *            T2 100–160 (live fields: {date} {event} {name:P} {age:P})  · T4 150–210 (strobe: GPU)
 *   captions cue 40–130
 *   audio    music 0–300 (analysed beats) · sound effect 60–90 with an echo that rings on after it (a sound tail)
 */
import { createHash } from 'node:crypto';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type Asset, type Capture, type OpCall, type ProjectDocument } from '@pulseframe/core';
import type { FrameKeyContext } from './frameKey.ts';

export const R = { num: 30, den: 1 };
export const f = (n: number) => T.frameTime(n, R);
export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
let seed = 0;
export const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `fk${seed++}_`, actor: 'test', allowInternal });

const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const JUNE: Capture = { at: '2021-06-01T10:00:00', utcOffsetMinutes: 180, source: 'container' };
const DECEMBER: Capture = { at: '2024-12-26T10:00:00', utcOffsetMinutes: 120, source: 'container' };
const hex = (c: string) => `sha256:${c.repeat(64)}`;
export const video = (name: string, c: string, capture?: Capture): Omit<Asset, 'id'> => ({
  kind: 'video', name, contentHash: hex(c), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, provenance, ...(capture ? { capture } : {}),
});
export const still = (c: string): Omit<Asset, 'id'> => ({ kind: 'image', name: 'p.png', contentHash: hex(c), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance });
export const table = (c: string): Omit<Asset, 'id'> => ({ kind: 'lut', name: 'look.cube', contentHash: hex(c), byteSize: 1, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 2, title: null }, provenance } as Omit<Asset, 'id'>);
export const sound = (name: string, c: string, seconds: number): Omit<Asset, 'id'> => ({ kind: 'audio', name, contentHash: hex(c), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(seconds, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance });

/** What varies between rich documents (random documents in the property tests); the defaults are the picture in the header. */
export interface Shape { trFrames: number; echoCount: number; echoDelay: number; cutAt: number; lag: number; birthDate: string }
export const DEFAULT_SHAPE: Shape = { trFrames: 10, echoCount: 3, echoDelay: 4, cutAt: 240, lag: 3, birthDate: '2016-11-04' };

/** The ids of the rich document, by role. */
export interface Rich {
  doc: ProjectDocument;
  shape: Shape;
  assets: { A: string; B: string; IMG: string; LUT: string; SONG: string; SFX: string };
  clips: { A1: string; B1: string; C1: string; C2: string; IMG: string; E: string; D: string; ADJ: string; T1: string; T2: string; T3: string; T4: string; music: string; sfx: string; cue: string };
  effects: { T1blur: string; C1echo: string; Esplit: string; Dstutter: string; Dgrain: string; Dsnow: string; IMGlut: string; IMGwave: string; T4strobe: string };
  tracks: { V1: string; V2: string; captions: string };
  motionTrack: string;
  person: string;
}

const out = (r: { results: { output?: Record<string, unknown> }[] }, i: number, key: string) => r.results[i]!.output![key] as string;
const clipOf = (doc: ProjectDocument, trackId: string, start: number) => doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === trackId)!.clips.find((c) => T.eq(c.start, f(start)))!.id;

/** The rich document (see the file header). Deterministic: the same ids every time. */
export function richDoc(partial: Partial<Shape> = {}): Rich {
  const shape = { ...DEFAULT_SHAPE, ...partial };
  seed = 0;
  let r = tx(createProject({ id: 'prj_fk', name: 'Frame key', width: 1280, height: 720, frameRate: R }), [
    { op: 'import_asset', args: { asset: video('a.mp4', 'a', JUNE) } },
    { op: 'import_asset', args: { asset: video('b.mp4', 'b', DECEMBER) } },
    { op: 'import_asset', args: { asset: still('c') } },
    { op: 'import_asset', args: { asset: table('d') } },
    { op: 'import_asset', args: { asset: sound('song.wav', 'e', 30) } },
    { op: 'import_asset', args: { asset: sound('ding.wav', 'f', 2) } },
  ], true);
  const A = out(r, 0, 'assetId'), B = out(r, 1, 'assetId'), IMG = out(r, 2, 'assetId'), LUT = out(r, 3, 'assetId'), SONG = out(r, 4, 'assetId'), SFX = out(r, 5, 'assetId');
  const times = Array.from({ length: 50 }, (_, i) => T.rt(250 + i * 500, 1000));
  r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId: SONG, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-17T00:00:00Z', times, bpm: 120, downbeats: times.filter((_, i) => i % 4 === 0), meter: 4 } }], true);
  // pictures
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: A, start: f(0), sourceIn: T.rt(1, 1), duration: f(90), withLinkedAudio: false } },
    { op: 'add_track', args: { kind: 'video' } },
  ]);
  const A1 = out(r, 0, 'clipId'), V1 = out(r, 0, 'trackId'), V2 = out(r, 1, 'trackId');
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: B, start: f(90), sourceIn: T.rt(1, 1), duration: f(90), trackId: V1, withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: A, start: f(180), sourceIn: T.rt(5, 1), duration: f(120), trackId: V1, withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: IMG, start: f(0), duration: f(60), trackId: V2 } },
    { op: 'add_clip', args: { assetId: A, start: f(60), sourceIn: T.rt(2, 1), duration: f(60), trackId: V2, withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: B, start: f(120), sourceIn: T.rt(3, 1), duration: f(60), trackId: V2, withLinkedAudio: false } },
  ]);
  const B1 = out(r, 0, 'clipId'), C1 = out(r, 1, 'clipId'), IMGc = out(r, 2, 'clipId'), E = out(r, 3, 'clipId'), D = out(r, 4, 'clipId');
  r = tx(r.doc, [
    { op: 'set_transition', args: { clipId: B1, type: 'dissolve', frames: shape.trFrames } },
    { op: 'add_effect', args: { clipId: C1, type: 'time.echo', params: { count: shape.echoCount, delay: shape.echoDelay } } },
    { op: 'add_effect', args: { clipId: E, type: 'time.split', params: { lag: shape.lag } } },
    { op: 'add_effect', args: { clipId: D, type: 'time.stutter' } },
    { op: 'add_effect', args: { clipId: D, type: 'stylize.grain' } },
    { op: 'add_effect', args: { clipId: D, type: 'overlay.snow' } },
    { op: 'add_effect', args: { clipId: IMGc, type: 'color.lut', params: { lut: LUT } } },
    { op: 'add_effect', args: { clipId: IMGc, type: 'distort.wave' } },
    { op: 'set_clip_transform', args: { clipId: A1, transform: { scale: 1.1, rotation: 3 } } },
  ]);
  const C1echo = out(r, 1, 'effectId'), Esplit = out(r, 2, 'effectId'), Dstutter = out(r, 3, 'effectId'), Dgrain = out(r, 4, 'effectId'), Dsnow = out(r, 5, 'effectId'), IMGlut = out(r, 6, 'effectId'), IMGwave = out(r, 7, 'effectId');
  // the echo clip is cut in two: its second piece's taps read the first piece (the run of cut pieces, ADR-0011)
  r = tx(r.doc, [{ op: 'split_clip', args: { clipId: C1, at: f(shape.cutAt) } }]);
  const C2 = clipOf(r.doc, V1, shape.cutAt);
  // titles, adjustment, captions
  r = tx(r.doc, [
    { op: 'add_text', args: { text: 'שלום', start: f(20), duration: f(50) } },
    { op: 'add_text', args: { text: 'x', start: f(100), duration: f(60) } },
    { op: 'add_text', args: { text: 'עוקב', start: f(30), duration: f(50) } },
    { op: 'add_text', args: { text: 'הבזק', start: f(150), duration: f(60) } },
    { op: 'add_adjustment', args: { span: { start: f(200), duration: f(60) }, effects: [{ type: 'color.adjust', params: { saturation: 1.4 } }] } },
    { op: 'add_cue', args: { start: f(40), duration: f(90), text: 'שלום עולם' } },
  ]);
  const T1 = out(r, 0, 'clipId'), T2 = out(r, 1, 'clipId'), T3 = out(r, 2, 'clipId'), T4 = out(r, 3, 'clipId'), ADJ = out(r, 4, 'clipId');
  const captionTrack = r.doc.sequences[r.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'caption')!;
  const cue = captionTrack.clips[0]!.id;
  r = tx(r.doc, [
    { op: 'set_keyframe', args: { clipId: T1, property: 'x', time: f(20), value: -0.2 } },
    { op: 'set_keyframe', args: { clipId: T1, property: 'x', time: f(60), value: 0.2 } },
    { op: 'add_effect', args: { clipId: T1, type: 'blur.gaussian', params: { radius: 0.01 } } },
    { op: 'add_effect', args: { clipId: T4, type: 'light.strobe', params: { amount: 1, rate: 2 } } },
  ]);
  const T1blur = out(r, 2, 'effectId'), T4strobe = out(r, 3, 'effectId');
  r = tx(r.doc, [{ op: 'set_effect_modulator', args: { clipId: T1, effectId: T1blur, param: 'radius', modulator: { depth: 0.02 } } }]);
  // sound: analysed music under everything, and a short sound with an echo that rings on after its end
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: SONG, start: f(0), duration: f(300) } }]);
  const music = out(r, 0, 'clipId');
  r = tx(r.doc, [{ op: 'add_track', args: { kind: 'audio' } }]);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: SFX, start: f(60), duration: f(30), trackId: out(r, 0, 'trackId') } }]);
  const sfx = out(r, 0, 'clipId');
  r = tx(r.doc, [{ op: 'add_audio_effect', args: { clipId: sfx, type: 'space.echo', params: { delayMs: 250, repeats: 4 } } }]);
  // motion track on file A: a title follows it, and A1 hides a region that moves with it
  r = tx(r.doc, [{ op: 'create_motion_track', args: { assetId: A, kind: 'region', frame: 30, x: 5000, y: 5000, w: 1500, h: 1500 } }]);
  const motionTrack = out(r, 0, 'motionTrackId');
  const n = 400;
  r = tx(r.doc, [{ op: 'attach_motion_track', args: { motionTrackId: motionTrack, from: 31, x: Array.from({ length: n }, (_, i) => 4000 + i * 7), y: Array.from({ length: n }, (_, i) => 5000 - i * 3), s: Array(n).fill(1000), q: Array(n).fill(90), st: Array(n).fill(1), method: 'test', params: {}, createdAt: 'test' } }], true);
  r = tx(r.doc, [
    { op: 'set_redact_region', args: { clipId: A1, region: { motionTrackId: motionTrack, x: 0, y: 0, weakIsLost: false, style: 'blur' } } },
    { op: 'set_clip_follow', args: { clipId: T3, follow: { motionTrackId: motionTrack, targetTrackId: V1, scale: false, smooth: 0 } } },
  ]);
  // live fields: the capture date of the picture under the title, its event, and a person's name and age
  r = tx(r.doc, [{ op: 'add_person', args: { name: 'נועה', birthDate: shape.birthDate, form: 'f' } }]);
  const person = out(r, 0, 'personId');
  r = tx(r.doc, [{ op: 'update_text', args: { clipId: T2, text: `{date} · {event} · {name:${person}} {age:${person}}` } }, { op: 'set_text_fields', args: { clipId: T2, enabled: true } }]);
  const doc = structuredClone(r.doc);
  const origin = { method: 'manual' as const, gapMinutes: null, createdBy: 'test', edited: true };
  doc.events = { evt_b: { id: 'evt_b', name: 'חנוכה אצל סבתא', afterSunset: null, assetIds: [B], origin } };
  return {
    doc,
    shape,
    assets: { A, B, IMG, LUT, SONG, SFX },
    clips: { A1, B1, C1, C2, IMG: IMGc, E, D, ADJ, T1, T2, T3, T4, music, sfx, cue },
    effects: { T1blur, C1echo, Esplit, Dstutter, Dgrain, Dsnow, IMGlut, IMGwave, T4strobe },
    tracks: { V1, V2, captions: captionTrack.id },
    motionTrack,
    person,
  };
}

/**
 * A key context over a document: asset hashes are the library's content hashes (what the server keys by), fonts and effect
 * versions come from small tables the tests change, and the adapter is a software one unless a test says otherwise.
 */
export interface TestEnv { fonts: Record<string, string>; versions: Record<string, number>; assetOverride: Record<string, string | null>; gpu: FrameKeyContext['gpu']; output: { width: number; height: number } }
export const baseEnv = (): TestEnv => ({ fonts: { Heebo: 'font-heebo-1' }, versions: {}, assetOverride: {}, gpu: { adapter: 'swiftshader|test', software: true }, output: { width: 640, height: 360 } });
export function ctxFor(doc: ProjectDocument, env: TestEnv = baseEnv()): FrameKeyContext {
  return {
    digest: sha256,
    output: env.output,
    assetHash: (id) => (Object.hasOwn(env.assetOverride, id) ? env.assetOverride[id]! : doc.assets[id]?.contentHash ?? null),
    fontHash: (family) => env.fonts[family] ?? null,
    effectVersion: (type) => env.versions[type] ?? 1,
    gpu: env.gpu,
  };
}
