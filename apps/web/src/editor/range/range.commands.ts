/**
 * The range commands (wave 8D P5 b, c), spread into COMMANDS (commands.ts). The timeline toolbar's three range buttons (WP1)
 * call exactly these ids: range.in (I) · range.out (O) · range.cut (X). range.clear is in the palette, unbound: Escape clears
 * the marks through edit.deselect (one chord, one command), before it clears the selection.
 * I and O act only while the focus is on the timeline, the stage or nowhere in particular: never inside another panel, and never
 * in the source viewer, which has its own I and O for a source range (SourceViewer.tsx; a modal, so the dispatcher passes it by
 * as well). That rule is `keysHere` (the key dispatcher reads it); the toolbar buttons and the palette run them from anywhere. The marks are view state; the cut is ONE commit of cut_range (one undo).
 */
import type { Command } from '../commands.ts';
import type { Editor } from '../store.ts';
import { dragMark, fullRange, hasRange, markIn, markOut, rangeCutPlan, type RangeMarks } from './range.logic.ts';
import { rangeStore } from './range.state.ts';
import { RANGE_STRINGS } from './range.strings.ts';

export const RANGE_COMMAND_IDS = { in: 'range.in', out: 'range.out', cut: 'range.cut', clear: 'range.clear' } as const;

/** Where the focus may be for the range keys: the timeline, the stage, or the page itself (nothing focused). */
export function rangeKeysHere(doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  if (!doc) return true;
  if (doc.querySelector('[aria-modal="true"]')) return false;
  const a = doc.activeElement;
  if (!a || a === doc.body || a === doc.documentElement) return true;
  return !!a.closest('#pf-timeline, #pf-stage');
}

const marksOf = (e: Editor): RangeMarks => rangeStore.get(e.doc?.id);
const put = (e: Editor, next: RangeMarks) => { if (e.doc) rangeStore.set(e.doc.id, next); };
const say = (e: Editor) => RANGE_STRINGS[e.getState().lang];
const txt = (k: 'cmdIn' | 'cmdOut' | 'cmdCut' | 'cmdClear') => ({ he: RANGE_STRINGS.he[k], en: RANGE_STRINGS.en[k] });

/** Whether the timeline has a range mark now (Escape clears it before it clears the selection: edit.deselect, commands.ts). */
export const rangeMarked = (e: Editor) => hasRange(marksOf(e)) && rangeKeysHere();
/** Clears the marks; true when there were any to clear (and the focus is where the range keys act). */
export function clearRange(e: Editor): boolean {
  if (!rangeMarked(e)) return false;
  put(e, { in: null, out: null });
  return true;
}

/** Moves one flag (the flags' drag on the ruler; view state, no commit). */
export function moveMark(e: Editor, which: 'in' | 'out', frame: number) {
  const last = Math.max(0, (e.player?.frameCount ?? 1) - 1);
  put(e, dragMark(marksOf(e), which, frame, last));
}

/** The range cut: one commit of cut_range, then the playhead goes to the cut point and the marks are cleared. A refusal changes nothing and says why. */
export async function cutRange(e: Editor): Promise<unknown> {
  const S = say(e);
  const plan = rangeCutPlan(e.doc, marksOf(e), e.rate);
  if (!plan.ok) {
    const title = plan.why === 'locked' ? S.locked((plan.tracks ?? []).join(', ')) : plan.why === 'past_end' ? S.pastEnd : plan.why === 'no_project' ? S.noProject : S.needBoth;
    e.notify({ kind: 'info', title });
    return null;
  }
  // worked out again when the commit's turn comes, from the document as it is then (a remote edit may have locked a track)
  const r = await e.commit(() => { const p = rangeCutPlan(e.doc, marksOf(e), e.rate); return p.ok ? p.ops : null; }, 'Range cut');
  if (!r) return r;
  const seconds = ((plan.end - plan.start) * e.rate.den) / e.rate.num;
  if (e.doc) rangeStore.set(e.doc.id, { in: null, out: null });
  e.seek(plan.start);
  e.notify({ kind: r.transactionId ? 'undo' : 'info', title: S.cut(S.seconds(String(Math.round(seconds * 10) / 10))), ...(r.transactionId ? { undoes: r.transactionId } : {}) });
  return r;
}

export const RANGE_COMMANDS: Command[] = [
  { id: RANGE_COMMAND_IDS.in, label: 'timeline', text: txt('cmdIn'), group: 'edit', keys: ['KeyI'], enabled: (e) => !!e.doc && (e.player?.frameCount ?? 0) > 0, keysHere: () => rangeKeysHere(), run: (e) => put(e, markIn(marksOf(e), e.frame)) },
  { id: RANGE_COMMAND_IDS.out, label: 'timeline', text: txt('cmdOut'), group: 'edit', keys: ['KeyO'], enabled: (e) => !!e.doc && (e.player?.frameCount ?? 0) > 0, keysHere: () => rangeKeysHere(), run: (e) => put(e, markOut(marksOf(e), e.frame)) },
  { id: RANGE_COMMAND_IDS.cut, label: 'timeline', text: txt('cmdCut'), group: 'edit', keys: ['KeyX'], enabled: (e) => !!e.doc && fullRange(marksOf(e)), keysHere: () => rangeKeysHere(), run: cutRange },
  { id: RANGE_COMMAND_IDS.clear, label: 'timeline', text: txt('cmdClear'), group: 'edit', keys: [], enabled: (e) => hasRange(marksOf(e)), run: (e) => put(e, { in: null, out: null }) },
];
