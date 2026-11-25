/**
 * The pearls command (wave 7 pearls track). Spread at the end of COMMANDS (commands.ts). Unbound (P is the source viewer's own
 * key, handled inside the viewer; Shift+P «שמור כפנינה מהקליפ» is cut from version 1). Opens the media drawer on the «פנינים» view
 * (setRail('media'); setLifeView('pearls')).
 */
import type { Command } from '../commands.ts';
import { showPearls } from './pearls.ui.ts';

export const PEARLS_COMMANDS: Command[] = [
  { id: 'view.pearls', label: 'cmd.viewPearls', group: 'view', keys: [], enabled: () => true, run: () => showPearls() },
];
