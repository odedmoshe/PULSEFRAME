/**
 * Pure helpers of the audiences surfaces (wave 8 audiences track): no DOM, so node tests cover them. The change rows are worded from
 * the machine values of core AudienceChange (registry ids, sizes, dB); nothing here calls a result good, safe or checked.
 */
import { EFFECTS, TRANSITIONS, hasFormatOverride, KEEP_RULES, type AudienceChange, type AudienceChanges, type AudienceFastCuts, type KeepRule, type Variant, type VariantOverride } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import type { Lang } from '@pulseframe/i18n';
import { audienceT } from './audience.strings.ts';

/** A chip is «adjusted» only by overrides that are more than kept rules (verifier C14). */
export const isDiverged = (v: Pick<Variant, 'overrides'>): boolean => Object.values(v.overrides ?? {}).some((o) => hasFormatOverride(o as VariantOverride));
/** How many clips of a format have an override of their own (kept rules do not count). */
export const overrideCount = (v: Pick<Variant, 'overrides'>): number => Object.values(v.overrides ?? {}).filter((o) => hasFormatOverride(o as VariantOverride)).length;

const nameOf = (list: readonly { id: string; name: { he: string; en: string } }[], id: unknown, lang: Lang): string => {
  const s = String(id ?? '');
  return list.find((x) => x.id === s)?.name[lang] ?? s;
};
const absDb = (c: AudienceChange): number => Math.abs(Number(c.after ?? 0) - Number(c.before ?? 0));

/** The sentence of one change row (i18n audience.rule.*). */
export function changeText(c: AudienceChange, lang: Lang): string {
  const t = audienceT(lang);
  switch (c.rule) {
    case 'effect': return t('rule.effect', { name: nameOf(EFFECTS, c.before, lang) });
    case 'modulator': return t('rule.modulator', { name: nameOf(EFFECTS, c.before, lang) });
    case 'transition': return t('rule.transition', { name: nameOf(TRANSITIONS, c.before, lang) });
    case 'text_loop': return t('rule.text_loop');
    case 'title_size': return t('rule.title_size');
    case 'caption_look': return t('rule.caption_look');
    case 'music_level': return t('rule.music_level', { db: absDb(c) });
    case 'ducking': return t('rule.ducking', { db: absDb(c) });
  }
}
/** The rule a «להשאיר כמו במקור» button commits, or null when this row cannot be kept (no clip, not keepable). */
export function keepRuleOf(c: AudienceChange): KeepRule | null {
  return c.keepable && c.clipId && (KEEP_RULES as readonly string[]).includes(c.rule) ? (c.rule as KeepRule) : null;
}
/** The `set_audience_keep` args of the keep/give-back button: one op, the opposite of the row's present state. */
export const keepOp = (variantId: string, c: AudienceChange) => {
  const rule = keepRuleOf(c);
  return rule && c.clipId ? { op: 'set_audience_keep', args: { variantId, clipId: c.clipId, rule, keep: !c.kept } } : null;
};
/** A time for a frame, as the timeline writes it (drawn in <bdi dir="ltr">). */
export const frameClock = (frame: number, rate: T.Rate): string => T.toTimecode(T.frameTime(Math.max(0, Math.floor(frame)), rate), rate);
export function fastCutText(f: AudienceFastCuts, lang: Lang): string {
  return audienceT(lang)('fastCut', { cuts: f.cuts, seconds: f.windowSeconds, limit: f.limit });
}

/** The rows a person can jump to, in the order shown: changes, then fast cuts (one roving group). */
export interface JumpRow { kind: 'change' | 'fastCut'; key: string; startFrame: number }
export function jumpRows(r: Pick<AudienceChanges, 'changes' | 'fastCuts'>): JumpRow[] {
  return [
    ...r.changes.map((c): JumpRow => ({ kind: 'change', key: c.key, startFrame: c.startFrame })),
    ...r.fastCuts.map((f, i): JumpRow => ({ kind: 'fastCut', key: `fast:${i}:${f.startFrame}`, startFrame: f.startFrame })),
  ];
}
/** The count the stage note says: rules applied, not the ones the owner kept. */
export const appliedCount = (r: Pick<AudienceChanges, 'changes'>): number => r.changes.filter((c) => !c.kept).length;
export const stageNote = (name: string, n: number, lang: Lang): string => audienceT(lang)('stage', { name, n });

// ---------- C3: the size control of the inspector ----------
/** What an <input type=range> shows for a value: clamped to its range and snapped to its step grid from min (the browser's rule). */
export function snapRange(v: number, min: number, max: number, step: number): number {
  const c = Math.min(max, Math.max(min, v));
  const n = Math.round((c - min) / step);
  return +(Math.min(max, min + n * step)).toFixed(6);
}
/**
 * The value a size control may commit, or null for "nothing". While an audience version is viewed the shown size is the PROJECTED one
 * (the grandparents version inflates the inherited size by 4/3); the slider cannot show it exactly (step, range), so the value it
 * reports back after a mere visit is the snapped projection. Writing that back would store an own, absolute size and defeat the
 * rule (verifier C3). Only a value other than the snapped projection is a change the owner made.
 */
export function sizeToCommit(picked: number, shown: number, range: { min: number; max: number; step: number }, audienceViewed: boolean): number | null {
  const baseline = audienceViewed ? snapRange(shown, range.min, range.max, range.step) : shown;
  return picked === baseline ? null : picked;
}
