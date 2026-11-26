/**
 * «גרסה לכל קהל» — the rules of a version for an audience (wave 8 audiences). BUILDER W1 owns this file after the pre-pass; the lead
 * fixed the signatures and the contract (audienceContract.ts). Until W1 builds them every function here throws AudienceNotBuiltError
 * and AUDIENCE_PROJECTION_BUILT is false, which keeps the three operations refusing `notBuilt` (audienceOps.ts) — so no version can
 * exist that would project as the master while calling itself calm.
 *
 * WHERE THE RULES APPLY (the projection contract): variants.ts projectVariant calls `applyAudience(out, v, report)` as its LAST step,
 * after the frame, the caption style, the hidden clips, the overrides (text, textStyle, transform) and phraseText, only when
 * `v.audience` is set. W1 adds that one call at the marked line of variants.ts. Order inside applyAudience (rule table 1):
 *   1. picture (both profiles; per clip, skipped where the clip's VariantOverride.keep names the rule):
 *      effect — every effect instance whose type is in CALM_OFF_EFFECTS gets enabled:false (adjustment clips included);
 *      modulator — every effect instance's `modulate` is deleted (modulators are beat-only, so all of them);
 *      transition — a media clip's transition whose type is in CALM_SOFTENED_TRANSITIONS becomes { type:'dissolve', frames, sync? };
 *      text_loop — a title's animation loop in AUDIENCE_TABLE_V1.calmTextLoops becomes null.
 *   2. text (grandparents): title_size — audienceTitleSize(master size, the version's own override size); caption_look on every caption
 *      track — audienceCaptionSize, maxCharsPerLine min 26, background when null, preset classic; a field the version's own
 *      captionStyle sets is left as set (C3).
 *   3. sound (both): soundRoles(out, v.audience) → a music track's audio gain × DB_GAIN[audienceMusicDb], clamped to 0..4 (music_level);
 *      grandparents: a track that is already ducked gets reductionDb + 6, capped at 40 (ducking). Speech and other are unchanged.
 *   Every application pushes one AudienceChange to `report` when given (kept ones with kept:true and nothing applied).
 * applyAudience NEVER throws (verifier C7: ten components read the projected document); unknown ids are skipped.
 * Every rule is a pure function of (master, variant): projecting the master once is the only path (the export retry plans its
 * snapshot as resolved, C1), and W1's property test checks the same master + variant always gives the same document.
 */
import type { ProjectDocument, Track, Variant, VariantAudience } from './schema.ts';
import { AudienceNotBuiltError, type AudienceChange, type AudienceChanges, type AudienceProfile, type SoundRoleReading } from './audienceContract.ts';

/** True once W1 has built this file and the call in projectVariant; turns the three operations' bodies and their fuzz rows on. */
export const AUDIENCE_PROJECTION_BUILT = false;

/** Apply the version's rules to the projected document `out` in place (see the header for the order). Never throws once built. */
export function applyAudience(out: ProjectDocument, v: Variant, report?: AudienceChange[]): void {
  void out; void v; void report;
  throw new AudienceNotBuiltError('applyAudience');
}

/**
 * The size rule of verifier C3. `own` is the size the VERSION sets itself (its VariantOverride.textStyle.sizeFrac for this title):
 * absolute, returned as it is. Otherwise the INHERITED master size is scaled: grandparents min(cap, inherited × 4 / 3); calm unchanged.
 * So the inspector that shows the projected size and commits it as the version's own size shows the same number afterwards.
 */
export function audienceTitleSize(inherited: number, own: number | undefined, profile: AudienceProfile): number {
  void inherited; void own; void profile;
  throw new AudienceNotBuiltError('audienceTitleSize');
}
/** The same rule for a caption track's size: `own` is the version's own captionStyle.sizeFrac (cap 0.2). */
export function audienceCaptionSize(inherited: number, own: number | undefined, profile: AudienceProfile): number {
  void inherited; void own; void profile;
  throw new AudienceNotBuiltError('audienceCaptionSize');
}

/**
 * The music-track rule of verifier C13, for one sound track of `doc` (the projected document): the owner's correction first, then
 * SOUND_ROLE_ORDER — music only when EVERY clip plays library music or a loop (provenance.library.kind 'music' | 'loop'), built-in
 * music (provenance.procedural music style, packOps MUSIC_STYLE_ID) or fitted music (provenance.fitted); speech for a duck source or
 * when every clip is narration (provenance.voice); 'mixed', 'empty' or 'unknown' → other. Pure; reads assets through Object.hasOwn.
 */
export function soundRoleOf(doc: ProjectDocument, track: Track, audience?: VariantAudience): SoundRoleReading {
  void doc; void track; void audience;
  throw new AudienceNotBuiltError('soundRoleOf');
}
/** soundRoleOf for every sound track of the main sequence, in track order. */
export function soundRoles(doc: ProjectDocument, audience?: VariantAudience): SoundRoleReading[] {
  void doc; void audience;
  throw new AudienceNotBuiltError('soundRoles');
}

/**
 * The list the panel, GET …/variants/:variantId/audience and MCP get_audience_changes show: projectVariant with a report (so the list
 * and the picture come from the same code), the fast-cut stretches of pacingReport (rapid_cuts, listed only), the sound roles and
 * AUDIENCE_NOT_HANDLED. Throws OutputTargetError-free typed errors only: the server maps an unknown or non-audience variant itself.
 */
export function audienceChanges(doc: ProjectDocument, variantId: string, revision: number): AudienceChanges {
  void doc; void variantId; void revision;
  throw new AudienceNotBuiltError('audienceChanges');
}
