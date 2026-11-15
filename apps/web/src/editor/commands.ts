/**
 * Command registry (SPEC §2/§3): one definition drives keyboard shortcuts, the command palette and
 * buttons. Bindings use physical key codes (`KeyS`, `BracketLeft`) so they survive a Hebrew layout,
 * and are remappable; overrides are personal settings in localStorage, never in the project.
 */
import * as T from '@pulseframe/time';
import type { Key } from '@pulseframe/i18n';
import { findClip, type Clip } from '@pulseframe/core';
import type { Editor } from './store.ts';

export interface Command {
  id: string;
  label: Key;
  group: 'transport' | 'edit' | 'history' | 'keyframe' | 'view' | 'file';
  /** Default bindings, e.g. 'Space', 'Shift+ArrowRight', 'Mod+KeyZ' (Mod = Ctrl or Cmd). */
  keys: string[];
  enabled?(e: Editor): boolean;
  run(e: Editor): void | Promise<unknown>;
}

const sel = (e: Editor) => e.selected?.clip;
/** Selected clips that still exist, read when the command runs. */
const selectedClips = (e: Editor) => { const doc = e.doc; return doc ? e.getState().selection.map((id) => findClip(doc, id)?.clip).filter((c): c is Clip => !!c) : []; };
const nudge = (frames: number) => (e: Editor) => {
  const clips = selectedClips(e);
  if (!clips.length) return;
  if (clips.length === 1) {
    const target = T.frameIndexAt(clips[0]!.start, e.rate) + frames;
    if (target >= 0) return e.commit([{ op: 'move_clip', args: { clipId: clips[0]!.id, start: T.frameTime(target, e.rate) } }], 'Nudge clip');
    return;
  }
  return e.commit([{ op: 'move_clips', args: { clipIds: clips.map((c) => c.id), delta: T.frameTime(frames, e.rate) } }], 'Nudge clips');
};
/** Delete every selected clip in one transaction. A linked partner is removed by its clip's own delete, so it is not listed twice. */
const deleteSelected = (e: Editor) => {
  const clips = selectedClips(e);
  const seen = new Set<string>();
  const ops = clips.filter((c) => { const g = c.type === 'media' ? c.linkGroupId : null; if (!g) return true; if (seen.has(g)) return false; seen.add(g); return true; }).map((c) => ({ op: 'delete_clip', args: { clipId: c.id } }));
  return ops.length ? e.commit(ops, 'Delete') : undefined;
};
const step = (frames: number) => (e: Editor) => e.seek(e.frame + frames);
/** Add keyframes for position, scale, rotation and opacity at the playhead with the values currently shown. */
const addKeyframe = (e: Editor) => {
  const c = sel(e);
  if (!c) return;
  const now = e.transformNow(c);
  const time = T.sub(e.playhead, c.start);
  return e.commit((['x', 'y', 'scale', 'rotation', 'opacity'] as const).map((property) => ({ op: 'set_keyframe', args: { clipId: c.id, property, time, value: now[property] } })), 'Add keyframe');
};
const removeKeyframe = (e: Editor) => {
  const c = sel(e);
  if (!c?.keyframes) return;
  const time = T.sub(e.playhead, c.start);
  const ops = (['x', 'y', 'scale', 'rotation', 'opacity'] as const).filter((p) => c.keyframes?.[p]?.some((k) => T.eq(k.time, time))).map((property) => ({ op: 'delete_keyframe', args: { clipId: c.id, property, time } }));
  return ops.length ? e.commit(ops, 'Remove keyframe') : undefined;
};
/** Jump to the previous/next keyframe of the selected clip. */
const gotoKeyframe = (dir: 1 | -1) => (e: Editor) => {
  const c = sel(e);
  if (!c?.keyframes) return;
  const frames = [...new Set(Object.values(c.keyframes).flatMap((ks) => (ks ?? []).map((k) => T.frameIndexAt(T.add(c.start, k.time), e.rate))))].sort((a, b) => a - b);
  const next = dir > 0 ? frames.find((f) => f > e.frame) : [...frames].reverse().find((f) => f < e.frame);
  if (next !== undefined) e.seek(next);
};
/** User markers of the main sequence as frame numbers, ascending. */
export const markerFrames = (e: Editor) => {
  const doc = e.doc;
  if (!doc) return [];
  return Object.values(doc.markers ?? {}).filter((m) => m.sequenceId === doc.mainSequenceId).map((m) => T.frameIndexAt(m.time, e.rate)).sort((a, b) => a - b);
};
const gotoMarker = (dir: 1 | -1) => (e: Editor) => {
  const frames = markerFrames(e);
  const next = dir > 0 ? frames.find((f) => f > e.frame) : [...frames].reverse().find((f) => f < e.frame);
  if (next !== undefined) e.seek(next);
};
const selectAdjacent = (dir: 1 | -1) => (e: Editor) => {
  const doc = e.doc;
  if (!doc) return;
  const all = [...doc.sequences[doc.mainSequenceId]!.tracks].reverse().flatMap((t) => t.clips.map((c) => c.id));
  if (!all.length) return;
  const i = all.indexOf(e.getState().selection[0] ?? '');
  e.select(all[(i + dir + all.length) % all.length]!);
};

export const COMMANDS: Command[] = [
  { id: 'transport.toggle', label: 'cmd.playPause', group: 'transport', keys: ['Space'], run: (e) => (e.player?.playing ? e.player.pause() : e.player?.play()) },
  // Shuttle: L forwards (play, then 2×, 4×, 8×), J backwards (1×, 2×, 4×, 8×). Faster than 1× and backwards are silent. Space stops.
  { id: 'transport.shuttleForward', label: 'cmd.shuttleForward', group: 'transport', keys: ['KeyL'], enabled: (e) => (e.player?.frameCount ?? 0) > 0, run: (e) => { const p = e.player; if (!p) return; const r = p.playing ? (p.shuttleRate || 1) : 0; p.shuttle(r > 0 ? Math.min(8, r * 2) : 1); } },
  { id: 'transport.shuttleBack', label: 'cmd.shuttleBack', group: 'transport', keys: ['KeyJ'], enabled: (e) => (e.player?.frameCount ?? 0) > 0, run: (e) => { const p = e.player; if (!p) return; const r = p.playing ? (p.shuttleRate || 1) : 0; p.shuttle(r < 0 ? Math.max(-8, r * 2) : -1); } },
  { id: 'transport.loop', label: 'cmd.loop', group: 'transport', keys: ['Shift+KeyL'], run: (e) => e.toggleLoop() },
  { id: 'transport.prevFrame', label: 'frame.prev', group: 'transport', keys: ['ArrowLeft'], run: step(-1) },
  { id: 'transport.nextFrame', label: 'frame.next', group: 'transport', keys: ['ArrowRight'], run: step(1) },
  { id: 'transport.back10', label: 'cmd.back10', group: 'transport', keys: ['Shift+ArrowLeft'], run: step(-10) },
  { id: 'transport.forward10', label: 'cmd.forward10', group: 'transport', keys: ['Shift+ArrowRight'], run: step(10) },
  { id: 'transport.start', label: 'cmd.goStart', group: 'transport', keys: ['Home'], run: (e) => e.seek(0) },
  { id: 'transport.end', label: 'cmd.goEnd', group: 'transport', keys: ['End'], run: (e) => e.seek((e.player?.frameCount ?? 1) - 1) },
  { id: 'marker.add', label: 'marker.add', group: 'edit', keys: ['KeyM'], enabled: (e) => !!e.doc && !markerFrames(e).includes(e.frame), run: (e) => e.commit([{ op: 'add_marker', args: { time: e.playhead } }], 'Add marker') },
  { id: 'marker.next', label: 'marker.next', group: 'transport', keys: ['Shift+KeyM'], enabled: (e) => markerFrames(e).some((f) => f > e.frame), run: gotoMarker(1) },
  { id: 'marker.prev', label: 'marker.prev', group: 'transport', keys: ['Alt+KeyM'], enabled: (e) => markerFrames(e).some((f) => f < e.frame), run: gotoMarker(-1) },
  { id: 'edit.split', label: 'split', group: 'edit', keys: ['KeyS'], enabled: (e) => e.playheadInsideSelection, run: (e) => e.commit([{ op: 'split_clip', args: { clipId: sel(e)!.id, at: e.playhead } }], 'Split') },
  { id: 'edit.delete', label: 'delete', group: 'edit', keys: ['Delete', 'Backspace'], enabled: (e) => !!sel(e), run: deleteSelected },
  { id: 'edit.cut', label: 'cmd.cut', group: 'edit', keys: ['Mod+KeyX'], enabled: (e) => e.getState().selection.length > 0, run: (e) => e.cutSelection() },
  { id: 'edit.copy', label: 'cmd.copy', group: 'edit', keys: ['Mod+KeyC'], enabled: (e) => e.getState().selection.length > 0, run: (e) => e.copySelection() },
  { id: 'edit.paste', label: 'cmd.paste', group: 'edit', keys: ['Mod+KeyV'], enabled: (e) => e.clipboardLive.length > 0, run: (e) => e.pasteClipboard() },
  { id: 'edit.duplicate', label: 'cmd.duplicate', group: 'edit', keys: ['Mod+KeyD'], enabled: (e) => e.getState().selection.length > 0, run: (e) => e.duplicateSelection() },
  { id: 'edit.trimStart', label: 'trim.start', group: 'edit', keys: ['BracketLeft'], enabled: (e) => e.playheadInsideSelection, run: (e) => e.commit([{ op: 'trim_clip', args: { clipId: sel(e)!.id, edge: 'start', to: e.playhead } }], 'Trim') },
  { id: 'edit.trimEnd', label: 'trim.end', group: 'edit', keys: ['BracketRight'], enabled: (e) => e.playheadInsideSelection, run: (e) => e.commit([{ op: 'trim_clip', args: { clipId: sel(e)!.id, edge: 'end', to: e.playhead } }], 'Trim') },
  { id: 'edit.nudgeLeft', label: 'cmd.nudgeLeft', group: 'edit', keys: ['Alt+ArrowLeft'], enabled: (e) => !!sel(e), run: nudge(-1) },
  { id: 'edit.nudgeRight', label: 'cmd.nudgeRight', group: 'edit', keys: ['Alt+ArrowRight'], enabled: (e) => !!sel(e), run: nudge(1) },
  { id: 'edit.nudgeLeft10', label: 'cmd.nudgeLeft10', group: 'edit', keys: ['Alt+Shift+ArrowLeft'], enabled: (e) => !!sel(e), run: nudge(-10) },
  { id: 'edit.nudgeRight10', label: 'cmd.nudgeRight10', group: 'edit', keys: ['Alt+Shift+ArrowRight'], enabled: (e) => !!sel(e), run: nudge(10) },
  { id: 'edit.selectAll', label: 'cmd.selectAll', group: 'edit', keys: ['Mod+KeyA'], enabled: (e) => !!e.doc, run: (e) => e.selectAll() },
  { id: 'edit.selectNext', label: 'cmd.selectNext', group: 'edit', keys: ['Alt+ArrowDown'], run: selectAdjacent(1) },
  { id: 'edit.selectPrev', label: 'cmd.selectPrev', group: 'edit', keys: ['Alt+ArrowUp'], run: selectAdjacent(-1) },
  { id: 'edit.deselect', label: 'cmd.deselect', group: 'edit', keys: ['Escape'], enabled: (e) => (!!sel(e) || e.getState().cutPending.length > 0) && !e.getState().paletteOpen, run: (e) => { e.clearCut(); e.select(null); } },
  { id: 'edit.addText', label: 'text.add', group: 'edit', keys: ['KeyT'], run: (e) => e.addText() },
  { id: 'keyframe.add', label: 'cmd.keyframeAdd', group: 'keyframe', keys: ['KeyK'], enabled: (e) => e.playheadOnSelection, run: addKeyframe },
  { id: 'keyframe.remove', label: 'cmd.keyframeRemove', group: 'keyframe', keys: ['Shift+KeyK'], enabled: (e) => e.playheadOnSelection && !!sel(e)?.keyframes, run: removeKeyframe },
  { id: 'keyframe.prev', label: 'cmd.keyframePrev', group: 'keyframe', keys: ['Comma'], enabled: (e) => !!sel(e)?.keyframes, run: gotoKeyframe(-1) },
  { id: 'keyframe.next', label: 'cmd.keyframeNext', group: 'keyframe', keys: ['Period'], enabled: (e) => !!sel(e)?.keyframes, run: gotoKeyframe(1) },
  { id: 'history.undo', label: 'undo', group: 'history', keys: ['Mod+KeyZ'], run: (e) => e.history('undo') },
  { id: 'history.redo', label: 'redo', group: 'history', keys: ['Mod+Shift+KeyZ', 'Mod+KeyY'], run: (e) => e.history('redo') },
  { id: 'file.export', label: 'export', group: 'file', keys: ['Mod+KeyE'], enabled: (e) => (e.player?.frameCount ?? 0) > 0, run: (e) => e.startExport() },
  { id: 'view.palette', label: 'cmd.palette', group: 'view', keys: ['Mod+KeyK'], run: (e) => e.set({ paletteOpen: !e.getState().paletteOpen }) },
  { id: 'view.language', label: 'lang.label', group: 'view', keys: [], run: (e) => e.setLang(e.getState().lang === 'he' ? 'en' : 'he') },
  { id: 'view.zoomIn', label: 'cmd.zoomIn', group: 'view', keys: ['Equal'], run: (e) => e.set({ pxPerSecond: Math.min(720, e.getState().pxPerSecond * 1.5) }) },
  { id: 'view.zoomOut', label: 'cmd.zoomOut', group: 'view', keys: ['Minus'], run: (e) => e.set({ pxPerSecond: Math.max(10, e.getState().pxPerSecond / 1.5) }) },
];

/** Canonical chord for an event: modifiers in fixed order + physical key code. */
export function chordOf(ev: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string {
  return `${ev.ctrlKey || ev.metaKey ? 'Mod+' : ''}${ev.altKey ? 'Alt+' : ''}${ev.shiftKey ? 'Shift+' : ''}${ev.code}`;
}
const STORAGE = 'pf.keymap.v1';
export class Keymap {
  private overrides: Record<string, string[]>;
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
    let o: unknown = null;
    try { o = JSON.parse(this.storage?.getItem(STORAGE) ?? 'null'); } catch { /* corrupt setting: fall back to defaults */ }
    this.overrides = o && typeof o === 'object' ? (o as Record<string, string[]>) : {};
  }
  keysFor(id: string): string[] { return this.overrides[id] ?? COMMANDS.find((c) => c.id === id)?.keys ?? []; }
  /** Command bound to a chord, if any. */
  lookup(chord: string): Command | undefined { return COMMANDS.find((c) => this.keysFor(c.id).includes(chord)); }
  /** Rebind. A chord can belong to one command only: it is removed from any other command. Returns the commands that lost it. */
  bind(id: string, keys: string[]): string[] {
    const displaced: string[] = [];
    for (const c of COMMANDS) {
      if (c.id === id) continue;
      const cur = this.keysFor(c.id);
      const kept = cur.filter((k) => !keys.includes(k));
      if (kept.length !== cur.length) { this.overrides[c.id] = kept; displaced.push(c.id); }
    }
    this.overrides[id] = keys;
    this.storage?.setItem(STORAGE, JSON.stringify(this.overrides));
    return displaced;
  }
  reset() { this.overrides = {}; this.storage?.removeItem(STORAGE); }
  isCustom(id: string) { return id in this.overrides; }
}
/** Readable label for a chord, e.g. 'Mod+Shift+KeyZ' → 'Ctrl+Shift+Z'. Key names stay Latin in both languages. */
export function chordLabel(chord: string, mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)): string {
  return chord.split('+').map((p) => (p === 'Mod' ? (mac ? '⌘' : 'Ctrl') : p.replace(/^Key|^Digit/, '').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Comma', ',').replace('Period', '.').replace('Equal', '=').replace('Minus', '-').replace('Backspace', '⌫').replace('Delete', 'Del').replace('Escape', 'Esc'))).join('+');
}
