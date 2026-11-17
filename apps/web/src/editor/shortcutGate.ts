/**
 * Whether a keyboard shortcut may run right now. Kept apart from the dispatcher in App.tsx so the rule can be tested
 * without a browser. Editing shortcuts never act on the timeline while the user is typing or while a modal dialog is open.
 */
export interface ShortcutContext {
  /** The key was pressed in a text field, a select or editable text. */
  typing: boolean;
  /** The command palette is open (it is itself a modal dialog). */
  paletteOpen: boolean;
  /** Any modal dialog is on screen: any element with aria-modal="true", whatever its class. */
  modalOpen: boolean;
}

export function shortcutAllowed(chord: string, cmd: { id: string; group: string }, ctx: ShortcutContext): boolean {
  if (ctx.typing && !(chord.startsWith('Mod+') && cmd.group === 'view')) return false;
  // The palette's own toggle must still close it; nothing else runs behind the palette.
  if (ctx.paletteOpen) return cmd.id === 'view.palette';
  // Any other modal dialog (projects, activity, source viewer, effects gallery, …): no editor shortcut acts behind it.
  return !ctx.modalOpen;
}
