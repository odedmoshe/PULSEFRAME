/**
 * The pure logic of the booth dialog (wave 8 booth, builder W3): the queue and its order, the progress words, the keys, the rows of the
 * self-check and what they say, the answer body, the report box. No React, no DOM, no storage access here (booth.state.ts holds those).
 */
import {
  BOOTH_CHECKS, BOOTH_FIRST_GROUPS, BOOTH_FIRST_SITTING_CARDS, BOOTH_GROUPS, BOOTH_LIMITS, BoothCheckRowSchema, BoothNotBuiltError, boothFirstOrder, boothReport,
  type BoothAnswer, type BoothAnswerBody, type BoothCheckRow, type BoothGroup, type BoothItemView, type BoothReportInput, type BoothSay, type BoothView, type BoothVerdict,
} from '@pulseframe/core';
import type { BoothAnswerExtras } from './booth.contract.ts';

// ---------------------------------------------------------------------------------------------------------------------- the queue
export type QueueEntry = { t: 'card'; id: string; group: BoothGroup } | { t: 'windows' };
/** A part of the sitting: a card group, or the Windows step on its own. */
export const entryPart = (e: QueueEntry): string => (e.t === 'windows' ? 'windows' : e.group);
const FIRST_GROUP_OF = { transitions: 'first.gpu-new', music: 'first.music', mic: 'first.mic' } as const;
const isFirstGroup = (g: BoothGroup) => (BOOTH_FIRST_GROUPS as readonly BoothGroup[]).includes(g);

/**
 * Inside a group: unanswered and changed first (their own order), then skipped (oldest answer first), answered last (their own order).
 * Order is decided when a sitting starts and kept while it runs, so a card does not move under the owner when it is answered.
 */
export function orderWithinGroup(views: readonly BoothItemView[]): BoothItemView[] {
  const rank = (v: BoothItemView) => (v.state !== 'answered' ? 0 : v.answer?.verdict === 'skip' ? 1 : 2);
  return views.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || (rank(a.v) === 1 ? (a.v.answer?.at ?? '').localeCompare(b.v.answer?.at ?? '') : 0) || a.i - b.i).map((x) => x.v);
}

/** The queue of a sitting: the first part in boothFirstOrder(row browser-gpu), the Windows step where the order puts it, the `more.*` groups only when asked for. */
export function buildQueue(items: readonly BoothItemView[], browserGpu: Pick<BoothCheckRow, 'state' | 'data'> | null | undefined, includeMore: boolean): QueueEntry[] {
  const inGroup = (g: BoothGroup) => orderWithinGroup(items.filter((v) => v.item.group === g)).map((v): QueueEntry => ({ t: 'card', id: v.item.id, group: g }));
  const out: QueueEntry[] = [];
  for (const step of boothFirstOrder(browserGpu)) {
    if (step === 'windows-gpu-setting') out.push({ t: 'windows' });
    else out.push(...inGroup(FIRST_GROUP_OF[step]));
  }
  if (includeMore) for (const g of BOOTH_GROUPS) if (!isFirstGroup(g)) out.push(...inGroup(g));
  return out;
}
/** Where a sitting starts: the first card that is not answered, else the first. */
export function startIndex(queue: readonly QueueEntry[], items: readonly BoothItemView[]): number {
  const byId = new Map(items.map((v) => [v.item.id, v]));
  const i = queue.findIndex((e) => e.t === 'card' && byId.get(e.id)?.state !== 'answered');
  return i < 0 ? 0 : i;
}
/** The first entry of the next part after `at`, or null. */
export function nextPartIndex(queue: readonly QueueEntry[], at: number): number | null {
  const here = queue[at];
  if (!here) return null;
  for (let i = at + 1; i < queue.length; i++) if (entryPart(queue[i]!) !== entryPart(here)) return i;
  return null;
}

// -------------------------------------------------------------------------------------------------------------------- the progress
/** «חלק ראשון: n מתוך 14»: n counts the first sitting's answered, not changed, items; the total is the contract's constant, never a count of everything. */
export function firstPartCounts(items: readonly BoothItemView[]): { done: number; total: number } {
  return { done: items.filter((v) => isFirstGroup(v.item.group) && v.state === 'answered').length, total: BOOTH_FIRST_SITTING_CARDS };
}
/** «נבדקו n מתוך m» over the cards of a queue: answered and not changed. */
export function queueCounts(queue: readonly QueueEntry[], items: readonly BoothItemView[]): { done: number; total: number } {
  const byId = new Map(items.map((v) => [v.item.id, v]));
  const cards = queue.filter((e): e is Extract<QueueEntry, { t: 'card' }> => e.t === 'card');
  return { done: cards.filter((e) => byId.get(e.id)?.state === 'answered').length, total: cards.length };
}
/** The `more.*` groups the view holds items for, with their counts: shown only after «עוד». */
export function moreGroups(items: readonly BoothItemView[]): { group: BoothGroup; n: number; done: number }[] {
  return BOOTH_GROUPS.filter((g) => !isFirstGroup(g)).map((g) => {
    const mine = items.filter((v) => v.item.group === g);
    return { group: g, n: mine.length, done: mine.filter((v) => v.state === 'answered').length };
  }).filter((g) => g.n > 0);
}

// ----------------------------------------------------------------------------------------------------------------------- the keys
export type BoothKeyAction = BoothVerdict | 'again';
export interface KeyLike { code: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean; repeat?: boolean }
/** Keys are physical (`e.code`), so they work on a Hebrew layout: 1 «בסדר», 2 «לא טוב», 3 «דלגו», R «שוב». With a modifier or on repeat they do nothing. */
export function keyAction(e: KeyLike): BoothKeyAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return null;
  return e.code === 'Digit1' ? 'ok' : e.code === 'Digit2' ? 'bad' : e.code === 'Digit3' ? 'skip' : e.code === 'KeyR' ? 'again' : null;
}
export interface TargetLike { tagName?: string; type?: string; isContentEditable?: boolean }
/** True while the person types: a text field, a text area, a select, an editable region. A checkbox, a radio, a range and a button are not typing. */
export function isTyping(t: TargetLike | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes((t.type ?? 'text').toLowerCase());
}

// ----------------------------------------------------------------------------------------------------------------------- the words
/** `d.m.yyyy` of an ISO time, by its own date part (no time zone arithmetic: the server clock's day). */
export function dateOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : '';
}
/** YYYY-MM-DD of a date in the viewer's own calendar day (the report's date). */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** The state line of a card: answered with its date, changed with its reason, or not answered. */
export function stateLine(say: BoothSay, v: BoothItemView): string {
  if (v.state === 'changed') return say(`booth.changed.${v.changedWhy ?? 'recipe'}`);
  if (v.state === 'answered' && v.answer) return say(v.item.kind === 'audio' ? 'booth.heardOn' : 'booth.seenOn', { date: dateOf(v.answer.at), verdict: say(`booth.answer.${v.answer.verdict}`) });
  return say('booth.state.unanswered');
}
/** An answer drawn on a software adapter is said so (booth.software). */
export const drawnOnSoftware = (a: BoothAnswer | null): boolean => !!a && (a.browserSoftware === true || a.exportSoftware === true);
/** «נעשתה הערה»: at least one stored note exists, so the report holds free text. */
export const hasNotes = (items: readonly BoothItemView[]): boolean => items.some((v) => (v.answer?.note ?? '').length > 0);
/** A picture card has no adapter to draw on when the browser row says off, fail or unknown (a missing row is not yet known). */
export const noAdapter = (row: Pick<BoothCheckRow, 'state'> | null | undefined): boolean => !!row && (row.state === 'off' || row.state === 'fail' || row.state === 'unknown');

// -------------------------------------------------------------------------------------------------------------- the self-check rows
export type StoredRows = Partial<Record<string, BoothCheckRow>>;
/** localStorage text → rows; every row is parsed with the contract's schema, anything else is dropped. */
export function parseRows(text: string | null): StoredRows {
  if (!text) return {};
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return {}; }
  if (!raw || typeof raw !== 'object') return {};
  const out: StoredRows = {};
  for (const def of BOOTH_CHECKS) {
    const p = BoothCheckRowSchema.safeParse((raw as Record<string, unknown>)[def.id]);
    if (p.success && p.data.id === def.id) out[def.id] = p.data;
  }
  return out;
}
/** The rows that exist, in the check's own order. */
export const rowsInOrder = (rows: StoredRows): BoothCheckRow[] => BOOTH_CHECKS.flatMap((d) => (rows[d.id] ? [rows[d.id]!] : []));

export interface RowWords { title: string; state: string; code: string | null; next: string | null; command: string | null }
/** What a row says: its title, the state word, the words for its reason code and the next step (by id and code, then by code alone). */
export function rowWords(say: BoothSay, id: string, row: BoothCheckRow | undefined): RowWords {
  const has = (k: string) => say(k) !== k;
  const title = say(`booth.check.${id}`);
  if (!row) return { title, state: '', code: null, next: null, command: null };
  const code = row.code;
  const codeKey = code && [`booth.check.${id}.${code}`, `booth.check.${code}`].find(has);
  const nextKey = code && [`booth.next.${id}.${code}`, `booth.next.${code}`].find(has);
  const next = nextKey ? say(nextKey) : null;
  return { title, state: say(`booth.checkState.${row.state}`), code: codeKey ? say(codeKey) : null, next, command: next ? commandIn(next) : null };
}
/** A command in a next step (`pnpm probe:gpu`): works unchanged in cmd and PowerShell, so it is copied as it stands. */
export function commandIn(text: string): string | null {
  const m = /\bpnpm [a-z0-9:_-]+(?: [a-z0-9:_-]+)*/i.exec(text);
  return m ? m[0] : null;
}
/** The rows that run from «הפעלת בדיקת המחשב» (light) and those that run only from their own button (heavy). */
export const LIGHT_CHECKS = BOOTH_CHECKS.filter((c) => !c.heavy);
export const HEAVY_CHECKS = BOOTH_CHECKS.filter((c) => c.heavy);

// -------------------------------------------------------------------------------------------------------------------- the answer
/** `x-pf-content-sha256` as the contract's `played` (sha256:<hex>), whether the header carries the prefix or not; null when it is neither. */
export function playedHash(header: string | null): string | null {
  const m = /^(?:sha256:)?([0-9a-f]{64})$/i.exec((header ?? '').trim());
  return m ? `sha256:${m[1]!.toLowerCase()}` : null;
}
export const clampVolume = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
export interface AnswerInput { verdict: BoothVerdict; problems?: readonly string[]; note?: string; extras?: Partial<BoothAnswerExtras> | undefined }
/** The PUT body: the recipe the card was opened with; problems only with «לא טוב» (the note comes only from that panel); the extras W2's cards and the sound hand back. */
export function answerBody(v: BoothItemView, input: AnswerInput): BoothAnswerBody {
  const note = (input.note ?? '').trim().slice(0, BOOTH_LIMITS.noteChars);
  const problems = input.verdict === 'bad' ? [...new Set(input.problems ?? [])].filter((p) => v.item.problems.includes(p as never)).slice(0, BOOTH_LIMITS.problems) : [];
  const x = input.extras ?? {};
  return {
    verdict: input.verdict, recipe: v.item.recipe,
    ...(problems.length ? { problems: problems as BoothAnswerBody['problems'] } : {}),
    ...(note ? { note } : {}),
    ...(x.played ? { played: x.played } : {}),
    ...(x.browserAdapter ? { browserAdapter: x.browserAdapter } : {}), ...(x.browserSoftware !== undefined ? { browserSoftware: x.browserSoftware } : {}),
    ...(x.exportAdapter ? { exportAdapter: x.exportAdapter } : {}), ...(x.exportSoftware !== undefined ? { exportSoftware: x.exportSoftware } : {}),
  };
}
/** The view after the server stored an answer: that item answered (not changed), the rest as they were. */
export function withAnswer(view: BoothView, answer: BoothAnswer): BoothView {
  return { ...view, items: view.items.map((v): BoothItemView => (v.item.id === answer.id ? { item: v.item, answer, state: 'answered' } : v)) };
}

// ------------------------------------------------------------------------------------------------------------------- the report box
export type ReportBox = { ok: true; text: string } | { ok: false; text: string };
/**
 * What the read-only box shows and «העתקת הדוח» copies: exactly boothReport(...), nothing added. While the report is not built, or when it
 * fails, the box says so in words and the copy button has nothing to copy (ok: false).
 */
export function reportBox(input: BoothReportInput, say: BoothSay, build: (i: BoothReportInput, s: BoothSay) => string = boothReport): ReportBox {
  try { return { ok: true, text: build(input, say) }; }
  catch (e) {
    return { ok: false, text: e instanceof BoothNotBuiltError ? `${say('error.code.booth_not_built')}. ${say('page.reportNotBuilt')}` : say('page.reportFailed') };
  }
}
export const reportInput = (view: BoothView, rows: StoredRows, date: string): BoothReportInput => ({ view, checks: rowsInOrder(rows), date });
