/** The library column: import, the media grid, text, templates, elements and the AI tools. Split out of panels.tsx unchanged. */
import { useState } from 'react';
import { TemplatesDrawer } from './TemplatesDrawer.tsx';
import { useEditorState } from './store.ts';
import { MediaGrid } from './MediaLibrary.tsx';
import { AiTools } from './AiTools.tsx';
import { ElementsBrowser } from './ElementsBrowser.tsx';
import { SourceViewer } from './SourceViewer.tsx';

export function Library() {
  const { editor, state, t } = useEditorState();
  const { doc, uploading } = state;
  const [viewing, setViewing] = useState<string | null>(null);
  return (
    <aside className="library" aria-label={t('media')} data-testid="library"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={(e) => { const fs = [...(e.dataTransfer.files ?? [])]; if (!fs.length) return; e.preventDefault(); if (!uploading && doc) void editor.importFiles(fs); }}>
      <h2>{t('media')}</h2>
      <label className="primary file">
        {uploading ? t('media.uploading') : t('media.import')}
        <input type="file" multiple accept="video/*,audio/*,image/png,image/jpeg,image/webp,.cube" disabled={uploading || !doc} data-testid="file-input" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void editor.importFiles(fs); }} />
      </label>
      {viewing && doc?.assets[viewing] && <SourceViewer assetId={viewing} onClose={() => { const id = viewing; setViewing(null); setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="view-${id}"]`)?.focus(), 0); }} />}
      <MediaGrid onView={setViewing} />
      <h2>{t('text')}</h2>
      <button className="ghost" disabled={!doc} onClick={() => void editor.addText()} data-testid="add-text">{t('text.add')}</button>
      <TemplatesDrawer />
      <ElementsBrowser />
      <h2>{t('providers')}</h2>
      <AiTools />
    </aside>
  );
}
