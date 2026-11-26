/**
 * The enums of «גרסה לכל קהל» (wave 8 audiences) that schema.ts needs. No imports, so schema.ts can read them without a cycle
 * (audienceContract.ts imports ops.ts, which imports schema.ts). audienceContract.ts re-exports them; import from there.
 */
export const AUDIENCE_PROFILES = ['calm', 'grandparents'] as const;
export type AudienceProfile = (typeof AUDIENCE_PROFILES)[number];
/** The rule-table version a version is stored with (`audience.rules`). A later build never re-reads an old version with new rules. */
export const AUDIENCE_RULES_VERSION = 1 as const;
/** Rules the owner may keep as in the master on one clip (VariantOverride.keep). Caption look and sound are per track: the owner sets
 * the version's own caption style (absolute, verifier C3) or corrects a track's sound role instead. */
export const KEEP_RULES = ['effect', 'modulator', 'transition', 'text_loop', 'title_size'] as const;
export type KeepRule = (typeof KEEP_RULES)[number];
export const SOUND_ROLES = ['music', 'speech', 'other'] as const;
export type SoundRole = (typeof SOUND_ROLES)[number];
/** The stored music level range (integer dB; audienceContract DB_GAIN keys). */
export const AUDIENCE_MUSIC_DB_MIN = -20;
export const AUDIENCE_MUSIC_DB_MAX = 0;
