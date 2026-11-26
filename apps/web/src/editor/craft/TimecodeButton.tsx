/**
 * The transport timecode (Transport.tsx) as the button that opens «מעבר לזמן» (G); it keeps data-testid="timecode" and its text.
 */
import { useEditorState } from '../store.ts';
import { craftSurface } from './craft.state.ts';
import { say } from './craft.logic.ts';

export function TimecodeButton({ text }: { text: string }) {
  const { state } = useEditorState();
  const label = `${say(state.lang, 'gotoTitle')}: ${text}`;
  return (
    <button type="button" className="timecode tc pf-craft-tcbtn" data-testid="timecode" aria-label={label} title={label} aria-haspopup="dialog" disabled={!state.doc}
      onClick={() => craftSurface.set({ kind: 'time', target: 'goto' })}>{text}</button>
  );
}
