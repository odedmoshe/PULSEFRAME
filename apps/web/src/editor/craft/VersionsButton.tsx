/** The «גרסאות» button beside the activity list (Inspector.tsx). */
import { useEditorState } from '../store.ts';
import { CRAFT_TESTIDS as TID } from './craft.testids.ts';
import { craftSurface } from './craft.state.ts';
import { say } from './craft.logic.ts';

export function VersionsButton() {
  const { state } = useEditorState();
  return <button type="button" className="ghost" data-testid={TID.versionsOpen} aria-haspopup="dialog" disabled={!state.doc} onClick={() => craftSurface.set({ kind: 'versions' })}>{say(state.lang, 'versions')}</button>;
}
