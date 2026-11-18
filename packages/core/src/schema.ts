/**
 * Canonical ProjectDocument (SPEC §5), schema version 2 (v2 adds adjustment clips and tracks and template slot records, ADR-0016).
 * JSON-serializable; binary media stays outside and is referenced by asset id.
 * Transient state (selection, playhead, presence, panel layout) is NOT part of this document.
 */
import { z } from 'zod';
import { AudioFxInstanceSchema, MAX_AUDIO_FX } from './audioEffects.ts';
import { BLEND_MODES, EffectInstanceSchema, MaskSchema, TransitionSchema } from './effects.ts';
import { FollowSchema, MAX_REDACT_REGIONS, MotionTrackSchema, RedactRegionSchema } from './tracking.ts';

export const SCHEMA_VERSION = 2;

export const RationalTimeSchema = z
  .object({
    value: z.string().regex(/^-?\d+$/).describe('Integer numerator as a decimal string'),
    timescale: z.number().int().positive().describe('Ticks per second'),
  })
  .strict()
  .describe('Exact time = value / timescale seconds');
export const RateSchema = z.object({ num: z.number().int().positive(), den: z.number().int().positive() }).strict();

const Id = z.string().min(1).max(64);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/).describe('#RRGGBB or #RRGGBBAA');

/**
 * How the frames of a derived video map to its source (ADR-0017 frame jobs). Present on provider outputs made frame by frame.
 * identity: output frame i = source frame sourceStartFrame+i. interpolated: output frame i·m = source frame sourceStartFrame+i (time-identical at rate r·m).
 */
export const DerivedFramesSchema = z
  .object({
    sourceStartFrame: z.number().int().nonnegative(),
    sourceFrameCount: z.number().int().positive(),
    sourceRate: RateSchema,
    outputRate: RateSchema,
    /** identity: output frame i = source frame f0+i. interpolated: output frame i·m = source frame f0+i (time-identical at rate r·m). */
    mapping: z.enum(['identity', 'interpolated']),
    multiplier: z.number().int().min(2).max(8).optional(),
    /** Output frame indices that repeat the previous frame (trailing holds, holds across scene cuts). */
    heldFrames: z.array(z.number().int().nonnegative()).max(100000),
  })
  .strict();
/**
 * A machine translation stored on a language variant (ADR-0017). Phrase-timed only: the master's timing is kept and never mapped
 * word by word (SPEC §16). Only the owner can mark it reviewed.
 */
export const VariantTranslationSchema = z
  .object({
    from: z.string().min(2).max(35), to: z.string().min(2).max(35),
    engine: z.string().max(80), model: z.string().max(200),
    createdAt: z.string(), createdBy: z.string(),
    review: z.enum(['needed', 'reviewed']), reviewedBy: z.string().optional(), reviewedAt: z.string().optional(),
    /** sha256 hex of each master phrase/cue text when translated (key = segment id or caption clip id). */
    sources: z.record(Id, z.string().regex(/^[0-9a-f]{64}$/)),
  })
  .strict();

// ---------- life line (ADR-0021): capture dates, events and live title fields. Optional fields only; no schema version bump. ----------
/** A calendar day on the wall where the picture was taken. */
export const WALL_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** A day, or a day and the wall-clock time. Never a UTC instant, never a zone suffix. */
export const WALL_DATE_TIME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d:[0-5]\d)?$/;
/** Capture dates are kept inside these years (both included); a camera clock outside them is not a date anyone filmed on. */
export const CAPTURE_MIN_YEAR = 1900;
export const CAPTURE_MAX_YEAR = 2100;
/**
 * The most a file's clock can have been moved by in all (Capture.shiftedMinutes, either sign): the minutes of the 73,414 days
 * from 1 January CAPTURE_MIN_YEAR to 31 December CAPTURE_MAX_YEAR. A date that started inside those years and is still inside
 * them is never further than this from where it started, however many shifts took it there, so the total of a file whose date
 * the operations kept in range always fits. (Only a document whose total does not match its date, such as an archive made by
 * hand, can meet the bound; shift_asset_captures then refuses with shiftTooFar.)
 */
export const MAX_CAPTURE_SHIFT_MINUTES = 73414 * 1440;
/**
 * True for a WALL_DATE or WALL_DATE_TIME string whose day exists (no 30 February) in a year from CAPTURE_MIN_YEAR to
 * CAPTURE_MAX_YEAR. Integers only: calendar data is never a float and never goes through Date or Intl (ADR-0021).
 */
export function isRealWallDate(at: string): boolean {
  if (!WALL_DATE_TIME.test(at)) return false;
  const y = Number(at.slice(0, 4)), m = Number(at.slice(5, 7)), d = Number(at.slice(8, 10));
  if (y < CAPTURE_MIN_YEAR || y > CAPTURE_MAX_YEAR) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}
/**
 * When a picture or video was taken (ADR-0021). Calendar data on the wall clock of the place it was filmed, not timeline time
 * (ADR-0003 is untouched): the conversion from a file's UTC instant happens once, at import, on the server; everything that
 * renders does integer arithmetic on the stored wall clock.
 */
export const CaptureSchema = z
  .object({
    /** YYYY-MM-DD (only the day is known) or YYYY-MM-DDTHH:MM:SS, as the wall clock read at the file's first picture. A real day, 1900–2100. */
    at: z.string().regex(WALL_DATE_TIME).refine(isRealWallDate, { message: 'not a real calendar day between 1900 and 2100' }),
    /** Minutes east of UTC at `at` when the FILE states it (Apple creationdate, EXIF OffsetTimeOriginal); null = not stated. */
    utcOffsetMinutes: z.number().int().min(-840).max(840).nullable(),
    /** Where the date came from: the container's tags, the picture's EXIF, a pattern in the file name, or a person. */
    source: z.enum(['container', 'exif', 'filename', 'manual']),
    /** An estimate: a file name gives the day a file was saved or sent, not necessarily the day it was filmed. */
    circa: z.literal(true).optional(),
    /** The file gave a UTC instant only; the wall clock was worked out for this IANA zone at import (server config homeZone). */
    assumedZone: z.string().min(1).max(64).optional(),
    /** Minutes a person moved the file's own clock by, in all (shift_asset_captures adds each step); `at` already includes them. */
    shiftedMinutes: z.number().int().min(-MAX_CAPTURE_SHIFT_MINUTES).max(MAX_CAPTURE_SHIFT_MINUTES).optional(),
  })
  .strict();
export type Capture = z.infer<typeof CaptureSchema>;
/** A project holds at most this many events. */
export const MAX_LIFE_EVENTS = 2000;
/** An event holds at most this many files (and at least one). */
export const MAX_EVENT_FILES = 5000;
/**
 * An event (ADR-0021): library files grouped by when they were taken. Only what a person typed or chose is stored: a holiday
 * name is derived when it is read (events.ts eventDisplayName), never written here, so a corrected holiday table never
 * changes what an old operation log replays to.
 */
export const LifeEventSchema = z
  .object({
    id: Id,
    /** The name a person typed, one line; '' = none (the event is then shown by its derived name, or by its date). */
    name: z.string().max(120).regex(/^[^\n\r]*$/),
    /** Was it filmed after sunset? null = not decided; true = the Hebrew date of the next day; false = of the same day. Never guessed. */
    afterSunset: z.boolean().nullable(),
    /** Pictures and videos of the library; a file sits in at most one event (validate.ts). */
    assetIds: z.array(Id).min(1).max(MAX_EVENT_FILES),
    /** How the grouping was made. No timestamps: operations are pure and replayable. `edited` = a person changed it, so cluster_events leaves it alone. */
    origin: z.object({ method: z.enum(['gap', 'manual']), gapMinutes: z.number().int().min(30).max(1440).nullable(), createdBy: z.string(), edited: z.boolean() }).strict(),
  })
  .strict();
export type LifeEvent = z.infer<typeof LifeEventSchema>;

// ---------- people (ADR-0021, people section). Optional; no schema version bump. ----------
/** A project holds at most this many people. */
export const MAX_PEOPLE = 200;
/** The longest name of a person. */
export const MAX_PERSON_NAME = 80;
/** A person's id as a live field writes it: `{age:<id>}`, `{name:<id>}` (fields.ts PERSON_ID_IN_FIELD is the same shape). */
export const PERSON_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A name is one line and holds none of the characters the field grammar uses: braces, a colon, a bar. */
export const PERSON_NAME = /^[^{}:|\n\r]+$/;
/**
 * A person named in titles (ADR-0021, people section): a name, an optional birth date and an optional word choice for the
 * Hebrew age wording. Nothing else is ever stored about a person: no picture, no face data, no place, no relation.
 *
 * PRIVACY: `birthDate` and `form` leave the server only for the owner's own session or a credential whose grant says
 * people: 'full' (apps/server/src/peoplePrivacy.ts). Every other credential reads the id and the name only.
 */
export const PersonSchema = z
  .object({
    id: z.string().regex(PERSON_ID),
    /** As typed, in Unicode NFC and without spaces around it; unique in the project when compared by people.ts personNameKey. */
    name: z.string().min(1).max(MAX_PERSON_NAME).regex(PERSON_NAME).refine((n) => n === n.trim() && n === n.normalize('NFC'), { message: 'a name is stored trimmed and in Unicode NFC' }),
    /** The day of birth on the Gregorian calendar, YYYY-MM-DD (a real day in 1900–2100), or null = not given: age fields of this person then have no words. */
    birthDate: z.string().regex(WALL_DATE).refine(isRealWallDate, { message: 'not a real calendar day between 1900 and 2100' }).nullable(),
    /** The Hebrew word before the age: 'm' = «בן», 'f' = «בת»; absent = «גיל» (ageWords.ts). A wording choice, not a record of anything. */
    form: z.enum(['m', 'f']).optional(),
  })
  .strict();
export type Person = z.infer<typeof PersonSchema>;

export const AssetSchema = z
  .object({
    id: Id,
    kind: z.enum(['video', 'audio', 'image', 'lut']),
    name: z.string().max(256),
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    byteSize: z.number().int().nonnegative(),
    container: z.string(),
    mimeType: z.string(),
    duration: RationalTimeSchema,
    video: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive(), frameRate: RateSchema, codec: z.string(), rotation: z.number(), frameCount: z.number().int().nonnegative().nullable(),
        /** When the first video frame does not sit at the file's own start (see Asset.timeOrigin): how much later it starts (remuxed files, Matroska/TS, B-frames without an edit list). */
        startTime: RationalTimeSchema.optional(),
        /** True when the file does not say how its colours are encoded. It is then shown as the browser reads it (BT.709 in Chromium), which for standard-definition material differs slightly from the BT.601 reading other players use. */
        untaggedColour: z.literal(true).optional(),
        /** The owner's choice for a file with `untaggedColour`: read its colours as BT.601 (standard-definition material) instead of the browser's BT.709 reading. Applied as a colour correction in the compositor, so preview, stills and export agree. */
        readColourAs: z.literal('bt601').optional() })
      .strict()
      .optional(),
    audio: z.object({ sampleRate: z.number().int().positive(), channels: z.number().int().positive(), codec: z.string(),
      /** When the first audio sample does not sit at the file's own start (see Asset.timeOrigin): how much later it starts. */
      startTime: RationalTimeSchema.optional() }).strict().optional(),
    /**
     * The file's own start time when it is not 0 (MPEG-TS streams typically start around 1.4 s). Players and this editor treat
     * it as time zero: stream start times above are measured from it. This value is how FFMPEG's reader numbers the file and is used
     * only by the server's ffmpeg-based decoders; the browser's reader numbers some files differently (an MP3's encoder delay,
     * for one) and derives its own origin the same way: the earliest presented timestamp, never below zero.
     */
    timeOrigin: RationalTimeSchema.optional(),
    image: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), codec: z.string(), hasAlpha: z.boolean() }).strict().optional(),
    /** Present for kind 'lut': a 3D colour lookup table (.cube). The stored bytes are the original file text; `size` is its entries per axis. It is applied to clips as the effect color.lut and never placed on the timeline. */
    lut: z.object({ size: z.number().int().min(2).max(65), title: z.string().max(256).nullable() }).strict().optional(),
    /** When the picture was taken, read from the ORIGINAL file at import or set by hand (life line, ADR-0021). Absent = unknown. */
    capture: CaptureSchema.optional(),
    /**
     * Present when the stored media is a conformed copy (SPEC §7): the original could not be edited directly
     * (variable frame rate, rotation metadata, or a codec the editor cannot decode). The original bytes are kept.
     */
    conform: z
      .object({
        originalContentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        originalByteSize: z.number().int().nonnegative(),
        reasons: z.array(z.enum(['variable-frame-rate', 'rotation', 'codec', 'pixel-aspect', 'still-format', 'hdr'])).min(1),
        original: z.object({ codec: z.string(), width: z.number().int(), height: z.number().int(), avgFrameRate: z.string(), rFrameRate: z.string(), rotation: z.number(), frameCount: z.number().int().nullable(), durationSeconds: z.number() }).strict(),
        /** How source frames map to conformed frames. */
        frameMapping: z.enum(['identity', 'cfr-nearest-timestamp']),
        method: z.string(),
      })
      .strict()
      .optional(),
    provenance: z
      .object({
        origin: z.enum(['upload', 'fixture', 'generated', 'derived']),
        importedAt: z.string(),
        importedBy: z.string(),
        /**
         * Present for media made by a formula of this build (built-in sounds, graphic elements, built-in music): which formula
         * made this file. `params` (ADR-0022) is what the formula was asked for when the id alone does not say it: built-in music
         * records bars, seed, bpm, meter and synth (musicStyles.ts musicProvenanceParams). At most 8 entries.
         */
        procedural: z.object({ id: z.string(), version: z.number().int(), generator: z.string(),
          params: z.record(z.string().min(1).max(24), z.union([z.number(), z.string().max(64)])).refine((r) => Object.keys(r).length <= 8, { message: 'at most 8 entries' }).optional() }).strict().optional(),
        /** Present for generated speech (SPEC §17): what was said, by which engine and model, in which voice. A voice taken from a recording carries the consent statement its owner made; an agent cannot make one. */
        voice: z
          .object({
            jobId: z.string(), engine: z.string(), model: z.string(), language: z.string(), text: z.string().max(2000), /** The text as the model was given it, when it differs (Hebrew with the vowel points that were added). */ spokenText: z.string().max(4000).optional(), seed: z.number().int(),
            voice: z.enum(['built-in', 'reference']), referenceAssetId: z.string().optional(),
            consent: z.object({ speaker: z.string().max(120), statement: z.string().max(400), attestedBy: z.string(), attestedAt: z.string() }).strict().optional(),
            watermark: z.string().max(200).nullable(),
          })
          .strict()
          .optional(),
        /** Present for provider outputs (SPEC §25, Amendment A1 FF-08): enough to recreate the recipe and trace lineage. */
        derived: z
          .object({
            jobId: z.string(), capabilityId: z.string(), capabilityVersion: z.string(),
            /** The reviewed graph's digest for a ComfyUI result. A local tool has no graph and writes its code digest here too (same as logicDigest). */
            graphDigest: z.string(),
            params: z.record(z.string(), z.unknown()), sourceAssetIds: z.array(z.string()), outputName: z.string(), outputRole: z.string(), encoding: z.string(), provider: z.record(z.string(), z.unknown()),
            // ADR-0017 (all optional; older documents stay valid):
            /** Frame mapping of a frame-job video output. */
            frames: DerivedFramesSchema.optional(),
            /** What happened to the source's sound: copied unchanged, processed by the tool, or absent. */
            audio: z.enum(['source-copied', 'processed', 'none']).optional(),
            /** Source-asset time (its own clock) of this asset's time zero. Present iff the derivative is time-preserving (replace_clip_asset and caption lineage need it). */
            sourceRangeStart: RationalTimeSchema.optional(),
            /** The verified model files the job ran with. */
            models: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).max(16).optional(),
            /** sha256:<hex> logic digest (graphDigest or codeDigest) the job ran. graphDigest keeps its meaning for ComfyUI. */
            logicDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export const TransformSchema = z
  .object({
    x: z.number().min(-4).max(4).describe('Horizontal offset of the layer centre from the frame centre, as a fraction of frame width'),
    y: z.number().min(-4).max(4).describe('Vertical offset from the frame centre, as a fraction of frame height'),
    scale: z.number().min(0.01).max(20),
    rotation: z.number().min(-3600).max(3600).describe('Degrees, clockwise'),
    opacity: z.number().min(0).max(1),
  })
  .strict();
export const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } as const;

const Gradient = z.object({ colors: z.array(Color).min(2).max(3), angle: z.number().int().min(0).max(359) }).strict();
export const TextStyleSchema = z
  .object({
    fontFamily: z.string().max(64),
    fontWeight: z.number().int().min(100).max(900),
    sizeFrac: z.number().min(0.005).max(1).describe('Font size as a fraction of frame height'),
    color: Color,
    align: z.enum(['start', 'center', 'end']),
    direction: z.enum(['auto', 'rtl', 'ltr']).describe('Base paragraph direction; auto = first strong character'),
    lineHeight: z.number().min(0.5).max(4),
    background: Color.nullable(),
    stroke: Color.nullable(),
    strokeFrac: z.number().min(0).max(0.5).describe('Stroke width as a fraction of font size'),
    // ---- look fields (ADR-0012): optional, absent and null both mean off; a title with none of them is drawn exactly as before ----
    /** The letters' fill: 2–3 evenly spaced colours along an angle (0° = left to right, 90° = top to bottom; the angle turns with the title). Each letter keeps its colours while it moves. */
    gradient: Gradient.nullable().optional(),
    /** Extra space between letters, as a fraction of the font size; drawn as 0 on lines with Arabic script (joined letters). */
    tracking: z.number().min(-0.05).max(0.5).nullable().optional(),
    /** A second outline outside the first one (`stroke`), as a fraction of the font size. */
    stroke2: z.object({ color: Color, widthFrac: z.number().min(0.01).max(0.5) }).strict().nullable().optional(),
    /** A soft light around the letters: radius as a fraction of the font size, intensity 0.1–1. It does not change over time. */
    glow: z.object({ color: Color, radiusFrac: z.number().min(0.05).max(1), intensity: z.number().min(0.1).max(1) }).strict().nullable().optional(),
    /** Solid depth behind the letters toward `angle` (degrees, 0 = right, 90 = down), darkened by up to `shade` toward the back. */
    extrude: z.object({ color: Color, depthFrac: z.number().min(0.02).max(0.6), angle: z.number().int().min(0).max(359), shade: z.number().min(0).max(0.8) }).strict().nullable().optional(),
    /** A flat shadow of the letters stretched toward `angle` over `lengthFrac` font sizes. */
    longShadow: z.object({ color: Color, lengthFrac: z.number().min(0.1).max(4), angle: z.number().int().min(0).max(359) }).strict().nullable().optional(),
  })
  .strict();
/** The optional look fields of a title (ADR-0012). Text styles (textPresets.ts) own them: applying a style clears the ones it does not set. */
export const TEXT_LOOK_FIELDS = ['gradient', 'tracking', 'stroke2', 'glow', 'extrude', 'longShadow'] as const;
export type TextLookField = (typeof TEXT_LOOK_FIELDS)[number];
/**
 * A title's style with its look fields that mean "off" removed (null, and tracking 0), so a title without a look is stored
 * exactly like one from before the look fields existed. Used on the master style; a format override keeps its nulls, where
 * they mean "off in this format".
 */
export function normaliseTextStyle<S extends Partial<TextStyle>>(s: S): S {
  const o: Record<string, unknown> = { ...s };
  for (const k of TEXT_LOOK_FIELDS) if (o[k] === null || (k === 'tracking' && o[k] === 0)) delete o[k];
  return o as S;
}
/** True when a style has at least one look field that is on (null and tracking 0 are off). */
export const hasTextLook = (s: Partial<TextStyle>): boolean => TEXT_LOOK_FIELDS.some((k) => s[k] != null && !(k === 'tracking' && s[k] === 0));
export const DEFAULT_TEXT_STYLE = {
  fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.06, color: '#FFFFFF', align: 'center', direction: 'auto', lineHeight: 1.2, background: null, stroke: '#000000', strokeFrac: 0.08,
} as const satisfies z.infer<typeof TextStyleSchema>;

export const ANIMATABLE = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
export type Animatable = (typeof ANIMATABLE)[number];
export const EASINGS = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export const KeyframeSchema = z
  .object({
    /** Offset from the clip start. May lie outside [0, duration): after a trim or split the curve keeps its exact shape. */
    time: RationalTimeSchema,
    value: z.number(),
    /** Shape of the segment that STARTS at this key. */
    easing: z.enum(EASINGS),
  })
  .strict();
/** Per-property keyframe lists, strictly increasing in time. A property without keys uses the static transform value. */
export const KeyframesSchema = z.object(Object.fromEntries(ANIMATABLE.map((p) => [p, z.array(KeyframeSchema).max(2000).optional()])) as Record<Animatable, z.ZodOptional<z.ZodArray<typeof KeyframeSchema>>>).strict();
const ClipBase = {
  id: Id, start: RationalTimeSchema, duration: RationalTimeSchema, transform: TransformSchema, keyframes: KeyframesSchema.optional(),
  /** Applied in order after the layer is placed (with its transform and opacity), before its mask, transition and blend mode. A time effect (time.*) is always first (ops.ts effectSlot). */
  effects: z.array(EffectInstanceSchema).max(16).optional(),
  blend: z.enum(BLEND_MODES).optional(),
  /** Follow a motion track (ADR-0015): a title, or a picture on a video track, moves with the tracked point; its own transform is then an offset from that point. */
  follow: FollowSchema.optional(),
};
export const MediaClipSchema = z
  .object({
    ...ClipBase,
    type: z.literal('media'),
    assetId: Id,
    sourceIn: RationalTimeSchema.describe('Source time shown at the clip start'),
    gain: z.number().min(0).max(8).describe('Linear audio gain'),
    /** Playback speed as an exact ratio (absent = 1). The clip shows duration × speed of source. Sound is resampled with it (pitch follows speed). */
    speed: z.object({ num: z.number().int().min(1).max(8000), den: z.number().int().min(1).max(8000) }).strict().optional(),
    /** A continuous speed ramp: the speed changes evenly over the clip's length from `speed` (1 when absent) to this. Such a clip cannot be reversed, frozen, slipped or given a transition. */
    speedEnd: z.object({ num: z.number().int().min(1).max(8000), den: z.number().int().min(1).max(8000) }).strict().optional(),
    /** For a ramped clip that is a part of its ramp (after a trim or a cut): where in the ramp it starts and how long the whole ramp is. Absent = the clip is the whole ramp. */
    rampWindow: z.object({ offset: RationalTimeSchema, total: RationalTimeSchema }).strict().optional(),
    /** For a ramped clip: smooth = the speed eases out of the first value and into the last instead of changing evenly. */
    speedCurve: z.literal('smooth').optional(),
    /** Freeze frame: the clip holds the single source picture at `sourceIn` for its whole length. Video tracks only; it has no sound. */
    freeze: z.literal(true).optional(),
    /** Reverse: the clip plays its stretch of source backwards (picture on a video track, sound on an audio track; linked clips reverse together). `sourceIn` is still the earliest source time of the stretch. */
    reverse: z.literal(true).optional(),
    /** Sound clips: when the clip's speed is not 1, keep the pitch of the sound instead of letting it rise and fall with the speed. */
    keepPitch: z.literal(true).optional(),
    linkGroupId: Id.nullable(),
    /** Audio clips: linear fades at the clip edges (durations). */
    fadeIn: RationalTimeSchema.optional(),
    /** Volume automation: level multipliers (on top of `gain`) at clip-local, frame-aligned times; linear between keys, held before the first and after the last. Audio-track clips only. */
    /** Volume keys. `curve: 'smooth'` on a key makes the level ease out of it and into the next key (an S-shaped change) instead of moving in a straight line. */
    volume: z.array(z.object({ time: RationalTimeSchema, value: z.number().min(0).max(4), curve: z.literal('smooth').optional() }).strict()).min(1).max(2000).optional(),
    /** Sound effects of a clip on an audio track (audioEffects.ts, ADR-0010). Processed in the fixed stage order whatever the list order; at most one per type and one character voice. */
    audioFx: z.array(AudioFxInstanceSchema).max(MAX_AUDIO_FX).optional(),
    fadeOut: RationalTimeSchema.optional(),
    mask: MaskSchema.optional(),
    /** Privacy regions (ADR-0015): blurred, pixelated or covered parts of the picture, fixed or following a motion track of this clip's asset. Drawn on each picture of the clip before its effects. */
    redact: z.array(RedactRegionSchema).min(1).max(MAX_REDACT_REGIONS).optional(),
    transition: TransitionSchema.optional(),
  })
  .strict();
/**
 * How the letters, words or lines of a title come in, go out and move while it is shown. The units animate one after
 * another in reading order. Entrance: fade, typewriter (each unit simply appears), rise (from below), drop (from above),
 * pop (grows with a small overshoot), slide (from the side reading starts on), zoom (settles from larger), blur (comes into
 * focus), write (each unit is drawn on from its reading-start side, one after another; ADR-0012).
 * Exit: fade, sink (down), lift (up), shrink, slide (toward the side reading ends on), blur (goes out of focus). Loop: wave, bounce, pulse, jitter.
 */
export const TEXT_ANIM_IN = ['fade', 'typewriter', 'rise', 'drop', 'pop', 'slide', 'zoom', 'blur', 'write'] as const;
export const TEXT_ANIM_OUT = ['fade', 'sink', 'lift', 'shrink', 'slide', 'blur'] as const;
export const TEXT_ANIM_LOOP = ['wave', 'bounce', 'pulse', 'jitter'] as const;
export const TextAnimationSchema = z
  .object({
    by: z.enum(['letter', 'word', 'line']).describe('what animates as one piece'),
    in: z.enum(TEXT_ANIM_IN).nullable(),
    out: z.enum(TEXT_ANIM_OUT).nullable(),
    loop: z.enum(TEXT_ANIM_LOOP).nullable(),
    inFrames: z.number().int().min(1).max(600).describe('length of the whole entrance, first unit to last'),
    outFrames: z.number().int().min(1).max(600),
  })
  .strict();
export type TextAnimation = z.infer<typeof TextAnimationSchema>;
export const DEFAULT_TEXT_ANIMATION = { by: 'word', in: null, out: null, loop: null, inFrames: 20, outFrames: 15 } as const satisfies TextAnimation;
export const TextClipSchema = z.object({ ...ClipBase, type: z.literal('text'), text: z.string().max(2000), style: TextStyleSchema, animation: TextAnimationSchema.optional(),
  /** Live fields (life line, ADR-0021): `{date}`, `{hebrewDate}`, `{event}` … in `text` are resolved by the evaluator (core fields.ts); `{{` and `}}` are braces. Absent = the text is drawn verbatim, as before. */
  fields: z.literal(true).optional() }).strict();

// ---------- captions and transcripts (SPEC §16) ----------
export const CAPTION_PRESETS = ['classic', 'karaoke', 'word-pop', 'box-highlight', 'reveal', 'underline', 'dim-ahead'] as const;
export const CaptionStyleSchema = z
  .object({
    preset: z.enum(CAPTION_PRESETS).describe('classic = whole phrase; karaoke = spoken words change colour; word-pop = one word at a time; box-highlight = box behind the current word; reveal = each word appears when it is spoken; underline = a bar under the current word; dim-ahead = words not yet spoken are faint'),
    fontFamily: z.string().max(64),
    fontWeight: z.number().int().min(100).max(900),
    sizeFrac: z.number().min(0.01).max(0.5).describe('Font size as a fraction of frame height'),
    color: Color,
    highlightColor: Color,
    background: Color.nullable(),
    stroke: Color.nullable(),
    strokeFrac: z.number().min(0).max(0.5),
    position: z.enum(['bottom', 'top', 'center']),
    marginFrac: z.number().min(0).max(0.45).describe('Safe margin from the frame edge, as a fraction of frame height'),
    maxLines: z.number().int().min(1).max(4),
    maxCharsPerLine: z.number().int().min(6).max(80).describe('Reading-width guide; configurable per language and style, not a universal rule'),
    direction: z.enum(['auto', 'rtl', 'ltr']),
    /** How a word comes in when it starts being spoken (needs word timing): fade = fades in over 0.15 s, pop = starts a little larger and settles in 0.12 s. Absent or none = it is simply there. */
    wordEntrance: z.enum(['none', 'fade', 'pop']).optional(),
  })
  .strict();
export const DEFAULT_CAPTION_STYLE = {
  preset: 'classic', fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.045, color: '#FFFFFF', highlightColor: '#3DE0C8', background: '#000000B3', stroke: null, strokeFrac: 0.08,
  position: 'bottom', marginFrac: 0.08, maxLines: 2, maxCharsPerLine: 32, direction: 'auto',
} as const satisfies z.infer<typeof CaptionStyleSchema>;
/** A manually timed cue on the timeline. `words` (optional) are timed relative to the cue start. */
export const CaptionClipSchema = z
  .object({
    ...ClipBase,
    type: z.literal('caption'),
    text: z.string().max(2000),
    words: z.array(z.object({ text: z.string().min(1).max(200), start: RationalTimeSchema, duration: RationalTimeSchema }).strict()).max(500).optional(),
  })
  .strict();
/** One recognised or typed word, timed in SOURCE time of its asset (so captions follow every cut exactly). */
export const WordSchema = z.object({ id: Id, text: z.string().min(1).max(200), start: RationalTimeSchema, duration: RationalTimeSchema, confidence: z.number().min(0).max(1).nullable() }).strict();
export const SegmentSchema = z
  .object({
    id: Id,
    start: RationalTimeSchema,
    duration: RationalTimeSchema,
    /** Text shown. Corrections change this; they never change the audio. */
    text: z.string().max(4000),
    /** What recognition originally produced, kept once a correction is made. */
    original: z.string().max(4000).nullable(),
    speaker: z.string().max(80).nullable(),
    /** word = each word is timed; segment = only the phrase is timed; approximate = word times are estimates and must not drive precision cuts or karaoke. */
    timing: z.enum(['word', 'segment', 'approximate']),
    words: z.array(WordSchema).max(2000),
  })
  .strict();
export const TranscriptSchema = z
  .object({
    assetId: Id,
    language: z.string().min(2).max(35).describe('BCP 47 tag, e.g. he, en, he-IL'),
    origin: z.object({ kind: z.enum(['import', 'manual', 'asr']), provider: z.string().nullable(), model: z.string().nullable(), createdAt: z.string(), createdBy: z.string() }).strict(),
    segments: z.array(SegmentSchema).max(20000),
  })
  .strict();

// ---------- linked format variants (SPEC §19.8; projection in variants.ts) ----------
export const SafeAreaSchema = z.object({ top: z.number().min(0).max(0.45), bottom: z.number().min(0).max(0.45), left: z.number().min(0).max(0.45), right: z.number().min(0).max(0.45) }).strict().describe('Insets as fractions of the frame; important content should stay inside');
export const VariantOverrideSchema = z.object({
  transform: TransformSchema.partial().optional(),
  hidden: z.boolean().optional(),
  /** Title clips: wording for this format only (for example a shorter line for a narrow frame). */
  text: z.string().min(1).max(2000).optional(),
  /** Title clips: style fields for this format only (for example a larger size). */
  textStyle: TextStyleSchema.partial().optional(),
}).strict();
export const VariantSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
    fit: z.enum(['contain', 'cover']).describe('contain = whole picture visible (bars possible); cover = picture fills the frame (edges cropped)'),
    profileId: z.string().max(64).nullable().describe('Format profile this variant was created from, if any'),
    safeArea: SafeAreaSchema.nullable(),
    /** Caption style fields that differ in this format (e.g. size, position); everything else follows the master caption style. */
    captionStyle: CaptionStyleSchema.partial().optional(),
    overrides: z.record(z.string(), VariantOverrideSchema),
    /** Transcript phrases (by segment id) worded differently in this format. Such a phrase is shown as phrase-timed text there: the word timing describes the master wording. */
    phraseText: z.record(Id, z.string().min(1).max(4000)).optional(),
    /** BCP 47 tag of the captions in this format when they differ from the master's (a language variant, ADR-0017). */
    language: z.string().min(2).max(35).optional(),
    /** Present on a language variant made by machine translation: where its wording came from and whether the owner reviewed it. */
    translation: VariantTranslationSchema.optional(),
  })
  .strict();


/** What a template run placed, by role (ADR-0016). Kept on the run, never on clips: a deleted clip leaves an inert, detached slot. */
export const TEMPLATE_SLOT_KINDS = ['picture', 'text', 'music', 'look', 'element', 'sound'] as const;
export const SlotRecordSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    kind: z.enum(TEMPLATE_SLOT_KINDS),
    clipId: Id,
    accept: z.enum(['video', 'image', 'any']).optional(),
    beats: z.object({ from: z.number().int().min(0), count: z.number().int().min(1).max(64), unit: z.enum(['beat', 'bar']) }).strict().optional(),
  })
  .strict();
export type SlotRecord = z.infer<typeof SlotRecordSchema>;

export const RecipeRunSchema = z.object({ id: Id, recipeId: z.string().max(64), params: z.record(z.string(), z.unknown()), createdIds: z.array(Id).max(5000), /** Content fingerprint of each created clip as the recipe left it; a clip whose content differs was edited by hand. */ fingerprints: z.record(Id, z.string()).default({}), steps: z.array(z.string().max(400)).max(50),
  /** Template runs only (recipeId `template:<templateId>`, ADR-0016): what each slot of the template holds. */
  slots: z.array(SlotRecordSchema).max(400).optional() }).strict();
export type RecipeRun = z.infer<typeof RecipeRunSchema>;

// ---------- analysis results (SPEC §19): measured from a source file, stored in SOURCE time, editable ----------
/**
 * Sections of a piece of music (ADR-0022): the one shape for built-in music (known by construction, musicStyles.ts) and for
 * any later music analysis. A section starts at `start` (source time) and ends where the next one starts; the last ends with
 * the file. `level` is how full the arrangement is, 0 (sparse) to 3 (fullest).
 */
export const MUSIC_SECTION_KINDS = ['intro', 'build', 'peak', 'break', 'ending'] as const;
export const MusicSectionSchema = z.object({ start: RationalTimeSchema, kind: z.enum(MUSIC_SECTION_KINDS), level: z.number().int().min(0).max(3) }).strict();
export type MusicSection = z.infer<typeof MusicSectionSchema>;
/** A beat analysis holds at most this many sections. */
export const MAX_MUSIC_SECTIONS = 200;
const AnalysisOrigin = z.object({ method: z.string().max(200), params: z.record(z.string(), z.union([z.number(), z.string()])), createdAt: z.string(), createdBy: z.string(), edited: z.boolean().describe('true once a person or agent corrected the result by hand') }).strict();
export const AnalysisSchema = z
  .object({
    assetId: Id,
    /** Picture cuts inside the source file (the first frame of each new shot), ascending. */
    scenes: z.object({ origin: AnalysisOrigin, cuts: z.array(RationalTimeSchema).max(20000) }).strict().optional(),
    /** Beat grid of the source audio, ascending. bpm and confidence describe the detector's estimate; beats are what editing tools use. */
    beats: z.object({ origin: AnalysisOrigin, bpm: z.number().min(20).max(400).nullable(), confidence: z.number().min(0).max(1).nullable(), beats: z.array(RationalTimeSchema).max(50000), /** Beats that start a bar (each is one of `beats`); absent when no bar pattern was found or entered. */ downbeats: z.array(RationalTimeSchema).max(50000).optional(), /** Beats per bar behind `downbeats`, when known. */ meter: z.number().int().min(2).max(12).nullable().optional(),
      /** Sections of the music, ascending, the first at 0 (validate.ts). Present for built-in music; attach_analysis (a measurement) never writes them. */
      sections: z.array(MusicSectionSchema).max(MAX_MUSIC_SECTIONS).optional() }).strict().optional(),
  })
  .strict();

/**
 * Adjustment clip (ADR-0016). It has no picture of its own: its enabled effects, mask, opacity and blend act on everything
 * already drawn below it in its sequence at that time. Captions are drawn last and are never affected.
 * It lives only on tracks of kind 'adjustment'.
 * Transform: only opacity is used; x=0, y=0, scale=1, rotation=0. Keyframes: opacity only.
 * No transition, no time effect, no key.chroma, no stylize.shadow (validate.ts adjustmentRefusal).
 * The mask is in frame space (the adjustment's box is the whole frame).
 */
export const AdjustmentClipSchema = z.object({ ...ClipBase, type: z.literal('adjustment'), label: z.string().max(80).optional(), mask: MaskSchema.optional() }).strict();
export const ClipSchema = z.discriminatedUnion('type', [MediaClipSchema, TextClipSchema, CaptionClipSchema, AdjustmentClipSchema]);

export const TrackSchema = z
  .object({
    id: Id, /** adjustment (ADR-0016): holds only adjustment clips, which act on the tracks below it. */ kind: z.enum(['video', 'audio', 'text', 'caption', 'adjustment']), name: z.string().max(128), locked: z.boolean(), muted: z.boolean(), hidden: z.boolean(), clips: z.array(ClipSchema),
    /** Caption tracks only. transcript mode shows the transcript of whatever is playing on the linked track; manual mode shows this track's own cues. */
    caption: z.object({ mode: z.enum(['manual', 'transcript']), linkedTrackId: Id.nullable(), style: CaptionStyleSchema }).strict().optional(),
    /** Audio tracks only. Absent = unity gain, centred, no ducking. */
    audio: z
      .object({
        gain: z.number().min(0).max(4).describe('Linear track gain'),
        pan: z.number().min(-1).max(1).describe('-1 left, 0 centre, 1 right (balance: the opposite channel is attenuated)'),
        /** Lower this track while the source tracks have speech (their transcript phrases) or, without a transcript, any clip. */
        duck: z.object({ sourceTrackIds: z.array(Id).min(1).max(8), reductionDb: z.number().min(1).max(40), attackMs: z.number().int().min(0).max(2000), releaseMs: z.number().int().min(0).max(5000) }).strict().nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const MARKER_COLORS = ['blue', 'green', 'yellow', 'red', 'purple'] as const;
/** A named point on the timeline that the editor (human or agent) placed: a note, a to-do, a sync point. It does not move with clips. */
export const MarkerSchema = z.object({ id: Id, sequenceId: Id, time: RationalTimeSchema.describe('Timeline time, frame-aligned'), label: z.string().max(200), color: z.enum(MARKER_COLORS) }).strict();
export type Marker = z.infer<typeof MarkerSchema>;

/** The per-project editing behaviour of the timeline (ProjectDocument.settings.timeline). */
export const TimelineBehaviourSchema = z.object({ mainMagnet: z.boolean(), rippleDelete: z.boolean() }).strict();
export type TimelineBehaviour = z.infer<typeof TimelineBehaviourSchema>;
/** What a project without settings.timeline does: today's behaviour, both off. */
export const LEGACY_TIMELINE: Readonly<TimelineBehaviour> = Object.freeze({ mainMagnet: false, rippleDelete: false });
/** What a new project starts with (owner decision, UX redesign wave A): the main-track magnet and ripple delete both on. */
export const NEW_PROJECT_TIMELINE: Readonly<TimelineBehaviour> = Object.freeze({ mainMagnet: true, rippleDelete: true });
/** The timeline behaviour of a project, with an absent field read as both off. */
export const timelineBehaviour = (doc: { settings: { timeline?: TimelineBehaviour } }): TimelineBehaviour => ({ ...LEGACY_TIMELINE, ...doc.settings.timeline });
/**
 * The main track of a sequence (the editor's V1, where the magnet and ripple delete act): its bottom-most picture track.
 * Undefined when the sequence has no picture track.
 */
export const mainTrackOf = (doc: { sequences: Record<string, { tracks: { id: string; kind: string }[] }>; mainSequenceId: string }, sequenceId?: string) =>
  doc.sequences[sequenceId ?? doc.mainSequenceId]?.tracks.find((t) => t.kind === 'video');

export const SequenceSchema = z.object({ id: Id, name: z.string().max(128), tracks: z.array(TrackSchema).describe('Bottom-most layer first') }).strict();

export const ProjectSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: Id,
    name: z.string().min(1).max(200),
    settings: z
      .object({ width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192), frameRate: RateSchema, sampleRate: z.number().int().min(8000).max(192000), background: Color,
        /** How pictures are placed before their own transform: contain (default) or cover. Set by format variants. */
        fit: z.enum(['contain', 'cover']).optional(),
        /** Export loudness: one static gain so the whole programme measures `target` LUFS (integrated), lowered if needed to keep true peak under `truePeak` dBTP. Absent = no normalisation. */
        loudness: z.object({ target: z.number().min(-40).max(-5), truePeak: z.number().min(-9).max(0) }).strict().optional(),
        /**
         * How the timeline edits for this project (set_timeline_behaviour; docs/design/UX_REDESIGN.md §2 decision 6, §5 Delete).
         * OPTIONAL: absent = both off, which is how every project behaved before the field existed, so stored documents and op
         * logs replay as they always did. createProject writes both on for new projects (NEW_PROJECT_TIMELINE).
         * No operation reads it: it is the editor's choice of which operation a key sends (rippleDelete: Delete sends
         * ripple_delete_clips for clips on the main track, Shift+Delete keeps the gap with delete_clip; mainMagnet: the main
         * track keeps its clips together while dragging). Agents choose their operations explicitly.
         */
        timeline: TimelineBehaviourSchema.optional() })
      .strict(),
    assets: z.record(Id, AssetSchema),
    sequences: z.record(Id, SequenceSchema),
    mainSequenceId: Id,
    /** Transcripts by asset id, in source time. */
    transcripts: z.record(Id, TranscriptSchema).default({}),
    /** Recipe runs: which objects each run created, so a run can be regenerated without touching hand-edited results. */
    recipeRuns: z.record(Id, RecipeRunSchema).default({}),
    /** Linked output formats of this edit, by variant id (see variants.ts). */
    variants: z.record(Id, VariantSchema).default({}),
    /** Analysis results by asset id, in source time. */
    analyses: z.record(Id, AnalysisSchema).default({}),
    /** User markers by marker id. */
    markers: z.record(Id, MarkerSchema).default({}),
    /** Motion tracks by track id (ADR-0015): positions of a point or box per source frame of a video asset. */
    motionTracks: z.record(Id, MotionTrackSchema).default({}),
    /** Events (life line, ADR-0021): groups of library files by capture time, by event id. */
    events: z.record(Id, LifeEventSchema).default({}),
    /**
     * People named in titles (ADR-0021, people section), by person id. OPTIONAL and absent until the first person is added
     * (no default, so a project without people is stored exactly as before); read it as `doc.people ?? {}` (people.ts peopleOf).
     */
    people: z.record(Id, PersonSchema).optional(),
  })
  .strict();

export type RationalTimeJson = z.infer<typeof RationalTimeSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type Keyframes = z.infer<typeof KeyframesSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type MediaClip = z.infer<typeof MediaClipSchema>;
export type TextClip = z.infer<typeof TextClipSchema>;
export type CaptionClip = z.infer<typeof CaptionClipSchema>;
export type AdjustmentClip = z.infer<typeof AdjustmentClipSchema>;
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type VariantTranslation = z.infer<typeof VariantTranslationSchema>;
export type DerivedFrames = z.infer<typeof DerivedFramesSchema>;
export type SafeArea = z.infer<typeof SafeAreaSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Word = z.infer<typeof WordSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Sequence = z.infer<typeof SequenceSchema>;
export type ProjectDocument = z.infer<typeof ProjectSchema>;
export type { MotionTrack, Follow, RedactRegion } from './tracking.ts';

export interface NewProjectOptions {
  id: string; name: string; width?: number; height?: number; frameRate?: { num: number; den: number }; sampleRate?: number;
  /**
   * The timeline behaviour the new project starts with. Default NEW_PROJECT_TIMELINE (magnet and ripple delete on); null leaves
   * the field out, as projects made before it existed (read as both off). It is part of the project's initial document, not an
   * operation, so it is not undone and an existing project's op log replays exactly as before.
   */
  timeline?: TimelineBehaviour | null;
}
export function createProject(o: NewProjectOptions): ProjectDocument {
  const timeline = o.timeline === undefined ? { ...NEW_PROJECT_TIMELINE } : o.timeline === null ? undefined : TimelineBehaviourSchema.parse(o.timeline);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: o.id,
    name: o.name,
    settings: { width: o.width ?? 1080, height: o.height ?? 1920, frameRate: o.frameRate ?? { num: 30, den: 1 }, sampleRate: o.sampleRate ?? 48000, background: '#000000', ...(timeline ? { timeline } : {}) },
    assets: {},
    sequences: {
      seq_main: {
        id: 'seq_main',
        name: 'Main',
        tracks: [
          { id: 'trk_video', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, clips: [] },
          { id: 'trk_text', kind: 'text', name: 'T1', locked: false, muted: false, hidden: false, clips: [] },
          { id: 'trk_audio', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, clips: [] },
        ],
      },
    },
    mainSequenceId: 'seq_main',
    transcripts: {},
    analyses: {},
    variants: {},
    recipeRuns: {},
    markers: {},
    motionTracks: {},
    events: {},
  };
}

/** Schema migrations: version N -> N+1. Older builds refuse newer documents ("newer than supported"). */
const MIGRATIONS: Record<number, (doc: any) => any> = {
  /** v1 -> v2 (ADR-0016): adjustment clips/tracks and template slot records are new and optional; nothing to rewrite. */
  1: (doc) => ({ ...doc, schemaVersion: 2 }),
};
export function migrateProject(raw: unknown): ProjectDocument {
  let doc = raw as { schemaVersion?: number };
  if (typeof doc?.schemaVersion !== 'number') throw new Error('not a PULSEFRAME project: missing schemaVersion');
  if (doc.schemaVersion > SCHEMA_VERSION) throw new Error(`project schema ${doc.schemaVersion} is newer than supported ${SCHEMA_VERSION}`);
  while (doc.schemaVersion! < SCHEMA_VERSION) {
    const step = MIGRATIONS[doc.schemaVersion!];
    if (!step) throw new Error(`no migration from schema ${doc.schemaVersion}`);
    doc = step(doc);
  }
  const out = ProjectSchema.parse(doc);
  // A project without people has no `people` key (entities.ts: undoing the first add_person deletes the emptied map), so a
  // stored or imported `people: {}` reads as absent and the undo of the first add_person gives the document back exactly.
  if (out.people && Object.keys(out.people).length === 0) delete out.people;
  return out;
}
