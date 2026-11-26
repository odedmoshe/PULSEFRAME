/** Parts of «מאגר» (wave 8 sources, W3): warning and term lines, the link box, a download row. Presentational and small; SourcesTab.tsx owns the state. */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { SourceImportAnswer, SourceWarning } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Button } from '../../ds/index.ts';
import { api } from '../../api.ts';
import { sayFailure } from '../library/LibraryBrowser.tsx';
import { SOURCES_TESTIDS as TID } from './sources.testids.ts';
import { sourcesApi } from './sourcesApi.ts';
import { parseStage, percentOf, sizeText, sx, termLines, TERMINAL, warningHead, type SourcesKey } from './sources.logic.ts';
import './sources.css';

/** A term row: the sentence at its source, verbatim, with its link and the day it was read; the Hebrew beside it is marked as a translation. */
export function TermRows({ ids, lang }: { ids: readonly string[]; lang: Lang }): ReactElement | null {
  const rows = termLines(lang, ids);
  if (!rows.length) return null;
  return (
    <ul className="pf-src-terms">
      {rows.map((r) => (
        <li key={r.id}>
          <q className="pf-src-quote" lang="en" dir="ltr">{r.quote}</q>
          {r.translation && <span className="pf-src-translation" dir="auto">{r.translation}</span>}
          {' '}<a href={r.url} target="_blank" rel="noopener noreferrer" dir="ltr">{r.url}</a>
          <span className="pf-src-muted"> · {sx(lang, 'sources.readOn', { date: r.readOn })}</span>
        </li>
      ))}
    </ul>
  );
}

/** One warning: what it names (the licence's own name), then the licence's own sentence. Never our conclusion. */
export function WarningLine({ w, lang, id, withTitle }: { w: SourceWarning; lang: Lang; id?: string; /** name the file first (the export sheet lists notes of many files) */ withTitle?: boolean }): ReactElement {
  return (
    <div className="pf-src-warn" role="note" data-code={w.code} id={id}>
      <span dir="auto">{withTitle && w.title ? <><bdi>{w.title}</bdi>: </> : null}<bdi>{warningHead(lang, w)}</bdi></span>
      <TermRows ids={w.termIds} lang={lang} />
    </div>
  );
}

const UNKNOWN_FAIL = 'sources.fail.canceled';
const failKey = (code: unknown): SourcesKey | null => (typeof code === 'string' ? (`sources.fail.${code}` as SourcesKey) : null);

/** A download in progress (polls its job; shows the stage and the bytes it knows) until the import card takes over. */
export function DownloadRow({ jobId, title, lang, onDone }: { jobId: string; title: string; lang: Lang; onDone: (jobId: string) => void }): ReactElement {
  const [job, setJob] = useState<{ status: string; stage: string | null; error: { code?: string; message?: string } | null } | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const j = await api.job(jobId);
        if (stop) return;
        setJob({ status: j.status, stage: j.stage, error: j.error ?? null });
        if (j.status === 'succeeded') { onDone(jobId); return; }
        if (TERMINAL.has(j.status)) return;
      } catch { /* the next tick asks again */ }
      if (!stop) timer = window.setTimeout(() => void tick(), 1000);
    };
    let timer = window.setTimeout(() => void tick(), 0);
    return () => { stop = true; window.clearTimeout(timer); };
  }, [jobId, onDone]);
  const v = parseStage(job?.stage);
  const pct = percentOf(v);
  const failed = job && (job.status === 'failed' || job.status === 'canceled' || job.status === 'cancelled');
  const fk = failed ? failKey(job.error?.code ?? (job.status === 'failed' ? undefined : 'canceled')) : null;
  const stageKey = v.stage ? (`sources.stage.${v.stage}` as SourcesKey) : null;
  const stageText = stageKey && v.stage !== 'done' ? sx(lang, stageKey) : '';
  return (
    <li className="pf-src-download" data-testid={TID.download(jobId)} data-status={job?.status ?? 'queued'}>
      <span className="pf-src-dl-title" dir="auto"><bdi>{title}</bdi></span>
      {failed ? (
        <span role="alert" dir="auto">{sx(lang, 'sources.job.failed')}: {fk && sx(lang, fk) !== fk ? sx(lang, fk) : (job.error?.message ?? sx(lang, UNKNOWN_FAIL))}</span>
      ) : (
        <span role="status" className="pf-src-muted">
          {stageText}{pct != null && <> · <bdi className="num">{pct}%</bdi></>}{pct == null && v.bytes != null && <> · <bdi className="num">{sizeText(v.bytes)}</bdi></>}
        </span>
      )}
      {pct != null && !failed && <progress className="pf-src-progress" max={100} value={pct} aria-label={sx(lang, 'sources.stage.downloading')} />}
      {!failed
        ? <Button size="sm" variant="ghost" data-testid={TID.downloadCancel(jobId)} aria-label={`${sx(lang, 'sources.cancel')}: ${title}`} onClick={() => void api.cancelJob(jobId).catch(() => undefined)}>{sx(lang, 'sources.cancel')}</Button>
        : <Button size="sm" variant="ghost" onClick={() => onDone(jobId)}>{sx(lang, 'sources.job.dismiss')}</Button>}
    </li>
  );
}

/** The link box: a pasted direct link; the answer line names the route, the warnings and the term rows. */
export function LinkBox({ lang, projectId, place, onStarted }: {
  lang: Lang; projectId: string | null; place: () => { start: { value: string; timescale: number }; trackId?: string } | undefined;
  onStarted: (jobId: string, title: string) => void;
}): ReactElement {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<SourceImportAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId || !url.trim() || busy) return;
    setBusy(true); setError(null); setAnswer(null);
    try {
      const a = await sourcesApi.importLink(projectId, { url: url.trim(), ...(place() ? { place: place()! } : {}) });
      setAnswer(a); setUrl('');
      let host = url.trim();
      try { host = new URL(host).host; } catch { /* shown as typed */ }
      onStarted(a.jobId, host);
    } catch (err) { setError(sayFailure(lang, err)); } finally { setBusy(false); }
  };
  return (
    <form className="pf-src-link" onSubmit={(e) => void submit(e)} aria-label={sx(lang, 'sources.link.paste')}>
      <div className="pf-src-row">
        <input type="url" dir="ltr" className="pf-src-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={sx(lang, 'sources.link.paste')} aria-label={sx(lang, 'sources.link.paste')} aria-describedby="pf-src-link-hint" data-testid={TID.linkInput} autoComplete="off" spellCheck={false} />
        <Button type="submit" size="sm" variant="secondary" disabled={!projectId || !url.trim() || busy} data-testid={TID.linkImport}>{sx(lang, 'sources.link.import')}</Button>
      </div>
      <p className="pf-src-muted" id="pf-src-link-hint">{sx(lang, 'sources.link.hint')}</p>
      <div data-testid={TID.linkAnswer} role="status" aria-live="polite">
        {error && <p className="pf-src-err" role="alert" dir="auto">{error}</p>}
        {answer && (
          <>
            <p dir="auto">{sx(lang, answer.route === 'direct' ? 'sources.link.route.direct' : 'sources.link.route.provider')}</p>
            {answer.warnings.map((w, i) => <WarningLine key={`${w.code}-${i}`} w={w} lang={lang} />)}
            {answer.terms.length > 0 && <TermRows ids={answer.terms} lang={lang} />}
          </>
        )}
      </div>
    </form>
  );
}
