/**
 * The stabilise command (wave 7 stabilise track). W3 BUILDS THE BODY. Spread at the end of COMMANDS (commands.ts, like
 * CRAFT_COMMANDS). Unbound by default (remappable in the shortcuts list); disabled until built.
 * Rule for the body: toggles set_clip_stabilise on the one selected stabilisable clip (on: its remembered strength, or the job when
 * the file is not measured yet; off: stabilise null), refused on a locked track as the other editing commands are.
 */
import type { Command } from '../commands.ts';

const notYet = () => false;
export const STABILISE_COMMANDS: Command[] = [
  { id: 'clip.stabiliseToggle', label: 'cmd.stabiliseToggle', group: 'edit', keys: [], enabled: notYet, run: () => {} },
];
/** The stabilise commands that change the selected clips (commands.ts CHANGES_SELECTION adds them). */
export const STABILISE_CHANGES_SELECTION = ['clip.stabiliseToggle'] as const;
