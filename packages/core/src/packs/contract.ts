/**
 * Content packs (ADR-0022): the contract of a pack. A pack is DATA: templates, original graphic elements, adjustment looks,
 * caption looks, text styles, ready titles and picks from the built-in sounds and music, gathered round an occasion
 * (a holiday of the Hebrew calendar, a birthday, or none). Everything a pack makes is an ordinary editable clip made by
 * existing public operations; packages/engine knows nothing about packs.
 *
 * Adding a pack needs no new contract: one data file that exports a PackDef, its elements in packs/elements.<name>.ts, and one
 * row in packs/index.ts. The registries pick the rest up by themselves: its templates join TEMPLATES (templateCatalog.ts),
 * its text styles TEXT_PRESETS, its caption looks CAPTION_LOOKS, its elements ELEMENTS.
 *
 * RULES every pack is held to (packs/check.ts packIssues; packs/contract.test.ts runs it over every pack of the build):
 * - Original only: elements are drawn by formula here; music and sounds are the built-in synthesised ones. No songs, no lyrics,
 *   no song titles, no blessings and no divine name in any default text. No third-party artwork.
 * - The six-point star (element.shape.star-6) stays available in the library and is NEVER part of a pack or of a pack
 *   template (owner decision, wave 3 and wave 5).
 * - Ids are frozen once shipped: operation logs name text styles and caption looks by id and read the registry when they
 *   replay (apply_text_preset, apply_caption_look). A changed value gets a NEW id; an old id is never removed or re-used.
 *   Id shapes, with <pack> = the pack id without its `pack.` prefix:
 *     template `tpl.<pack>-…` · look `look.<pack>-…` · title `title.<pack>-…` · caption look `caption.<pack>-…` ·
 *     text style `<pack>-…` · element `element.holiday.…` or `element.party.…`.
 * - Looks: every effect has cost 'filter' or 'layer' (never 'gpu', never 'time') and may go on an adjustment clip
 *   (validate.ts adjustmentRefusal); nothing flashes (no strobe, flicker, flash or dip). The same holds for the looks of a
 *   pack's templates.
 * - Fonts: only families and weights of FONT_CATALOG (fonts.ts).
 * - Text: Hebrew and English for every name, hint and text. A title's `text` may hold pack fields ({name} {name2} {age}
 *   {night} {place} {when}; templateContract.ts) and the life line's live fields ({date} {hebrewDate} {year} {hebrewYear}
 *   {event}; fields.ts), never people fields; its `fallback` holds no field at all.
 * - Imports: a pack data file (packs/<name>.ts, packs/elements*.ts) and packs/index.ts import at RUN TIME only from
 *   elementKit.ts and from each other; everything else is `import type`. The registries import the packs, so a run-time
 *   import of a registry from a pack file would be a cycle.
 *
 * How a pack is used (packs/use.ts): a title is ONE add_text (packTitleOp), a look is ONE add_adjustment (packLookOp), a
 * caption look is ONE apply_caption_look, a template goes through the template routes. Each is one undo. An element or a
 * sound from a pack goes through the existing element and sound routes: the clip is one undo, the file stays in the library.
 */
import type { CaptionLook } from '../captionPresets.ts';
import type { TextPreset } from '../textPresets.ts';
import type { PackFieldKey, TemplateDef } from '../templateContract.ts';
import type { GDate } from '../hebrewCalendar.ts';

export type PackWords = { he: string; en: string };
/** An adjustment look of a pack: applied as ONE add_adjustment over the whole edit (packLookOp). No fade: fades stay a template feature. */
export interface PackLook { id: `look.${string}`; name: PackWords; hint: PackWords; effects: readonly { type: string; params?: Record<string, number | string | boolean> }[] }
/** A ready title of a pack: placed as ONE add_text (packTitleOp). */
export interface PackTitle {
  id: `title.${string}`; name: PackWords;
  /** May hold pack fields and live fields (see the rules above). */
  text: PackWords;
  /** The words used when a pack field of `text` has no value, or its live fields would have no capture date to read. No field in it. */
  fallback: PackWords;
  /** A text style of TEXT_PRESETS (the pack's own or a built-in one). */
  presetId: string;
  /** How long the title lasts when it is placed, 0.5 to 30 seconds. */
  seconds: number;
  anim?: NonNullable<TemplateDef['texts'][number]['anim']>;
  /** Frame fractions from the centre, and the title size as a fraction of the frame height. */
  place: { x: number; y: number; sizeFrac?: number };
}
/**
 * When a pack is suggested.
 * - holiday: a holiday of the life line's table (hebrewCalendar.ts HOLIDAY_FAMILIES, Israeli schedule), by its family id.
 *   The pack is suggested from `leadDays` before the holiday's first day until `trailDays` after its last day. A holiday
 *   begins the evening before its first day, and the days-away count is to that evening. Leap years, Adar and the moved
 *   state days are the calendar's business, not the pack's.
 * - life-event: a birthday the caller knows of (LifeEventHint), within `windowDays` either side.
 * - always: never suggested; the pack is simply listed.
 */
export type PackOccasion =
  | { kind: 'holiday'; family: string; leadDays: number; trailDays: number }
  | { kind: 'life-event'; event: 'birthday'; windowDays: number }
  | { kind: 'always' };
export interface PackDef {
  id: `pack.${string}`; version: number; name: PackWords; hint: PackWords;
  /** Two to six colours (#RRGGBB) of the pack: its cover and the default colours of its titles. */
  palette: readonly string[];
  occasion: PackOccasion;
  /** New templates the pack brings; each names this pack in its `pack` field. */
  templates: readonly TemplateDef[];
  /** Templates that exist already and also belong here (the birthday pack lists tpl.birthday, which stays unchanged). */
  templateIds: readonly string[];
  /** Elements of the pack (ids of ELEMENTS), and the three shown on its cover. */
  elementIds: readonly string[]; coverElementIds: readonly [string, string, string];
  looks: readonly PackLook[]; captionLooks: readonly CaptionLook[]; textPresets: readonly TextPreset[]; titles: readonly PackTitle[];
  /** Built-in sounds (apps/server/src/sfx.ts; checked by the server's test) and built-in music styles (musicStyles.ts) that suit the pack. Picks only: nothing is added or preselected. */
  sfxIds: readonly string[]; musicStyleIds: readonly string[];
}
/** What every pack says about where its content comes from. */
export const PACK_SOURCE = 'made in this build: drawn or synthesised by formula; no third-party content' as const;
/** A pack as GET /api/v1/packs and catalog().packs list it. */
export interface PackSummary {
  id: string; version: number; name: PackWords; hint: PackWords; palette: readonly string[]; occasion: PackOccasion;
  /** The pack's own templates, then the existing ones that belong to it. */
  templateIds: string[];
  elementIds: string[]; coverElementIds: string[]; looks: PackLook[]; captionLookIds: string[]; textPresetIds: string[]; titles: PackTitle[]; sfxIds: string[]; musicStyleIds: string[];
  /** The pack fields its titles and templates hold: what the pack page asks for. liveFields: some title or template text holds a live field. */
  fields: PackFieldKey[]; liveFields: boolean;
  source: typeof PACK_SOURCE;
}
/** A birthday the caller knows of: `on` is the day it falls on this time (the caller works the anniversary out), `name` whose it is. */
export interface LifeEventHint { kind: 'birthday'; on: GDate; name?: string }
/**
 * One suggested pack. daysAway: days until the occasion begins (for a holiday: until the evening that begins it), 0 while
 * it lasts, negative = days since it ended. firstDay and lastDay are its civil days; eveningBefore: it begins the evening
 * before firstDay. `reason` is the line shown on the pack's badge.
 */
export interface PackSuggestion { packId: string; daysAway: number; firstDay: GDate; lastDay: GDate; eveningBefore: boolean; reason: PackWords }
