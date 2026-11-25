/** Hosts the open craft surface (craft.state.ts): the time field, the paste dialog, the find panel, the versions dialog and the one-line save field (Header.tsx). */
import { useSyncExternalStore } from 'react';
import './craft.css';
import { craftSurface } from './craft.state.ts';
import { FindReplacePanel } from './FindReplacePanel.tsx';
import { PasteAttributesDialog } from './PasteAttributesDialog.tsx';
import { SaveVersionField } from './SaveVersionField.tsx';
import { TimeEntry } from './TimeEntry.tsx';
import { VersionsDialog } from './VersionsDialog.tsx';

export function CraftHost() {
  const s = useSyncExternalStore(craftSurface.subscribe, craftSurface.get);
  if (!s) return null;
  switch (s.kind) {
    case 'time': return <TimeEntry key={s.target} target={s.target} />;
    case 'paste': return <PasteAttributesDialog />;
    case 'find': return <FindReplacePanel />;
    case 'versions': return <VersionsDialog />;
    case 'saveVersion': return <SaveVersionField />;
  }
}
