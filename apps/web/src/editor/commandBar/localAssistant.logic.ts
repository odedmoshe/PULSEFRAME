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
import { fill } from './commandBar.strings.ts';

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
 * Words of this builder (the shared strings file is not in this track's files; commandBar.strings.ts holds the pre-pass words).
 * Every one pairs what happened with what to do; none says anything about how well the assistant understands. Hebrew first.
 */
export const LOCAL_TEXT_HE = {
  'set.what': 'מה נשלח ולאן',
  'set.whatSent': 'נשלח לעוזר המקומי רק המשפט שהקלדתם בשורה, בלי כלום מהפרויקט: לא קליפים, לא שמות, לא כיתובים ולא תמונות.',
  'set.runsHere': 'המודל פועל רק על המחשב הזה. העורך פונה אליו רק בכתובת {address} ביציאה שבחרתם, ואין שדה שמקבל כתובת אחרת.',
  'set.noHost': 'אין כאן כתובת להקלדה: רק מספר יציאה.',
  'set.local.saveFirst': 'שמרו את ההגדרות ואז בדקו: הבדיקה פונה ליציאה שנשמרה',
  'set.local.notChecked': 'עוד לא נבדק',
  'set.local.checkFailed': 'הבדיקה לא הצליחה: {reason}',
  'set.local.stateLabel': 'מצב',
  'set.local.guideLine': 'המדריך «עוזר שפה מקומי» (הקובץ docs/guides/assistant-local.he.md) מסביר איך מפעילים אותו ואיך עוצרים אותו',
  'set.local.pickHint': 'בחרו «מודל מקומי על המחשב הזה» כדי להשתמש בעוזר שרץ אצלכם',
  'row.local.groupLabel': 'העוזר המקומי',
  'row.local.canceledUnsent': 'הבקשה בוטלה לפני שנשלחה לעוזר המקומי; אפשר לבקש שוב מתי שרוצים',
  'row.local.canceledSent': 'הבקשה בוטלה בזמן שהעוזר המקומי ענה, ושום דבר לא יצא מהמחשב; אפשר לבקש שוב מתי שרוצים',
  'row.local.canceling': 'מבטל…',
  'row.local.inserted': 'ההצעה נכנסה לשורה. בדקו את התצוגה שמתחת ולחצו Enter כדי להחיל, או ערכו את השורה',
  'row.local.ignored': 'ההצעה הוסרה; השורה נשארה כמו שהקלדתם',
  'row.local.takenFailed': 'ההצעה נכנסה לשורה, אבל לא הצלחנו למחוק אותה מהשרת; פתחו את השורה שוב אחרי שהעורך מתחבר מחדש',
  'row.local.understoodByBar': 'שורת הפקודות מבינה את הבקשה בעצמה, ולכן היא לא נשלחת לעוזר המקומי',
  'row.local.ownerOnly': 'העוזר המקומי זמין רק למי שהעורך פתוח אצלו כבעלים',
} as const;
export type LocalTextKey = keyof typeof LOCAL_TEXT_HE;
export const LOCAL_TEXT_EN: Record<LocalTextKey, string> = {
  'set.what': 'What is sent, and where',
  'set.whatSent': 'Only the sentence you typed in the bar is sent to the local assistant, with nothing from the project: no clips, names, titles or pictures.',
  'set.runsHere': 'The model runs only on this computer. The editor calls it only at {address}, on the port you choose, and no field takes any other address.',
  'set.noHost': 'There is no address to type here: only a port number.',
  'set.local.saveFirst': 'Save the settings, then check: the check calls the saved port',
  'set.local.notChecked': 'Not checked yet',
  'set.local.checkFailed': 'The check did not work: {reason}',
  'set.local.stateLabel': 'State',
  'set.local.guideLine': 'The guide «Local language assistant» (the file docs/guides/assistant-local.he.md) explains how to start it and how to stop it',
  'set.local.pickHint': 'Choose «A local model on this computer» to use the assistant that runs on your machine',
  'row.local.groupLabel': 'The local assistant',
  'row.local.canceledUnsent': 'The request was canceled before it was sent to the local assistant; ask again whenever you like',
  'row.local.canceledSent': 'The request was canceled while the local assistant was answering, and nothing left this computer; ask again whenever you like',
  'row.local.canceling': 'Canceling…',
  'row.local.inserted': 'The suggestion is in the bar. Check the preview below and press Enter to apply it, or edit the line',
  'row.local.ignored': 'The suggestion was removed; the bar keeps what you typed',
  'row.local.takenFailed': 'The suggestion is in the bar, but it could not be erased on the server; open the bar again once the editor reconnects',
  'row.local.understoodByBar': 'The command bar understands this request itself, so it is not sent to the local assistant',
  'row.local.ownerOnly': 'The local assistant is available only to the owner\'s own session',
};
export const localText = (lang: Lang, key: LocalTextKey, vars?: Record<string, string | number>): string => fill(lang === 'he' ? LOCAL_TEXT_HE[key] : LOCAL_TEXT_EN[key], vars);
