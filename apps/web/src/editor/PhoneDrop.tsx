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
 * PhoneDropBody is the dialog's content on its own (no portal), so it renders from props in a test without a browser; PhoneDrop
 * puts it in the ds Dialog. The status line (role=status) never ticks: the countdown is a separate plain element, and one
 * visually hidden role=status sentence appears when a minute is left.
 */
import { useId, useState, type ReactElement } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { DropAddress, DropCodeView, DropPublicView, ImportJobView } from '@pulseframe/core';
import { Button, Dialog } from '../ds/index.ts';
import { encodeQr, qrSvgPath } from '../qr.ts';
import { ImportCards } from './ImportCards.tsx';
import { formatBytes } from './imports.logic.ts';
import { PHONE_DROP_TESTIDS } from './imports.testids.ts';
import { PHONE_DROP_STRINGS, type PhoneDropLang, type PhoneDropProblem } from './phoneDrop.strings.ts';
import './phoneDrop.css';

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

/** m:ss for the countdown (never negative). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
/** 483921 -> "483 921". */
export const groupPin = (pin: string): string => (pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin);
/** After this long without a phone the dialog adds the Windows and VPN hints (plan §7: 45 s). */
export const HINT_AFTER_MS = 45_000;
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ''));

/** The words for a code that has ended: its close reason as an honest state. */
function problemOfClose(reason: DropPublicView['closeReason']): PhoneDropProblem | 'closed' {
  switch (reason) {
    case 'locked': return 'locked';
    case 'expired': case 'idle': case 'max-life': return 'expired';
    case 'shutdown': return 'restarted';
    default: return 'closed';
  }
}

function Qr({ url, S }: { url: string; S: (typeof PHONE_DROP_STRINGS)['en'] }): ReactElement {
  let path: { d: string; viewBox: string } | null = null;
  try { path = qrSvgPath(encodeQr(url)); } catch { path = null; }
  if (!path) return <p className="pf-pd-note" data-testid={PHONE_DROP_TESTIDS.problem}>{S.qrFailed}</p>;
  // Black on a white plate with a 4-module quiet zone in both themes: a QR reader needs the contrast, not the page's colours.
  return (
    <div className="pf-pd-qr" data-testid={PHONE_DROP_TESTIDS.qr}>
      <svg role="img" aria-label={S.qrLabel} viewBox={path.viewBox} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#ffffff" />
        <path d={path.d} fill="#000000" />
      </svg>
    </div>
  );
}

/** The dialog's content on its own (no portal): steps, QR or the honest state, typed fallback, status, files, buttons. */
export function PhoneDropBody(props: Omit<PhoneDropProps, 'open' | 'onHide'>): ReactElement {
  const { lang, addresses, code, live, files, now } = props;
  const S = PHONE_DROP_STRINGS[lang];
  const selectId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const preferred = addresses?.find((a) => a.preferred) ?? addresses?.[0] ?? null;
  const address = code?.address ?? chosen ?? preferred?.address ?? null;
  const state = code ? (live?.state ?? code.state) : null;
  const view = live ?? code;
  const closedAs = state === 'closed' ? problemOfClose(view?.closeReason ?? null) : null;
  const noNetwork = !code && addresses !== null && addresses.length === 0;
  const problem: PhoneDropProblem | null = props.problem ?? (noNetwork ? 'no_private_network' : closedAs && closedAs !== 'closed' ? closedAs : null);
  const remaining = view ? Date.parse(view.expiresAt) - now : 0;
  const waiting = state === 'waiting';
  const sinceIssue = code ? now - Date.parse(code.issuedAt) : 0;
  const inFlight = view?.inFlight ?? 0;
  const liveCode = code && state !== 'closed';

  const receivedText = (view?.files ?? 0) > 0 ? fill(S.received, { count: view!.files, size: formatBytes(view!.bytes) }) : '';
  const statusText = !code ? ''
    : state === 'waiting' ? S.waitingPhone
    : state === 'connected' ? (receivedText || S.connected)
    : closedAs === 'closed' ? [S.closedByYou, receivedText].filter(Boolean).join(' · ') : receivedText; // an ended code names its reason in the alert above

  return (
    <div className="pf-pd" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <ol className="pf-pd-steps">
        <li>{S.step1}</li><li>{S.step2}</li><li>{S.step3}</li>
      </ol>

      {problem && (
        <div className="pf-pd-problem" role="alert" data-testid={PHONE_DROP_TESTIDS.problem}>
          <p>{S[`problem.${problem}`]}</p>
          {problem === 'drop_listen_failed' && address && <Button size="sm" variant="secondary" onClick={() => props.onOpenCode(address)}>{S.retry}</Button>}
        </div>
      )}

      {!code && addresses === null && !problem && <p className="pf-pd-note">{S.loadingAddresses}</p>}

      {!code && addresses !== null && addresses.length > 0 && (
        <div className="pf-pd-start">
          <label htmlFor={selectId}>{S.chooseAddress}</label>
          <select id={selectId} data-testid={PHONE_DROP_TESTIDS.address} dir="ltr" value={address ?? ''} onChange={(e) => setChosen(e.target.value)}>
            {addresses.map((a) => <option key={a.address} value={a.address}>{`${a.address} (${a.interfaceName})`}</option>)}
          </select>
          <Button variant="primary" data-testid={PHONE_DROP_TESTIDS.start} disabled={!address} onClick={() => address && props.onOpenCode(address)}>{S.start}</Button>
          <p className="pf-pd-note" data-testid={PHONE_DROP_TESTIDS.hint}>{S.hintWindows}</p>
        </div>
      )}

      {code && (
        <>
          {waiting && code.url && (
            <div className="pf-pd-code">
              <Qr url={code.url} S={S} />
              <p className="pf-pd-note">{S.cantScan}</p>
              <p className="pf-pd-typed">
                <bdi dir="ltr" className="pf-pd-addr" data-testid={PHONE_DROP_TESTIDS.typedAddress}>{`${code.address}:${code.port}`}</bdi>
                {code.pin && <span>{S.codeLabel} <bdi dir="ltr" className="pf-pd-pin" data-testid={PHONE_DROP_TESTIDS.pin}>{groupPin(code.pin)}</bdi></span>}
              </p>
            </div>
          )}
          {state === 'connected' && <p className="pf-pd-used">{S.used}</p>}

          <div className="pf-pd-statusline">
            <span role="status" data-testid={PHONE_DROP_TESTIDS.status}>{statusText}</span>
            {waiting && <span className="pf-pd-count"> · {fill(S.validFor, { time: formatClock(remaining) })}</span>}
          </div>
          <div className="pf-sr" role="status" aria-live="polite">{waiting && remaining > 0 && remaining <= 60_000 ? S.oneMinute : ''}</div>

          {waiting && sinceIssue >= HINT_AFTER_MS && (
            <div className="pf-pd-hints" data-testid={PHONE_DROP_TESTIDS.hint}><p>{S.hintWindows}</p><p>{S.hintVpn}</p></div>
          )}

          <div data-testid={PHONE_DROP_TESTIDS.files}>
            <ImportCards lang={lang} state={{ local: [], jobs: files, room: null, skipped: null }} onRetry={props.onRetry} onCancel={props.onCancel} onDismiss={props.onDismiss} onCancelLocal={() => undefined} />
          </div>

          <div className="pf-pd-actions">
            {liveCode && !confirming && <Button variant="secondary" data-testid={PHONE_DROP_TESTIDS.close} onClick={() => (inFlight > 0 ? setConfirming(true) : props.onCloseCode(code.dropId))}>{S.closeCode}</Button>}
            {liveCode && confirming && (
              <div className="pf-pd-confirm" role="alertdialog" aria-label={S.closeAsk}>
                <p>{S.closeAsk}</p>
                <Button variant="danger-quiet" onClick={() => { setConfirming(false); props.onCloseCode(code.dropId); }}>{S.closeCode}</Button>
                <Button variant="secondary" onClick={() => setConfirming(false)}>{S.keepOpen}</Button>
              </div>
            )}
            <Button variant={liveCode ? 'ghost' : 'primary'} data-testid={PHONE_DROP_TESTIDS.renew} disabled={!address} onClick={() => address && props.onNewCode(address)}>{S.newCode}</Button>
          </div>
        </>
      )}

      <details className="pf-pd-disclosure" data-testid={PHONE_DROP_TESTIDS.disclosure}>
        <summary><ShieldCheck size={16} strokeWidth={1.75} aria-hidden="true" /> {S.disclosureTitle}</summary>
        <p>{S.disclosureBody}</p>
      </details>
    </div>
  );
}

export function PhoneDrop(props: PhoneDropProps): ReactElement | null {
  const S = PHONE_DROP_STRINGS[props.lang];
  const { open, onHide, ...body } = props;
  return (
    <Dialog open={open} onClose={onHide} title={S.title} size="md" closeLabel={S.hideLabel} testId={PHONE_DROP_TESTIDS.dialog}>
      <PhoneDropBody {...body} />
    </Dialog>
  );
}
