/**
 * «התקנת מנוע הדיבור»: the server's fixed English stage lines (apps/server/src/speechEngine.ts ENGINE_STAGES) and failure codes in
 * words. Pure functions; engineInstall.logic.test.ts pins every stage line and every failure code.
 */
import { ENGINE_STRINGS } from './engineInstall.strings.ts';

type Lang = keyof typeof ENGINE_STRINGS;
export type FailureCode = keyof (typeof ENGINE_STRINGS)['he']['failures'];
export type RefusalCode = keyof (typeof ENGINE_STRINGS)['he']['refusals'];
/** The four steps the owner sees counted (finding Python counts with creating the environment). */
const STEPS = 4;

export function stageWords(stage: string | null, lang: Lang): { text: string; step: number | null; done: number | null; total: number | null } {
  const S = ENGINE_STRINGS[lang].stages;
  if (!stage) return { text: S.other, step: null, done: null, total: null };
  const dl = /^downloading (\d+) of (\d+) files$/.exec(stage);
  if (dl) return { text: S.download({ done: dl[1]!, total: dl[2]! }), step: 2, done: Number(dl[1]), total: Number(dl[2]) };
  const fixed: Record<string, [string, number | null]> = {
    'finding Python': [S.python, 1], 'creating the environment': [S.venv, 1], installing: [S.install, 3], 'checking the engine': [S.check, 4], 'removing the unfinished environment': [S.removing, null],
  };
  const f = fixed[stage];
  if (f) return { text: f[0], step: f[1], done: null, total: null };
  if (stage.startsWith('queued')) return { text: S.queued, step: null, done: null, total: null };
  return { text: S.other, step: null, done: null, total: null };
}
export const stepWords = (step: number, lang: Lang) => ENGINE_STRINGS[lang].step({ n: String(step), of: String(STEPS) });

const mb = (bytes: number) => String(Math.round(bytes / 1e6));
const size = (bytes: unknown) => (typeof bytes === 'number' && Number.isFinite(bytes) ? `${(bytes / 1e6).toFixed(0)} MB` : '');
export const downloadMb = mb;

/** A failed job's error in words: what happened and the next step, plus pip's or the probe's scrubbed last lines when there are any. */
export function failureWords(error: { code?: string; details?: Record<string, unknown> } | null | undefined, lang: Lang): { what: string; next: string; lines: string | null } {
  const F = ENGINE_STRINGS[lang].failures as Record<string, { what: (v: Record<string, string>) => string; next: () => string }>;
  const d = error?.details ?? {};
  const code = error?.code && F[error.code] ? error.code : 'internal_error';
  const vars: Record<string, string> = {
    found: String(d.found ?? ''), min: String(d.min ?? ''), max: String(d.max ?? ''), direction: String(d.direction ?? ''),
    need: size(d.neededBytes), free: size(d.freeBytes), hashMismatch: String(d.hashMismatch === true),
  };
  return { what: F[code]!.what(vars), next: F[code]!.next(), lines: typeof d.tail === 'string' && d.tail.trim() ? d.tail : null };
}
/** A refused start (an API error code) in words. */
export function refusalWords(code: string | undefined, lang: Lang): string {
  const R = ENGINE_STRINGS[lang].refusals as Record<string, string>;
  return (code && R[code]) || R.other!;
}
