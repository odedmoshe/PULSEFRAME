/**
 * «קליפ מקוד» dialog (wave 8 motioncode, W3). New: tiles of the built-in pages (radio group, arrow keys), their fields, the length, and
 * «הדבקת דף (מתקדם)». Edit (from the Inspector): the page and values of a made clip loaded from madeApi.page, the length locked to the
 * clip. «יצירה» starts the render and polls the job at most every 2 s into ONE aria-live line; Esc while drawing asks «לעצור את הציור?».
 * The result (MadeResult) offers add to the timeline at the playhead, library only, update everywhere (edit), cancel. The ds Dialog holds
 * the focus trap and puts the first focus; nothing here moves focus in a later task (tile arrows move it in the key handler itself).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Dialog, Button } from '../../ds/index.ts';
import { api } from '../../api.ts';
import { useEditorState } from '../store.ts';
import type { MadeAssetPage, MadeField, MadeJobReport, MadeTemplateInfo } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import { madeApi } from './madeApi.ts';
import { MADE_TESTIDS as TID } from './made.testids.ts';
import { madeT } from './made.strings.ts';
import { buildRequest, clipsUsing, errorText, failureText, fieldProblems, initialValues, lengthChoices, partsText, pollMade, progressParts, secondsLabel, templateValues, type PageSource } from './made.logic.ts';
import { MadeResult } from './MadeResult.tsx';
import './made.css';

export interface MadeEditTarget { assetId: string; /** frames of the clip being edited */ clipFrames: number }
type Phase = 'form' | 'drawing' | 'result' | 'failed';

export function MadeClipDialog({ onClose, edit }: { onClose: () => void; edit?: MadeEditTarget }): ReactElement {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const t = madeT(lang);
  const doc = state.doc;
  const projectId = doc?.id ?? '';
  const rate = doc?.settings.frameRate ?? { num: 30, den: 1 };
  const uid = useId();

  const [templates, setTemplates] = useState<MadeTemplateInfo[] | 'loading' | 'failed'>(edit ? [] : 'loading');
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState<MadeAssetPage | null>(null);
  const [pageError, setPageError] = useState('');
  const [chosen, setChosen] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState(edit ? (edit.clipFrames * rate.den) / rate.num : 4);
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [jobId, setJobId] = useState('');
  const [report, setReport] = useState<MadeJobReport | null>(null);
  const [renderWarnings, setRenderWarnings] = useState<{ what: string; at: number }[]>([]);
  const [message, setMessage] = useState('');
  const [askStop, setAskStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const run = useRef(0);
  const tiles = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => () => { alive.current = false; }, []);

  // the built-in pages (new) or the page of the clip (edit)
  useEffect(() => {
    let on = true;
    if (edit) {
      madeApi.page(projectId, edit.assetId).then((p) => { if (!on) return; setPage(p); setValues({ ...p.record.values }); setPaste(p.page); }, (e) => { if (on) setPageError(errorText(e, lang)); });
    } else {
      madeApi.templates().then((r) => {
        if (!on) return;
        setTemplates(r.templates);
        const first = r.templates[0];
        if (first) { setChosen(first.id); setValues(templateValues(first, lang)); setSeconds(first.seconds); }
      }, (e) => { if (on) { setTemplates('failed'); setLoadError(errorText(e, lang)); } });
    }
    return () => { on = false; };
    // opened once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = Array.isArray(templates) ? templates : [];
  const template = list.find((x) => x.id === chosen);
  const source: PageSource | null = edit ? (page ? { kind: 'page', text: page.page, fields: page.record.fields } : null) : template ? { kind: 'template', template } : null;
  const fields: MadeField[] = source ? (source.kind === 'template' ? source.template.fields : source.fields) : [];
  const problems = useMemo(() => (source ? fieldProblems(fields, values, lang) : []), [source, fields, values, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const canRender = !!source && problems.length === 0 && phase === 'form' && !busy && (!!paste.trim() || !!template || !!edit);

  const pick = (x: MadeTemplateInfo) => { setChosen(x.id); setValues(templateValues(x, lang)); setSeconds(x.seconds); };
  const tileKey = (e: KeyboardEvent, i: number) => {
    const n = list.length;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (lang === 'he' && e.key === 'ArrowRight' ? -1 : 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (lang === 'he' && e.key === 'ArrowLeft' ? 1 : -1) : 0;
    if (!step || !n) return;
    e.preventDefault();
    const next = list[(i + step + n) % n]!;
    pick(next);
    tiles.current[next.id]?.focus(); // in the key handler itself: no later task
  };

  const start = async () => {
    if (!source) return;
    setBusy(true); setMessage('');
    try {
      const assetIds = page?.record.assetIds;
      const r = await madeApi.render(projectId, buildRequest({ source, values, seconds, paste: edit && page && paste === page.page ? '' : paste, lang }, assetIds));
      if (!alive.current) return;
      const mine = ++run.current;
      setJobId(r.jobId); setRenderWarnings(r.warnings ?? []); setReport(null); setPhase('drawing');
      void pollMade({
        report: () => madeApi.report(projectId, r.jobId),
        sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
        onReport: (x) => { if (alive.current && run.current === mine) setReport(x); },
        stopped: () => !alive.current || run.current !== mine,
      }).then((fin) => {
        if (!fin || !alive.current || run.current !== mine) return;
        if (fin.status === 'succeeded') setPhase('result');
        else { setMessage(fin.failure ? `${failureText(fin.failure, lang)}${lang === 'en' && fin.failure.hint ? `. ${fin.failure.hint}` : ''}` : t('fail.made_canceled')); setPhase('failed'); }
      }, (e) => { if (alive.current) { setMessage(errorText(e, lang)); setPhase('failed'); } });
    } catch (e) { if (alive.current) setMessage(errorText(e, lang)); } finally { if (alive.current) setBusy(false); }
  };

  const stop = () => {
    setAskStop(false);
    const id = jobId;
    void api.cancelJob(id).catch(() => {});
    void madeApi.dismiss(projectId, id).catch(() => {});
    run.current++;
    setReport(null); setJobId(''); setMessage(t('fail.made_canceled')); setPhase('form');
  };
  const cancel = () => {
    if (phase === 'drawing') { setAskStop(true); return; }
    if (phase === 'result' && jobId) void madeApi.dismiss(projectId, jobId).catch(() => {});
    onClose();
  };

  const apply = async (how: 'place' | 'library' | 'replace') => {
    setBusy(true); setMessage('');
    try {
      const seq = state.activeSequenceId || undefined;
      if (how === 'place') await madeApi.apply(projectId, jobId, { place: { start: editor.playhead }, ...(seq ? { sequenceId: seq } : {}) });
      else if (how === 'replace' && edit) await madeApi.apply(projectId, jobId, { replaceAssetId: edit.assetId, ...(seq ? { sequenceId: seq } : {}) });
      else await madeApi.apply(projectId, jobId, { library: true });
      onClose();
    } catch (e) { setMessage(errorText(e, lang)); } finally { if (alive.current) setBusy(false); }
  };

  const used = edit && doc ? clipsUsing(doc, edit.assetId) : 0;
  const footer = (
    <>
      {phase === 'form' && <Button variant="primary" size="md" disabled={!canRender} busy={busy} onClick={() => void start()} data-testid={TID.render}>{t('render')}</Button>}
      {phase === 'result' && <Button variant="primary" size="md" disabled={busy} onClick={() => void apply('place')} data-testid={TID.place}>{t('place')}</Button>}
      {phase === 'result' && <Button variant="secondary" size="md" disabled={busy} onClick={() => void apply('library')} data-testid={TID.library}>{t('library')}</Button>}
      {phase === 'result' && edit && used > 0 && <Button variant="secondary" size="md" disabled={busy} onClick={() => void apply('replace')} data-testid={TID.replace}>{t('replace', { n: used })}</Button>}
      <Button variant="ghost" size="md" onClick={cancel} data-testid={TID.cancel}>{t('cancel')}</Button>
    </>
  );
  const lengthLocked = !!edit || phase !== 'form';
  const choices = lengthChoices(seconds);

  return (
    <Dialog open onClose={cancel} title={t('dialog.title')} size="lg" className="pf-made-dialog" testId={TID.dialog} footer={footer} closeLabel={t('cancel')}>
      <div className="pf-made-body" data-mode={edit ? 'edit' : 'new'} ref={(el) => { el?.closest('[role="dialog"]')?.setAttribute('data-mode', edit ? 'edit' : 'new'); }}>
        <p className="pf-made-note">{edit ? t('ui.editHint') : t('intro')}</p>
        {/* the one polite line: it changes only when a poll answers (at most every 2 s) */}
        <p className="pf-made-progress" role="status" aria-live="polite" data-testid={TID.progress}>{phase === 'drawing' ? partsText(progressParts(report, lang)) : ''}</p>

        {askStop && (
          <div className="pf-made-ask" role="group" aria-label={t('stopAsk')}>
            <b>{t('stopAsk')}</b>
            <Button variant="danger" size="sm" onClick={stop}>{t('ui.stopYes')}</Button>
            <Button variant="secondary" size="sm" onClick={() => setAskStop(false)}>{t('ui.stopNo')}</Button>
          </div>
        )}
        {message && <p className="pf-made-error" role="alert" dir="auto">{phase === 'failed' ? `${t('ui.failedTitle')}: ` : ''}{message}</p>}
        {pageError && <p className="pf-made-error" role="alert" dir="auto">{pageError}</p>}
        {edit && !page && !pageError && <p className="pf-made-note">{t('ui.pageLoading')}</p>}

        {phase === 'result' && report && <MadeResult projectId={projectId} jobId={jobId} report={report} lang={lang} renderWarnings={renderWarnings} />}

        {(phase === 'form' || phase === 'drawing') && (
          <fieldset className="pf-made-form" disabled={phase === 'drawing'}>
            {!edit && (
              <div>
                <span className="pf-made-h" id={`${uid}-tiles`}>{t('tiles')}</span>
                {templates === 'loading' && <p className="pf-made-note">{t('ui.loading')}</p>}
                {templates === 'failed' && <p className="pf-made-error" role="alert" dir="auto">{t('ui.loadFailed')}{loadError ? ` (${loadError})` : ''}</p>}
                {Array.isArray(templates) && templates.length === 0 && <p className="pf-made-note">{t('ui.noTemplates')}</p>}
                <div className="pf-made-tiles" role="radiogroup" aria-labelledby={`${uid}-tiles`}>
                  {list.map((x, i) => (
                    <button key={x.id} type="button" role="radio" aria-checked={x.id === chosen} tabIndex={x.id === chosen ? 0 : -1} className="pf-made-tile" data-testid={TID.tile(x.id)}
                      ref={(el) => { tiles.current[x.id] = el; }} onClick={() => pick(x)} onKeyDown={(e) => tileKey(e, i)}>{x.name[lang]}</button>
                  ))}
                </div>
              </div>
            )}
            {fields.length > 0 && (
              <div className="pf-made-fields" role="group" aria-label={t('ui.fields')}>
                {fields.map((f) => (
                  <label key={f.key} className="pf-made-field"><span>{f.label[lang]}</span>
                    <input className="pf-made-input" data-testid={TID.field(f.key)} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      {...(f.kind === 'text' ? { type: 'text', dir: 'auto' as const, maxLength: f.maxLength } : f.kind === 'colour' ? { type: 'color' } : { type: 'number', min: f.min, max: f.max, step: 'any' })} />
                  </label>
                ))}
              </div>
            )}
            <label className="pf-made-field"><span>{t('length')}</span>
              <select className="pf-made-input" data-testid={TID.length} value={seconds} disabled={lengthLocked} onChange={(e) => setSeconds(Number(e.target.value))}>
                {choices.map((n) => <option key={n} value={n}>{t('seconds', { n: secondsLabel(n) })}</option>)}
              </select>
            </label>
            {problems.length > 0 && <ul className="pf-made-lines" role="alert">{problems.map((p) => <li key={p} dir="auto">{p}</li>)}</ul>}

            <details className="pf-made-paste" open={pasteOpen} onToggle={(e) => setPasteOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid={TID.paste}>
              <summary>{t('paste')}</summary>
              <p className="pf-made-note">{t('pasteHint')}</p>
              <label className="pf-made-field"><span>{t('ui.pasteLabel')}</span>
                <textarea className="pf-made-input pf-made-code" dir="ltr" spellCheck={false} rows={8} value={paste} data-testid={TID.pasteText} onChange={(e) => setPaste(e.target.value)} />
              </label>
              {!edit && paste.trim() && <p className="pf-made-note">{t('ui.pasteOverrides')}</p>}
              <div data-testid={TID.pasteWarnings} aria-label={t('ui.pasteWarnings')} role="group">
                {renderWarnings.length > 0 && <ul className="pf-made-lines">{renderWarnings.map((w, i) => <li key={i} dir="auto">{w.what} (<bdi dir="ltr">{w.at}</bdi>)</li>)}</ul>}
              </div>
            </details>
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
