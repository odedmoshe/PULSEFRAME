/**
 * Mount points of drawn clips in the inspector (wave 8 carrier, core drawn.ts). The inspector shows a drawn clip's common
 * section (Position tab: position, size, rotation, opacity and its keys, follow, time; Effects tab) and, in its own tab, the
 * panel its kind registers here (ink: the drawing's speed and replay; map: the stops and look). No text control is ever shown.
 * A kind without a panel in this build shows a neutral note.
 */
import type { ComponentType } from 'react';
import type { DrawnClip } from '@pulseframe/core';

export interface DrawnPanelProps { clip: DrawnClip; lang: 'he' | 'en' }
const PANELS = new Map<string, ComponentType<DrawnPanelProps>>();
/** Register the inspector panel of a drawn kind (once per page). */
export function registerDrawnPanel(kind: string, panel: ComponentType<DrawnPanelProps>): void {
  if (PANELS.has(kind)) throw new Error(`drawn kind ${kind} already has a panel`);
  PANELS.set(kind, panel);
}
export const drawnPanel = (kind: string): ComponentType<DrawnPanelProps> | undefined => PANELS.get(kind);
