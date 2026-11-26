/**
 * «הציעו עיניים» — the pure logic of the proposal in the marking view (wave 8 picmodels W3). No React, no browser API, no storage.
 * A proposal is what the server answered (two points per face, as shown), held in the dialog's memory only. Faces keep the server's
 * order (left to right by position, never a score); the letters א/ב (A/B) follow the READING order of the interface language, so in
 * Hebrew the rightmost face is א. Choosing by a click (plan §4): the faces whose middle is within 1.5 × that face's own eye distance
 * of the click are candidates; two candidates whose distances differ by less than 1 shown pixel choose none («לחצו קרוב יותר…»).
 * Accepting is placePoint twice, so the same minimum eye distance and the same order rule apply as for two hand clicks.
 */
import type { EyePoint, EyesAnswer, ShownSize, SuggestEyeOrder } from '@pulseframe/core';
import { placePoint, type Mark } from './growing.logic.ts';

export type EyesLang = 'he' | 'en';
export type EyesFacePoints = readonly [EyePoint, EyePoint];
/** One answer in the dialog's memory: the picture and frame it was asked for, the outcome, the faces (server order) and the chosen face. */
export interface Proposal {
  assetId: string; frame: number | null;
  outcome: EyesAnswer['outcome'];
  faces: readonly EyesFacePoints[];
  /** index into `faces` (server order), or null: nothing chosen */
  chosen: number | null;
}
/** The proposal of an answer: one face is chosen at once, several leave nothing chosen. */
export function proposalOf(assetId: string, frame: number | null, a: EyesAnswer): Proposal {
  const faces = a.faces.map((f) => [{ ...f.eyes[0] }, { ...f.eyes[1] }] as const);
  return { assetId, frame, outcome: a.outcome, faces, chosen: a.outcome === 'faces' && faces.length === 1 ? 0 : null };
}
/** A proposal belongs to one picture and one frame; anything else is not shown. */
export const proposalFor = (p: Proposal | undefined, assetId: string, frame: number | null): Proposal | null => (p && p.assetId === assetId && p.frame === frame ? p : null);

/** The face indices in reading order: left to right in English, right to left in Hebrew (the stage itself stays ltr). */
export function readingOrder(n: number, lang: EyesLang): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  return lang === 'he' ? idx.reverse() : idx;
}
/** The place (0 = א / A) of face `face` in reading order. */
export const letterIndex = (face: number, n: number, lang: EyesLang): number => readingOrder(n, lang).indexOf(face);

const mid = (f: EyesFacePoints): EyePoint => ({ u: (f[0].u + f[1].u) / 2, v: (f[0].v + f[1].v) / 2 });
const px = (a: EyePoint, b: EyePoint, shown: ShownSize) => Math.hypot((a.u - b.u) * shown.width, (a.v - b.v) * shown.height);
/** The distance between the two eyes of a face, in shown pixels. */
export const eyeDistancePx = (f: EyesFacePoints, shown: ShownSize): number => px(f[0], f[1], shown);
/** Candidates reach 1.5 × the face's own eye distance. */
export const CHOICE_REACH = 1.5;
/** Two candidates this close (shown px) in distance cannot be told apart. */
export const CHOICE_TIE_PX = 1;

export type ClickChoice = { kind: 'chosen'; face: number } | { kind: 'closer' } | { kind: 'none' };
/** A click while faces are shown: a face chosen, «click closer», or no face near it (the caller drops the proposal and places a hand point). */
export function chooseByClick(faces: readonly EyesFacePoints[], click: EyePoint, shown: ShownSize): ClickChoice {
  const near = faces
    .map((f, face) => ({ face, d: px(mid(f), click, shown), reach: CHOICE_REACH * eyeDistancePx(f, shown) }))
    .filter((c) => c.d <= c.reach)
    .sort((a, b) => a.d - b.d || a.face - b.face);
  if (near.length === 0) return { kind: 'none' };
  if (near.length >= 2 && near[1]!.d - near[0]!.d < CHOICE_TIE_PX) return { kind: 'closer' };
  return { kind: 'chosen', face: near[0]!.face };
}

/** `]` (+1) and `[` (-1): the next face in reading order, wrapping; from nothing chosen `]` gives the first letter and `[` the last. Returns the face index. */
export function moveChosen(chosen: number | null, n: number, lang: EyesLang, d: -1 | 1): number | null {
  if (n <= 0) return null;
  const ord = readingOrder(n, lang);
  if (chosen === null) return d === 1 ? ord[0]! : ord[n - 1]!;
  const at = ord.indexOf(chosen);
  return ord[(at + d + n) % n]!;
}

/** The two eyes of a face in the order the mark will hold them (growing's own order rule, as two clicks would). */
export function orderedEyes(f: EyesFacePoints, shown: ShownSize, order: SuggestEyeOrder | null): [EyePoint, EyePoint] {
  if (order) { try { return order(f[0], f[1], shown); } catch { /* the click order stays */ } }
  return [f[0], f[1]];
}

/** Accepting a face: placePoint twice from an empty mark of the same frame. `refused` when the two points are closer than growing allows. */
export function acceptFace(mark: Mark, f: EyesFacePoints, shown: ShownSize, order: SuggestEyeOrder | null): { mark: Mark; refused: 'too_close' | null } {
  const start: Mark = { ...mark, clicks: [], eyes: null };
  const a = placePoint(start, f[0], shown, order);
  const b = placePoint(a.mark, f[1], shown, order);
  return b.refused ? { mark, refused: b.refused } : { mark: b.mark, refused: null };
}

/** The setup of the picture model as the interface words it: a code (the models row's), or a failure to read it. */
export type EyesSetup = { code: 'not_built' | 'licence_blocked' | 'engine_unverified' | 'engine_not_configured' | 'engine_not_working' | 'disk_insufficient' | 'model_missing' | 'ready'; module: string | null; missingBytes: number } | { code: 'unknown' };
/** The yunet row of GET /picture-models (a missing row, e.g. a credential that may not see it, reads as not built). */
export function setupFromModels(models: ReadonlyArray<{ id: string; code: string; module?: string | null; missingBytes: number }>): EyesSetup {
  const row = models.find((m) => m.id === 'yunet');
  if (!row) return { code: 'not_built', module: null, missingBytes: 0 };
  return { code: row.code as Exclude<EyesSetup, { code: 'unknown' }>['code'], module: row.module ?? null, missingBytes: row.missingBytes };
}
