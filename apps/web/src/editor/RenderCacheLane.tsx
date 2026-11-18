/**
 * The render-cache lane (ADR-0024, plan §8): 4 px under the flash lane (token --pf-lane-cache, renderCache.css), left to right like
 * all time chrome; cached = solid line, to render = dashed amber, uncacheable = dotted, each with a tooltip (never colour alone).
 * ONE focusable summary (RENDER_CACHE_TESTIDS.summary, aria-label «מטמון רינדור: N מתוך M מקטעים שמורים») opens a popover that
 * lists up to 8 stale stretches with «קפיצה» (onSeek, a programme frame). aria-busy while updating; nothing at all when the status is
 * 'off'. Offers «רענון» (onRefresh) when autoRefresh(keyingMs) is false. Props and the editor's store state only; the lead mounts it
 * in Timeline.tsx and passes the store's segmentPlan, the timeline's pxPerSecond and the project rate.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { Button } from '../ds/Button.tsx';
import { DS, cx } from '../ds/util.tsx';
import './renderCache.css';
import { STALE_POPOVER_MAX, autoRefresh, clockOf, frameRangeOf, laneStretches, laneVisible, planSummary, staleStretchCount, staleStretches } from './renderCache.logic.ts';
import { RENDER_CACHE_TESTIDS as TID } from './renderCache.testids.ts';
import { cacheText, numberParts, renderCacheStrings } from './renderCache.strings.ts';
import type { SegmentPlanState } from './store.ts';

const TIP = { cached: 'cache.lane.cached', render: 'cache.lane.render', uncacheable: 'cache.lane.uncacheable' } as const;

/** A line with every number in <bdi dir="ltr">. */
export function Numbers({ text }: { text: string }): ReactElement {
  return <>{numberParts(text).map((p, i) => (p.num ? <bdi key={i} dir="ltr">{p.text}</bdi> : <span key={i}>{p.text}</span>))}</>;
}

export function RenderCacheLane(props: { plan: SegmentPlanState; pxPerSecond: number; frameRate: { num: number; den: number }; lang: 'he' | 'en'; onSeek: (frame: number) => void; onRefresh: () => void }): ReactElement | null {
  const { plan, pxPerSecond, frameRate, lang, onSeek, onRefresh } = props;
  const [open, setOpen] = useState(false);
  const popId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const view = plan.view;
  if (!laneVisible(plan.status, view)) return null;
  const S = renderCacheStrings(lang);
  const updating = plan.status === 'updating';
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  if (!view) return <div className={cx(DS, 'rc-lane-wrap')} data-testid={TID.lane} aria-busy="true" dir={dir} />;
  const sum = planSummary(view);
  const stretches = laneStretches(view, pxPerSecond, frameRate);
  const stale = staleStretches(view, STALE_POPOVER_MAX);
  const staleTotal = staleStretchCount(view);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) summary.current?.focus(); };
  return (
    <div ref={wrap} className={cx(DS, 'rc-lane-wrap')} data-testid={TID.lane} aria-busy={updating || undefined} dir={dir}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(true); } }}>
      <div className="rc-lane" dir="ltr" aria-hidden="true">
        {stretches.map((s, i) => (
          <i key={i} className="rc-stretch" data-testid={TID.stretch} data-state={s.state} data-first-frame={s.firstFrame} data-frames={s.frames}
            title={cacheText(lang, TIP[s.state])} style={{ left: s.x, width: s.width }} />
        ))}
      </div>
      <button ref={summary} type="button" className="rc-summary" data-testid={TID.summary} aria-label={S.laneSummary(sum.cached, sum.total)}
        aria-expanded={open} aria-controls={open ? popId : undefined} onClick={() => setOpen((o) => !o)} />
      {!autoRefresh(view.keyingMs) && (
        <Button className="rc-refresh" variant="ghost" size="sm" data-testid={TID.refresh} busy={updating} onClick={onRefresh}>{cacheText(lang, 'cache.lane.refresh')}</Button>
      )}
      {open && (
        <div id={popId} className="rc-popover" role="group" aria-label={cacheText(lang, 'cache.lane.label')} data-testid={TID.popover}>
          <h4><Numbers text={S.laneSummary(sum.cached, sum.total)} /></h4>
          {stale.length === 0 ? (
            <p>{cacheText(lang, 'cache.plan.nothing')}</p>
          ) : (
            <>
              <p>{cacheText(lang, 'cache.lane.stale')}</p>
              <ul className="rc-stale-list">
                {stale.map((s) => (
                  <li key={s.firstFrame} className="rc-stale" data-testid={TID.stale} data-first-frame={s.firstFrame} data-frames={s.frames}>
                    <span className="rc-stale-text">
                      <span><Numbers text={`${clockOf(s.firstFrame, frameRate)} – ${clockOf(s.firstFrame + s.frames, frameRate)}`} /></span>
                      <small><Numbers text={frameRangeOf(s)} /></small>
                    </span>
                    <Button size="sm" variant="secondary" data-testid={TID.jump} onClick={() => { onSeek(s.firstFrame); }}>{cacheText(lang, 'cache.lane.jump')}</Button>
                  </li>
                ))}
              </ul>
              {staleTotal > stale.length && <span className="rc-more"><Numbers text={lang === 'he' ? `ועוד ${staleTotal - stale.length}` : `and ${staleTotal - stale.length} more`} /></span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
