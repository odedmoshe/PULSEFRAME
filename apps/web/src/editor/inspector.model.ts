/**
 * What the inspector shows for what is selected (UX_REDESIGN §4.6), as pure functions: the kind of object, its tab set (one
 * category per screen), the panels each mode offers, and the cut a clip starts with. No React, no DOM: tested on their own.
 */
import * as T from '@pulseframe/time';
import { clipEnd, findClip, handleBeforeStart, previousAdjacent, spareAfter, type Clip, type MediaClip, type ProjectDocument, type Track } from '@pulseframe/core';
import type { Workspace } from './store.ts';

/** The panels of the inspector column. `clip` is whatever is selected; `all` is every panel on one screen. */
export const INSPECTOR_PAGES = ['clip', 'speech', 'captions', 'sound', 'review', 'deliver', 'recipes', 'all'] as const;
/** `shorts` is the Shorts panel (ADR-0018): offered only by the Shorts mode, so it is not one of the pages "all" lays out or the custom mode ticks. */
export type InspectorPage = (typeof INSPECTOR_PAGES)[number] | 'shorts';
export const REAL_PAGES = INSPECTOR_PAGES.filter((p): p is Exclude<(typeof INSPECTOR_PAGES)[number], 'all'> => p !== 'all');

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
    shorts: ['shorts', 'deliver'],
    // perform (ADR-0025): the view lives on the stage; the inspector keeps the selection
    perform: ['clip'],
    custom: opts.custom,
  };
  const pages = base[workspace];
  return opts.waiting > 0 && !pages.includes('review') ? [...pages, 'review'] : pages;
}

export type ObjectKind = 'none' | 'multi' | 'video' | 'image' | 'text' | 'drawn' | 'caption' | 'sound' | 'adjustment' | 'cut';
/** The clip actions the header's ⋯ menu and the inspector's footer offer. */
export type ObjectAction = 'duplicate' | 'split' | 'delete';
/**
 * What the header's ⋯ menu and the footer may do to what the inspector says is selected. Nothing for the project, and
 * nothing for a cut: a cut is the meeting of two clips, and the selection under it is the clip after it, so "duplicate" or
 * the bin there would act on a clip the panel does not name. A multi-selection has no single playhead split.
 */
export function objectActions(kind: ObjectKind): ObjectAction[] {
  if (kind === 'none' || kind === 'cut') return [];
  if (kind === 'multi') return ['duplicate', 'delete'];
  return ['duplicate', 'split', 'delete'];
}
export type ObjectTab =
  | 'project' | 'shared' | 'basic' | 'motion' | 'speed' | 'colour' | 'effects' | 'mask' | 'audio'
  | 'text' | 'style' | 'anim' | 'place' | 'cue' | 'timing' | 'soundfx' | 'beat' | 'range' | 'cut' | 'transition'
  /** a drawn clip's own panel (drawnPanels.tsx: the panel its kind registers) */
  | 'drawn';

/** What kind of object the selection is. A cut wins while one is chosen (it belongs to the single selected clip). */
export function objectKind(doc: ProjectDocument | null, selection: readonly string[], cutClipId: string | null): ObjectKind {
  if (!doc || selection.length === 0) return 'none';
  if (selection.length > 1) return 'multi';
  const f = findClip(doc, selection[0]!);
  if (!f) return 'none';
  if (cutClipId === f.clip.id && cutBefore(doc, f.clip.id)) return 'cut';
  if (f.clip.type === 'text') return 'text';
  if (f.clip.type === 'drawn') return 'drawn'; // a drawing or a map (wave 8 carrier): placement like a title, no words
  if (f.clip.type === 'caption') return 'caption';
  if (f.clip.type === 'adjustment') return 'adjustment';
  if (f.track.kind === 'audio') return 'sound';
  return doc.assets[f.clip.assetId]?.kind === 'image' ? 'image' : 'video';
}

const TABS: Record<ObjectKind, readonly ObjectTab[]> = {
  none: ['project'],
  multi: ['shared'],
  video: ['basic', 'motion', 'speed', 'beat', 'colour', 'effects', 'mask', 'audio'], // 'beat': the impact controls (wave 7 musicfit; the moment is usually in the picture)
  image: ['basic', 'motion', 'colour', 'effects', 'mask'],
  text: ['text', 'style', 'anim', 'place', 'effects'],
  drawn: ['drawn', 'place', 'effects'],
  caption: ['cue', 'timing'],
  sound: ['audio', 'soundfx', 'speed', 'beat'],
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
  /** spare source after the previous clip's end, in frames; null = a still image or a freeze frame (it never runs out; core spareAfter) */
  handleAfter: number | null;
  /** spare source before the next clip's start, in frames; null = a still image */
  handleBefore: number | null;
}
const clampSpare = (n: number | null) => (n === null ? null : Math.max(0, n));
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
    handleAfter: prevAsset ? clampSpare(spareAfter(prev, prevAsset, rate)) : null,
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

// trackRole moved to core (editHelpers.ts, ADR-0027 lead contract (e)): the mixer strip and the command bar's «המוזיקה» read one rule.
export { trackRole, type TrackRole } from '@pulseframe/core';

/** The ready text style a title's own style matches (font, weight, colour, box and outline as the style set them), or null. */
export function matchingPreset<P extends { id: string; style: { fontFamily: string; fontWeight: number; color: string; background: string | null; stroke: string | null; strokeFrac: number } }>(
  style: { fontFamily: string; fontWeight?: number; color: string; background?: string | null; stroke?: string | null; strokeFrac?: number }, presets: readonly P[]): P | null {
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null)?.toLowerCase() === (b ?? null)?.toLowerCase();
  return presets.find((p) => p.style.fontFamily === style.fontFamily && p.style.fontWeight === (style.fontWeight ?? 400) && same(p.style.color, style.color)
    && same(p.style.background, style.background) && same(p.style.stroke, style.stroke) && Math.abs(p.style.strokeFrac - (style.strokeFrac ?? 0)) < 1e-6) ?? null;
}
