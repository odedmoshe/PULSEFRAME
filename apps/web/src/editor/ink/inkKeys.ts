/**
 * Keys inside the drawing mode «ציור» (wave 8 ink; ink-verify C10 "the undo note"). Complete lead contract: while the mode is on,
 * NO key reaches the command table: `[` and `]` (trim, commands.ts), `D` (set duration, craft.commands.ts), Ctrl+Z (project undo)
 * and Space (play) would otherwise act on the timeline behind the drawing. W3's mode listens on window in the CAPTURE phase and,
 * for every action but 'control', calls preventDefault and stopImmediatePropagation, then acts; 'control' is left to the focused
 * toolbar control (a button's Enter or Space, a radio group's arrows) and the editor's dispatcher skips it because the mode is on.
 *
 * The mode's entry: Shift+D (`INK_MODE_CHORD`). Read against the full command table (every default binding of COMMANDS and
 * MULTICAM_COMMANDS, dumped 2026-11-26) and the window key listeners (Header Shift+1…7, TimelineZoom Shift+Z, Rail Alt+digits):
 * Shift+KeyD is bound nowhere. ink.contract.test.ts fails when a command takes it.
 */
export const INK_MODE_CHORD = 'Shift+KeyD';
export const INK_COMMAND_ID = 'ink.toggle';
/** While the mode is on, the editor's key dispatcher (App.tsx) acts on no key: the mode's capture listener owns them. W3 sets it. */
export const INK_MODE = { on: false };

export type InkKeyAction =
  | { do: 'brush'; brush: 'marker' | 'highlighter' | 'neon' }
  | { do: 'width'; step: -1 | 1 }
  | { do: 'undoStroke' } | { do: 'done' } | { do: 'cancel' } | { do: 'leave' }
  /** Space: nothing plays; the status line says «כדי לנגן, לחצו קודם סיום או ביטול» */
  | { do: 'spaceHint' }
  /** left to the focused toolbar control */
  | { do: 'control' }
  /** caught and dropped */
  | { do: 'swallow' };

const BRUSH_KEYS = { Digit1: 'marker', Digit2: 'highlighter', Digit3: 'neon' } as const;
const CONTROL_KEYS = new Set(['Tab', 'Shift+Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

/**
 * What a chord (commands.ts chordOf: 'Mod+KeyZ', 'BracketLeft', 'Shift+KeyD') does inside the mode. `onControl`: focus is on a
 * toolbar control, where Enter and Space press it.
 */
export function inkKeyAction(chord: string, onControl = false): InkKeyAction {
  if (chord in BRUSH_KEYS) return { do: 'brush', brush: BRUSH_KEYS[chord as keyof typeof BRUSH_KEYS] };
  if (chord === 'BracketLeft') return { do: 'width', step: -1 };
  if (chord === 'BracketRight') return { do: 'width', step: 1 };
  if (chord === 'Mod+KeyZ') return { do: 'undoStroke' };
  if (chord === 'Escape') return { do: 'cancel' };
  if (chord === INK_MODE_CHORD) return { do: 'leave' };
  if (CONTROL_KEYS.has(chord)) return { do: 'control' };
  if (onControl && (chord === 'Enter' || chord === 'Space')) return { do: 'control' };
  if (chord === 'Enter') return { do: 'done' };
  if (chord === 'Space') return { do: 'spaceHint' };
  return { do: 'swallow' };
}
