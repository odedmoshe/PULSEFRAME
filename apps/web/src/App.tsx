import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { BRAND, LOGO_SVG } from '@pulseframe/brand';
import { clipEnd, findClip, sequenceDuration, type Clip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { createT, dirOf, type Key, type Lang } from '@pulseframe/i18n';
import { api, ApiFailure, type JobEvent, type RevisionEvent } from './api.ts';
import { ensureFonts } from './fonts.ts';
import { MediaPool } from './media.ts';
import { Player } from './player.ts';

const PX_PER_SECOND = 90;
type SaveState = 'save.saved' | 'save.saving' | 'save.offline' | 'save.conflict';

export function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('pf.lang') === 'en' ? 'en' : 'he'));
  const t = useMemo(() => createT(lang), [lang]);
  const [doc, setDoc] = useState<ProjectDocument | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>('save.saved');
  const [activity, setActivity] = useState<RevisionEvent[]>([]);
  const [job, setJob] = useState<JobEvent | null>(null);
  const [capJob, setCapJob] = useState<JobEvent | null>(null);
  const [provider, setProvider] = useState<Awaited<ReturnType<typeof api.capabilities>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, force] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const poolRef = useRef<MediaPool | null>(null);
  const state = useRef({ doc, revision });
  state.current = { doc, revision };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
    localStorage.setItem('pf.lang', lang);
  }, [lang]);

  const fail = useCallback((e: unknown) => {
    console.error(e);
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  const load = useCallback(async (projectId: string) => {
    const p = await api.getProject(projectId);
    if (p.revision >= state.current.revision || !state.current.doc) {
      setDoc(p.project);
      setRevision(p.revision);
      playerRef.current?.setDoc(p.project);
    }
    return p;
  }, []);

  // Boot: session -> project -> fonts -> player -> live revision stream.
  useEffect(() => {
    let es: EventSource | undefined;
    let closed = false;
    (async () => {
      await api.session();
      await ensureFonts();
      let id = new URLSearchParams(location.search).get('project');
      if (!id) {
        const { projects } = await api.listProjects();
        id = projects[0]?.id ?? (await api.createProject(lang === 'he' ? 'הפרויקט שלי' : 'My project')).project.id;
      }
      const projectId = id;
      poolRef.current = new MediaPool((assetId) => api.assetBlob(projectId, assetId));
      playerRef.current = new Player(canvasRef.current!, poolRef.current, () => force((n) => n + 1), fail);
      const p = await load(projectId);
      setActivity((await api.history(projectId)).events.reverse());
      if (closed) return;
      es = api.events(projectId, p.revision);
      es.addEventListener('revision', (m) => {
        const e: RevisionEvent = JSON.parse((m as MessageEvent).data);
        setActivity((a) => (a.some((x) => x.revision === e.revision) ? a : [e, ...a].slice(0, 50)));
        // Committed remote or local change: converge on the server document. The playhead and selection are local and stay put.
        if (e.revision > state.current.revision) void load(projectId).catch(fail);
      });
      es.addEventListener('job', (m) => { const j: JobEvent = JSON.parse((m as MessageEvent).data); (j.type === 'capability' ? setCapJob : setJob)(j); });
      // Listing capabilities only reads provider status; it never starts a worker.
      void api.capabilities().then(setProvider).catch(() => setProvider(null));
      es.onerror = () => setSave('save.offline');
      es.onopen = () => setSave('save.saved');
    })().catch(fail);
    return () => {
      closed = true;
      es?.close();
      playerRef.current?.dispose();
      void poolRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = useCallback(async (ops: OpCall[], label?: string) => {
    const { doc, revision } = state.current;
    if (!doc) return null;
    setSave('save.saving');
    setError(null);
    try {
      const r = await api.commit(doc.id, revision, ops, label);
      await load(doc.id);
      setSave('save.saved');
      return r;
    } catch (e) {
      if (e instanceof ApiFailure && (e.code === 'stale_revision' || e.code === 'conflict')) {
        await load(doc.id);
        setSave('save.conflict');
      } else {
        setSave('save.saved');
        fail(e);
      }
      return null;
    }
  }, [fail, load]);

  const history = useCallback(async (mode: 'undo' | 'redo') => {
    const { doc } = state.current;
    if (!doc) return;
    setError(null);
    try {
      await api.undo(doc.id, mode);
      await load(doc.id);
    } catch (e) {
      if (e instanceof ApiFailure && (e.code === 'nothing_to_undo' || e.code === 'nothing_to_redo')) return;
      fail(e instanceof ApiFailure && e.code === 'undo_conflict' ? new Error(t('undo.conflict')) : e);
    }
  }, [fail, load, t]);

  const player = playerRef.current;
  const rate = doc?.settings.frameRate ?? { num: 30, den: 1 };
  const frame = player?.frame ?? 0;
  const playhead = T.frameTime(frame, rate);
  const sel = doc && selected ? findClip(doc, selected) : undefined;
  useEffect(() => { if (selected && doc && !findClip(doc, selected)) setSelected(null); }, [doc, selected]);

  const importFile = async (file: File) => {
    if (!doc) return;
    setUploading(true);
    setError(null);
    try {
      const r = await api.upload(doc.id, file);
      poolRef.current?.provideLocal(r.assetId, file);
      await load(doc.id);
    } catch (e) {
      fail(e instanceof ApiFailure && e.code === 'unsupported_media' ? new Error(`${t('media.unsupported')}: ${e.message}`) : e);
    } finally {
      setUploading(false);
    }
  };
  const addAsset = (assetId: string) => doc && commit([{ op: 'add_clip', args: { assetId, start: T.snapToFrame(videoEnd(doc), rate) } }], 'Add clip');
  const addText = async () => {
    if (!doc) return;
    const r = await commit([{ op: 'add_text', args: { text: t('text.default'), start: playhead, duration: T.frameTime(Math.round((2 * rate.num) / rate.den), rate) } }], 'Add text');
    const id = r?.results[0]?.output?.clipId;
    if (id) setSelected(id);
  };
  const inside = sel && T.lt(sel.clip.start, playhead) && T.lt(playhead, clipEnd(sel.clip));
  const split = () => sel && inside && commit([{ op: 'split_clip', args: { clipId: sel.clip.id, at: playhead } }], 'Split');
  const remove = () => sel && commit([{ op: 'delete_clip', args: { clipId: sel.clip.id } }], 'Delete');
  const trim = (edge: 'start' | 'end') => sel && inside && commit([{ op: 'trim_clip', args: { clipId: sel.clip.id, edge, to: playhead } }], 'Trim');

  // Keyboard: uses physical key codes so shortcuts survive a Hebrew layout; disabled while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || e.altKey) return;
      if (e.metaKey || e.ctrlKey) {
        if (e.code === 'KeyZ') { e.preventDefault(); void history(e.shiftKey ? 'redo' : 'undo'); }
        else if (e.code === 'KeyY') { e.preventDefault(); void history('redo'); }
        return;
      }
      const p = playerRef.current;
      if (!p) return;
      const step = e.shiftKey ? 10 : 1;
      const map: Record<string, () => void> = {
        Space: () => (p.playing ? p.pause() : void p.play()),
        ArrowLeft: () => p.seek(p.frame - step),
        ArrowRight: () => p.seek(p.frame + step),
        Home: () => p.seek(0),
        End: () => p.seek(p.frameCount - 1),
        KeyS: () => void split(),
        Delete: () => void remove(),
        Backspace: () => void remove(),
        BracketLeft: () => void trim('start'),
        BracketRight: () => void trim('end'),
      };
      const fn = map[e.code];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const duration = doc ? sequenceDuration(doc) : T.ZERO;
  const totalSeconds = Math.max(T.toSeconds(duration) + 2, 8);
  const exporting = job && (job.status === 'queued' || job.status === 'running');

  return (
    <div className="app">
      <header className="header">
        <span className="logo" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
        <strong className="brand">{BRAND.name}</strong>
        <span className="title" data-testid="project-name">{doc?.name ?? t('app.loading')}</span>
        <span className="badge">{t('phase0.badge')}</span>
        <span className="spacer" />
        <span className={`save ${save === 'save.conflict' || save === 'save.offline' ? 'warn' : ''}`} role="status" data-testid="save-state">{t(save)}</span>
        <span className="rev" data-testid="revision">{t('revision')} <bdi>{revision}</bdi></span>
        <button className="ghost" disabled={!doc} onClick={() => void history('undo')} data-testid="undo" title="Ctrl+Z">{t('undo')}</button>
        <button className="ghost" disabled={!doc} onClick={() => void history('redo')} data-testid="redo" title="Ctrl+Shift+Z">{t('redo')}</button>
        <button className="ghost" onClick={() => setLang(lang === 'he' ? 'en' : 'he')} aria-label={t('lang.label')} data-testid="lang-toggle">{t('lang.toggle')}</button>
        {job?.status === 'succeeded' && <a className="ghost" href={`/api/v1/jobs/${job.id}/output`} data-testid="export-download">{t('export.done')}</a>}
        <button className="primary" disabled={!doc || !!exporting || player?.frameCount === 0} onClick={() => doc && api.startExport(doc.id).then((j) => setJob({ id: j.jobId, type: 'export', status: 'queued', stage: null, output: null, error: null })).catch(fail)} data-testid="export">
          {exporting ? `${t('export.running')} ${job?.stage ?? ''}` : t('export')}
        </button>
      </header>
      {(error || job?.status === 'failed') && (
        <div className="error" role="alert">
          {error ?? `${t('export.failed')}: ${job?.error?.message ?? ''}`}
          <button className="ghost" onClick={() => { setError(null); if (job?.status === 'failed') setJob(null); }} aria-label="×">×</button>
        </div>
      )}
      <aside className="library" aria-label={t('media')}>
        <h2>{t('media')}</h2>
        <label className="primary file">
          {uploading ? t('media.uploading') : t('media.import')}
          <input type="file" accept="video/mp4,video/webm,audio/*" disabled={uploading || !doc} data-testid="file-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        </label>
        {doc && Object.keys(doc.assets).length === 0 && <p className="muted">{t('media.empty')}</p>}
        <ul className="assets">
          {doc && Object.values(doc.assets).map((a) => (
            <li key={a.id}>
              <span className="asset-name" dir="auto" title={a.name}>{a.name}</span>
              <span className="muted"><bdi>{T.toSeconds(a.duration).toFixed(2)}s{a.video ? ` · ${a.video.width}×${a.video.height}` : ''}</bdi></span>
              <button className="ghost" onClick={() => void addAsset(a.id)} data-testid={`add-${a.id}`}>{t('media.add')}</button>
            </li>
          ))}
        </ul>
        <h2>{t('text')}</h2>
        <button className="ghost" disabled={!doc} onClick={() => void addText()} data-testid="add-text">{t('text.add')}</button>
        <h2>{t('providers')}</h2>
        <ProviderPanel t={t} lang={lang} provider={provider} job={capJob} onRun={(capId) => doc && api.runCapability(doc.id, capId, {}).then((j) => setCapJob({ id: j.jobId, type: 'capability', status: 'queued', stage: null, output: null, error: null })).catch(fail)} />
      </aside>
      <main className="stage">
        <div className="canvas-wrap"><canvas ref={canvasRef} aria-label={t('preview')} data-testid="preview" /></div>
        <div className="transport" dir="ltr">
          <button className="ghost" onClick={() => player?.seek(frame - 1)} aria-label={t('frame.prev')}>◀︎</button>
          <button className="primary" onClick={() => (player?.playing ? player.pause() : void player?.play())} aria-label={player?.playing ? t('pause') : t('play')} data-testid="play">{player?.playing ? '❚❚' : '▶'}</button>
          <button className="ghost" onClick={() => player?.seek(frame + 1)} aria-label={t('frame.next')}>▶︎</button>
          <span className="timecode" data-testid="timecode">{T.toTimecode(playhead, rate)}</span>
          <span className="muted">/ {T.toTimecode(duration, rate)} · {doc?.settings.width}×{doc?.settings.height} · {(rate.num / rate.den).toFixed(rate.den === 1 ? 0 : 2)} fps</span>
        </div>
      </main>
      <aside className="inspector" aria-label={t('inspector')}>
        <h2>{t('inspector')}</h2>
        {!sel ? <p className="muted">{t('inspector.none')}</p> : (
          <Inspector key={sel.clip.id} clip={sel.clip} t={t} onCommit={commit} canCut={!!inside} onSplit={() => void split()} onDelete={() => void remove()} onTrim={(e) => void trim(e)} />
        )}
        <h2>{t('activity')}</h2>
        <ol className="activity" data-testid="activity" aria-live="polite">
          {activity.length === 0 && <li className="muted">{t('activity.empty')}</li>}
          {activity.map((e) => (
            <li key={e.revision} data-actor={e.actor}>
              <span className={`actor ${e.actor.startsWith('agent') ? 'agent' : ''}`}>{e.actor.startsWith('agent') ? t('actor.agent') : t('actor.user')}</span>
              <span dir="auto">{e.summary}</span>
              <span className="muted"><bdi>#{e.revision}</bdi></span>
            </li>
          ))}
        </ol>
      </aside>
      {/* Time always progresses left-to-right, also in the Hebrew interface (SPEC §3). */}
      <section className="timeline" dir="ltr" aria-label={t('timeline')}>
        <div className="tl-scroll">
          <div className="tl-inner" style={{ width: totalSeconds * PX_PER_SECOND + 80 }}>
            <div className="ruler" onPointerDown={(e) => { const x = e.clientX - e.currentTarget.getBoundingClientRect().left; player?.seek(Math.round(((x / PX_PER_SECOND) * rate.num) / rate.den)); }} data-testid="ruler">
              {Array.from({ length: Math.ceil(totalSeconds) + 1 }, (_, s) => <span key={s} style={{ left: s * PX_PER_SECOND }}>{s}s</span>)}
            </div>
            {doc && [...doc.sequences[doc.mainSequenceId]!.tracks].reverse().map((tr) => (
              <div className={`track ${tr.kind}`} key={tr.id} role="list" aria-label={`${t(`track.${tr.kind}` as Key)} ${tr.name}`}>
                <span className="track-name">{tr.name}</span>
                {tr.clips.map((c) => (
                  <button key={c.id} role="listitem" className={`clip ${c.id === selected ? 'selected' : ''}`} data-testid={`clip-${c.id}`} data-clip-type={c.type} data-track-kind={tr.kind}
                    style={{ left: T.toSeconds(c.start) * PX_PER_SECOND, width: Math.max(4, T.toSeconds(c.duration) * PX_PER_SECOND - 1) }}
                    onClick={() => setSelected(c.id)} aria-pressed={c.id === selected}
                    aria-label={`${clipLabel(doc, c)} ${T.toTimecode(c.start, rate)}–${T.toTimecode(clipEnd(c), rate)}`}>
                    <span dir="auto">{clipLabel(doc, c)}</span>
                  </button>
                ))}
              </div>
            ))}
            <div className="playhead" style={{ left: T.toSeconds(playhead) * PX_PER_SECOND }} />
          </div>
        </div>
      </section>
    </div>
  );
}

const clipLabel = (doc: ProjectDocument, c: Clip) => (c.type === 'text' ? c.text : doc.assets[c.assetId]?.name ?? c.assetId);
function videoEnd(doc: ProjectDocument) {
  let end = T.ZERO;
  for (const tr of doc.sequences[doc.mainSequenceId]!.tracks) if (tr.kind !== 'text') for (const c of tr.clips) end = T.max(end, clipEnd(c));
  return end;
}

function ProviderPanel(p: { t: (k: Key) => string; lang: Lang; provider: Awaited<ReturnType<typeof api.capabilities>> | null; job: JobEvent | null; onRun(capabilityId: string): void }) {
  const { t, provider, job } = p;
  if (!provider) return null;
  const pr = provider.provider;
  if (!pr.configured) return <p className="muted" data-testid="provider-status" data-state="not-configured">{t('providers.notConfigured')}</p>;
  if (!pr.readiness?.reachable) return <p className="muted" data-testid="provider-status" data-state="unreachable">{t('providers.unreachable')}</p>;
  const smoke = provider.capabilities.find((c) => c.id === 'comfy.smoke.solid-image');
  const busy = job && ['queued', 'running', 'cancel-requested'].includes(job.status);
  return (
    <div className="fields">
      <p className="muted" data-testid="provider-status" data-state="ready">{t('providers.ready')} · <bdi>{pr.readiness.runtimeVersion} · {pr.readiness.device?.type}</bdi></p>
      {smoke && <button className="ghost" disabled={!smoke.runnable || !!busy} onClick={() => p.onRun(smoke.id)} data-testid="provider-smoke">{busy ? `${t('providers.running')} ${job?.stage ?? ''}` : t('providers.smoke')}</button>}
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

function Inspector(p: { clip: Clip; t: (k: Key) => string; onCommit: (ops: OpCall[], label?: string) => Promise<unknown>; canCut: boolean; onSplit(): void; onDelete(): void; onTrim(e: 'start' | 'end'): void }) {
  const { clip, t } = p;
  const [text, setText] = useState(clip.type === 'text' ? clip.text : '');
  useEffect(() => { if (clip.type === 'text') setText(clip.text); }, [clip]);
  return (
    <div className="fields">
      {clip.type === 'text' && (
        <>
          <label>{t('text.content')}
            <textarea dir="auto" rows={3} value={text} data-testid="text-content" onChange={(e) => setText(e.target.value)}
              onBlur={() => text && text !== clip.text && void p.onCommit([{ op: 'update_text', args: { clipId: clip.id, text } }], 'Edit text')} />
          </label>
          <label>{t('text.size')}
            <input type="range" min={0.02} max={0.2} step={0.005} defaultValue={clip.style.sizeFrac} onPointerUp={(e) => void p.onCommit([{ op: 'update_text', args: { clipId: clip.id, style: { sizeFrac: Number(e.currentTarget.value) } } }], 'Text size')}
              onKeyUp={(e) => void p.onCommit([{ op: 'update_text', args: { clipId: clip.id, style: { sizeFrac: Number(e.currentTarget.value) } } }], 'Text size')} />
          </label>
          <label>{t('text.y')}
            <input type="range" min={-0.45} max={0.45} step={0.01} defaultValue={clip.transform.y} onPointerUp={(e) => void p.onCommit([{ op: 'set_clip_transform', args: { clipId: clip.id, transform: { y: Number(e.currentTarget.value) } } }], 'Move text')}
              onKeyUp={(e) => void p.onCommit([{ op: 'set_clip_transform', args: { clipId: clip.id, transform: { y: Number(e.currentTarget.value) } } }], 'Move text')} />
          </label>
        </>
      )}
      <dl>
        <dt>{t('clip.start')}</dt><dd><bdi>{T.toSeconds(clip.start).toFixed(3)}s</bdi></dd>
        <dt>{t('clip.duration')}</dt><dd><bdi>{T.toSeconds(clip.duration).toFixed(3)}s</bdi></dd>
      </dl>
      <div className="row">
        <button className="ghost" disabled={!p.canCut} onClick={p.onSplit} data-testid="split">{t('split')} <kbd>S</kbd></button>
        <button className="ghost" disabled={!p.canCut} onClick={() => p.onTrim('start')}>{t('trim.start')} <kbd>[</kbd></button>
        <button className="ghost" disabled={!p.canCut} onClick={() => p.onTrim('end')}>{t('trim.end')} <kbd>]</kbd></button>
        <button className="ghost danger" onClick={p.onDelete} data-testid="delete">{t('delete')} <kbd>Del</kbd></button>
      </div>
    </div>
  );
}
