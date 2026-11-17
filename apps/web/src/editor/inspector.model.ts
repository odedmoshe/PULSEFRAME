/**
 * What the inspector shows for what is selected (UX_REDESIGN §4.6), as pure functions: the kind of object, its tab set (one
 * category per screen), the panels each mode offers, and the cut a clip starts with. No React, no DOM: tested on their own.
 */
import * as T from '@pulseframe/time';
import { clipEnd, findClip, handleAfterEnd, handleBeforeStart, previousAdjacent, type Clip, type MediaClip, type ProjectDocument, type Track } from '@pulseframe/core';
import type { Workspace } from './store.ts';

/** The panels of the inspector column. `clip` is whatever is selected; `all` is every panel on one screen. */
export const INSPECTOR_PAGES = ['clip', 'speech', 'captions', 'sound', 'review', 'deliver', 'recipes', 'all'] as const;
export type InspectorPage = (typeof INSPECTOR_PAGES)[number];
export const REAL_PAGES = INSPECTOR_PAGES.filter((p): p is Exclude<InspectorPage, 'all'> => p !== 'all');

/**
 * The panels a mode offers, in order; the first is shown when the mode is chosen. Edit, Look and Motion show the selection
 * only (the work is on the object); Sound adds the mixer, Captions the caption and transcript panels, Deliver the delivery,
 * review and recipe panels. Review is also offered wherever something waits for the owner's decision.
 */
export function pagesFor(workspace: Workspace, opts: { custom: readonly InspectorPage[]; waiting: number; flat: boolean }): readonly InspectorPage[] {
  if (opts.flat) return INSPECTOR_PAGES;
  const base: Record<Workspace, readonly InspectorPage[]> = {
    pro: ['clip'], motion: ['clip'], color: ['clip'],
    quick: ['recipes', 'speech', 'captions', 'deliver'],
    captions: ['captions', 'speech', 'clip'],
    sound: ['sound', 'clip'],
    deliver: ['deliver', 'review', 'recipes'],
    custom: opts.custom,
  };
  const pages = base[workspace];
  return opts.waiting > 0 && !pages.includes('review') ? [...pages, 'review'] : pages;
}

export type ObjectKind = 'none' | 'multi' | 'video' | 'image' | 'text' | 'caption' | 'sound' | 'adjustment' | 'cut';
export type ObjectTab =
  | 'project' | 'shared' | 'basic' | 'motion' | 'speed' | 'colour' | 'effects' | 'mask' | 'audio'
  | 'text' | 'style' | 'anim' | 'place' | 'cue' | 'timing' | 'soundfx' | 'beat' | 'range' | 'cut' | 'transition';

/** What kind of object the selection is. A cut wins while one is chosen (it belongs to the single selected clip). */
export function objectKind(doc: ProjectDocument | null, selection: readonly string[], cutClipId: string | null): ObjectKind {
  if (!doc || selection.length === 0) return 'none';
  if (selection.length > 1) return 'multi';
  const f = findClip(doc, selection[0]!);
  if (!f) return 'none';
  if (cutClipId === f.clip.id && cutBefore(doc, f.clip.id)) return 'cut';
  if (f.clip.type === 'text') return 'text';
  if (f.clip.type === 'caption') return 'caption';
  if (f.clip.type === 'adjustment') return 'adjustment';
  if (f.track.kind === 'audio') return 'sound';
  return doc.assets[f.clip.assetId]?.kind === 'image' ? 'image' : 'video';
}

const TABS: Record<ObjectKind, readonly ObjectTab[]> = {
  none: ['project'],
  multi: ['shared'],
  video: ['basic', 'motion', 'speed', 'colour', 'effects', 'mask', 'audio'],
  image: ['basic', 'motion', 'colour', 'effects', 'mask'],
  text: ['text', 'style', 'anim', 'place', 'effects'],
  caption: ['cue', 'timing'],
  sound: ['audio', 'soundfx', 'beat'],
  adjustment: ['effects', 'colour', 'range'],
  cut: ['cut', 'transition'],
};
/** The tab set of an object, in order. The first one is what a new selection opens. */
export const tabsFor = (kind: ObjectKind): readonly ObjectTab[] => TABS[kind];
export const firstTab = (kind: ObjectKind): ObjectTab => TABS[kind][0]!;

/**
 * The tab a mode opens the object on, when the object has it: Look opens colour, Motion opens motion (a title: its
 * position). Null: the object's first tab.
 */
export function pinnedTab(workspace: Workspace, kind: ObjectKind): ObjectTab | null {
  const tabs = TABS[kind];
  if (workspace === 'color') return tabs.includes('colour') ? 'colour' : null;
  if (workspace === 'motion') return tabs.includes('motion') ? 'motion' : tabs.includes('place') ? 'place' : null;
  return null;
}

/** The tab to show: the one the person chose when the object has it, else the one the mode opens it on, else the object's first. */
export function activeTab(kind: ObjectKind, chosen: ObjectTab | null, workspace: Workspace): ObjectTab {
  return chosen && TABS[kind].includes(chosen) ? chosen : pinnedTab(workspace, kind) ?? firstTab(kind);
}

export interface CutInfo {
  /** the clip that ends at the cut */
  prev: MediaClip;
  /** the clip that starts at the cut (it carries the transition, if any) */
  next: MediaClip;
  track: Track;
  /** frame index of the cut on the timeline */
  frame: number;
  /** spare source after the previous clip's end, in frames; null = a still image (it never runs out) */
  handleAfter: number | null;
  /** spare source before the next clip's start, in frames; null = a still image */
  handleBefore: number | null;
}
/** The cut at the start of a picture clip: the clip that ends exactly where it starts on the same track, with both handles. */
export function cutBefore(doc: ProjectDocument, clipId: string): CutInfo | null {
  const f = findClip(doc, clipId);
  if (!f || f.clip.type !== 'media' || f.track.kind !== 'video') return null;
  const prev = previousAdjacent(f.track, f.clip);
  if (!prev) return null;
  const rate = doc.settings.frameRate;
  const prevAsset = doc.assets[prev.assetId], ownAsset = doc.assets[f.clip.assetId];
  return {
    prev, next: f.clip, track: f.track, frame: T.frameIndexAt(f.clip.start, rate),
    handleAfter: prevAsset && prevAsset.kind !== 'image' ? Math.max(0, T.frameIndexAt(handleAfterEnd(prev, prevAsset.duration), rate)) : null,
    handleBefore: ownAsset && ownAsset.kind !== 'image' ? Math.max(0, T.frameIndexAt(handleBeforeStart(f.clip), rate)) : null,
  };
}

/**
 * The two trims that move a cut by `frames` (positive = later): the side that gives frames up is trimmed first, then the
 * other side takes them, so the clips never overlap on the way. Null when a clip would vanish.
 */
export function rollCutOps(doc: ProjectDocument, cut: CutInfo, frames: number): { op: string; args: unknown }[] | null {
  if (!frames) return null;
  const rate = doc.settings.frameRate;
  const to = cut.frame + frames;
  if (to <= T.frameIndexAt(cut.prev.start, rate) || to >= T.frameIndexAt(clipEnd(cut.next), rate)) return null;
  const at = T.frameTime(to, rate);
  const a = { op: 'trim_clip', args: { clipId: cut.next.id, edge: 'start', to: at } }, b = { op: 'trim_clip', args: { clipId: cut.prev.id, edge: 'end', to: at } };
  return frames > 0 ? [a, b] : [b, a];
}

/** Frames from the cut to the nearest of `beats` (timeline seconds); 0 = on it; null without beats. Positive = the beat is later. */
export function framesToNearestBeat(cutFrame: number, beats: readonly number[], fps: number): number | null {
  let best: number | null = null;
  for (const t of beats) { const d = Math.round(t * fps) - cutFrame; if (best === null || Math.abs(d) < Math.abs(best)) best = d; }
  return best;
}

/** "0:08.12": minutes, seconds and frames of a timeline frame, for the names of cuts and the loupe. */
export function shortTimecode(frame: number, fps: number): string {
  const whole = Math.max(1, Math.round(fps));
  const s = Math.floor(frame / whole), f = frame - s * whole;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

/** Seconds as the inspector writes them: one decimal, no trailing ".0" beyond one place ("4.0", "0.5", "12.3"). */
export const secondsText = (seconds: number): string => seconds.toFixed(1);

/** How many keyframes a clip has over all its animated properties, and the names of those properties. */
export function keyframeSummary(clip: Clip): { count: number; props: string[] } {
  const k = clip.type === 'caption' ? undefined : clip.keyframes;
  const props = k ? Object.keys(k).filter((p) => (k as Record<string, unknown[] | undefined>)[p]?.length) : [];
  return { count: props.reduce((n, p) => n + ((k as Record<string, unknown[] | undefined>)[p]?.length ?? 0), 0), props };
}
