/**
 * The top bar (docs/design/UX_REDESIGN.md §4.2): one row with fixed slots that never wraps.
 * From the start edge: logo, the project name (opens the projects dialog) over the save line, the mode bar, the command bar
 * (opens the palette), presence (the owner and the agent, whose menu holds "pause"), undo and redo, language, the export
 * state and the primary Export button. Export always opens the export sheet (ExportSheet.tsx, owner decision); its progress
 * is a ring chip here, a button that reopens the sheet, never a text run in the bar. Cancel, retry, the finished file and the
 * flash check live in the sheet; the flash check also stays in the status bar (StatusBar.tsx). The format switch and the
 * safe-area guide live in the stage header (StageHeader.tsx, FormatPrism.tsx). Styles: ds/chrome.css (everything under .pf-ds).
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, CircleAlert, CloudOff, Pencil, Search, TriangleAlert, User } from 'lucide-react';
import * as T from '@pulseframe/time';
import { LOGO_SVG } from '@pulseframe/brand';
import type { Key } from '@pulseframe/i18n';
import { IconButton, ModeBar, Ring, Tooltip, type SegOption } from '../ds/index.ts';
import { chordLabel, editEnd } from './commands.ts';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { onMenuKeyDown } from './menuKeys.ts';
import { InlineRename } from './InlineRename.tsx';
import { openExportSheet, useExportSheet } from './ExportSheet.tsx';
import { isActiveJob, jobFraction, overallFraction } from './exportSheet.logic.ts';
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
        <button type="button" className="pf-btn pf-btn-primary pf-btn-md pf-top-export" aria-haspopup="dialog" disabled={!doc || editor.player?.frameCount === 0} onClick={() => openExportSheet()} data-testid="export">
          <IconExport />
          <span className="pf-btn-label">{exporting ? t('export.running') : t('export')}</span>
        </button>
      </div>
      {projectsOpen && <ProjectsDialog onClose={() => { setProjectsOpen(false); /* return focus to the button that opened the dialog */ setTimeout(() => document.querySelector<HTMLElement>('[data-testid=projects-open]')?.focus(), 0); }} />}
    </header>
  );
}

/**
 * The export's own state, in the bar's end slot: one chip that is a button reopening the export sheet on the last run. While
 * the export runs it is a ring with the share done (the sheet's own runs when it started them, else the editor's latest export
 * job); then a done chip, or a quiet chip that says it failed or was canceled. Cancel, retry and the file are in the sheet.
 */
function ExportState() {
  const { state, t } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const sheet = useExportSheet();
  const job = state.exportJob;
  const mine = sheet.jobs.length > 0 && (!job || sheet.jobs.some((j) => j.id === job.id));
  const running = mine ? sheet.starting || sheet.jobs.some((j) => isActiveJob(j.status)) : !!job && isActiveJob(job.status);
  if (!mine && !job) return null;
  const frac = mine ? overallFraction([...sheet.jobs]) : job ? jobFraction(job) ?? (typeof job.output?.progress === 'number' ? job.output.progress : null) : null;
  const pct = frac == null ? null : Math.round(frac * 100);
  const status = running ? 'running' : mine ? (sheet.jobs.some((j) => j.status === 'succeeded') ? 'succeeded' : sheet.jobs.every((j) => j.status === 'canceled') ? 'canceled' : 'failed') : job!.status;
  const open = () => openExportSheet({ last: true });
  if (running) {
    const label = `${S.exportRing}${pct != null ? ` · ${pct}%` : ''} · ${S.exportOpen}`;
    return (
      <div className="pf-top-export-state">
        <Tooltip label={label}>
          <button type="button" className="pf-top-chip" aria-haspopup="dialog" aria-label={label} data-testid="export-ring" data-status="running" onClick={open}>
            <Ring value={pct} label={S.exportRing} size={28}>{pct != null ? `${pct}%` : undefined}</Ring>
          </button>
        </Tooltip>
      </div>
    );
  }
  if (status === 'succeeded') return <div className="pf-top-export-state"><button type="button" className="pf-top-chip is-done" aria-haspopup="dialog" title={t('export.finished')} data-testid="export-ring" data-status="succeeded" onClick={open}><Check size={14} strokeWidth={2} aria-hidden="true" /><span>{S.exportDone}</span></button></div>;
  if (status === 'failed' || status === 'canceled') return <div className="pf-top-export-state"><button type="button" className="pf-top-chip is-quiet" aria-haspopup="dialog" data-testid="export-ring" data-status={status} onClick={open}>{status === 'failed' && <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />}<span>{status === 'failed' ? S.exportFailed : S.exportCanceled}</span></button></div>;
  return null;
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
