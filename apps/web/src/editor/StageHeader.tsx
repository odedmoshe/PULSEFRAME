/**
 * The header row of the stage (UX_REDESIGN §4.5): what the viewer shows (the edit, or the source file of the selected clip),
 * the format prism, the safe-area toggle and full screen. One row that never wraps; at a narrow stage only the prism stays.
 */
import { useEffect, useState } from 'react';
import { Maximize, Minimize, ScanLine } from 'lucide-react';
import { useEditorState } from './store.ts';
import { SourceViewer } from './SourceViewer.tsx';
import { FormatPrism } from './FormatPrism.tsx';
import { Seg } from '../ds/index.ts';
import { STAGE_STRINGS } from './stage.strings.ts';
import './stage.css';

export function StageHeader() {
  const { editor, state } = useEditorState();
  const S = STAGE_STRINGS[state.lang];
  const [source, setSource] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const doc = state.doc;
  const sel = editor.selected;
  const assetId = sel && state.selection.length === 1 && sel.clip.type === 'media' && doc?.assets[sel.clip.assetId] ? sel.clip.assetId : null;
  const viewed = state.viewVariantId ? doc?.variants?.[state.viewVariantId] ?? null : null;
  const toggleFull = () => {
    const el = document.querySelector<HTMLElement>('.app > .stage');
    if (document.fullscreenElement) void document.exitFullscreen(); else void el?.requestFullscreen?.().catch(() => { /* the browser refused: the stage stays as it is */ });
  };
  if (!doc) return <div className="stage-head pf-ds" />;
  return (
    <div className="stage-head pf-ds" role="toolbar" aria-label={S.stageTools} data-testid="stage-head">
      <Seg label={S.view} size="sm" value={source ? 'source' : 'program'} className="stage-view"
        options={[{ value: 'program', label: S.program, testId: 'stage-view-program' }, { value: 'source', label: S.source, disabled: !assetId, ariaLabel: assetId ? undefined : `${S.source}: ${S.sourceNone}`, testId: 'stage-view-source' }]}
        onChange={(v) => setSource(v === 'source' ? assetId : null)} />
      <FormatPrism />
      <span className="stage-head-space" />
      {viewed?.safeArea && (
        <label className="stage-toggle" title={S.safeArea}>
          <input type="checkbox" checked={state.safeAreaOn} onChange={(e) => editor.setSafeArea(e.target.checked)} data-testid="safe-area-toggle" />
          <ScanLine size={16} strokeWidth={1.75} aria-hidden="true" /><span className="stage-toggle-label">{S.safeArea}</span>
        </label>
      )}
      <button type="button" className="stage-btn" aria-label={full ? S.exitFullscreen : S.fullscreen} title={full ? S.exitFullscreen : S.fullscreen} aria-pressed={full} data-testid="stage-fullscreen" onClick={toggleFull}>
        {full ? <Minimize size={16} strokeWidth={1.75} aria-hidden="true" /> : <Maximize size={16} strokeWidth={1.75} aria-hidden="true" />}
      </button>
      {source && doc.assets[source] && <SourceViewer assetId={source} onClose={() => { setSource(null); setTimeout(() => document.querySelector<HTMLElement>('[data-testid=stage-view-program]')?.focus(), 0); }} />}
    </div>
  );
}
