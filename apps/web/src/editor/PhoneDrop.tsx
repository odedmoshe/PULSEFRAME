/**
 * The phone drop dialog (ADR-0023; plan §7 with the verifier's corrections): three numbered steps; the address picker where the
 * owner confirms this computer's home-network address (the preferred one first; never chosen by the server alone); the QR on a
 * white plate in both themes (qr.ts) with the typed address and code in <bdi dir="ltr"> under it; the status line (role=status;
 * the countdown is not a live region, one announcement at one minute left); once claimed, «הקוד נוצל» instead of the QR; the
 * received files as import cards; «סגירת הקוד» (asks first while uploads are in flight) and «קוד חדש»; the disclosure «מה נפתח
 * לרשת?»; the honest states (PhoneDropProblem) and the Windows / VPN hint on first use and after 45 s without a phone.
 * Built on the design system's Dialog (ds/Dialog.tsx: modal, focus trap, Esc, focus returns); Esc hides it and the lead's
 * mount leaves PHONE_DROP_TESTIDS.chip in the drawer header while a code is live.
 * Props only: the component never calls fetch; the lead's mount passes the views and the callbacks (imports.api.ts dropApi).
 * Test ids: PHONE_DROP_TESTIDS (imports.testids.ts). Strings: phoneDrop.strings.ts.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then, when open, it shows only
 * that the feature is not available, and offers no code.
 */
import type { ReactElement } from 'react';
import type { DropAddress, DropCodeView, DropPublicView, ImportJobView } from '@pulseframe/core';
import { PHONE_DROP_TESTIDS } from './imports.testids.ts';
import { PHONE_DROP_STRINGS, type PhoneDropLang, type PhoneDropProblem } from './phoneDrop.strings.ts';

export interface PhoneDropProps {
  lang: PhoneDropLang;
  open: boolean;
  /** This computer's addresses (GET /drop/addresses); null while loading. */
  addresses: DropAddress[] | null;
  /** The live code as the owner sees it (url and pin only while waiting), or null before one is opened. */
  code: DropCodeView | null;
  /** The newest SSE `drop` event of this code (counts, state, close reason). */
  live: DropPublicView | null;
  /** The import jobs of this code (via 'phone', dropId of the code), oldest first. */
  files: ImportJobView[];
  /** An honest state instead of a code. */
  problem: PhoneDropProblem | null;
  /** Milliseconds since epoch, ticked by the mount once a second for the countdown. */
  now: number;
  onOpenCode(address: string): void;
  onCloseCode(dropId: string): void;
  onNewCode(address: string): void;
  /** Esc or the close button: hides the dialog; the code stays live. */
  onHide(): void;
  onRetry(jobId: string): void;
  onCancel(jobId: string): void;
  onDismiss(jobId: string): void;
}
export function PhoneDrop(props: PhoneDropProps): ReactElement | null {
  if (!props.open) return null;
  const S = PHONE_DROP_STRINGS[props.lang];
  return (
    <div role="dialog" aria-modal="true" aria-label={S.title} data-testid={PHONE_DROP_TESTIDS.dialog} dir={props.lang === 'he' ? 'rtl' : 'ltr'}>
      <p data-testid={PHONE_DROP_TESTIDS.problem}>{S.notAvailable}</p>
      <button type="button" onClick={props.onHide}>{S.closeCode}</button>
    </div>
  );
}
