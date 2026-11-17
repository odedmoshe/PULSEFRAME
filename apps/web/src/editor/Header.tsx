/**
 * The top bar (docs/design/UX_REDESIGN.md §4.2): one row with fixed slots that never wraps.
 * From the start edge: logo, the project name (opens the projects dialog) over the save line, the mode bar, the command bar
 * (opens the palette), presence (the owner and the agent, whose menu holds "pause"), undo and redo, language, the export
 * state and the primary Export button. Export progress is a ring chip, never a text run in the bar. The flash check
 * moved to the status bar (StatusBar.tsx). Styles: ds/chrome.css (everything under .pf-ds).
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, CircleAlert, CloudOff, Download, Pencil, RotateCw, Search, User, X } from 'lucide-react';
import * as T from '@pulseframe/time';
import { LOGO_SVG } from '@pulseframe/brand';
import type { Key } from '@pulseframe/i18n';
import { Badge, IconButton, ModeBar, Ring, Tooltip, type SegOption } from '../ds/index.ts';
import { chordLabel, editEnd } from './commands.ts';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { onMenuKeyDown } from './menuKeys.ts';
import { InlineRename } from './InlineRename.tsx';
import { ProjectsDialog } from './ProjectsDialog.tsx';
import { IconExport, IconRedo, IconUndo } from './icons.tsx';
import { WORKSPACES, useEditorState, type Workspace } from './store.ts';
import '../ds/chrome.css';

const MODES: Workspace[] = ['pro', 'color', 'sound', 'captions', 'deliver'];
const TINT: Record<string, string> = { pro: 'var(--pf-m-edit)', color: 'var(--pf-m-look)', sound: 'var(--pf-m-sound)', captions: 'var(--pf-m-captions)', deliver: 'var(--pf-m-deliver)' };
const MODE_ICON: Record<string, string> = {
  pro: 'M4 6.5 12 12M4 17.5 12 12m0 0 8-7M12 12l8 7M5.5 5.5a2 2 0 1 0 0 .01M5.5 18.5a2 2 0 1 0 0 .01',
  color: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18',
  sound: 'M5 9v6M9 6v12M13 4v16M17 8v8M21 10.5v3',
  captions: 'M4 6h16v12H4zM8 11h3M13 11h3M8 14.5h8',
  deliver: 'M12 4v11m0 0-4-4m4 4 4-4M5 19h14',
};
const ModeGlyph = ({ id }: { id: string }) => (
  <svg className="pf-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={MODE_ICON[id]} /></svg>
);

const isTyping = (el: EventTarget | null) => { const e = el as HTMLElement | null; return !!e && (e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)); };

export function Header() {
  const { editor, state, t } = useEditorState();
  const { doc, save, revision, exportJob: job, lang } = state;
  const S = CHROME_STRINGS[lang];
  const viewVariant = state.viewVariantId ? doc?.variants?.[state.viewVariantId] ?? null : null;
  const exporting = !!job && ['queued', 'running', 'cancel-requested'].includes(job.status);
  const [projectsOpen, setProjectsOpen] = useState(false);

  // Shift+1…5 switch modes (§5). Not while typing, and not behind a dialog.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const m = /^Digit([1-5])$/.exec(e.code);
      if (m) { e.preventDefault(); editor.setWorkspace(MODES[Number(m[1]) - 1]!); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [editor]);

  const modeOptions: SegOption<Workspace>[] = MODES.map((m, i) => ({
    value: m, label: S.modes[m as keyof typeof S.modes], ariaLabel: `${S.modes[m as keyof typeof S.modes]} (Shift+${i + 1})`, icon: <ModeGlyph id={m} />, tint: TINT[m], testId: `workspace-${m}`,
  }));
  const shownMode: Workspace = MODES.includes(state.workspace) ? state.workspace : 'pro';

  const seconds = doc ? T.toSeconds(editEnd(doc)) : 0;
  const clock = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const saveWord = save === 'save.offline' ? S.offline : save === 'save.conflict' ? S.conflict : save === 'save.saving' ? S.saving : S.saved;
  const saveTone = save === 'save.conflict' ? 'warn' : save === 'save.offline' ? 'quiet' : '';
  const SaveIcon = save === 'save.offline' ? CloudOff : save === 'save.conflict' ? CircleAlert : Check;

  return (
    <header className="pf-ds pf-top" data-testid="top-bar">
      <span className="pf-top-logo" role="img" aria-label={S.logo} dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />

      <div className="pf-top-id">
        <div className="pf-top-nameRow">
          <Tooltip label={S.projectMenu}>
            <button type="button" className="pf-top-name" onClick={() => setProjectsOpen(true)} data-testid="projects-open" aria-haspopup="dialog" aria-label={`${S.projectMenu}: ${doc?.name ?? ''}`.trim()}>
              <span className="pf-top-nameText" dir="auto" data-testid="project-name">{doc?.name ?? t('app.loading')}</span>
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </Tooltip>
          {doc && <InlineRename value={doc.name} label={t('project.rename')} testid="project-rename" className="pf-top-rename" onCommit={(name) => void editor.commit([{ op: 'rename_project', args: { name } }], 'Rename project')} />}
        </div>
        <span className={`pf-top-save ${saveTone}`} role="status" data-testid="save-state">
          <SaveIcon size={12} strokeWidth={2} aria-hidden="true" />
          <span className="pf-top-saveWord">{saveWord}</span>
          {doc && save === 'save.saved' && <span className="num pf-top-meta" dir="ltr">{doc.settings.width}×{doc.settings.height} · {clock}</span>}
          {/* the revision number only for tools and tests: hidden from sight and from assistive technology (it is not owner language) */}
          <span className="pf-top-rev" data-testid="revision" aria-hidden="true"><bdi>{revision}</bdi></span>
        </span>
      </div>

      <div className="pf-top-modes" data-testid="workspace-switch">
        <ModeBar<Workspace> options={modeOptions} value={shownMode} onChange={(v) => editor.setWorkspace(v)} label={S.modeLabel} />
      </div>

      <button type="button" className="pf-top-cmd" onClick={() => editor.set({ paletteOpen: true })} data-testid="open-palette" aria-haspopup="dialog" aria-label={S.cmdOpen}>
        <span className="pf-top-cmdInner">
          <kbd className="pf-top-cmdKeys" dir="ltr"><span>{chordLabel('Mod+KeyK').split('+')[0]}</span><span>K</span></kbd>
          <span className="pf-top-cmdText">{S.cmdPlaceholder}</span>
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        </span>
      </button>

      {doc && Object.keys(doc.variants ?? {}).length > 0 && (
        <div className="pf-top-format">
          <label>
            <span className="pf-sr">{t('format.switch')}</span>
            <select value={state.viewVariantId ?? ''} onChange={(e) => editor.setViewVariant(e.target.value || null)} data-testid="format-switch" aria-label={t('format.switch')}>
              <option value="">{t('deliver.master')} ({doc.settings.width}×{doc.settings.height})</option>
              {Object.values(doc.variants ?? {}).map((v) => <option key={v.id} value={v.id}>{v.name} ({v.width}×{v.height})</option>)}
            </select>
          </label>
          {viewVariant && <span className="pf-top-badge" role="status" data-testid="format-badge" data-variant-id={viewVariant.id} title={t('format.badge')}><Badge tone="pulse"><bdi>{viewVariant.name}</bdi></Badge></span>}
          {viewVariant?.safeArea && (
            <label className="pf-top-safe"><input type="checkbox" checked={state.safeAreaOn} onChange={(e) => editor.setSafeArea(e.target.checked)} data-testid="safe-area-toggle" /> <span>{t('format.safeArea')}</span></label>
          )}
        </div>
      )}

      <div className="pf-top-end">
        <Presence />
        <div className="pf-top-hist">
          <IconButton label={S.undoTip} keys={[chordLabel('Mod+KeyZ').split('+')[0]!, 'Z']} size="md" disabled={!doc} onClick={() => void editor.history('undo')} data-testid="undo" icon={<IconUndo className="pf-ico-flip" />} />
          <IconButton label={S.redoTip} keys={[chordLabel('Mod+KeyZ').split('+')[0]!, 'Shift', 'Z']} size="md" disabled={!doc} onClick={() => void editor.history('redo')} data-testid="redo" icon={<IconRedo className="pf-ico-flip" />} />
        </div>
        <Tooltip label={S.language}>
          <button type="button" className="pf-top-lang" onClick={() => editor.setLang(lang === 'he' ? 'en' : 'he')} aria-label={t('lang.label')} data-testid="lang-toggle">{t('lang.toggle')}</button>
        </Tooltip>

        <ExportState />
        <button type="button" className="pf-btn pf-btn-primary pf-btn-md pf-top-export" disabled={!doc || exporting || editor.player?.frameCount === 0} onClick={() => editor.startExport()} data-testid="export">
          <IconExport />
          <span className="pf-btn-label">{exporting ? t('export.running') : t('export')}</span>
        </button>
      </div>
      {projectsOpen && <ProjectsDialog onClose={() => { setProjectsOpen(false); /* return focus to the button that opened the dialog */ setTimeout(() => document.querySelector<HTMLElement>('[data-testid=projects-open]')?.focus(), 0); }} />}
    </header>
  );
}

/** The export's own state, in the bar's end slot: a ring chip while it runs, a done chip with the download, or the way to retry. */
function ExportState() {
  const { editor, state, t } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const job = state.exportJob;
  if (!job) return null;
  const running = ['queued', 'running', 'cancel-requested'].includes(job.status);
  const pct = typeof job.output?.progress === 'number' ? Math.round(job.output.progress * 100) : null;
  return (
    <div className="pf-top-export-state">
      {running && (
        <>
          <span className="pf-top-chip" role="status" aria-label={S.exportRing}>
            <Ring value={pct} label={S.exportRing} size={28}>{pct != null ? `${pct}%` : undefined}</Ring>
          </span>
          <IconButton label={S.exportCancel} icon={<X size={16} strokeWidth={1.75} aria-hidden="true" />} size="sm" onClick={() => editor.cancelExport()} data-testid="export-cancel" variant="danger-quiet" />
        </>
      )}
      {job.status === 'succeeded' && (
        <>
          <span className="pf-top-chip is-done" role="status" data-testid="export-finished" title={t('export.finished')}><Check size={14} strokeWidth={2} aria-hidden="true" /><span>{S.exportDone}</span></span>
          <a className="pf-btn pf-btn-ghost pf-btn-sm pf-iconbtn" href={`/api/v1/jobs/${job.id}/output`} download data-testid="export-download" aria-label={t('export.done')} title={t('export.done')}><Download size={16} strokeWidth={1.75} aria-hidden="true" /></a>
        </>
      )}
      {job.status === 'canceled' && <span className="pf-top-chip is-quiet" role="status" data-testid="export-canceled"><span>{t('export.canceled')}</span></span>}
      {(job.status === 'canceled' || job.status === 'failed') && <IconButton label={S.exportRetry} icon={<RotateCw size={16} strokeWidth={1.75} aria-hidden="true" />} size="sm" onClick={() => editor.retryExport()} data-testid="export-retry" />}
    </div>
  );
}

/** The owner, and the agent: a violet ring and a status dot; its menu pauses it. The menu is a plain popover with a real focus order. */
function Presence() {
  const { editor, state } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const paused = state.agentsPaused;
  const doc = state.doc;
  return (
    <div className="pf-top-presence" role="group" aria-label={S.presence} ref={root}>
      <span className="pf-top-avatar is-owner" title={S.owner}><User size={16} strokeWidth={1.75} aria-hidden="true" /><span className="pf-sr">{S.owner}</span></span>
      <button ref={btn} type="button" className={`pf-top-avatar is-agent${paused ? ' is-paused' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={`${S.agentMenu}: ${paused ? S.agentPaused : S.agentReady}`} disabled={!doc} onClick={() => setOpen((o) => !o)} data-testid="agent-menu">
        <Bot size={16} strokeWidth={1.75} aria-hidden="true" /><i className="pf-top-dot" aria-hidden="true" />
      </button>
      {paused && <span className="pf-top-paused" role="status" data-testid="agents-paused">{S.agentPaused}</span>}
      {open && (
        <div className="pf-top-menu" role="menu" aria-label={S.agentMenu} onKeyDown={(e) => { if (e.key === 'Tab') setOpen(false); else onMenuKeyDown(e); }}>
          <div className="pf-top-menuHead" aria-hidden="true">{S.agentMenu} · {paused ? S.agentPaused : S.agentReady}</div>
          <button type="button" role="menuitemcheckbox" aria-checked={paused} autoFocus className="pf-top-menuItem" data-testid="pause-agent" onClick={() => { editor.setAgentsPaused(!paused); setOpen(false); btn.current?.focus(); }}>{paused ? S.resumeAgent : S.pauseAgent}</button>
          <button type="button" role="menuitem" className="pf-top-menuItem is-danger" aria-disabled="true" title={S.undoAgentWhy} onClick={(e) => e.preventDefault()}>{S.undoAgent}<span className="pf-top-menuWhy"> · {S.undoAgentWhy}</span></button>
        </div>
      )}
    </div>
  );
}

// Referenced so the workspace list stays the single source of truth for the old selector's values.
void WORKSPACES; void Pencil; void ({} as Key);
