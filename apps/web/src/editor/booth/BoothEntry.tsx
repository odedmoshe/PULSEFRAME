/**
 * The rail's «תא הבדיקה» button and the dialog it opens (wave 8 booth). MOUNTED by Rail.tsx between «קיצורים» and «הגדרות». The button
 * and the dialog exist only in the owner's own session (isOwnerActor): any other session draws nothing here and asks the server nothing.
 */
import type { ReactElement } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Tooltip } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { isOwnerActor } from '../library/library.logic.ts';
import { BoothDialog } from './BoothDialog.tsx';
import { BOOTH_TESTIDS as TID } from './booth.testids.ts';
import { openBooth } from './booth.state.ts';
import { makeSay } from './booth.strings.ts';

export function BoothEntry(): ReactElement | null {
  const { state } = useEditorState();
  if (!isOwnerActor(state.actor)) return null;
  const say = makeSay(state.lang);
  return (
    <>
      <Tooltip label={say('booth.open')}>
        <button type="button" className="pf-rail-btn" data-testid={TID.rail} aria-haspopup="dialog" onClick={openBooth}>
          <span className="pf-rail-ic" aria-hidden="true"><ClipboardCheck /></span><span className="pf-rail-label">{say('booth.title')}</span>
        </button>
      </Tooltip>
      <BoothDialog />
    </>
  );
}
