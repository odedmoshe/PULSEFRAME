import { useEffect, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { BRAND, LOGO_SVG } from '@pulseframe/brand';
import type { Clip } from '@pulseframe/core';
import { assetNotices, clipEnd, FONT_CATALOG, speedValue } from '@pulseframe/core';
import { dictionaries, jobStageLabel, type Key } from '@pulseframe/i18n';
import { chordLabel, COMMANDS, type Keymap } from './commands.ts';
import { Scopes } from './Scopes.tsx';
import { ASSET_DRAG_TYPE, useEditorState, WORKSPACES, type Editor, type Workspace } from './store.ts';
import { DeliverPanel } from './DeliverPanel.tsx';
import { AnalysisPanel } from './AnalysisPanel.tsx';
import { RecipesPanel } from './RecipesPanel.tsx';
import { LookPanel } from './LookPanel.tsx';
import { SoundPanel } from './SoundPanel.tsx';
import { formatBytes, ProjectsDialog } from './ProjectsDialog.tsx';
import { AccessPanel } from './AccessPanel.tsx';
import { SourceViewer } from './SourceViewer.tsx';
import { InlineRename } from './InlineRename.tsx';
import { ActivityDialog } from './ActivityDialog.tsx';
import { CaptionControls, FillerPanel, SilencePanel, TranscribeAll, TranscriptPanel } from './TranscriptPanel.tsx';

const run = (editor: Editor, id: string) => { const c = COMMANDS.find((x) => x.id === id)!; if (!c.enabled || c.enabled(editor)) void c.run(editor); };
const hint = (keymap: Keymap, id: string) => { const k = keymap.keysFor(id)[0]; return k ? <kbd>{chordLabel(k)}</kbd> : null; };

function FillerSection() {
  const { state, t } = useEditorState();
  if (!state.doc || !Object.keys(state.doc.transcripts).length) return null;
  return (<><h2>{t('filler')}</h2><FillerPanel /></>);
}

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
      <button className="ghost" disabled={!doc} onClick={() => void editor.history('undo')} data-testid="undo" title="Ctrl+Z">{t('undo')}</button>
      <button className="ghost" disabled={!doc} onClick={() => void editor.history('redo')} data-testid="redo" title="Ctrl+Shift+Z">{t('redo')}</button>
      <button className="ghost" onClick={() => setProjectsOpen(true)} data-testid="projects-open" aria-haspopup="dialog">{t('projects.open')}</button>
      {projectsOpen && <ProjectsDialog onClose={() => { setProjectsOpen(false); /* return focus to the button that opened the dialog */ setTimeout(() => document.querySelector<HTMLElement>('[data-testid=projects-open]')?.focus(), 0); }} />}
      <button className="ghost" onClick={() => editor.set({ paletteOpen: true })} data-testid="open-palette" aria-haspopup="dialog">{t('cmd.palette')} <kbd>{chordLabel('Mod+KeyK')}</kbd></button>
      <button className="ghost" onClick={() => editor.setLang(lang === 'he' ? 'en' : 'he')} aria-label={t('lang.label')} data-testid="lang-toggle">{t('lang.toggle')}</button>
      {job?.status === 'succeeded' && <span className="save" role="status" data-testid="export-finished">{t('export.finished')}</span>}
      {job?.status === 'succeeded' && <a className="ghost" href={`/api/v1/jobs/${job.id}/output`} download data-testid="export-download">{t('export.done')}</a>}
      {exporting && <button className="ghost danger" onClick={() => editor.cancelExport()} data-testid="export-cancel">{t('export.cancel')}</button>}
      {job?.status === 'canceled' && <span className="save warn" role="status" data-testid="export-canceled">{t('export.canceled')}</span>}
      {(job?.status === 'canceled' || job?.status === 'failed') && <button className="ghost" onClick={() => editor.retryExport()} data-testid="export-retry">{t('export.retry')}</button>}
      <button className="primary" disabled={!doc || !!exporting || editor.player?.frameCount === 0} onClick={() => editor.startExport()} data-testid="export">
        {exporting ? <>{t('export.running')} <bdi>{jobStageLabel(job?.stage, lang)}</bdi></> : t('export')}
      </button>
    </header>
  );
}

export function ErrorBar() {
  const { editor, state, t } = useEditorState();
  const { error, exportJob: job } = state;
  if (!error && job?.status !== 'failed') return null;
  return (
    <div className="error" role="alert">
      {/* a coded refusal: translated headline, then the server's detail in its own direction (it is English) */}
      {error && state.errorHeadline && error.startsWith(`${state.errorHeadline}: `)
        ? <><span data-testid="error-headline">{state.errorHeadline}</span>: <bdi dir="auto" data-testid="error-detail">{error.slice(state.errorHeadline.length + 2)}</bdi></>
        : error ?? `${t('export.failed')}: ${job?.error?.message ?? ''}`}
      <button className="ghost" onClick={() => editor.set({ error: null, ...(job?.status === 'failed' ? { exportJob: null } : {}) })} aria-label={t('close')}>×</button>
    </div>
  );
}

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
        <input type="file" multiple accept="video/*,audio/*,image/png,image/jpeg,image/webp" disabled={uploading || !doc} data-testid="file-input" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void editor.importFiles(fs); }} />
      </label>
      {doc && Object.keys(doc.assets).length === 0 && <p className="muted">{t('media.empty')}</p>}
      {viewing && doc?.assets[viewing] && <SourceViewer assetId={viewing} onClose={() => { const id = viewing; setViewing(null); setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="view-${id}"]`)?.focus(), 0); }} />}
      <ul className="assets">
        {doc && Object.values(doc.assets).map((a) => (
          <li key={a.id} draggable data-testid={`asset-${a.id}`} title={t('media.dragHint')}
            onDragStart={(e) => { e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id); e.dataTransfer.effectAllowed = 'copy'; }}>
            <span className="asset-name-row"><span className="asset-name" dir="auto" title={a.name}>{a.name}</span>
              <InlineRename value={a.name} label={`${t('media.rename')}: ${a.name}`} testid={`rename-${a.id}`} onCommit={(name) => void editor.commit([{ op: 'rename_asset', args: { assetId: a.id, name } }], 'Rename file')} /></span>
            <span className="muted"><bdi>{a.kind === 'image' ? `${a.image?.width}×${a.image?.height}` : `${T.toSeconds(a.duration).toFixed(2)}s${a.video ? ` · ${a.video.width}×${a.video.height}` : ''}`}</bdi></span>
            {assetNotices(a).map((n) => (
              <span key={n.code} className="asset-notice" data-testid="asset-notice" data-code={n.code}>
                <span aria-hidden="true">ⓘ </span>
                {n.code === 'converted' ? `${t('notice.converted')}: ${n.reasons.map((r) => t(`notice.reason.${r}` as Key)).join(', ')}`
                  : n.code === 'picture-starts-late' ? `${t('notice.pictureLate')} (${n.frames})`
                  : n.code === 'sound-offset' ? `${n.seconds > 0 ? t('notice.soundLate') : t('notice.soundEarly')} (${Math.abs(n.seconds).toFixed(2)}s)`
                  : t('notice.colourUntagged')}
                {n.code === 'colour-untagged' && (
                  <label className="notice-choice">{t('notice.colourReadAs')}{' '}
                    <select value={n.readAs} data-testid={`colour-read-${a.id}`} onChange={(e) => void editor.commit([{ op: 'set_asset_colour', args: { assetId: a.id, readAs: e.target.value } }], 'Colour reading')}>
                      <option value="auto">{t('notice.colourReadAs.auto')}</option>
                      <option value="bt601">{t('notice.colourReadAs.bt601')}</option>
                    </select>
                  </label>
                )}
              </span>
            ))}
            <button className="ghost" onClick={() => void editor.addAsset(a.id)} data-testid={`add-${a.id}`}>{t('media.add')}</button>
            {a.kind !== 'image' && <button className="ghost" onClick={() => setViewing(a.id)} data-testid={`view-${a.id}`}>{t('source.open')}</button>}
            {(() => { const used = doc.sequences[doc.mainSequenceId]!.tracks.some((tr) => tr.clips.some((c) => c.type === 'media' && c.assetId === a.id)); return (
              <button className="ghost danger" disabled={used} title={used ? t('media.remove.used') : undefined} onClick={() => void editor.commit([{ op: 'remove_asset', args: { assetId: a.id } }], 'Remove file')} data-testid={`remove-${a.id}`}>{t('media.remove')}</button>
            ); })()}
          </li>
        ))}
      </ul>
      <h2>{t('text')}</h2>
      <button className="ghost" disabled={!doc} onClick={() => void editor.addText()} data-testid="add-text">{t('text.add')}</button>
      <h2>{t('providers')}</h2>
      <ProviderPanel />
    </aside>
  );
}

function ProviderPanel() {
  const { editor, state, t } = useEditorState();
  const { provider, capJob: job } = state;
  if (!provider) return null;
  const pr = provider.provider;
  if (!pr.configured) return <p className="muted" data-testid="provider-status" data-state="not-configured">{t('providers.notConfigured')}</p>;
  if (!pr.readiness?.reachable) return <p className="muted" data-testid="provider-status" data-state="unreachable">{t('providers.unreachable')}</p>;
  const smoke = provider.capabilities.find((c) => c.id === 'comfy.smoke.solid-image');
  const busy = job && ['queued', 'running', 'cancel-requested'].includes(job.status);
  return (
    <div className="fields">
      <p className="muted" data-testid="provider-status" data-state="ready">{t('providers.ready')} · <bdi>{pr.readiness.runtimeVersion} · {pr.readiness.device?.type}</bdi></p>
      {smoke && <button className="ghost" disabled={!smoke.runnable || !!busy} onClick={() => editor.runCapability(smoke.id)} data-testid="provider-smoke">{busy ? `${t('providers.running')} ${job?.stage ?? ''}` : t('providers.smoke')}</button>}
      {job?.status === 'succeeded' && (
        <p className="muted" data-testid="provider-result" data-job={job.id}>
          <img src={`/api/v1/jobs/${job.id}/outputs/0`} alt="" width={48} height={48} style={{ verticalAlign: 'middle', borderRadius: 4, marginInlineEnd: 8 }} />
          {t('providers.ok')} · <bdi>{job.output?.bundle?.[0]?.width}×{job.output?.bundle?.[0]?.height}</bdi>
        </p>
      )}
      {job?.status === 'failed' && <p className="muted danger" data-testid="provider-result" role="alert">{t('providers.failed')}: {job.error?.message}</p>}
    </div>
  );
}

export function Transport() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const rate = editor.rate;
  const p = editor.player;
  return (
    <div className="transport" dir="ltr">
      <button className="ghost" onClick={() => run(editor, 'transport.prevFrame')} aria-label={t('frame.prev')}>◀︎</button>
      <button className="primary" onClick={() => run(editor, 'transport.toggle')} aria-label={p?.playing ? t('pause') : t('play')} data-testid="play">{p?.playing ? '❚❚' : '▶'}</button>
      <button className="ghost" onClick={() => run(editor, 'transport.nextFrame')} aria-label={t('frame.next')}>▶︎</button>
      <button className="ghost" onClick={() => run(editor, 'transport.loop')} aria-pressed={!!p?.loop} aria-label={t('cmd.loop')} title={t('cmd.loop')} data-testid="loop">⟳</button>
      {!!p?.shuttleRate && <span className="shuttle" role="status" data-testid="shuttle" aria-label={`${t(p.shuttleRate < 0 ? 'cmd.shuttleBack' : 'cmd.shuttleForward')} ×${Math.abs(p.shuttleRate)}`}>{p.shuttleRate < 0 ? '◀◀' : '▶▶'} ×{Math.abs(p.shuttleRate)}</span>}
      <span className="timecode" data-testid="timecode">{T.toTimecode(editor.playhead, rate)}</span>
      <span className="muted">/ {T.toTimecode(editor.duration, rate)} · {editor.viewDoc?.settings.width}×{editor.viewDoc?.settings.height} · {(rate.num / rate.den).toFixed(rate.den === 1 ? 0 : 2)} fps</span>
    </div>
  );
}

/** Clip speed: a number field with common presets. Commits `set_clip_speed`; the clip's length follows, picture and linked sound together. */
function SpeedField({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  const { editor, t } = useEditorState();
  const value = +speedValue(clip).toFixed(3);
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value, clip.id]);
  const set = (n: number) => { if (n !== value) void editor.commit([{ op: 'set_clip_speed', args: { clipId: clip.id, speed: n } }], 'Clip speed'); };
  // The sound this clip's speed applies to: the clip itself on a sound track, and the sound clips linked to it.
  const doc = editor.doc;
  const sound = doc ? doc.sequences[doc.mainSequenceId]!.tracks.filter((tr) => tr.kind === 'audio').flatMap((tr) => tr.clips)
    .filter((c): c is Extract<Clip, { type: 'media' }> => c.type === 'media' && (c.id === clip.id || (!!clip.linkGroupId && c.linkGroupId === clip.linkGroupId)) && !!doc.assets[c.assetId]?.audio) : [];
  const commit = () => { const n = Number(v); if (v === '' || !Number.isFinite(n) || n < 0.1 || n > 8) { setV(String(value)); return; } set(Math.round(n * 1000) / 1000); };
  return (
    <div className="fields" data-testid="speed-field">
      <label>{t('speed.label')}
        <input type="number" dir="ltr" min={0.1} max={8} step={0.05} value={v} data-testid="clip-speed"
          onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      </label>
      <div className="row" role="group" aria-label={t('speed.presets')}>
        {[0.25, 0.5, 1, 2, 4].map((p) => <button key={p} className="ghost" aria-pressed={value === p} data-testid={`clip-speed-${p}`} onClick={() => set(p)}><bdi>{p}×</bdi></button>)}
      </div>
      <p className="muted">{t('speed.hint')}</p>
      {sound.length > 0 && (
        <label className="check">
          <input type="checkbox" checked={sound.every((c) => !!c.keepPitch)} data-testid="clip-keep-pitch"
            onChange={(e) => void editor.commit([{ op: 'set_clip_pitch', args: { clipId: clip.id, keepPitch: e.target.checked } }], 'Keep pitch')} />
          {t('speed.keepPitch')}
        </label>
      )}
    </div>
  );
}

/** Freeze frame: hold the picture at the playhead for a chosen time. Everything after it moves later (one transaction). */
/** A gradual speed change over the selected clip, as consecutive steps of constant speed (see the `speed_ramp` op). */
function RampField({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  const { editor, t } = useEditorState();
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('2');
  const [steps, setSteps] = useState('8');
  const [eased, setEased] = useState(clip.speedCurve === 'smooth');
  const a = Number(from), b = Number(to), n = Math.round(Number(steps));
  const range = a >= 0.1 && a <= 8 && b >= 0.1 && b <= 8 && a !== b;
  const ok = range && n >= 2 && n <= 24 && !clip.keyframes && !clip.volume && !clip.transition && !clip.reverse && !clip.speedEnd;
  const smoothOk = range && !clip.transition && !clip.reverse && !clip.freeze && !clip.keepPitch;
  return (
    <fieldset className="ramp" data-testid="ramp">
      <legend>{t('ramp.title')}</legend>
      <div className="row">
        <label>{t('ramp.from')}<input type="number" dir="ltr" min={0.1} max={8} step={0.05} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="ramp-from" /></label>
        <label>{t('ramp.to')}<input type="number" dir="ltr" min={0.1} max={8} step={0.05} value={to} onChange={(e) => setTo(e.target.value)} data-testid="ramp-to" /></label>
        <label>{t('ramp.steps')}<input type="number" dir="ltr" min={2} max={24} step={1} value={steps} onChange={(e) => setSteps(e.target.value)} data-testid="ramp-steps" /></label>
      </div>
      {clip.speedEnd && (
        <p className="row" data-testid="ramp-state">
          <span>{t('ramp.now')}: <bdi dir="ltr">{+speedValue(clip).toFixed(3)}× → {+(clip.speedEnd.num / clip.speedEnd.den).toFixed(3)}×</bdi>{clip.speedCurve === 'smooth' ? ` · ${t('ramp.eased.short')}` : ''}{clip.rampWindow ? ` · ${t('ramp.part')}` : ''}</span>
          <button type="button" className="ghost" data-testid="ramp-clear" onClick={() => void editor.commit([{ op: 'set_clip_speed', args: { clipId: clip.id, speed: +speedValue(clip).toFixed(3) } }], 'Clip speed')}>{t('ramp.clear')}</button>
        </p>
      )}
      <div className="row">
        <button type="button" className="primary" disabled={!smoothOk} data-testid="ramp-smooth" onClick={() => void editor.commit([{ op: 'set_clip_speed_ramp', args: { clipId: clip.id, from: a, to: b, ...(eased ? { curve: 'smooth' } : {}) } }], 'Gradual speed change')}>{t('ramp.smooth')}</button>
        <button type="button" className="ghost" disabled={!ok} data-testid="ramp-apply" onClick={() => void editor.commit([{ op: 'speed_ramp', args: { clipId: clip.id, from: a, to: b, steps: n } }], 'Speed ramp')}>{t('ramp.apply')}</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={eased} data-testid="ramp-eased" onChange={(e) => setEased(e.target.checked)} />
        {t('ramp.eased')}
      </label>
      <p className="muted">{t('ramp.smoothNote')}</p>
      <p className="muted">{t('ramp.note')}</p>
    </fieldset>
  );
}

function FreezeField({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  const { editor, t } = useEditorState();
  const [secs, setSecs] = useState('1');
  const n = Number(secs);
  const valid = secs !== '' && Number.isFinite(n) && n > 0 && n <= 600;
  const inside = T.lte(clip.start, editor.playhead) && T.lt(editor.playhead, T.add(clip.start, clip.duration));
  const run = () => {
    const at = editor.playhead; // read when used, not at the last render
    if (!valid || !T.lte(clip.start, at) || !T.lt(at, T.add(clip.start, clip.duration))) return;
    const frames = Math.max(1, Math.round((n * editor.rate.num) / editor.rate.den));
    void editor.commit([{ op: 'freeze_frame', args: { clipId: clip.id, at, duration: T.frameTime(frames, editor.rate) } }], 'Freeze frame');
  };
  return (
    <div className="fields" data-testid="freeze-field">
      <label>{t('freeze.seconds')}
        <input type="number" dir="ltr" min={0.1} max={600} step={0.1} value={secs} data-testid="freeze-seconds" onChange={(e) => setSecs(e.target.value)} />
      </label>
      <button type="button" className="ghost" disabled={!valid || !inside} data-testid="freeze-apply" onClick={run}>{t('freeze.apply')}</button>
      <p className="muted">{t('freeze.hint')}</p>
    </div>
  );
}

const TRANSFORM_FIELDS: { prop: 'x' | 'y' | 'scale' | 'rotation' | 'opacity'; label: Key; min: number; max: number; step: number }[] = [
  { prop: 'x', label: 'transform.x', min: -0.6, max: 0.6, step: 0.01 },
  { prop: 'y', label: 'text.y', min: -0.6, max: 0.6, step: 0.01 },
  { prop: 'scale', label: 'transform.scale', min: 0.1, max: 4, step: 0.05 },
  { prop: 'rotation', label: 'transform.rotation', min: -180, max: 180, step: 1 },
  { prop: 'opacity', label: 'transform.opacity', min: 0, max: 1, step: 0.05 },
];

const INSPECTOR_TABS = ['clip', 'speech', 'captions', 'sound', 'review', 'deliver', 'recipes', 'all'] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number];
const TAB_KEY = 'pf.inspector.tab.v1';
/** Panels each workspace offers, in order; the first is shown when the workspace is chosen. Pro offers everything. */
const WORKSPACE_TABS: Record<Workspace, readonly InspectorTab[]> = {
  pro: INSPECTOR_TABS,
  quick: ['recipes', 'speech', 'captions', 'deliver'],
  // Motion and Color both use the clip panel, each showing its own part of it (see `clipFocus`).
  motion: ['clip'],
  color: ['clip'],
  custom: INSPECTOR_TABS, // replaced by the user's own choice (see `customTabs`)
  captions: ['captions', 'speech', 'clip'],
  sound: ['sound', 'clip'],
  deliver: ['deliver', 'review'],
};

const CUSTOM_TABS_KEY = 'pf.workspace.custom.v1';
function loadCustomTabs(): InspectorTab[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_TABS_KEY) ?? 'null');
    const ok = Array.isArray(v) ? INSPECTOR_TABS.filter((x) => x !== 'all' && v.includes(x)) : [];
    if (ok.length) return ok;
  } catch { /* fall through */ }
  return ['clip', 'sound', 'deliver'];
}
function loadTab(): InspectorTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if ((INSPECTOR_TABS as readonly string[]).includes(v ?? '')) return v as InspectorTab;
  } catch { /* storage unavailable */ }
  return 'clip';
}

export function Inspector({ keymap }: { keymap: Keymap }) {
  const { editor, state, t } = useEditorState();
  const sel = editor.selected;
  const [tab, setTabState] = useState<InspectorTab>(loadTab);
  const [activityOpen, setActivityOpen] = useState(false);
  const setTab = (next: InspectorTab) => {
    setTabState(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* ignore */ }
  };
  // The workspace narrows the tabs on offer. A tab that is not offered is replaced by the workspace's first one (only what is shown changes: nothing in the project does).
  // The custom workspace offers the panels the user ticked (kept in this browser), in the usual order; at least one.
  const [custom, setCustom] = useState<InspectorTab[]>(loadCustomTabs);
  const toggleCustom = (id: InspectorTab) => {
    const next = INSPECTOR_TABS.filter((x) => x !== 'all' && (x === id ? !custom.includes(x) : custom.includes(x)));
    if (!next.length) return; // the last panel stays
    setCustom(next);
    try { localStorage.setItem(CUSTOM_TABS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    if (!next.includes(tab)) setTab(next[0]!);
  };
  const tabs: readonly InspectorTab[] = state.workspace === 'custom' ? custom : WORKSPACE_TABS[state.workspace];
  const lastWs = useRef(state.workspace);
  useEffect(() => {
    if (lastWs.current !== state.workspace) { lastWs.current = state.workspace; setTab(tabs[0]!); }
    else if (!tabs.includes(tab)) setTab(tabs[0]!);
  }, [state.workspace]); // eslint-disable-line react-hooks/exhaustive-deps
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const INSPECTOR_TABS = tabs;
    const i = INSPECTOR_TABS.indexOf(tab);
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    let n = i;
    // Visual left/right; DOM order runs right-to-left in RTL.
    if (e.key === 'ArrowRight') n = rtl ? i - 1 : i + 1;
    else if (e.key === 'ArrowLeft') n = rtl ? i + 1 : i - 1;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = INSPECTOR_TABS.length - 1;
    else return;
    e.preventDefault();
    n = (n + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
    setTab(INSPECTOR_TABS[n]!);
    document.getElementById(`inspector-tab-${INSPECTOR_TABS[n]}`)?.focus();
  };
  const show = (id: InspectorTab) => tab === 'all' || tab === id;
  const clipFocus: 'all' | 'motion' | 'color' = state.workspace === 'motion' ? 'motion' : state.workspace === 'color' ? 'color' : 'all';
  const open = state.proposals.length + state.approvals.length;
  const panelProps = (id: Exclude<InspectorTab, 'all'>) => ({
    role: 'tabpanel' as const,
    id: `inspector-panel-${id}`,
    'aria-labelledby': `inspector-tab-${id}`,
    hidden: !show(id),
    className: 'inspector-panel',
    'data-testid': `inspector-panel-${id}`,
  });
  return (
    <aside className="inspector" aria-label={t('inspector')}>
      <h2>{t('inspector')}</h2>
      {state.workspace === 'custom' && (
        <fieldset className="custom-panels" data-testid="custom-panels">
          <legend>{t('workspace.custom.choose')}</legend>
          {INSPECTOR_TABS.filter((x) => x !== 'all').map((id) => (
            <label key={id} className="check">
              <input type="checkbox" checked={custom.includes(id)} disabled={custom.length === 1 && custom.includes(id)} data-testid={`custom-panel-${id}`} onChange={() => toggleCustom(id)} />
              {t(`inspector.tab.${id}` as Key)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="inspector-tabs" role="tablist" aria-label={t('inspector')} onKeyDown={onTabKey}>
        {tabs.map((id) => (
          <button key={id} type="button" role="tab" id={`inspector-tab-${id}`} data-testid={`inspector-tab-${id}`}
            aria-selected={tab === id} aria-controls={id === 'all' ? INSPECTOR_TABS.filter((x) => x !== 'all').map((x) => `inspector-panel-${x}`).join(' ') : `inspector-panel-${id}`}
            tabIndex={tab === id ? 0 : -1} className={`inspector-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {t(`inspector.tab.${id}` as Key)}
            {id === 'review' && open > 0 && (
              <span className="tab-badge" role="img" aria-label={`${open} ${t('inspector.tab.review.badge')}`} data-testid="inspector-review-badge">{open}</span>
            )}
          </button>
        ))}
      </div>
      <div {...panelProps('clip')}>
        {/* Motion shows position, size, keyframes, speed and entrances; Color shows effects, blend, mask and transition; the others show all of it. */}
        {clipFocus === 'color' && <Scopes />}
        {clipFocus !== 'all' && <p className="muted" data-testid="clip-focus-note">{t(clipFocus === 'motion' ? 'workspace.motion.note' : 'workspace.color.note')}</p>}
        {!sel ? <p className="muted">{t('inspector.none')}</p> : clipFocus !== 'color' && <ClipInspector key={sel.clip.id} clip={sel.clip} keymap={keymap} />}
        {clipFocus !== 'color' && sel && state.selection.length === 1 && (sel.clip.type === 'text' || sel.track.kind === 'video') && <AnimateControls key={`anim:${sel.clip.id}`} clipId={sel.clip.id} />}
        {clipFocus !== 'motion' && sel && state.selection.length === 1 && (sel.clip.type === 'text' || sel.track.kind === 'video') && <LookPanel key={`look:${sel.clip.id}`} clip={sel.clip} trackKind={sel.track.kind} />}
        {clipFocus === 'color' && sel && !(state.selection.length === 1 && (sel.clip.type === 'text' || sel.track.kind === 'video')) && <p className="muted" data-testid="color-none">{t('workspace.color.none')}</p>}
        {clipFocus === 'all' && sel && state.selection.length === 1 && sel.clip.type === 'media' && <AnalysisPanel key={`analysis:${sel.clip.id}`} />}
      </div>
      <div {...panelProps('speech')}>
        <h2>{t('transcript')}</h2>
        <TranscribeAll />
        <TranscriptPanel />
        <FillerSection />
        <h2>{t('silence')}</h2>
        <SilencePanel />
      </div>
      <div {...panelProps('captions')}>
        <h2>{t('captions')}</h2>
        <CaptionControls editor={editor} />
      </div>
      <div {...panelProps('sound')}>
        <h2>{t('inspector.tab.sound')}</h2>
        <SoundPanel />
      </div>
      <div {...panelProps('deliver')}>
        <h2>{t('inspector.tab.deliver')}</h2>
        <DeliverPanel />
      </div>
      <div {...panelProps('recipes')}>
        <h2>{t('inspector.tab.recipes')}</h2>
        <RecipesPanel />
      </div>
      <div {...panelProps('review')}>
      <h2>{t('proposals')}</h2>
      {state.proposals.length === 0 ? <p className="muted">{t('proposals.none')}</p> : (
        <ul className="proposals" data-testid="proposals">
          {state.proposals.map((p) => (
            <li key={p.id} data-proposal-id={p.id}>
              <span className="muted">{t('proposal.from')} <bdi>{p.actor}</bdi></span>
              <strong dir="auto">{p.label ?? p.summary}</strong>
              {/* Before/after stills rendered by the export compositor at the middle of the first clip the proposal changes. */}
              <span className="ba">
                {(['before', 'after'] as const).map((side) => (
                  <figure key={side}><img alt={t(`proposal.${side}` as Key)} loading="lazy" src={`/api/v1/projects/${state.doc?.id}/proposals/${p.id}/frame?side=${side}&scale=0.25&index=${p.previewFrame}`} /><figcaption>{t(`proposal.${side}` as Key)}</figcaption></figure>
                ))}
              </span>
              <span className="row">
                <button className="primary" onClick={() => void editor.decideProposal(p.id, 'accept')} data-testid="proposal-accept">{t('proposal.accept')}</button>
                <button className="ghost" onClick={() => void editor.decideProposal(p.id, 'reject')} data-testid="proposal-reject">{t('proposal.reject')}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {state.approvals.length > 0 && (
        <>
          <h2>{t('approvals')}</h2>
          <ul className="proposals" data-testid="approvals">
            {state.approvals.map((a) => (
              <li key={a.id} data-approval-id={a.id}>
                <span className="muted">{t('proposal.from')} <bdi>{a.requestedBy}</bdi></span>
                {a.kind === 'model-download' ? (
                  <>
                    <strong>{t('approval.modelDownload')}: <bdi dir="ltr">{a.action.capabilityId}</bdi></strong>
                    <span data-testid="approval-size">{t('approval.size')}: <bdi dir="ltr">{formatBytes(a.action.bytes ?? 0)}</bdi> · {(a.action.models ?? []).length} {t('storage.files')}</span>
                    <span className="muted" dir="ltr">{(a.action.models ?? []).map((m) => m.path).join(', ')}</span>
                  </>
                ) : <strong><bdi dir="ltr">{a.kind}</bdi></strong>}
                <span className="muted">{t('approval.expires')}: <bdi dir="ltr">{new Date(a.expiresAt).toLocaleTimeString()}</bdi></span>
                <span className="row">
                  <button className="primary" onClick={() => void editor.decideApproval(a.id, 'approve')} data-testid="approval-approve">{t('approval.approve')}</button>
                  <button className="ghost" onClick={() => void editor.decideApproval(a.id, 'reject')} data-testid="approval-reject">{t('proposal.reject')}</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>{t('activity')}</h2>
      <button type="button" className="ghost" data-testid="activity-open" onClick={() => setActivityOpen(true)}>{t('activity.all')}</button>
      {activityOpen && <ActivityDialog onClose={() => { setActivityOpen(false); setTimeout(() => document.querySelector<HTMLElement>('[data-testid=activity-open]')?.focus(), 0); }} />}
      <label className="check"><input type="checkbox" checked={state.followAgent} onChange={(e) => editor.set({ followAgent: e.target.checked })} data-testid="follow-agent" /> {t('follow.agent')}</label>
      <ol className="activity" data-testid="activity" aria-live="polite">
        {state.activity.length === 0 && <li className="muted">{t('activity.empty')}</li>}
        {state.activity.map((e) => (
          <li key={e.revision} data-actor={e.actor}>
            <span className={`actor ${e.actor.startsWith('agent') ? 'agent' : ''}`}>{e.actor.startsWith('agent') ? t('actor.agent') : t('actor.user')}</span>
            {/* Described in the interface language from the operation names; the server's detailed English summary stays available as a tooltip. */}
            <span dir="auto" title={e.summary}>{e.kind === 'undo' ? `${t('undo')}: ` : e.kind === 'redo' ? `${t('redo')}: ` : ''}{e.ops?.length ? e.ops.map((o) => dictionaries[state.lang][`op.${o}` as Key] ?? o).join(' · ') : e.summary}</span>
            <span className="muted"><bdi>#{e.revision}</bdi></span>
          </li>
        ))}
      </ol>
      <AccessPanel />
      </div>
    </aside>
  );
}

const ANIMS = ['none', 'fade', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right'] as const;

function AnimateControls({ clipId }: { clipId: string }) {
  const { editor, t } = useEditorState();
  const [inA, setInA] = useState<string>('none');
  const [outA, setOutA] = useState<string>('none');
  const [frames, setFrames] = useState('12');
  const n = Math.round(Number(frames));
  const ok = (inA !== 'none' || outA !== 'none') && Number.isFinite(n) && n >= 1;
  const opts = ANIMS.map((a) => <option key={a} value={a}>{t(`animate.${a}` as Key)}</option>);
  return (
    <div className="fields" data-testid="animate-controls">
      <h3>{t('animate')}</h3>
      <label>{t('animate.in')}
        <select value={inA} onChange={(e) => setInA(e.target.value)} data-testid="animate-in">{opts}</select>
      </label>
      <label>{t('animate.out')}
        <select value={outA} onChange={(e) => setOutA(e.target.value)} data-testid="animate-out">{opts}</select>
      </label>
      <label>{t('animate.frames')}
        <input type="number" min={1} step={1} value={frames} onChange={(e) => setFrames(e.target.value)} data-testid="animate-frames" />
      </label>
      <p className="muted">{t('animate.note')}</p>
      <button className="primary" disabled={!ok} data-testid="animate-apply"
        onClick={() => void editor.commit([{ op: 'animate_clip', args: { clipId, ...(inA !== 'none' ? { in: inA } : {}), ...(outA !== 'none' ? { out: outA } : {}), inFrames: n, outFrames: n } }], 'Animate clip')}>{t('animate.apply')}</button>
    </div>
  );
}

function ClipInspector({ clip, keymap }: { clip: Clip; keymap: Keymap }) {
  const { editor, t } = useEditorState();
  const variantId = editor.getState().viewVariantId;
  const viewClip = variantId ? editor.viewDoc?.sequences[editor.viewDoc.mainSequenceId]?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id) ?? clip : clip;
  // While a format is viewed, the wording and size fields show and edit that format's own values (stored as a format-only override).
  const shownText = viewClip.type === 'text' || viewClip.type === 'caption' ? viewClip.text : '';
  const [text, setText] = useState(shownText);
  useEffect(() => { setText(shownText); }, [shownText, clip.id, variantId]);
  const textOverride = variantId ? editor.doc?.variants?.[variantId]?.overrides[clip.id] : undefined;
  const hasTextOverride = !!(textOverride && (textOverride.text !== undefined || textOverride.textStyle));
  const hasOverride = !!(variantId && editor.doc?.variants?.[variantId]?.overrides[clip.id]?.transform);
  const now = editor.transformNow(variantId ? viewClip : clip);
  const inside = editor.playheadInsideSelection;
  const on = editor.playheadOnSelection;
  const sizeCommit = (v: number) => void editor.commit(variantId
    ? [{ op: 'set_variant_override', args: { variantId, clipId: clip.id, textStyle: { sizeFrac: v } } }]
    : [{ op: 'update_text', args: { clipId: clip.id, style: { sizeFrac: v } } }], 'Text size');
  const textCommit = () => {
    if (!text || text === shownText) return;
    void editor.commit(variantId ? [{ op: 'set_variant_override', args: { variantId, clipId: clip.id, text } }] : [{ op: clip.type === 'caption' ? 'update_cue' : 'update_text', args: { clipId: clip.id, text } }], 'Edit text');
  };
  return (
    <div className="fields">
      {clip.type === 'text' && (
        <>
          <label>{t('text.content')}
            <textarea dir="auto" rows={3} value={text} data-testid="text-content" onChange={(e) => setText(e.target.value)}
              onBlur={textCommit} />
          </label>
          {variantId && (
            <p className="muted" data-testid="text-format-note">{t(hasTextOverride ? 'text.formatOnly.set' : 'text.formatOnly.hint')}
              {hasTextOverride && <> <button type="button" className="ghost" data-testid="text-format-reset" onClick={() => void editor.commit([{ op: 'set_variant_override', args: { variantId, clipId: clip.id, text: null, textStyle: null } }], 'Reset format text')}>{t('text.formatOnly.reset')}</button></>}
            </p>
          )}
          <label>{t('font.family')}
            <select value={clip.style.fontFamily} data-testid="text-font" onChange={(e) => void editor.commit([{ op: 'update_text', args: { clipId: clip.id, style: { fontFamily: e.target.value } } }], 'Font')}>
              {FONT_CATALOG.map((f) => <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>{f.family}</option>)}
            </select>
          </label>
          <label>{t('text.size')}
            <input type="range" min={0.02} max={0.2} step={0.005} key={`${variantId ?? 'master'}:${viewClip.type === 'text' ? viewClip.style.sizeFrac : 0}`} defaultValue={viewClip.type === 'text' ? viewClip.style.sizeFrac : 0.05} data-testid="text-size" onPointerUp={(e) => sizeCommit(Number(e.currentTarget.value))} onKeyUp={(e) => sizeCommit(Number(e.currentTarget.value))} />
          </label>
        </>
      )}
      {clip.type === 'caption' && (
        <>
          <label>{t('cue.text')}
            <textarea dir="auto" rows={2} value={text} data-testid="cue-text" onChange={(e) => setText(e.target.value)} onBlur={textCommit} />
          </label>
          {!variantId && (() => {
            const cues = editor.selected?.track.clips ?? [];
            const hasNext = cues[cues.findIndex((c) => c.id === clip.id) + 1]?.type === 'caption';
            return <div className="row"><button type="button" className="ghost" disabled={!hasNext} data-testid="cue-merge" onClick={() => void editor.commit([{ op: 'merge_cues', args: { clipId: clip.id } }], 'Merge captions')}>{t('cue.merge')}</button></div>;
          })()}
          {variantId && (
            <label className="check">
              <input type="checkbox" checked={!!textOverride?.hidden} data-testid="cue-format-hide" onChange={(e) => void editor.commit([{ op: 'set_variant_override', args: { variantId, clipId: clip.id, hidden: e.target.checked } }], 'Hide caption in format')} /> {t('cue.formatOnly.hide')}
            </label>
          )}
          {variantId && (
            <p className="muted" data-testid="cue-format-note">{t(textOverride?.text !== undefined ? 'cue.formatOnly.set' : 'cue.formatOnly.hint')}
              {textOverride?.text !== undefined && <> <button type="button" className="ghost" data-testid="cue-format-reset" onClick={() => void editor.commit([{ op: 'set_variant_override', args: { variantId, clipId: clip.id, text: null } }], 'Reset format caption')}>{t('text.formatOnly.reset')}</button></>}
            </p>
          )}
        </>
      )}
      {clip.type === 'media' && !variantId && editor.doc?.assets[clip.assetId]?.kind !== 'image' && !clip.freeze && <SpeedField clip={clip} />}
      {clip.type === 'media' && !variantId && editor.doc?.assets[clip.assetId]?.kind !== 'image' && !clip.freeze && <RampField clip={clip} />}
      {clip.type === 'media' && !variantId && !clip.freeze && editor.selected?.track.kind === 'video' && !!editor.doc?.assets[clip.assetId]?.video && <FreezeField clip={clip} />}
      {clip.type === 'media' && !variantId && !clip.freeze && (editor.selected?.track.kind === 'video' ? !!editor.doc?.assets[clip.assetId]?.video : editor.selected?.track.kind === 'audio' && !!editor.doc?.assets[clip.assetId]?.audio) && (
        <>
          <label className="check">
            <input type="checkbox" checked={!!clip.reverse} data-testid="reverse-toggle" onChange={(e) => void editor.commit([{ op: 'set_clip_reverse', args: { clipId: clip.id, reverse: e.target.checked } }], 'Reverse clip')} /> {t('reverse.label')}
          </label>
          <p className="muted" data-testid="reverse-note">{t(clip.linkGroupId ? 'reverse.note.linked' : 'reverse.note')}</p>
        </>
      )}
      {clip.type === 'media' && clip.linkGroupId && !variantId && (
        <div className="row"><button type="button" className="ghost" data-testid="unlink-clip" title={t('unlink.hint')} onClick={() => void editor.commit([{ op: 'unlink_clip', args: { clipId: clip.id } }], 'Detach clip')}>{t('unlink.label')}</button></div>
      )}
      {clip.type === 'media' && clip.freeze && <p className="muted" data-testid="freeze-note">{t('freeze.note')}</p>}
      {/* Values shown are the ones rendered at the playhead. Editing an animated property writes a keyframe there. */}
      {variantId ? (
        <div className="transform-scope" data-testid="transform-scope" data-scope="format">
          <span className="muted">{t('transform.scopeFormat')}</span>
          <button className="ghost" disabled={!hasOverride} data-testid="transform-reset-format"
            onClick={() => void editor.commit([{ op: 'set_variant_override', args: { variantId, clipId: clip.id, transform: null } }], 'Reset format transform')}>{t('transform.resetFormat')}</button>
        </div>
      ) : <span hidden data-testid="transform-scope" data-scope="master" />}
      {TRANSFORM_FIELDS.map((fld) => {
        const animated = !!viewClip.keyframes?.[fld.prop]?.length;
        const commit = (v: number) => on && v !== now[fld.prop] && void editor.setTransformForView(clip, { [fld.prop]: v });
        return (
          <label key={`${fld.prop}:${now[fld.prop]}`}>
            <span>{t(fld.label)} {animated && <em className="animated" title={t('keyframes.animated')}>◆</em>} <bdi className="val">{+now[fld.prop].toFixed(3)}</bdi></span>
            <input type="range" min={fld.min} max={fld.max} step={fld.step} defaultValue={now[fld.prop]} disabled={!on} data-testid={`transform-${fld.prop}`}
              onPointerUp={(e) => commit(Number(e.currentTarget.value))} onKeyUp={(e) => commit(Number(e.currentTarget.value))} />
          </label>
        );
      })}
      <div className="row">
        <button className="ghost" disabled={!on || !!variantId} title={variantId ? t('transform.keyframesMasterOnly') : undefined} onClick={() => run(editor, 'keyframe.add')} data-testid="keyframe-add">◆ {t('cmd.keyframeAdd')} {hint(keymap, 'keyframe.add')}</button>
        <button className="ghost" disabled={!on || !clip.keyframes || !!variantId} title={variantId ? t('transform.keyframesMasterOnly') : undefined} onClick={() => run(editor, 'keyframe.remove')}>{t('cmd.keyframeRemove')} {hint(keymap, 'keyframe.remove')}</button>
        <button className="ghost" disabled={!clip.keyframes || !!variantId} title={variantId ? t('transform.keyframesMasterOnly') : undefined} data-testid="keyframes-clear"
          onClick={() => void editor.commit([{ op: 'clear_keyframes', args: { clipId: clip.id, at: T.sub(T.max(clip.start, T.min(editor.playhead, T.sub(clipEnd(clip), T.frameTime(1, editor.rate)))), clip.start) } }], 'Clear keyframes')}>{t('keyframes.clear')}</button>
      </div>
      <dl>
        <dt>{t('clip.start')}</dt><dd><bdi>{T.toSeconds(clip.start).toFixed(3)}s</bdi></dd>
        <dt>{t('clip.duration')}</dt><dd><bdi>{T.toSeconds(clip.duration).toFixed(3)}s</bdi></dd>
      </dl>
      <div className="row">
        <button className="ghost" disabled={!inside} onClick={() => run(editor, 'edit.split')} data-testid="split">{t('split')} {hint(keymap, 'edit.split')}</button>
        <button className="ghost" disabled={!inside} onClick={() => run(editor, 'edit.trimStart')}>{t('trim.start')} {hint(keymap, 'edit.trimStart')}</button>
        <button className="ghost" disabled={!inside} onClick={() => run(editor, 'edit.trimEnd')}>{t('trim.end')} {hint(keymap, 'edit.trimEnd')}</button>
        <button className="ghost danger" onClick={() => run(editor, 'edit.delete')} data-testid="delete">{t('delete')} {hint(keymap, 'edit.delete')}</button>
      </div>
    </div>
  );
}
