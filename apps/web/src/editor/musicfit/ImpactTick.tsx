/**
 * The ◆ tick of a marked moment on a timeline clip, and the join tick on a shortened song's clip (wave 7 musicfit track, builder C):
 * position from core timelineOfSource for the clip's impact (only while the clip shows it) and for provenance.fitted.joinAt (the
 * file's own clock); aria-hidden (the clip's own label says it is marked: see the report's change request for Timeline.tsx).
 * The timeline stays left-to-right, so the offset is from the clip's left edge in pixels whatever the interface direction.
 */
import * as T from '@pulseframe/time';
import { sourceEnd, timelineOfSource, type Clip, type ProjectDocument } from '@pulseframe/core';
import { MUSICFIT_TESTIDS as ID } from './musicFit.testids.ts';
import './musicFit.css';

export interface TickAt { kind: 'impact' | 'join'; seconds: number }
/** Where the ticks of a clip lie, in seconds from the clip's own start (pure; the test reads it). */
export function tickPositions(doc: ProjectDocument, clip: Clip): TickAt[] {
  if (clip.type !== 'media') return [];
  const out: TickAt[] = [];
  const shows = (s: T.RationalTime) => !T.lt(s, clip.sourceIn) && T.lt(s, sourceEnd(clip));
  if (clip.impact && shows(clip.impact)) out.push({ kind: 'impact', seconds: T.toSeconds(T.sub(timelineOfSource(clip, clip.impact), clip.start)) });
  const j = Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId]!.provenance.fitted : undefined;
  if (j && shows(j.joinAt)) out.push({ kind: 'join', seconds: T.toSeconds(T.sub(timelineOfSource(clip, j.joinAt), clip.start)) });
  return out;
}

export function ImpactTick({ doc, clip, pps }: { doc: ProjectDocument; clip: Clip; pps: number }) {
  const ticks = tickPositions(doc, clip);
  if (!ticks.length) return null;
  return (
    <>
      {ticks.map((k) => (
        <span key={k.kind} className={`mf-tick is-${k.kind}`} aria-hidden="true" data-testid={ID.impactTick} data-kind={k.kind} data-clip-id={clip.id} style={{ left: Math.round(k.seconds * pps) }}>{k.kind === 'impact' ? '◆' : '┃'}</span>
      ))}
    </>
  );
}
