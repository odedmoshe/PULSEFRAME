/**
 * The booth's ONE scene builder (wave 8 booth; verify "Cut first" 7: the gallery's makeScene/buildDoc stay where they are and
 * proof:creative is untouched). Used by the server for the export strip (Exporter.renderStill on this document) and by the web's picture
 * card (drawGraph(evaluate(doc, frame))), so both draw the same document from the same test-picture bytes. BUILDER W1 writes the body
 * (through applyTransaction with real ops, as the gallery does: import_asset ×2 with the REAL content hashes of the test pictures — the
 * gallery's `sha256:aaaa…` are fake — add_clip, set_transition / add_effect); the signature and the frame constants are the lead's.
 */
import type { ProjectDocument } from '../schema.ts';
import { BoothNotBuiltError, type BoothMake } from './contract.ts';

/** The test pictures' size (16:9; both sides draw at this size). */
export const BOOTH_SCENE_W = 640;
export const BOOTH_SCENE_H = 360;
/** Raised by hand whenever the scene builder changes what it draws; part of every picture item's recipe (verify C7, L6). */
export const BOOTH_SCENE_VERSION = 1;
/** A built-in test picture as the scene imports it: its content hash (of the PNG bytes the server serves) and size. */
export interface BoothTestPictureRef { contentHash: string; byteSize: number }
/** The scene of one picture item: the document, the still frame (mid-transition or effect frame) and the frames «הפעלה» plays once. */
export interface BoothScene { doc: ProjectDocument; still: number; play: { first: number; count: number } }

export function boothScene(make: Extract<BoothMake, { route: 'scene' }>, pictures: { a: BoothTestPictureRef; b: BoothTestPictureRef }): BoothScene {
  void make; void pictures;
  throw new BoothNotBuiltError('boothScene');
}
