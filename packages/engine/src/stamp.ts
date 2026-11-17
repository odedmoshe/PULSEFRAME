/**
 * stylize.date-stamp: seven-segment glyphs as polygons (no font), drawn by look.ts.
 *
 * STUB (lead pre-pass): the signatures below are the contract; the bodies are placeholders until W2 builds them.
 */
/** The characters a stamp may hold; the same pattern as the effect's `text` parameter (core effects.ts). */
export const STAMP_TEXT = /^[0-9 .:'\/-]{0,20}$/;
/** Polygons (frame pixels) of a seven-segment stamp in a corner of a layer box of width×height. */
export function stampPolygons(text: string, sizePx: number, corner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left', width: number, height: number): { x: number; y: number }[][] { return []; }
