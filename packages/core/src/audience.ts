/**
 * «גרסה לכל קהל» — the rules of a version for an audience (wave 8 audiences). BUILDER W1 owns this file after the pre-pass; the lead
 * fixed the signatures and the contract (audienceContract.ts). Built by W1: the rules, the size rule, the sound roles and the change
 * list are in, and projectVariant calls applyAudience, so AUDIENCE_PROJECTION_BUILT is true and the three operations are on.
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
import * as T from '@pulseframe/time';
import type { Asset, Clip, ProjectDocument, Sequence, Track, Variant, VariantAudience } from './schema.ts';
import {
  AUDIENCE_CHANGES_METHOD, AUDIENCE_NOT_HANDLED, AUDIENCE_TABLE_V1, audienceMusicDb, DB_GAIN,
  type AudienceChange, type AudienceChanges, type AudienceFastCuts, type AudienceProfile, type AudienceRule, type KeepRule, type SoundRoleReading,
} from './audienceContract.ts';
import { EFFECTS, TRANSITIONS, type EffectDef, type TransitionDef } from './effects.ts';
import { isBuiltinMusic } from './musicStyles.ts';
import { pacingReport } from './pacing.ts';
import { projectVariant } from './variants.ts';

/** True once W1 has built this file and the call in projectVariant; turns the three operations' bodies and their fuzz rows on. */
export const AUDIENCE_PROJECTION_BUILT = true;

// Default-deny: only a registry row classed 'none' is left alone, so a type this table does not know is treated as stirring
// (the same rule as audienceContract stirOfEffect / stirOfTransition). On registry ids this is exactly CALM_OFF_EFFECTS and
// CALM_SOFTENED_TRANSITIONS.
const CALM_EFFECT_TYPES: ReadonlySet<string> = new Set((EFFECTS as readonly EffectDef[]).filter((e) => e.stir === 'none').map((e) => e.id));
const CALM_TRANSITION_TYPES: ReadonlySet<string> = new Set((TRANSITIONS as readonly TransitionDef[]).filter((t) => t.stir === 'none').map((t) => t.id));
const stirsEffect = (type: string) => !CALM_EFFECT_TYPES.has(type);
const stirsTransition = (type: string) => !CALM_TRANSITION_TYPES.has(type);
const CALM_TEXT_LOOPS: ReadonlySet<string> = new Set(AUDIENCE_TABLE_V1.calmTextLoops);
/** Fast-cut window of the change list (the pacing report's own default; listed with the rows). HEURISTIC. */
const FAST_CUT_WINDOW_SECONDS = 5;

const own = <V>(r: Record<string, V> | undefined, k: string): V | undefined => (r && Object.hasOwn(r, k) ? r[k] : undefined);

/** [startFrame, endFrame) of a time span on the project rate; at least one frame long. */
function frames(start: T.RationalTime, end: T.RationalTime, rate: T.Rate): { startFrame: number; endFrame: number } {
  const s = T.frameIndexAt(start, rate);
  let e = T.frameIndexAt(end, rate);
  if (!T.eq(T.frameTime(e, rate), end)) e += 1;
  return { startFrame: s, endFrame: Math.max(s + 1, e) };
}
const clipFrames = (c: Clip, rate: T.Rate) => frames(c.start, T.add(c.start, c.duration), rate);
/** Where a track row jumps: the track's first clip; a caption track without cues: the first clip of the track it shows; else frame 0. */
function trackFrames(seq: Sequence, track: Track, rate: T.Rate) {
  const first = (t: Track | undefined) => t?.clips.reduce<Clip | undefined>((a, c) => (!a || T.lt(c.start, a.start) ? c : a), undefined);
  const c = first(track) ?? (track.caption?.linkedTrackId ? first(seq.tracks.find((t) => t.id === track.caption!.linkedTrackId)) : undefined);
  return c ? clipFrames(c, rate) : { startFrame: 0, endFrame: 1 };
}

/** Apply the version's rules to the projected document `out` in place (see the header for the order). Never throws. */
export function applyAudience(out: ProjectDocument, v: Variant, report?: AudienceChange[]): void {
  const a = v.audience;
  if (!a) return;
  const profile = a.profile;
  const rate = out.settings.frameRate;
  const overrides = v.overrides ?? {};
  const seen = new Map<string, number>();
  const push = (c: Omit<AudienceChange, 'key'> & { detail: string }) => {
    if (!report) return;
    const { detail, ...row } = c;
    const base = `${row.rule}:${row.clipId ?? row.trackId}:${detail}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    report.push({ key: n ? `${base}#${n}` : base, ...row });
  };
  const sequences = Object.values(out.sequences ?? {});

  // 1. picture rules, both profiles, per clip (skipped where the clip keeps the rule)
  for (const seq of sequences)
    for (const track of seq.tracks) {
      if (track.kind === 'audio') continue; // no picture: a sound clip has no kept rules either (set_audience_keep clipIsSound)
      for (const clip of track.clips) {
        const keep: ReadonlySet<KeepRule> = new Set(own(overrides, clip.id)?.keep ?? []);
        const at = clipFrames(clip, rate);
        const row = (rule: AudienceRule, detail: string, before: AudienceChange['before'], after: AudienceChange['after'], kept: boolean) =>
          push({ rule, detail, clipId: clip.id, trackId: track.id, sequenceId: seq.id, ...at, before, after, keepable: true, kept });
        for (const e of clip.effects ?? []) {
          if (e.enabled && stirsEffect(e.type)) {
            const kept = keep.has('effect');
            if (!kept) e.enabled = false;
            row('effect', e.id, e.type, null, kept);
          }
          // modulators are beat-only (effects.ts), so every one goes; one on an effect that is off moves nothing and is left alone
          if (e.enabled && e.modulate && Object.keys(e.modulate).length) {
            const kept = keep.has('modulator');
            const before = Object.keys(e.modulate).sort().join(',');
            if (!kept) delete e.modulate;
            row('modulator', e.id, before, null, kept);
          }
        }
        if (clip.type === 'media' && clip.transition && stirsTransition(clip.transition.type)) {
          const kept = keep.has('transition');
          const before = clip.transition.type;
          if (!kept) clip.transition = { type: 'dissolve', frames: clip.transition.frames, ...(clip.transition.sync ? { sync: clip.transition.sync } : {}) };
          row('transition', 'type', before, 'dissolve', kept);
        }
        if (clip.type !== 'text') continue;
        const loop = clip.animation?.loop;
        if (loop && CALM_TEXT_LOOPS.has(loop)) {
          const kept = keep.has('text_loop');
          if (!kept) clip.animation = { ...clip.animation!, loop: null };
          row('text_loop', 'loop', loop, null, kept);
        }
        // 2. grandparents titles: only an inherited size is scaled; the version's own size is absolute (C3)
        if (profile === 'grandparents' && clip.style && typeof clip.style.sizeFrac === 'number') {
          const cur = clip.style.sizeFrac;
          const next = audienceTitleSize(cur, own(overrides, clip.id)?.textStyle?.sizeFrac, profile);
          if (next !== cur) {
            const kept = keep.has('title_size');
            if (!kept) clip.style = { ...clip.style, sizeFrac: next };
            row('title_size', 'sizeFrac', cur, next, kept);
          }
        }
      }
    }

  // 2. grandparents captions, per caption track; a field the version's own captionStyle sets is left as set (C3)
  if (profile === 'grandparents') {
    const mine = v.captionStyle ?? {};
    for (const seq of sequences)
      for (const track of seq.tracks) {
        const style = track.kind === 'caption' ? track.caption?.style : undefined;
        if (!style) continue;
        const at = trackFrames(seq, track, rate);
        const next = { ...style };
        const row = (detail: string, before: AudienceChange['before'], after: AudienceChange['after']) =>
          push({ rule: 'caption_look', detail, clipId: null, trackId: track.id, sequenceId: seq.id, ...at, before, after, keepable: false, kept: false });
        if (typeof style.sizeFrac === 'number') {
          const s = audienceCaptionSize(style.sizeFrac, mine.sizeFrac, profile);
          if (s !== style.sizeFrac) { next.sizeFrac = s; row('sizeFrac', style.sizeFrac, s); }
        }
        if (mine.maxCharsPerLine === undefined && typeof style.maxCharsPerLine === 'number' && style.maxCharsPerLine > AUDIENCE_TABLE_V1.captionMaxCharsPerLine) {
          next.maxCharsPerLine = AUDIENCE_TABLE_V1.captionMaxCharsPerLine; row('maxCharsPerLine', style.maxCharsPerLine, next.maxCharsPerLine);
        }
        if (mine.background === undefined && style.background === null) {
          next.background = AUDIENCE_TABLE_V1.captionBackground; row('background', null, next.background);
        }
        if (mine.preset === undefined && style.preset !== AUDIENCE_TABLE_V1.captionPreset) {
          next.preset = AUDIENCE_TABLE_V1.captionPreset; row('preset', style.preset ?? null, next.preset);
        }
        track.caption!.style = next;
      }
  }

  // 3. sound, both profiles: only music tracks (C13); speech and other are unchanged
  const gain = DB_GAIN[audienceMusicDb(a)];
  for (const seq of sequences)
    for (const track of seq.tracks) {
      if (track.kind !== 'audio') continue;
      if (soundRoleOf(out, track, a).role !== 'music') continue;
      const at = trackFrames(seq, track, rate);
      const cur = track.audio?.gain ?? 1;
      if (typeof gain === 'number' && Number.isFinite(cur)) {
        const next = Math.min(AUDIENCE_TABLE_V1.gainMax, Math.max(AUDIENCE_TABLE_V1.gainMin, cur * gain));
        if (next !== cur) {
          track.audio = { ...(track.audio ?? { gain: 1, pan: 0, duck: null }), gain: next };
          push({ rule: 'music_level', detail: 'gain', clipId: null, trackId: track.id, sequenceId: seq.id, ...at, before: cur, after: next, keepable: false, kept: false });
        }
      }
      const duck = track.audio?.duck;
      if (profile === 'grandparents' && duck && typeof duck.reductionDb === 'number') {
        const next = Math.min(AUDIENCE_TABLE_V1.duckMaxDb, duck.reductionDb + AUDIENCE_TABLE_V1.duckExtraDb);
        if (next !== duck.reductionDb) {
          track.audio = { ...track.audio!, duck: { ...duck, reductionDb: next } };
          push({ rule: 'ducking', detail: 'reductionDb', clipId: null, trackId: track.id, sequenceId: seq.id, ...at, before: duck.reductionDb, after: next, keepable: false, kept: false });
        }
      }
    }
}

/** inherited × 4/3 within the cap, never smaller than inherited (a master size already above the cap is left as it is). */
function scaled(inherited: number, cap: number): number {
  const { num, den } = AUDIENCE_TABLE_V1.textScale;
  return Math.max(inherited, Math.min(cap, (inherited * num) / den));
}
/**
 * The size rule of verifier C3. `own` is the size the VERSION sets itself (its VariantOverride.textStyle.sizeFrac for this title):
 * absolute, returned as it is. Otherwise the INHERITED master size is scaled: grandparents min(cap, inherited × 4 / 3); calm unchanged.
 * So the inspector that shows the projected size and commits it as the version's own size shows the same number afterwards.
 * A master size already above the cap is never made smaller by a rule that makes text larger.
 */
export function audienceTitleSize(inherited: number, own: number | undefined, profile: AudienceProfile): number {
  if (own !== undefined) return own;
  return profile === 'grandparents' ? scaled(inherited, AUDIENCE_TABLE_V1.titleSizeCap) : inherited;
}
/** The same rule for a caption track's size: `own` is the version's own captionStyle.sizeFrac (cap 0.2). */
export function audienceCaptionSize(inherited: number, own: number | undefined, profile: AudienceProfile): number {
  if (own !== undefined) return own;
  return profile === 'grandparents' ? scaled(inherited, AUDIENCE_TABLE_V1.captionSizeCap) : inherited;
}

const assetOf = (doc: ProjectDocument, id: string): Asset | undefined => own(doc.assets, id);
/** Library music or a loop, built-in music, or fitted music. */
function isMusicAsset(asset: Asset | undefined): boolean {
  const p = asset?.provenance;
  if (!p) return false;
  return p.library?.kind === 'music' || p.library?.kind === 'loop' || isBuiltinMusic(asset) || !!p.fitted;
}
/** Clip ids a recipe run placed as its narration (the story recipe's 'narration' slot): a recorded narration. */
function narrationClipIds(doc: ProjectDocument): Set<string> {
  const ids = new Set<string>();
  for (const run of Object.values(doc.recipeRuns ?? {})) for (const s of run.slots ?? []) if (s.key === 'narration') ids.add(s.clipId);
  return ids;
}

/**
 * The music-track rule of verifier C13, for one sound track of `doc` (the projected document): the owner's correction first, then
 * SOUND_ROLE_ORDER — music only when EVERY clip plays library music or a loop (provenance.library.kind 'music' | 'loop'), built-in
 * music (provenance.procedural music style, packOps MUSIC_STYLE_ID) or fitted music (provenance.fitted); speech for a duck source or
 * when every clip is narration (provenance.voice, or the narration slot of a recipe run); 'mixed', 'empty' or 'unknown' → other.
 * Pure; reads assets through Object.hasOwn. HEURISTIC: the owner corrects a wrong guess per track (update_audience_version.sound).
 */
export function soundRoleOf(doc: ProjectDocument, track: Track, audience?: VariantAudience): SoundRoleReading {
  const r = (role: SoundRoleReading['role'], why: SoundRoleReading['why']): SoundRoleReading => ({ trackId: track.id, role, why });
  const corrected = own(audience?.sound, track.id);
  if (corrected) return r(corrected, 'owner');
  const clips = track.clips;
  const music = clips.map((c) => c.type === 'media' && isMusicAsset(assetOf(doc, c.assetId)));
  if (clips.length && music.every(Boolean)) return r('music', 'music_files');
  const ducksUnder = Object.values(doc.sequences ?? {}).some((s) => s.tracks.some((t) => t.id !== track.id && t.audio?.duck?.sourceTrackIds.includes(track.id)));
  if (ducksUnder) return r('speech', 'duck_source');
  if (clips.length) {
    const narration = narrationClipIds(doc);
    if (clips.every((c) => narration.has(c.id) || (c.type === 'media' && !!assetOf(doc, c.assetId)?.provenance.voice))) return r('speech', 'narration');
  }
  if (music.some(Boolean)) return r('other', 'mixed');
  if (!clips.length) return r('other', 'empty');
  return r('other', 'unknown');
}
/** soundRoleOf for every sound track of the main sequence, in track order. */
export function soundRoles(doc: ProjectDocument, audience?: VariantAudience): SoundRoleReading[] {
  const seq = own(doc.sequences, doc.mainSequenceId);
  return (seq?.tracks ?? []).filter((t) => t.kind === 'audio').map((t) => soundRoleOf(doc, t, audience));
}

/**
 * The list the panel, GET …/variants/:variantId/audience and MCP get_audience_changes show: projectVariant with a report (so the list
 * and the picture come from the same code), the fast-cut stretches of pacingReport (rapid_cuts, listed only), the sound roles and
 * AUDIENCE_NOT_HANDLED. Throws a plain Error for an unknown or non-audience variant (the server checks first and maps it itself).
 */
export function audienceChanges(doc: ProjectDocument, variantId: string, revision: number): AudienceChanges {
  const v = own(doc.variants, variantId);
  if (!v) throw new Error(`variant ${variantId} not found`);
  const a = v.audience;
  if (!a) throw new Error(`variant ${variantId} is not a version for an audience`);
  const changes: AudienceChange[] = [];
  const projected = projectVariant(doc, variantId, changes);
  const rate = projected.settings.frameRate;
  const fastCuts: AudienceFastCuts[] = pacingReport(projected, { windowSeconds: FAST_CUT_WINDOW_SECONDS }).issues
    .filter((i) => i.code === 'rapid_cuts')
    .map((i) => ({ ...frames(i.start, i.end, rate), cuts: i.value, limit: i.limit, windowSeconds: FAST_CUT_WINDOW_SECONDS }));
  return {
    projectId: doc.id, variantId, revision, profile: a.profile, rules: a.rules, musicDb: audienceMusicDb(a),
    changes, fastCuts, soundRoles: soundRoles(projected, a), notHandled: AUDIENCE_NOT_HANDLED, method: AUDIENCE_CHANGES_METHOD,
  };
}
