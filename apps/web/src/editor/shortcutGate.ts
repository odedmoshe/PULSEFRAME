/**
 * Whether a keyboard shortcut may run right now. Kept apart from the dispatcher in App.tsx so the rule can be tested
 * without a browser. Editing shortcuts never act on the timeline while the user is typing or while a modal dialog is open.
 */
import { PERFORM_RECORDING_COMMANDS } from './perform/performKeys.ts';

export interface ShortcutContext {
  /** The key was pressed in a text field, a select or editable text. */
  typing: boolean;
  /** The command palette is open (it is itself a modal dialog). */
  paletteOpen: boolean;
  /** Any modal dialog is on screen: any element with aria-modal="true", whatever its class. */
  modalOpen: boolean;
  /** A perform take is being recorded (ADR-0025): only the pads (the view's own listener), Space, and Escape (the view) act. */
  performRecording?: boolean;
}

/**
 * Commands that run while typing although they are not in group `view` (wave 7 craft): Ctrl+S saves a version with the cursor in
 * a title field (it opens the one-line name field and commits nothing). Never behind a modal or the palette (the rules below).
 */
export const RUN_WHILE_TYPING: readonly string[] = ['file.saveVersion'];
/**
 * Commands whose chords the editor takes from the browser whenever a project is open, allowed now or not (wave 7 craft): Ctrl+S
 * would open the browser's "save page" and Ctrl+F its own search. App.tsx prevents the browser's default for their chords.
 */
export const TAKEN_FROM_BROWSER: readonly string[] = ['file.saveVersion', 'view.findReplace'];
export function takenFromBrowser(chord: string, keysFor: (id: string) => string[]): boolean {
  return chord.startsWith('Mod+') && TAKEN_FROM_BROWSER.some((id) => keysFor(id).includes(chord));
}

export function shortcutAllowed(chord: string, cmd: { id: string; group: string }, ctx: ShortcutContext): boolean {
  if (ctx.typing && !(chord.startsWith('Mod+') && (cmd.group === 'view' || RUN_WHILE_TYPING.includes(cmd.id)))) return false;
  // The palette's own toggle must still close it; nothing else runs behind the palette.
  if (ctx.paletteOpen) return cmd.id === 'view.palette';
  // While a take is recorded nothing is edited or switched (multicam's digits included): perform/performKeys.ts.
  if (ctx.performRecording) return PERFORM_RECORDING_COMMANDS.includes(cmd.id);
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

/** The focused element as the Space rule needs it (built from an HTMLElement in App.tsx). */
export interface FocusedControl extends KeyTarget {
  /** its role attribute, if any */
  role?: string | null;
  /** an `a` element with an href is a link */
  hasHref?: boolean;
  /** the browser's own judgement that the focus came from the keyboard: el.matches(':focus-visible') read WHEN THE ELEMENT WAS FOCUSED
   *  (Chromium turns it on at the first key pressed on a mouse-focused element, so App.tsx keeps the value from focusin) */
  focusVisible: boolean;
}
const SPACE_TAGS = new Set(['BUTTON', 'SUMMARY', 'SELECT']);
const SPACE_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image', 'checkbox']);
const SPACE_ROLES = new Set(['button', 'switch', 'checkbox', 'link']);
/**
 * Whether Space belongs to the focused control instead of play / pause (lead decision, wave 7): when a button, switch,
 * checkbox, link, `summary` or select has KEYBOARD focus (`:focus-visible`), Space presses it, as everywhere on the web. After a
 * mouse click the focus stays on the button without `:focus-visible`, and there (and everywhere else) Space still plays and
 * pauses the film, as before. Only plain Space: Shift+Space and the Mod+ chords keep their commands.
 */
export function spaceBelongsToControl(el: FocusedControl | null, chord: string): boolean {
  if (chord !== 'Space' || !el || !el.focusVisible) return false;
  const role = (el.role ?? '').toLowerCase();
  if (SPACE_ROLES.has(role)) return true;
  if (SPACE_TAGS.has(el.tagName)) return true;
  if (el.tagName === 'A') return !!el.hasHref;
  return el.tagName === 'INPUT' && SPACE_INPUT_TYPES.has((el.type ?? '').toLowerCase());
}
