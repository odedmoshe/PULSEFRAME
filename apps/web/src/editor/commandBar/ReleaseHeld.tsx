/**
 * The owner's control that releases an amount held for a language-assistant request whose cost is not known (ADR-0027, note of
 * 2026-11-25 "the release control"): a request canceled or failed after it had been sent keeps its reservation counted in the
 * month, because the service may have charged. One control for both places that show a held amount to the owner: the assistant's
 * row in the palette (right after the cancel) and the «סכומים שמורים» list in Settings.
 *
 * Releasing is irreversible and is easy to misread as "refund", so it is confirmed in the design system's confirm dialog (the
 * pattern of ConfirmRemoveSequence: a small modal that a click outside does not close, a quiet way out and a danger button). The
 * dialog says what a release is and is not: it takes the amount off the EDITOR'S OWN monthly count; it does not undo a charge.
 * The first focus is the way out («להשאיר בספירה»); Escape keeps the amount; the release itself takes one Tab and Enter.
 * The server decides who may release (POST /jobs/:jobId/budget/release: the owner's own session only).
 */
import { useState, type ReactElement } from 'react';
import { isOwnerStatus, type AssistantHeldAmount, type AssistantStatus, type AssistantStatusAnswer } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Button, Dialog } from '../../ds/index.ts';
import { api, ApiFailure } from '../../api.ts';
import { CHROME_STRINGS } from '../chrome.strings.ts';
import { COMMAND_BAR_TESTIDS as TID } from './commandBar.testids.ts';
import { barText, ltr, plain } from './commandBar.strings.ts';
import { Rich, WithReason } from './BarPreview.tsx';
import { refusalWords, type RefusalWords } from './describe.ts';
import './commandBar.css';

/** An amount of cents as the editor writes it, kept left to right. */
export const money = (cents: number): string => ltr(`${cents}¢`);
/** The amount still held for this job, as the owner's status lists it; null for any other status (a non-owner reads none) or when nothing is held. */
export const heldAmount = (s: AssistantStatusAnswer | null | undefined, jobId: string | null | undefined): AssistantHeldAmount | null =>
  (isOwnerStatus(s) && jobId ? s.held.find((h) => h.jobId === jobId) ?? null : null);
/** The owner's status after a release: that amount is no longer held, and the month counts that much less. What was spent does not move. */
export function withoutHeld(s: AssistantStatus, jobId: string): AssistantStatus {
  const h = s.held.find((x) => x.jobId === jobId);
  if (!h) return s;
  return { ...s, held: s.held.filter((x) => x.jobId !== jobId), reservedCents: Math.max(0, s.reservedCents - h.cents) };
}
/** How a held request ended, in words: canceled, failed, not known whether it arrived, or its project is gone. */
export const heldHow = (lang: Lang, status: string | null): string =>
  barText(lang, status === null ? 'set.held.how.gone' : status === 'canceled' ? 'set.held.how.canceled' : status === 'failed' ? 'set.held.how.failed' : 'set.held.how.unknown');
/** When the request was made, in the interface's locale (day and time), kept left to right. */
export const heldWhen = (lang: Lang, iso: string): string => {
  const d = new Date(iso);
  return ltr(Number.isNaN(d.getTime()) ? iso : d.toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
};
/** One held amount as a line of Settings: the amount, when the request was made, how it ended. */
export const heldLine = (lang: Lang, h: AssistantHeldAmount): string => barText(lang, 'set.held.line', { amount: money(h.cents), when: heldWhen(lang, h.requestedAt), how: heldHow(lang, h.status) });
/** The sentence after a release (a status line): what was released, and that a charge, if there was one, stands. */
export const releasedWords = (lang: Lang, cents: number): string => barText(lang, 'release.done', { amount: money(cents) });

/** What the confirmation says, in this order: what a release does, what it does not do (the charge), and that it is final. */
export function ReleaseConfirmBody({ lang, cents, failed }: { lang: Lang; cents: number; failed: RefusalWords | null }): ReactElement {
  return (
    <>
      <p><Rich text={barText(lang, 'release.body.what', { amount: money(cents) })} /></p>
      <p>{barText(lang, 'release.body.charge')}</p>
      <p><strong>{barText(lang, 'release.body.final')}</strong></p>
      {failed && <p className="pf-asst-bad" role="status" data-testid={TID.releaseRefused}><WithReason lang={lang} k="release.failed" words={failed} /></p>}
    </>
  );
}

export interface ReleaseHeldProps {
  lang: Lang;
  held: Pick<AssistantHeldAmount, 'jobId' | 'cents' | 'requestedAt'>;
  /** 'link': the palette row's text button; 'button': the design system's small button (Settings). */
  look: 'link' | 'button';
  /** The amount was released (`cents`), or the server says nothing was held any more (`gone`): either way it is no longer counted. */
  onDone: (r: { jobId: string; cents: number; gone: boolean }) => void;
}

/** The button and, once pressed, its confirmation. */
export function ReleaseHeld({ lang, held, look, onDone }: ReleaseHeldProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<RefusalWords | null>(null);
  const C = CHROME_STRINGS[lang];
  // in a list of several, each button is told apart by its amount and the time of its request
  const label = plain(barText(lang, 'release.buttonLabel', { amount: money(held.cents), when: heldWhen(lang, held.requestedAt) }));
  const close = () => { if (!busy) { setOpen(false); setFailed(null); } };
  const run = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await api.releaseBudget(held.jobId);
      setOpen(false);
      onDone({ jobId: held.jobId, cents: held.cents, gone: false });
    } catch (e) {
      // released meanwhile (another tab), or settled: nothing is held, so there is nothing to confirm any more
      if (e instanceof ApiFailure && e.code === 'nothing_to_release') { setOpen(false); onDone({ jobId: held.jobId, cents: held.cents, gone: true }); return; }
      setFailed(refusalWords(lang, e instanceof ApiFailure ? { code: e.code, message: e.message, hint: e.hint ?? null } : { message: e instanceof Error ? e.message : String(e) }));
    } finally { setBusy(false); }
  };
  const props = { 'data-testid': TID.releaseHeld, 'data-job': held.jobId, 'aria-label': label, 'aria-haspopup': 'dialog' as const, onClick: () => setOpen(true) };
  return (
    <>
      {look === 'link'
        ? <button type="button" className="pf-bar-link" {...props}>{barText(lang, 'release.button')}</button>
        : <Button size="sm" variant="secondary" {...props}>{barText(lang, 'release.button')}</Button>}
      {/* The dialog is a portal, and React sends its keys up to whatever holds this button (the palette, the Settings dialog), whose
          own Tab handling would pull the focus out of it: the keys stop here. */}
      {open && (
        <span onKeyDown={(e) => e.stopPropagation()}>
          <Dialog open onClose={close} title={barText(lang, 'release.title')} size="sm" dismissOnBackdrop={false} closeLabel={C.settingsClose} testId={TID.releaseDialog}
            footer={<>
              <Button variant="ghost" onClick={close} data-autofocus="" data-testid={TID.releaseKeep}>{barText(lang, 'release.keep')}</Button>
              <Button variant="danger" busy={busy} onClick={() => void run()} data-testid={TID.releaseConfirm}>{barText(lang, 'release.confirm')}</Button>
            </>}>
            <ReleaseConfirmBody lang={lang} cents={held.cents} failed={failed} />
          </Dialog>
        </span>
      )}
    </>
  );
}
