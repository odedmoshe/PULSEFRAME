/**
 * A small strip of a file's measured movement inside the picture and sound level (ADR-0026), with the chosen window marked:
 * inline SVG from MomentsData (familyFilm.logic.ts stripGeometry), left to right in time, aria-hidden (the reason line is its
 * text equivalent), static under prefers-reduced-motion. FILM_TESTIDS.strip.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
import type { MomentsData } from '@pulseframe/core';

export interface MomentsStripProps { data: MomentsData | null; window: { fromFrame: number; toFrame: number; peakFrame: number } | null; width?: number; height?: number }
export function MomentsStrip(_props: MomentsStripProps): ReactElement | null {
  return null;
}
