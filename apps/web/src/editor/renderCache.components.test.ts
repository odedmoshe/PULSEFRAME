/** The lane and the sheet block of the render cache, rendered to markup (ADR-0024): states, test ids, one tab stop, Hebrew lines with numbers in <bdi dir=ltr>. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SegmentPlanView, SegmentRun } from '@pulseframe/core';
import { CacheDoneLine, CacheFailure, ExportReuseLine, cacheStageLabel, fastDisabledReason } from './ExportReuseLine.tsx';
import { RenderCacheLane } from './RenderCacheLane.tsx';
import { RENDER_CACHE_TESTIDS as TID } from './renderCache.testids.ts';
import type { SegmentPlanState } from './store.ts';

const cache = { enabled: true, capBytes: 2 ** 31, usedBytes: 0, segments: 0, highWaterBytes: 0, autoClear: true, minFreeBytes: 2 ** 30 };
const run = (state: SegmentRun['state'], firstSegment: number, segments: number, firstFrame: number, frames: number): SegmentRun => ({ state, firstSegment, segments, firstFrame, frames });
function view(runs: SegmentRun[], over: Partial<SegmentPlanView> = {}, seconds: number | null = null): SegmentPlanView {
  const by = (s: string) => runs.filter((r) => r.state === s).reduce((n, r) => n + r.segments, 0);
  return { revision: 1, mode: 'incremental', segFrames: 60, firstFrame: 0, frames: runs.reduce((n, r) => n + r.frames, 0), segments: { total: runs.reduce((n, r) => n + r.segments, 0), cached: by('cached'), render: by('render'), uncacheable: by('uncacheable') },
    framesToRender: runs.filter((r) => r.state !== 'cached').reduce((n, r) => n + r.frames, 0), runs, uncacheable: [], estimate: { seconds, basis: 'history', bytesToStore: null }, cache, keyingMs: 30, ...over };
}
const ready = (v: SegmentPlanView): SegmentPlanState => ({ status: 'ready', view: v, revision: v.revision });
const edited = view([run('cached', 0, 142, 0, 8520), run('render', 142, 16, 8520, 960), run('cached', 158, 142, 9480, 8520)], {}, 40);
const R = { num: 30, den: 1 };
const lane = (plan: SegmentPlanState, lang: 'he' | 'en' = 'he') => renderToStaticMarkup(createElement(RenderCacheLane, { plan, pxPerSecond: 20, frameRate: R, lang, onSeek: () => {}, onRefresh: () => {} }));
const line = (plan: SegmentPlanState, o: { fast?: boolean; format?: string; codes?: string[]; lang?: 'he' | 'en' } = {}) =>
  renderToStaticMarkup(createElement(ExportReuseLine, { plan, fastExport: o.fast ?? true, onFastExport: () => {}, format: o.format ?? 'mp4-h264-aac', blockerCodes: o.codes ?? [], lang: o.lang ?? 'he', frameRate: R }));

describe('RenderCacheLane', () => {
  it('draws nothing when off, and nothing without a plan to show', () => {
    expect(lane({ status: 'off', view: null, revision: null })).toBe('');
    expect(lane({ status: 'ready', view: null, revision: null })).toBe('');
  });
  it('draws one stretch per run with its state, frames and a tooltip, and exactly one focusable summary', () => {
    const html = lane(ready(edited));
    expect([...html.matchAll(/data-testid="cache-stretch"/g)]).toHaveLength(3);
    expect(html).toContain('data-state="render"');
    expect(html).toContain('title="השתנה — ירונדר בייצוא הבא"');
    expect(html).toContain('title="שמור במטמון — לא ירונדר שוב"');
    expect([...html.matchAll(/<button/g)]).toHaveLength(1);
    expect(html).toContain('aria-label="מטמון רינדור: 284 מתוך 300 מקטעים שמורים"');
    expect(html).toContain('dir="ltr"');
  });
  it('is busy while updating, and English words the summary', () => {
    expect(lane({ status: 'updating', view: edited, revision: 1 })).toContain('aria-busy="true"');
    expect(lane(ready(edited), 'en')).toContain('aria-label="Render cache: 284 of 300 segments kept"');
  });
  it('offers «רענון» only after a slow keying', () => {
    expect(lane(ready(edited))).not.toContain(`data-testid="${TID.refresh}"`);
    expect(lane(ready(view(edited.runs, { keyingMs: 4000 })))).toContain(`data-testid="${TID.refresh}"`);
  });
});

describe('ExportReuseLine', () => {
  it('shows the Hebrew reuse and render lines with each number isolated, and the honest notes', () => {
    const html = line(ready(edited));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('<bdi dir="ltr">284</bdi>');
    expect(html.replace(/<[^>]+>/g, '')).toContain('נעשה שימוש חוזר ב-284 מתוך 300 מקטעים');
    expect(html.replace(/<[^>]+>/g, '')).toContain('יירנדרו מחדש 16 מקטעים (32 שניות של סרטון)');
    expect(html).toContain('data-note="ripple"');
    expect(html).toContain('data-note="music"');
    expect(html.replace(/<[^>]+>/g, '')).toContain('זמן משוער: כ-40 שניות');
  });
  it('writes the estimate only when it was measured', () => {
    expect(line(ready(view(edited.runs)))).not.toContain(`data-testid="${TID.eta}"`);
  });
  it('first export, nothing changed, checking, error', () => {
    expect(line(ready(view([run('render', 0, 300, 0, 18000)])))).toContain('data-state="first"');
    expect(line(ready(view([run('cached', 0, 300, 0, 18000)])))).toContain('data-state="nothing"');
    expect(line({ status: 'updating', view: null, revision: null })).toContain('בודק מה השתנה…');
    expect(line({ status: 'error', view: null, revision: null })).toContain('data-state="error"');
  });
  it('says nothing while the switch is off, and gives the reason when the switch cannot be used', () => {
    expect(line(ready(edited), { fast: false })).not.toContain('role="status"');
    const webm = line(ready(edited), { format: 'webm-vp9-opus' });
    expect(webm).toContain('disabled');
    expect(webm).toContain('ייצוא מהיר זמין כרגע רק ל־MP4');
    expect(webm).toContain(`data-testid="${TID.fastReason}"`);
    expect(webm).not.toContain('role="status"');
  });
  it('reasons by blocker code', () => {
    expect(fastDisabledReason('mp4-h264-aac', ['render_cache_disabled'], 'en')).toContain('turned off');
    expect(fastDisabledReason('mp4-h264-aac', ['incremental_unavailable'], 'en')).toContain('not available');
    expect(fastDisabledReason('mp4-h264-aac', [], 'en')).toBeNull();
    expect(fastDisabledReason('webm-vp9-opus', [], 'en')).toContain('MP4');
  });
});

describe('the helpers of the sheet', () => {
  it('stage labels, the done line and the failure text', () => {
    expect(cacheStageLabel('rendering 2/16', 'he')).toBe('רינדור מקטעים שהשתנו 2/16');
    const report = { reused: 284, rendered: 16, uncacheable: 0, notStored: 0, selfCheck: { framesChecked: 12 } } as never;
    expect(renderToStaticMarkup(createElement(CacheDoneLine, { report, lang: 'he' })).replace(/<[^>]+>/g, '')).toBe('284 מקטעים מהמטמון · 16 רונדרו · בדיקה עצמית: 12 פריימים זהים ✓');
    expect(renderToStaticMarkup(createElement(CacheFailure, { code: 'render_cache_self_check_failed', lang: 'he' }))).toContain('הבדיקה העצמית מצאה מקטע שמור');
    expect(renderToStaticMarkup(createElement(CacheFailure, { code: 'export_failed', lang: 'he' }))).toBe('');
  });
});
