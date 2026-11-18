/**
 * What the pack shelf, the pack page and the pack fields decide (ADR-0022), kept apart from the components so it can be
 * tested without a browser: the suggestion for a day (the client's own date), the dismissals (a per-viewer preference in
 * localStorage, never project state), the count line, the tabs and their items, the one operation behind each action, and
 * the fields of the template dialog (the candle, the live Hebrew date). Pure: nothing here reads a clock or the project's state.
 */
import * as T from '@pulseframe/time';
import {
  ELEMENTS, MUSIC_STYLES, PACK_FIELD_KEYS, PackFieldsInputSchema, candleNight, findCaptionLook, findTemplate, formatHebrewDate, hebrewFromRd, isValidGregorian, packLookOps, packTitleOp, rdFromGregorian, suggestPacks,
  gregorianFromRd,
  type GDate, type LifeEventHint, type OpCall, type PackDef, type PackFieldKey, type PackFieldValues, type PackFieldsInput, type PackLook, type PackSuggestion, type PackSummary, type PackTitle, type ProjectDocument,
} from '@pulseframe/core';
import { PACK_TABS, type PackTab } from './packs.testids.ts';

type Words = { he: string; en: string };
type Lang = 'he' | 'en';

// ---------------------------------------------------------------- suggestions and dismissals
/**
 * The packs suggested for `today` (the browser's own local day; nothing reads a clock here), by pack id. The suggestion looks at a
 * pack's id and occasion only, which a summary carries.
 */
export function suggestionsFor(packs: readonly PackSummary[], today: GDate, hints: readonly LifeEventHint[] = []): Map<string, PackSuggestion> {
  const asDefs = packs.map((p) => ({ id: p.id, occasion: p.occasion })) as unknown as readonly PackDef[];
  return new Map(suggestPacks(asDefs, today, hints).map((s) => [s.packId, s]));
}
export const DISMISS_KEY = 'pf.packs.dismissed';
const DISMISS_MAX = 40;
/** A dismissal names the pack and the occurrence (its first civil day), so next year's holiday is suggested again. */
export const dismissKey = (s: Pick<PackSuggestion, 'packId' | 'firstDay'>): string => `${s.packId}@${s.firstDay.y}-${String(s.firstDay.m).padStart(2, '0')}-${String(s.firstDay.d).padStart(2, '0')}`;
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
/** localStorage when the page may use it (a private window, blocked site data or a preview may not), else null. */
export function safeLocalStorage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
export function readDismissed(store: StorageLike | null = safeLocalStorage()): Set<string> {
  try {
    const raw = store?.getItem(DISMISS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-DISMISS_MAX) : []);
  } catch { return new Set(); }
}
/** Whether it could be kept: false when the store is missing or refuses (the dismissal then lasts until the page closes). */
export function writeDismissed(dismissed: ReadonlySet<string>, store: StorageLike | null = safeLocalStorage()): boolean {
  try { if (!store) return false; store.setItem(DISMISS_KEY, JSON.stringify([...dismissed].slice(-DISMISS_MAX))); return true; } catch { return false; }
}
/** The shelf's order: suggested (and not dismissed) packs first, the nearest first; then the rest as given. */
export function shelfOrder(packs: readonly PackSummary[], suggestions: ReadonlyMap<string, PackSuggestion>, dismissed: ReadonlySet<string>): { pack: PackSummary; suggestion: PackSuggestion | null }[] {
  const live = (p: PackSummary) => { const s = suggestions.get(p.id); return s && !dismissed.has(dismissKey(s)) ? s : null; };
  const order = [...suggestions.keys()];
  const first = packs.filter((p) => live(p)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const rest = packs.filter((p) => !live(p));
  return [...first, ...rest].map((pack) => ({ pack, suggestion: live(pack) }));
}
/** «4 תבניות · 25 אלמנטים» (counts as numbers inside the words; the shelf draws the digits in the mono face). */
export const countLine = (pack: Pick<PackSummary, 'templateIds' | 'elementIds'>, S: { templates: (n: number) => string; elements: (n: number) => string }): string => `${S.templates(pack.templateIds.length)} · ${S.elements(pack.elementIds.length)}`;
/** The three element ids of a cover that exist in this build (a missing one is left out, never faked), and its colours from the palette. */
export function coverOf(pack: Pick<PackSummary, 'coverElementIds' | 'palette'>): { ids: string[]; color: string; color2: string; ground: string } {
  const known = new Set(ELEMENTS.map((e) => e.id));
  const p = pack.palette;
  return { ids: pack.coverElementIds.filter((id) => known.has(id)).slice(0, 3), color: p[0] ?? '#FFFFFF', color2: p[1] ?? p[0] ?? '#FFFFFF', ground: p[2] ?? p[0] ?? '#333333' };
}

// ---------------------------------------------------------------- the pack page
/** What each tab holds and how many (the tab's count). */
export function tabCounts(pack: PackSummary): Record<PackTab, number> {
  return { templates: pack.templateIds.length, titles: pack.titles.length, elements: pack.elementIds.length, looks: pack.looks.length, captions: pack.captionLookIds.length, sound: pack.sfxIds.length + pack.musicStyleIds.length };
}
export const tabSpecs = (pack: PackSummary, label: Record<PackTab, string>): { id: PackTab; label: string; count: number }[] => PACK_TABS.map((id) => ({ id, label: label[id], count: tabCounts(pack)[id] }));
export const isPackTab = (v: string): v is PackTab => (PACK_TABS as readonly string[]).includes(v);

export interface PackView {
  templates: { id: string; name: Words; hint: Words }[];
  titles: PackTitle[];
  elements: { id: string; name: Words }[];
  looks: PackLook[];
  captionLooks: { id: string; name: Words; hint: Words; needsWordTiming: boolean }[];
  sfx: { id: string; name: Words | null }[];
  music: { id: string; name: Words; hint: Words }[];
}
/**
 * The items of a pack with their names from the registries. An id the build does not know is left out (an element, a template, a
 * caption look) or shown by its id (a sound: the names come from the server's catalogue, which may not have loaded).
 */
export function packView(pack: PackSummary, sfxNames: Readonly<Record<string, Words>> = {}): PackView {
  const el = new Map(ELEMENTS.map((e) => [e.id, e.name]));
  const music = new Map(MUSIC_STYLES.filter((s) => s.review !== 'rejected').map((s) => [s.id as string, s]));
  return {
    templates: pack.templateIds.flatMap((id) => { const t = findTemplate(id); return t ? [{ id, name: t.name, hint: t.hint }] : []; }),
    titles: pack.titles,
    elements: pack.elementIds.flatMap((id) => { const n = el.get(id); return n ? [{ id, name: n }] : []; }),
    looks: pack.looks,
    captionLooks: pack.captionLookIds.flatMap((id) => { const l = findCaptionLook(id); return l ? [{ id, name: l.name, hint: l.hint, needsWordTiming: l.needsWordTiming }] : []; }),
    sfx: pack.sfxIds.map((id) => ({ id, name: sfxNames[id] ?? null })),
    music: pack.musicStyleIds.flatMap((id) => { const s = music.get(id); return s ? [{ id, name: s.name, hint: s.hint }] : []; }),
  };
}

/** The caption tracks of the main sequence, by name: where a caption look can go. */
export function captionTargets(doc: ProjectDocument | null): { id: string; name: string }[] {
  const seq = doc?.sequences[doc.mainSequenceId];
  return (seq?.tracks ?? []).filter((t) => t.kind === 'caption').map((t) => ({ id: t.id, name: t.name }));
}
/** The track a caption look goes to: the chosen one if it is still there, else the first. */
export const pickCaptionTarget = (targets: readonly { id: string }[], chosen: string | null): string | null => (targets.find((t) => t.id === chosen) ?? targets[0])?.id ?? null;

/** The pack fields of a title as the title op takes them (the values only; the date and the lighting switch belong to the template dialog). */
export function titleFieldValues(value: PackFieldsInput): PackFieldValues {
  const out: Partial<Record<PackFieldKey, string>> = {};
  for (const k of PACK_FIELD_KEYS) { const v = value[k]; if (v !== undefined && v !== '') out[k] = v; }
  return out;
}
export interface ActionContext { lang: Lang; start: T.RationalTime; rate: T.Rate; fields: PackFieldsInput; motion: 'full' | 'none' }
/** ONE add_text: the title's words with the fields written in, its place, text style and animation (core packTitleOp). The picture under it is not known here, so a live field uses its fallback words. */
export const titleAction = (title: PackTitle, c: ActionContext): { op: OpCall; label: string; fallbackUsed: boolean } => {
  const r = packTitleOp(title, { lang: c.lang, fields: titleFieldValues(c.fields), start: c.start, rate: c.rate, dated: false, motion: c.motion });
  return { op: r.op, label: title.name[c.lang], fallbackUsed: r.words.usedFallback };
};
/** ONE commit: an add_adjustment over the whole edit, and the move_track that keeps the graphic elements above it (core packLookOps). */
export const lookAction = (look: PackLook, lang: Lang, doc: ProjectDocument | null): { ops: OpCall[]; label: string } => ({ ops: doc ? packLookOps(look, lang, doc) : [], label: look.name[lang] });
/** ONE apply_caption_look. */
export const captionAction = (trackId: string, lookId: string): OpCall => ({ op: 'apply_caption_look', args: { trackId, lookId } });
/** The colours an element of this pack is made in: its palette, or the element's own defaults (the server uses them when none is named). */
export const elementColours = (pack: Pick<PackSummary, 'palette'>): { color: string; color2?: string } => (pack.palette[0] ? { color: pack.palette[0], ...(pack.palette[1] ? { color2: pack.palette[1] } : {}) } : { color: '#FFFFFF' });

// ---------------------------------------------------------------- the fields of the template dialog
export const FIELD_MAX = 80;
export const DATE_MIN_YEAR = 1900, DATE_MAX_YEAR = 2100;
export const CANDLES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');

/** The value with one field changed. An empty field is left out (not written as ''); a newline is a space; the age takes digits only. */
export function setField(value: PackFieldsInput, key: PackFieldKey, raw: string): PackFieldsInput {
  const next: PackFieldsInput = { ...value };
  const text = key === 'age' ? raw.replace(/\D/g, '').slice(0, 3) : clean(raw).slice(0, FIELD_MAX);
  if (text.trim() === '') delete next[key]; else next[key] = text;
  return next;
}
/** True when `raw` would have been changed by setField (so the field can say why). */
export const fieldWasCut = (key: PackFieldKey, raw: string): 'age' | 'long' | null => (key === 'age' ? (/\D/.test(raw) ? 'age' : null) : clean(raw).length > FIELD_MAX ? 'long' : null);
/** The pressed candle (1..8), or null. */
export function setCandle(value: PackFieldsInput, n: number | null): PackFieldsInput {
  const next: PackFieldsInput = { ...value };
  if (n === null || !CANDLES.includes(n as (typeof CANDLES)[number])) delete next.night; else next.night = String(n);
  return next;
}
/** The date field ('' leaves it out). A date outside 1900–2100 or not a real day is kept out of the value; `dateValid` says so. */
export function setDate(value: PackFieldsInput, raw: string): PackFieldsInput {
  const next: PackFieldsInput = { ...value };
  if (parseWallDate(raw)) next.date = raw; else delete next.date;
  return next;
}
/** The lighting switch is on unless it was turned off: on is the template's own default and is left out of the value. */
export const atLightingOn = (value: PackFieldsInput): boolean => value.atLighting !== false;
export function setAtLighting(value: PackFieldsInput, on: boolean): PackFieldsInput {
  const next: PackFieldsInput = { ...value };
  if (on) delete next.atLighting; else next.atLighting = false;
  return next;
}
export function parseWallDate(s: string): GDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const g = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return g.y >= DATE_MIN_YEAR && g.y <= DATE_MAX_YEAR && isValidGregorian(g) ? g : null;
}
/** What the date field holds when it is filled but is not a day: the field says so. */
export const dateProblem = (raw: string): boolean => raw !== '' && parseWallDate(raw) === null;
/**
 * The live Hebrew date of the date field, «כ״ה בכסלו תשפ״ז» (the life line's calendar), or null for no date. With the lighting
 * switch on, `evening` is the date of the Hebrew day that begins that evening, because the candle belongs to it.
 */
export function hebrewDateOf(date: string | undefined, atLighting: boolean): { day: string; evening: string | null } | null {
  const g = date ? parseWallDate(date) : null;
  if (!g) return null;
  const rd = rdFromGregorian(g);
  return { day: formatHebrewDate(hebrewFromRd(rd), { year: true }), evening: atLighting ? formatHebrewDate(hebrewFromRd(rd + 1), { year: true }) : null };
}
/** The Hanukkah candle the planner works out from the date and the switch (core candleNight), or null (no date, or not in Hanukkah). */
export function derivedCandle(value: PackFieldsInput): number | null {
  const g = value.date ? parseWallDate(value.date) : null;
  return g ? candleNight(g, atLightingOn(value)) : null;
}
/** The candle the radio group shows as chosen: the one picked, else the one worked out from the date, else none. */
export function shownCandle(value: PackFieldsInput): { n: number | null; by: 'picked' | 'date' | 'none' } {
  const picked = value.night !== undefined && /^[1-8]$/.test(value.night) ? Number(value.night) : null;
  if (picked !== null) return { n: picked, by: 'picked' };
  const d = derivedCandle(value);
  return d !== null ? { n: d, by: 'date' } : { n: null, by: 'none' };
}
/** The first problem the template route would refuse the value for (its own schema), or null. */
export function fieldsProblem(value: PackFieldsInput): string | null {
  const r = PackFieldsInputSchema.safeParse(value);
  return r.success ? null : (r.error.issues[0]?.message ?? 'invalid');
}
/** A civil day string 'YYYY-MM-DD' of a GDate (for the date input's value). */
export const wallDate = (g: GDate): string => `${g.y}-${String(g.m).padStart(2, '0')}-${String(g.d).padStart(2, '0')}`;
/** `n` days after a day (the evening's day). */
export const addDays = (g: GDate, n: number): GDate => gregorianFromRd(rdFromGregorian(g) + n);
/** The browser's own local day as a GDate: the caller passes `new Date()`, nothing here reads a clock. */
export const localDay = (now: Date): GDate => ({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });

/**
 * A pack's own hint as the owner reads it: a field key in braces ({night}) becomes the readable words in brackets
 * («[מספר הלילה]»); a key that is not a pack field is left out of the braces, never shown raw.
 */
export function readableHint(text: string, words: Record<string, string>): string {
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, k: string) => `[${words[k] ?? k}]`);
}
