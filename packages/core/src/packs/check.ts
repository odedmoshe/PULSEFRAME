/**
 * The rules of packs/contract.ts as a function: packIssues(pack) lists everything a pack breaks, [] when it is sound.
 * packs/contract.test.ts runs it over every pack of the build, so a pack that breaks a rule fails the unit tests; a pack's own
 * tests (packs/packs.test.ts) use it too. Pure. This file may import the registries (it is not imported by them).
 *
 * Not checked here: that the sound ids exist (the list is only in apps/server/src/sfx.ts; apps/server/src/packs.test.ts
 * checks it), and what the elements draw (packs/elements.test.ts holds each to the markup rules; the owner looks at the
 * contact sheet).
 */
import type { PackDef } from './contract.ts';
import { elementIdChoices, TemplateDefSchema, PACK_ID, type TemplateDef } from '../templateContract.ts';
import { BUILTIN_TEMPLATES } from '../templateCatalog.ts';
import { BUILTIN_TEXT_PRESETS } from '../textPresets.ts';
import { BUILTIN_CAPTION_LOOKS } from '../captionPresets.ts';
import { ELEMENTS } from '../elements.ts';
import { findEffect, GPU_TRANSITION_IDS } from '../effects.ts';
import { adjustmentRefusal } from '../validate.ts';
import { findFont } from '../fonts.ts';
import { findMusicStyle } from '../musicStyles.ts';
import { HOLIDAY_FAMILIES } from '../hebrewCalendar.ts';
import { titleTextProblems } from '../titleFields.ts';

/** The hexagram: available in the library, never part of a pack (owner decision). */
export const NEVER_IN_A_PACK = 'element.shape.star-6';
/** Effects that flash; no pack look and no look of a pack template may use them, whatever their parameters. */
const FLASHING = /strobe|flicker|flash/;
/** Transitions that flash (a dip to white, a flash); no pack template may use them. */
const FLASHING_TRANSITIONS: readonly string[] = ['dip-white', 'flash'];
const COLOUR = /^#[0-9A-Fa-f]{6}$/;
const HEBREW = /[א-ת]/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const words = (w: { he: string; en: string } | undefined) => !!w && HEBREW.test(w.he) && w.en.trim().length > 0;
const twice = (ids: readonly string[]) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

/** Everything `pack` breaks of the rules in packs/contract.ts, as sentences; [] = none. `others` = the other packs of the build (ids must be unique across packs). */
export function packIssues(pack: PackDef, others: readonly PackDef[] = []): string[] {
  const out: string[] = [];
  const bad = (what: string) => out.push(`${pack.id}: ${what}`);
  if (!PACK_ID.test(pack.id)) bad('the id must be pack.<lower-case words>');
  const slug = pack.id.replace(/^pack\./, '');
  if (!Number.isInteger(pack.version) || pack.version < 1) bad('version must be a whole number from 1');
  if (!words(pack.name) || !words(pack.hint)) bad('name and hint need Hebrew and English');
  if (pack.palette.length < 2 || pack.palette.length > 6 || !pack.palette.every((c) => COLOUR.test(c))) bad('the palette is two to six #RRGGBB colours');
  const o = pack.occasion;
  if (o.kind === 'holiday') {
    if (!Object.hasOwn(HOLIDAY_FAMILIES, o.family)) bad(`the calendar has no holiday family "${o.family}"`);
    if (![o.leadDays, o.trailDays].every((n) => Number.isInteger(n) && n >= 0 && n <= 60)) bad('leadDays and trailDays are whole days from 0 to 60');
  } else if (o.kind === 'life-event' && !(Number.isInteger(o.windowDays) && o.windowDays >= 0 && o.windowDays <= 60)) bad('windowDays is whole days from 0 to 60');

  // ----- text styles, caption looks -----
  const builtinPresets = new Set(BUILTIN_TEXT_PRESETS.map((p) => p.id)), otherPresets = new Set(others.flatMap((p) => p.textPresets.map((x) => x.id)));
  const font = (family: string, weight: number, where: string) => { const f = findFont(family); if (!f) bad(`${where} uses the font "${family}", which is not bundled`); else if (!f.weights.includes(weight)) bad(`${where} uses ${family} at weight ${weight}; bundled: ${f.weights.join(', ')}`); };
  for (const p of pack.textPresets) {
    if (!SLUG.test(p.id) || !p.id.startsWith(`${slug}-`)) bad(`text style "${p.id}": the id must be ${slug}-<words>`);
    if (builtinPresets.has(p.id) || otherPresets.has(p.id)) bad(`text style "${p.id}" exists already`);
    if (!words(p.name)) bad(`text style "${p.id}" needs a Hebrew and an English name`);
    font(p.style.fontFamily, p.style.fontWeight, `text style "${p.id}"`);
  }
  for (const id of twice(pack.textPresets.map((p) => p.id))) bad(`text style "${id}" is listed twice`);
  const builtinLooks = new Set(BUILTIN_CAPTION_LOOKS.map((l) => l.id)), otherLooks = new Set(others.flatMap((p) => p.captionLooks.map((x) => x.id)));
  for (const l of pack.captionLooks) {
    if (!l.id.startsWith(`caption.${slug}-`) || !SLUG.test(l.id.slice('caption.'.length))) bad(`caption look "${l.id}": the id must be caption.${slug}-<words>`);
    if (builtinLooks.has(l.id) || otherLooks.has(l.id)) bad(`caption look "${l.id}" exists already`);
    if (!words(l.name) || !words(l.hint)) bad(`caption look "${l.id}" needs a Hebrew and an English name and hint`);
    if (l.style.fontFamily !== undefined) font(l.style.fontFamily, l.style.fontWeight ?? 700, `caption look "${l.id}"`);
  }
  for (const id of twice(pack.captionLooks.map((l) => l.id))) bad(`caption look "${id}" is listed twice`);

  // ----- looks -----
  const effects = (list: readonly { type: string; params?: Record<string, unknown> }[], where: string) => {
    if (!list.length) bad(`${where} has no effect`);
    for (const e of list) {
      const def = findEffect(e.type);
      if (!def) { bad(`${where}: effect "${e.type}" does not exist`); continue; }
      if (def.cost !== 'filter' && def.cost !== 'layer') bad(`${where}: ${e.type} has cost "${def.cost}"; a pack look uses only filter and layer effects (no graphics adapter, no time effect)`);
      const refused = adjustmentRefusal(e.type);
      if (refused) bad(`${where}: ${e.type} cannot go on an adjustment clip: ${refused}`);
      if (FLASHING.test(e.type)) bad(`${where}: ${e.type} flashes`);
      if (!def.params.safeParse(e.params ?? {}).success) bad(`${where}: the parameters of ${e.type} are not valid`);
    }
  };
  for (const l of pack.looks) {
    if (!l.id.startsWith(`look.${slug}-`) || !SLUG.test(l.id.slice('look.'.length))) bad(`look "${l.id}": the id must be look.${slug}-<words>`);
    if (!words(l.name) || !words(l.hint)) bad(`look "${l.id}" needs a Hebrew and an English name and hint`);
    if (l.effects.length > 16) bad(`look "${l.id}" has more than 16 effects`);
    effects(l.effects, `look "${l.id}"`);
  }
  for (const id of twice(pack.looks.map((l) => l.id))) bad(`look "${id}" is listed twice`);

  // ----- titles -----
  const presetIds = new Set([...builtinPresets, ...pack.textPresets.map((p) => p.id)]);
  for (const t of pack.titles) {
    const where = `title "${t.id}"`;
    if (!t.id.startsWith(`title.${slug}-`) || !SLUG.test(t.id.slice('title.'.length))) bad(`${where}: the id must be title.${slug}-<words>`);
    if (!words(t.name) || !words(t.text) || !words(t.fallback)) bad(`${where} needs a Hebrew and an English name, text and fallback`);
    for (const lang of ['he', 'en'] as const) {
      for (const p of titleTextProblems(t.text[lang], t.fallback[lang])) bad(`${where} (${lang}): ${p}`);
      if (t.text[lang].length > 200 || t.fallback[lang].length > 200) bad(`${where} (${lang}): at most 200 characters`);
    }
    if (!presetIds.has(t.presetId)) bad(`${where}: text style "${t.presetId}" is neither a built-in one nor one of this pack`);
    if (!(t.seconds >= 0.5 && t.seconds <= 30)) bad(`${where}: seconds must be from 0.5 to 30`);
    if (!(Math.abs(t.place.x) <= 0.5 && Math.abs(t.place.y) <= 0.5) || (t.place.sizeFrac !== undefined && !(t.place.sizeFrac >= 0.01 && t.place.sizeFrac <= 0.4))) bad(`${where}: place is x and y from -0.5 to 0.5 and sizeFrac from 0.01 to 0.4`);
  }
  for (const id of twice(pack.titles.map((t) => t.id))) bad(`title "${id}" is listed twice`);

  // ----- elements -----
  const elements = new Map(ELEMENTS.map((e) => [e.id, e]));
  for (const id of pack.elementIds) {
    if (!elements.has(id)) bad(`element "${id}" does not exist`);
    if (id === NEVER_IN_A_PACK) bad(`${NEVER_IN_A_PACK} is never part of a pack`);
  }
  for (const id of twice([...pack.elementIds])) bad(`element "${id}" is listed twice`);
  if (pack.elementIds.length < 3) bad('a pack lists at least three elements (its cover shows three)');
  for (const id of pack.coverElementIds) if (!pack.elementIds.includes(id)) bad(`cover element "${id}" is not one of the pack's elements`);
  if (new Set(pack.coverElementIds).size !== 3) bad('the cover shows three different elements');

  // ----- templates -----
  const builtinTemplates = new Set(BUILTIN_TEMPLATES.map((t) => t.id)), otherTemplates = new Set(others.flatMap((p) => p.templates.map((t) => t.id)));
  for (const raw of pack.templates) {
    const parsed = TemplateDefSchema.safeParse(raw);
    if (!parsed.success) { bad(`template "${String((raw as { id?: unknown }).id)}" does not parse: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`); continue; }
    const t: TemplateDef = parsed.data, where = `template "${t.id}"`;
    if (!t.id.startsWith(`tpl.${slug}-`)) bad(`${where}: the id must be tpl.${slug}-<words>`);
    if (t.pack !== pack.id) bad(`${where} must name this pack in its pack field`);
    if (builtinTemplates.has(t.id) || otherTemplates.has(t.id)) bad(`${where} exists already`);
    if (t.music.builtin !== undefined && !findMusicStyle(t.music.builtin)) bad(`${where}: there is no built-in music style "${t.music.builtin}"`);
    for (const e of t.elements) for (const id of elementIdChoices(e, t.slots.length)) {
      if (id === NEVER_IN_A_PACK) bad(`${where}: ${NEVER_IN_A_PACK} is never part of a pack template`);
      if (!pack.elementIds.includes(id)) bad(`${where}: element ${e.key} can draw ${id}, which the pack does not list`);
    }
    for (const a of t.adjust) effects(a.effects, `${where}, look ${a.key}`);
    for (const s of t.slots) {
      if (!s.transitionIn) continue;
      if (FLASHING_TRANSITIONS.includes(s.transitionIn.type) || FLASHING.test(s.transitionIn.type)) bad(`${where}: the transition ${s.transitionIn.type} flashes`);
      if (GPU_TRANSITION_IDS.includes(s.transitionIn.type)) bad(`${where}: the transition ${s.transitionIn.type} needs a graphics adapter; a pack template runs on any machine`);
    }
    for (const x of t.texts) if (!presetIds.has(x.presetId)) bad(`${where}, text ${x.key}: text style "${x.presetId}" is neither a built-in one nor one of this pack`);
  }
  for (const id of twice(pack.templates.map((t) => t.id))) bad(`template "${id}" is listed twice`);
  for (const id of pack.templateIds) if (!builtinTemplates.has(id)) bad(`"${id}" is not an existing template (templateIds lists templates that exist outside the pack)`);

  // ----- picks -----
  for (const id of pack.sfxIds) if (!/^sfx\.[a-z0-9-]+$/.test(id)) bad(`"${id}" is not the id of a built-in sound`);
  for (const id of pack.musicStyleIds) if (!findMusicStyle(id)) bad(`there is no built-in music style "${id}"`);
  for (const p of others) if (p.id === pack.id) bad('another pack has the same id');
  return out;
}
