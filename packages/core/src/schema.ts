/**
 * Canonical ProjectDocument (SPEC §5), schema version 1.
 * JSON-serializable; binary media stays outside and is referenced by asset id.
 * Transient state (selection, playhead, presence, panel layout) is NOT part of this document.
 */
import { z } from 'zod';
import { BLEND_MODES, EffectInstanceSchema, MaskSchema, TransitionSchema } from './effects.ts';

export const SCHEMA_VERSION = 1;

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

export const AssetSchema = z
  .object({
    id: Id,
    kind: z.enum(['video', 'audio', 'image']),
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
    /**
     * Present when the stored media is a conformed copy (SPEC §7): the original could not be edited directly
     * (variable frame rate, rotation metadata, or a codec the editor cannot decode). The original bytes are kept.
     */
    conform: z
      .object({
        originalContentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        originalByteSize: z.number().int().nonnegative(),
        reasons: z.array(z.enum(['variable-frame-rate', 'rotation', 'codec', 'pixel-aspect', 'still-format'])).min(1),
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
        /** Present for built-in synthesised sounds: which formula made this file. */
        procedural: z.object({ id: z.string(), version: z.number().int(), generator: z.string() }).strict().optional(),
        /** Present for provider outputs (SPEC §25, Amendment A1 FF-08): enough to recreate the recipe and trace lineage. */
        derived: z
          .object({ jobId: z.string(), capabilityId: z.string(), capabilityVersion: z.string(), graphDigest: z.string(), params: z.record(z.string(), z.unknown()), sourceAssetIds: z.array(z.string()), outputName: z.string(), outputRole: z.string(), encoding: z.string(), provider: z.record(z.string(), z.unknown()) })
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
  })
  .strict();
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
  /** Applied in order to the transformed layer, before mask, blend and opacity compositing. */
  effects: z.array(EffectInstanceSchema).max(16).optional(),
  blend: z.enum(BLEND_MODES).optional(),
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
    volume: z.array(z.object({ time: RationalTimeSchema, value: z.number().min(0).max(4) }).strict()).min(1).max(2000).optional(),
    fadeOut: RationalTimeSchema.optional(),
    mask: MaskSchema.optional(),
    transition: TransitionSchema.optional(),
  })
  .strict();
export const TextClipSchema = z.object({ ...ClipBase, type: z.literal('text'), text: z.string().max(2000), style: TextStyleSchema }).strict();

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
  })
  .strict();


export const RecipeRunSchema = z.object({ id: Id, recipeId: z.string().max(64), params: z.record(z.string(), z.unknown()), createdIds: z.array(Id).max(5000), /** Content fingerprint of each created clip as the recipe left it; a clip whose content differs was edited by hand. */ fingerprints: z.record(Id, z.string()).default({}), steps: z.array(z.string().max(400)).max(50) }).strict();
export type RecipeRun = z.infer<typeof RecipeRunSchema>;

// ---------- analysis results (SPEC §19): measured from a source file, stored in SOURCE time, editable ----------
const AnalysisOrigin = z.object({ method: z.string().max(200), params: z.record(z.string(), z.union([z.number(), z.string()])), createdAt: z.string(), createdBy: z.string(), edited: z.boolean().describe('true once a person or agent corrected the result by hand') }).strict();
export const AnalysisSchema = z
  .object({
    assetId: Id,
    /** Picture cuts inside the source file (the first frame of each new shot), ascending. */
    scenes: z.object({ origin: AnalysisOrigin, cuts: z.array(RationalTimeSchema).max(20000) }).strict().optional(),
    /** Beat grid of the source audio, ascending. bpm and confidence describe the detector's estimate; beats are what editing tools use. */
    beats: z.object({ origin: AnalysisOrigin, bpm: z.number().min(20).max(400).nullable(), confidence: z.number().min(0).max(1).nullable(), beats: z.array(RationalTimeSchema).max(50000), /** Beats that start a bar (each is one of `beats`); absent when no bar pattern was found or entered. */ downbeats: z.array(RationalTimeSchema).max(50000).optional(), /** Beats per bar behind `downbeats`, when known. */ meter: z.number().int().min(2).max(12).nullable().optional() }).strict().optional(),
  })
  .strict();

export const ClipSchema = z.discriminatedUnion('type', [MediaClipSchema, TextClipSchema, CaptionClipSchema]);

export const TrackSchema = z
  .object({
    id: Id, kind: z.enum(['video', 'audio', 'text', 'caption']), name: z.string().max(128), locked: z.boolean(), muted: z.boolean(), hidden: z.boolean(), clips: z.array(ClipSchema),
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
        loudness: z.object({ target: z.number().min(-40).max(-5), truePeak: z.number().min(-9).max(0) }).strict().optional() })
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
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type SafeArea = z.infer<typeof SafeAreaSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Word = z.infer<typeof WordSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Sequence = z.infer<typeof SequenceSchema>;
export type ProjectDocument = z.infer<typeof ProjectSchema>;

export interface NewProjectOptions { id: string; name: string; width?: number; height?: number; frameRate?: { num: number; den: number }; sampleRate?: number }
export function createProject(o: NewProjectOptions): ProjectDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: o.id,
    name: o.name,
    settings: { width: o.width ?? 1080, height: o.height ?? 1920, frameRate: o.frameRate ?? { num: 30, den: 1 }, sampleRate: o.sampleRate ?? 48000, background: '#000000' },
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
  };
}

/** Schema migrations: version N -> N+1. v1 is the first version, so the table is empty but the path is exercised by tests. */
const MIGRATIONS: Record<number, (doc: any) => any> = {};
export function migrateProject(raw: unknown): ProjectDocument {
  let doc = raw as { schemaVersion?: number };
  if (typeof doc?.schemaVersion !== 'number') throw new Error('not a PULSEFRAME project: missing schemaVersion');
  if (doc.schemaVersion > SCHEMA_VERSION) throw new Error(`project schema ${doc.schemaVersion} is newer than supported ${SCHEMA_VERSION}`);
  while (doc.schemaVersion! < SCHEMA_VERSION) {
    const step = MIGRATIONS[doc.schemaVersion!];
    if (!step) throw new Error(`no migration from schema ${doc.schemaVersion}`);
    doc = step(doc);
  }
  return ProjectSchema.parse(doc);
}
