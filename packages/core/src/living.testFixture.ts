/** Synthetic fixtures of «תמונה חיה» tests (core and server): no picture is decoded, nobody has looked at anything. */
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, LIVING_EFFECT, OpError, type ClipDepth, type EffectInstance, type OpCall, type ProjectDocument } from './index.ts';

export const R = { num: 30, den: 1 };
export const f = (n: number) => T.frameTime(n, R);
let seq = 0;
export const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = true) => applyTransaction(doc, ops, { idSeed: `lv${seq++}_`, actor: 'test', allowInternal });
export const refused = (doc: ProjectDocument, ops: OpCall[]): OpError => { try { tx(doc, ops, false); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const PHOTO = (hex: string) => ({ kind: 'image' as const, name: `p${hex}.png`, contentHash: `sha256:${hex.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov });
const VIDEO = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };
export const DEPTH: ClipDepth = { v: 1, base: { kind: 'ramp', horizon: 400 }, strokes: [{ layer: 'near', size: 120, pts: [500, 600, 520, 640] }] };

/** A photo clip of 150 frames (5 s) with a drawn depth, a second photo, a video clip on its own track. */
export function livingDoc() {
  let r = tx(createProject({ id: 'prj_lv', name: 'L', width: 640, height: 360, frameRate: R }), [
    { op: 'import_asset', args: { asset: PHOTO('c') } }, { op: 'import_asset', args: { asset: PHOTO('d') } }, { op: 'import_asset', args: { asset: VIDEO } },
  ]);
  const [pic, pic2, vid] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: pic, start: f(0), duration: f(150) } },
    { op: 'add_clip', args: { assetId: pic2, start: f(150), duration: f(150) } },
    { op: 'add_track', args: { kind: 'video' } },
  ]);
  const clip = r.results[0]!.output!.clipId as string, clip2 = r.results[1]!.output!.clipId as string, v2 = r.results[2]!.output!.trackId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(90), trackId: v2, withLinkedAudio: false } }, { op: 'set_clip_depth', args: { clipId: clip, depth: DEPTH } }]);
  const video = r.results[0]!.output!.clipId as string;
  return { doc: r.doc, pic, pic2, vid, clip, clip2, video };
}
/**
 * A living picture written straight into the document (set_living_picture is W1's): push, amount, travel keyed 0 → 1 over the
 * clip with ease-in-out, exactly the keys the op will write (livingTravelKeys).
 */
export function withLiving(doc: ProjectDocument, clipId: string, amount = 0.5, move: 'push' | 'slide' = 'push', frames = 150): ProjectDocument {
  const d = structuredClone(doc);
  const c = findClip(d, clipId)!.clip;
  const fx: EffectInstance = { id: `fx_living_${clipId}`, type: LIVING_EFFECT, enabled: true, params: { move, amount, travel: 0 },
    keyframes: { travel: [{ time: f(0), value: 0, easing: 'ease-in-out' }, { time: f(frames - 1), value: 1, easing: 'linear' }] } };
  c.effects = [...(c.effects ?? []), fx];
  return d;
}
