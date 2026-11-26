/** Pure helpers of «מאגר» (wave 8 sources, W3): words, licence badge naming, warning lines quoting the licence, job progress, keys of the grid. */
import { LICENCE_WARNING_TERMS, SOURCE_TERMS, type SourceKind, type SourceRecord, type SourceTermRow, type SourceWarning } from '@pulseframe/core';
import { dictionaries, type Key, type Lang } from '@pulseframe/i18n';

export type SourcesKey = Extract<Key, `sources.${string}`>;
export const fillS = (s: string, vars: Record<string, string | number> = {}): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
export const sx = (lang: Lang, key: SourcesKey, vars?: Record<string, string | number>): string => fillS(dictionaries[lang][key] ?? key, vars);

export const PROVIDER_NAMES: Record<string, string> = { openverse: 'Openverse', pixabay: 'Pixabay', wikimedia: 'Wikimedia Commons', creativecommons: 'Creative Commons', link: 'link' };
export const providerName = (id: string): string => PROVIDER_NAMES[id] ?? id;

/** The licence name as the service gave it; the id when the name is empty; nothing stated otherwise. Never our conclusion. */
export const licenceLabel = (lang: Lang, l: { id: string; name: string }): string => (l.name.trim() || (l.id && l.id !== 'unknown' ? l.id : sx(lang, 'sources.licenceNone')));

/** Which media element a row's preview needs. */
export const previewKindOf = (kind: SourceKind): 'video' | 'audio' | 'image' => (kind === 'video' ? 'video' : kind === 'music' || kind === 'sound' ? 'audio' : 'image');
/** Audio kinds go to the sound target track; the rest to the picture one. */
export const targetKindOf = (kind: SourceKind): 'video' | 'audio' => (previewKindOf(kind) === 'audio' ? 'audio' : 'video');

/** One term row shown beside an item: the licence's or service's own sentence, with the link and the day it was read. */
export interface TermLine { id: string; quote: string; url: string; readOn: string; translation: string | null; note: string; provider: string }
export function termLines(lang: Lang, ids: readonly string[]): TermLine[] {
  const out: TermLine[] = [];
  for (const id of ids) {
    const r: SourceTermRow | undefined = SOURCE_TERMS[id];
    if (!r) continue;
    out.push({ id, quote: r.quote, url: r.url, readOn: r.readOn, translation: lang === 'he' ? r.he : null, note: lang === 'he' ? r.he : r.en, provider: r.provider });
  }
  return out;
}

/** The heading sentence of one warning (its code decides; the licence name goes in), without the quote. */
export function warningHead(lang: Lang, w: SourceWarning, fallbackName = ''): string {
  const name = w.licenceName ?? w.title ?? fallbackName;
  if (w.code === 'source_terms') {
    const p = w.termIds.map((id) => SOURCE_TERMS[id]?.provider).find(Boolean);
    return sx(lang, 'sources.warn.source_terms', { name: providerName(p ?? name) });
  }
  const key = `sources.warn.${w.code}` as SourcesKey;
  return sx(lang, key, { name: name || sx(lang, 'sources.licenceNone') });
}

/** What the badge of an item says it is (class only; the badge's text is the licence's own name). */
export function badgeTone(f: SourceRecord['flags']): 'nc' | 'unconfirmed' | 'plain' { return f.nonCommercial ? 'nc' : f.licenceUnconfirmed || f.siteTerms ? 'unconfirmed' : 'plain'; }

/** The flags of a record in words (only those set). */
export function flagKeys(f: SourceRecord['flags']): SourcesKey[] {
  const k: SourcesKey[] = [];
  if (f.nonCommercial) k.push('sources.badge.nc');
  if (f.noDerivatives) k.push('sources.badge.nd');
  if (f.shareAlike) k.push('sources.badge.sa');
  if (f.licenceUnconfirmed) k.push('sources.badge.unconfirmed');
  return k;
}

/** The job's stage: a SourceJobProgress as JSON, or a bare stage word. Numbers only from the job; nothing is made up. */
export interface JobView { stage: string | null; bytes: number | null; total: number | null }
export function parseStage(stage: string | null | undefined): JobView {
  if (!stage) return { stage: null, bytes: null, total: null };
  try {
    const j = JSON.parse(stage) as { stage?: unknown; bytes?: unknown; total?: unknown };
    if (j && typeof j === 'object') return { stage: typeof j.stage === 'string' ? j.stage : null, bytes: typeof j.bytes === 'number' ? j.bytes : null, total: typeof j.total === 'number' ? j.total : null };
  } catch { /* a bare word */ }
  return { stage, bytes: null, total: null };
}
export const percentOf = (v: JobView): number | null => (v.bytes != null && v.total && v.total > 0 ? Math.min(100, Math.floor((v.bytes / v.total) * 100)) : null);
export const sizeText = (n: number): string => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
export const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'cancelled']);

/** Grid movement: the next active index for a key (dir-aware), or null when the key is not a movement. */
export function gridNext(i: number, key: string, count: number, dir: 'ltr' | 'rtl'): number | null {
  if (count === 0) return null;
  const fwd = key === 'ArrowDown' || key === (dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
  const back = key === 'ArrowUp' || key === (dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft');
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (fwd) return Math.min(count - 1, i + 1);
  if (back) return Math.max(0, i - 1);
  return null;
}
/** The remaining-searches line (C9): only when the service counts. */
export const remainingLine = (lang: Lang, r: { count: number; perSeconds: number } | null | undefined): string | null => (r ? sx(lang, 'sources.remaining', { n: r.count }) : null);

/** The warnings the asset line shows, from the record alone (the server's export warnings are separate): the flags the record carries. */
export function recordWarnings(r: Pick<SourceRecord, 'licence' | 'flags' | 'title'>): SourceWarning[] {
  const base = { licenceId: r.licence.id, licenceName: r.licence.name || r.licence.id, title: r.title, message: '' };
  const w: SourceWarning[] = [];
  if (r.flags.noDerivatives) w.push({ ...base, code: 'licence_no_derivatives', termIds: [LICENCE_WARNING_TERMS.licence_no_derivatives!] });
  if (r.flags.shareAlike) w.push({ ...base, code: 'licence_share_alike', termIds: [LICENCE_WARNING_TERMS.licence_share_alike!] });
  if (r.flags.licenceUnconfirmed && r.licence.id === 'unknown') w.push({ ...base, code: 'licence_unknown', termIds: [] });
  else if (r.flags.licenceUnconfirmed) w.push({ ...base, code: 'licence_unconfirmed', termIds: [] });
  return w;
}
/** Only an http(s) page is linked. */
export const safePageUrl = (u: string | undefined): string | null => { try { const x = new URL(u ?? ''); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };
/** The download limit line of «חיבורים»: at most the upload limit in effect; in open mode with none set (ADR-0036 I9) it says so. */
export function limitLine(lang: Lang, s: { maxDownloadBytes: number | null; maxUploadBytes: number | null; effectiveMaxBytes: number | null }): string {
  const cap = s.maxUploadBytes === null ? sx(lang, 'sources.connect.noUploadCap') : sx(lang, 'sources.connect.maxBytesHint', { max: sizeText(s.maxUploadBytes) });
  const now = s.maxDownloadBytes && s.effectiveMaxBytes !== null ? sx(lang, 'sources.connect.limitNow', { n: sizeText(s.effectiveMaxBytes) }) : sx(lang, 'sources.connect.noLimit');
  return `${cap}. ${now}`;
}
