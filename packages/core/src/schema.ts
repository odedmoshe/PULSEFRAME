/**
 * Canonical ProjectDocument (SPEC §5), schema version 1.
 * JSON-serializable; binary media stays outside and is referenced by asset id.
 * Transient state (selection, playhead, presence, panel layout) is NOT part of this document.
 */
import { z } from 'zod';

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
      .object({ width: z.number().int().positive(), height: z.number().int().positive(), frameRate: RateSchema, codec: z.string(), rotation: z.number(), frameCount: z.number().int().nonnegative().nullable() })
      .strict()
      .optional(),
    audio: z.object({ sampleRate: z.number().int().positive(), channels: z.number().int().positive(), codec: z.string() }).strict().optional(),
    image: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), codec: z.string(), hasAlpha: z.boolean() }).strict().optional(),
    provenance: z
      .object({
        origin: z.enum(['upload', 'fixture', 'generated', 'derived']),
        importedAt: z.string(),
        importedBy: z.string(),
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

const ClipBase = { id: Id, start: RationalTimeSchema, duration: RationalTimeSchema, transform: TransformSchema };
export const MediaClipSchema = z
  .object({
    ...ClipBase,
    type: z.literal('media'),
    assetId: Id,
    sourceIn: RationalTimeSchema.describe('Source time shown at the clip start (speed is 1 in schema v1)'),
    gain: z.number().min(0).max(8).describe('Linear audio gain'),
    linkGroupId: Id.nullable(),
  })
  .strict();
export const TextClipSchema = z.object({ ...ClipBase, type: z.literal('text'), text: z.string().max(2000), style: TextStyleSchema }).strict();
export const ClipSchema = z.discriminatedUnion('type', [MediaClipSchema, TextClipSchema]);

export const TrackSchema = z
  .object({ id: Id, kind: z.enum(['video', 'audio', 'text']), name: z.string().max(128), locked: z.boolean(), muted: z.boolean(), hidden: z.boolean(), clips: z.array(ClipSchema) })
  .strict();
export const SequenceSchema = z.object({ id: Id, name: z.string().max(128), tracks: z.array(TrackSchema).describe('Bottom-most layer first') }).strict();

export const ProjectSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: Id,
    name: z.string().min(1).max(200),
    settings: z
      .object({ width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192), frameRate: RateSchema, sampleRate: z.number().int().min(8000).max(192000), background: Color })
      .strict(),
    assets: z.record(Id, AssetSchema),
    sequences: z.record(Id, SequenceSchema),
    mainSequenceId: Id,
  })
  .strict();

export type RationalTimeJson = z.infer<typeof RationalTimeSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type MediaClip = z.infer<typeof MediaClipSchema>;
export type TextClip = z.infer<typeof TextClipSchema>;
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
