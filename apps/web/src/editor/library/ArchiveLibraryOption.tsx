/**
 * Deliver → archive: «ארכיון לשיתוף» (library=strip) / «ארכיון לעצמי» (library=keep, the owner's own session) when the project
 * holds library files that may not be passed on (wave 7 library track). It reports the choice; DeliverPanel builds the link.
 * Nothing is drawn for a project without such files, and the archive link is then exactly as before. Sharing is chosen first (the
 * server refuses an archive with restricted files and no choice); «לעצמי» is offered to the owner's session only.
 */
import { useEffect, type ReactElement } from 'react';
import type { ArchiveLibraryMode } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { useState } from 'react';
import { useEditorState } from '../store.ts';
import { LIBRARY_TESTIDS as TID } from './library.testids.ts';
import { libText, LIBRARY_UI_STRINGS } from './library.strings.ts';
import { archiveModes, archiveRestrictedCount } from './library.logic.ts';

export function ArchiveChoiceView({ lang, count, owner, mode, onChange }: { lang: Lang; count: number; owner: boolean; mode: ArchiveLibraryMode; onChange: (m: ArchiveLibraryMode) => void }): ReactElement {
  const L = LIBRARY_UI_STRINGS[lang];
  const note = { strip: L.archiveStripNote, keep: L.archiveKeepNote };
  const label = { strip: libText(lang, 'library.archive.strip'), keep: libText(lang, 'library.archive.keep') };
  const test = { strip: TID.archiveStrip, keep: TID.archiveKeep };
  return (
    <fieldset className="pf-lib-archive" data-testid={TID.archiveChoice}>
      <legend>{L.archiveTitle} <bdi className="num">{count}</bdi></legend>
      {archiveModes(owner).map((m) => (
        <label key={m} className="pf-lib-archive-opt">
          <input type="radio" name="pf-archive-library" value={m} checked={mode === m} data-testid={test[m]} onChange={() => onChange(m)} />
          <span>{label[m]}<small className="pf-lib-muted">{note[m]}</small></span>
        </label>
      ))}
      {!owner && <p className="pf-lib-muted" data-testid={TID.archiveOwnerOnly}>{L.archiveKeepOwnerOnly}</p>}
    </fieldset>
  );
}

export function ArchiveLibraryOption({ projectId, onMode }: { projectId: string; onMode: (mode: ArchiveLibraryMode | null) => void }): ReactElement | null {
  const { state } = useEditorState();
  const count = state.doc?.id === projectId ? archiveRestrictedCount(state.doc) : 0; // the server's rule (library and fetched files)
  const owner = state.actor === 'user:local';
  const [mode, setMode] = useState<ArchiveLibraryMode>('strip');
  useEffect(() => { onMode(count > 0 ? mode : null); }, [count, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (count === 0) return null;
  return <ArchiveChoiceView lang={state.lang} count={count} owner={owner} mode={owner ? mode : 'strip'} onChange={setMode} />;
}
