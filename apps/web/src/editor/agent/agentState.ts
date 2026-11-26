/**
 * The pure part of the «סוכן» tab (wave 8 autonomy Part 2, builder W3): wording of a run's status with WHY on the same line, the
 * step counter, cost or tokens, «לא בוטל: …», the pictures a step listed, and how a failure is worded. No DOM here, so vitest reads
 * it directly (agentState.test.ts). Strings come from packages/i18n/src/agent.ts; nothing is invented that the server did not say.
 */
import { AGENT_PROVIDER_ERROR_CODES, AGENT_RUN_FINAL, AGENT_RUN_CONTINUABLE, AGENT_LIMITS, type AgentRun, type AgentRunStatus, type AgentStep, type NotUndoneItem, type UndoActorConflict } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';

export type Lang = 'he' | 'en';
/** The shape of a model table row the card reads (packages/providers AgentModelRow); the web app does not depend on that package. */
export interface ModelRow { providerId: string; id: string; label: string; priceInPerMTok: number | null; priceOutPerMTok: number | null; readAt: string; vision?: boolean; note?: string }

/** One string in a language with {placeholders} filled; a missing key shows the key itself (never a blank). */
export function tr(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const raw = (dictionaries[lang] as Record<string, string>)[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
export const hasKey = (lang: Lang, key: string): boolean => key in (dictionaries[lang] as Record<string, string>);

export const isActive = (s: AgentRunStatus): boolean => !AGENT_RUN_FINAL.includes(s);
export const canContinue = (s: AgentRunStatus): boolean => AGENT_RUN_CONTINUABLE.includes(s);
/** A run has something to undo when it is not running and not already undone. */
export const canUndo = (run: Pick<AgentRun, 'status' | 'undoneBy'>): boolean => !isActive(run.status) && !run.undoneBy;

/** «צעד N מתוך M» or «צעד N (ללא הגבלה)»: the model steps used, against the limit. */
export function counterLine(lang: Lang, run: Pick<AgentRun, 'stepsUsed' | 'stepLimit'>): string {
  return run.stepLimit === null ? tr(lang, 'agent.counterNoLimit', { n: run.stepsUsed }) : tr(lang, 'agent.counter', { n: run.stepsUsed, limit: run.stepLimit });
}

/** US dollars from cents with enough digits to be honest about small sums (never rounded to a flattering zero). */
export function dollars(cents: number): string {
  const d = cents / 100;
  if (d === 0) return '0.00';
  if (d >= 1) return d.toFixed(2);
  const s = d.toFixed(4).replace(/0+$/, '');
  return s.split('.')[1]!.length < 2 ? `${s}0` : s;
}

/** Cost when any model call was priced from the table, else the tokens; plus the calls whose answer was lost (cost unknown). */
export function costLines(lang: Lang, run: Pick<AgentRun, 'spentCents' | 'tokens' | 'unknownCostCalls'>, steps: readonly Pick<AgentStep, 'model'>[]): string[] {
  const priced = steps.some((s) => s.model && s.model.cost.cents !== null);
  const out = [priced ? tr(lang, 'agent.cost', { cost: dollars(run.spentCents) }) : tr(lang, 'agent.tokens', { tokens: (run.tokens.input + run.tokens.output).toLocaleString(lang === 'he' ? 'he-IL' : 'en-US') })];
  if (run.unknownCostCalls > 0) out.push(tr(lang, 'agent.costUnknown', { count: run.unknownCostCalls }));
  return out;
}

/** The status word and WHY it is that way, to sit on one line (verifier C16). */
export function statusWords(lang: Lang, run: Pick<AgentRun, 'status' | 'stopReason' | 'stepLimit'>, steps: readonly Pick<AgentStep, 'kind' | 'note'>[] = []): { status: string; why: string } {
  const status = tr(lang, `agent.status.${run.status}`);
  let why = '';
  if (run.stopReason) why = tr(lang, `agent.stop.${run.stopReason}`, { limit: run.stepLimit ?? '' });
  else if (run.status === 'waiting') { const note = [...steps].reverse().find((s) => s.kind === 'note' && s.note); why = note?.note ? note.note.text : tr(lang, 'agent.note.paused'); }
  return { status, why };
}

export interface LookedFrame { frame: number; revision: number; sequenceId?: string; variantId?: string }
/**
 * The pictures a step looked at, read from the editor's own answer (mcp.ts): render_frame `{revision, frameIndex, sequenceId?,
 * variantId?}`, render_contact_sheet `{revision, frames: [...]}`. Read by pattern, so a summary cut short still names them.
 */
export function framesOf(tool: string | null | undefined, summary: string | null): LookedFrame[] {
  if (!summary || (tool !== 'render_frame' && tool !== 'render_contact_sheet')) return [];
  const rev = /"revision"\s*:\s*(\d+)/.exec(summary);
  if (!rev) return [];
  const revision = Number(rev[1]);
  if (tool === 'render_contact_sheet') {
    const list = /"frames"\s*:\s*\[([\d,\s]*)\]/.exec(summary);
    return list ? list[1]!.split(',').map((x) => x.trim()).filter(Boolean).map((x) => ({ frame: Number(x), revision })) : [];
  }
  const idx = /"frameIndex"\s*:\s*(\d+)/.exec(summary);
  if (!idx) return [];
  const seq = /"sequenceId"\s*:\s*"([^"]+)"/.exec(summary);
  const variant = /"variantId"\s*:\s*"([^"]+)"/.exec(summary);
  return [{ frame: Number(idx[1]), revision, ...(seq ? { sequenceId: seq[1]! } : {}), ...(variant ? { variantId: variant[1]! } : {}) }];
}

/** The arguments of a call as pretty text (the model's own object; a string is shown as it is). */
export function prettyInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try { return JSON.stringify(input ?? {}, null, 2); } catch { return String(input); }
}

/** «לא בוטל: …»: one line per class (the item list of summarizeNotUndone), with the sums the server computed. */
export function notUndoneTexts(lang: Lang, items: readonly NotUndoneItem[]): { kind: string; text: string }[] {
  return items.map((it) => {
    if (it.kind === 'money_spent') return { kind: it.kind, text: it.cents === null || it.cents === undefined ? tr(lang, 'agent.notUndone.money_unpriced', { count: it.count }) : tr(lang, 'agent.notUndone.money_spent', { cost: dollars(it.cents) }) };
    if (it.kind === 'data_sent') return { kind: it.kind, text: tr(lang, 'agent.notUndone.data_sent', { provider: it.providerId ?? '' }) };
    return { kind: it.kind, text: tr(lang, `agent.notUndone.${it.kind}`, { count: it.count }) };
  });
}

export function conflictText(lang: Lang, c: UndoActorConflict): string {
  return tr(lang, 'agent.undoConflictItem', { entity: c.entityId, revision: c.changedAtRevision, by: c.by });
}
/** The conflicts a 409 undo_conflict carries in its details (answer shape of UndoAllAnswer, or a bare list); [] when it has none. */
export function conflictsOf(details: unknown): UndoActorConflict[] {
  const list = Array.isArray(details) ? details : (details as { conflicts?: unknown } | null | undefined)?.conflicts;
  if (!Array.isArray(list)) return [];
  return list.filter((c): c is UndoActorConflict => !!c && typeof c === 'object' && typeof (c as UndoActorConflict).entityId === 'string');
}

/** How a failed call reads: owner floor, a worded error code, else the server's own message (never silent). */
export function failureText(lang: Lang, e: { status?: number; code?: string; message?: string }): string {
  if (e.code === 'owner_required') return tr(lang, 'agent.connect.ownerOnly');
  if (e.code && hasKey(lang, `error.code.${e.code}`)) return tr(lang, `error.code.${e.code}`);
  return e.message || tr(lang, 'agent.runLoadFailed');
}

/** The worded answer of «בדיקה»: ok, a provider failure code (agent.provider.*), bad_config, or an unknown code. */
export function probeText(lang: Lang, answer: { ok: boolean; code: string | null; model: string | null }): string {
  if (answer.ok) return `${tr(lang, 'agent.connect.probeOk')}${answer.model ? ` · ${answer.model}` : ''}`;
  const code = answer.code ?? '';
  if ((AGENT_PROVIDER_ERROR_CODES as readonly string[]).includes(code)) return tr(lang, `agent.provider.${code}`, { seconds: '' }).replace(/\s+\./g, '.');
  if (code === 'bad_config') return tr(lang, 'agent.probe.bad_config');
  return tr(lang, 'agent.probe.unknown');
}

/** The model rows of one provider from the table. */
export function rowsOf(rows: readonly ModelRow[], providerId: string): ModelRow[] { return rows.filter((r) => r.providerId === providerId); }
/** The distinct dates a provider's rows were read. */
export function readDates(rows: readonly ModelRow[]): string[] { return [...new Set(rows.map((r) => r.readAt))]; }
export function priceText(lang: Lang, r: ModelRow): string {
  return r.priceInPerMTok === null || r.priceOutPerMTok === null ? tr(lang, 'agent.connect.noPrice') : `$${r.priceInPerMTok} / $${r.priceOutPerMTok} (1M)`;
}
/** Keep only well-formed rows of the untyped table answer. */
export function modelRows(raw: readonly unknown[]): ModelRow[] {
  return raw.filter((r): r is ModelRow => !!r && typeof r === 'object' && typeof (r as ModelRow).providerId === 'string' && typeof (r as ModelRow).id === 'string' && typeof (r as ModelRow).readAt === 'string');
}

/** The run to show on open: the active one, else the newest (the list is newest first). */
export function pickRun<R extends Pick<AgentRun, 'status'>>(runs: readonly R[]): R | null { return runs.find((r) => isActive(r.status)) ?? runs[0] ?? null; }

export const CONTINUE_STEPS = AGENT_LIMITS.continueSteps;
