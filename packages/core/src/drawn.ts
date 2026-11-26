/**
 * Drawn clips (wave 8 carrier; the lead's Batch B decision): ONE clip kind `type: 'drawn'` that lives on text tracks and
 * carries a discriminated payload `drawn: { kind, … }`. A drawing (ink) and a trip map are kinds of it; each kind registers
 * its payload contract here and its painter in the engine (engine drawnPainters.ts registerDrawnPainter).
 *
 * What the carrier owns, once for every kind:
 * - the clip schema member (schema.ts DrawnClipSchema): the common clip fields of a title (transform, keyframes, effects,
 *   blend, follow) and NOT its words (text, style, letter animation, live fields, role). No schema version bump: an older
 *   build refuses a document holding a drawn clip exactly as it refuses an unknown field; a document without one is
 *   byte-identical.
 * - the payload check: `drawn.kind` must be a REGISTERED kind (an unknown kind is refused at parse, so a build without the
 *   kind cannot hold or load such a clip), the payload must pass the kind's own zod schema, and its JSON must fit
 *   the kind's `limits.maxChars` and MAX_DRAWN_PAYLOAD_CHARS.
 * - validation (validate.ts drawn_track, drawn_kind): a drawn clip lives only on a text track; the kind's own `validate` hook.
 * - time: split right halves and trim-start move the clip's start against its content; shiftKeyframes (animation.ts) calls
 *   shiftDrawn, which hands the move to the kind's `shift`, so the picture stays continuous.
 * - words: every text op refuses a drawn clip with `drawn_not_text` (drawnNotText below); every reader of words skips it.
 * - summaries: agents see a drawn clip only through drawnSummary (the kind's `summary`), never the raw payload in a timeline.
 *
 * Production registers no kind yet: until ink or the map lands, no document can hold a drawn clip. Tests register the
 * test-only kind of drawn.testKind.ts.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from './schema.ts';

/** A kind name: lower-case letters and digits, starting with a letter. */
export const DRAWN_KIND_PATTERN = /^[a-z][a-z0-9]{0,23}$/;
/** Hard ceiling of one payload's JSON length (characters), whatever a kind's own limit says. */
export const MAX_DRAWN_PAYLOAD_CHARS = 262_144;

/** Every payload has a `kind`; the rest belongs to the kind. */
export interface DrawnPayload { kind: string; [field: string]: unknown }
/** A move of the clip's start against its content (split right half, trim-start): `delta` timeline time, `frames` the same in whole frames of `rate`. */
export interface DrawnShift { delta: T.RationalTime; frames: number; rate: T.Rate }
/** Where a payload is checked: the document, the clip and its sequence. */
export interface DrawnSite { doc: ProjectDocument; clipId: string; sequenceId: string }
/** A box around the clip's anchor (frame centre + transform x/y), before the clip's scale and rotation, in fractions of the frame HEIGHT on both axes (a drawing scales with the frame height, like a title). */
export interface DrawnBox { x: number; y: number; w: number; h: number }

/**
 * What a kind registers (registerDrawnKind). Its schema must be strict and must not transform or default anything: the
 * stored payload is exactly what was parsed (the carrier keeps the parsed input, not the schema's output).
 */
export interface DrawnKindDef<P extends DrawnPayload = DrawnPayload> {
  kind: string;
  /** What the owner calls it (timeline label, inspector header, the refusal's "this is a …"). Hebrew addresses the owner in the plural. */
  name: { he: string; en: string };
  /** The payload contract, with `kind: z.literal(kind)`. */
  schema: z.ZodType<P>;
  /** Size limits checked at parse. `maxChars`: the payload's JSON length. Document-wide caps belong in the kind's ops, not here (ink-verify C6). */
  limits: { maxChars: number };
  /** The payload after the clip's start moved by `s` against its content. Pure; returns a new payload (or the same one when nothing changes). */
  shift(payload: P, s: DrawnShift): P;
  /** A small JSON summary for agents (get_timeline, describe_moment, the assistant): never the bulk of the payload. */
  summary(payload: P): Record<string, unknown>;
  /** Document-level checks of one payload (issue codes are the kind's own). Absent = none. */
  validate?(payload: P, at: DrawnSite): { code: string; message: string }[];
  /** The box the stage handles and preflight's safe-area check use. Absent = the whole frame (a title's placed size). */
  box?(payload: P): DrawnBox;
}

const KINDS = new Map<string, DrawnKindDef>();

/** Register a kind (once per process). Throws on a bad or repeated name. */
export function registerDrawnKind<P extends DrawnPayload>(def: DrawnKindDef<P>): void {
  if (!DRAWN_KIND_PATTERN.test(def.kind)) throw new Error(`drawn kind ${JSON.stringify(def.kind)} is not a valid kind name`);
  if (KINDS.has(def.kind)) throw new Error(`drawn kind ${def.kind} is already registered`);
  if (!(def.limits.maxChars > 0 && def.limits.maxChars <= MAX_DRAWN_PAYLOAD_CHARS)) throw new Error(`drawn kind ${def.kind}: limits.maxChars must be 1…${MAX_DRAWN_PAYLOAD_CHARS}`);
  KINDS.set(def.kind, def as unknown as DrawnKindDef);
}
/** Tests only: take a kind out again. True when it was registered. */
export const unregisterDrawnKind = (kind: string): boolean => KINDS.delete(kind);
/** The registered kind, or undefined. */
export const drawnKind = (kind: string): DrawnKindDef | undefined => KINDS.get(kind);
/** Every registered kind name, sorted. */
export const drawnKinds = (): string[] => [...KINDS.keys()].sort();

/**
 * The payload as stored. Parsing checks the registry: an unknown kind is refused (so no document holds a drawn clip whose
 * kind this build does not know), the kind's schema must pass, and the JSON must fit the limits. The parsed value is the
 * input itself (loose object), which the kind schema has checked field by field.
 */
export const DrawnPayloadSchema = z
  .looseObject({ kind: z.string().regex(DRAWN_KIND_PATTERN).describe('The drawn kind (registered by its track: ink, map …); its fields follow') })
  .superRefine((v, ctx) => {
    const def = KINDS.get(v.kind);
    if (!def) { ctx.addIssue({ code: 'custom', path: ['kind'], message: `drawn kind "${v.kind}" is not known to this build` }); return; }
    const r = def.schema.safeParse(v);
    if (!r.success) { for (const i of r.error.issues) ctx.addIssue({ code: 'custom', path: i.path as (string | number)[], message: i.message }); return; }
    const chars = JSON.stringify(v).length;
    const max = Math.min(def.limits.maxChars, MAX_DRAWN_PAYLOAD_CHARS);
    if (chars > max) ctx.addIssue({ code: 'custom', message: `drawn ${v.kind} payload is ${chars} characters; at most ${max}` });
  }) as unknown as z.ZodType<DrawnPayload>;

/** True for a drawn clip (the one predicate; sites that test `type === 'text'` simply skip it). */
export const isDrawnClip = <C extends { type: string }>(c: C | null | undefined): c is Extract<C, { type: 'drawn' }> => c?.type === 'drawn';

/** The move a split or trim-start makes, handed to the clip's kind. A clip whose kind is not registered is left as it is (it could not have been parsed). */
export function shiftDrawn(payload: DrawnPayload, delta: T.RationalTime, rate: T.Rate): DrawnPayload {
  const def = KINDS.get(payload.kind);
  if (!def || T.isZero(delta)) return payload;
  return def.shift(payload, { delta, frames: T.frameIndexAt(delta, rate), rate });
}

/** The name of a drawn clip's kind ({he, en}); a neutral name when the kind is not registered here. */
export const drawnName = (payload: DrawnPayload): { he: string; en: string } => KINDS.get(payload.kind)?.name ?? { he: 'ציור', en: 'Drawing' };

/** What agents see of a drawn clip: its kind, its name and the kind's summary. */
export function drawnSummary(payload: DrawnPayload): { kind: string; name: { he: string; en: string } } & Record<string, unknown> {
  const def = KINDS.get(payload.kind);
  return { ...(def ? def.summary(payload) : {}), kind: payload.kind, name: drawnName(payload) };
}

/** The box of a drawn clip (DrawnKindDef.box), or null for the whole frame. */
export const drawnBox = (payload: DrawnPayload): DrawnBox | null => KINDS.get(payload.kind)?.box?.(payload) ?? null;

/** The kind's own document checks of one payload. */
export const drawnIssues = (payload: DrawnPayload, at: DrawnSite): { code: string; message: string }[] => KINDS.get(payload.kind)?.validate?.(payload, at) ?? [];

/**
 * The refusal every text operation gives when it is aimed at a drawn clip (code drawn_not_text). English message with the
 * next step as hint; i18n drawn.ts HE_DRAWN words it in Hebrew.
 */
export const DRAWN_NOT_TEXT = {
  code: 'drawn_not_text' as const,
  message: (what: string) => `clip is a ${what}, not a title: it has no words or text style to change`,
  hint: 'Select a title to change words or text style; a drawing is changed in its own panel.',
};
