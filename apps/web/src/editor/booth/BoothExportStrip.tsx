/**
 * «כך זה ייצא» (wave 8 booth, verify C5). BUILDER W2: one strip of the 7 first-sitting transitions' mid frames, fetched one at a time
 * from GET /api/v1/booth/items/:id/export-still after the row export-gpu answered, beside the editor drawing; heavy (its own button,
 * booth.heavyWarning; 409 booth_busy shown in words); records both adapters on each item's answer (onExtras). No difference number,
 * and nothing here says the export and the editor drawing are the same: they are shown side by side to be compared by eye.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createT } from '@pulseframe/i18n';
import { api } from '../../api.ts';
import { Button } from '../../ds/index.ts';
import type { BoothExportStripProps } from './booth.contract.ts';
import { BOOTH_TESTIDS as ID } from './booth.testids.ts';
import { boothPageStrings } from './check/check.strings.ts';
import { exportExtras, fetchExportStill, stripGate, stripItems, type ExportStillFacts } from './picture.logic.ts';

interface Shown { id: string; url: string | null; facts: ExportStillFacts | null }

export function BoothExportStrip({ lang, views, exportGpu, onExtras }: BoothExportStripProps): ReactElement {
  const t = createT(lang), S = boothPageStrings(lang);
  const items = stripItems(views);
  const gate = stripGate(exportGpu);
  const [shown, setShown] = useState<Shown[]>([]);
  const [running, setRunning] = useState<{ done: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const ac = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  const extras = useRef(onExtras);
  extras.current = onExtras;

  const drop = () => { for (const u of urls.current) URL.revokeObjectURL(u); urls.current = []; };
  // leaving the card ends the requests and drops the pictures from memory
  useEffect(() => () => { ac.current?.abort(); drop(); }, []);

  const run = async () => {
    if (running || items.length === 0 || gate !== 'ready') return;
    ac.current?.abort(); drop();
    const c = new AbortController(); ac.current = c;
    setShown([]); setProblem(null); setFinished(false); setRunning({ done: 0 });
    const got: Shown[] = [];
    // one still at a time: the export engine draws the 7 in turn, never beside an export (a 409 says so)
    for (let i = 0; i < items.length; i++) {
      const v = items[i]!;
      const r = await fetchExportStill(fetch, api.boothExportStillUrl(v.item.id), lang, { busy: S.stripBusy, other: S.stripFailed }, c.signal);
      if (c.signal.aborted) return;
      if (!r.ok) {
        if (r.busy) { setProblem(S.stripBusy); setRunning(null); setShown(got); return; }
        got.push({ id: v.item.id, url: null, facts: null });
        setProblem(r.words);
      } else {
        const url = URL.createObjectURL(r.blob);
        urls.current.push(url);
        got.push({ id: v.item.id, url, facts: r.facts });
        extras.current(v.item.id, exportExtras(r.facts));
      }
      setShown([...got]); setRunning({ done: i + 1 });
    }
    setRunning(null); setFinished(true);
  };

  return (
    <section className="pf-booth-strip" data-testid={ID.exportStrip} aria-label={t('booth.exportStrip')} dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang} data-state={running ? 'running' : finished ? 'done' : 'idle'}>
      <h3>{t('booth.exportStrip')}</h3>
      <p>{t('booth.exportStripHelp')}</p>
      <p>{t('booth.heavyWarning')}</p>
      {gate === 'needs-row' && <p role="status">{t('booth.exportStripNeedsRow')}</p>}
      {items.length === 0 && <p>{S.stripEmpty}</p>}
      <Button data-testid={ID.exportStripRun} busy={!!running} disabled={gate !== 'ready' || items.length === 0} onClick={() => void run()}>{S.stripRun}</Button>
      {running && <p role="status">{S.stripRunning(running.done, items.length)}</p>}
      {problem && <p role="status">{problem}</p>}
      {finished && !problem && <p role="status">{S.stripDone}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-sp-4)' }}>
        {shown.map((s) => {
          const v = items.find((x) => x.item.id === s.id)!;
          return (
            <figure key={s.id} style={{ margin: 0, flex: '1 1 160px' }} data-item={s.id}>
              {s.url
                ? <img src={s.url} alt={`${v.item.title[lang]}: ${S.stripSeenNote}`} style={{ inlineSize: '100%', blockSize: 'auto' }} />
                : <p>{S.stripItemFailed}</p>}
              <figcaption>
                {v.item.title[lang]}
                {s.facts?.adapter ? <span dir="ltr" style={{ display: 'block' }}>{S.stripAdapter(s.facts.adapter)}</span> : null}
                {s.facts?.software === true ? <span style={{ display: 'block' }}>{S.stripSoftware}</span> : null}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
