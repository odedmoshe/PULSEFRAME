import { Download, FolderOpen, Scissors, Sparkles, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useEditorState } from './store.ts';
import { WELCOME_STRINGS } from './welcome.strings.ts';
import './welcome.css';

const ACCEPT = 'video/*,audio/*,image/png,image/jpeg,image/webp,.cube'; // same list as the library input (.cube = a colour table)
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Start panel over the stage of an empty project (no assets, no clips). */
export function Welcome() {
  const { editor, state } = useEditorState();
  const { doc, uploading, lang } = state;
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  if (!doc) return null;
  const empty = Object.keys(doc.assets).length === 0 && Object.values(doc.sequences).every((s) => s.tracks.every((t) => t.clips.length === 0));
  if (!empty) return null;
  const s = WELCOME_STRINGS[lang];
  const take = (files: File[]) => { if (files.length && !uploading) void editor.importFiles(files); };
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  return (
    <section className="welcome" role="region" aria-label={s.region} data-testid="welcome">
      <h2>{s.title}</h2>
      <p className="welcome-lead">{s.lead}</p>
      <div className={`welcome-drop${over ? ' over' : ''}`} data-testid="welcome-drop"
        onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={(e) => { setOver(false); const fs = [...(e.dataTransfer.files ?? [])]; if (!fs.length) return; e.preventDefault(); e.stopPropagation(); take(fs); }}>
        <Upload size={32} aria-hidden="true" />
        <span>{s.drop}</span>
        <button type="button" className="primary" disabled={uploading} data-testid="welcome-import" onClick={() => inputRef.current?.click()}>
          {uploading ? s.uploading : s.pick}
        </button>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden tabIndex={-1} data-testid="welcome-input"
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; take(fs); }} />
      </div>
      <ol className="welcome-steps" aria-label={s.stepsLabel}>
        <li><span className="n">1</span><FolderOpen size={18} aria-hidden="true" />{s.s1}</li>
        <li><span className="n">2</span><Scissors size={18} aria-hidden="true" />{s.s2}</li>
        <li><span className="n">3</span><Sparkles size={18} aria-hidden="true" /><Download size={18} aria-hidden="true" />{s.s3}</li>
      </ol>
      <p className="welcome-hints">
        <span><kbd>{s.space}</kbd> {s.hintPlay}</span>
        <span><kbd>S</kbd> {s.hintSplit}</span>
        <span><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>+<kbd>K</kbd> {s.hintPalette}</span>
      </p>
    </section>
  );
}
