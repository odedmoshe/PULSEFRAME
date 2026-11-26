/**
 * The booth's ONE scene builder (wave 8 booth; verify "Cut first" 7: the gallery's makeScene/buildDoc stay where they are and
 * proof:creative is untouched). Used by the server for the export strip (Exporter.renderStill on this document) and by the web's picture
 * card (drawGraph(evaluate(doc, frame))), so both draw the same document from the same test-picture bytes. BUILDER W1 writes the body
 * (through applyTransaction with real ops, as the gallery does: import_asset ×2 with the REAL content hashes of the test pictures — the
 * gallery's `sha256:aaaa…` are fake — add_clip, set_transition / add_effect); the signature and the frame constants are the lead's.
 */
import * as T from '@pulseframe/time';
import { applyTransaction, type OpCall } from '../ops.ts';
import { createProject, type ProjectDocument } from '../schema.ts';
import { findEffect, transitionDef } from '../effects.ts';
import { switchFrame } from '../transitionTiming.ts';
import type { BoothMake } from './contract.ts';

/** The test pictures' size (16:9; both sides draw at this size). */
export const BOOTH_SCENE_W = 640;
export const BOOTH_SCENE_H = 360;
/** Raised by hand whenever the scene builder changes what it draws; part of every picture item's recipe (verify C7, L6). */
export const BOOTH_SCENE_VERSION = 1;
/** A built-in test picture as the scene imports it: its content hash (of the PNG bytes the server serves) and size. */
export interface BoothTestPictureRef { contentHash: string; byteSize: number }
/** The scene of one picture item: the document, the still frame (mid-transition or effect frame) and the frames «הפעלה» plays once. */
export interface BoothScene { doc: ProjectDocument; still: number; play: { first: number; count: number } }

/** 30 frames a second, as the gallery tiles. */
export const BOOTH_SCENE_RATE = { num: 30, den: 1 } as const;
/** Transition scene: picture a on frames 0–60, picture b from 60 with the transition over 60–74; «הפעלה» plays 56–78 once. */
export const BOOTH_TRANSITION_START = 60;
export const BOOTH_TRANSITION_FRAMES = 15;
/** Effect scene: picture a on frames 0–150 with the effect; the still is frame 12 (the strobe: frame 1); «הפעלה» plays 0–59 once. */
export const BOOTH_EFFECT_FRAMES = 150;
/** The document's id: synthetic, never a stored project (the export still renders it without one). */
export const BOOTH_SCENE_PROJECT_ID = 'prj_booth';

const at = (n: number) => T.frameTime(n, BOOTH_SCENE_RATE);
const imageAsset = (name: string, ref: BoothTestPictureRef) => ({
  kind: 'image' as const, name, contentHash: ref.contentHash, byteSize: ref.byteSize, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1),
  image: { width: BOOTH_SCENE_W, height: BOOTH_SCENE_H, codec: 'png', hasAlpha: false },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'booth' },
});
const SHA = /^sha256:[0-9a-f]{64}$/;

/**
 * The document, still frame and play window of one picture item, made through the real ops (import_asset ×2 with the pictures'
 * REAL content hashes, add_clip, set_transition or add_effect). Pure and deterministic: the same input gives the same document
 * (fixed id seed), so the web card and the export strip draw one document. Throws for an id that is no transition or effect.
 */
export function boothScene(make: Extract<BoothMake, { route: 'scene' }>, pictures: { a: BoothTestPictureRef; b: BoothTestPictureRef }): BoothScene {
  for (const ref of [pictures.a, pictures.b]) {
    if (!SHA.test(ref.contentHash) || !Number.isInteger(ref.byteSize) || ref.byteSize < 1) throw new Error('a booth test picture needs its real content hash and byte size');
  }
  let n = 0;
  const step = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => {
    const r = applyTransaction(doc, ops, { idSeed: `booth${n++}_`, actor: 'booth', allowInternal });
    return { doc: r.doc, out: r.results.map((x) => (x.output ?? {}) as Record<string, unknown>) };
  };
  const base = step(createProject({ id: BOOTH_SCENE_PROJECT_ID, name: 'Review booth', width: BOOTH_SCENE_W, height: BOOTH_SCENE_H, frameRate: { ...BOOTH_SCENE_RATE } }), [
    { op: 'import_asset', args: { asset: imageAsset('booth-test-a', pictures.a) } },
    { op: 'import_asset', args: { asset: imageAsset('booth-test-b', pictures.b) } },
  ], true);
  const a = base.out[0]!.assetId as string, b = base.out[1]!.assetId as string;
  const trackId = base.doc.sequences[base.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
  const clip = (assetId: string, start: number, dur: number): OpCall => ({ op: 'add_clip', args: { assetId, trackId, start: at(start), duration: at(dur), withLinkedAudio: false } });
  if (make.scene === 'transition') {
    const def = transitionDef(make.id);
    if (!def) throw new Error(`no transition ${make.id}`);
    const two = step(base.doc, [clip(a, 0, BOOTH_TRANSITION_START), clip(b, BOOTH_TRANSITION_START, 60)]);
    const doc = step(two.doc, [{ op: 'set_transition', args: { clipId: two.out[1]!.clipId as string, type: make.id, frames: BOOTH_TRANSITION_FRAMES } }]).doc;
    // the gallery's rule: the middle of the transition; a dip or a flash is one colour there, so the frame before the picture goes
    const sw = switchFrame(BOOTH_TRANSITION_FRAMES, null);
    const k = def.kernel;
    const still = BOOTH_TRANSITION_START + (k === 'punch' ? sw : k === 'block' ? sw - 2 : k === 'dip' || k === 'flash' ? 4 : Math.floor(BOOTH_TRANSITION_FRAMES / 2));
    return { doc, still, play: { first: 56, count: 23 } };
  }
  if (!findEffect(make.id)) throw new Error(`no effect ${make.id}`);
  const one = step(base.doc, [clip(a, 0, BOOTH_EFFECT_FRAMES)]);
  const doc = step(one.doc, [{ op: 'add_effect', args: { clipId: one.out[0]!.clipId as string, type: make.id } }]).doc;
  return { doc, still: make.id === 'light.strobe' ? 1 : 12, play: { first: 0, count: 60 } };
}
