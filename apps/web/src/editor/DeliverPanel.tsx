import { useEffect, useRef, useState } from 'react';
import { findClip, FORMAT_PROFILES } from '@pulseframe/core';
import { jobStageLabel, type Key } from '@pulseframe/i18n';
import { api, type PreflightReport } from '../api.ts';
import { useEditorState } from './store.ts';
import { openExportSheet, useRecentExports } from './ExportSheet.tsx';
import { EXPORT_STRINGS } from './exportSheet.strings.ts';
import { formatFileSize } from './exportSheet.logic.ts';
import './deliverPanel.css';
import { ArchiveFamilyOption } from './lifeline/ArchiveFamilyOption.tsx';
import { addVariantGuard, frameOps, isShortActive } from './shorts.view.ts';

interface BatchJob { jobId: string; variantId: string; status: string; stage: string | null }
const ACTIVE = ['queued', 'running', 'cancel-requested'];

/** Linked formats, creative preflight and export of one or all formats (SPEC §19.8, §19.14). */
/** The master frame of the project: size, background and fill. One transaction; linked formats keep their own size. */
function ProjectFrame() {
  const { editor, state, t } = useEditorState();
  const st = state.doc?.settings;
  const short = isShortActive(state.rawDoc, state.activeSequenceId); // a short has its own frame; the background stays the project's
  const [w, setW] = useState(String(st?.width ?? ''));
  const [h, setH] = useState(String(st?.height ?? ''));
  const [bg, setBg] = useState(st?.background.slice(0, 7) ?? '#000000');
  const [fit, setFit] = useState<'contain' | 'cover'>(st?.fit ?? 'contain');
  useEffect(() => { if (st) { setW(String(st.width)); setH(String(st.height)); setBg(st.background.slice(0, 7)); setFit(st.fit ?? 'contain'); } }, [st?.width, st?.height, st?.background, st?.fit]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return null;
  const width = Math.round(Number(w)), height = Math.round(Number(h));
  const sizeOk = Number.isFinite(width) && Number.isFinite(height) && width >= 16 && height >= 16 && width <= 8192 && height <= 8192 && width % 2 === 0 && height % 2 === 0;
  const changed = width !== st.width || height !== st.height || (!short && bg.toLowerCase() !== st.background.slice(0, 7).toLowerCase()) || fit !== (st.fit ?? 'contain');
  const bgChanged = !short && bg.toLowerCase() !== st.background.slice(0, 7).toLowerCase();
  const apply = () => { if (state.rawDoc) void editor.commit(frameOps(state.rawDoc, state.activeSequenceId, { ...(width !== st.width ? { width } : {}), ...(height !== st.height ? { height } : {}), ...(bgChanged ? { background: bg } : {}), ...(fit !== (st.fit ?? 'contain') ? { fit } : {}) }), short ? 'Short frame' : 'Project frame'); };
  return (
    <section aria-labelledby="deliver-frame-h" data-testid="project-frame">
      <h3 id="deliver-frame-h">{t('frame.title')}</h3>
      <form className="fields" onSubmit={(e) => { e.preventDefault(); if (sizeOk && changed) apply(); }}>
        <div className="row">
          <label>{t('frame.width')}<input type="number" dir="ltr" min={16} max={8192} step={2} value={w} onChange={(e) => setW(e.target.value)} data-testid="frame-width" /></label>
          <label>{t('frame.height')}<input type="number" dir="ltr" min={16} max={8192} step={2} value={h} onChange={(e) => setH(e.target.value)} data-testid="frame-height" /></label>
        </div>
        <label>{t('frame.background')}<input type="color" value={bg} disabled={short} onChange={(e) => setBg(e.target.value)} data-testid="frame-background" /></label>
        <label>{t('frame.fit')}
          <select value={fit} onChange={(e) => setFit(e.target.value as 'contain' | 'cover')} data-testid="frame-fit">
            <option value="contain">{t('frame.fit.contain')}</option>
            <option value="cover">{t('frame.fit.cover')}</option>
          </select>
        </label>
        {!sizeOk && <p className="muted danger" role="alert" data-testid="frame-error">{t('frame.even')}</p>}
        <button type="submit" className="ghost" disabled={!sizeOk || !changed} data-testid="frame-apply">{t('frame.apply')}</button>
      </form>
    </section>
  );
}

export function DeliverPanel() {
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveHref, setArchiveHref] = useState<string | null>(null); // the archive without family details, when chosen (ArchiveFamilyOption)
  const { editor, state, t } = useEditorState();
  const { doc, viewVariantId, lang, revision, exportJob } = state;
  const variants = doc ? Object.values(doc.variants ?? {}) : [];
  const viewed = viewVariantId && doc?.variants?.[viewVariantId] ? doc.variants[viewVariantId]! : null;
  const sel = editor.selected;
  const overrideOf = viewed && sel ? viewed.overrides[sel.clip.id] : undefined;
  const pictureSel = !!sel && sel.track.kind !== 'audio' && sel.clip.type !== 'caption';

  const [report, setReport] = useState<{ r: PreflightReport; at: number; variantId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<BatchJob[]>([]);

  const runPreflight = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const r = await api.preflight(doc.id, viewVariantId, isShortActive(state.rawDoc, state.activeSequenceId) ? state.activeSequenceId : null);
      setReport({ r, at: r.revision, variantId: viewVariantId });
    } catch (e) { editor.fail(e); } finally { setBusy(false); }
  };
  const stale = !!report && (report.at !== revision || report.variantId !== viewVariantId);

  const batchActive = jobs.some((j) => ACTIVE.includes(j.status));
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => {
    if (!batchActive) return;
    const timer = window.setInterval(() => {
      void Promise.all(jobsRef.current.map(async (j) => (ACTIVE.includes(j.status) ? api.job(j.jobId).then((v): BatchJob => ({ ...j, status: v.status, stage: v.stage })).catch(() => j) : j))).then(setJobs);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [batchActive]);

  const exporting = !!exportJob && ACTIVE.includes(exportJob.status);
  const variantGuard = addVariantGuard(state.rawDoc, state.activeSequenceId, lang);
  const addProfile = async (p: (typeof FORMAT_PROFILES)[number]) => {
    const r = await editor.commit([{ op: 'add_variant', args: { profileId: p.id, name: p.name[lang] } }], 'Add format');
    const id = r?.results[0]?.output?.variantId;
    if (id) editor.setViewVariant(id);
  };
  const clickIssue = (ids: string[], startFrame?: number) => {
    const clipId = ids.find((id) => doc && findClip(doc, id));
    if (clipId) editor.select(clipId);
    if (startFrame !== undefined) editor.seek(startFrame);
  };
  const applyFix = async (ops: Parameters<typeof editor.commit>[0]) => {
    const r = await editor.commit(ops, 'Preflight fix');
    if (r) await runPreflight();
  };
  const exportAll = async () => {
    if (!doc) return;
    try {
      const r = await api.exportBatch(doc.id, variants.map((v) => v.id));
      setJobs(r.jobs.map((j) => ({ ...j, stage: null })));
    } catch (e) { editor.fail(e); }
  };
  const sevLabel = (s: string) => t(`deliver.severity.${s}` as Key);
  const XS = EXPORT_STRINGS[lang];
  const recent = useRecentExports();

  return (
    <div className="deliver pf-ds pf-dlv" data-testid="deliver-panel">
      <ProjectFrame />
      <section aria-labelledby="deliver-formats-h">
        <h3 id="deliver-formats-h">{t('deliver.formats')}</h3>
        <p className="muted">{t('deliver.formats.note')}</p>
        {variantGuard.disabled && <p className="muted" id="deliver-variant-reason" data-testid="format-add-reason">{variantGuard.reason}</p>}
        <div className="row deliver-add" role="group" aria-label={t('deliver.add')}>
          {FORMAT_PROFILES.map((p) => (
            <button key={p.id} type="button" className="ghost small" disabled={!doc || variantGuard.disabled} title={variantGuard.reason ?? undefined} aria-describedby={variantGuard.disabled ? 'deliver-variant-reason' : undefined} data-testid="format-add" data-profile-id={p.id} onClick={() => void addProfile(p)}>+ {p.name[lang]}</button>
          ))}
        </div>
        {variants.length === 0 ? <p className="muted">{t('deliver.none')}</p> : (
          <ul className="deliver-list">
            {variants.map((v) => {
              const n = Object.keys(v.overrides).length;
              return (
                <li key={v.id} data-testid="format-row" data-variant-id={v.id} className={v.id === viewVariantId ? 'current' : ''}>
                  <span dir="auto"><strong>{v.name}</strong> <bdi className="muted">{v.width}×{v.height}</bdi></span>
                  <label>{t('deliver.fit')}
                    <select value={v.fit} data-testid="format-fit" onChange={(e) => void editor.commit([{ op: 'update_variant', args: { variantId: v.id, fit: e.target.value as 'contain' | 'cover' } }], 'Format fit')}>
                      <option value="contain">{t('deliver.fit.contain')}</option>
                      <option value="cover">{t('deliver.fit.cover')}</option>
                    </select>
                  </label>
                  <span className="muted" data-testid="format-overrides">{n} {t('deliver.overrides')}</span>
                  <span className="row">
                    <button type="button" className="ghost small" aria-pressed={v.id === viewVariantId} data-testid="format-view" onClick={() => editor.setViewVariant(v.id)}>{t('deliver.view')}</button>
                    <button type="button" className="ghost small danger" data-testid="format-remove" aria-label={`${t('deliver.remove')}: ${v.name}`} onClick={() => void editor.commit([{ op: 'remove_variant', args: { variantId: v.id } }], 'Remove format')}>{t('deliver.remove')}</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {viewed && pictureSel && sel && (
          <div className="fields" data-testid="format-clip-overrides">
            <label className="check"><input type="checkbox" data-testid="format-hide-clip" checked={!!overrideOf?.hidden}
              onChange={(e) => void editor.commit([{ op: 'set_variant_override', args: { variantId: viewed.id, clipId: sel.clip.id, hidden: e.target.checked } }], 'Hide in format')} /> {t('deliver.hide')}</label>
            <button type="button" className="ghost small" data-testid="format-clear-override" disabled={!overrideOf}
              onClick={() => void editor.commit([{ op: 'set_variant_override', args: { variantId: viewed.id, clipId: sel.clip.id, transform: null, hidden: false } }], 'Clear override')}>{t('deliver.clear')}</button>
          </div>
        )}
      </section>

      <section aria-labelledby="deliver-pre-h">
        <h3 id="deliver-pre-h">{t('deliver.preflight')}</h3>
        <p className="muted">{t('deliver.preflight.for')}: <bdi>{viewed ? viewed.name : t('deliver.master')}</bdi></p>
        <button type="button" className="ghost" disabled={!doc || busy} data-testid="preflight-run" onClick={() => void runPreflight()}>{busy ? t('deliver.checking') : t('deliver.check')}</button>
        {report && (
          <div aria-live="polite">
            <p data-testid="preflight-summary" data-ok={String(report.r.ok)} data-blockers={report.r.blockers} data-warnings={report.r.warnings} data-stale={String(stale)}>
              <strong>{report.r.ok ? t('deliver.ok') : t('deliver.notok')}</strong> · {report.r.blockers} {t('deliver.blockers')} · {report.r.warnings} {t('deliver.warnings')} · {report.r.notes} {t('deliver.notes')}
              {stale && <em className="warn" data-testid="preflight-stale"> · {t('deliver.stale')}</em>}
            </p>
            {report.r.issues.length > 0 && (
              <ul className="deliver-issues">
                {report.r.issues.map((i, n) => (
                  <li key={`${i.code}:${n}`} data-testid="preflight-issue" data-code={i.code} data-severity={i.severity} className={`sev-${i.severity}`}>
                    <button type="button" className="ghost small issue-main" onClick={() => clickIssue(i.ids, i.range?.startFrame)}>
                      <span className="sev">{sevLabel(i.severity)}</span> <span dir="auto"><b>{XS.issue[i.code]?.[0] ?? i.message}</b>{XS.issue[i.code]?.[1] && <small>{XS.issue[i.code]![1]}</small>}</span>
                    </button>
                    {i.fix && <button type="button" className="primary small" data-testid="preflight-fix" disabled={stale} onClick={() => void applyFix(i.fix!.ops)}>{XS.issue[i.code]?.[2] || i.fix.label}</button>}
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small-text" data-testid="preflight-scope" dir="auto">{XS.scope}</p>
          </div>
        )}
      </section>

      <section aria-labelledby="deliver-exp-h">
        <h3 id="deliver-exp-h">{t('deliver.export')}</h3>
        <div className="row">
          <button type="button" className="primary" disabled={!doc || editor.player?.frameCount === 0} data-testid="deliver-export" onClick={() => openExportSheet()}>
            {exporting ? t('export.running') : XS.title}…
          </button>
          <button type="button" className="ghost" disabled={!doc || variants.length === 0 || batchActive} data-testid="deliver-export-all" onClick={() => void exportAll()}>{t('deliver.export.all')}</button>
        </div>
        {recent.length > 0 && (
          <div className="pf-dlv-recent" data-testid="deliver-recent">
            <h4>{lang === 'he' ? 'ייצואים אחרונים' : 'Recent exports'}</h4>
            <ul>{recent.map((j) => (
              <li key={j.id}><span dir="auto">{doc?.name} · {j.label}</span><span className="num">{j.ext.toUpperCase()}{typeof j.output?.bytes === 'number' ? ` · ${formatFileSize(j.output.bytes)}` : ''}</span><a href={`/api/v1/jobs/${j.id}/output`} download>{XS.download}</a></li>
            ))}</ul>
          </div>
        )}
        {exportJob?.status === 'succeeded' && <a href={`/api/v1/jobs/${exportJob.id}/output`} data-testid="deliver-export-link">{t('export.done')}</a>}
        {exportJob?.status === 'failed' && <p className="danger" role="alert">{t('export.failed')}: {exportJob.error?.message}</p>}
        {jobs.length > 0 && (
          <ul className="deliver-jobs" data-testid="deliver-jobs">
            {jobs.map((j) => (
              <li key={j.jobId} data-testid="deliver-job" data-job-id={j.jobId} data-status={j.status}>
                <span dir="auto">{doc?.variants?.[j.variantId]?.name ?? j.variantId}</span> <span className="muted">{j.status}{j.stage ? ` · ${jobStageLabel(j.stage, lang)}` : ''}</span>
                {j.status === 'succeeded' && <a href={`/api/v1/jobs/${j.jobId}/output`} data-testid="deliver-job-download">{t('export.done')}</a>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t('archive.title')}>
        <h3>{t('archive.title')}</h3>
        <p className="muted small">{t('archive.note')}</p>
        <div className="row">
          {doc && <a className="ghost" href={archiveHref ?? `/api/v1/projects/${doc.id}/archive`} download data-testid="archive-download">{t('archive.download')}</a>}
          <label className="ghost file">{t('archive.import')}
            <input type="file" accept=".tar,application/x-tar" data-testid="archive-import" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importArchiveFile(file, (m) => setArchiveError(m)); }} />
          </label>
        </div>
        {doc && <ArchiveFamilyOption projectId={doc.id} onHref={setArchiveHref} />}
        {archiveError && <p className="danger" role="alert" data-testid="archive-error">{archiveError}</p>}
      </section>
    </div>
  );
}

/** Notes of the last archive import (server answer `notes`, each with `he` and `en`), shown once by the new project (App.tsx). */
export const IMPORT_NOTES_KEY = 'pf.import.notes';
/** Upload an archive; on success open the new project (a full page load keeps one editor instance per project). */
async function importArchiveFile(file: File, onError: (message: string) => void) {
  try {
    const r = await fetch('/api/v1/projects/import', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-tar' }, body: file });
    const data = await r.json();
    if (!r.ok) return onError(`${data?.error?.message ?? `HTTP ${r.status}`}`);
    // what the import changed on the way in (a translation's reviewed mark is cleared, archive.ts): told once in the new project
    if (Array.isArray(data.notes) && data.notes.length) { try { sessionStorage.setItem(IMPORT_NOTES_KEY, JSON.stringify({ projectId: data.project.id, notes: data.notes })); } catch { /* storage unavailable: the note is lost, the import is not */ } }
    location.assign(`/?project=${encodeURIComponent(data.project.id)}`);
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
  }
}
