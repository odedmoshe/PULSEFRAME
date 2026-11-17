/**
 * The status bar (docs/design/UX_REDESIGN.md §4.8), 24 px at the bottom. Start side: the project's format and frame rate,
 * the duration, and a background job with its mini ring. End side: capability pips ("2 להגדרה", which opens the status
 * centre), and the last export's flash check (data-testid flash-pass / flash-fail moved here from the top bar).
 * The shell (ds/shell.css) gives the row its height once this renders something. Styles: ds/chrome.css.
 */
import { Check, ShieldCheck, TriangleAlert } from 'lucide-react';
import * as T from '@pulseframe/time';
import { Ring } from '../ds/index.ts';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { setSettingsOpen } from './chromeState.ts';
import { editEnd } from './commands.ts';
import { useEditorState } from './store.ts';
import '../ds/chrome.css';

export function StatusBar() {
  const { state, t } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const { doc, capJob, gpu, provider, exportJob } = state;
  const seconds = doc ? T.toSeconds(editEnd(doc)) : 0;
  const clock = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const fps = doc ? Math.round((doc.settings.frameRate.num / doc.settings.frameRate.den) * 100) / 100 : 0;
  const job = capJob && ['queued', 'running'].includes(capJob.status) ? capJob : null;
  const pct = job && typeof job.output?.progress === 'number' ? Math.round(job.output.progress * 100) : null;
  // What still needs setting up: the graphics adapter and the local AI provider. Known facts only; an unknown state is not counted.
  const needs = [gpu && !gpu.available ? 'gpu' : null, provider && !provider.provider.configured ? 'ai' : null].filter(Boolean).length;
  const flash = exportJob?.status === 'succeeded' && exportJob.output?.photosensitivity ? exportJob.output.photosensitivity : null;
  return (
    <footer className="pf-ds pf-status" data-shell-slot="status" aria-label={S.statusFormat}>
      <div className="pf-status-start">
        {doc && <span className="num pf-status-fmt" dir="ltr" title={S.statusFormat}>{doc.settings.width}×{doc.settings.height} · {fps} fps</span>}
        {job && (
          <span className="pf-status-job" role="status" aria-label={S.statusJobs}>
            <Ring value={pct} label={S.statusJobs} size={28} />
            <span className="pf-status-jobText">{capJob?.stage ? <bdi>{capJob.stage}</bdi> : S.statusJobs}{pct != null && <> · <span className="num">{pct}%</span></>}</span>
          </span>
        )}
      </div>
      <div className="pf-status-end">
        <button type="button" className={`pf-status-pip${needs ? ' is-need' : ''}`} onClick={() => setSettingsOpen(true)} aria-haspopup="dialog" aria-label={`${S.statusCentre}: ${needs ? S.pipsNeed(needs) : S.pipsAll}`} data-testid="status-pips">
          <span className="pf-status-dots" aria-hidden="true"><i className={gpu ? (gpu.available ? 'ok' : 'off') : ''} /><i className={provider ? (provider.provider.configured ? 'ok' : 'off') : ''} /></span>
          <span>{needs ? S.pipsNeed(needs) : S.pipsAll}</span>
        </button>
        <span className="num pf-status-dur" dir="ltr" title={t('export')}>{clock}</span>
        {flash && <FlashResult report={flash} />}
      </div>
    </footer>
  );
}

/** The photosensitivity result of the last export (ADR-0009): a quiet status when it passed; otherwise the stretches, with jump-to. */
function FlashResult({ report }: { report: { verdict: 'pass' | 'fail'; ranges: { from: { value: string; timescale: number }; to: { value: string; timescale: number }; kind: 'general' | 'red'; flashesPerSecond: number; area: number }[] } }) {
  const { editor, state, t } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  if (report.verdict === 'pass') return <span className="pf-status-flash is-ok" role="status" data-testid="flash-pass" title={t('flash.passTitle')}><ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" /><span>{S.flashChecked}</span><Check size={12} strokeWidth={2.25} aria-hidden="true" /></span>;
  const rate = state.doc?.settings.frameRate;
  const sec = (x: { value: string; timescale: number }) => Number(x.value) / x.timescale;
  const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  return (
    <details className="pf-status-flashFail" data-testid="flash-fail">
      <summary role="status"><TriangleAlert size={13} strokeWidth={1.75} aria-hidden="true" /> {t('flash.fail')} ({report.ranges.length})</summary>
      <div className="pf-status-flashBody" role="group" aria-label={t('flash.fail')}>
        <p>{t('flash.failIntro')}</p>
        <ul>
          {report.ranges.map((r, i) => (
            <li key={i} data-testid="flash-range">
              <bdi dir="ltr">{clock(sec(r.from))}–{clock(sec(r.to))}</bdi> · {t(r.kind === 'red' ? 'flash.red' : 'flash.general')} {r.flashesPerSecond} {t('flash.perSecond')} · {Math.round(r.area * 100)}% {t('flash.area')}
              {rate && <button type="button" className="pf-status-jump" onClick={() => editor.seek(Math.floor((sec(r.from) * rate.num) / rate.den))} data-testid="flash-jump">{t('flash.jump')}</button>}
            </li>
          ))}
        </ul>
        <p className="muted">{t('flash.method')}</p>
      </div>
    </details>
  );
}
