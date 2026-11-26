/**
 * Test support for the colour curves (wave 8 grade): a small project built through the registered ops. Never imported by product code.
 */
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, diffEntities, findClip, OpError, restoreEntities, type Clip, type EffectInstance, type OpCall, type ProjectDocument } from './index.ts';

export const R = { num: 30, den: 1 };
export const f = (n: number) => T.frameTime(n, R);
let n = 0;
export const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `gc${n++}_`, actor: 'test', allowInternal });
export const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };

/** A curved test value: master and red. */
export const CURVED = { master: [[0, 0], [64, 40], [192, 210], [255, 255]], r: [[0, 10], [255, 250]] } as const;
export const curvedArgs = () => structuredClone(CURVED) as unknown as { master: [number, number][]; r: [number, number][] };

/** A picture with its linked sound (0–4 s), a title, a caption track with one cue, and a locked video track with a clip. */
export function project() {
  let r = tx(createProject({ id: 'prj_gc', name: 'gc', frameRate: R }), [{ op: 'import_asset', args: { asset: video } }], true);
  const vid = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(120) } },
    { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } },
    { op: 'add_track', args: { kind: 'video' } },
    { op: 'add_caption_track', args: { mode: 'manual' } },
    { op: 'add_cue', args: { start: f(0), duration: f(30), text: 'cue' } },
  ]);
  const o = r.results.map((x) => x.output!);
  const lockedTrack = o[2]!.trackId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(60), trackId: lockedTrack, withLinkedAudio: false } }]);
  const lockedClip = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'update_track', args: { trackId: lockedTrack, locked: true } }]);
  const cue = Object.values(r.doc.sequences).flatMap((s) => s.tracks).find((t) => t.kind === 'caption')!.clips[0]!.id;
  return { doc: r.doc, asset: vid, picture: o[0]!.clipId as string, sound: o[0]!.audioClipId as string, title: o[1]!.clipId as string, cue, lockedClip, lockedTrack };
}
export const clipOf = (d: ProjectDocument, id: string): Clip => findClip(d, id)!.clip;
export const gradeOf = (d: ProjectDocument, id: string): EffectInstance | undefined => ((clipOf(d, id) as { effects?: EffectInstance[] }).effects ?? []).find((e) => e.type === 'color.grade');
/** One undo, as the store does it. */
export function undone(before: ProjectDocument, after: ProjectDocument): ProjectDocument {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return back;
}
