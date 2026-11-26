/**
 * «קליפ מקוד» entry in the Text pane (wave 8 motioncode). Library.tsx mounts it once MADE_UI_BUILT. A secondary button opening
 * MadeClipDialog (MADE_TESTIDS.entry). If the server does not build it yet, the dialog says so honestly with the next step (the
 * routes answer 501 made_not_built); the button itself is never faked.
 */
import { useState, type ReactElement } from 'react';
import { Code2 } from 'lucide-react';
import { Button } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { MADE_TESTIDS as TID } from './made.testids.ts';
import { madeT } from './made.strings.ts';
import { MadeClipDialog } from './MadeClipDialog.tsx';

export const MADE_UI_BUILT = true;

export function MadeEntry(): ReactElement {
  const { state } = useEditorState();
  const [open, setOpen] = useState(false);
  const t = madeT(state.lang);
  return (
    <>
      <Button variant="secondary" size="md" icon={<Code2 size={16} aria-hidden="true" />} disabled={!state.doc} onClick={() => setOpen(true)} data-testid={TID.entry}>{t('entry')}</Button>
      {open && <MadeClipDialog onClose={() => setOpen(false)} />}
    </>
  );
}
