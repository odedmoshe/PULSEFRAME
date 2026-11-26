/**
 * The LOCAL language assistant in the editor (wave 7; .artifacts/wave7/assistant-decisions.md §4): pure logic for the Settings section
 * and the row (builder C). The row is offered ONLY under a grammar result of kind 'unknown' (the grammar first; the server refuses
 * anything else with 409 grammar_understood). «הכנס לשורה» sets the bar's input to the phrase (caret at the end), shows the badge until
 * the first edit, and calls POST /assistant/jobs/:jobId/taken; «התעלם» calls taken too. The phrase goes through the bar's own
 * interpret → preview → Enter → commitExact; nothing is committed from the row itself. The phrase is shown in ONE dir="auto" span,
 * never concatenated. Nothing in these words says the assistant understands well or is accurate: nobody has measured it.
 */
import { ASSISTANT_LOCAL_ADAPTER_ID, ASSISTANT_LOCAL_DEFAULTS, AssistantLocalConfigSchema, isLocalOutput, type AssistantLocalConfig, type AssistantLocalOutput, type BarResultKind } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { barText, type BarTextKey } from './commandBar.strings.ts';

export const LOCAL_UI_BUILT = true;
/** The only address the editor ever calls, shown to the owner as words (never a field). */
export const LOCAL_ADDRESS = '127.0.0.1';
export const LOCAL_PORT_MIN = 1024;
export const LOCAL_PORT_MAX = 65535;
export const LOCAL_TIMEOUT_MIN = 5;
export const LOCAL_TIMEOUT_MAX = 600;
export const isLocalAdapter = (adapter: string | null | undefined): boolean => adapter === ASSISTANT_LOCAL_ADAPTER_ID;

/** The row's state, from the bar's result and the local job (null = no request yet). */
export type LocalRowState =
  | { kind: 'hidden' } | { kind: 'offer' } | { kind: 'pending'; stage: string | null }
  | { kind: 'suggested'; jobId: string; phrase: string; intent: string; dropped: boolean }
  | { kind: 'none'; jobId: string } | { kind: 'failed'; code: string; message: string } | { kind: 'canceled'; sent: boolean };

type LocalJob = { id: string; status: string; stage: string | null; output: unknown; error: unknown; attempt?: number | null };

export function canInsert(o: AssistantLocalOutput | null): boolean {
  return !!o && o.kind === 'local-intent' && o.cleared !== true && o.intent !== 'none' && typeof o.phrase === 'string' && o.phrase.trim() !== '';
}

export function localRowState(barKind: BarResultKind | null, job: LocalJob | null): LocalRowState {
  if (!job) return barKind === 'unknown' ? { kind: 'offer' } : { kind: 'hidden' };
  switch (job.status) {
    case 'queued': case 'running': case 'cancel-requested': return { kind: 'pending', stage: job.stage };
    case 'canceled': return { kind: 'canceled', sent: (job.attempt ?? 0) > 0 };
    case 'succeeded': {
      if (!isLocalOutput(job.output)) return { kind: 'failed', code: 'invalid_model_output', message: '' };
      const o = job.output;
      if (canInsert(o)) return { kind: 'suggested', jobId: job.id, phrase: o.phrase!, intent: o.intent, dropped: o.dropped.length > 0 };
      return { kind: 'none', jobId: job.id };
    }
    default: {
      const e = (job.error && typeof job.error === 'object' ? job.error : {}) as { code?: unknown; message?: unknown };
      return { kind: 'failed', code: typeof e.code === 'string' ? e.code : 'local_server_error', message: typeof e.message === 'string' ? e.message : '' };
    }
  }
}

/** The Settings fields as typed → the config's `local`, or "not valid" (the words: set.local.invalid). Whole decimal digits only: no host, no sign, no fraction. */
export function parseLocalSettings(port: string, timeoutSeconds: string): { ok: true; local: AssistantLocalConfig } | { ok: false } {
  const whole = (s: string): number | null => (/^[0-9]{1,6}$/.test(s.trim()) ? Number(s.trim()) : null);
  const p = whole(port), t = whole(timeoutSeconds);
  if (p === null || t === null) return { ok: false };
  const r = AssistantLocalConfigSchema.safeParse({ port: p, timeoutSeconds: t });
  return r.success ? { ok: true, local: r.data } : { ok: false };
}
/** The fields' starting text: what is saved, else the defaults (8791, 60 s). */
export const localFormOf = (local: { port: number; timeoutSeconds: number } | null | undefined): { port: string; timeout: string } =>
  ({ port: String(local?.port ?? ASSISTANT_LOCAL_DEFAULTS.port), timeout: String(local?.timeoutSeconds ?? ASSISTANT_LOCAL_DEFAULTS.timeoutSeconds) });

/**
 * The words of this builder live in the command bar's strings (commandBar.strings.ts BAR_HE / BAR_EN, keys `set.local.*` and
 * `row.local.*`; moved there at integration so the strings' parity test covers them). Every one pairs what happened with what to do;
 * none says anything about how well the assistant understands, none speaks of money (localAssistant.test.ts).
 */
export const LOCAL_TEXT_KEYS = ['set.local.what', 'set.local.whatSent', 'set.local.runsHere', 'set.local.noHost', 'set.local.saveFirst', 'set.local.notChecked', 'set.local.checkFailed', 'set.local.stateLabel', 'set.local.guideLine', 'set.local.pickHint', 'row.local.groupLabel', 'row.local.canceledUnsent', 'row.local.canceledSent', 'row.local.canceling', 'row.local.inserted', 'row.local.ignored', 'row.local.takenFailed', 'row.local.understoodByBar', 'row.local.ownerOnly'] as const satisfies readonly BarTextKey[];
export type LocalTextKey = (typeof LOCAL_TEXT_KEYS)[number];
export const localText = (lang: Lang, key: LocalTextKey, vars?: Record<string, string | number>): string => barText(lang, key, vars);
