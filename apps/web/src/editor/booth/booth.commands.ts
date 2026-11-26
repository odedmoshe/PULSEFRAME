/**
 * Palette commands of «תא הבדיקה» (wave 8 booth). «פתיחת תא הבדיקה»: the owner's own session only (disabled for any other, so the
 * palette says so and nothing is asked of the server), no default key. Opens the same dialog as the rail button.
 */
import type { Command } from '../commands.ts';
import { isOwnerActor } from '../library/library.logic.ts';
import { openBooth } from './booth.state.ts';

export const BOOTH_COMMANDS: Command[] = [
  {
    id: 'view.openBooth', label: 'booth.open', group: 'view', keys: [],
    text: { he: 'פתיחת תא הבדיקה', en: 'Open the review booth' },
    enabled: (e) => isOwnerActor(e.getState().actor),
    run: (e) => { if (isOwnerActor(e.getState().actor)) openBooth(); },
  },
];
