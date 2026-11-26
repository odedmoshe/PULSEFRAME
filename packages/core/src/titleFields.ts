/**
 * The fields a ready-made title's text may hold (ADR-0022), for the template planner (templatePlan.ts) and for pack titles
 * (packs/use.ts): which pack fields it asks for, whether it holds live fields of the life line, and the words it becomes for
 * given values. Pure.
 *
 * Two kinds of field meet in such a text and are kept apart:
 * - PACK fields ({name} {name2} {age} {night} {place} {when}; templateContract.ts PACK_FIELD_KEYS) are literal: their values
 *   are written into the text once, here.
 * - LIVE fields ({date} {hebrewDate} {year} {hebrewYear} {event}; fields.ts) stay in the text: the title is made with its
 *   live fields on and the evaluator shows the capture date of the picture under it. Nothing of the life line is repeated
 *   here; the grammar is read with fields.ts parseFields.
 * A text that holds a live field is written in the stored grammar of titles with fields: plain braces doubled. The values
 * written in are escaped the same way, so a name that holds a brace is never read as a field.
 */
import { escapeFieldText, isPersonToken, parseFields } from './fields.ts';
import { fillFields, packFieldsIn, type PackFieldKey, type PackFieldValues } from './templateContract.ts';

/** What a title's text holds. `notFields` and `people` matter only when `live` (a title without live fields is plain text, braces and all). */
export interface TitleFieldUse {
  /** the pack fields of the text, in the order of PACK_FIELD_KEYS */ pack: PackFieldKey[];
  /** it holds at least one live field of the life line */ live: boolean;
  /** brace groups that are neither a pack field nor a live field (nor the per-slot counter, when allowed), as written */ notFields: string[];
  /** people fields ({age:…}, {name:…}), which no ready-made title may hold */ people: string[];
}
/**
 * Write the planner's per-slot counter `{n}` into a template's own words. Doubled braces are passed over as they stand, so
 * in a text with live fields (plain braces doubled) `{{n}}` stays the plain words `{n}`.
 */
const writeCounter = (text: string, n: string): string => text.replace(/\{\{|\}\}|\{n\}/g, (m) => (m === '{n}' ? n : m));
/** Read a title's text. `counter`: the planner's own per-slot counter `{n}` is allowed in it (count-down and count-up titles). */
export function titleFieldUse(text: string, opts: { counter?: boolean } = {}): TitleFieldUse {
  const pack = packFieldsIn(text);
  // the pack tokens (and the counter) are taken out before the live grammar is read: to it they would be unknown groups
  let rest = fillFields(text, Object.fromEntries(pack.map((k) => [k, '\u0001'])) as PackFieldValues).text;
  if (opts.counter) rest = writeCounter(rest, '\u0001');
  const parts = parseFields(rest);
  const live = parts.some((p) => 'token' in p && !isPersonToken(p.token));
  return {
    pack, live,
    notFields: [...new Set(parts.flatMap((p) => ('bad' in p ? [p.bad] : [])))],
    people: [...new Set(parts.flatMap((p) => ('token' in p && isPersonToken(p.token) ? [p.raw] : [])))],
  };
}
/** Why a text or its fallback may not be a ready-made title's text; [] = it may. */
export function titleTextProblems(text: string, fallback: string | undefined, opts: { counter?: boolean } = {}): string[] {
  const use = titleFieldUse(text, opts), out: string[] = [];
  if (use.people.length) out.push(`it holds people fields (${use.people.join(', ')}), which a ready-made title may not`);
  if (use.live && use.notFields.length) out.push(`it holds live fields, and these brace groups in it are not fields: ${use.notFields.join(', ')} (plain braces are written doubled)`);
  if ((use.pack.length || use.live) && fallback === undefined) out.push('it holds fields, so it needs fallback words for when a field has no value');
  if (fallback !== undefined) {
    const f = titleFieldUse(fallback, opts);
    if (f.pack.length || f.live || f.people.length) out.push('its fallback words hold a field; a fallback is plain text');
  }
  return out;
}
/** The words a ready-made title becomes. */
export interface ResolvedTitleText {
  text: string;
  /** make the title with its live fields on (add_text fields: true / set_text_fields) */ fields: boolean;
  /** the fallback words were used */ usedFallback: boolean;
  /** pack fields of the text without a value (the reason for the fallback) */ missing: PackFieldKey[];
  /** its live fields would have no capture date to read (the reason for the fallback) */ noDate: boolean;
}
/**
 * The words of a title for these field values. `dated`: every picture the title lies over has a capture date, so its live
 * fields will have words. The fallback is used when a pack field of the text has no value, or when the text holds a live
 * field and `dated` is false; never both texts mixed. A text without a fallback keeps its tokens as written.
 * `n`: the per-slot counter of this copy (count-down and count-up titles). It is written into the template's own words
 * (text and fallback) BEFORE the field values, so a value that holds `{n}` is never read as the counter (fillFields: a
 * value is written once and never read again as text with tokens).
 */
export function resolveTitleText(text: string, fallback: string | undefined, values: PackFieldValues, dated: boolean, opts: { counter?: boolean; n?: number } = {}): ResolvedTitleText {
  const use = titleFieldUse(text, opts);
  if (opts.n !== undefined) {
    const n = String(opts.n);
    text = writeCounter(text, n);
    if (fallback !== undefined) fallback = writeCounter(fallback, n);
  }
  const filled = fillFields(text, values, use.live ? escapeFieldText : undefined);
  const noDate = use.live && !dated;
  if ((filled.missing.length || noDate) && fallback !== undefined) return { text: fallback, fields: false, usedFallback: true, missing: filled.missing, noDate };
  return { text: filled.text, fields: use.live, usedFallback: false, missing: filled.missing, noDate };
}
