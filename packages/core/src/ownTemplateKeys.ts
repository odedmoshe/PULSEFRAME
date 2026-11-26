/**
 * THE WHITELIST of an own template (wave 8 owntemplate; verifier C2 and C2g; decisions.md: "built by WHITELIST, never by
 * scrubbing"). Every key of the schemas capture reads is classified here, once: KEPT (and how it enters the definition) or NOT KEPT
 * (with the report code that names it in «מה לא נשמר», or null for structure and free text that is never copied and needs no row:
 * ids, track names, adjustment labels). ownTemplateKeys.test.ts fails when a schema gains a key that is in neither list, so a field
 * arriving later is never carried by accident. Capture switches on these tables: it never spreads a style, effect or clip object.
 *
 * Fields of this wave that may not have landed yet are listed already (`curves` on effect instances from grade, `behind` on titles
 * and drawn clips from behind, `depth` from living and `subject` from behind on media clips): NOT KEPT. A drawn clip is not kept
 * whatever its keys (CLIP_TYPES). Elements, sound effects, camera moves, title effects and title motion are cut in version 1 and
 * reported, never carried.
 */
import type { OwnNotKeptCode } from './ownTemplateContract.ts';
import { OWN_TEXT_STYLE_KEYS } from './templateContract.ts';

export type KeyClass = { kept: string } | { notKept: OwnNotKeptCode | null; why: string };
const kept = (how: string): KeyClass => ({ kept: how });
const not = (code: OwnNotKeptCode | null, why: string): KeyClass => ({ notKept: code, why });
const STRUCTURE = (why: string) => not(null, why);

/** What each clip type of the main sequence becomes (switch on clip.type, C13). */
export const OWN_CLIP_TYPES: Record<'media' | 'text' | 'caption' | 'adjustment' | 'drawn', KeyClass> = {
  media: kept('on the picture track: a slot; on other video tracks other_pictures; on audio tracks own_sound or music_file (the axis)'),
  text: kept('a title (texts[]), unless role credits (credits_card)'),
  caption: not('captions', 'caption clips are the transcript\'s words'),
  adjustment: kept('a look (adjust[])'),
  drawn: not('drawn', 'ink and trip maps are drawn for one film (listed with times, not drawn in the schematic)'),
};

const CLIP_BASE = {
  id: STRUCTURE('read to build the partition (report.clips); never copied'),
  start: STRUCTURE('read: the exact position on the axis'),
  duration: STRUCTURE('read: the exact position on the axis'),
  type: STRUCTURE('read: OWN_CLIP_TYPES'),
} as const;

export const OWN_MEDIA_CLIP_KEYS: Record<string, KeyClass> = {
  ...CLIP_BASE,
  transform: not('transform', 'crop, position and scale are made for one picture'),
  keyframes: not('camera_move', 'camera moves and hand keyframes (recognition is cut, C9)'),
  effects: kept('slots[].effects: type from the registry, static params of number, boolean, enum member or #hex only (lut dropped whole, C2c)'),
  blend: not('blend', 'blend mode'),
  follow: not('follow', 'follows a motion track of one file'),
  assetId: STRUCTURE('read: accept video or image; the id is never copied'),
  sourceIn: not('source_window', 'which part of the video is shown is content'),
  gain: STRUCTURE('read: keepAudio of the slot when a linked partner on an audio track has gain > 0'),
  speed: not('speed', 'speed'), speedEnd: not('speed', 'speed ramp'), rampWindow: not('speed', 'speed ramp'), speedCurve: not('speed', 'speed ramp'), keepPitch: not('speed', 'pitch with speed'),
  freeze: not('freeze', 'freeze frame'),
  reverse: not('reverse', 'reverse'),
  linkGroupId: STRUCTURE('read: finds the slot\'s own sound (keepAudio)'),
  fadeIn: not('own_sound', 'a sound clip\'s fades'), fadeOut: not('own_sound', 'a sound clip\'s fades'),
  volume: not('own_sound', 'volume keys of a sound clip'),
  audioFx: not('own_sound', 'sound effects of a sound clip'),
  mask: not('mask', 'a mask is drawn for one picture'),
  redact: not('redact', 'privacy regions are drawn for one picture'),
  transition: kept('slots[].transitionIn: type, seconds, dir fixed, sync, velocity, color (seed is cut: transition_seed)'),
  multicam: not('multicam', 'multicam tag'),
  stabilise: not('stabilise', 'measured on one file'),
  impact: not('impact', 'a moment of one file'),
  // arriving this wave (living, behind): not kept
  depth: not('depth', 'a depth map of one picture (living)'),
  subject: not('subject', 'the subject shape of one picture (behind)'),
};
export const OWN_TEXT_CLIP_KEYS: Record<string, KeyClass> = {
  ...CLIP_BASE,
  transform: kept('texts[].place x, y (clamped to ±0.5: title_place); scale or rotation not identity: title_transform'),
  keyframes: not('title_motion', 'title motion is cut in version 1'),
  effects: not('title_effects', 'title effects are cut in version 1'),
  blend: not('blend', 'blend mode'),
  follow: not('follow', 'follows a motion track of one file'),
  text: kept('texts[].default/fallback: the placeholder, or with keepWords the words with person tokens removed (person_field)'),
  style: kept('texts[].style: OWN_TEXT_STYLE_KEYS only (fontFamily from FONT_CATALOG, else the default: font_family)'),
  animation: kept('texts[].anim: frames to seconds at the film\'s rate'),
  fields: kept('live tokens of FIELD_NAMES only (person tokens become the placeholder: person_field)'),
  role: not('credits_card', 'a credits card names the library items of the original film (C2d)'),
  // arriving this wave (behind): not kept
  behind: not('behind', 'behind the subject of one picture'),
};
export const OWN_TEXT_STYLE_KEY_CLASSES: Record<string, KeyClass> = Object.fromEntries(OWN_TEXT_STYLE_KEYS.map((k) => [k, kept(k === 'fontFamily' ? 'from FONT_CATALOG only, else DEFAULT_TEXT_STYLE.fontFamily (font_family)' : 'numbers, enums and #hex colours')]));
export const OWN_TEXT_ANIMATION_KEYS: Record<string, KeyClass> = {
  by: kept('anim.by'), in: kept('anim.in'), out: kept('anim.out'), loop: kept('anim.loop'), inFrames: kept('anim.inSeconds'), outFrames: kept('anim.outSeconds'),
};
export const OWN_ADJUSTMENT_CLIP_KEYS: Record<string, KeyClass> = {
  ...CLIP_BASE,
  transform: STRUCTURE('an adjustment clip uses opacity only'),
  keyframes: kept('adjust[].fadeSeconds when the opacity keys are exactly the planner\'s fade shape, else opacity_keys'),
  effects: kept('adjust[].effects, as for slots'),
  blend: not('blend', 'blend mode'),
  follow: not('follow', 'follows a motion track'),
  label: STRUCTURE('free text: never copied'),
  mask: not('look_mask', 'a look\'s mask is drawn for one film'),
};
export const OWN_EFFECT_INSTANCE_KEYS: Record<string, KeyClass> = {
  id: STRUCTURE('never copied'),
  type: kept('type, when in the effect registry (color.lut: the whole effect is dropped, lut)'),
  enabled: STRUCTURE('read: a disabled effect is not carried (effect_disabled)'),
  params: kept('static params of number, boolean, enum member or #hex; a free string is dropped (effect_text_param)'),
  keyframes: not('effect_keyframes', 'effect keyframes'),
  modulate: not('effect_modulate', 'beat modulation'),
  // arriving this wave (grade): not kept
  curves: not('curves', 'colour curves (grade) are not carried in version 1'),
};
export const OWN_TRANSITION_KEYS: Record<string, KeyClass> = {
  type: kept('transitionIn.type'), frames: kept('transitionIn.seconds = frames · den / num'),
  sync: kept('transitionIn.sync'), velocity: kept('transitionIn.velocity'), color: kept('transitionIn.color'),
  seed: not('transition_seed', 'the transition seed option is cut in version 1'),
};
export const OWN_TRACK_KEYS: Record<string, KeyClass> = {
  id: STRUCTURE('never copied'), kind: STRUCTURE('read: picture track, other video tracks, titles, looks, sound'),
  name: STRUCTURE('free text: never copied'), locked: STRUCTURE('not read'), muted: STRUCTURE('read: muted audio tracks give no axis'),
  hidden: STRUCTURE('read: the picture track is the lowest shown one'), clips: STRUCTURE('read: OWN_CLIP_TYPES'),
  caption: not('caption_style', 'the caption track\'s style is not carried'),
  audio: not('own_sound', 'the mix of a sound track'),
};
/** Keys anticipated from other wave-8 tracks: listed above, and allowed to be absent from the schema until they land. */
export const OWN_ANTICIPATED_KEYS = { media: ['depth', 'subject'], text: ['behind'], effect: ['curves'] } as const;
