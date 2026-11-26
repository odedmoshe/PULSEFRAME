/** The server mode's type, and the warn-instead-of-refuse predicate (autonomy.ts holds the rest), so config.ts and models.ts import nothing heavier. */
import { AUTONOMY_EN, AUTONOMY_HE } from '../../../packages/i18n/src/autonomy.ts';
export const SERVER_MODES = ['open', 'guarded'] as const;
export type ServerMode = (typeof SERVER_MODES)[number];
export const DEFAULT_SERVER_MODE: ServerMode = 'open';
export const parseMode = (v: unknown): ServerMode | undefined => (v === 'open' || v === 'guarded' ? v : undefined);

/**
 * THE warn-instead-of-refuse predicate (ADR-0036 "not yet opened" rows D1, D5, D6, D8, H1, H2, I9, I11; verifier C4). These rows
 * read the SERVER mode, not the principal: they applied to the owner too, so in open mode the owner and agents alike are warned
 * and the work goes ahead; in guarded mode every one refuses exactly as before. Read at admission (the live mode, config.ts
 * `liveMode`) and recorded on the job where there is one. autonomy.test.ts walks OPEN_GATES rows with `reads: 'mode'` to it.
 */
export const warnsOpen = (cfg: { mode: ServerMode; liveMode?: () => ServerMode }): boolean => (cfg.liveMode?.() ?? cfg.mode) === 'open';

export const OPEN_WARNING_CODES = ['host_not_listed', 'comfyui_remote', 'assistant_host_not_listed', 'egress', 'licence', 'licence_unknown', 'search_licence', 'upload_uncapped', 'script_long'] as const;
export type OpenWarningCode = (typeof OPEN_WARNING_CODES)[number];
/** What open mode did instead of refusing, in Hebrew and English (packages/i18n/src/autonomy.ts `autonomy.warn.*`), with its facts. */
export interface OpenWarning { code: OpenWarningCode; he: string; en: string; [fact: string]: string | number }
export function openWarning(code: OpenWarningCode, facts: Record<string, string | number>): OpenWarning {
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in facts ? String(facts[k]) : m));
  return { code, he: fill(AUTONOMY_HE[`autonomy.warn.${code}`]), en: fill(AUTONOMY_EN[`autonomy.warn.${code}`]), ...facts };
}
