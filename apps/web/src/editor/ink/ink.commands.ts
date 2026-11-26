/**
 * The command of «ציור חי» (wave 8 ink), spread into COMMANDS (commands.ts). Lead pre-pass: empty, so Shift+D stays unbound until W3
 * builds the mode (a bound key that does nothing would be a dead control). W3 adds `{ id: INK_COMMAND_ID, keys: [INK_MODE_CHORD], … }`
 * here, enabled only on a paused frame with a project open.
 */
import type { Command } from '../commands.ts';

export const INK_COMMANDS: Command[] = [];
