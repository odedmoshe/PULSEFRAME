/**
 * The export sheet (UX_REDESIGN §4.12, owner decision: export always opens it). A real modal dialog in three steps:
 * settings (destination, formats, size, quality, captions, the checks before export), progress (a real progressbar and the
 * stages the server reports), and done / failed (file cards, the photosensitivity result with jump-to, retry).
 *
 * Whatever is shown comes from the server: stages and frame counts from the job, sizes from the export plan, the flash
 * result from the saved file. No time estimate is shown because none is measured. Exports are started through the same REST
 * routes as every other client; a format that is not linked yet is linked first with the registered `add_variant` op.
 *
 * Opening: `openExportSheet()` (the top bar's Export button and its ring chip, the Deliver panel), or `editor.openExportSheet()`
 * (the palette's command). `<ExportSheetHost/>` renders the dialog; App.tsx mounts it once (a second host would stay empty).
 * Exports start through `editor.startExport(options)`, which also registers the job for the editor's auto-save and for the
 * top bar's ring.
 * The photosensitivity card in the done step carries its own ids (export-flash-*): flash-pass / flash-fail are the status
 * bar's (StatusBar.tsx), which stays after the sheet is closed.
 */
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Download, MessageCircle, MonitorPlay, Play, ShieldCheck, SlidersHorizontal, Smartphone, HardDriveDownload, TriangleAlert, Upload } from 'lucide-react';
import { Badge, Button, Dialog, ProgressBar } from '../ds/index.ts';
import { isolate } from '../ds/util.tsx';
import { translateRefusal } from '@pulseframe/i18n';
import * as T from '@pulseframe/time';
import { api, ApiFailure, type PreflightIssue, type PreflightReport } from '../api.ts';
import { useEditorState, type Editor, type ExportRequest } from './store.ts';
import { EXPORT_STRINGS, type ExportStrings } from './exportSheet.strings.ts';
import {
  alsoSuggestion, DEFAULT_CHOICES, DESTINATIONS, describeExport, jobsOnOpen, mergeJobViews, destinationKey, exportOptions, exportTargets, formatFileSize, formatLength, fourKReachable, isActiveJob, jobFraction, overallFraction,
  parseStage, scaledSize, shortSideLabel, STAGE_ORDER, type Destination, type ExportCaptions, type ExportChoices, type ExportQuality, type ExportScale, type ExportTarget,
  fixLabel as fixLabelOf,
} from './exportSheet.logic.ts';
import './exportSheet.css';
import { CacheDoneLine, CacheFailure, cacheStageLabel, ExportReuseLine } from './ExportReuseLine.tsx';
import { cacheText } from './renderCache.strings.ts';

// ---------------------------------------------------------------- the sheet's own small store (open state and the jobs it started)
/** `pending`: an export the sheet did not start (the chip's followed job), named from the project until its stored options are read. */
export interface SheetJob { id: string; label: string; variantId: string | null; status: string; stage: string | null; output: any; error: any; ext: string; w: number; h: number; pending?: boolean }
interface SheetState { open: boolean; jobs: SheetJob[]; starting: boolean; error: string | null; blockers: { code: string; message: string }[]; recent: SheetJob[] }
let sheet: SheetState = { open: false, jobs: [], starting: false, error: null, blockers: [], recent: [] };
const listeners = new Set<() => void>();
const setSheet = (patch: Partial<SheetState>) => {
  sheet = { ...sheet, ...patch };
  // finished files of this session, newest first (the Deliver panel lists them as recent exports)
  const fresh = sheet.jobs.filter((j) => j.status === 'succeeded' && !sheet.recent.some((r) => r.id === j.id));
  if (fresh.length) sheet = { ...sheet, recent: [...fresh, ...sheet.recent].slice(0, 6) };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const useSheet = () => useSyncExternalStore(subscribe, () => sheet);
/**
 * Opens the export sheet. A finished or failed earlier run is cleared, so the sheet opens on its settings; a running one is
 * shown. `{ last: true }` (the top bar's export chip) shows the last run as it is, finished or not, and `followed` is the
 * export the chip follows: when the sheet did not start it (the agent, another tab, a reload), it is shown all the same, with
 * its progress and cancel, or its file and retry (exportSheet.logic.ts jobsOnOpen).
 */
export function openExportSheet(opts: { last?: boolean; followed?: SheetJob | null } = {}) {
  setSheet({ open: true, error: null, blockers: [], jobs: jobsOnOpen(sheet.jobs, opts, opts.followed ?? null) });
}
/** The runs of the sheet's last export and whether the sheet is open (the top bar's export chip reads them). */
export function useExportSheet(): { open: boolean; jobs: readonly SheetJob[]; starting: boolean } { const s = useSheet(); return { open: s.open, jobs: s.jobs, starting: s.starting }; }
/** The files this session exported, newest first (for the Deliver panel). */
export function useRecentExports(): SheetJob[] { return useSheet().recent; }
export function closeExportSheet() { setSheet({ open: false }); }

// only the first mounted host renders, so a second mount point cannot open a second dialog
const hosts: number[] = [];
const hostListeners = new Set<() => void>();
let hostSeq = 1;
function usePrimaryHost(): boolean {
  const [id] = useState(() => hostSeq++);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    hosts.push(id); hostListeners.add(bump); for (const l of hostListeners) l();
    return () => { hosts.splice(hosts.indexOf(id), 1); hostListeners.delete(bump); for (const l of hostListeners) l(); };
  }, [id]);
  return hosts[0] === id;
}

const ICON = { reels: Smartphone, youtube: MonitorPlay, whatsapp: MessageCircle, computer: HardDriveDownload, custom: SlidersHorizontal } as const;

export function ExportSheetHost() {
  const primary = usePrimaryHost();
  const s = useSheet();
  const { editor, state } = useEditorState();
  // keep the jobs this sheet started up to date (the editor's own state only follows the newest export)
  const active = s.jobs.some((j) => isActiveJob(j.status));
  useEffect(() => {
    if (!primary || !active) return;
    // answers are folded into the list as it is when they arrive (by id), so a file started while a poll was in flight is not dropped
    const tick = () => {
      const asked = sheet.jobs.filter((j) => isActiveJob(j.status));
      void Promise.all(asked.map(async (j) => {
        try { const v = await api.job(j.id); return { id: j.id, status: v.status, stage: v.stage, output: v.output, error: v.error }; } catch { return null; }
      })).then((views) => setSheet({ jobs: mergeJobViews(sheet.jobs, views.filter((v) => v !== null)) }));
    };
    const h = window.setInterval(tick, 600);
    tick();
    return () => window.clearInterval(h);
  }, [primary, active]);
  // an export the sheet did not start is named from the options the server stored with it (its format, file type and size)
  const pending = s.jobs.filter((j) => j.pending).map((j) => j.id).join(' ');
  useEffect(() => {
    const doc = state.doc;
    if (!primary || !pending || !doc) return;
    for (const id of pending.split(' ')) {
      void api.job(id).then((v) => setSheet({ jobs: sheet.jobs.map((j) => (j.id === id ? { ...j, ...describeExport(doc, v.options, state.lang), status: isActiveJob(j.status) ? v.status : j.status, stage: isActiveJob(j.status) ? v.stage : j.stage, output: isActiveJob(j.status) ? v.output : j.output, error: isActiveJob(j.status) ? v.error : j.error, pending: false } : j)) }))
        .catch(() => setSheet({ jobs: sheet.jobs.map((j) => (j.id === id ? { ...j, pending: false } : j)) }));
    }
  }, [primary, pending]); // eslint-disable-line react-hooks/exhaustive-deps
  // the editor hears the newest export through the event stream; that is fresher than the next poll, so the sheet takes it too
  const heard = state.exportJob;
  useEffect(() => {
    if (!primary || !heard || !sheet.jobs.some((j) => j.id === heard.id)) return;
    setSheet({ jobs: mergeJobViews(sheet.jobs, [heard]) });
  }, [primary, heard]);
  // the palette's command asks through the editor (editor.openExportSheet)
  const asked = state.exportSheet;
  const seenAsk = useRef(asked);
  useEffect(() => { if (primary && asked !== seenAsk.current) { seenAsk.current = asked; openExportSheet(); } }, [primary, asked]);
  if (!primary || !state.doc) return null;
  return <Sheet editor={editor} />;
}

function Sheet({ editor }: { editor: Editor }) {
  const s = useSheet();
  const { state } = useEditorState();
  const S: ExportStrings = EXPORT_STRINGS[state.lang];
  // while more files are still being started the sheet is not done, even if the first one already finished
  const phase: 'settings' | 'running' | 'done' = s.jobs.length === 0 ? 'settings' : s.starting || s.jobs.some((j) => isActiveJob(j.status)) ? 'running' : 'done';
  const step = phase === 'settings' ? 0 : phase === 'running' ? 1 : 2;
  return (
    <Dialog open={s.open} onClose={closeExportSheet} title={S.title} closeLabel={S.close} variant="sheet" size="lg" className="pf-xs" testId="export-sheet" dismissOnBackdrop={phase !== 'running'}
      footer={phase === 'settings' ? <SettingsFooter editor={editor} S={S} /> : undefined}>
      <ol className="pf-xs-steps" aria-label={S.title}>
        {S.steps.map((x, i) => <li key={x} aria-current={i === step ? 'step' : undefined} className={i === step ? 'is-on' : i < step ? 'is-past' : ''}><span className="num">{i + 1}</span>{x}</li>)}
      </ol>
      {phase === 'settings' && <Settings editor={editor} S={S} />}
      {phase === 'running' && <Running S={S} />}
      {phase === 'done' && <Done editor={editor} S={S} />}
    </Dialog>
  );
}

// ---------------------------------------------------------------- settings
/** The choices live above the footer and the body so the primary button can read them. */
interface Pick { keys: string[]; choices: ExportChoices; dest: Destination['id'] | null }
// a destination is chosen from the start (saving a file on this computer: the original shape, full quality), so the sheet never opens on nothing
const FIRST = DESTINATIONS.find((d) => d.id === 'computer')!;
let pick: Pick = { keys: ['master'], choices: { ...DEFAULT_CHOICES, ...FIRST.choices }, dest: FIRST.id };
const pickListeners = new Set<() => void>();
const setPick = (p: Partial<Pick>) => { pick = { ...pick, ...p }; for (const l of pickListeners) l(); };
const usePick = () => useSyncExternalStore((l) => { pickListeners.add(l); return () => { pickListeners.delete(l); }; }, () => pick);

function Settings({ editor, S }: { editor: Editor; S: ExportStrings }) {
  const { state } = useEditorState();
  const doc = state.doc!;
  const lang = state.lang;
  const p = usePick();
  const targets = useMemo(() => exportTargets(doc), [doc]);
  const chosen = targets.filter((x) => p.keys.includes(x.key));
  const lead = chosen[0] ?? targets[0]!;
  const hasCaptions = doc.sequences[doc.mainSequenceId]!.tracks.some((t) => t.kind === 'caption' && t.clips.length > 0);

  // drop keys that no longer exist (a format removed while the sheet was open)
  useEffect(() => { const ok = p.keys.filter((k) => targets.some((t) => t.key === k)); if (ok.length !== p.keys.length) setPick({ keys: ok.length ? ok : ['master'] }); }, [targets]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) => setPick({ dest: 'custom', keys: p.keys.includes(key) ? p.keys.filter((k) => k !== key) : [...p.keys, key] });
  const chooseDest = (d: Destination) => {
    const key = destinationKey(d, targets);
    setPick({ dest: d.id, ...(key ? { keys: [key] } : {}), choices: { ...p.choices, ...d.choices } });
  };
  const setChoice = (patch: Partial<ExportChoices>) => setPick({ dest: 'custom', choices: { ...p.choices, ...patch } });

  const sec = doc.settings.frameRate ? T.toSeconds(editor.duration) : 0;
  const frames = editor.player?.frameCount ?? 0;
  // the lane and the reuse line plan with what this export would send (the quality is part of every segment key)
  const planWith = JSON.stringify(exportOptions(p.choices, lead.variantId));
  useEffect(() => { editor.setPlanOptions(JSON.parse(planWith) as Record<string, unknown>); }, [planWith, editor]);

  return (
    <div className="pf-xs-settings">
      <div className="pf-xs-col">
        <section aria-labelledby="xs-where">
          <h3 id="xs-where">{S.where}</h3>
          <div className="pf-xs-dests" role="radiogroup" aria-labelledby="xs-where">
            {DESTINATIONS.map((d) => {
              const Icon = ICON[d.id];
              return (
                <button key={d.id} type="button" role="radio" aria-checked={p.dest === d.id} className={`pf-xs-dest${p.dest === d.id ? ' is-on' : ''}`} data-testid="export-dest" data-id={d.id} onClick={() => chooseDest(d)}>
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  <b>{S.dest[d.id]}</b>
                  <span>{isolate(S.destSub[d.id])}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="xs-formats">
          <h3 id="xs-formats">{S.formats}</h3>
          <div className="pf-xs-formats" role="group" aria-labelledby="xs-formats">
            {targets.map((t) => <FormatCard key={t.key} t={t} on={p.keys.includes(t.key)} onToggle={() => toggle(t.key)} S={S} lang={lang} />)}
          </div>
        </section>

        <div className="pf-xs-pair">
          <section aria-labelledby="xs-res">
            <h3 id="xs-res">{S.resolution}</h3>
            <div className="pf-xs-seg" role="radiogroup" aria-labelledby="xs-res">
              {([1, 0.5, 0.25] as ExportScale[]).map((sc) => (
                <button key={sc} type="button" role="radio" aria-checked={p.choices.scale === sc} className={p.choices.scale === sc ? 'is-on' : ''} onClick={() => setChoice({ scale: sc })}>
                  <span className="num">{shortSideLabel(lead, sc)}</span>
                </button>
              ))}
              <button type="button" role="radio" aria-checked={false} aria-disabled="true" className="is-off" title={S.fourKWhy(shortSideLabel(lead, 1))}>
                <span className="num">{S.fourK}</span>
              </button>
            </div>
            {!fourKReachable(lead) && <p className="pf-xs-note">{S.fourKWhy(shortSideLabel(lead, 1))}</p>}
          </section>
          <section aria-labelledby="xs-q">
            <h3 id="xs-q">{S.quality}</h3>
            <div className="pf-xs-seg" role="radiogroup" aria-labelledby="xs-q">
              {(['draft', 'standard', 'high'] as ExportQuality[]).map((q) => (
                <button key={q} type="button" role="radio" aria-checked={p.choices.quality === q} className={p.choices.quality === q ? 'is-on' : ''} onClick={() => setChoice({ quality: q })}>{S.q[q]}</button>
              ))}
            </div>
          </section>
        </div>

        <div className="pf-xs-pair">
          <section aria-labelledby="xs-cap">
            <h3 id="xs-cap">{S.captions}</h3>
            <div className="pf-xs-seg" role="radiogroup" aria-labelledby="xs-cap">
              {(['burned', 'sidecar-srt', 'none'] as ExportCaptions[]).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={p.choices.captions === c} className={p.choices.captions === c ? 'is-on' : ''} onClick={() => setChoice({ captions: c })}>{S.c[c]}</button>
              ))}
            </div>
            {!hasCaptions && <p className="pf-xs-note">{lang === 'he' ? 'אין כתוביות בפרויקט' : 'There are no captions in the project'}</p>}
          </section>
          <section aria-labelledby="xs-type">
            <h3 id="xs-type">{S.fileType}</h3>
            <div className="pf-xs-seg" role="radiogroup" aria-labelledby="xs-type">
              <button type="button" role="radio" aria-checked={p.choices.format === 'mp4-h264-aac'} className={p.choices.format === 'mp4-h264-aac' ? 'is-on' : ''} data-testid="export-type-mp4" onClick={() => setChoice({ format: 'mp4-h264-aac' })}><span className="num">MP4</span></button>
              <button type="button" role="radio" aria-checked={p.choices.format === 'webm-vp9-opus'} className={p.choices.format === 'webm-vp9-opus' ? 'is-on' : ''} data-testid="export-type-webm" onClick={() => setChoice({ format: 'webm-vp9-opus' })}><span className="num">WebM</span></button>
            </div>
          </section>
        </div>

        {/* «ייצוא מהיר» (ADR-0024): the switch, the reuse line and the honest notes; off unless the viewer turns it on */}
        <section aria-label={cacheText(lang, 'cache.fast.label')} data-testid="export-fast">
          <ExportReuseLine plan={state.segmentPlan} fastExport={state.fastExport} onFastExport={(on) => editor.setFastExport(on)} format={p.choices.format} blockerCodes={state.planBlockers} lang={lang} frameRate={doc.settings.frameRate} />
        </section>

        <section aria-labelledby="xs-name">
          <h3 id="xs-name">{S.fileName}</h3>
          <div className="pf-xs-name">
            <span className="pf-xs-ext num">{p.choices.format === 'webm-vp9-opus' ? 'webm' : 'mp4'}</span>
            <output dir="auto" id="xs-name-v">{doc.name}</output>
          </div>
          <p className="pf-xs-note">{S.savedIn} · {S.nameNote}</p>
        </section>

        <Checks editor={editor} S={S} lead={lead} />
      </div>

      <Preview doc-id={doc.id} lead={lead} S={S} lang={lang} frame={editor.frame} revision={state.revision} sec={sec} frames={frames} choices={p.choices} />
    </div>
  );
}

function FormatCard({ t, on, onToggle, S, lang }: { t: ExportTarget; on: boolean; onToggle: () => void; S: ExportStrings; lang: 'he' | 'en' }) {
  const { state, editor } = useEditorState();
  const doc = state.doc!;
  const src = `/api/v1/projects/${doc.id}/frame?index=${editor.frame}${t.variantId ? `&variant=${encodeURIComponent(t.variantId)}` : ''}${t.kind === 'profile' ? '&x=1' : ''}`;
  const name = t.kind === 'master' ? `${S.master} ${t.name[lang].split(' ').slice(-1)[0]}` : t.name[lang];
  const aspectBox = { aspectRatio: `${t.width} / ${t.height}` };
  return (
    <label className={`pf-xs-fmt${on ? ' is-on' : ''}`} data-testid="export-format" data-key={t.key}>
      <input type="checkbox" checked={on} onChange={onToggle} />
      <span className="pf-xs-fmt-box" style={aspectBox} aria-hidden="true">
        {t.kind !== 'profile' ? <FrameImg src={src} cover={t.fit === 'cover'} rev={state.revision} /> : <><FrameImg src={`/api/v1/projects/${doc.id}/frame?index=${editor.frame}`} cover rev={state.revision} /><i /></>}
      </span>
      <span className="pf-xs-fmt-text"><b>{isolate(name)}</b><span className="num">{t.width}×{t.height}</span>{t.kind === 'profile' && <em>{S.willLink}</em>}</span>
    </label>
  );
}

/** One server-rendered frame (the render_frame route: the same evaluate + compositor as preview and export), or a quiet box while it loads. */
function FrameImg({ src, cover, rev }: { src: string; cover?: boolean; rev: number }) {
  const [ok, setOk] = useState<'loading' | 'ok' | 'fail'>('loading');
  useEffect(() => setOk('loading'), [src, rev]);
  return (
    <>
      <img src={`${src}&r=${rev}`} alt="" loading="lazy" decoding="async" style={{ objectFit: cover ? 'cover' : 'contain', opacity: ok === 'ok' ? 1 : 0 }} onLoad={() => setOk('ok')} onError={() => setOk('fail')} />
      {ok === 'loading' && <i className="pf-xs-shimmer" />}
    </>
  );
}

function Preview({ lead, S, lang, frame, revision, sec, frames, choices, ...rest }: { 'doc-id': string; lead: ExportTarget; S: ExportStrings; lang: 'he' | 'en'; frame: number; revision: number; sec: number; frames: number; choices: ExportChoices }) {
  const id = rest['doc-id'];
  const { state } = useEditorState();
  const doc = state.doc!;
  const [bytes, setBytes] = useState<number | null>(null);
  const variant = lead.variantId ? doc.variants?.[lead.variantId] : null;
  const safe = variant?.safeArea ?? (lead.kind === 'profile' ? FORMAT_SAFE(lead.profileId) : null);
  // the server's plan carries a size estimate only when it has a basis; otherwise none is shown
  useEffect(() => {
    let dead = false;
    setBytes(null);
    const t = window.setTimeout(() => {
      fetch(`/api/v1/projects/${id}/exports/plan`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(exportOptions(choices, lead.variantId)) })
        .then((r) => r.json()).then((j) => { if (!dead) setBytes(typeof j?.manifest?.estimate?.bytes === 'number' ? j.manifest.estimate.bytes : null); }).catch(() => undefined);
    }, 250);
    return () => { dead = true; window.clearTimeout(t); };
  }, [id, revision, choices.quality, choices.scale, choices.format, lead.variantId]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = `/api/v1/projects/${id}/frame?index=${frame}${lead.variantId ? `&variant=${encodeURIComponent(lead.variantId)}` : ''}`;
  const out = scaledSize(lead, choices.scale);
  return (
    <aside className="pf-xs-preview" aria-label={S.preview} data-testid="export-preview">
      <div className="pf-xs-pv-title">{S.preview} · {isolate(lead.name[lang])}</div>
      <div className="pf-xs-pv-frame" style={{ aspectRatio: `${lead.width} / ${lead.height}` }}>
        {lead.kind === 'profile' ? <FrameImg src={`/api/v1/projects/${id}/frame?index=${frame}`} cover rev={revision} /> : <FrameImg src={src} cover={lead.fit === 'cover'} rev={revision} />}
        {safe && <span className="pf-xs-zone" aria-hidden="true" style={{ insetBlockStart: 0, insetInline: 0, blockSize: `${safe.top * 100}%` }} />}
        {safe && <span className="pf-xs-zone" aria-hidden="true" style={{ insetBlockEnd: 0, insetInline: 0, blockSize: `${safe.bottom * 100}%` }} />}
      </div>
      {lead.kind === 'profile' && <p className="pf-xs-note">{S.willLink}</p>}
      <dl className="pf-xs-facts">
        <div><dt>{S.length}</dt><dd className="num">{formatLength(sec)}</dd></div>
        <div><dt>{lang === 'he' ? 'גודל תמונה' : 'Picture size'}</dt><dd className="num">{out.width}×{out.height}</dd></div>
        {bytes != null && <div><dt>{S.size}</dt><dd><span className="num">≈ {formatFileSize(bytes)}</span><small>{S.sizeNote}</small></dd></div>}
        {frames > 0 && <div><dt>{S.frames}</dt><dd className="num">{frames}</dd></div>}
      </dl>
    </aside>
  );
}
const FORMAT_SAFE = (profileId: string | null) => {
  const p = profileId === 'vertical-9x16' ? { top: 0.1, bottom: 0.2 } : profileId ? { top: 0.05, bottom: 0.08 } : null;
  return p ? { ...p, left: 0, right: 0 } : null;
};

// ---------------------------------------------------------------- the checks before export
function Checks({ editor, S, lead }: { editor: Editor; S: ExportStrings; lead: ExportTarget }) {
  const { state } = useEditorState();
  const doc = state.doc!;
  const [rep, setRep] = useState<PreflightReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loud, setLoud] = useState<{ lufs: number | null } | 'measuring' | 'none'>('measuring');
  const variantId = lead.variantId;
  const run = async () => {
    setBusy(true); setFailed(false);
    try { setRep(await api.preflight(doc.id, variantId)); } catch { setFailed(true); } finally { setBusy(false); }
  };
  useEffect(() => { void run(); }, [state.revision, variantId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let dead = false;
    setLoud('measuring');
    api.measureLoudness(doc.id).then((r) => { if (!dead) setLoud(r.integratedLufs == null ? 'none' : { lufs: r.integratedLufs }); }).catch(() => { if (!dead) setLoud('none'); });
    return () => { dead = true; };
  }, [state.revision, doc.id]);
  const fix = async (i: PreflightIssue) => { if (i.fix && (await editor.commit(i.fix.ops, 'Preflight fix'))) await run(); };
  const target = doc.settings.loudness?.target ?? null;
  const lufs = typeof loud === 'object' ? loud.lufs : null;
  const loudBad = lufs != null && target !== -14 && Math.abs(lufs + 14) > 2;
  const fmt = (v: number) => v.toFixed(1).replace('-', '−');
  const issues = rep?.issues.filter((i) => i.code !== 'no_loudness_target') ?? [];
  const words = (i: PreflightIssue): [string, string, string] => S.issue[i.code] ?? [i.message, '', ''];
  return (
    <section aria-labelledby="xs-pre" data-testid="export-preflight">
      <h3 id="xs-pre">{S.preflight}</h3>
      <ul className="pf-xs-checks" aria-busy={busy}>
        {busy && !rep && <li className="pf-xs-check"><span>{S.checking}</span></li>}
        {failed && <li className="pf-xs-check is-warn"><span><b>{S.preflightFail}</b></span><Button size="sm" variant="secondary" onClick={() => void run()}>{S.retry}</Button></li>}
        {rep && issues.length === 0 && !failed && <li className="pf-xs-check is-ok"><Check size={16} aria-hidden="true" /><span><b>{S.allClear}</b></span></li>}
        {issues.map((i, n) => {
          const [head, detail, fixLabel] = words(i);
          return (
            <li key={`${i.code}${n}`} className={`pf-xs-check ${i.severity === 'note' ? '' : 'is-warn'}`} data-testid="export-check" data-code={i.code} data-severity={i.severity}>
              <TriangleAlert size={16} aria-hidden="true" />
              <span><b>{head}</b>{detail && <small>{detail}</small>}<small className="pf-xs-sev">{i.severity === 'blocker' ? S.blocker : i.severity === 'warning' ? S.warning : ''}</small></span>
              {i.fix && <Button size="sm" variant="secondary" onClick={() => void fix(i)}>{fixLabel || fixLabelOf(S.fix, i.fix.label)}</Button>}
            </li>
          );
        })}
        <li className={`pf-xs-check ${loudBad ? 'is-warn' : ''}`} data-testid="export-loudness">
          {loudBad ? <TriangleAlert size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
          <span><b>{S.loud}</b><small>{loud === 'measuring' ? S.loudMeasuring : loud === 'none' || lufs == null ? S.loudNone : loudBad ? (lufs < -14 ? S.loudLow(fmt(lufs)) : S.loudHigh(fmt(lufs))) : S.loudOk(fmt(lufs))}</small></span>
          {loudBad && <Button size="sm" variant="secondary" onClick={() => void editor.commit([{ op: 'set_loudness_target', args: { target: -14 } }], 'Loudness target')}>{S.loudSet}</Button>}
        </li>
        <li className="pf-xs-check" data-testid="export-flash-pending">
          <ShieldCheck size={16} aria-hidden="true" />
          <span><b>{S.flashRow}</b><small>{S.flashPending}</small></span>
        </li>
      </ul>
    </section>
  );
}

function SettingsFooter({ editor, S }: { editor: Editor; S: ExportStrings }) {
  const s = useSheet();
  const p = usePick();
  const { state } = useEditorState();
  const doc = state.doc!;
  const lang = state.lang;
  const targets = useMemo(() => exportTargets(doc), [doc]);
  const chosen = targets.filter((x) => p.keys.includes(x.key));
  const empty = (editor.player?.frameCount ?? 1) === 0;
  const reason = empty ? S.noClips : chosen.length === 0 ? S.pick : undefined;
  const start = async () => {
    setSheet({ starting: true, error: null, blockers: [] });
    try {
      // formats that are not linked yet are linked first: one transaction, undoable, the same op the Deliver panel uses
      const need = chosen.filter((c) => c.kind === 'profile');
      const made = new Map<string, string>();
      if (need.length) {
        const r = await editor.commit(need.map((c) => ({ op: 'add_variant' as const, args: { profileId: c.profileId!, name: c.name[lang] } })), 'Add formats');
        if (!r) { setSheet({ starting: false, error: S.startFailed }); return; }
        need.forEach((c, i) => { const v = r.results[i]?.output?.variantId; if (v) made.set(c.key, v); });
      }
      for (const c of chosen) {
        const variantId = c.kind === 'master' ? null : c.kind === 'variant' ? c.variantId : made.get(c.key) ?? null;
        const out = scaledSize(c, p.choices.scale);
        // the editor registers the job: its file is saved by itself when ready, and the top bar's ring follows it (store.ts)
        const fast = state.fastExport && p.choices.format === 'mp4-h264-aac' && !state.planBlockers.length; // «ייצוא מהיר» (ADR-0024), off unless the viewer turned it on
        const jobId = await editor.startExport({ ...exportOptions(p.choices, variantId), ...(fast ? { mode: 'incremental' as const } : {}) } as ExportRequest);
        if (!jobId) throw new Error(S.startFailed);
        const r = { jobId };
        // append to the list as it is now (a poll may have updated the earlier files meanwhile); `starting` stays on until the last is added
        setSheet({ jobs: [...sheet.jobs, { id: r.jobId, label: c.name[lang], variantId, status: 'queued', stage: null, output: null, error: null, ext: p.choices.format === 'webm-vp9-opus' ? 'webm' : 'mp4', w: out.width, h: out.height }] });
      }
      setSheet({ starting: false });
    } catch (e) {
      const blockers = e instanceof ApiFailure && Array.isArray((e.details as { blockers?: unknown })?.blockers) ? ((e.details as { blockers: { code: string; message: string }[] }).blockers) : [];
      setSheet({ starting: false, blockers, error: e instanceof ApiFailure ? (translateRefusal(lang, e.message) ?? e.message) : S.startFailed });
    }
  };
  return (
    <>
      <span className="pf-xs-ambient">{S.ambient}</span>
      <Button variant="ghost" size="lg" onClick={closeExportSheet}>{S.cancel}</Button>
      <Button variant="primary" size="lg" icon={<Upload size={18} strokeWidth={1.75} aria-hidden="true" />} busy={s.starting} disabledReason={reason} onClick={() => void start()} data-testid="export-start" keys={['Enter']}>{S.exportN(chosen.length)}</Button>
      {s.error && <span className="pf-xs-err" role="alert">{s.error}{s.blockers.length > 0 && <> · {s.blockers.map((b) => b.message).join('; ')}</>}</span>}
    </>
  );
}

// ---------------------------------------------------------------- progress
function Running({ S }: { S: ExportStrings }) {
  const { editor, state } = useEditorState();
  const s = useSheet();
  const total = s.jobs.length;
  const frac = overallFraction(s.jobs);
  const cur = s.jobs.find((j) => j.status === 'running' || j.status === 'cancel-requested') ?? s.jobs.find((j) => isActiveJob(j.status)) ?? s.jobs[0]!;
  const st = parseStage(cur.stage);
  const canceling = s.jobs.some((j) => j.status === 'cancel-requested');
  const pct = frac == null ? null : Math.round(frac * 100);
  const cancel = () => { for (const j of s.jobs) if (isActiveJob(j.status)) void api.cancelJob(j.id).catch((e) => editor.fail(e)); };
  const idx = st.index;
  return (
    <div className="pf-xs-run" data-testid="export-progress" data-lang={state.lang}>
      <h3 className="pf-xs-run-title">{S.progressTitle(cur.label)}{total > 1 && <small> · {S.fileOf(s.jobs.indexOf(cur) + 1, total)}</small>}</h3>
      <div className="pf-xs-big">
        <div className="pf-xs-pct" aria-hidden="true"><span className="num">{pct == null ? '…' : `${pct}%`}</span></div>
        <div className="pf-xs-big-meta">
          {/* the fast export's own stages (keying, self-check, joining …) are worded by the render cache's strings (ADR-0024) */}
          {!st.id && cur.stage && cacheStageLabel(cur.stage, state.lang)
            ? <b data-testid="cache-stage" data-stage={cur.stage.split(' ')[0]}>{cacheStageLabel(cur.stage, state.lang)}</b>
            : <b>{st.id ? S.stageNames[st.id] : S.starting}</b>}
          {st.done != null && st.total != null && <span className="num">{S.framesOf(st.done, st.total)} {S.frameWord}</span>}
        </div>
      </div>
      <ProgressBar value={pct} label={S.progressLabel} />
      <ol className="pf-xs-stages">
        {STAGE_ORDER.map((id, i) => (
          <li key={id} className={i < idx ? 'is-done' : i === idx ? 'is-now' : ''} aria-current={i === idx ? 'step' : undefined}>
            <span className="pf-xs-dot" aria-hidden="true">{i < idx ? <Check size={12} strokeWidth={3} /> : null}</span>{S.stageNames[id]}
          </li>
        ))}
        <li><span className="pf-xs-dot" aria-hidden="true" />{S.saved}</li>
      </ol>
      {total > 1 && (
        <ul className="pf-xs-jobs">
          {s.jobs.map((j) => <li key={j.id}><span dir="auto">{j.label}</span><Badge tone={j.status === 'succeeded' ? 'ok' : isActiveJob(j.status) && j.stage ? 'frame' : 'neutral'}>{j.status === 'succeeded' ? '✓' : jobFraction(j) != null ? `${Math.round((jobFraction(j) ?? 0) * 100)}%` : S.queued}</Badge></li>)}
        </ul>
      )}
      <div className="pf-xs-run-actions">
        <Button variant="danger-quiet" size="lg" onClick={cancel} disabled={canceling} data-testid="export-cancel">{canceling ? S.canceling : S.cancelExport}</Button>
        <Button variant="secondary" size="lg" onClick={closeExportSheet} data-testid="export-background">{S.keepEditing}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- done / failed
function Done({ editor, S }: { editor: Editor; S: ExportStrings }) {
  const s = useSheet();
  const { state } = useEditorState();
  const ok = s.jobs.filter((j) => j.status === 'succeeded');
  const bad = s.jobs.filter((j) => j.status !== 'succeeded');
  const retry = async (j: SheetJob) => {
    try {
      const r = await api.retryJob(j.id);
      editor.trackExport(r.jobId);
      setSheet({ jobs: sheet.jobs.map((x) => (x.id === j.id ? { ...x, id: r.jobId, status: 'queued', stage: null, output: null, error: null } : x)) });
    } catch (e) { editor.fail(e); }
  };
  return (
    <div className="pf-xs-done" data-testid="export-done" data-lang={state.lang}>
      <h3 className="pf-xs-run-title">{ok.length === 0 ? (bad.every((j) => j.status === 'canceled') ? S.canceledTitle : S.failedTitle) : ok.length === 1 ? S.doneTitle : S.doneMany(ok.length)}</h3>
      {ok.length > 0 && <span className="pf-xs-sr" role="status" data-testid="export-finished">{ok.length === 1 ? S.doneTitle : S.doneMany(ok.length)}</span>}
      {ok.map((j) => <FileCard key={j.id} j={j} S={S} editor={editor} />)}
      {bad.map((j) => {
        const body = (
          <>
            <TriangleAlert size={18} aria-hidden="true" />
            <div className="pf-xs-card-text">
              <b>{j.label} · {j.status === 'canceled' ? S.canceledTitle : S.failedTitle}</b>
              <span dir="auto">{j.status === 'canceled' ? S.canceledNote : `${j.error?.message ? (translateRefusal(state.lang, j.error.message) ?? j.error.message) + '. ' : ''}${S.failedFix}`}</span>
              <CacheFailure code={j.error?.code} lang={state.lang} />
            </div>
            {/* a fast export stopped by a privacy change cannot be retried (its snapshot shows what is now hidden): a new export instead */}
            {j.error?.code === 'render_cache_purged'
              ? <Button variant="secondary" size="sm" onClick={() => setSheet({ jobs: [] })} data-testid="export-new">{cacheText(state.lang, 'cache.failed.newExport')}</Button>
              : <Button variant="secondary" size="sm" onClick={() => void retry(j)} data-testid="export-retry">{S.retry}</Button>}
          </>
        );
        // the ids stay literal attributes (the test id inventory reads them from the source)
        return j.status === 'canceled'
          ? <div key={j.id} className="pf-xs-card is-bad" data-testid="export-canceled" role="alert">{body}</div>
          : <div key={j.id} className="pf-xs-card is-bad" data-testid="export-failed" role="alert">{body}</div>;
      })}
      <AlsoCard S={S} ok={ok} />
      <div className="pf-xs-run-actions">
        <Button variant="secondary" size="lg" onClick={closeExportSheet}>{S.backToEdit}</Button>
      </div>
    </div>
  );
}

/** After a finished export: the other shape of the video (vertical for a wide project, and the reverse), one press back to the settings with it chosen. */
function AlsoCard({ S, ok }: { S: ExportStrings; ok: SheetJob[] }) {
  const { state } = useEditorState();
  const doc = state.doc!;
  const lang = state.lang;
  const targets = useMemo(() => exportTargets(doc), [doc]);
  const next = ok.length > 0 ? alsoSuggestion(targets, new Set(ok.map((j) => j.variantId))) : null;
  if (!next) return null;
  const shape = next.name[lang].split(' ').slice(-1)[0] ?? '';
  const go = () => {
    setPick({ keys: [next.key], dest: next.height > next.width ? 'reels' : 'youtube' });
    setSheet({ jobs: [], error: null, blockers: [] });
  };
  return (
    <div className="pf-xs-card is-also" data-testid="export-also">
      <span className="pf-xs-card-thumb" aria-hidden="true"><FrameImg src={`/api/v1/projects/${doc.id}/frame?index=0${next.variantId ? `&variant=${encodeURIComponent(next.variantId)}` : ''}`} cover rev={state.revision} /></span>
      <div className="pf-xs-card-text"><b>{S.alsoTitle(shape)}</b><span>{next.kind === 'variant' ? S.alsoLinked : S.alsoNew}</span></div>
      <Button variant="primary" size="sm" onClick={go} data-testid="export-also-go">{S.alsoGo(shape)}</Button>
    </div>
  );
}

function FileCard({ j, S, editor }: { j: SheetJob; S: ExportStrings; editor: Editor }) {
  const { state } = useEditorState();
  const report = j.output?.photosensitivity as FlashReport | undefined;
  const bytes = typeof j.output?.bytes === 'number' ? j.output.bytes : null;
  const url = `/api/v1/jobs/${j.id}/output`;
  const frameSrc = `/api/v1/projects/${state.doc!.id}/frame?index=0${j.variantId ? `&variant=${encodeURIComponent(j.variantId)}` : ''}`;
  return (
    <>
      <div className="pf-xs-card" data-testid="export-file" data-job-id={j.id}>
        <span className="pf-xs-card-thumb" aria-hidden="true"><FrameImg src={frameSrc} rev={state.revision} /><Play size={16} fill="currentColor" /></span>
        <div className="pf-xs-card-text">
          <b dir="auto">{state.doc!.name} · {j.label}</b>
          <span><Badge tone="hollow" mono>{j.ext.toUpperCase()}</Badge> {bytes != null && <span className="num">{formatFileSize(bytes)}</span>} · <span className="num">{j.w}×{j.h}</span></span>
          <span className="pf-xs-ok"><Check size={14} aria-hidden="true" /> {S.checked}</span>
          {j.output?.segments && <CacheDoneLine report={j.output.segments} lang={state.lang} />}
        </div>
        <a className="pf-btn pf-btn-secondary pf-btn-md pf-ds" href={url} download data-testid="export-download"><Download size={16} aria-hidden="true" /><span className="pf-btn-label">{S.download}</span></a>
      </div>
      {report && <FlashResult report={report} S={S} editor={editor} />}
    </>
  );
}

interface FlashReport { verdict: 'pass' | 'fail'; ranges: { from: { value: string; timescale: number }; to: { value: string; timescale: number }; kind: 'general' | 'red'; flashesPerSecond: number; area: number }[] }
/** The photosensitivity result of a saved export (ADR-0009): a quiet pass, or the stretches with a jump to each. */
function FlashResult({ report, S, editor }: { report: FlashReport; S: ExportStrings; editor: Editor }) {
  const { state, t } = useEditorState();
  if (report.verdict === 'pass') {
    return <div className="pf-xs-card is-ok" role="status" data-testid="export-flash-pass" title={t('flash.passTitle')}><ShieldCheck size={18} aria-hidden="true" /><div className="pf-xs-card-text"><b>{S.flashPass}</b><span>{S.flashPassNote}</span></div></div>;
  }
  const rate = state.doc?.settings.frameRate;
  const sec = (x: { value: string; timescale: number }) => Number(x.value) / x.timescale;
  const clock = (v: number) => `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, '0')}`;
  return (
    <div className="pf-xs-card is-bad is-flash" data-testid="export-flash-fail" role="group" aria-label={S.flashFailTitle}>
      <TriangleAlert size={18} aria-hidden="true" />
      <div className="pf-xs-card-text">
        <b>{S.flashFailTitle} ({report.ranges.length})</b>
        <span>{t('flash.failIntro')}</span>
        <ul className="pf-xs-flash-list">
          {report.ranges.map((r, i) => (
            <li key={i} data-testid="export-flash-range">
              <bdi dir="ltr" className="num">{clock(sec(r.from))}–{clock(sec(r.to))}</bdi> · {t(r.kind === 'red' ? 'flash.red' : 'flash.general')} <span className="num">{r.flashesPerSecond}</span> {t('flash.perSecond')} · <span className="num">{Math.round(r.area * 100)}%</span> {t('flash.area')}
              {rate && <Button size="sm" variant="secondary" data-testid="export-flash-jump" onClick={() => { editor.seek(Math.floor((sec(r.from) * rate.num) / rate.den)); closeExportSheet(); }}>{S.jump}</Button>}
            </li>
          ))}
        </ul>
        <span className="pf-xs-note">{t('flash.method')}</span>
      </div>
    </div>
  );
}

