/**
 * The import cards (ADR-0023; plan §7): a section «בייבוא (N)» at the top of the media drawer, in its OWN list outside
 * `ul.assets` (proofs wait on `.assets li` for a real asset). Per file: a kind icon (no fake thumbnail), the name, the size, a
 * source badge (phone or folder), the state chip and a progress bar that fills from the reading direction; the four states of
 * the brief from importCardState (core) — «ממתין» (with «בתור: N לפניו», «ממתין לסיום הייצוא» or «נבדק»), «ממיר 42%» (with the
 * reasons, notice.reason.*), «מוכן» (2 s, then the real asset card), «נכשל» with the reason (error.code.*) and «ניסיון חוזר»
 * only when retryable / «הסרה» — and the local «בהעלאה 42%» before them; a cancel button on waiting and converting cards.
 * Announcements only on ready and failed, never per percent: a visually hidden role=status list holds one sentence per card
 * that is ready or failed, so a screen reader reads each once as it is added. Static bars under reduced motion.
 * Props only (the lead's mount passes ImportsStore.snapshot()). Test ids: IMPORT_TESTIDS. Strings: imports.strings.ts.
 */
import type { ReactElement } from 'react';
import { File as FileIcon, Film, Image as ImageIcon, Music } from 'lucide-react';
import { Badge, Button, ProgressBar } from '../ds/index.ts';
import type { ImportJobView } from '@pulseframe/core';
import type { ImportsState, LocalImport } from './imports.ts';
import { IMPORTS_STRINGS, type ImportsLang } from './imports.strings.ts';
import { IMPORT_TESTIDS } from './imports.testids.ts';
import { announcementsOf, cardText, formatBytes, kindOfName } from './imports.logic.ts';
import './importCards.css';

export interface ImportCardsProps {
  lang: ImportsLang;
  state: ImportsState;
  onRetry(jobId: string): void;
  onCancel(jobId: string): void;
  onDismiss(jobId: string): void;
  /** Stops a local upload before it has a job. */
  onCancelLocal(localId: string): void;
}

const ICONS = { video: Film, sound: Music, image: ImageIcon, other: FileIcon } as const;
const fill = (tpl: string, n: number) => tpl.replace('{count}', String(n));

function Row({ icon, name, size, badge, chip, detail, percent, tone, testId, chipTone, children }: {
  icon: 'video' | 'sound' | 'image' | 'other'; name: string; size: number; badge: string | null; chip: string; detail: string | null; percent: number | null | undefined;
  tone: 'frame' | 'ok'; testId: string; chipTone: 'neutral' | 'frame' | 'ok' | 'attention'; children: ReactElement | (ReactElement | false)[];
}): ReactElement {
  const Icon = ICONS[icon];
  const sz = formatBytes(size);
  return (
    <li className="pf-imp-card" data-testid={testId} data-state={chipTone}>
      <span className="pf-imp-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span>
      <div className="pf-imp-main">
        <div className="pf-imp-top">
          <bdi className="pf-imp-name" dir="auto">{name}</bdi>
          {sz && <span className="pf-imp-size num" dir="ltr">{sz}</span>}
          {badge && <Badge tone="hollow">{badge}</Badge>}
        </div>
        <div className="pf-imp-line">
          <Badge tone={chipTone}><span data-testid={IMPORT_TESTIDS.state}>{chip}</span></Badge>
          {detail && <span className="pf-imp-detail">{detail}</span>}
        </div>
        {percent != null && <div className="pf-imp-bar" data-testid={IMPORT_TESTIDS.progress}><ProgressBar value={percent} label={`${name} ${chip}`} tone={tone} /></div>}
      </div>
      <div className="pf-imp-actions">{children}</div>
    </li>
  );
}

export function ImportCards({ lang, state, onRetry, onCancel, onDismiss, onCancelLocal }: ImportCardsProps): ReactElement | null {
  const S = IMPORTS_STRINGS[lang];
  const count = state.jobs.length + state.local.length;
  const skipped = state.skipped;
  if (count === 0 && !skipped) return null;
  const badgeOf = (via: string) => (via === 'phone' ? S.fromPhone : via === 'folder' ? S.fromFolder : null);
  const jobRow = (j: ImportJobView) => {
    const t = cardText({ kind: 'job', view: j }, lang);
    const retryable = j.state === 'failed' ? j.error?.retryable === true : j.state === 'canceled';
    const busy = j.state === 'waiting' || j.state === 'converting';
    return (
      <Row key={j.jobId} testId={IMPORT_TESTIDS.card(j.jobId)} icon={kindOfName(j.name)} name={j.name} size={j.byteSize} badge={badgeOf(j.via)} chip={t.chip} detail={t.detail}
        percent={j.state === 'converting' ? j.percent ?? null : undefined} tone="frame"
        chipTone={j.state === 'ready' ? 'ok' : j.state === 'failed' ? 'attention' : j.state === 'converting' ? 'frame' : 'neutral'}>
        {[
          busy && <Button key="c" size="sm" variant="ghost" data-testid={IMPORT_TESTIDS.cancel} aria-label={`${S.cancel}: ${j.name}`} onClick={() => onCancel(j.jobId)}>{S.cancel}</Button>,
          retryable && <Button key="r" size="sm" variant="secondary" data-testid={IMPORT_TESTIDS.retry} aria-label={`${S.retry}: ${j.name}`} onClick={() => onRetry(j.jobId)}>{S.retry}</Button>,
          (j.state === 'failed' || j.state === 'canceled') && <Button key="d" size="sm" variant="ghost" data-testid={IMPORT_TESTIDS.dismiss} aria-label={`${S.dismiss}: ${j.name}`} onClick={() => onDismiss(j.jobId)}>{S.dismiss}</Button>,
        ]}
      </Row>
    );
  };
  const localRow = (l: LocalImport) => {
    const t = cardText({ kind: 'local', local: l }, lang);
    const failed = l.state === 'not-uploaded';
    return (
      <Row key={l.localId} testId={IMPORT_TESTIDS.localCard(l.localId)} icon={kindOfName(l.name)} name={l.name} size={l.byteSize} badge={badgeOf(l.via)} chip={t.chip} detail={t.detail}
        percent={l.state === 'uploading' ? l.percent : undefined} tone="frame" chipTone={failed ? 'attention' : l.state === 'uploading' ? 'frame' : 'neutral'}>
        <Button size="sm" variant="ghost" data-testid={failed ? IMPORT_TESTIDS.dismiss : IMPORT_TESTIDS.cancel} aria-label={`${failed ? S.removeLocal : S.cancel}: ${l.name}`} onClick={() => onCancelLocal(l.localId)}>{failed ? S.removeLocal : S.cancel}</Button>
      </Row>
    );
  };
  return (
    <section className="pf-imp" aria-label={S.listLabel} data-testid={IMPORT_TESTIDS.list} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      {count > 0 && <h3 className="pf-imp-head" data-testid={IMPORT_TESTIDS.summary}>{S.section.replace('{count}', String(count))}</h3>}
      {count > 0 && <ul className="pf-imp-list">{state.jobs.map(jobRow)}{state.local.map(localRow)}</ul>}
      {skipped && <p className="pf-imp-skipped" data-testid={IMPORT_TESTIDS.skipped}>{fill(skipped.reason === 'too-many' ? S.skippedTooMany : S.skippedNotMedia, skipped.count)}</p>}
      <div className="pf-sr" role="status" aria-live="polite" aria-relevant="additions text">{announcementsOf(state.jobs, lang).map((a) => <p key={a.id}>{a.text}</p>)}</div>
    </section>
  );
}
