/**
 * The pearls command (wave 7 pearls track). Builder C builds the body. Spread at the end of COMMANDS (commands.ts). Unbound (P is
 * the source viewer's own key, handled inside the viewer; Shift+P «שמור כפנינה מהקליפ» is cut from version 1). Disabled until built.
 * Rule for the body: opens the media drawer on the «פנינים» view (setRail('media'); setLifeView('pearls')).
 */
import type { Command } from '../commands.ts';

const notYet = () => false;
export const PEARLS_COMMANDS: Command[] = [
  { id: 'view.pearls', label: 'cmd.viewPearls', group: 'view', keys: [], enabled: notYet, run: () => {} },
];
