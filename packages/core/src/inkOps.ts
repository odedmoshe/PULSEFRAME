/**
 * The two public operations of «ציור חי» (wave 8 ink, version 1; inkContract.ts). Registered on import (index.ts). Complete: each
 * is argument checks plus the carrier's placeDrawnClip (add_ink) or a field change (edit_ink), settled by the verifier.
 * - One drawing session is ONE add_ink: one transaction, one undo (the undo record is the clip entity, plus the track entities when
 *   a track is made). The editor's session ghost is the same call applied locally with play 'all' (ink-verify C2), never stored.
 * - add_ink takes readable integer arrays around the frame CENTRE, puts the clip's anchor at the centre of the strokes' bounding
 *   box (so set_clip_follow's offset keeps the drawing where it was drawn) and stores the points packed around the anchor.
 * - The document cap is checked here and only here (C6). add_ink stores what it is given: it does not simplify (the editor does).
 * - edit_ink changes play mode, speed and the fade only (no stroke is added, removed or re-opened in version 1). The fade is the
 *   body of animate_clip (out: fade), written as opacity keys on the clip; the compositor fades a drawn layer through its buffer (C7).
 * Both are left out of the assistant (ASSISTANT_EXCLUDED_OPS) so its reviewed prompt is unchanged; on MCP and REST as ordinary ops.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { defineOp, getOp, mustClip, OpError, placeDrawnClip } from './ops.ts';
import { RationalTimeSchema } from './keyframe.ts';
import {
  INK_COORD_MAX, INK_HOLD_MS, INK_PLAYS, INK_SPEEDS, INK_UNIT, InkStrokeInSchema, MAX_CLIP_POINTS, MAX_CLIP_STROKES, MAX_DOC_POINTS, MAX_DRAW_MS,
  MAX_POINT_GAP_MS, MAX_STROKE_POINTS, inkDocumentPoints, inkPoints, inkRefusal, isInkPayload, packInkPoints, type InkPayload, type InkStroke, type InkStrokeIn,
} from './inkContract.ts';

export const INK_PUBLIC_OPS = ['add_ink', 'edit_ink'] as const;

export const AddInkArgsSchema = z.object({
  sequenceId: z.string().optional(),
  trackId: z.string().optional().describe('A titles track; absent = the first unlocked titles track free over the range, else a new one'),
  start: RationalTimeSchema.describe('Frame-aligned'),
  duration: RationalTimeSchema.optional().describe('Frame-aligned; absent = the drawing time rounded up to whole frames, plus 2 s'),
  strokes: z.array(InkStrokeInSchema).min(1).max(MAX_CLIP_STROKES),
  play: z.enum(INK_PLAYS).optional().describe('drawn (default): draws itself on as it was drawn; all: everything from the first frame'),
  speed: z.enum(INK_SPEEDS).optional(),
}).strict();
export const EditInkArgsSchema = z.object({
  clipId: z.string(),
  play: z.enum(INK_PLAYS).optional(),
  speed: z.enum(INK_SPEEDS).optional(),
  fadeOut: z.literal(true).optional().describe('Fade out at the end, exactly as animate_clip out: fade (12 frames); remove it with clear_keyframes on opacity, or undo'),
}).strict();

/** Whole frames of `rate` that cover `ms` (rounded up). */
const framesCovering = (ms: number, rate: T.Rate): number => {
  const t = T.rt(ms, 1000), k = T.frameIndexAt(t, rate);
  return T.eq(T.frameTime(k, rate), t) ? k : k + 1;
};

/** Checks one stroke's arrays (in order of the refusal table) and returns them unchanged. */
function checkStroke(s: InkStrokeIn, i: number): void {
  const n = s.x.length;
  if (s.y.length !== n || s.t.length !== n) throw inkRefusal('lengths', { stroke: i }, i);
  if (n > MAX_STROKE_POINTS) throw inkRefusal('strokeTooLong', { stroke: i, points: n }, i, n);
  if (s.t[0] !== 0) throw inkRefusal('time', { stroke: i }, i);
  for (let j = 1; j < n; j++) {
    const dt = s.t[j]! - s.t[j - 1]!;
    if (dt < 0) throw inkRefusal('time', { stroke: i }, i);
    if (dt > MAX_POINT_GAP_MS) throw inkRefusal('gap', { stroke: i, ms: dt }, i, dt);
  }
  for (let j = 0; j < n; j++) {
    const v = Math.max(Math.abs(s.x[j]!), Math.abs(s.y[j]!));
    if (v > INK_COORD_MAX) throw inkRefusal('coord', { stroke: i, units: v }, i, v);
  }
  const end = s.at + s.t[n - 1]!;
  if (end > MAX_DRAW_MS) throw inkRefusal('long', { stroke: i, ms: end }, i, end);
}

defineOp({
  name: 'add_ink',
  version: 1,
  description: 'Add a live drawing «ציור חי»: strokes drawn on the picture that draw themselves on in the film, in the order and at the pace they were drawn (play drawn), or all at once (play all). Each stroke has a brush (marker «טוש», highlighter «מדגש», neon «ניאון»), an upper- or lower-case #RRGGBB colour, a width in 1/10 000 of the frame height, `at` (ms from the start of the drawing to its first point) and integer arrays x, y (1/10 000 of the frame HEIGHT from the frame centre; y downwards) and t (ms since the stroke\'s first point, from 0, never going back). Limits: 2 000 points a stroke, 200 strokes and 8 000 points a drawing, 24 000 drawing points in the project. The drawing goes on a titles track like a title; it is moved, scaled, faded (animate_clip), followed (set_clip_follow), split and trimmed like one, and has no words. The points are stored packed; get_timeline shows counts and the box only. Nobody here has looked at the result.',
  args: AddInkArgsSchema,
  apply(d, a, ctx) {
    if (a.strokes.length > MAX_CLIP_STROKES) throw inkRefusal('tooManyStrokes', { strokes: a.strokes.length }, a.strokes.length);
    a.strokes.forEach(checkStroke);
    const adding = a.strokes.reduce((s, k) => s + k.x.length, 0);
    if (adding > MAX_CLIP_POINTS) throw inkRefusal('tooLarge', { points: adding }, adding);
    const held = inkDocumentPoints(d);
    if (held + adding > MAX_DOC_POINTS) throw inkRefusal('documentFull', { points: held, adding }, held, adding);
    // the anchor: the centre of the points' bounding box, in whole units (the floor of the midpoint, so the rebased points stay integers)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of a.strokes) for (let j = 0; j < s.x.length; j++) { x0 = Math.min(x0, s.x[j]!); x1 = Math.max(x1, s.x[j]!); y0 = Math.min(y0, s.y[j]!); y1 = Math.max(y1, s.y[j]!); }
    if (x1 - x0 > INK_COORD_MAX || y1 - y0 > INK_COORD_MAX) throw inkRefusal('span', { units: Math.max(x1 - x0, y1 - y0) }, Math.max(x1 - x0, y1 - y0));
    const ax = Math.floor((x0 + x1) / 2), ay = Math.floor((y0 + y1) / 2);
    const strokes: InkStroke[] = a.strokes.map((s) => ({
      brush: s.brush, color: s.color.toUpperCase(), width: s.width, at: s.at, n: s.x.length,
      pts: packInkPoints({ x: s.x.map((v) => v - ax), y: s.y.map((v) => v - ay), t: s.t }),
    }));
    const drawn: InkPayload = { kind: 'ink', v: 1, play: a.play ?? 'drawn', speed: a.speed ?? '1', strokes };
    const seq = Object.hasOwn(d.sequences, a.sequenceId ?? d.mainSequenceId) ? d.sequences[a.sequenceId ?? d.mainSequenceId] : undefined;
    const frame = seq?.format ?? d.settings;
    const rate = d.settings.frameRate;
    const drawMs = Math.max(...a.strokes.map((s) => s.at + s.t[s.t.length - 1]!));
    const duration = a.duration ?? T.frameTime(framesCovering(drawMs, rate) + framesCovering(INK_HOLD_MS, rate), rate);
    // transform x is a fraction of the frame WIDTH, y of its height; the points are in frame heights on both axes
    const transform = { x: (ax * frame.height) / (INK_UNIT * frame.width), y: ay / INK_UNIT };
    const { clip, track } = placeDrawnClip(d, { sequenceId: a.sequenceId, trackId: a.trackId, start: a.start, duration, drawn, transform }, ctx);
    return { affectedIds: [clip.id], summary: `Added a drawing of ${strokes.length} strokes (${inkPoints(drawn)} points) at ${T.toSeconds(a.start)} s`, output: { clipId: clip.id, trackId: track.id } };
  },
});

defineOp({
  name: 'edit_ink',
  version: 1,
  description: 'Change a live drawing made with add_ink: play (drawn: draws itself on as it was drawn; all: everything from the first frame), speed (1), and fadeOut: true, which fades it out at the end exactly as animate_clip out: fade does (opacity keys on the clip). Its strokes cannot be changed in this version: delete the clip and draw again.',
  args: EditInkArgsSchema,
  apply(d, a, ctx) {
    const { clip } = mustClip(d, a.clipId);
    if (clip.type !== 'drawn' || !isInkPayload(clip.drawn)) throw inkRefusal('notInk', { clipId: a.clipId }, a.clipId);
    if (a.play === undefined && a.speed === undefined && a.fadeOut === undefined) throw inkRefusal('nothing', { clipId: a.clipId });
    const next: InkPayload = { ...clip.drawn };
    if (a.play !== undefined) next.play = a.play;
    if (a.speed !== undefined) next.speed = a.speed;
    clip.drawn = next;
    if (a.fadeOut) {
      const animate = getOp('animate_clip');
      if (!animate) throw new OpError('unknown_op', 'operation animate_clip is not registered in this build', { op: 'animate_clip' });
      animate.apply(d, { clipId: clip.id, out: 'fade' }, ctx);
    }
    return { affectedIds: [clip.id], summary: `Changed a drawing (${[a.play && `play ${a.play}`, a.speed && `speed ${a.speed}`, a.fadeOut && 'fade out'].filter(Boolean).join(', ')})`, output: { clipId: clip.id } };
  },
});
