/**
 * The export sheet (UX_REDESIGN §4.12, owner decision: export always opens it). A real modal dialog in three steps:
 * settings (destination, formats, size, quality, captions, the checks before export), progress (a real progressbar and the
 * stages the server reports), and done / failed (file cards, the photosensitivity result with jump-to, retry).
 *
 * Whatever is shown comes from the server: stages and frame counts from the job, sizes from the export plan, the flash
 * result from the saved file. No time estimate is shown because none is measured. Exports are started through the same REST
 * routes as every other client; a format that is not linked yet is linked first with the registered `add_variant` op.
 *
 * Opening: `openExportSheet()` (the top bar's Export button and the palette call it). `<ExportSheetHost/>` renders the dialog;
 * mount it once (several hosts are safe: only the first mounted one renders).
 */
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Download, MessageCircle, MonitorPlay, Play, ShieldCheck, SlidersHorizontal, Smartphone, HardDriveDownload, TriangleAlert, Upload } from 'lucide-react';
import { Badge, Button, Dialog, ProgressBar } from '../ds/index.ts';
import { isolate } from '../ds/util.tsx';
import { translateRefusal } from '@pulseframe/i18n';
import * as T from '@pulseframe/time';
import { api, ApiFailure, type PreflightIssue, type PreflightReport } from '../api.ts';
import { useEditorState, type Editor } from './store.ts';
import { EXPORT_STRINGS, type ExportStrings } from './exportSheet.strings.ts';
import {
  DEFAULT_CHOICES, DESTINATIONS, destinationKey, exportOptions, exportTargets, formatFileSize, formatLength, fourKReachable, isActiveJob, jobFraction, overallFraction,
  parseStage, scaledSize, shortSideLabel, STAGE_ORDER, type Destination, type ExportCaptions, type ExportChoices, type ExportQuality, type ExportScale, type ExportTarget,
} from './exportSheet.logic.ts';
import './exportSheet.css';

// ---------------------------------------------------------------- the sheet's own small store (open state and the jobs it started)
export interface SheetJob { id: string; label: string; variantId: string | null; status: string; stage: string | null; output: any; error: any; ext: string; w: number; h: number }
interface SheetState { open: boolean; jobs: SheetJob[]; starting: boolean; error: string | null; blockers: { code: string; message: string }[] }
let sheet: SheetState = { open: false, jobs: [], starting: false, error: null, blockers: [] };
const listeners = new Set<() => void>();
const setSheet = (patch: Partial<SheetState>) => { sheet = { ...sheet, ...patch }; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const useSheet = () => useSyncExternalStore(subscribe, () => sheet);
/** Opens the export sheet. A finished or failed earlier run is cleared, so the sheet opens on its settings; a running one is shown. */
export function openExportSheet() {
  const running = sheet.jobs.some((j) => isActiveJob(j.status));
  setSheet({ open: true, error: null, blockers: [], ...(running ? {} : { jobs: [] }) });
}
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
    const tick = () => void Promise.all(sheet.jobs.map(async (j) => {
      if (!isActiveJob(j.status) && j.status !== 'queued') return j;
      try { const v = await api.job(j.id); return { ...j, status: v.status, stage: v.stage, output: v.output, error: v.error }; } catch { return j; }
    })).then((jobs) => setSheet({ jobs }));
    const h = window.setInterval(tick, 600);
    tick();
    return () => window.clearInterval(h);
  }, [primary, active]);
  if (!primary || !state.doc) return null;
  return <Sheet editor={editor} />;
}

function Sheet({ editor }: { editor: Editor }) {
  const s = useSheet();
  const { state } = useEditorState();
  const S: ExportStrings = EXPORT_STRINGS[state.lang];
  const phase: 'settings' | 'running' | 'done' = s.jobs.length === 0 ? 'settings' : s.jobs.some((j) => isActiveJob(j.status)) ? 'running' : 'done';
  const step = phase === 'settings' ? 0 : phase === 'running' ? 1 : 2;
  return (
    <Dialog open={s.open} onClose={closeExportSheet} title={S.title} closeLabel={S.close} size="lg" className="pf-xs" testId="export-sheet" dismissOnBackdrop={phase !== 'running'}
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
let pick: Pick = { keys: ['master'], choices: DEFAULT_CHOICES, dest: null };
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
              <button type="button" role="radio" aria-checked={p.choices.format === 'mp4-h264-aac'} className={p.choices.format === 'mp4-h264-aac' ? 'is-on' : ''} onClick={() => setChoice({ format: 'mp4-h264-aac' })}><span className="num">MP4</span></button>
              <button type="button" role="radio" aria-checked={p.choices.format === 'webm-vp9-opus'} className={p.choices.format === 'webm-vp9-opus' ? 'is-on' : ''} onClick={() => setChoice({ format: 'webm-vp9-opus' })}><span className="num">WebM</span></button>
            </div>
          </section>
        </div>

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
        {t.kind !== 'profile' ? <FrameImg src={src} cover={t.fit === 'cover'} rev={state.revision} /> : <i />}
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
        {lead.kind === 'profile' ? <p className="pf-xs-note">{S.willLink}</p> : <FrameImg src={src} cover={lead.fit === 'cover'} rev={revision} />}
        {safe && <span className="pf-xs-zone" aria-hidden="true" style={{ insetBlockStart: 0, insetInline: 0, blockSize: `${safe.top * 100}%` }} />}
        {safe && <span className="pf-xs-zone" aria-hidden="true" style={{ insetBlockEnd: 0, insetInline: 0, blockSize: `${safe.bottom * 100}%` }} />}
      </div>
      <dl className="pf-xs-facts">
        <div><dt>{S.length}</dt><dd className="num">{formatLength(sec)}</dd></div>
        <div><dt>{lang === 'he' ? 'גודל תמונה' : 'Picture size'}</dt><dd className="num">{out.width}×{out.height}</dd></div>
        {bytes != null && <div><dt>{S.size}</dt><dd><span className="num">≈ {formatFileSize(bytes)}</span> <small>{S.sizeNote}</small></dd></div>}
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
              {i.fix && <Button size="sm" variant="secondary" onClick={() => void fix(i)}>{fixLabel || i.fix.label}</Button>}
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
      const jobs: SheetJob[] = [];
      for (const c of chosen) {
        const variantId = c.kind === 'master' ? null : c.kind === 'variant' ? c.variantId : made.get(c.key) ?? null;
        const out = scaledSize(c, p.choices.scale);
        const r = await api.startExport(doc.id, exportOptions(p.choices, variantId) as { variantId?: string });
        // the editor saves a file it started when it is ready (store.ts); a job started here is registered the same way
        (editor as unknown as { myExports?: Set<string> }).myExports?.add(r.jobId);
        jobs.push({ id: r.jobId, label: c.name[lang], variantId, status: 'queued', stage: null, output: null, error: null, ext: p.choices.format === 'webm-vp9-opus' ? 'webm' : 'mp4', w: out.width, h: out.height });
        setSheet({ jobs: [...jobs], starting: false });
      }
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
          <b>{st.id ? S.stageNames[st.id] : S.starting}</b>
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
      (editor as unknown as { myExports?: Set<string> }).myExports?.add(r.jobId);
      setSheet({ jobs: sheet.jobs.map((x) => (x.id === j.id ? { ...x, id: r.jobId, status: 'queued', stage: null, output: null, error: null } : x)) });
    } catch (e) { editor.fail(e); }
  };
  return (
    <div className="pf-xs-done" data-testid="export-done" data-lang={state.lang}>
      <h3 className="pf-xs-run-title">{ok.length === 0 ? (bad.every((j) => j.status === 'canceled') ? S.canceledTitle : S.failedTitle) : ok.length === 1 ? S.doneTitle : S.doneMany(ok.length)}</h3>
      {ok.length > 0 && <span className="pf-xs-sr" role="status" data-testid="export-finished">{ok.length === 1 ? S.doneTitle : S.doneMany(ok.length)}</span>}
      {ok.map((j) => <FileCard key={j.id} j={j} S={S} editor={editor} />)}
      {bad.map((j) => (
        <div key={j.id} className="pf-xs-card is-bad" data-testid={j.status === 'canceled' ? 'export-canceled' : 'export-failed'} role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div className="pf-xs-card-text">
            <b>{j.label} · {j.status === 'canceled' ? S.canceledTitle : S.failedTitle}</b>
            <span dir="auto">{j.status === 'canceled' ? S.canceledNote : `${j.error?.message ? (translateRefusal(state.lang, j.error.message) ?? j.error.message) + '. ' : ''}${S.failedFix}`}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void retry(j)} data-testid="export-retry">{S.retry}</Button>
        </div>
      ))}
      <div className="pf-xs-run-actions">
        <Button variant="secondary" size="lg" onClick={closeExportSheet}>{S.backToEdit}</Button>
      </div>
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
    return <div className="pf-xs-card is-ok" role="status" data-testid="flash-pass" title={t('flash.passTitle')}><ShieldCheck size={18} aria-hidden="true" /><div className="pf-xs-card-text"><b>{S.flashPass}</b><span>{S.flashPassNote}</span></div></div>;
  }
  const rate = state.doc?.settings.frameRate;
  const sec = (x: { value: string; timescale: number }) => Number(x.value) / x.timescale;
  const clock = (v: number) => `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, '0')}`;
  return (
    <div className="pf-xs-card is-bad is-flash" data-testid="flash-fail" role="group" aria-label={S.flashFailTitle}>
      <TriangleAlert size={18} aria-hidden="true" />
      <div className="pf-xs-card-text">
        <b>{S.flashFailTitle} ({report.ranges.length})</b>
        <span>{t('flash.failIntro')}</span>
        <ul className="pf-xs-flash-list">
          {report.ranges.map((r, i) => (
            <li key={i} data-testid="flash-range">
              <bdi dir="ltr" className="num">{clock(sec(r.from))}–{clock(sec(r.to))}</bdi> · {t(r.kind === 'red' ? 'flash.red' : 'flash.general')} <span className="num">{r.flashesPerSecond}</span> {t('flash.perSecond')} · <span className="num">{Math.round(r.area * 100)}%</span> {t('flash.area')}
              {rate && <Button size="sm" variant="secondary" data-testid="flash-jump" onClick={() => { editor.seek(Math.floor((sec(r.from) * rate.num) / rate.den)); closeExportSheet(); }}>{S.jump}</Button>}
            </li>
          ))}
        </ul>
        <span className="pf-xs-note">{t('flash.method')}</span>
      </div>
    </div>
  );
}

