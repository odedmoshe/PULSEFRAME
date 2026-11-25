/**
 * The elements drawer (wave 7 library track): tabs «מובנים» (the built-in elements, ElementsBrowser unchanged) / «מהספרייה»
 * (stickers, icons, illustrations, textures, backdrops and video of the owner's library; server PNG thumbnails only — third-party
 * SVG never reaches the browser). The built-in tab is the default, so the drawer is as before until the library tab is chosen.
 */
import { useState } from 'react';
import { Tabs } from '../../ds/index.ts';
import { ElementsBrowser } from '../ElementsBrowser.tsx';
import { useEditorState } from '../store.ts';
import { LIBRARY_TESTIDS as TID } from './library.testids.ts';
import { LIBRARY_UI_STRINGS } from './library.strings.ts';
import { VISUAL_KINDS } from './library.logic.ts';
import { LibraryBrowser } from './LibraryBrowser.tsx';

export function LibraryElementsDrawer() {
  const { state } = useEditorState();
  const L = LIBRARY_UI_STRINGS[state.lang];
  const [tab, setTab] = useState<'builtin' | 'library'>('builtin');
  return (
    <div className="pf-lib-drawer">
      <Tabs label={L.elementsLibrary} value={tab} onChange={(id) => setTab(id === 'library' ? 'library' : 'builtin')} panelPrefix="pf-elements-panel"
        tabs={[{ id: 'builtin', label: L.elementsBuiltin, testId: TID.elementsTabBuiltin }, { id: 'library', label: L.elementsLibrary, testId: TID.elementsTabLibrary }]} />
      <div role="tabpanel" id={`pf-elements-panel-${tab}`} aria-labelledby={`pf-elements-panel-tab-${tab}`} tabIndex={0} data-testid={tab === 'library' ? TID.elementsPanelLibrary : TID.elementsPanelBuiltin}>
        {tab === 'library' ? <LibraryBrowser kinds={VISUAL_KINDS} /> : <ElementsBrowser />}
      </div>
    </div>
  );
}
