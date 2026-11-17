/** The top bar: project name, format and workspace switches, save state, history, projects, palette, language, export. Split out of panels.tsx unchanged. */
import { useState } from 'react';
import { BRAND, LOGO_SVG } from '@pulseframe/brand';
import { jobStageLabel, type Key } from '@pulseframe/i18n';
import { chordLabel } from './commands.ts';
import { useEditorState, WORKSPACES, type Workspace } from './store.ts';
import { ProjectsDialog } from './ProjectsDialog.tsx';
import { InlineRename } from './InlineRename.tsx';
import { IconExport, IconLanguage, IconProjects, IconRedo, IconSearch, IconUndo } from './icons.tsx';

export function Header() {
  const { editor, state, t } = useEditorState();
  const { doc, save, revision, exportJob: job, lang } = state;
  const viewVariant = state.viewVariantId ? doc?.variants?.[state.viewVariantId] ?? null : null;
  const exporting = job && ['queued', 'running', 'cancel-requested'].includes(job.status);
  const [projectsOpen, setProjectsOpen] = useState(false);
  return (
    <header className="header">
      <span className="logo" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
      <strong className="brand">{BRAND.name}</strong>
      <span className="title" data-testid="project-name">{doc?.name ?? t('app.loading')}</span>
      {doc && <InlineRename value={doc.name} label={t('project.rename')} testid="project-rename" onCommit={(name) => void editor.commit([{ op: 'rename_project', args: { name } }], 'Rename project')} />}
      {doc && (
        <label className="format-switch">
          <span className="sr-only">{t('format.switch')}</span>
          <select value={state.viewVariantId ?? ''} onChange={(e) => editor.setViewVariant(e.target.value || null)} data-testid="format-switch" aria-label={t('format.switch')}>
            <option value="">{t('deliver.master')} ({doc.settings.width}×{doc.settings.height})</option>
            {Object.values(doc.variants ?? {}).map((v) => <option key={v.id} value={v.id}>{v.name} ({v.width}×{v.height})</option>)}
          </select>
        </label>
      )}
      <label className="format-switch">
        <span className="sr-only">{t('workspace')}</span>
        <select value={state.workspace} onChange={(e) => editor.setWorkspace(e.target.value as Workspace)} data-testid="workspace-switch" aria-label={t('workspace')}>
          {WORKSPACES.map((w) => <option key={w} value={w}>{t(`workspace.${w}` as Key)}</option>)}
        </select>
      </label>
      {viewVariant && (
        <span className="format-badge" role="status" data-testid="format-badge" data-variant-id={viewVariant.id}>{t('format.badge')}</span>
      )}
      {viewVariant?.safeArea && (
        <label className="check format-safe"><input type="checkbox" checked={state.safeAreaOn} onChange={(e) => editor.setSafeArea(e.target.checked)} data-testid="safe-area-toggle" /> {t('format.safeArea')}</label>
      )}
      <span className="spacer" />
      <span className={`save ${save === 'save.conflict' || save === 'save.offline' ? 'warn' : ''}`} role="status" data-testid="save-state">{t(save)}</span>
      <span className="rev" data-testid="revision">{t('revision')} <bdi>{revision}</bdi></span>
      <button className={`ghost ${state.agentsPaused ? 'paused' : ''}`} disabled={!doc} aria-pressed={state.agentsPaused} onClick={() => editor.setAgentsPaused(!state.agentsPaused)} data-testid="pause-agent">{state.agentsPaused ? t('agents.resume') : t('agents.pause')}</button>
      {state.agentsPaused && <span className="save warn" role="status" data-testid="agents-paused">{t('agents.paused')}</span>}
      <button className="ghost" disabled={!doc} onClick={() => void editor.history('undo')} data-testid="undo" title="Ctrl+Z"><IconUndo className="pf-ico-flip" />{t('undo')}</button>
      <button className="ghost" disabled={!doc} onClick={() => void editor.history('redo')} data-testid="redo" title="Ctrl+Shift+Z"><IconRedo className="pf-ico-flip" />{t('redo')}</button>
      <button className="ghost" onClick={() => setProjectsOpen(true)} data-testid="projects-open" aria-haspopup="dialog"><IconProjects />{t('projects.open')}</button>
      {projectsOpen && <ProjectsDialog onClose={() => { setProjectsOpen(false); /* return focus to the button that opened the dialog */ setTimeout(() => document.querySelector<HTMLElement>('[data-testid=projects-open]')?.focus(), 0); }} />}
      <button className="ghost" onClick={() => editor.set({ paletteOpen: true })} data-testid="open-palette" aria-haspopup="dialog"><IconSearch />{t('cmd.palette')} <kbd>{chordLabel('Mod+KeyK')}</kbd></button>
      <button className="ghost" onClick={() => editor.setLang(lang === 'he' ? 'en' : 'he')} aria-label={t('lang.label')} data-testid="lang-toggle"><IconLanguage />{t('lang.toggle')}</button>
      {job?.status === 'succeeded' && <span className="save" role="status" data-testid="export-finished">{t('export.finished')}</span>}
      {job?.status === 'succeeded' && <a className="ghost" href={`/api/v1/jobs/${job.id}/output`} download data-testid="export-download">{t('export.done')}</a>}
      {job?.status === 'succeeded' && job.output?.photosensitivity && <FlashResult report={job.output.photosensitivity} />}
      {exporting && <button className="ghost danger" onClick={() => editor.cancelExport()} data-testid="export-cancel">{t('export.cancel')}</button>}
      {job?.status === 'canceled' && <span className="save warn" role="status" data-testid="export-canceled">{t('export.canceled')}</span>}
      {(job?.status === 'canceled' || job?.status === 'failed') && <button className="ghost" onClick={() => editor.retryExport()} data-testid="export-retry">{t('export.retry')}</button>}
      <button className="primary" disabled={!doc || !!exporting || editor.player?.frameCount === 0} onClick={() => editor.startExport()} data-testid="export">
        <IconExport />{exporting ? <>{t('export.running')} <bdi>{jobStageLabel(job?.stage, lang)}</bdi></> : t('export')}
      </button>
    </header>
  );
}

/** The photosensitivity result of the last export (ADR-0009): a quiet status when it passed; otherwise the stretches, with jump-to. */
function FlashResult({ report }: { report: { verdict: 'pass' | 'fail'; ranges: { from: { value: string; timescale: number }; to: { value: string; timescale: number }; kind: 'general' | 'red'; flashesPerSecond: number; area: number }[] } }) {
  const { editor, state, t } = useEditorState();
  if (report.verdict === 'pass') return <span className="save" role="status" data-testid="flash-pass" title={t('flash.passTitle')}>{t('flash.pass')}</span>;
  const rate = state.doc?.settings.frameRate;
  const sec = (x: { value: string; timescale: number }) => Number(x.value) / x.timescale;
  const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  return (
    <details className="flash-result" data-testid="flash-fail">
      <summary className="save warn" role="status">{t('flash.fail')} ({report.ranges.length})</summary>
      <div className="flash-result-body" role="group" aria-label={t('flash.fail')}>
        <p>{t('flash.failIntro')}</p>
        <ul>
          {report.ranges.map((r, i) => (
            <li key={i} data-testid="flash-range">
              <bdi dir="ltr">{clock(sec(r.from))}–{clock(sec(r.to))}</bdi> · {t(r.kind === 'red' ? 'flash.red' : 'flash.general')} {r.flashesPerSecond} {t('flash.perSecond')} · {Math.round(r.area * 100)}% {t('flash.area')}
              {rate && <button type="button" className="ghost" onClick={() => editor.seek(Math.floor((sec(r.from) * rate.num) / rate.den))} data-testid="flash-jump">{t('flash.jump')}</button>}
            </li>
          ))}
        </ul>
        <p className="muted">{t('flash.method')}</p>
      </div>
    </details>
  );
}
