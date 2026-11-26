/**
 * The stabilise command (wave 7 stabilise track). Spread at the end of COMMANDS (commands.ts, like CRAFT_COMMANDS). Unbound by
 * default (remappable in the shortcuts list). It toggles stabilisation on the one selected stabilisable clip: on (its remembered
 * strength, or the one-press default; the measurement job when the file is not measured for the clip yet) or off (stabilise null).
 * Inert on a locked track, as the other editing commands are.
 */
import type { MediaClip } from '@pulseframe/core';
import { api } from '../../api.ts';
import type { Command } from '../commands.ts';
import type { Editor } from '../store.ts';
import { rememberRun, rememberStrength, stabiliseView, switchOffOp, switchOnOp } from './stabilise.logic.ts';

/** The one selected clip this command may act on, with what the block would show for it. */
function target(e: Editor) {
  const doc = e.doc, s = e.selected;
  if (!doc || !s || e.getState().selection.length !== 1 || s.track.kind !== 'video' || s.track.locked || s.clip.type !== 'media') return null;
  const view = stabiliseView(doc, s.clip);
  if (!view || view.kind === 'still' || view.kind === 'multicam') return null;
  return { doc, clip: s.clip as MediaClip, view };
}

export const STABILISE_COMMANDS: Command[] = [
  {
    id: 'clip.stabiliseToggle', label: 'cmd.stabiliseToggle', group: 'edit', keys: [],
    enabled: (e) => !!target(e),
    run: async (e) => {
      const t = target(e);
      if (!t) return;
      if (t.view.kind === 'on') { rememberStrength(t.clip.id, t.clip.stabilise!.strength); await e.commit([switchOffOp(t.clip)], 'Stabilise'); }
      else if (t.view.kind === 'off') await e.commit([switchOnOp(t.clip)], 'Stabilise');
      else {
        // not measured for this clip: start the measurement; the block follows the run and the job switches the clip on
        try { const r = await api.stabiliseClip(t.doc.id, t.clip.id, {}); rememberRun(t.clip.id, r.jobId); } catch { /* the block shows the refusal when it is open; the next press tries again */ }
      }
    },
  },
];
/** The stabilise commands that change the selected clips (commands.ts CHANGES_SELECTION adds them). */
export const STABILISE_CHANGES_SELECTION = ['clip.stabiliseToggle'] as const;
