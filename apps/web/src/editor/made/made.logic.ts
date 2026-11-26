/**
 * Pure logic of «קליפ מקוד» (wave 8 motioncode, W3): the request from the dialog's draft, field checks, the progress line, polling the
 * job at most every 2 s, the report's check and warning lines (numbers kept as parts, drawn in <bdi dir="ltr">), clips that show a file.
 * No DOM; tested in made.logic.test.ts against a labelled fake fetch.
 */
import { MADE_LIMITS, type MadeField, type MadeJobReport, type MadeRecord, type MadeRenderRequest, type MadeTemplateInfo, type ProjectDocument } from '@pulseframe/core';
import { translateRefusal, type Lang } from '@pulseframe/i18n';
import { madeParts, madeT, type MadeVars, type Part } from './made.strings.ts';

export const POLL_MS = 2000;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Initial values of a page's fields: the sample in the interface language, else the default. */
export function initialValues(fields: readonly MadeField[], samples?: Record<string, string>): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of fields) v[f.key] = samples?.[f.key] ?? f.default;
  return v;
}
export function templateValues(t: MadeTemplateInfo, lang: Lang): Record<string, string> { return initialValues(t.fields, t.samples?.[lang]); }

/** Why a value does not fit its field (a words key and vars for `ui.invalid*`), or null. */
export function fieldProblem(f: MadeField, value: string): { key: string; vars: MadeVars } | null {
  if (f.kind === 'colour') return HEX.test(value) ? null : { key: 'ui.invalidColour', vars: {} };
  if (f.kind === 'number') {
    const n = Number(value);
    const min = f.min ?? -1e9, max = f.max ?? 1e9;
    return value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? null : { key: 'ui.invalidNumber', vars: { min, max } };
  }
  const max = f.maxLength ?? MADE_LIMITS.valueChars;
  return value.length <= max ? null : { key: 'ui.invalidLong', vars: { max } };
}
export function fieldProblems(fields: readonly MadeField[], values: Record<string, string>, lang: Lang): string[] {
  const t = madeT(lang);
  const out: string[] = [];
  for (const f of fields) {
    const p = fieldProblem(f, values[f.key] ?? '');
    if (p) out.push(t('ui.invalid', { label: f.label[lang], why: t(p.key, p.vars) }));
  }
  return out;
}

export type PageSource = { kind: 'template'; template: MadeTemplateInfo } | { kind: 'page'; text: string; fields: MadeField[] };
export interface Draft { source: PageSource; values: Record<string, string>; seconds: number; paste: string; lang: Lang }

/** The render request of a draft. A non-empty pasted page wins over the tile; the fields of the tile ride along only for the tile's own page. */
export function buildRequest(d: Draft, assetIds?: string[]): MadeRenderRequest {
  const t = madeT(d.lang);
  const pasted = d.paste.trim() ? d.paste : null;
  const fields = d.source.kind === 'template' ? d.source.template.fields : d.source.fields;
  const useFields = !pasted || d.source.kind === 'page';
  const values: Record<string, string> = {};
  if (useFields) for (const f of fields) values[f.key] = d.values[f.key] ?? f.default;
  const name = d.source.kind === 'template' && !pasted ? d.source.template.name[d.lang] : t('ui.nameFallback');
  return {
    page: pasted ?? (d.source.kind === 'template' ? { templateId: d.source.template.id } : d.source.text),
    ...(useFields && fields.length ? { fields, values } : {}),
    seconds: d.seconds, name: name.slice(0, 80),
    ...(assetIds?.length ? { assetIds } : {}),
  };
}

/** Whole-second choices of the length select (1 to the limit), with the wanted value added when it is between. */
export function lengthChoices(current: number): number[] {
  const s = new Set<number>();
  for (let i = 1; i <= MADE_LIMITS.maxSeconds; i++) s.add(i);
  s.add(current);
  return [...s].sort((a, b) => a - b);
}
export const secondsLabel = (n: number): string => String(Math.round(n * 100) / 100);

/** The progress line: «מצייר פריים k מתוך n» while drawing, the stage's own word otherwise. */
export function progressParts(r: MadeJobReport | null, lang: Lang): Part[] {
  if (!r) return madeParts(lang, 'ui.starting', {});
  if (r.stage === 'drawing' && r.progress) return madeParts(lang, 'progress', { k: Math.min(r.progress.frames, Math.max(1, r.progress.frame)), n: r.progress.frames });
  if (r.stage === 'encoding') return madeParts(lang, 'stage.encoding', {});
  if (r.stage === 'checking-file') return madeParts(lang, 'stage.checking', {});
  if (r.stage === 'fetching') return madeParts(lang, 'stage.fetching', {});
  return madeParts(lang, 'ui.starting', {});
}
export const partsText = (p: Part[]): string => p.map((x) => ('text' in x ? x.text : x.num)).join('');

export interface PollDeps {
  report: () => Promise<MadeJobReport>;
  sleep: (ms: number) => Promise<void>;
  onReport: (r: MadeJobReport) => void;
  stopped: () => boolean;
}
/** Poll the job: one question at once, at least POLL_MS apart, until it is succeeded, failed or canceled (or `stopped`). */
export async function pollMade(d: PollDeps): Promise<MadeJobReport | null> {
  for (;;) {
    if (d.stopped()) return null;
    const r = await d.report();
    if (d.stopped()) return null;
    d.onReport(r);
    if (r.status === 'succeeded' || r.status === 'failed' || r.status === 'canceled') return r;
    await d.sleep(POLL_MS);
  }
}

// ---------------------------------------------------------------- the report's lines
export interface Line { key: string; vars: MadeVars }
const fmt = (n: number) => String(Math.round(n * 100) / 100);
/** The measured numbers of a record as check lines: determinism, flashes, transparency, the time of one sample, a missing sandbox. */
export function checkLines(rec: MadeRecord, seconds: number | undefined, lang: Lang): { key: string; parts: Part[] }[] {
  const out: { key: string; parts: Part[] }[] = [];
  const add = (key: string, vars: MadeVars = {}) => out.push({ key, parts: madeParts(lang, key, vars) });
  add('check.determinism', { frames: rec.checks.determinism.frames.join(', ') });
  add('check.flash', { black: fmt(rec.checks.flash.black.general), white: fmt(rec.checks.flash.white.general) });
  add(rec.checks.alpha ? 'check.alpha.yes' : 'check.alpha.no');
  if (seconds !== undefined) add('check.time', { s: fmt(seconds) });
  if (rec.sandbox === 'none') add('check.sandbox.none');
  return out;
}

/** The highest measured flash rate and where (black or white), when above the limit; the numbers come from the record. */
export function flashOver(rec: MadeRecord): { rate: number; on: 'black' | 'white' } | null {
  const b = rec.checks.flash.black.general, w = rec.checks.flash.white.general;
  const on = b >= w ? 'black' : 'white';
  const rate = Math.max(b, w);
  return rate > MADE_LIMITS.flashPerSecond ? { rate, on } : null;
}

/** Variables of a warning or failure, read from the server's English message (core madeContract.ts wording); null when it does not fit. */
const WARN_RE: Record<string, RegExp> = {
  made_flash: /flashes (?<rate>[\d.]+) times a second \(measured on (?<on>black|white)\)/,
  made_clock: /\((?<api>.+)\) at frame (?<frame>\d+)/,
  made_static: /uses (?<what>.+) \(at character (?<at>\d+)\)/,
  made_font_missing: /the font (?<family>.+) is not in the catalogue/,
  made_webgl_differs: /drew (?<pixels>\d+) pixels differently the second time \(frame (?<frame>\d+)\)/,
};
const FAIL_RE: Record<string, RegExp> = {
  made_frame_timeout: /frame (?<frame>\d+) within (?<s>[\d.]+) seconds/,
  made_job_timeout: /longer than (?<m>[\d.]+) minutes/,
  made_decode_back: /\(frame (?<frame>\d+) differs/,
  made_frame_count: /has (?<got>\d+) frames instead of (?<want>\d+)/,
  made_not_deterministic: /frame (?<frame>\d+) differently/,
  made_fetch_failed: /internet file (?<url>\S+) could not/,
};
/** The contract types `why` as the table KEY (flash, noSandbox) while its rows carry the code (made_flash): both are accepted. */
const CODE: Record<string, string> = { flash: 'made_flash', noSandbox: 'made_no_sandbox', clock: 'made_clock', staticHit: 'made_static', fontMissing: 'made_font_missing', webglDiffers: 'made_webgl_differs',
  frameTimeout: 'made_frame_timeout', crashed: 'made_crashed', jobTimeout: 'made_job_timeout', empty: 'made_empty', decodeBack: 'made_decode_back', frameCount: 'made_frame_count', notDeterministic: 'made_not_deterministic', navigated: 'made_navigated', fetchFailed: 'made_fetch_failed', restarted: 'made_restarted', canceled: 'made_canceled' };
const codeOf = (why: string): string => CODE[why] ?? why;
function line(prefix: 'warn' | 'fail', why0: string, message: string, lang: Lang, at?: number): string {
  const why = codeOf(why0);
  const t = madeT(lang);
  const re = (prefix === 'warn' ? WARN_RE : FAIL_RE)[why];
  const g = re?.exec(message)?.groups;
  const vars: MadeVars = { ...(g ?? {}) };
  if (g?.on) vars.on = t(`on.${g.on}`);
  if (!g && at !== undefined) { vars.frame = at; vars.at = at; }
  const key = `${prefix}.${why}`;
  const known = madeT(lang)(key) !== key;
  if (!known) return message;
  const out = t(key, vars);
  return /\{\w+\}/.test(out) ? message : out;
}
export const warningText = (w: MadeJobReport['warnings'][number], lang: Lang): string => line('warn', w.why, w.message, lang, w.at);
export function failureText(f: NonNullable<MadeJobReport['failure']>, lang: Lang): string { return line('fail', f.why, f.message, lang); }

/** Warning lines of a finished report: the server's list, the sandbox one dropped when the check lines already say it. */
export function warningLines(r: MadeJobReport, lang: Lang, fromRender: { what: string; at: number }[] = []): string[] {
  const out = r.warnings.filter((w) => !(codeOf(w.why) === 'made_no_sandbox' && r.record?.sandbox === 'none')).map((w) => warningText(w, lang));
  for (const w of fromRender) { const s = `${w.what} (${w.at})`; if (!out.includes(s)) out.push(s); }
  return out;
}

/** The text of a failed call: the server's refusal in Hebrew when it has one (each carries the next step), else its own words and hint. */
export function errorText(e: unknown, lang: Lang): string {
  const m = e instanceof Error ? e.message : String(e);
  const hint = (e as { hint?: string })?.hint;
  return translateRefusal(lang, m) ?? (hint ? `${m}. ${hint}` : m);
}

/** How many clips of the document show a file (all sequences): the N of «עדכון בכל המקומות (N)». */
export function clipsUsing(doc: Pick<ProjectDocument, 'sequences'>, assetId: string): number {
  let n = 0;
  for (const s of Object.values(doc.sequences)) for (const tr of s.tracks) for (const c of tr.clips) if (c.type === 'media' && c.assetId === assetId) n++;
  return n;
}
