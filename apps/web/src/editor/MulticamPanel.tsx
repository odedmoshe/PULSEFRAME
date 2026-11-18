/**
 * The multicam panel (ADR-0020, W3): a NON-modal region docked beside the viewer (Transport.tsx stage-side slot), so the digit
 * commands pass the shortcut gate. It will hold the angle viewer (AngleViewer.tsx: 4 live tiles plus labelled thumbnails),
 * the tile radiogroup in reading order (RTL tile 1 top-right) with «בשידור», the «הקלטת החלפות» toggle, the speakers table,
 * the auto-switch sheet with its heuristic disclaimer, and the polite live region. Test ids: multicam.testids.ts; chords:
 * multicam.keys.ts.
 * LEAD PLACEHOLDER: shown only when the project has a multicam group, it names the group and says plainly that the panel is
 * not built yet. It shows no angle, no sync state and no control.
 */
import { dictionaries } from '@pulseframe/i18n';
import { multicamGroups } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { MULTICAM_TESTIDS as ID } from './multicam.testids.ts';

export function MulticamPanel() {
  const { state } = useEditorState();
  const t = dictionaries[state.lang];
  const groups = state.rawDoc ? multicamGroups(state.rawDoc) : [];
  if (!groups.length) return null;
  return (
    <aside className="stage-side pf-ds pf-insp pf-force-dark" aria-label={t['multicam.title']} data-testid={ID.panel}>
      <h2>{t['multicam.title']}</h2>
      <p className="muted" data-testid={ID.notBuilt}>{t['multicam.notBuilt']}</p>
      <ul>{groups.map((g) => <li key={g.id}><bdi>{g.name}</bdi></li>)}</ul>
    </aside>
  );
}
