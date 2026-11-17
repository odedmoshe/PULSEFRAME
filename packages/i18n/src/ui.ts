/**
 * Reserved string namespaces of the redesigned interface (docs/design/UX_REDESIGN.md, implementation plan, lead pre-pass
 * step 8). Each surface of the new interface has one namespace; a string's full id is `<namespace>.<key>`, for example
 * `ui.top.saved`. The namespaces are reserved here so that
 *   - no key of the flat dictionaries (index.ts `he` / `en`) may start with one of them, and
 *   - workers never edit this package: a worker declares its strings beside its component, in its own `*.strings.ts`,
 *     with `defineUiStrings('<namespace>', { …Hebrew… }, { …English… })`. The types make the English table cover exactly
 *     the Hebrew keys (a missing or an extra key does not compile), and ui.test.ts reads every `*.strings.ts` of the web
 *     app and holds each such table to the same rules as the tables below.
 * Hebrew first. A value is a string, or a function for a sentence built from values: whole-sentence templates, because
 * Hebrew units and word order differ ("0.5 ש׳", "הקליפ נמחק והרווח נסגר · 4 קליפים זזו").
 */
import type { Lang } from './index.ts';

export const UI_NAMESPACES = ['ui.top', 'ui.rail', 'ui.tl', 'ui.insp', 'ui.gal', 'ui.ai', 'ui.export', 'ui.hub'] as const;
export type UiNamespace = (typeof UI_NAMESPACES)[number];
/** What each namespace holds (sections of docs/design/UX_REDESIGN.md). */
export const UI_NAMESPACE_SCOPE: Record<UiNamespace, string> = {
  'ui.top': 'top bar and status bar: project name, save line, modes, command bar, presence, undo and redo, export chip (§4.2, §4.8)',
  'ui.rail': 'rail and browser drawer: categories, media, audio, elements, their empty and missing states (§4.3, §4.4)',
  'ui.tl': 'timeline: toolbar, ride bar, track headers, pulse strip, ruler, cut chips, drop tips, the splitter (§4.7)',
  'ui.insp': 'stage and inspector: stage header, transport, preview notices, the tab sets and their property rows (§4.5, §4.6)',
  'ui.gal': 'catalogue spread: transitions, effects, looks, text styles, caption looks, tile states (§4.4)',
  'ui.ai': 'AI hub, run sheet, copilot, provenance (§4.11)',
  'ui.export': 'export sheet and deliver mode: destinations, preflight, progress, done and failed (§4.9, §4.12)',
  'ui.hub': 'start hub, projects, dialogs, toasts (§4.14, §4.15)',
};

/** A string, or a sentence built from values. */
export type UiValue = string | ((...args: never[]) => string);
/** The English table of a Hebrew table: the same keys; a string where Hebrew has a string, the same parameters where it has a function. */
export type UiEnglish<He> = { readonly [K in keyof He]: He[K] extends (...args: infer A) => string ? (...args: A) => string : string };
const BRAND = Symbol.for('pulseframe.ui-strings');
export interface UiStrings<NS extends UiNamespace = UiNamespace, He extends Readonly<Record<string, UiValue>> = Readonly<Record<string, UiValue>>> {
  readonly ns: NS;
  readonly he: He;
  readonly en: UiEnglish<He>;
  /** Keys whose text is deliberately not in the language's own script (a product name, the name of the other language, a unit). */
  readonly sameScript: readonly string[];
  readonly [BRAND]: true;
}

/**
 * Declares the strings of one surface in a reserved namespace. Hebrew, then English with exactly the same keys.
 *   export const TOP_STRINGS = defineUiStrings('ui.top', { saved: 'נשמר', moved: (n: number) => `${n} קליפים זזו` }, { saved: 'Saved', moved: (n: number) => `${n} clips moved` });
 *   const S = uiText(TOP_STRINGS, lang);  S.saved;  S.moved(4);
 */
export function defineUiStrings<const NS extends UiNamespace, const He extends Readonly<Record<string, UiValue>>>(ns: NS, he: He, en: UiEnglish<He>, options: { sameScript?: readonly (keyof He & string)[] } = {}): UiStrings<NS, He> {
  return Object.freeze({ ns, he, en, sameScript: options.sameScript ?? [], [BRAND]: true as const });
}
/** The strings of a table in one language. */
export const uiText = <NS extends UiNamespace, He extends Readonly<Record<string, UiValue>>>(table: UiStrings<NS, He>, lang: Lang): UiEnglish<He> => (lang === 'he' ? (table.he as unknown as UiEnglish<He>) : table.en);
export const isUiStrings = (x: unknown): x is UiStrings => typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[BRAND] === true;

/**
 * The reserved place of every namespace in this package: empty at the pre-pass, valid in both languages. Strings that
 * several surfaces share (a unit, a common verb) are added here by the lead; everything else lives in the workers' files.
 */
export const UI_SHARED = {
  'ui.top': defineUiStrings('ui.top', {}, {}),
  'ui.rail': defineUiStrings('ui.rail', {}, {}),
  'ui.tl': defineUiStrings('ui.tl', {}, {}),
  'ui.insp': defineUiStrings('ui.insp', {}, {}),
  'ui.gal': defineUiStrings('ui.gal', {}, {}),
  'ui.ai': defineUiStrings('ui.ai', {}, {}),
  'ui.export': defineUiStrings('ui.export', {}, {}),
  'ui.hub': defineUiStrings('ui.hub', {}, {}),
} satisfies { readonly [N in UiNamespace]: UiStrings<N> };

const HEBREW = /[֐-׿]/;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort().join(',');
/**
 * What is wrong with a table, as sentences (none when it is in step): the two languages cover the same keys with non-empty
 * text, Hebrew text is Hebrew and English text is not, `{placeholders}` and function parameters agree, keys are plain names.
 * The types catch a key mismatch when the table is written with defineUiStrings; this also holds tables built another way.
 */
export function uiStringProblems(table: UiStrings): string[] {
  const out: string[] = [];
  const id = (k: string) => `${table.ns}.${k}`;
  if (!(UI_NAMESPACES as readonly string[]).includes(table.ns)) out.push(`"${table.ns}" is not a reserved namespace`);
  const he = table.he as Record<string, UiValue>, en = table.en as Record<string, UiValue>;
  for (const k of Object.keys(he)) if (!(k in en)) out.push(`${id(k)} has no English text`);
  for (const k of Object.keys(en)) if (!(k in he)) out.push(`${id(k)} has no Hebrew text`);
  for (const k of table.sameScript) if (!(k in he)) out.push(`${id(k)} is listed in sameScript but is not a key`);
  for (const k of Object.keys(he)) {
    if (!/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/.test(k)) out.push(`${id(k)}: a key is plain words joined by dots (camelCase parts)`);
    const h = he[k], e = en[k];
    if (e === undefined) continue;
    if (typeof h !== typeof e) { out.push(`${id(k)} is a ${typeof h} in Hebrew and a ${typeof e} in English`); continue; }
    if (typeof h === 'function' && typeof e === 'function') { if (h.length !== e.length) out.push(`${id(k)} takes ${h.length} values in Hebrew and ${e.length} in English`); continue; }
    const hs = h as string, es = e as string;
    if (!hs.trim()) out.push(`${id(k)} is empty in Hebrew`);
    if (!es.trim()) out.push(`${id(k)} is empty in English`);
    if (placeholders(hs) !== placeholders(es)) out.push(`${id(k)} fills in {${placeholders(hs)}} in Hebrew and {${placeholders(es)}} in English`);
    if (table.sameScript.includes(k)) continue;
    // text with no letters at all (a sign, a number) is the same in both languages
    if (/\p{L}/u.test(hs) && !HEBREW.test(hs)) out.push(`${id(k)}: the Hebrew text has no Hebrew letters`);
    if (HEBREW.test(es)) out.push(`${id(k)}: the English text has Hebrew letters`);
  }
  return out;
}
