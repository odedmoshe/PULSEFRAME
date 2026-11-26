/**
 * The result of a drawing (wave 8 motioncode, W3): three stills first, then a paused video on a checkerboard that starts only on a press
 * (never autoplays, also not under prefers-reduced-motion), the measured lines with their numbers in <bdi dir="ltr">, the warnings as
 * plain lines, and the honest line that nobody has watched it. Pure presentation: the dialog owns the buttons and the calls.
 */
import { useRef, useState, type ReactElement } from 'react';
import { Pause, Play } from 'lucide-react';
import type { MadeJobReport } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Button } from '../../ds/index.ts';
import { madeApi } from './madeApi.ts';
import { MADE_TESTIDS as TID } from './made.testids.ts';
import { madeT, type Part } from './made.strings.ts';
import { checkLines, warningLines } from './made.logic.ts';

export function Parts({ parts }: { parts: Part[] }): ReactElement {
  return <>{parts.map((p, i) => ('text' in p ? <span key={i}>{p.text}</span> : <bdi key={i} dir="ltr">{p.num}</bdi>))}</>;
}

export interface MadeResultProps { projectId: string; jobId: string; report: MadeJobReport; lang: Lang; renderWarnings?: { what: string; at: number }[] }
export function MadeResult({ projectId, jobId, report, lang, renderWarnings }: MadeResultProps): ReactElement {
  const t = madeT(lang);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const rec = report.record;
  const checks = rec ? checkLines(rec, report.seconds, lang) : [];
  const warns = warningLines(report, lang, renderWarnings);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false)); else v.pause();
  };
  return (
    <section className="pf-made-result" data-testid={TID.result} aria-label={t('result')}>
      <h3 className="pf-made-h">{t('result')}</h3>
      {report.stills && (
        <div className="pf-made-stills" role="group" aria-label={t('ui.stills')}>
          {([0, 1, 2] as const).map((k) => (
            <div key={k} className="pf-made-checker">
              <img src={madeApi.stillUrl(projectId, jobId, k)} alt={t('ui.stillAlt', { k: k + 1 })} data-testid={TID.still(k)} loading="lazy" />
            </div>
          ))}
        </div>
      )}
      <div className="pf-made-videobox">
        <div className="pf-made-checker">
          {/* never autoplays: no auto-start attribute, preload only the metadata, played by the button below */}
          <video ref={video} data-testid={TID.video} src={madeApi.fileUrl(projectId, jobId)} preload="metadata" muted playsInline loop={false} aria-label={t('ui.videoAlt')}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
        </div>
        <Button variant="secondary" size="sm" icon={playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />} onClick={toggle} aria-pressed={playing} data-testid={TID.play}>{playing ? t('pause') : t('play')}</Button>
        <p className="pf-made-note">{t('browserPlays')}</p>
      </div>
      {checks.length > 0 && (
        <div>
          <h4 className="pf-made-h">{t('ui.checks')}</h4>
          <ul className="pf-made-lines" data-testid={TID.checks}>{checks.map((c) => <li key={c.key}><Parts parts={c.parts} /></li>)}</ul>
        </div>
      )}
      {warns.length > 0 && (
        <div>
          <h4 className="pf-made-h">{t('ui.warnings')}</h4>
          <ul className="pf-made-lines">{warns.map((w, i) => <li key={i} dir="auto">{w}</li>)}</ul>
        </div>
      )}
      <p className="pf-made-note" data-testid={TID.unseen}>{t('unseen')}</p>
    </section>
  );
}
