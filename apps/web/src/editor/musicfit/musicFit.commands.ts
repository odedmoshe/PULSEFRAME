/**
 * The musicfit commands (wave 7 musicfit track). Builder C builds the bodies and sets the default keys: B = clip.impactToBeat,
 * Alt+B = clip.impactToBar (both remappable; check the shortcut-collision test and perform mode's pad keys); clip.markImpact has NO
 * default key (I is mark-in in the source viewer). Spread at the end of COMMANDS (commands.ts). Disabled until built.
 * Rules for the bodies: markImpact commits set_clip_impact {clipId: the selected video or sound clip, moment: the source time the
 * playhead shows in it}; impactToBeat / impactToBar commit sync_impact {clipId, to: 'beat' | 'bar'} on the selected clip.
 */
import type { Command } from '../commands.ts';

const notYet = () => false;
export const MUSICFIT_COMMANDS: Command[] = [
  { id: 'clip.markImpact', label: 'cmd.markImpact', group: 'edit', keys: [], enabled: notYet, run: () => {} },
  { id: 'clip.impactToBeat', label: 'cmd.impactToBeat', group: 'edit', keys: [], enabled: notYet, run: () => {} },
  { id: 'clip.impactToBar', label: 'cmd.impactToBar', group: 'edit', keys: [], enabled: notYet, run: () => {} },
];
