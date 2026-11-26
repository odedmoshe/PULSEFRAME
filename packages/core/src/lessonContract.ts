/**
 * «למדו אותי פעם אחת» — teach once (wave 8, track teach). Lead pre-pass: the shared contract.
 * Design: .artifacts/wave8/teach-plan.md, corrected by teach-verify.md (C1–C16; it wins) and the lead's decisions in
 * .artifacts/wave8/decisions.md (Batch C, `teach`). VERSION 1 IS: derive a lesson from the owner's own recent edits to ONE clip,
 * apply it to the selected clips as ONE transaction (one undo), per-clip rows of what applies and what is skipped and why, the
 * Inspector line and a palette entry. CUT (nothing of them is here): saved lessons «השיעורים שלי», every MCP tool (an agent's
 * apply_lesson is refused 403 lesson_owner_only, apps/server/src/lessons/guard.ts), the command-bar intent, the before/after stills,
 * LUT by hash ($assetHash), ripple_trim, set_audio_crossfade and the shortcut.
 *
 * THE TABLE (LEARN): every registered op has exactly one row (lessonContracts.test.ts fails on an op or an argument key without one).
 * - learn 'no' + why: the deriver lists such a call as not learned with that reason, and apply_lesson refuses it as a step.
 * - learn 'yes': the op's part kind, its fold rule (how several calls in the window become one step), whether it may be a STEP of
 *   apply_lesson (an op the deriver only folds, such as remove_effect, never is), and the kind of every argument key.
 * Argument kinds (ArgKind) and what the deriver writes for each in a step (bindings are resolved per target BEFORE the op's own
 * zod parse; lessonValidate.ts accepts a `$`-key only at the kind that owns it and refuses every other `$`-key):
 *   slot        clipId                      → {$slot:'clip'|'sound'}  (REQUIRED: a step never names a literal clip, C12)
 *   edgeTime    trim_clip.to                → {$edge:'start'|'end', by}; by = to − the edge in the op's own before state (C11)
 *   duration    a length (fades)            → {$dur}, rounded ONCE to the target rate (ADR-0003)
 *   frames      a frame count               → {$frames, rate}, scaled to the target rate, rounded once, at least 1 (C6)
 *   ownRef      effectId of the part's own effect → {$ref:<bind of the step that made it>, out:'effectId'}
 *   value       copied as it is (catalogue ids, numbers, enums, colours: code data, the same in every project; absolute, C-risk 2)
 *   font        a font family: carried only when FONT_CATALOG has it, else left out (C5: no free font names)
 *   effectParams an effect's params: every key by EFFECT_PARAM_CLASSES / AUDIO_EFFECT_PARAM_CLASSES (C5, C6)
 *   position    an index into the SOURCE's effect list: never carried; the target's order is the op's own effectSlot (C7)
 *   words       words (update_text.text): never carried; a step left with its slot only is not learned (`words`)
 *   measured    a measurement of the source clip (stabilise zoomPm): never carried; the target measures its own
 *   {merge}     a partial object the op MERGES (C4): consecutive calls folded key by key, later keys winning; sub-keys classified
 *   {object}    a whole object the op replaces; sub-keys classified
 * Fold rules (FoldRule), applied by the deriver inside one part:
 *   last        only the last call counts (the op replaces what it sets)
 *   keys        calls folded key by key, later keys winning (set_clip_transform, set_text_animation, set_transition_options,
 *               set_clip_fades, update_text.style, animate_clip's two sides; C4). A null that removes (animation null) resets the fold
 *   grade       apply_look / set_colour_grade folded into the final colour grade: a look or a replace resets, a merge folds (C4)
 *   edge        trim_clip of the same edge: the Δs summed exactly, rounded once at apply (proof check 7)
 *   effect      add / update / modulator / remove of ONE effect folded into its final state {type, params, enabled, modulate};
 *               add then remove cancels (`cancelled`); at apply it is UPSERTED: the target's one effect of that type is updated,
 *               else it is added (C9). An edit of an effect made before the window is `made_before`
 *   soundEffect the same for sound effects (add_audio_effect refuses a second copy, so the upsert is required, C9);
 *               apply_audio_preset replaces the list and cancels the sound-effect lives before it in the window
 *   replay      every call is its own step, in order (apply_motion_preset, apply_text_preset)
 * Parts run in LESSON_PART_ORDER whatever the order of the edits (C10), through pairRun.ts inFixedOrder, the helper paste attributes
 * walks its groups with. One (target, part) pair is applied whole or put back exactly (pairRun.ts saveTarget / restoreTarget).
 *
 * THE WINDOW (deriver, C1, C2, C14, C-cost): newest first, at most LESSON_LIMITS.scanRows rows read (`revision > current − 400`),
 * pre-filtered on the small `ops` column by the clip's and its partners' ids; at most windowRows learning rows; at most 16 parts and
 * 64 steps. It STOPS (and learns nothing at or before the stop) at: the clip's creation (a change with before null), a version
 * restore (restore_entities of kind edit), paste_attributes, apply_lesson, any internal op (a template, planner, take or recipe run)
 * and an accepted agent proposal (request_id `prp_…`, never by label: decisions.md, Batch C). Undone rows are never learned (a row
 * with undone_by whose undo was not redone); a redo's restore_entities is not learned, its original row is.
 *
 * No ops.ts import at run time except OpError (lessonOps.ts registers the op).
 */
import { z } from 'zod';
import { RateSchema, RationalTimeSchema } from './schema.ts';
import { BindName, RefSchema } from './templateContract.ts';
import { OpError, type OpErrorCode } from './ops.ts';
import type { RationalTime } from '@pulseframe/time';

// ---------- limits ----------
export const LESSON_LIMITS = {
  /** parts of one lesson, steps of one part, steps of one lesson */
  parts: 16, stepsPerPart: 16, steps: 64,
  /** target clips of one apply_lesson */
  targets: 200,
  /** targets × steps ≤ this: the apply_template.ops ceiling (C12) */
  opRuns: 2000,
  /** the window: learning rows kept (C14), rows read at most (C-cost, the newest of the project) */
  windowRows: 40, scanRows: 400,
  /** $frames counts accepted (schema bound) */
  maxFrames: 100_000,
} as const;
export const LESSON_LABEL = 'Lesson';

// ---------- parts ----------
/** Part kinds in the FIXED order they are applied in (C10): speed → trim → transform → motion → look → effect → title → sound. */
export const LESSON_PART_ORDER = ['speed', 'trim', 'transform', 'motion', 'look', 'effect', 'title', 'gain', 'fades', 'soundFx', 'transition', 'stabilise'] as const;
export type LessonPartKind = (typeof LESSON_PART_ORDER)[number];
/** Part kinds whose steps act on the clip's sound: their slot may be 'sound', and a target without sound skips them `no_sound`. */
export const SOUND_PART_KINDS: readonly LessonPartKind[] = ['gain', 'fades', 'soundFx'];

// ---------- bindings (template step format + four clip-relative bindings; no $assetHash in version 1) ----------
export const SlotBindingSchema = z.object({ $slot: z.enum(['clip', 'sound']) }).strict();
export const EdgeBindingSchema = z.object({ $edge: z.enum(['start', 'end']), by: RationalTimeSchema }).strict();
export const DurBindingSchema = z.object({ $dur: RationalTimeSchema }).strict();
export const FramesBindingSchema = z.object({ $frames: z.number().int().min(0).max(LESSON_LIMITS.maxFrames), rate: RateSchema }).strict();
/** The only `$`-keys a lesson step may hold ($ref from the template step format, only for ownRef). */
export const LESSON_BINDING_KEYS = ['$slot', '$edge', '$dur', '$frames', '$ref'] as const;
export { RefSchema as LessonRefSchema };

// ---------- the classification ----------
export const ARG_KINDS = ['slot', 'edgeTime', 'duration', 'frames', 'ownRef', 'value', 'font', 'effectParams', 'position', 'words', 'measured'] as const;
export type ArgKind = (typeof ARG_KINDS)[number];
export type ArgClass = ArgKind | { kind: 'merge' | 'object'; nullable?: true; sub: Readonly<Record<string, ArgClass>> };
/** Kinds that are never carried into a step (dropped by the deriver, refused by validation). */
export const NEVER_CARRIED_KINDS: readonly ArgKind[] = ['position', 'words', 'measured'];
export const FOLD_RULES = ['last', 'keys', 'grade', 'edge', 'effect', 'soundEffect', 'replay'] as const;
export type FoldRule = (typeof FOLD_RULES)[number];
/** Why an op is not learned (lesson rows `notLearned[].reason`; words in i18n teach.ts `teach.why.*`). */
export const NOT_LEARNED_WHY = ['placement', 'structure', 'hand_drawn', 'clip_content', 'words', 'other_entities', 'project', 'analysis', 'people', 'privacy', 'family_data', 'formats', 'multicam', 'internal', 'replaces', 'not_v1'] as const;
export type NotLearnedWhy = (typeof NOT_LEARNED_WHY)[number];
/** Reasons the deriver gives for a call of a learnable op it still leaves out. */
export const DERIVE_LEFT_OUT = ['made_before', 'cancelled', 'empty', 'other_clip', 'param_words', 'param_asset', 'param_measured', 'font_not_in_catalogue', 'cap'] as const;
export type DeriveLeftOut = (typeof DERIVE_LEFT_OUT)[number];
export type NotLearnedReason = NotLearnedWhy | DeriveLeftOut;

export interface LearnYes { learn: 'yes'; part: LessonPartKind; fold: FoldRule; /** may be a step of apply_lesson */ step: boolean; args: Readonly<Record<string, ArgClass>> }
export interface LearnNo { learn: 'no'; why: NotLearnedWhy }
export type LearnRow = LearnYes | LearnNo;

const no = (why: NotLearnedWhy): LearnNo => ({ learn: 'no', why });
const yes = (part: LessonPartKind, fold: FoldRule, args: Record<string, ArgClass>, step = true): LearnYes => ({ learn: 'yes', part, fold, step, args });
const v = 'value' as const;
const TRANSFORM_SUB = { x: v, y: v, scale: v, rotation: v, opacity: v } as const;
const TEXT_STYLE_SUB = { fontFamily: 'font', fontWeight: v, sizeFrac: v, color: v, align: v, direction: v, lineHeight: v, background: v, stroke: v, strokeFrac: v, gradient: v, tracking: v, stroke2: v, glow: v, extrude: v, longShadow: v } as const;
const TEXT_ANIMATION_SUB = { by: v, in: v, out: v, loop: v, inFrames: 'frames', outFrames: 'frames' } as const;
const GRADE_SUB = { exposure: v, temperature: v, tint: v, contrast: v, saturation: v, shadows: v, highlights: v, fade: v } as const;

/**
 * Every registered op of this build, in registry order (161 ops, 141 public on 2026-11-26; 26 learnable, 23 of them steps).
 * Corrections to the designer's table from teach-verify.md: C4 (merging ops fold by key), C5 (effect params by catalogue),
 * C6 (frames inside values), C7 (index is a position), C8 (crossfade and ripple cut), C9 (effect lives upserted).
 */
export const LEARN: Readonly<Record<string, LearnRow>> = {
  rename_project: no('project'), import_asset: no('internal'), set_project_format: no('project'), rename_asset: no('project'), set_asset_colour: no('project'), remove_asset: no('project'),
  add_track: no('structure'), update_track: no('structure'), move_track: no('structure'), remove_track: no('structure'),
  add_clip: no('placement'), add_text: no('placement'),
  apply_text_preset: yes('title', 'replay', { clipId: 'slot', presetId: v }),
  update_text: yes('title', 'keys', { clipId: 'slot', text: 'words', style: { kind: 'merge', sub: TEXT_STYLE_SUB } }),
  set_text_animation: yes('title', 'keys', { clipId: 'slot', animation: { kind: 'merge', nullable: true, sub: TEXT_ANIMATION_SUB } }),
  set_clip_transform: yes('transform', 'keys', { clipId: 'slot', transform: { kind: 'merge', sub: TRANSFORM_SUB } }),
  set_keyframe: no('hand_drawn'), delete_keyframe: no('hand_drawn'), clear_keyframes: no('hand_drawn'),
  set_clip_speed: yes('speed', 'last', { clipId: 'slot', speed: v, includeLinked: v }),
  set_clip_speed_ramp: no('hand_drawn'), speed_ramp: no('hand_drawn'), apply_speed_curve: no('hand_drawn'),
  set_volume_keyframe: no('hand_drawn'), draw_volume: no('hand_drawn'), delete_volume_keyframe: no('hand_drawn'),
  set_clip_gain: yes('gain', 'last', { clipId: 'slot', gain: v }),
  move_clip: no('placement'),
  trim_clip: yes('trim', 'edge', { clipId: 'slot', edge: v, to: 'edgeTime', includeLinked: v }),
  slip_clip: no('placement'), unlink_clip: no('placement'), link_clips: no('other_entities'),
  set_clip_pitch: yes('speed', 'last', { clipId: 'slot', keepPitch: v }),
  set_clip_reverse: yes('speed', 'last', { clipId: 'slot', reverse: v, includeLinked: v }),
  split_clip: no('placement'), freeze_frame: no('placement'), move_clips: no('placement'), delete_clip: no('placement'), ripple_delete_clips: no('placement'),
  restore_entities: no('internal'),
  animate_clip: yes('motion', 'keys', { clipId: 'slot', in: v, out: v, inFrames: 'frames', outFrames: 'frames' }),
  apply_motion_preset: yes('motion', 'replay', { clipId: 'slot', presetId: v, frames: 'frames', amount: v }),
  duplicate_clips: no('placement'), apply_recipe: no('internal'),
  add_variant: no('formats'), update_variant: no('formats'), remove_variant: no('formats'),
  add_marker: no('structure'), update_marker: no('structure'), remove_marker: no('structure'),
  set_variant_override: no('formats'), set_variant_phrase_text: no('words'),
  replace_clip_asset: no('clip_content'),
  attach_translation: no('internal'), review_translation: no('internal'), attach_analysis: no('internal'), edit_analysis: no('analysis'),
  split_at_scenes: no('placement'),
  set_clip_fades: yes('fades', 'keys', { clipId: 'slot', fadeIn: 'duration', fadeOut: 'duration' }),
  /** C8: it lengthens and fades the PREVIOUS clip, beyond the target and its partners (no exact rollback) */
  set_audio_crossfade: no('not_v1'),
  fit_music: no('clip_content'),
  set_track_audio: no('structure'), set_ducking: no('structure'), set_loudness_target: no('project'), set_timeline_behaviour: no('project'),
  add_audio_effect: yes('soundFx', 'soundEffect', { clipId: 'slot', type: v, params: 'effectParams', enabled: v, includeLinked: v }),
  update_audio_effect: yes('soundFx', 'soundEffect', { clipId: 'slot', effectId: 'ownRef', params: 'effectParams', enabled: v }, false),
  remove_audio_effect: yes('soundFx', 'soundEffect', { clipId: 'slot', effectId: 'ownRef' }, false),
  apply_audio_preset: yes('soundFx', 'soundEffect', { clipId: 'slot', presetId: v, includeLinked: v }),
  copy_audio_effects: no('other_entities'),
  /** it needs the clip's own measured noise (C5: a measurement of the owner's recording) */
  clean_voice: no('not_v1'),
  apply_look: yes('look', 'grade', { clipId: 'slot', lookId: v }),
  set_colour_grade: yes('look', 'grade', { clipId: 'slot', params: { kind: 'merge', sub: GRADE_SUB }, mode: v, dropKeyframes: v }),
  /** LUT by content hash is cut from version 1 (decisions.md); a project asset id never enters a lesson */
  apply_lut: no('not_v1'),
  add_effect: yes('effect', 'effect', { clipId: 'slot', type: v, params: 'effectParams', index: 'position' }),
  update_effect: yes('effect', 'effect', { clipId: 'slot', effectId: 'ownRef', params: 'effectParams', enabled: v, index: 'position' }),
  set_effect_keyframe: no('hand_drawn'), delete_effect_keyframe: no('hand_drawn'),
  set_effect_modulator: yes('effect', 'effect', { clipId: 'slot', effectId: 'ownRef', param: v, modulator: { kind: 'object', nullable: true, sub: { every: v, depth: v, decay: v } } }),
  remove_effect: yes('effect', 'effect', { clipId: 'slot', effectId: 'ownRef' }, false),
  set_clip_blend: yes('effect', 'last', { clipId: 'slot', mode: v }),
  set_clip_mask: no('not_v1'), apply_layout: no('other_entities'),
  set_transition: yes('transition', 'last', { clipId: 'slot', type: v, frames: 'frames' }),
  set_transition_options: yes('transition', 'keys', { clipId: 'slot', sync: v, velocity: v, color: v, seed: v }),
  create_motion_track: no('analysis'), attach_motion_track: no('internal'), edit_motion_track: no('analysis'), remove_motion_track: no('analysis'),
  set_clip_follow: no('hand_drawn'), set_redact_region: no('privacy'),
  add_adjustment: no('placement'), replace_clip_media: no('clip_content'),
  add_caption_track: no('structure'), set_caption_style: no('structure'), apply_caption_look: no('structure'),
  add_cue: no('words'), update_cue: no('words'), merge_cues: no('words'), import_captions: no('words'),
  set_transcript: no('words'), attach_transcript: no('internal'), attach_word_timing: no('internal'), import_transcript: no('words'), correct_transcript: no('words'),
  cut_range: no('placement'), insert_gap: no('placement'), close_gaps: no('placement'), delete_transcript_range: no('placement'),
  replace_effect_keyframes: no('hand_drawn'), set_keyframe_curve: no('hand_drawn'),
  portrait_blur: no('clip_content'),
  add_builtin_music: no('internal'), apply_template: no('internal'),
  add_person: no('people'), update_person: no('people'), remove_person: no('people'),
  set_asset_capture: no('family_data'), shift_asset_captures: no('family_data'), attach_asset_capture: no('internal'), set_text_fields: no('family_data'),
  cluster_events: no('project'), add_event: no('project'), update_event: no('project'), remove_event: no('project'), attach_moments: no('internal'),
  add_sequence: no('structure'), update_sequence: no('structure'), remove_sequence: no('structure'),
  replace_clip_keyframes: no('hand_drawn'), apply_sequence_plan: no('internal'),
  create_multicam: no('multicam'), attach_multicam_sync: no('internal'), set_multicam_sync: no('multicam'), update_multicam: no('multicam'), set_angle_look: no('multicam'),
  place_multicam: no('multicam'), switch_angles: no('multicam'), detach_from_multicam: no('multicam'), remove_multicam: no('multicam'),
  apply_take: no('internal'), use_library_item: no('internal'),
  add_credits_card: no('placement'), set_master_limiter: no('project'), match_clip_loudness: no('other_entities'),
  /** C8: it moves every later clip of the track; cut from version 1 «קיצוץ עם סגירת רווח — בגרסה הבאה» */
  ripple_trim: no('not_v1'),
  paste_attributes: no('replaces'), replace_text: no('words'),
  attach_camera_motion: no('internal'),
  set_clip_stabilise: yes('stabilise', 'last', { clipId: 'slot', stabilise: { kind: 'object', nullable: true, sub: { strength: v, maxCrop: v, zoomPm: 'measured' } } }),
  remove_camera_motion: no('analysis'),
  add_source_range: no('people'), update_source_range: no('people'), remove_source_range: no('people'),
  set_clip_impact: no('clip_content'), sync_impact: no('clip_content'),
  add_fitted_music: no('internal'), mark_join_heard: no('internal'),
  add_audience_version: no('formats'), update_audience_version: no('formats'), set_audience_keep: no('formats'),
  // trip map (wave 8 tripmap; rows added by the lead at the merge): a map is its own content at its own place, never a habit to replay
  add_trip_map: no('placement'), update_trip_map: no('clip_content'), time_trip_map: no('clip_content'),
  // «תמונה חיה» (wave 8 living; rows added by the lead at the merge): a depth is drawn by hand for one picture
  set_clip_depth: no('hand_drawn'), set_living_picture: no('hand_drawn'),
  // «ציור חי» and colour curves (wave 8 ink, grade; rows added by the lead at the merges): drawn by hand for one place / one picture
  add_ink: no('placement'), edit_ink: no('hand_drawn'), set_grade_curves: no('hand_drawn'),
  apply_lesson: no('replaces'),
};
export const learnRow = (op: string): LearnRow | undefined => (Object.hasOwn(LEARN, op) ? LEARN[op] : undefined);
/** Ops the deriver reads (learn 'yes'). */
export const LEARNABLE_OPS: readonly string[] = Object.freeze(Object.entries(LEARN).filter(([, r]) => r.learn === 'yes').map(([k]) => k));
/** Ops that may be a step of apply_lesson. */
export const LESSON_STEP_OPS: readonly string[] = Object.freeze(Object.entries(LEARN).filter(([, r]) => r.learn === 'yes' && r.step).map(([k]) => k));
/** Ops whose row stops the window when it touches the clip or its partners (besides any internal op and an accepted proposal). */
export const WINDOW_STOP_OPS = ['paste_attributes', 'apply_lesson', 'restore_entities'] as const;

// ---------- the catalogues' parameters (C5, C6) ----------
/**
 * Every STRING parameter of the effect and sound-effect catalogues (effects.ts EFFECTS, audioEffects.ts AUDIO_EFFECTS):
 *   enum, colour  carried (registry data: the same in every project)
 *   words         never carried: the param is left out of the step (the date stamp's typed date: family_data)
 *   asset         never carried: the step is not learned (`param_asset`; color.lut's table is a project asset id; LUT by hash is cut)
 *   measured      never carried: the step is not learned (`param_measured`; a noise profile measured on the owner's recording and
 *                 the asset it was measured on)
 * lessonContracts.test.ts iterates both catalogues and fails on a string parameter without a row, or a row of nothing.
 */
export const STRING_PARAM_CLASSES = ['enum', 'colour', 'words', 'asset', 'measured'] as const;
export type StringParamClass = (typeof STRING_PARAM_CLASSES)[number];
export const CARRIED_STRING_CLASSES: readonly StringParamClass[] = ['enum', 'colour'];
export const EFFECT_STRING_PARAMS: Readonly<Record<string, Readonly<Record<string, StringParamClass>>>> = {
  'color.tint': { color: 'colour', mode: 'enum' },
  'stylize.shadow': { color: 'colour' },
  'key.chroma': { color: 'colour' },
  'distort.wave': { direction: 'enum' },
  'distort.mirror': { keep: 'enum' },
  'color.lut': { lut: 'asset' },
  'stylize.duotone': { dark: 'colour', light: 'colour' },
  'motion.shake': { follow: 'enum' },
  'motion.pulse': { follow: 'enum' },
  'light.leak': { color: 'colour' },
  'light.strobe': { color: 'colour', follow: 'enum' },
  'digital.rgb-shake': { follow: 'enum' },
  'time.echo': { mode: 'enum' },
  'time.split': { order: 'enum' },
  'time.shutter': { timing: 'enum' },
  'time.stutter': { pattern: 'enum', motion: 'enum', follow: 'enum' },
  'overlay.snow': { area: 'enum' },
  'overlay.confetti': { mode: 'enum', palette: 'enum', color: 'colour', area: 'enum' },
  'overlay.hearts': { color: 'colour', area: 'enum', follow: 'enum' },
  'overlay.bokeh': { shape: 'enum', color: 'colour', area: 'enum' },
  'overlay.speed-lines': { color: 'colour' },
  'stylize.date-stamp': { text: 'words', corner: 'enum', color: 'colour', source: 'enum', dateOrder: 'enum' },
  'stylize.crt': { phosphor: 'enum' },
  'depth.living': { move: 'enum' }, // «תמונה חיה» (wave 8 living; classified by the lead at the merge; the effect itself is never a lesson step)
};
export const AUDIO_EFFECT_STRING_PARAMS: Readonly<Record<string, Readonly<Record<string, StringParamClass>>>> = {
  'cleanup.dehum': { mainsHz: 'enum' },
  'cleanup.denoise': { profile: 'measured', source: 'measured' },
  'space.reverb': { room: 'enum' },
};
/** Numeric effect parameters that are FRAME counts at the project rate (C6): `$frames` in a step. */
export const EFFECT_FRAME_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'time.echo': ['delay'],
  'time.split': ['lag'],
  'time.stutter': ['hold'],
};
/** Numeric parameters whose description mentions frames but which are NOT frame counts (checked by the catalogue test). */
export const EFFECT_NOT_FRAME_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'stylize.scanlines': ['lines'], 'time.shutter': ['angle', 'samples'], 'overlay.snow': ['speed'], 'overlay.confetti': ['speed'],
  'overlay.hearts': ['speed'], 'overlay.bokeh': ['speed'], 'stylize.crt': ['lines'],
  'depth.living': ['amount'], // a share of the frame height, not a frame count
};
/** The class of one string parameter, or undefined for a parameter that is not a string. */
export const stringParamClass = (catalogue: 'effect' | 'audio', type: string, param: string): StringParamClass | undefined => {
  const t = catalogue === 'effect' ? EFFECT_STRING_PARAMS : AUDIO_EFFECT_STRING_PARAMS;
  return Object.hasOwn(t, type) && Object.hasOwn(t[type]!, param) ? t[type]![param] : undefined;
};
export const isFrameParam = (type: string, param: string): boolean => Object.hasOwn(EFFECT_FRAME_PARAMS, type) && EFFECT_FRAME_PARAMS[type]!.includes(param);

// ---------- the lesson format (the template step format, TemplateStepSchema, with the op restricted) ----------
export const LessonStepSchema = z.object({ op: z.string().min(1).max(64), args: z.record(z.string(), z.unknown()), bind: BindName.optional() }).strict();
export type LessonStep = z.infer<typeof LessonStepSchema>;
export const LessonPartSchema = z.object({ key: BindName, kind: z.enum(LESSON_PART_ORDER), steps: z.array(LessonStepSchema).min(1).max(LESSON_LIMITS.stepsPerPart) }).strict();
export type LessonPart = z.infer<typeof LessonPartSchema>;
export const ApplyLessonArgsSchema = z.object({
  /** the clip the lesson was learned from: refused when it is among the targets (it already has these steps) */
  sourceClipId: z.string().min(1).max(64),
  parts: z.array(LessonPartSchema).min(1).max(LESSON_LIMITS.parts),
  /** targets named twice count once; applied in timeline order (track index, then start) */
  targets: z.array(z.string().min(1).max(64)).min(1).max(LESSON_LIMITS.targets),
}).strict();
export type ApplyLessonArgs = z.infer<typeof ApplyLessonArgsSchema>;

// ---------- what apply_lesson answers (OpResult.output) and its plan ----------
export type LessonSkipCode = OpErrorCode | 'no_sound';
export interface LessonPair { clipId: string; part: string }
export interface LessonSkip extends LessonPair { code: LessonSkipCode; message: string }
/** A time the target's rate could not hold exactly: `by` wanted, `frames` applied (rounded once, half up). */
export interface LessonRounded extends LessonPair { by: RationalTime; frames: number }
export interface ApplyLessonOutput { applied: LessonPair[]; skipped: LessonSkip[]; rounded: LessonRounded[] }
/** planApplyLesson: the op's own routine on a copy; its rows equal the commit's output field for field (proof check 4). */
export type LessonPlan = ApplyLessonOutput;

// ---------- deriving (lesson.ts deriveLesson; the server route GET …/clips/:clipId/lesson) ----------
/** One transaction row as the deriver reads it: the columns of apps/server/src/store.ts `transactions` it needs. */
export interface LessonTxRow {
  id: string; revision: number; actor: string; kind: string; label: string | null;
  /** `prp_…` for an accepted proposal (governance.ts decide): the window stops there */
  requestId: string | null;
  undoes: string | null; undoneBy: string | null;
  ops: { op: string; args: Record<string, unknown> }[];
  /** result.results: each op's output (effect ids made in the row) */
  results: { op: string; output?: Record<string, unknown> }[];
  /** read only for the rows that pass the ops pre-filter (C-cost) */
  changes: { id: string; before: unknown; after: unknown }[];
}
export const WINDOW_STOPS = ['created', 'restored', 'pasted', 'lesson', 'template', 'proposal', 'cap', 'scan_limit', 'history_start'] as const;
export type WindowStop = (typeof WINDOW_STOPS)[number];
export interface DerivedStep extends LessonStep { /** the transactions it came from, oldest first */ fromTx: string[] }
export interface DerivedPart { key: string; kind: LessonPartKind; steps: DerivedStep[];
  /** machine values the dialog words («קיצור ההתחלה ב־10 פריימים», «עוצמה 70%»): never a sentence, never words of the clip */
  detail: Readonly<Record<string, string | number | boolean | null>>;
  /** a step of the part acts on the clip's sound */
  sound: boolean }
export interface NotLearnedRow { transactionId: string; op: string; reason: NotLearnedReason }
export interface DerivedLesson {
  clipId: string; revision: number;
  /** in LESSON_PART_ORDER; every part ticked by default, the owner may untick any */
  parts: DerivedPart[];
  notLearned: NotLearnedRow[];
  window: { stop: WindowStop; learningRows: number; scannedRows: number };
  /** the heuristic, labelled: "the newest N of your own edits of this clip" */
  method: string;
}
export const LESSON_METHOD = 'the newest of the owner\'s own edits of this clip and its linked sound since it was made or last replaced (at most 40 rows of the newest 400); a heuristic window, every part can be unticked; nothing was looked at';
/** The wire answer of GET …/clips/:clipId/lesson (owner's own session only). */
export interface DerivedLessonView extends DerivedLesson { projectId: string }
/** Turn a derived lesson (the ticked parts) into apply_lesson args: the fromTx and detail fields are dropped. */
export function lessonArgsOf(lesson: Pick<DerivedLesson, 'clipId' | 'parts'>, partKeys: readonly string[], targets: readonly string[]): ApplyLessonArgs {
  const keep = new Set(partKeys);
  return {
    sourceClipId: lesson.clipId,
    parts: lesson.parts.filter((p) => keep.has(p.key)).map((p) => ({ key: p.key, kind: p.kind, steps: p.steps.map((s) => ({ op: s.op, args: s.args, ...(s.bind ? { bind: s.bind } : {}) })) })),
    targets: [...targets],
  };
}

// ---------- names on the wire ----------
export const LESSON_ROUTE = '/api/v1/projects/:id/clips/:clipId/lesson';
export const LESSON_OP = 'apply_lesson';

// ---------- refusals ----------
export interface LessonRefusalRow<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint: string): LessonRefusalRow<A> => ({ code, message, hint });
/** Every refusal of apply_lesson (whole-op). Hebrew: i18n teach.ts HE_TEACH (each with the next step); teach-wording.test.ts. */
export const LESSON_REFUSALS = {
  notBuilt: refusal('unknown_op', () => 'apply_lesson: lessons are not built in this build yet', 'Nothing was changed. Each edit can still be made by hand, or copied with paste attributes.'),
  tooBig: refusal('out_of_bounds', (runs: number) => `the lesson would run ${runs} operations; at most ${LESSON_LIMITS.opRuns} (targets × steps)`, 'Choose fewer clips or untick some steps.'),
  tooManySteps: refusal('out_of_bounds', (steps: number) => `the lesson has ${steps} steps; at most ${LESSON_LIMITS.steps}`, 'Untick some steps.'),
  duplicatePart: refusal('invalid_args', (key: string) => `part ${key} is named twice`, 'Give every part its own key.'),
  sourceIsTarget: refusal('invalid_args', (clipId: string) => `the clip the lesson was learned from (${clipId}) already has these steps`, 'Leave it out of the clips to apply to.'),
  targetNotFound: refusal('not_found', (clipId: string) => `clip ${clipId} to apply the lesson to is not in the project`, 'get_timeline lists the clips.'),
  notStepOp: refusal('forbidden_op', (op: string) => `${op} cannot be a step of a lesson`, 'A lesson holds only the edits the teach table learns; send that edit as an ordinary operation instead.'),
  wrongPart: refusal('invalid_args', (op: string, kind: string) => `${op} does not belong in a part of kind ${kind}`, 'Put the step in a part of its own kind.'),
  literalClip: refusal('invalid_args', (op: string) => `${op}: a step names its clip only as {"$slot":"clip"} or {"$slot":"sound"}`, 'Replace the clip id with a slot.'),
  unknownArg: refusal('invalid_args', (op: string, key: string) => `${op}: argument ${key} is not carried in a lesson`, 'Remove it from the step.'),
  neverCarried: refusal('invalid_args', (op: string, key: string) => `${op}: ${key} is never carried in a lesson (words, positions, measurements, project files)`, 'Remove it from the step.'),
  unknownBinding: refusal('invalid_args', (op: string, key: string) => `${op}: "${key}" is not a binding a lesson accepts here`, 'Bindings: $slot for the clip, $edge for a trim, $dur for a length, $frames for frames, $ref for the part\'s own effect.'),
  badBinding: refusal('invalid_args', (op: string, key: string, want: string) => `${op}: ${key} must be ${want}`, 'Write the binding in its exact shape.'),
  unboundRef: refusal('invalid_args', (op: string, name: string) => `${op}: "$ref": "${name}" names no earlier step of this part`, 'An effect step refers only to the effect its own part added.'),
  fontNotInCatalogue: refusal('invalid_args', (family: string) => `font ${family} is not in the font catalogue`, 'A lesson carries only catalogue fonts (list_catalog → fonts).'),
  nothing: refusal('incompatible', () => 'none of the steps fit the chosen clips; the rows say why each clip was skipped', 'Choose other clips, or untick the steps that do not fit.'),
} as const;
export type LessonRefusalKey = keyof typeof LESSON_REFUSALS;
export function lessonRefusal<K extends LessonRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof LESSON_REFUSALS)[K]['message']>): OpError {
  const r = LESSON_REFUSALS[key] as LessonRefusalRow<unknown[]>;
  return new OpError(r.code, r.message(...values), details, r.hint);
}
/** Route and governance refusals (ApiError on the server; Hebrew in HE_TEACH). */
export const LESSON_API_REFUSALS = {
  notBuilt: { status: 501, code: 'teach_not_built', message: () => 'learning a lesson from a clip is not built in this build yet', hint: 'Nothing was read or changed. Paste attributes copies a clip\'s look in the meantime.' },
  ownerRequired: { status: 403, code: 'owner_required', message: () => 'a lesson is learned only from the owner\'s own edits, in the owner\'s own session', hint: 'The owner opens the clip in the editor on this computer.' },
  /** version 1: an agent's apply_lesson (commit, dry run, nested, proposal, MCP op tool) — C12, decisions.md */
  agentRefused: { status: 403, code: 'lesson_owner_only', message: () => 'only the owner applies a lesson, from the editor on this computer', hint: 'An agent may send the separate edits as ordinary operations (apply_transaction or a proposal).' },
  clipNotFound: { status: 404, code: 'not_found', message: (clipId: string) => `clip ${clipId} not found`, hint: 'get_timeline lists the clips.' },
} as const;

/** Thrown by a pure function of this track that is not built yet (lesson.ts stubs). */
export class LessonNotBuiltError extends Error {
  readonly code = 'teach_not_built';
  constructor(readonly fn: string) { super(`${fn}: lessons are not built in this build yet`); }
}
