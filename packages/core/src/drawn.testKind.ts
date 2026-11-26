/**
 * TEST-ONLY drawn kind (wave 8 carrier; a labelled test double, never registered by production code): a filled rectangle
 * with a colour, a size in frame-height units around the clip's anchor, and an integer `offset` in frames that split and
 * trim-start move (the clip-local time of its content at the clip's start). Its painter is engine drawnPainters.testKind.ts.
 * Tests call registerTestDrawnKind() (idempotent) and may unregisterDrawnKind('test') afterwards.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { drawnKind, registerDrawnKind, type DrawnKindDef, type DrawnPayload } from './drawn.ts';
import { defineOp, getOp, placeDrawnClip } from './ops.ts';
import { RationalTimeSchema } from './schema.ts';

export const TEST_DRAWN_UNIT = 10_000;
export const TestDrawnSchema = z.object({
  kind: z.literal('test'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  /** Half sizes in 1/10 000 of the frame height. */
  w: z.number().int().min(1).max(20_000),
  h: z.number().int().min(1).max(20_000),
  /** Content frames already played at the clip's start (split / trim-start move it; may be negative after a start moved left). */
  offset: z.number().int().min(-1_000_000).max(1_000_000),
}).strict();
export type TestDrawn = z.infer<typeof TestDrawnSchema> & DrawnPayload;

export const TEST_DRAWN_KIND: DrawnKindDef<TestDrawn> = {
  kind: 'test',
  name: { he: 'צורת בדיקה', en: 'Test shape' },
  schema: TestDrawnSchema as unknown as z.ZodType<TestDrawn>,
  limits: { maxChars: 200 },
  shift: (p, s) => ({ ...p, offset: p.offset + s.frames }),
  summary: (p) => ({ color: p.color, offset: p.offset }),
  validate: (p) => (p.color.toLowerCase() === '#ff00ff' ? [{ code: 'drawn_test_colour', message: 'the test kind refuses magenta (a document-level check hook)' }] : []),
  box: (p) => ({ x: -p.w / TEST_DRAWN_UNIT, y: -p.h / TEST_DRAWN_UNIT, w: (2 * p.w) / TEST_DRAWN_UNIT, h: (2 * p.h) / TEST_DRAWN_UNIT }),
};

/** Register the test kind once per process. */
export function registerTestDrawnKind(): void {
  if (!drawnKind('test')) registerDrawnKind(TEST_DRAWN_KIND);
}
export const testDrawn = (over: Partial<TestDrawn> = {}): TestDrawn => ({ kind: 'test', color: '#E03030', w: 2000, h: 1000, offset: 0, ...over });

/**
 * TEST-ONLY op `add_test_drawn`: places a test-kind drawn clip through the carrier's placeDrawnClip, as a kind's
 * own add op will. Registered by registerTestDrawnOp() in tests only; it also registers the kind.
 */
export function registerTestDrawnOp(): void {
  registerTestDrawnKind();
  if (getOp('add_test_drawn')) return;
  defineOp({
    name: 'add_test_drawn',
    version: 1,
    // public (not internal) so a fuzz step adds it with the ordinary credential; it exists only where a test registered it
    description: 'TEST ONLY: add a test-kind drawn clip on a text track.',
    args: z.object({ sequenceId: z.string().optional(), trackId: z.string().optional(), start: RationalTimeSchema, duration: RationalTimeSchema, drawn: TestDrawnSchema, transform: z.object({ x: z.number(), y: z.number(), scale: z.number(), rotation: z.number(), opacity: z.number() }).partial().strict().optional() }).strict(),
    apply(d, a, ctx) {
      const { clip, track } = placeDrawnClip(d, { ...a, drawn: a.drawn as TestDrawn }, ctx);
      return { affectedIds: [clip.id], summary: `Added a test shape at ${T.toSeconds(a.start)} s`, output: { clipId: clip.id, trackId: track.id } };
    },
  });
}
