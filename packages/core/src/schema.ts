/**
 * Canonical ProjectDocument (SPEC §5), schema version 3 (v2 adds adjustment clips and tracks and template slot records, ADR-0016;
 * v3 is wave 4's one bump, ADR-0018: a sequence may carry its own format and measured origin).
 * JSON-serializable; binary media stays outside and is referenced by asset id.
 * Transient state (selection, playhead, presence, panel layout) is NOT part of this document.
 */
import { z } from 'zod';
import { AudioFxInstanceSchema, MAX_AUDIO_FX } from './audioEffects.ts';
import { BLEND_MODES, EffectInstanceSchema, MaskSchema, TransitionSchema } from './effects.ts';
import { DrawnPayloadSchema } from './drawn.ts';
import { FollowSchema, MAX_REDACT_REGIONS, MotionTrackSchema, RedactRegionSchema } from './tracking.ts';
import { ANIMATABLE, KeyframeSchema, MAX_TRANSFORM_KEYS, RationalTimeSchema, type Animatable } from './keyframe.ts';
import { CameraMotionSchema, ClipStabiliseSchema } from './steadyContract.ts';
import { NotesPointerSchema } from './understandContract.ts';
import { ClipDepthSchema } from './livingContract.ts';
import { MadeRecordSchema } from './madeContract.ts';
import { SourceRecordSchema } from './sourcesContract.ts';
import { AUDIENCE_MUSIC_DB_MAX, AUDIENCE_MUSIC_DB_MIN, AUDIENCE_PROFILES, AUDIENCE_RULES_VERSION, KEEP_RULES, SOUND_ROLES } from './audienceLimits.ts';
import { MOMENTS_MAX_WINDOWS, MomentsFileSchema, MomentsMeasuredSchema, MomentWindowSchema } from './momentsContract.ts';
import { ANGLE_KINDS, MAX_ANCHORS_PER_PIECE, MAX_ANGLES, MAX_PIECES, MAX_SPEAKERS, MAX_SYNC_CANDIDATES, SYNC_VERDICTS } from './multicamLimits.ts';

export const SCHEMA_VERSION = 3;

// RationalTimeSchema, ANIMATABLE, EASINGS and KeyframeSchema live in keyframe.ts (ADR-0019: one keyframe definition, shared with
// effects.ts, which this file imports); they are re-exported here so every existing import keeps working.
export { RationalTimeSchema } from './keyframe.ts';
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
// ---------- phone drop and the import queue (ADR-0023). Optional fields only; no schema version bump. ----------
/** How a file arrived through the import queue: this browser's picker, a dropped folder, or a phone drop code. */
export const IMPORT_VIA = ['browser', 'folder', 'phone'] as const;
/** Asset.provenance.upload (ADR-0023). Ids are the server's own (job_…, drp_…); never a secret of the drop code. */
export const UploadProvenanceSchema = z
  .object({
    via: z.enum(IMPORT_VIA),
    /** The import job that brought the file in (a job row of type 'import'). */
    jobId: z.string().min(1).max(40),
    /** The drop code the phone used (phone only). An id, never the code's token, PIN or session. */
    dropId: z.string().min(1).max(40).optional(),
    /** The path inside the dropped folder (folder only), as the browser reported it, cut to 512 characters. */
    relativePath: z.string().min(1).max(512).optional(),
  })
  .strict();
export type UploadProvenance = z.infer<typeof UploadProvenanceSchema>;
// ---------- the content library on disk (wave 7, library track). Optional fields only; no schema version bump. ----------
/** What a library item is, as the catalogue lists it (apps/server/src/library readers). Instruments, models, fonts, maps and transitions are counted, never listed. */
export const LIBRARY_KINDS = ['music', 'sound', 'loop', 'sticker', 'icon', 'illustration', 'texture', 'backdrop', 'video'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
/** Where a credit must go: the video's description text, on screen in the video, or either of them satisfies the licence. */
export const CREDIT_PLACEMENTS = ['description', 'on_screen', 'either'] as const;
const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
/**
 * Asset.provenance.library: the licence record of a file copied from the owner's library folder (tools/library ledger). It lives
 * in the document so credits, the non-commercial warning and the archive rule work from the project alone, on a machine without
 * the library. Written only by the internal operation use_library_item (libraryOps.ts); origin stays 'upload' and there is no
 * provenance.upload beside it (validate.ts library_provenance). Every flag is either true or absent.
 */
export const LibraryRecordSchema = z
  .object({
    /** `${sourceId}/${path inside the item}` or `${sourceId}/${path}#${member}` (an icon inside a set file). */
    itemId: z.string().min(1).max(300),
    sourceId: z.string().min(1).max(64),
    kind: z.enum(LIBRARY_KINDS),
    title: z.string().max(200),
    author: z.string().max(200).optional(),
    /** SHA-256 (hex) of the file on disk as it was copied; for a rasterised sticker, of the SVG text that was rasterised. */
    sourceSha256: Hex64,
    /** Which download it came from: the ledger entry's item id and, when the ledger has them, its tree hash, version or commit. */
    ledger: z.object({ item: z.string().min(1).max(200), treeSha256: Hex64.optional(), version: z.string().max(80).optional(), commit: z.string().max(64).optional() }).strict(),
    /** The licence id the core table knows (an exact SPDX id, or `custom:<sourceId>` for an allow-listed custom licence). */
    licence: z.object({ id: z.string().min(1).max(80), url: z.string().max(500).optional() }).strict(),
    credit: z.object({ text: z.string().min(1).max(500), placement: z.enum(CREDIT_PLACEMENTS) }).strict().optional(),
    flags: z.object({ nonCommercial: z.literal(true).optional(), diskOnly: z.literal(true).optional(), people: z.literal(true).optional(), aiGenerated: z.literal(true).optional(), trademark: z.literal(true).optional() }).strict(),
    /** Present when the server rasterised an SVG into this PNG: the long side asked for, the colour given to one-colour icons, and what made the bytes. */
    raster: z.object({ longSide: z.number().int().min(64).max(2048), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), by: z.literal('ffmpeg-librsvg') }).strict().optional(),
  })
  .strict();
export type LibraryRecord = z.infer<typeof LibraryRecordSchema>;
/**
 * Asset.provenance.fitted (wave 7 musicfit track, .artifacts/wave7/musicfit-decisions.md): a song of this library shortened by ONE
 * removal of whole bars from its middle. The file is the source from `startAt` to its usable end without [removed.from, removed.to),
 * joined by a linear equal-gain crossfade of `crossfade` that ENDS on the join. All times are source times of `sourceAssetId`
 * except `joinAt` (this file's own clock; = removed.from − startAt). `measured` is a heuristic's measurement, never a judgement;
 * `heard` is set by the owner's own session only (mark_join_heard). `sourceAssetId` may name a file removed since: readers check.
 * Written only by the internal operation add_fitted_music; validate.ts fitted_provenance.
 */
export const FittedMusicSchema = z
  .object({
    sourceAssetId: Id,
    /** musicFitContract.ts FIT_METHOD: names the heuristic and its version. */
    method: z.string().max(240),
    startAt: RationalTimeSchema,
    removed: z.object({ from: RationalTimeSchema, to: RationalTimeSchema }).strict(),
    crossfade: RationalTimeSchema,
    joinAt: RationalTimeSchema,
    measured: z.object({
      similarity: z.number().min(0).max(1), levelStepDb: z.number().min(-200).max(200), phraseBars: z.union([z.literal(1), z.literal(2), z.literal(4)]),
      tempoSpreadMs: z.number().min(0).max(100000), beatConfidence: z.number().min(0).max(1).nullable(),
    }).strict(),
    heard: z.object({ by: z.string().min(1).max(120), at: z.string().min(1).max(40) }).strict().optional(),
  })
  .strict();
export type FittedMusic = z.infer<typeof FittedMusicSchema>;
/**
 * Asset.provenance.instruments (wave 7 instruments track «כלים מוקלטים», .artifacts/wave7/instruments-decisions.md §4.4): built-in music
 * made with recorded instrument samples from the owner's library. `records` holds ONE library record per library source the kit used,
 * written from the ledger and the core licence table when the file was made, so its duties (credit, non-commercial, disk-only) travel
 * with the file through libraryOrigins: the union of the duties of every source. `bank` is the first 16 hex characters of the sha256
 * of the kit table's canonical text (core musicKits.ts kitBankInput): equal tables give equal bytes. origin stays 'generated' and
 * procedural.generator is MUSIC_RECORDED_GENERATOR (validate.ts instruments_provenance, instrumentsValidate.ts).
 */
export const RecordedInstrumentsSchema = z
  .object({
    kitId: z.string().regex(/^kit\.[a-z0-9-]{1,24}\.[a-z0-9-]{1,24}$/),
    kitVersion: z.number().int().min(1).max(1000),
    /** musicKits.ts MUSIC_SAMPLER_VERSION of the build that made it. */
    sampler: z.number().int().min(1).max(1000),
    bank: z.string().regex(/^[0-9a-f]{16}$/),
    records: z.array(LibraryRecordSchema).min(1).max(8),
  })
  .strict();
export type RecordedInstruments = z.infer<typeof RecordedInstrumentsSchema>;
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
        readColourAs: z.literal('bt601').optional(),
        /** The file carries transparency (an alpha plane: VP8/VP9 with `alpha_mode` 1, or a pixel format with alpha such as ProRes 4444). Set by the server's probe only (made clips, wave 8). It gets no H.264 proxy (which would drop it) and never counts as covering the frame. */
        hasAlpha: z.literal(true).optional() })
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
        /**
         * Present for files that arrived through the import queue (ADR-0023): how they arrived. `origin` stays 'upload' and
         * `importedBy` is the credential's actor ('phone:<dropId>' for a phone drop). `dropId` is present exactly for 'phone';
         * `relativePath` (the path inside a dropped folder, cut to 512 characters) only for 'folder' (validate.ts import_provenance).
         */
        upload: UploadProvenanceSchema.optional(),
        /** Present for a file copied from the owner's library folder (wave 7 library track): its licence record (LibraryRecordSchema). */
        library: LibraryRecordSchema.optional(),
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
            /**
             * ADR-0036 row H1 (open server mode): the models whose licence was warned about when the job was admitted, as the
             * descriptor records them. Any entry makes the export show the non-commercial warning (server export.ts).
             */
            modelLicences: z.array(z.object({ path: z.string(), licence: z.string().nullable(), commercialUse: z.enum(['allowed', 'conditional', 'prohibited', 'unknown']) }).strict()).max(16).optional(),
          })
          .strict()
          .optional(),
        /** Present for a song shortened by «התאמה לאורך» (wave 7 musicfit track): FittedMusicSchema. origin is 'derived'. */
        fitted: FittedMusicSchema.optional(),
        /** Present for built-in music made with recorded instruments of the owner's library (wave 7 instruments track): RecordedInstrumentsSchema. origin is 'generated'. */
        instruments: RecordedInstrumentsSchema.optional(),
        /** Present for a clip made by a page («קליפ מקוד», wave 8 motioncode; madeContract.ts MadeRecordSchema). origin is 'generated', kind 'video'. */
        made: MadeRecordSchema.optional(),
        /** Present for a file fetched from a stock source or a direct link (wave 8 `sources`; sourcesContract.ts SourceRecordSchema): service, item, licence verbatim, credit, fetch time, hash. origin 'upload' (or 'derived' for a shortened song, which carries its one source's record). Written only by use_source_item. */
        source: SourceRecordSchema.optional(),
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

export { ANIMATABLE, EASINGS, KeyframeSchema, type Animatable } from './keyframe.ts';
/** Per-property keyframe lists, strictly increasing in time. A property without keys uses the static transform value. */
export const KeyframesSchema = z.object(Object.fromEntries(ANIMATABLE.map((p) => [p, z.array(KeyframeSchema).max(MAX_TRANSFORM_KEYS).optional()])) as Record<Animatable, z.ZodOptional<z.ZodArray<typeof KeyframeSchema>>>).strict();
const ClipBase = {
  id: Id, start: RationalTimeSchema, duration: RationalTimeSchema, transform: TransformSchema, keyframes: KeyframesSchema.optional(),
  /** Applied in order after the layer is placed (with its transform and opacity), before its mask, transition and blend mode. A time effect (time.*) is always first (ops.ts effectSlot). */
  effects: z.array(EffectInstanceSchema).max(16).optional(),
  blend: z.enum(BLEND_MODES).optional(),
  /** Follow a motion track (ADR-0015): a title, or a picture on a video track, moves with the tracked point; its own transform is then an offset from that point. */
  follow: FollowSchema.optional(),
};
/**
 * Tag of a multicam program segment (ADR-0020): this clip shows angle `angleId` of group `groupId`. Inert for rendering
 * (evaluate, the compositor, audioPlan and the render cache never read it); validate.ts multicam_tag checks it.
 */
export const MulticamTagSchema = z.object({ groupId: Id, angleId: Id }).strict();
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
    /** Multicam (ADR-0020): the group and angle this program segment shows. Absent = an ordinary clip. */
    multicam: MulticamTagSchema.optional(),
    /** Stabilisation (wave 7, steadyContract.ts): the clip's picture is steadied with the camera motion measured on its file. Video clips on video tracks only (validate.ts stabilise_clip). */
    stabilise: ClipStabiliseSchema.optional(),
    /**
     * The marked action moment «הרגע» (wave 7 musicfit track), on the clip's FILE clock: set_clip_impact / sync_impact. It means
     * something only while the clip shows that source time (never validated as "inside"). Copied by split, duplicate and paste;
     * cleared when the clip's file changes (replace_clip_media, a multicam switch), shifted by replace_clip_asset. Part of the
     * fingerprint: a marked clip counts as edited by hand on regeneration. validate.ts clip_impact.
     */
    impact: RationalTimeSchema.optional(),
    /**
     * «תמונה חיה» (wave 8 living, livingContract.ts): what the owner drew as near and far on this photo, for the effect depth.living.
     * Photo clips (an image file) on video tracks only (validate.ts clip_depth). Ordinary document data, like a mask. Kept by split,
     * duplicate, paste, versions, variants and archives; dropped by the portrait backdrop copy; replace_clip_media to another file
     * is refused while it is there (livingSites.test.ts lists every copier).
     */
    depth: ClipDepthSchema.optional(),
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
  fields: z.literal(true).optional(),
  /** 'credits' marks the cards add_credits_card made (wave 7 library track), so running it again replaces them. Absent = an ordinary title. */
  role: z.literal('credits').optional() }).strict();

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
  /** Title clips: style fields for this format only (for example a larger size). In an audience version a size set here is absolute (verifier C3). */
  textStyle: TextStyleSchema.partial().optional(),
  /**
   * Audience versions only (wave 8 audiences): rules of the version's profile the owner keeps as in the master on this clip
   * («להשאיר כמו במקור»). Unique, each keepable for the profile (audienceValidate.ts). A split copies them with the override.
   */
  keep: z.array(z.enum(KEEP_RULES)).min(1).max(KEEP_RULES.length).optional(),
}).strict();
/**
 * «גרסה לכל קהל» (wave 8 audiences; audienceContract.ts): present on a version for an audience. It stores the profile, the rule-table
 * version, the music level and the owner's role corrections — never the result; the rules run on the current master at every
 * projection. Exclusive with a translation (audienceValidate.ts). No `applied` marker exists (verifier C1).
 */
export const VariantAudienceSchema = z.object({
  profile: z.enum(AUDIENCE_PROFILES),
  rules: z.literal(AUDIENCE_RULES_VERSION).describe('rule-table version; a later build never re-reads an old version with new rules'),
  /** the music level of this version, integer dB relative to the rest of the mix; absent = the profile's default (calm −6, grandparents −8) */
  musicDb: z.number().int().min(AUDIENCE_MUSIC_DB_MIN).max(AUDIENCE_MUSIC_DB_MAX).optional(),
  /** the owner's correction of the sound-role heuristic, by sound track id */
  sound: z.record(Id, z.enum(SOUND_ROLES)).optional(),
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
    /** Present on a version for an audience (wave 8): the profile and its settings (VariantAudienceSchema). */
    audience: VariantAudienceSchema.optional(),
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

/**
 * A timeline range a run's clip was placed on (RecipeRunSchema.ranges). `trackId` (optional, additive) is the track it was placed
 * on: template, family film and beat-montage runs record it from the amendment of 2026-11-24 on, so that a clip moved to another
 * track is told from one that was only moved in time.
 */
export const RunRangeSchema = z.object({ start: RationalTimeSchema, end: RationalTimeSchema, trackId: Id.optional() }).strict();
export type RunRange = z.infer<typeof RunRangeSchema>;
export const RecipeRunSchema = z.object({ id: Id, recipeId: z.string().max(64), params: z.record(z.string(), z.unknown()), createdIds: z.array(Id).max(5000), /** Content fingerprint of each created clip as the recipe left it; a clip whose content differs was edited by hand. */ fingerprints: z.record(Id, z.string()).default({}), steps: z.array(z.string().max(400)).max(50),
  /** Template runs only (recipeId `template:<templateId>`, ADR-0016): what each slot of the template holds. */
  slots: z.array(SlotRecordSchema).max(400).optional(),
  /**
   * Beat-montage runs (recipes.ts recordsRanges), OPTIONAL: the timeline range each clip of the run was placed on, by clip id, so
   * a clip deleted by hand is told by its id missing from the document and its range is left empty on regeneration (ADR-0016
   * decision 6). Written by apply_recipe only when its arguments ask for it (recordRanges); absent on every older run.
   * Template runs (apply_template with recordRanges), OPTIONAL too: where each live clip of the run was placed, with its track,
   * as of the moment its fingerprint was taken (a clip kept from an earlier run keeps that run's entry, like its fingerprint).
   * It is what tells a clip that was only moved in time from one edited by hand (templateOps.ts movedOnly). Family film runs
   * record them the same way; beat-montage runs add the track when apply_recipe gets recordTracks (a kept clip keeps the
   * track recorded for it, its range stays where it lies).
   */
  ranges: z.record(Id, RunRangeSchema).optional() }).strict();
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
    /**
     * Candidate moments of a video (wave 5 family film, ADR-0026): measured by the model-free moments job, heuristic, in SOURCE
     * FRAMES of the video stream (sourceTimeOfFrame gives their times). The per-sample series is the derivative file `data`;
     * only these few windows and two file-level values live in the document. Replaced whole by attach_moments (momentsOps.ts).
     * Optional, so documents and logs written before it read unchanged (no schema version change).
     */
    moments: z.object({ origin: AnalysisOrigin, algo: z.number().int().min(1).max(1000), data: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      measured: MomentsMeasuredSchema, file: MomentsFileSchema, flat: z.boolean(), windows: z.array(MomentWindowSchema).max(MOMENTS_MAX_WINDOWS),
      truncated: z.literal(true).optional() }).strict().optional(),
    /** Camera motion of a video, measured per SOURCE frame by the model-free stabilise job (wave 7, steadyContract.ts); attached by attach_camera_motion. */
    cameraMotion: CameraMotionSchema.optional(),
    /**
     * Footage notes «מה יש בקליפ» (wave 8 understand, understandContract.ts): a POINTER to the notes the describe job stored outside the
     * document (the footage_notes table, per content hash and producer) — which producer, the model, a digest and counts. Written by
     * attach_footage_notes (understandOps.ts). Optional, so documents and logs written before it read unchanged (no version change).
     */
    notes: NotesPointerSchema.optional(),
  })
  .strict();

// ---------- multicam groups (ADR-0020): optional, absent until the first group; no schema version bump (wave 4 shares v3) ----------
/** One sync point of a file: group time `group` shows this file's source time `source`. Both sample-aligned on group.sampleRate. */
export const SyncAnchorSchema = z.object({ group: RationalTimeSchema, source: RationalTimeSchema }).strict();
/** How well a file is placed in group time, as measured (or 'manual', 'reference', 'unsynced'). */
export const SyncQualitySchema = z.object({
  verdict: z.enum(SYNC_VERDICTS),
  peakZ: z.number().nullable(),
  peakRatio: z.number().nullable(),
  anchorsUsed: z.number().int().min(0).max(MAX_ANCHORS_PER_PIECE),
  anchorsRejected: z.number().int().min(0).max(10000),
  residualSamples: z.number().int().min(0).nullable(),
  driftPpm: z.number().min(-2000).max(2000).nullable(),
  overlapSeconds: z.number().min(0).nullable(),
  /** Ambiguous results: the best lags, as offset = group time of source time 0. Never anchors. */
  candidates: z.array(z.object({ offset: RationalTimeSchema, score: z.number() }).strict()).max(MAX_SYNC_CANDIDATES),
  /** 0 = matched against the reference; k = through k already placed pieces. */
  chainDepth: z.number().int().min(0).max(8),
  jobId: z.string().max(64).nullable(),
}).strict();
export const MulticamPieceSchema = z.object({
  assetId: Id,
  /** Strictly increasing in group AND source, sample-aligned on group.sampleRate; [] = not placed; one anchor = pure offset; end slopes extend. */
  anchors: z.array(SyncAnchorSchema).max(MAX_ANCHORS_PER_PIECE),
  quality: SyncQualitySchema,
  /**
   * Privacy regions for THIS file (a motion track belongs to one asset, tracking.ts). Every segment showing this piece gets
   * them (switch_angles, place_multicam); a region that follows a motion track follows one of this piece's asset (validate.ts).
   */
  redact: z.array(RedactRegionSchema).min(1).max(MAX_REDACT_REGIONS).optional(),
  /** Follow for THIS file (its motion track is one of this piece's asset): the part of an angle's look that is per file. */
  follow: FollowSchema.optional(),
}).strict();
/**
 * The look of an angle (ADR-0020 D7, wave4-decisions.md "a look stays with the angle"): a switch gives a segment the target
 * angle's transform, effects, mask, blend and per-format transforms, and its piece's redact and follow. Per-shot punch-ins are
 * dropped and reported (SwitchAnglesOutput.dropped).
 */
export const AngleLookSchema = z.object({
  transform: TransformSchema,
  effects: z.array(EffectInstanceSchema).max(16).optional(),
  mask: MaskSchema.optional(),
  blend: z.enum(BLEND_MODES).optional(),
  /** By variant id: the VariantOverride.transform segments of this angle get in that format. */
  variantTransforms: z.record(Id, TransformSchema.partial()).optional(),
}).strict();
export const MulticamAngleSchema = z.object({
  id: Id,
  label: z.string().min(1).max(40),
  kind: z.enum(ANGLE_KINDS),
  pieces: z.array(MulticamPieceSchema).min(1).max(MAX_PIECES),
  look: AngleLookSchema.optional(),
}).strict();
export const MulticamSpeakerSchema = z.object({
  id: Id,
  label: z.string().min(1).max(40),
  /** Angle whose sound tells when this person speaks, and the channel of its pieces (null = mixdown). */
  micAngleId: Id,
  channel: z.number().int().min(0).max(7).nullable(),
  /** Picture angle that frames this person; null = use the wide angle. */
  shotAngleId: Id.nullable(),
  transcriptSpeaker: z.string().min(1).max(80).optional(),
}).strict();
export const MulticamGroupSchema = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  sampleRate: z.number().int().min(8000).max(192000),
  /**
   * Group time IS the source time of this angle's piece 0 (anchors exactly [{0,0}], verdict 'reference'). Default the first
   * sound angle (wave4-decisions.md: group time follows the main sound recorder, so it never needs chunking).
   */
  referenceAngleId: Id,
  angles: z.array(MulticamAngleSchema).min(2).max(MAX_ANGLES),
  speakers: z.array(MulticamSpeakerSchema).max(MAX_SPEAKERS),
  wideAngleId: Id.nullable(),
  origin: AnalysisOrigin,
}).strict();
export type MulticamTag = z.infer<typeof MulticamTagSchema>;
export type SyncAnchor = z.infer<typeof SyncAnchorSchema>;
export type SyncQuality = z.infer<typeof SyncQualitySchema>;
export type MulticamPiece = z.infer<typeof MulticamPieceSchema>;
export type AngleLook = z.infer<typeof AngleLookSchema>;
export type MulticamAngle = z.infer<typeof MulticamAngleSchema>;
export type MulticamSpeaker = z.infer<typeof MulticamSpeakerSchema>;
export type MulticamGroup = z.infer<typeof MulticamGroupSchema>;

/**
 * Adjustment clip (ADR-0016). It has no picture of its own: its enabled effects, mask, opacity and blend act on everything
 * already drawn below it in its sequence at that time. Captions are drawn last and are never affected.
 * It lives only on tracks of kind 'adjustment'.
 * Transform: only opacity is used; x=0, y=0, scale=1, rotation=0. Keyframes: opacity only.
 * No transition, no time effect, no key.chroma, no stylize.shadow (validate.ts adjustmentRefusal).
 * The mask is in frame space (the adjustment's box is the whole frame).
 */
export const AdjustmentClipSchema = z.object({ ...ClipBase, type: z.literal('adjustment'), label: z.string().max(80).optional(), mask: MaskSchema.optional() }).strict();
/**
 * A drawn overlay on a text track (wave 8 carrier, drawn.ts): a drawing or a trip map, by its `drawn.kind`. It has a title's
 * placement (transform, keyframes, effects, blend, follow) and none of its words (text, style, letter animation, live fields, role).
 * The payload's kind must be registered in this build (drawn.ts DrawnPayloadSchema); production registers none until ink or the map lands.
 */
export const DrawnClipSchema = z.object({ ...ClipBase, type: z.literal('drawn'), drawn: DrawnPayloadSchema }).strict();
export const ClipSchema = z.discriminatedUnion('type', [MediaClipSchema, TextClipSchema, CaptionClipSchema, AdjustmentClipSchema, DrawnClipSchema]);

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

// ---------- sequences of one project (ADR-0018 shorts): optional fields; schema version 3 is the wave-4 bump (identity migration) ----------
/** A project holds at most this many sequences (every commit rewrites the whole document). */
export const MAX_SEQUENCES = 64;
/** Loudness of an export: one static gain to `target` LUFS (integrated), lowered if needed to keep true peak under `truePeak` dBTP. */
export const LoudnessTargetSchema = z.object({ target: z.number().min(-40).max(-5), truePeak: z.number().min(-9).max(0) }).strict();
/**
 * A sequence's own output frame (ADR-0018). Never set on the main sequence: the project settings are its frame (validate.ts
 * main_sequence_format). The frame RATE is always the project's: every sequence of a project runs at settings.frameRate.
 */
export const SequenceFormatSchema = z
  .object({
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
    fit: z.enum(['contain', 'cover']),
    /** FORMAT_PROFILES id it was made from (variants.ts): generic guides, not platform numbers. */
    profileId: z.string().max(64).nullable(),
    safeArea: SafeAreaSchema.nullable(),
    /** Absent: the project's settings.loudness applies. null: this sequence is exported without normalisation. */
    loudness: LoudnessTargetSchema.nullable().optional(),
  })
  .strict();
export type SequenceFormat = z.infer<typeof SequenceFormatSchema>;
/** Why a moment was ranked where it was: measured signals and verbatim quotes (ADR-0018). Never a prediction of views. */
export const SHORT_REASON_CODES = [
  'complete_statements', 'ends_on_sentence', 'starts_with_reference', 'context_added', 'opens_with_question', 'hook_word',
  'number_in_opening', 'speaks_to_viewer', 'quick_start', 'dead_air_start', 'louder_than_usual', 'lively_dynamics', 'pace',
  'fillers', 'long_pauses', 'reaction_burst_heuristic', 'shot_changes', 'topic_word', 'low_confidence_words',
  'segment_timing', 'approximate_timing', 'no_transcript', 'missing_input',
] as const;
export type ShortReasonCode = (typeof SHORT_REASON_CODES)[number];
export const SHORT_REASON_UNITS = ['dB', 'words_per_s', 'per_min', 's', 'percent', 'count'] as const;
export const ShortReasonSchema = z
  .object({
    code: z.enum(SHORT_REASON_CODES),
    sign: z.enum(['plus', 'minus', 'note']),
    value: z.number().nullable(),
    unit: z.enum(SHORT_REASON_UNITS).nullable(),
    /** SOURCE time of the evidence, when it has one. */
    at: RationalTimeSchema.nullable(),
    /** Verbatim transcript words only; never reworded. */
    quote: z.string().max(200).nullable(),
  })
  .strict();
export type ShortReason = z.infer<typeof ShortReasonSchema>;
/** A stretch of SOURCE time [start, end) of one asset. */
export const SourceSpanSchema = z.object({ start: RationalTimeSchema, end: RationalTimeSchema }).strict();
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
// ---------- marked source ranges («פנינים», wave 7 pearls track; sourceRangesContract.ts). Optional; no schema version bump. ----------
/**
 * A stretch of SOURCE time of one library file (or the whole file) that the owner marked: a `pearl` (a moment worth keeping, with a
 * name) or a `presence` tag (only who is in the file, no name, span null). Times are exact rationals of any alignment (a word edge is
 * not a frame edge); nothing is rounded when stored. Nothing derived is stored (no usage, no seconds per person).
 *
 * PRIVACY: `label` can hold a child's words, so it is read like a birth date (apps/server/src/peoplePrivacy.ts): the owner's session
 * and a people 'full' grant read it; every other credential reads ''. `people` holds person ids only and is written only by the
 * owner's own session (assertOwnerTagsPeople). Rules the validation checks: validate.ts → sourceRanges.ts validateSourceRanges.
 */
export const SourceRangeSchema = z
  .object({
    id: Id,
    /** A video, sound or picture file of the library; never a colour table. */
    assetId: Id,
    kind: z.enum(['pearl', 'presence']),
    /** SOURCE time [start, end) of assetId; null = the whole file (always null for a still and for kind presence). */
    span: SourceSpanSchema.nullable(),
    /** What the owner typed, one line; '' = not named yet. Always '' for kind presence. */
    label: z.string().max(200).regex(/^[^\n\r]*$/),
    /** Person ids, sorted (code-unit order) and unique; absent = nobody tagged. Written only by the owner's own session. */
    people: z.array(z.string().regex(PERSON_ID)).min(1).max(12).optional(),
    /** The actor of the commit that made it (an accepted proposal is the owner's). */
    createdBy: z.string().max(80),
  })
  .strict();
export type SourceRange = z.infer<typeof SourceRangeSchema>;

/** 'cand_' + core fingerprint() (16 hex digits, entities.ts). */
export const CANDIDATE_ID = /^cand_[0-9a-f]{16}$/;
/**
 * Measured provenance of a sequence (ADR-0018). Written ONLY by the internal apply_sequence_plan, onto sequences created by
 * that same op; no public op sets it, so nobody can type a score or a reason. Informational: ids in it are NOT validated as
 * references (the asset or motion track may be removed later). The score is a relative heuristic within ONE video, never a
 * prediction (SPEC.md:624). ADR-0020 (multicam) adds the member 'multicam' (written by place_multicam); wave 2 adds 'cover'.
 */
export const SequenceOriginSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('short'),
    assetId: Id,
    candidateId: z.string().regex(CANDIDATE_ID).nullable(),
    excerpt: SourceSpanSchema,
    kept: z.array(SourceSpanSchema).min(1).max(40),
    score: z.number().int().min(0).max(100).nullable(),
    reasons: z.array(ShortReasonSchema).max(12),
    reframe: z.enum(['track', 'centre', 'backdrop']),
    motionTrackId: Id.nullable(),
    method: z.string().max(200),
    createdAt: z.string().max(40),
  }).strict(),
  /**
   * ADR-0020: a sequence that place_multicam made for a multicam program (PlaceMulticamArgs.newSequence). Informational like
   * the short's: the group may be removed later, so groupId is not validated as a reference.
   */
  z.object({ kind: z.literal('multicam'), groupId: Id }).strict(),
]);
export type SequenceOrigin = z.infer<typeof SequenceOriginSchema>;
/** The measured origin of a short (ADR-0018); a shorts plan writes only this member. */
export type ShortOrigin = Extract<SequenceOrigin, { kind: 'short' }>;
export const SequenceSchema = z
  .object({
    id: Id,
    name: z.string().max(128),
    tracks: z.array(TrackSchema).describe('Bottom-most layer first'),
    /** Own output frame (ADR-0018); absent = the project frame. Never on the main sequence. */
    format: SequenceFormatSchema.optional(),
    /** Measured provenance (ADR-0018); see SequenceOriginSchema. Never on the main sequence. */
    origin: SequenceOriginSchema.optional(),
  })
  .strict();

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
        timeline: TimelineBehaviourSchema.optional(),
        /**
         * Master limiter (wave 7, track send; op set_master_limiter). OPTIONAL: absent = no limiter, and export and preview run
         * exactly as before the field existed (byte-identical sound). With it, export applies the loudness gain and then a
         * look-ahead brick-wall limiter so no 16-bit sample passes `ceiling` (dBTP); it is then the only ceiling of the mix.
         */
        limiter: z.object({ ceiling: z.number().min(-9).max(0) }).strict().optional() })
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
    /**
     * Multicam groups (ADR-0020), by group id. OPTIONAL and absent until the first group (no default, so a project without
     * groups is stored exactly as before, the people precedent); read it as `doc.multicam ?? {}`.
     */
    multicam: z.record(Id, MulticamGroupSchema).optional(),
    /**
     * Marked source ranges («פנינים», wave 7), by range id. OPTIONAL and absent until the first range (no default, so a project
     * without ranges is stored exactly as before, the people precedent); read it as `doc.sourceRanges ?? {}` (sourceRanges.ts rangesOf).
     */
    sourceRanges: z.record(Id, SourceRangeSchema).optional(),
  })
  .strict();

export type RationalTimeJson = z.infer<typeof RationalTimeSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type { Keyframe } from './keyframe.ts';
export type Keyframes = z.infer<typeof KeyframesSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type MediaClip = z.infer<typeof MediaClipSchema>;
export type TextClip = z.infer<typeof TextClipSchema>;
export type CaptionClip = z.infer<typeof CaptionClipSchema>;
export type AdjustmentClip = z.infer<typeof AdjustmentClipSchema>;
export type DrawnClip = z.infer<typeof DrawnClipSchema>;
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type VariantTranslation = z.infer<typeof VariantTranslationSchema>;
export type VariantAudience = z.infer<typeof VariantAudienceSchema>;
export type VariantOverride = z.infer<typeof VariantOverrideSchema>;
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
  /**
   * v2 -> v3 (wave 4, ADR-0018/0019/0020): sequences may carry `format` and `origin`, and the wave-4 tracks add optional fields
   * only. Identity apart from the version: every field a v2 document holds (people, events, captures, settings.timeline,
   * provenance.upload, …) is carried over unchanged, so stored documents and op logs replay exactly as before
   * (sequences.test.ts replays every fixture and op log through it).
   */
  2: (doc) => ({ ...doc, schemaVersion: 3 }),
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
  // the same for multicam groups (ADR-0020): undoing the first create_multicam deletes the emptied map
  if (out.multicam && Object.keys(out.multicam).length === 0) delete out.multicam;
  // the same for marked source ranges (wave 7 pearls): undoing the first add_source_range deletes the emptied map
  if (out.sourceRanges && Object.keys(out.sourceRanges).length === 0) delete out.sourceRanges;
  return out;
}
