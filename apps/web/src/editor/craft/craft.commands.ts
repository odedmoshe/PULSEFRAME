/**
 * The craft commands (wave 7 craft track; craft-decisions.md §4). Spread at the end of COMMANDS (commands.ts, like
 * MULTICAM_COMMANDS); the editing ones are in CHANGES_SELECTION there. Physical key codes, remappable.
 * - Q / W: ripple_trim of rippleTrimTarget (core rippleTrim.ts) at the playhead; after Q the playhead goes to the clip's start so
 *   the picture on screen does not change. The toast says the frames cut, the clips that moved and, when something later stayed,
 *   that titles, music and markers did. A refusal reaches the error bar in the trim wording (store.ts fail).
 * - G / D: open the time field (TimeEntry.tsx); D works on at most CRAFT_LIMITS.durationClips clips and says so otherwise.
 * - Ctrl+Alt+V: the paste dialog; with a format viewed it says why it cannot (a toast), never silently.
 * - Ctrl+F / «גרסאות»: the find panel / the versions dialog. Ctrl+S: only the one-line name field (shortcutGate.ts lets it run
 *   while typing); nothing is committed until Enter there.
 * Surfaces are opened through craft.state.ts, so no shared file holds their state.
 */
import * as T from '@pulseframe/time';
import { CRAFT_LIMITS, findClip, rippleTrimCall, rippleTrimTarget } from '@pulseframe/core';
import type { Command } from '../commands.ts';
import type { Editor } from '../store.ts';
import { craftSurface } from './craft.state.ts';
import { clipEndTime, laterThatStayed, rippleNotice, say, trimmedFrames } from './craft.logic.ts';

const lang = (e: Editor) => e.getState().lang;
const target = (e: Editor) => {
  const doc = e.doc;
  return doc ? rippleTrimTarget(doc, { clipIds: e.getState().selection, sequenceId: e.getState().activeSequenceId }, e.frame) : null;
};
const hasSelection = (e: Editor) => e.getState().selection.length > 0;

/** Q (edge 'start') and W (edge 'end'): trim to the playhead and close the gap. */
const rippleTrim = (edge: 'start' | 'end') => async (e: Editor) => {
  const doc = e.doc, t = target(e);
  if (!doc || !t) return;
  const f = findClip(doc, t.clipId);
  if (!f) return;
  const from = clipEndTime(doc, t.clipId)!;
  const startFrame = T.frameIndexAt(f.clip.start, e.rate);
  const r = await e.commit([rippleTrimCall(doc, t.clipId, edge, e.frame)], edge === 'start' ? 'Ripple trim start' : 'Ripple trim end');
  if (!r) return; // refused: the error bar says why in the trim wording; nothing moved
  const out = r.results[0]?.output as { movedClipIds?: string[]; trimmedClipIds?: string[]; by?: unknown } | undefined;
  const moved = out?.movedClipIds ?? [];
  if (edge === 'start') e.seek(startFrame);
  e.notify(rippleNotice(lang(e), { frames: trimmedFrames(out?.by, e.rate), moved: moved.length, stayed: laterThatStayed(doc, from, [...moved, ...(out?.trimmedClipIds ?? []), t.clipId], f.seq.id) }, r.transactionId ?? null));
};

export const CRAFT_COMMANDS: Command[] = [
  { id: 'edit.rippleTrimStart', label: 'cmd.rippleTrimStart', group: 'edit', keys: ['KeyQ'], enabled: (e) => !!target(e), run: rippleTrim('start') },
  { id: 'edit.rippleTrimEnd', label: 'cmd.rippleTrimEnd', group: 'edit', keys: ['KeyW'], enabled: (e) => !!target(e), run: rippleTrim('end') },
  { id: 'transport.gotoTime', label: 'cmd.gotoTime', group: 'transport', keys: ['KeyG'], enabled: (e) => !!e.doc && (e.player?.frameCount ?? 0) > 0, run: () => craftSurface.set({ kind: 'time', target: 'goto' }) },
  {
    id: 'edit.setDuration', label: 'cmd.setDuration', group: 'edit', keys: ['KeyD'], enabled: hasSelection,
    run: (e) => {
      if (e.getState().selection.length > CRAFT_LIMITS.durationClips) { e.notify({ kind: 'info', title: say(lang(e), 'durationTitleMany', { c: e.getState().selection.length }), body: say(lang(e), 'upTo200') }); return; }
      craftSurface.set({ kind: 'time', target: 'duration' });
    },
  },
  {
    id: 'edit.pasteAttributes', label: 'cmd.pasteAttributes', group: 'edit', keys: ['Mod+Alt+KeyV'], enabled: (e) => hasSelection(e) || e.clipboardLive.length > 0,
    run: (e) => {
      if (e.getState().viewVariantId) { e.notify({ kind: 'info', title: say(lang(e), 'pasteTitle'), body: say(lang(e), 'pasteNotInFormat') }); return; }
      craftSurface.set({ kind: 'paste' });
    },
  },
  { id: 'view.findReplace', label: 'cmd.findReplace', group: 'view', keys: ['Mod+KeyF'], enabled: (e) => !!e.doc, run: () => craftSurface.set({ kind: 'find' }) },
  { id: 'file.saveVersion', label: 'cmd.saveVersion', group: 'file', keys: ['Mod+KeyS'], enabled: (e) => !!e.doc, run: () => craftSurface.set({ kind: 'saveVersion' }) },
  { id: 'view.versions', label: 'cmd.versions', group: 'view', keys: [], enabled: (e) => !!e.doc, run: () => craftSurface.set({ kind: 'versions' }) },
];
/** The craft commands that change the selected clips (commands.ts CHANGES_SELECTION adds them). */
export const CRAFT_CHANGES_SELECTION = ['edit.rippleTrimStart', 'edit.rippleTrimEnd', 'edit.setDuration', 'edit.pasteAttributes'] as const;
