/**
 * The export sheet's fast-export block (ADR-0024, plan §8): the «ייצוא מהיר: רק מה שהשתנה מאז הייצוא הקודם» switch with its hint and its
 * disabled reason (MP4 only, cache off, not available: from the plan's blocker codes), and a role=status aria-live=polite block
 * with the reuse line, what is rendered, the first-export and nothing-changed variants, the measured ETA (only when
 * estimate.seconds is not null) and the honest notes (ripple, music). Every number sits in <bdi dir="ltr">.
 * Also the helpers the redesign's ExportSheet uses for the progress rows, the done line and the self-check failure:
 * cacheStageLabel, CacheDoneLine, CacheFailure (strings in renderCache.strings.ts). Props and the editor's store state only; the
 * lead mounts it in ExportSheet.tsx / DeliverPanel.tsx and passes the plan, the switch and the plan's blocker codes.
 */
import type { ReactElement } from 'react';
import type { SegmentedExportReport } from '@pulseframe/core';
import { Switch } from '../ds/Switch.tsx';
import { DS, cx } from '../ds/util.tsx';
import './renderCache.css';
import { planSummary } from './renderCache.logic.ts';
import { RENDER_CACHE_TESTIDS as TID } from './renderCache.testids.ts';
import { cacheText, failureText, planErrorText, renderCacheStrings, stageLabel } from './renderCache.strings.ts';
import { videoSeconds } from './renderCache.logic.ts';
import { Numbers } from './RenderCacheLane.tsx';
import type { SegmentPlanState } from './store.ts';

/** The reason the switch is unavailable, or null. Blocker codes come from the plan route's 422 (core RENDER_CACHE_BLOCKER_CODES). */
export function fastDisabledReason(format: string, blockerCodes: readonly string[], lang: 'he' | 'en'): string | null {
  if (blockerCodes.includes('render_cache_disabled')) return cacheText(lang, 'cache.fast.off');
  if (blockerCodes.includes('incremental_unavailable')) return cacheText(lang, 'cache.fast.unavailable');
  if (format !== 'mp4-h264-aac' || blockerCodes.includes('incremental_format_unsupported')) return cacheText(lang, 'cache.fast.mp4Only');
  return null;
}

type LineState = 'checking' | 'ready' | 'first' | 'nothing' | 'error';

export function ExportReuseLine(props: { plan: SegmentPlanState; fastExport: boolean; onFastExport: (on: boolean) => void; format: string; blockerCodes: readonly string[]; lang: 'he' | 'en'; frameRate?: { num: number; den: number } }): ReactElement | null {
  const { plan, fastExport, onFastExport, format, blockerCodes, lang } = props;
  const rate = props.frameRate ?? { num: 30, den: 1 };
  const S = renderCacheStrings(lang);
  const reason = fastDisabledReason(format, blockerCodes, lang);
  const on = fastExport && reason === null;
  const view = plan.view;
  let state: LineState | null = null;
  if (on) {
    if (plan.status === 'error') state = 'error';
    else if (plan.status === 'updating' || !view) state = plan.status === 'off' ? null : 'checking';
    else { const sum = planSummary(view); state = sum.first ? 'first' : sum.nothingChanged ? 'nothing' : 'ready'; }
  }
  const sum = view ? planSummary(view) : null;
  const busy = state === 'checking' || (on && plan.status === 'updating');
  return (
    <div className={cx(DS, 'rc-export')} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <div className="rc-fast-row">
        <Switch checked={on} disabled={reason !== null} onChange={onFastExport} testId={TID.fastSwitch} label={cacheText(lang, 'cache.fast.label')} />
        {reason === null ? <p className="rc-hint">{cacheText(lang, 'cache.fast.hint')}</p> : <p className="rc-reason" data-testid={TID.fastReason}>{reason}</p>}
      </div>
      {reason === null && fastExport && (
        <div className="rc-status" role="status" aria-live="polite" aria-busy={busy || undefined} data-testid={TID.reuseLine} data-state={state ?? 'checking'}>
          {state === 'checking' && <p>{cacheText(lang, 'cache.plan.checking')}</p>}
          {state === 'error' && <p>{planErrorText(lang)}</p>}
          {view && sum && (state === 'ready' || state === 'first' || state === 'nothing') && (
            <>
              {state === 'first' && <p><Numbers text={S.firstExport(sum.total)} /></p>}
              {state === 'nothing' && <p>{cacheText(lang, 'cache.plan.nothing')}</p>}
              {state === 'ready' && <p><Numbers text={S.reuseLine(sum.cached, sum.total)} /></p>}
              {state === 'ready' && sum.render > 0 && <p data-testid={TID.renderLine}><Numbers text={S.renderLine(sum.render, videoSeconds(view.framesToRender - uncacheableFrames(view), rate))} /></p>}
              {sum.uncacheable > 0 && <p><Numbers text={S.uncacheableLine(sum.uncacheable)} /></p>}
              {view.estimate.seconds !== null && <p data-testid={TID.eta}><Numbers text={S.eta(view.estimate.seconds)} /></p>}
            </>
          )}
        </div>
      )}
      {reason === null && fastExport && (state === 'ready' || state === 'nothing') && (
        <ul className="rc-notes">
          <li className="rc-note" data-testid={TID.note} data-note="ripple">{cacheText(lang, 'cache.plan.ripple')}</li>
          <li className="rc-note" data-testid={TID.note} data-note="music">{cacheText(lang, 'cache.plan.music')}</li>
        </ul>
      )}
    </div>
  );
}

/** Frames of the stretches that render every time (uncacheable), so the "changed" line counts only what changed. */
function uncacheableFrames(view: NonNullable<SegmentPlanState['view']>): number {
  return view.runs.filter((r) => r.state === 'uncacheable').reduce((n, r) => n + r.frames, 0);
}

/** The label of a progress stage of the incremental route (core SEGMENTED_STAGES), or null for a stage the ordinary sheet words itself. */
export function cacheStageLabel(stage: string, lang: 'he' | 'en'): string | null { return stageLabel(stage, lang); }

/** The done line: «284 מקטעים מהמטמון · 16 רונדרו · בדיקה עצמית: 12 פריימים זהים ✓». It claims the frames it checked, not the cache. */
export function CacheDoneLine({ report, lang }: { report: SegmentedExportReport; lang: 'he' | 'en' }): ReactElement {
  const text = renderCacheStrings(lang).done({ reused: report.reused, rendered: report.rendered + report.uncacheable, framesChecked: report.selfCheck.framesChecked, notStored: report.notStored });
  return <p className={cx(DS, 'rc-done')} data-testid={TID.done} dir={lang === 'he' ? 'rtl' : 'ltr'}><Numbers text={text} /></p>;
}

/** The failure sentence of a failed incremental job (self-check or join), or null when the code is not the fast export's own. */
export function CacheFailure({ code, lang }: { code: string | undefined; lang: 'he' | 'en' }): ReactElement | null {
  const text = failureText(code, lang);
  if (!text) return null;
  return <p className={cx(DS, 'rc-failed')} role="alert" data-testid={TID.selfCheckFailed} data-code={code} dir={lang === 'he' ? 'rtl' : 'ltr'}>{text}</p>;
}
export { failureText as cacheFailureText } from './renderCache.strings.ts';
