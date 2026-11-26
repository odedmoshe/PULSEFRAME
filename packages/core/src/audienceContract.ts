/**
 * «גרסה לכל קהל» — a version for every audience (wave 8, track audiences). Lead pre-pass: the shared contract.
 * Design: .artifacts/wave8/audiences-plan.md, corrected by audiences-verify.md (C1–C14, the "Cut first" list and the lead
 * decisions) and .artifacts/wave8/decisions.md. Version 1 is «רגועה» (calm) and «לסבא וסבתא» (grandparents) ONLY: the sharing
 * profile and everything that exists only for it (private mark, version covers, review op and digest, export gate, name matching,
 * lossStyle) is a later track and nothing of it is here.
 *
 * - An audience version is a linked format (Variant) over the MASTER frame that carries `audience` (schema.ts VariantAudienceSchema).
 *   It stores its profile, the rule-table version, the music level and the owner's role corrections — never the result. The rules
 *   run on the current master at every projection (variants.ts projectVariant → audience.ts applyAudience), so a strobe added to the
 *   master tomorrow is off in the calm version with no op on the variant.
 * - The owner's exceptions are VariantOverride.keep (per clip, per rule, KEEPABLE by profile). A split copies them (ops.ts copyOverrides).
 * - The calm picture rules come from the registry rows' `stir` class (effects.ts STIR_CLASSES, verifier C12): every effect whose class
 *   is not 'none' is turned off, every transition whose class is not 'none' becomes a dissolve with the same frames. No runtime
 *   `withoutFlash`; no engine reads `audience` (ADR-0005).
 * - Sizes (verifier C3): a size the version sets ITSELF (its own VariantOverride.textStyle.sizeFrac, its own captionStyle.sizeFrac)
 *   is absolute; only an INHERITED master size is scaled. audience.ts audienceTitleSize / audienceCaptionSize.
 * - Sound (verifier C13): a track is music only when EVERY clip on it plays library music or a loop, built-in music or fitted music;
 *   speech only for duck sources and narration; everything else is other and unchanged; first matching rule wins in SOUND_ROLE_ORDER.
 *   Ducking is deepened only on tracks already ducked. With a loudness target the export renormalises the whole mix, so every level
 *   is said relative to the rest of the mix («ביחס לשאר הקול»), and every sound row is «לא נשמע».
 * - Timing never changes: fast cuts are LISTED (pacing.ts rapid_cuts) with jump-to, never changed.
 * - Export retry (verifier C1): no `applied` marker. Exporter.plan takes `{ resolved: true }` on a retry and plans the snapshot as it is.
 * No ops.ts import at run time except the OpError class (audienceOps.ts imports both).
 */
import type * as T from '@pulseframe/time';
import { EFFECTS, STIR_CLASSES, TRANSITIONS, type EffectDef, type StirClass, type TransitionDef } from './effects.ts';
import { OpError, type OpErrorCode } from './ops.ts';
import type { VariantOverride } from './schema.ts';

// ---------- profiles and rule table ----------
import { AUDIENCE_MUSIC_DB_MAX, AUDIENCE_MUSIC_DB_MIN, AUDIENCE_PROFILES, AUDIENCE_RULES_VERSION, KEEP_RULES, SOUND_ROLES, type AudienceProfile, type KeepRule, type SoundRole } from './audienceLimits.ts';
export { AUDIENCE_MUSIC_DB_MAX, AUDIENCE_MUSIC_DB_MIN, AUDIENCE_PROFILES, AUDIENCE_RULES_VERSION, KEEP_RULES, SOUND_ROLES, type AudienceProfile, type KeepRule, type SoundRole };
/** What a change row is about (AudienceChange.rule). */
export const AUDIENCE_RULES = ['effect', 'modulator', 'transition', 'text_loop', 'title_size', 'caption_look', 'music_level', 'ducking'] as const;
export type AudienceRule = (typeof AUDIENCE_RULES)[number];
export const KEEPABLE: Readonly<Record<AudienceProfile, readonly KeepRule[]>> = {
  calm: ['effect', 'modulator', 'transition', 'text_loop'],
  grandparents: ['effect', 'modulator', 'transition', 'text_loop', 'title_size'],
};
/**
 * Fixed numbers of rule table 1. Arithmetic is plain IEEE `*` and `/` with these literals (Node and Chromium agree); the text scale is
 * the exact ratio num/den applied as `size * num / den`.
 */
export const AUDIENCE_TABLE_V1 = {
  /** default music level by profile (dB, integer; DB_GAIN keys) */
  musicDb: { calm: -6, grandparents: -8 } as Readonly<Record<AudienceProfile, number>>,
  /** the stored musicDb range (schema) */
  musicDbMin: AUDIENCE_MUSIC_DB_MIN, musicDbMax: AUDIENCE_MUSIC_DB_MAX,
  /** grandparents: titles and captions ×4/3 of the INHERITED size, capped */
  textScale: { num: 4, den: 3 }, titleSizeCap: 0.5, captionSizeCap: 0.2,
  /** grandparents captions: at most this many characters per line, this box when the style has none, the classic look */
  captionMaxCharsPerLine: 26, captionBackground: '#000000B3', captionPreset: 'classic',
  /** grandparents: a track that is ALREADY ducked is ducked this much deeper, capped (schema duck.reductionDb max) */
  duckExtraDb: 6, duckMaxDb: 40,
  /** a music track's gain after the level is clamped to the schema's range */
  gainMin: 0, gainMax: 4,
  /** the text animation loops the calm rules remove (loop → null) */
  calmTextLoops: ['jitter'],
} as const;
/** Integer dB → linear gain, written out (10^(dB/20)); never Math.pow at run time, so Node and Chromium agree. */
export const DB_GAIN: Readonly<Record<number, number>> = Object.freeze({
  [-20]: 0.1, [-19]: 0.11220184543019636, [-18]: 0.12589254117941673, [-17]: 0.14125375446227545, [-16]: 0.15848931924611132,
  [-15]: 0.17782794100389226, [-14]: 0.19952623149688797, [-13]: 0.22387211385683395, [-12]: 0.251188643150958, [-11]: 0.28183829312644537,
  [-10]: 0.31622776601683794, [-9]: 0.35481338923357547, [-8]: 0.3981071705534972, [-7]: 0.44668359215096315, [-6]: 0.5011872336272722,
  [-5]: 0.5623413251903491, [-4]: 0.6309573444801932, [-3]: 0.7079457843841379, [-2]: 0.7943282347242815, [-1]: 0.8912509381337456, 0: 1,
});
/** The music level a version uses: its own, else its profile's default. */
export const audienceMusicDb = (a: { profile: AudienceProfile; musicDb?: number }): number => a.musicDb ?? AUDIENCE_TABLE_V1.musicDb[a.profile];

// ---------- calm picture rules, derived from the registry rows (C12) ----------
/** Effect types the calm rules turn off: every registry row whose stir class is not 'none'. Both profiles apply them. */
export const CALM_OFF_EFFECTS: readonly string[] = Object.freeze((EFFECTS as readonly EffectDef[]).filter((e) => e.stir !== 'none').map((e) => e.id));
/** Transition types the calm rules soften into a dissolve with the same frames (velocity, colour and seed dropped; sync kept). */
export const CALM_SOFTENED_TRANSITIONS: readonly string[] = Object.freeze((TRANSITIONS as readonly TransitionDef[]).filter((t) => t.stir !== 'none').map((t) => t.id));
/** The class of an effect or transition type; unknown types are treated as stirring both (default-deny). */
export const stirOfEffect = (type: string): StirClass => (EFFECTS as readonly EffectDef[]).find((e) => e.id === type)?.stir ?? 'light-shake';
export const stirOfTransition = (type: string): StirClass => (TRANSITIONS as readonly TransitionDef[]).find((t) => t.id === type)?.stir ?? 'light-shake';
export { STIR_CLASSES, type StirClass };

// ---------- sound roles (C13) ----------
/**
 * Why a track has its role, in the fixed order the rules are tried (first match wins):
 * owner — the owner's correction (`audience.sound[trackId]`);
 * music_files — EVERY clip on the track plays a library file of kind music or loop, built-in music (provenance.procedural music
 *   style) or fitted music (provenance.fitted);
 * duck_source — another track ducks under this one (its id is in some track's duck.sourceTrackIds);
 * narration — every clip plays generated speech (provenance.voice) or a recorded narration;
 * mixed — some clips are music and some are not: other;
 * empty — no clips: other;
 * unknown — anything else (camera sound, a birthday song filmed with the picture): other.
 */
export const SOUND_ROLE_ORDER = ['owner', 'music_files', 'duck_source', 'narration', 'mixed', 'empty', 'unknown'] as const;
export type SoundRoleReason = (typeof SOUND_ROLE_ORDER)[number];
export interface SoundRoleReading { trackId: string; role: SoundRole; why: SoundRoleReason }

// ---------- the list of changes (GET …/variants/:variantId/audience, MCP get_audience_changes) ----------
/** One application of a rule. The same code builds the projected document and this list (audience.ts), so they cannot disagree. */
export interface AudienceChange {
  /** stable within one revision: `${rule}:${clipId ?? trackId}:${detail}` */
  key: string;
  rule: AudienceRule;
  clipId: string | null;
  trackId: string | null;
  /** where jump-to goes (inside the clip, or the track's first clip); endFrame exclusive */
  startFrame: number; endFrame: number;
  /** registry ids, sizes, dB: machine values the panel words (never a sentence) */
  before: string | number | null; after: string | number | null;
  keepable: boolean;
  /** true when the owner kept this rule on this clip: the change is NOT applied and is listed so it can be given back */
  kept: boolean;
}
/** A stretch of fast cuts (pacing.ts rapid_cuts), listed only: a version never changes timing. HEURISTIC (the pacing window). */
export interface AudienceFastCuts { startFrame: number; endFrame: number; cuts: number; limit: number; windowSeconds: number }
/** Fixed honest sentences the panel always shows (words in i18n `audience.notHandled.*`). */
export const AUDIENCE_NOT_HANDLED = ['pace', 'keys', 'not_medical', 'flash_check', 'sound_unheard'] as const;
export type AudienceNotHandled = (typeof AUDIENCE_NOT_HANDLED)[number];
export interface AudienceChanges {
  projectId: string; variantId: string; revision: number;
  profile: AudienceProfile; rules: typeof AUDIENCE_RULES_VERSION;
  /** the level the version uses (dB, relative to the rest of the mix) */
  musicDb: number;
  changes: AudienceChange[];
  fastCuts: AudienceFastCuts[];
  soundRoles: SoundRoleReading[];
  notHandled: readonly AudienceNotHandled[];
  /** what the list is: rules applied to the document; nothing was looked at or listened to */
  method: string;
}
export const AUDIENCE_CHANGES_METHOD = 'audience rules table 1 applied to the current master document (the same code that projects the version); fast cuts from the pacing report window (heuristic); nothing was looked at or listened to';

// ---------- names on the wire ----------
export const AUDIENCE_ROUTE = '/api/v1/projects/:id/variants/:variantId/audience';
export const AUDIENCE_MCP_TOOL = 'get_audience_changes';
export const AUDIENCE_PUBLIC_OPS = ['add_audience_version', 'update_audience_version', 'set_audience_keep'] as const;

// ---------- small shared helpers (complete) ----------
/**
 * Whether an override holds anything but `keep` (verifier C14): override counts and "clear" buttons of the format panels count only
 * these, so a version whose only overrides are kept rules does not read as "adjusted for this format".
 */
export const hasFormatOverride = (ov: VariantOverride | undefined): boolean => !!ov && Object.keys(ov).some((k) => k !== 'keep');

// ---------- refusals ----------
export interface AudienceRefusalRow<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint: string): AudienceRefusalRow<A> => ({ code, message, hint });
/** Every refusal of the three operations, in the order each op checks. Hebrew: i18n audiences.ts HE_AUDIENCES (each with the next step). */
export const AUDIENCE_REFUSALS = {
  notBuilt: refusal('unknown_op', (op: string) => `${op}: versions for an audience are not built in this build yet`, 'Nothing was changed. Update the editor and try again.'),
  notFound: refusal('not_found', (variantId: string) => `version ${variantId} is not in the project`, 'get_summary lists the formats and versions.'),
  notAudience: refusal('incompatible', (variantId: string) => `format ${variantId} is a format, not a version for an audience`, 'Choose a version made with add_audience_version.'),
  trackNotFound: refusal('not_found', (trackId: string) => `track ${trackId} is not in the project`, 'get_timeline lists the tracks.'),
  trackNotSound: refusal('incompatible', (trackId: string) => `track ${trackId} is not a sound track; only sound tracks have a role`, 'Choose a sound track.'),
  clipNotFound: refusal('not_found', (clipId: string) => `clip ${clipId} is not in the project`, 'get_timeline lists the clips.'),
  clipIsSound: refusal('incompatible', (clipId: string) => `clip ${clipId} is a sound clip; the kept rules are about pictures and titles`, 'For the music level, correct the track\'s role with update_audience_version.'),
  notKeepable: refusal('incompatible', (rule: string, profile: string) => `rule ${rule} cannot be kept in a ${profile} version`, 'Keepable rules: list_catalog → audiences, or the change list of the version.'),
  ruleNotForClip: refusal('incompatible', (rule: string, clipId: string) => `rule ${rule} does not apply to clip ${clipId}`, 'Keep the size on a title clip.'),
} as const;
export type AudienceRefusalKey = keyof typeof AUDIENCE_REFUSALS;
export function audienceRefusal<K extends AudienceRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof AUDIENCE_REFUSALS)[K]['message']>): OpError {
  const r = AUDIENCE_REFUSALS[key] as AudienceRefusalRow<unknown[]>;
  return new OpError(r.code, r.message(...values), details, r.hint);
}
/** Route refusals (ApiError on the server; Hebrew in HE_AUDIENCES). */
export const AUDIENCE_API_REFUSALS = {
  notBuilt: { status: 501, code: 'audience_not_built', message: () => 'the change list of a version for an audience is not built in this build yet', hint: 'Nothing was changed. The version itself can still be viewed and exported once it is built.' },
  notAudience: { status: 409, code: 'not_audience_version', message: (variantId: string) => `format ${variantId} is a format, not a version for an audience`, hint: 'get_summary lists the formats and versions.' },
} as const;

/** Thrown by a pure function of this track that is not built yet (audience.ts stubs). Never thrown from projectVariant (C7). */
export class AudienceNotBuiltError extends Error {
  readonly code = 'audience_not_built';
  constructor(readonly fn: string) { super(`${fn}: versions for an audience are not built in this build yet`); }
}

// ---------- validation codes (audienceValidate.ts) ----------
export const AUDIENCE_VALIDATION = {
  withTranslation: 'audience_with_translation',
  keepOutsideAudience: 'audience_keep_outside_version',
  keepNotKeepable: 'audience_keep_not_keepable',
  keepDuplicate: 'audience_keep_duplicate',
} as const;

/** Exact-time helper type for the fast-cut rows the server builds (re-exported so builders do not reach into pacing.ts types). */
export type AudienceTime = T.RationalTime;
