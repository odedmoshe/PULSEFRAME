/**
 * Perform mode's keys (ADR-0025): the lead's rule for how pads share the keyboard with the rest of the editor. Pure; tested in
 * performKeys.test.ts. W3's capture (perform/capture.ts) asks padOfKey and padKeysLive; the dispatcher (App.tsx) asks
 * shortcutGate.ts, which applies PERFORM_RECORDING_COMMANDS while a take is recorded.
 *
 * - Pads are the unmodified number row Digit1–Digit8 and Numpad1–Numpad8 (by KeyboardEvent.code, so the Hebrew layout makes no
 *   difference), never with a modifier and never on auto-repeat: Shift+1…7 stay the mode bar (Header.tsx; perform is Shift+7),
 *   Alt+1…0 the rail, Ctrl/⌘+digit the browser.
 * - Multicam live switching (ADR-0020) owns the digits while its program is on the video target track (commands.ts
 *   multicamAngleFor): then pads take NO number keys (they still work by pointer, touch and Space/Enter on the focused pad), and
 *   the view says so (i18n perform.multicamDigits). Perform mode never switches angles itself.
 * - The dispatcher binds Digit1–9 to the multicam commands and calls preventDefault even when they are disabled; it does not
 *   stop propagation. The capture listener must therefore NOT skip events whose defaultPrevented is set.
 * - While a take is recorded only the pads, Space (stop) and Escape (discard) act: every other command of the registry is off
 *   (multicam's digits included, so nothing is committed while playing). Escape and Enter are handled by the view's own listener.
 */
export const PERFORM_MODE_CHORD = 'Shift+Digit7';
/** The key codes of pad i (0..7). */
export const PAD_CODES: readonly (readonly [string, string])[] = Array.from({ length: 8 }, (_, i) => [`Digit${i + 1}`, `Numpad${i + 1}`] as const);
/** The commands of the registry that may still run while a take is recorded (Space stops the take). */
export const PERFORM_RECORDING_COMMANDS: readonly string[] = ['transport.toggle'];

export interface PadKeyEvent { code: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean }
/** The pad a key event presses (0..7), or null: not a pad key, a modifier is held, or it is an auto-repeat. */
export function padOfKey(e: PadKeyEvent): number | null {
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return null;
  const i = PAD_CODES.findIndex((c) => c.includes(e.code));
  return i < 0 ? null : i;
}
export interface PadKeyContext {
  /** The workspace is perform. */
  performActive: boolean;
  /** Multicam's digits are live (PerformHost.multicamDigitsLive). */
  multicamDigitsLive: boolean;
  /** The key went to a text field, select or editable text (shortcutGate.ts isTyping). */
  typing: boolean;
  /** A modal dialog or the command palette is open. */
  modalOpen: boolean;
}
/** Whether the number keys press pads right now. */
export function padKeysLive(ctx: PadKeyContext): boolean {
  return ctx.performActive && !ctx.multicamDigitsLive && !ctx.typing && !ctx.modalOpen;
}
