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

/** The element the key was pressed in, as far as the gate needs it (an HTMLElement fits). */
export interface KeyTarget { tagName: string; isContentEditable: boolean; type?: string }
/** Inputs that take no text: a click on one leaves the focus there, and Mod+ chords have no meaning of their own in them. */
const CHOICE_INPUTS = new Set(['checkbox', 'radio', 'range']);

/**
 * Whether a key counts as typing (ShortcutContext.typing). Text fields, selects and editable text keep every key. A checkbox,
 * radio or slider keeps its own keys (Space toggles, the arrows move), but not the Mod+ chords: after one click on a radio,
 * Ctrl+Z must undo that answer instead of doing nothing (the focus stays on the radio).
 */
export function isTyping(el: KeyTarget | null, chord: string): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'INPUT' && CHOICE_INPUTS.has((el.type ?? '').toLowerCase())) return !chord.startsWith('Mod+');
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
