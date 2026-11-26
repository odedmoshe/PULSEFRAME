/**
 * The entry to «גדלים מול העיניים» (wave 8 growing; W3 owns this file after the pre-pass): a card on the start hub beside the family
 * film and the story (Welcome.tsx). Opens the dialog with editor.openGrowing(). GROWING_TESTIDS.open with data-variant.
 * HONEST UNTIL BUILT: while core GROWING_BUILT (W1, the planner) or GROWING_UI_BUILT (W3, the dialog) is false it renders nothing,
 * so the owner never meets a button that leads nowhere. The integrator checks the server is built too before both are left on.
 */
import type { ReactElement } from 'react';
import { GROWING_BUILT } from '@pulseframe/core';
import { useEditorState } from '../store.ts';
import { GROWING_UI_BUILT } from './GrowingDialog.tsx';
import { growingStrings } from './growing.strings.ts';
import { GROWING_TESTIDS as ID } from './growing.testids.ts';

export interface GrowingEntryProps { variant: 'start-hub'; lang: 'he' | 'en' }
export function GrowingEntry({ variant, lang }: GrowingEntryProps): ReactElement | null {
  const { editor, state } = useEditorState();
  if (!GROWING_BUILT || !GROWING_UI_BUILT || !state.doc) return null;
  const S = growingStrings(lang);
  return (
    <button type="button" className="pf-growing-entry is-start-hub" data-testid={ID.open} data-variant={variant} onClick={() => editor.openGrowing()}>
      <span className="pf-growing-entry-text"><b>{S.name}</b></span>
    </button>
  );
}
