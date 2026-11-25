/**
 * The craft commands (wave 7 craft track; craft-decisions.md §4). W3 BUILDS THE BODIES. Spread at the end of COMMANDS
 * (commands.ts, like MULTICAM_COMMANDS); the editing ones are in CHANGES_SELECTION there. Physical key codes, remappable.
 * In the pre-pass every command is disabled (the chords are taken, so the keys do nothing yet, and Ctrl+S / Ctrl+F no longer open
 * the browser's dialogs while a project is open: App.tsx + shortcutGate.ts takenFromBrowser).
 * Rules for the bodies: Q/W act on rippleTrimTarget (core rippleTrim.ts) and put the playhead at the clip's start after Q; D on at
 * most CRAFT_LIMITS.durationClips clips; paste attributes is disabled while a format is viewed (viewVariantId), with the reason;
 * file.saveVersion runs while typing (shortcutGate.ts) and opens only the one-line name field.
 */
import type { Command } from '../commands.ts';

const notYet = () => false;
export const CRAFT_COMMANDS: Command[] = [
  { id: 'edit.rippleTrimStart', label: 'cmd.rippleTrimStart', group: 'edit', keys: ['KeyQ'], enabled: notYet, run: () => {} },
  { id: 'edit.rippleTrimEnd', label: 'cmd.rippleTrimEnd', group: 'edit', keys: ['KeyW'], enabled: notYet, run: () => {} },
  { id: 'transport.gotoTime', label: 'cmd.gotoTime', group: 'transport', keys: ['KeyG'], enabled: notYet, run: () => {} },
  { id: 'edit.setDuration', label: 'cmd.setDuration', group: 'edit', keys: ['KeyD'], enabled: notYet, run: () => {} },
  { id: 'edit.pasteAttributes', label: 'cmd.pasteAttributes', group: 'edit', keys: ['Mod+Alt+KeyV'], enabled: notYet, run: () => {} },
  { id: 'view.findReplace', label: 'cmd.findReplace', group: 'view', keys: ['Mod+KeyF'], enabled: notYet, run: () => {} },
  { id: 'file.saveVersion', label: 'cmd.saveVersion', group: 'file', keys: ['Mod+KeyS'], enabled: notYet, run: () => {} },
  { id: 'view.versions', label: 'cmd.versions', group: 'view', keys: [], enabled: notYet, run: () => {} },
];
/** The craft commands that change the selected clips (commands.ts CHANGES_SELECTION adds them). */
export const CRAFT_CHANGES_SELECTION = ['edit.rippleTrimStart', 'edit.rippleTrimEnd', 'edit.setDuration', 'edit.pasteAttributes'] as const;
