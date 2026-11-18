/**
 * A small strip of a file's measured movement inside the picture and sound level (ADR-0026), with the chosen window marked:
 * inline SVG from MomentsData (familyFilm.logic.ts stripGeometry), left to right in time, aria-hidden (the reason line is its
 * text equivalent), static (nothing animates; prefers-reduced-motion changes nothing). FILM_TESTIDS.strip.
 */
import { useMemo, type ReactElement } from 'react';
import type { MomentsData } from '@pulseframe/core';
import { FILM_TESTIDS as TID } from './familyFilm.testids.ts';
import { stripGeometry } from './familyFilm.logic.ts';
import './familyFilm.css';

export interface MomentsStripProps { data: MomentsData | null; window: { fromFrame: number; toFrame: number; peakFrame: number } | null; width?: number; height?: number }
export function MomentsStrip({ data, window, width = 160, height = 28 }: MomentsStripProps): ReactElement | null {
  const g = useMemo(() => (data ? stripGeometry(data, window, width, height) : null), [data, window?.fromFrame, window?.toFrame, window?.peakFrame, width, height]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return null;
  return (
    <svg className="pf-film-strip" data-testid={TID.strip} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false" direction="ltr">
      <rect className="pf-film-strip-bg" x="0" y="0" width={width} height={height} />
      {g.window && <rect className="pf-film-strip-win" x={g.window.x} y="0" width={g.window.width} height={height} />}
      {g.level && <path className="pf-film-strip-level" d={g.level} fill="none" />}
      {g.inner && <path className="pf-film-strip-inner" d={g.inner} fill="none" />}
      {g.window && <line className="pf-film-strip-peak" x1={g.window.peakX} x2={g.window.peakX} y1="0" y2={height} />}
    </svg>
  );
}
