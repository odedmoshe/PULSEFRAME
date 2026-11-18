/**
 * Limits and names of multicam groups (ADR-0020, «סנכרון וחיתוך»). Lead contract. Must not import anything: schema.ts imports
 * this file at runtime (the tracking.ts precedent).
 */
export const MAX_MULTICAM_GROUPS = 8;
export const MAX_ANGLES = 9;
export const MAX_PIECES = 16;
export const MAX_ANCHORS_PER_PIECE = 64;
export const MAX_PROJECT_ANCHORS = 2048;
export const MAX_SPEAKERS = 8;
export const MAX_SYNC_CANDIDATES = 3;
export const MAX_CUTS = 1000;
/** One multicam op never changes more entities than this, so its undo fits one restore_entities (max 5000 targets, ops.ts). */
export const MAX_TOUCHED_ENTITIES = 4500;
export const DEFAULT_DRIFT_TOLERANCE_FRAMES = 0.5;
/**
 * A second sound source is laid as consecutive chunks when its drift over the placed range exceeds this many seconds; each
 * chunk errs at most SOUND_CHUNK_MAX_ERROR_S and lasts at most SOUND_CHUNK_MAX_SECONDS; neighbours overlap by exactly one
 * frame with one-frame fades (wave4-decisions.md: nobody has listened to the joins yet).
 */
export const SOUND_DRIFT_CHUNK_THRESHOLD_S = 0.001;
export const SOUND_CHUNK_MAX_ERROR_S = 0.0005;
export const SOUND_CHUNK_MAX_SECONDS = 60;
/** Envelope derivative: index n <-> file (source) time rt(n, ENVELOPE_RATE); decoded at ENVELOPE_DECODE_RATE. */
export const ENVELOPE_RATE = 100;
export const ENVELOPE_DECODE_RATE = 16000;
export const ENVELOPE_MAX_CHANNELS = 8;
export const SYNC_VERDICTS = ['reference', 'confident', 'check', 'ambiguous', 'no-shared-sound', 'inconsistent', 'manual', 'unsynced'] as const;
export type SyncVerdict = (typeof SYNC_VERDICTS)[number];
/** Verdicts whose anchors place a piece in group time. Every other verdict has anchors = [] (validate.ts multicam_sync). */
export const PLACED_VERDICTS = ['reference', 'confident', 'check', 'manual'] as const satisfies readonly SyncVerdict[];
export const isPlacedVerdict = (v: SyncVerdict): boolean => (PLACED_VERDICTS as readonly string[]).includes(v);
export const ANGLE_KINDS = ['picture', 'sound'] as const;
export type AngleKind = (typeof ANGLE_KINDS)[number];
/**
 * Starting thresholds of the sync verdicts (plan §4). Tuned on synthetic speech only (wave4-decisions.md): the job records the
 * values it used in group.origin.params, and nothing is called right until the owner has reviewed one real recording.
 */
export const SYNC_THRESHOLDS = {
  confident: { peakZ: 10, peakRatio: 1.5, minAnchors: 3, residualMs: 1 },
  check: { peakRatio: 1.2, minAnchors: 2, residualMs: 5 },
  ambiguousBelowPeakRatio: 1.2,
  noSharedSoundBelowPeakZ: 6,
  inconsistentAboveResidualMs: 5,
  minOverlapSeconds: 20,
  fineWindowSamplesLog2: 17,
  fineSearchMs: 50,
  dropAnchorsOffMs: 2,
} as const;
/** The sync method name recorded in group.origin.method by the measuring job (W2 may append a version). */
export const MULTICAM_SYNC_METHOD = 'gcc-phat-beta flux coarse + gcc-phat fine + theil-sen fit (model-free)';
