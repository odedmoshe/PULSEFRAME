import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, ApiFailure, type GcResult, type ProjectListItem, type StorageReport } from '../api.ts';
import { useEditorState } from './store.ts';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export const describeError = (e: unknown) => (e instanceof ApiFailure ? `${e.message}${e.hint ? ` — ${e.hint}` : ''} (${e.code})` : e instanceof Error ? e.message : String(e));

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

function StoragePanel() {
  const { t } = useEditorState();
  const [rep, setRep] = useState<StorageReport | null>(null);
  const [dry, setDry] = useState<GcResult | null>(null);
  const [done, setDone] = useState<GcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setRep(await api.storage()); } catch (e) { setErr(describeError(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const check = async () => {
    setBusy(true); setErr(null); setDone(null);
    try { setDry(await api.storageGc(false)); } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setErr(null);
    try { setDone(await api.storageGc(true)); setDry(null); await refresh(); } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };
  return (
    <section className="pf-dlg-section" data-testid="storage" aria-labelledby="pf-storage-h">
      <h3 id="pf-storage-h">{t('storage.title')}</h3>
      {rep && (
        <dl className="sound-result">
          <dt>{t('storage.projects')}</dt><dd><bdi>{rep.projects}</bdi></dd>
          <dt>{t('storage.database')}</dt><dd dir="ltr">{formatBytes(rep.databaseBytes)}</dd>
          <dt>{t('storage.media')}</dt><dd dir="ltr">{rep.media.files} {t('storage.files')} · {formatBytes(rep.media.bytes)}</dd>
          <dt>{t('storage.exports')}</dt><dd dir="ltr">{formatBytes(rep.exportsBytes)}</dd>
          <dt>{t('storage.total')}</dt><dd dir="ltr" data-testid="storage-total">{formatBytes(rep.totalBytes)}{rep.quotaBytes ? ` / ${formatBytes(rep.quotaBytes)}` : ''}</dd>
          <dt>{t('storage.unreferenced')}</dt>
          <dd dir="ltr">{rep.unreferenced.files} {t('storage.files')} · {formatBytes(rep.unreferenced.bytes)}{rep.unreferenced.tooNewToJudge ? ` · ${rep.unreferenced.tooNewToJudge} ${t('storage.tooNew')}` : ''}</dd>
        </dl>
      )}
      {rep?.rule && <p className="muted" dir="auto">{t('storage.rule')}: {rep.rule}</p>}
      <div className="row">
        <button type="button" className="ghost" disabled={busy} onClick={() => void check()} data-testid="storage-gc-check">{t('storage.check')}</button>
        {dry?.wouldRemove && <button type="button" className="ghost danger" disabled={busy || dry.wouldRemove.files === 0} onClick={() => void apply()} data-testid="storage-gc-apply">{t('storage.apply')}</button>}
      </div>
      {dry?.wouldRemove && <p role="status" data-testid="storage-gc-dry"><span>{t('storage.wouldRemove')}: </span><bdi dir="ltr">{dry.wouldRemove.files} {t('storage.files')} · {formatBytes(dry.wouldRemove.bytes)}</bdi></p>}
      {done?.removed && <p role="status" data-testid="storage-gc-done"><span>{t('storage.removed')}: </span><bdi dir="ltr">{done.removed.files} {t('storage.files')} · {formatBytes(done.removed.bytes)}</bdi></p>}
      {err && <p className="muted danger" role="alert" data-testid="storage-error">{err}</p>}
    </section>
  );
}

export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const { state, t } = useEditorState();
  const currentId = state.doc?.id ?? null;
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const load = useCallback(async () => {
    try { setProjects((await api.listProjectsFull()).projects); } catch (e) { setErr(describeError(e)); setProjects([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (id: string) => location.assign(`/?project=${encodeURIComponent(id)}`);
  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setErr(null);
    try { const r = await api.createProject(name); open(r.project.id); } catch (e) { setErr(describeError(e)); setBusy(false); }
  };
  const remove = async (p: ProjectListItem) => {
    setBusy(true); setErr(null);
    try {
      await api.deleteProject(p.id, typed);
      if (p.id === currentId) { location.assign('/'); return; }
      setDeleting(null); setTyped('');
      await load();
    } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };

  // Escape must close the dialog wherever focus is: when a focused control is removed (for example a deleted project row)
  // the browser moves focus to the page body, outside the dialog. Focus is also pulled back in so Tab keeps working.
  useEffect(() => {
    const onDocKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    const onFocusLost = () => { if (!dialogRef.current?.contains(document.activeElement)) closeRef.current?.focus(); };
    document.addEventListener('keydown', onDocKey, true);
    const timer = setInterval(onFocusLost, 200);
    return () => { document.removeEventListener('keydown', onDocKey, true); clearInterval(timer); };
  }, [onClose]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab') {
      const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!nodes.length) return;
      const first = nodes[0]!, last = nodes[nodes.length - 1]!, at = document.activeElement;
      if (e.shiftKey && (at === first || !dialogRef.current?.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !dialogRef.current?.contains(at))) { e.preventDefault(); first.focus(); }
    }
  };

  return (
    <div className="pf-dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="pf-dlg" role="dialog" aria-modal="true" aria-label={t('projects.title')} data-testid="projects-dialog" onKeyDown={onKey}>
        <div className="pf-dlg-head">
          <h2>{t('projects.title')}</h2>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose} aria-label={t('projects.close')} data-testid="projects-close">×</button>
        </div>
        {err && <p className="muted danger" role="alert" data-testid="projects-error">{err}</p>}
        {projects === null && <p className="muted">{t('projects.loading')}</p>}
        {projects?.length === 0 && <p className="muted">{t('projects.empty')}</p>}
        <ul className="pf-dlg-list">
          {projects?.map((p) => (
            <li key={p.id} data-testid="project-row" data-project-id={p.id} data-current={p.id === currentId ? 'true' : 'false'}>
              <div className="row">
                <strong dir="auto">{p.name}</strong>
                {p.id === currentId && <span className="format-badge" data-testid="project-current">{t('projects.current')}</span>}
                <span className="muted">{t('projects.revision')} <bdi>{p.revision}</bdi></span>
                <span className="spacer" />
                <button type="button" className="ghost" onClick={() => open(p.id)} data-testid="project-open">{t('projects.openBtn')}</button>
                <button type="button" className="ghost danger" aria-expanded={deleting === p.id} onClick={() => { setDeleting(deleting === p.id ? null : p.id); setTyped(''); setErr(null); }} data-testid="project-delete">{t('projects.delete')}</button>
              </div>
              {deleting === p.id && (
                <div className="fields pf-dlg-confirm" role="group" aria-label={t('projects.delete')}>
                  <p className="danger" role="alert">{t('projects.delete.warn')}</p>
                  <a className="ghost" href={`/api/v1/projects/${encodeURIComponent(p.id)}/archive`} data-testid="project-archive">{t('projects.delete.archive')}</a>
                  <label>{t('projects.delete.type')} (<bdi dir="auto">{p.name}</bdi>)
                    <input dir="auto" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="project-delete-confirm" />
                  </label>
                  <div className="row">
                    <button type="button" className="primary danger" disabled={busy || typed !== p.name} onClick={() => void remove(p)} data-testid="project-delete-apply">{t('projects.delete.apply')}</button>
                    <button type="button" className="ghost" onClick={() => { setDeleting(null); setTyped(''); }}>{t('projects.delete.cancel')}</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        <form className="pf-dlg-section row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <label>{t('projects.new.name')}
            <input dir="auto" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="project-new-name" />
          </label>
          <button type="submit" className="primary" disabled={busy || !newName.trim()} data-testid="project-new">{t('projects.new.create')}</button>
        </form>
        <StoragePanel />
      </div>
    </div>
  );
}
