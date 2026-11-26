/**
 * The viewer's tools (UX_REDESIGN §4.5, DESIGN_REVIEW WP1 "one transport bar"): what the viewer shows (the edit, or the
 * source file of the selected clip: offered only while a clip with a source is selected, the one state where it does
 * anything), the format prism, the safe-area toggle and full screen. They used to be a header row above the picture; they
 * now sit at the end of the transport bar under it (Transport.tsx mounts StageTools), so the picture has that row's height.
 * StageHeader stays as the mount App.tsx places above the viewer and draws nothing.
 */
import { useEffect, useState } from 'react';
import { Maximize, Minimize, ScanLine } from 'lucide-react';
import { useEditorState } from './store.ts';
import { SourceViewer } from './SourceViewer.tsx';
import { FormatPrism } from './FormatPrism.tsx';
import { SequenceSwitcher } from './SequenceSwitcher.tsx';
import { Seg } from '../ds/index.ts';
import { STAGE_STRINGS } from './stage.strings.ts';
import './stage.css';
import { focusNow } from '../ds/focus.ts';
import { INK_UI_BUILT, InkModeButton } from './ink/InkMode.tsx';

export function StageHeader() { return null; }

export function StageTools() {
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
  if (!doc) return null;
  return (
    <div className="stage-head" role="group" aria-label={S.stageTools} data-testid="stage-head">
      {(assetId || source) && (
        <Seg label={S.view} size="sm" value={source ? 'source' : 'program'} className="stage-view"
          options={[{ value: 'program', label: S.program, testId: 'stage-view-program' }, { value: 'source', label: S.source, disabled: !assetId, ariaLabel: assetId ? undefined : `${S.source}: ${S.sourceNone}`, testId: 'stage-view-source' }]}
          onChange={(v) => setSource(v === 'source' ? assetId : null)} />
      )}
      <FormatPrism />
      <SequenceSwitcher />
      {INK_UI_BUILT && <InkModeButton />}
      {viewed?.safeArea && (
        <label className="stage-toggle" title={S.safeArea}>
          <input type="checkbox" checked={state.safeAreaOn} onChange={(e) => editor.setSafeArea(e.target.checked)} data-testid="safe-area-toggle" />
          <ScanLine size={16} strokeWidth={1.75} aria-hidden="true" /><span className="stage-toggle-label pf-sr">{S.safeArea}</span>
        </label>
      )}
      <button type="button" className="stage-btn" aria-label={full ? S.exitFullscreen : S.fullscreen} title={full ? S.exitFullscreen : S.fullscreen} aria-pressed={full} data-testid="stage-fullscreen" onClick={toggleFull}>
        {full ? <Minimize size={16} strokeWidth={1.75} aria-hidden="true" /> : <Maximize size={16} strokeWidth={1.75} aria-hidden="true" />}
      </button>
      {source && doc.assets[source] && <SourceViewer assetId={source} onClose={() => { focusNow(document.querySelector<HTMLElement>('[data-testid=stage-view-program]')); setSource(null); }} />}
    </div>
  );
}
