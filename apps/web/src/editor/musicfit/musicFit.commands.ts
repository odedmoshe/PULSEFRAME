/**
 * The musicfit commands (wave 7 musicfit track, builder C). Spread at the end of COMMANDS (commands.ts). B = clip.impactToBeat, Alt+B =
 * clip.impactToBar (both remappable); clip.markImpact has NO default key (I is mark-in in the source viewer). Each acts on the one
 * selected video or sound clip on an unlocked track and commits ONE transaction (one undo). A refusal is said in a notice, in words,
 * with its next step; the commands stay enabled while a clip that can hold a moment is selected, so the reason can be read.
 */
import { canHoldMoment, planImpact, type SyncImpactOutput } from '@pulseframe/core';
import type { Command } from '../commands.ts';
import type { Editor } from '../store.ts';
import { musicFitT } from './musicFit.strings.ts';
import { afterSyncText, markOp, momentAtPlayhead, refusalLine, syncOp } from './musicFit.logic.ts';

/** The one selected clip a moment can be marked on, or null. */
function target(e: Editor) {
  const doc = e.doc, s = e.selected;
  if (!doc || !s || e.getState().selection.length !== 1 || s.track.locked || s.clip.type !== 'media' || (s.track.kind !== 'video' && s.track.kind !== 'audio')) return null;
  return canHoldMoment(doc, s.clip.id) ? { doc, clipId: s.clip.id } : null;
}
const say = (e: Editor, title: string, body?: string) => e.notify({ kind: 'info', title, ...(body ? { body } : {}) });

async function sync(e: Editor, to: 'beat' | 'bar') {
  const x = target(e);
  if (!x) return;
  const lang = e.getState().lang, t = musicFitT(lang);
  const p = planImpact(x.doc, x.clipId, undefined, to);
  if ('refusal' in p) { say(e, p.refusal === 'alreadyOnBeat' ? t('impactRealigned') : refusalLine(lang, p.refusal, p.details)); return; }
  const r = await e.commit([syncOp(x.clipId, to)], 'Moment to the beat');
  const out = r?.results[0]?.output as SyncImpactOutput | undefined;
  if (out) e.notify({ kind: r?.transactionId ? 'undo' : 'info', title: afterSyncText(t, out), ...(r?.transactionId ? { undoes: r.transactionId } : {}) });
}

export const MUSICFIT_COMMANDS: Command[] = [
  {
    id: 'clip.markImpact', label: 'cmd.markImpact', group: 'edit', keys: [],
    enabled: (e) => !!target(e),
    run: async (e) => {
      const x = target(e);
      if (!x) return;
      const t = musicFitT(e.getState().lang);
      const m = momentAtPlayhead(x.doc, x.clipId, e.playhead);
      if (!m) { say(e, t('impactNeedsPlayhead')); return; }
      const r = await e.commit([markOp(x.clipId, m)], 'Mark the moment');
      if (r) e.notify({ kind: r.transactionId ? 'undo' : 'info', title: t('cmdMarked'), ...(r.transactionId ? { undoes: r.transactionId } : {}) });
    },
  },
  { id: 'clip.impactToBeat', label: 'cmd.impactToBeat', group: 'edit', keys: ['KeyB'], enabled: (e) => !!target(e), run: (e) => sync(e, 'beat') },
  { id: 'clip.impactToBar', label: 'cmd.impactToBar', group: 'edit', keys: ['Alt+KeyB'], enabled: (e) => !!target(e), run: (e) => sync(e, 'bar') },
];

