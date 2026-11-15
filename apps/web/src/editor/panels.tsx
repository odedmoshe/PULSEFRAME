import { useEffect, useState } from 'react';
import * as T from '@pulseframe/time';
import { BRAND, LOGO_SVG } from '@pulseframe/brand';
import type { Clip } from '@pulseframe/core';
import { FONT_CATALOG } from '@pulseframe/core';
import { dictionaries, type Key } from '@pulseframe/i18n';
import { chordLabel, COMMANDS, type Keymap } from './commands.ts';
import { useEditorState, type Editor } from './store.ts';
import { DeliverPanel } from './DeliverPanel.tsx';
import { AnalysisPanel } from './AnalysisPanel.tsx';
import { LookPanel } from './LookPanel.tsx';
import { SoundPanel } from './SoundPanel.tsx';
import { CaptionControls, SilencePanel, TranscriptPanel } from './TranscriptPanel.tsx';

const run = (editor: Editor, id: string) => { const c = COMMANDS.find((x) => x.id === id)!; if (!c.enabled || c.enabled(editor)) void c.run(editor); };
const hint = (keymap: Keymap, id: string) => { const k = keymap.keysFor(id)[0]; return k ? <kbd>{chordLabel(k)}</kbd> : null; };

export function Header() {
  const { editor, state, t } = useEditorState();
  const { doc, save, revision, exportJob: job, lang } = state;
  const viewVariant = state.viewVariantId ? doc?.variants?.[state.viewVariantId] ?? null : null;
  const exporting = job && ['queued', 'running', 'cancel-requested'].includes(job.status);
  return (
    <header className="header">
      <span className="logo" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
      <strong className="brand">{BRAND.name}</strong>
      <span className="title" data-testid="project-name">{doc?.name ?? t('app.loading')}</span>
      {doc && (
        <label className="format-switch">
          <span className="sr-only">{t('format.switch')}</span>
          <select value={state.viewVariantId ?? ''} onChange={(e) => editor.setViewVariant(e.target.value || null)} data-testid="format-switch" aria-label={t('format.switch')}>
            <option value="">{t('deliver.master')} ({doc.settings.width}×{doc.settings.height})</option>
            {Object.values(doc.variants ?? {}).map((v) => <option key={v.id} value={v.id}>{v.name} ({v.width}×{v.height})</option>)}
          </select>
        </label>
      )}
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
      <button className="ghost" onClick={() => editor.set({ paletteOpen: true })} data-testid="open-palette" aria-haspopup="dialog">{t('cmd.palette')} <kbd>{chordLabel('Mod+KeyK')}</kbd></button>
      <button className="ghost" onClick={() => editor.setLang(lang === 'he' ? 'en' : 'he')} aria-label={t('lang.label')} data-testid="lang-toggle">{t('lang.toggle')}</button>
      {job?.status === 'succeeded' && <a className="ghost" href={`/api/v1/jobs/${job.id}/output`} data-testid="export-download">{t('export.done')}</a>}
      {exporting && <button className="ghost danger" onClick={() => editor.cancelExport()} data-testid="export-cancel">{t('export.cancel')}</button>}
      {job?.status === 'canceled' && <span className="save warn" role="status" data-testid="export-canceled">{t('export.canceled')}</span>}
      {(job?.status === 'canceled' || job?.status === 'failed') && <button className="ghost" onClick={() => editor.retryExport()} data-testid="export-retry">{t('export.retry')}</button>}
      <button className="primary" disabled={!doc || !!exporting || editor.player?.frameCount === 0} onClick={() => editor.startExport()} data-testid="export">
        {exporting ? `${t('export.running')} ${job?.stage ?? ''}` : t('export')}
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
      {error ?? `${t('export.failed')}: ${job?.error?.message ?? ''}`}
      <button className="ghost" onClick={() => editor.set({ error: null, ...(job?.status === 'failed' ? { exportJob: null } : {}) })} aria-label={t('close')}>×</button>
    </div>
  );
}

export function Library() {
  const { editor, state, t } = useEditorState();
  const { doc, uploading } = state;
  return (
    <aside className="library" aria-label={t('media')}>
      <h2>{t('media')}</h2>
      <label className="primary file">
        {uploading ? t('media.uploading') : t('media.import')}
        <input type="file" accept="video/*,audio/*,image/png,image/jpeg,image/webp" disabled={uploading || !doc} data-testid="file-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void editor.importFile(f); }} />
      </label>
      {doc && Object.keys(doc.assets).length === 0 && <p className="muted">{t('media.empty')}</p>}
      <ul className="assets">
        {doc && Object.values(doc.assets).map((a) => (
          <li key={a.id}>
            <span className="asset-name" dir="auto" title={a.name}>{a.name}</span>
            <span className="muted"><bdi>{a.kind === 'image' ? `${a.image?.width}×${a.image?.height}` : `${T.toSeconds(a.duration).toFixed(2)}s${a.video ? ` · ${a.video.width}×${a.video.height}` : ''}`}</bdi></span>
            <button className="ghost" onClick={() => void editor.addAsset(a.id)} data-testid={`add-${a.id}`}>{t('media.add')}</button>
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
      <span className="timecode" data-testid="timecode">{T.toTimecode(editor.playhead, rate)}</span>
      <span className="muted">/ {T.toTimecode(editor.duration, rate)} · {editor.viewDoc?.settings.width}×{editor.viewDoc?.settings.height} · {(rate.num / rate.den).toFixed(rate.den === 1 ? 0 : 2)} fps</span>
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

const INSPECTOR_TABS = ['clip', 'speech', 'captions', 'sound', 'review', 'deliver', 'all'] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number];
const TAB_KEY = 'pf.inspector.tab.v1';

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
  const setTab = (next: InspectorTab) => {
    setTabState(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* ignore */ }
  };
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
  const open = state.proposals.length;
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
      <div className="inspector-tabs" role="tablist" aria-label={t('inspector')} onKeyDown={onTabKey}>
        {INSPECTOR_TABS.map((id) => (
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
        {!sel ? <p className="muted">{t('inspector.none')}</p> : <ClipInspector key={sel.clip.id} clip={sel.clip} keymap={keymap} />}
        {sel && state.selection.length === 1 && (sel.clip.type === 'text' || sel.track.kind === 'video') && <AnimateControls key={`anim:${sel.clip.id}`} clipId={sel.clip.id} />}
        {sel && state.selection.length === 1 && (sel.clip.type === 'text' || sel.track.kind === 'video') && <LookPanel key={`look:${sel.clip.id}`} clip={sel.clip} trackKind={sel.track.kind} />}
        {sel && state.selection.length === 1 && sel.clip.type === 'media' && <AnalysisPanel key={`analysis:${sel.clip.id}`} />}
      </div>
      <div {...panelProps('speech')}>
        <h2>{t('transcript')}</h2>
        <TranscriptPanel />
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
      <h2>{t('activity')}</h2>
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
  const [text, setText] = useState(clip.type === 'text' ? clip.text : '');
  useEffect(() => { if (clip.type === 'text') setText(clip.text); }, [clip]);
  const now = editor.transformNow(clip);
  const inside = editor.playheadInsideSelection;
  const on = editor.playheadOnSelection;
  const sizeCommit = (v: number) => void editor.commit([{ op: 'update_text', args: { clipId: clip.id, style: { sizeFrac: v } } }], 'Text size');
  return (
    <div className="fields">
      {clip.type === 'text' && (
        <>
          <label>{t('text.content')}
            <textarea dir="auto" rows={3} value={text} data-testid="text-content" onChange={(e) => setText(e.target.value)}
              onBlur={() => text && text !== clip.text && void editor.commit([{ op: 'update_text', args: { clipId: clip.id, text } }], 'Edit text')} />
          </label>
          <label>{t('font.family')}
            <select value={clip.style.fontFamily} data-testid="text-font" onChange={(e) => void editor.commit([{ op: 'update_text', args: { clipId: clip.id, style: { fontFamily: e.target.value } } }], 'Font')}>
              {FONT_CATALOG.map((f) => <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>{f.family}</option>)}
            </select>
          </label>
          <label>{t('text.size')}
            <input type="range" min={0.02} max={0.2} step={0.005} defaultValue={clip.style.sizeFrac} onPointerUp={(e) => sizeCommit(Number(e.currentTarget.value))} onKeyUp={(e) => sizeCommit(Number(e.currentTarget.value))} />
          </label>
        </>
      )}
      {/* Values shown are the ones rendered at the playhead. Editing an animated property writes a keyframe there. */}
      {TRANSFORM_FIELDS.map((fld) => {
        const animated = !!clip.keyframes?.[fld.prop]?.length;
        const commit = (v: number) => on && v !== now[fld.prop] && void editor.setTransformAtPlayhead(clip, { [fld.prop]: v });
        return (
          <label key={`${fld.prop}:${now[fld.prop]}`}>
            <span>{t(fld.label)} {animated && <em className="animated" title={t('keyframes.animated')}>◆</em>} <bdi className="val">{+now[fld.prop].toFixed(3)}</bdi></span>
            <input type="range" min={fld.min} max={fld.max} step={fld.step} defaultValue={now[fld.prop]} disabled={!on} data-testid={`transform-${fld.prop}`}
              onPointerUp={(e) => commit(Number(e.currentTarget.value))} onKeyUp={(e) => commit(Number(e.currentTarget.value))} />
          </label>
        );
      })}
      <div className="row">
        <button className="ghost" disabled={!on} onClick={() => run(editor, 'keyframe.add')} data-testid="keyframe-add">◆ {t('cmd.keyframeAdd')} {hint(keymap, 'keyframe.add')}</button>
        <button className="ghost" disabled={!on || !clip.keyframes} onClick={() => run(editor, 'keyframe.remove')}>{t('cmd.keyframeRemove')} {hint(keymap, 'keyframe.remove')}</button>
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
