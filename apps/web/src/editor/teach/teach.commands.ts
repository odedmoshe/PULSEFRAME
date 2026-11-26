/**
 * Palette commands of «למדו אותי פעם אחת» (wave 8 teach). Spread into commands.ts COMMANDS by the pre-pass. BUILDER W3 adds ONE entry:
 * { id: 'edit.teachApply', label: 'cmd.teachApply', group: 'edit', keys: [] } — no default chord in version 1 (decisions.md: the
 * shortcut is cut) — enabled for the owner's own session with exactly one selected clip; with a format viewed it says why in a toast
 * (teach.strings notInFormat), never silently; it opens the dialog (teachSurface.set({ clipId })). Add its id to CHANGES_SELECTION
 * through TEACH_CHANGES_SELECTION. Empty until then: the palette shows no command that does nothing.
 */
import type { Command } from '../commands.ts';

export const TEACH_COMMANDS: Command[] = [];
/** The teach commands that change the selected clips (commands.ts CHANGES_SELECTION adds them). */
export const TEACH_CHANGES_SELECTION: readonly string[] = [];
