/**
 * «חיפוש בצילומים» — the results under the media drawer's search box (wave 7 search track; .artifacts/wave7/search-decisions.md).
 * Mounted by Library.tsx while the query is not empty (view 'all' only).
 *
 * Two sections. «נמצא בשם, בתאריך ובתמלול»: core searchFootage in this browser on the whole document (`state.rawDoc`), debounced 150 ms;
 * the reader is the owner's only after the owner's own session was confirmed by the index route (otherwise 'agent': no pearl name and no
 * tag is read, so none can be shown). «לפי מה שרואים בתמונה»: POST …/search with `picture: true` on Enter (or its button), owner only;
 * rows are ordered with no number and every one carries the model label. Above the picture rows the status line says honestly where
 * the picture part stands (ready, not installed with the reason and the next step, not scanned, partly scanned, stale, busy with
 * progress and «עצור», owner only, not built), with «סרוק עכשיו» and «מחק את מפתח החיפוש בתמונה» (a confirmation that says what is
 * deleted). A route that answers 501 is the "not available yet" state, never a made-up result.
 *
 * There is no control that takes a picture, a frame or a moment as a query: a text box and nothing else. Nothing here recognises, groups
 * or names a person; a pearl's name or a tag appears only on a moment the owner's own reader found it on.
 * A row: sprite tile, name (dir="auto"), time range in <bdi dir="ltr">, source chips; «הצג» (video only: the source viewer on the exact
 * span), «הוסף בסוף», «הכנס במקום הסמן» (placement.range.ts placementOps, ONE editor.commit = one undo).
 * Keyboard: ArrowDown from the box into the list, ArrowUp/Down/Home/End between rows, Enter «הצג», Shift+Enter «הכנס במקום הסמן»,
 * Escape back to the box. Ids: SEARCH_TESTIDS. Words: search.strings.ts and i18n `footage.*`. Logical CSS only (RTL).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from 'react';
import { Eye, Film as FilmIcon, Plus, ScanSearch, Square, Trash2 } from 'lucide-react';
import * as T from '@pulseframe/time';
import { FootageSearchNotBuilt, FOOTAGE_LIMITS, placeRangeArgs, searchFootage, type FootageAnswer, type Moment, type SourceRange, type SourceSpan } from '@pulseframe/core';
import { translateRefusal } from '@pulseframe/i18n';
import { api } from '../../api.ts';
import { Badge, Button, Dialog } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { addedClipDuration, addAssetArgs } from '../placement.ts';
import { placementLabel, placementOps } from '../placement.range.ts';
import { commitWords } from '../pearls/pearls.commit.ts';
import { PearlThumb } from '../pearls/PearlThumb.tsx';
import { SourceViewer } from '../SourceViewer.tsx';
import { useEditorState } from '../store.ts';
import { failureOf, searchApi } from './search.client.ts';
import { canForget, canScan, liveKey, ownerOf, pictureLineOf, pictureMomentsOf, rowsOf, scanIsBusy, sectionState, setupReasonKey, sizeText, sourcesOf, spanText, timeAttr, type IndexView, type Row } from './search.logic.ts';
import { footageT } from './search.strings.ts';
import { SEARCH_TESTIDS as ID } from './search.testids.ts';
import '../pearls/pearls.css';
import './search.css';
import { focusNow } from '../../ds/focus.ts';
import { NotesSection, UNDERSTAND_UI_BUILT } from '../understand/ShotNotes.tsx';

/** True once the results are built (Library.tsx mounts them regardless; until then they render nothing). */
export const FOOTAGE_UI_BUILT = true;

const DEBOUNCE_MS = 150;
const POLL_MS = 1500;

interface Asked { q: string; answer: FootageAnswer | null; failure: { status: number; code: string; message: string } | null; busy: boolean }
interface Progress { done: number; total: number }
interface Viewing { assetId: string; span: SourceSpan | null; key: string }

/** `box`: the media drawer's search box (Library.tsx), on which Enter and ArrowDown are heard and to which focus returns. */
export function FootageResults({ query, onView, box }: { query: string; onView: (assetId: string) => void; box: RefObject<HTMLInputElement | null> }): ReactElement | null {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const F = footageT(lang);
  const rawDoc = state.rawDoc;
  const pid = state.doc?.id ?? null;
  const qNow = query.trim();
  const listRef = useRef<HTMLDivElement>(null);

  // ---- the query, debounced for the part that runs in this browser
  const [q, setQ] = useState(qNow);
  useEffect(() => { const h = setTimeout(() => setQ(qNow), DEBOUNCE_MS); return () => clearTimeout(h); }, [qNow]);

  // ---- the picture part's index: setup, what is scanned, the open job (owner only)
  const [index, setIndex] = useState<IndexView>({ status: null, failure: null });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'scan' | 'stop' | 'forget' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const words = useCallback((e: unknown) => { const f = failureOf(e); return translateRefusal(lang, f.message) ?? f.message; }, [lang]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!pid) return;
    try {
      const status = await searchApi.status(pid, signal);
      if (signal?.aborted) return;
      setIndex({ status, failure: null });
      const job = status.job;
      if (job && scanIsBusy(job.status)) {
        try {
          const j = await api.job(job.jobId);
          const p = (j.output as { progress?: { done?: number; total?: number } } | null)?.progress;
          if (!signal?.aborted && p && typeof p.done === 'number' && typeof p.total === 'number') setProgress({ done: p.done, total: p.total });
        } catch { /* the progress line waits for the next poll */ }
      } else if (!signal?.aborted) setProgress(null);
    } catch (e) {
      if (signal?.aborted) return;
      const f = failureOf(e);
      setIndex({ status: null, failure: { status: f.status, code: f.code } });
    }
  }, [pid]);
  useEffect(() => { const c = new AbortController(); void refresh(c.signal); return () => c.abort(); }, [refresh]);
  const line = pictureLineOf(index);
  const owner = ownerOf(index);
  const busy = line === 'busy';
  useEffect(() => {
    if (!busy) return;
    const h = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(h);
  }, [busy, refresh]);

  // ---- the part found without a model, in this browser, on the whole document
  const exact = useMemo(() => {
    if (!rawDoc || !q) return { moments: [] as Moment[], notBuilt: false, error: null as string | null };
    try { return { moments: searchFootage(rawDoc, q, { reader: owner === true ? 'owner' : 'agent' }), notBuilt: false, error: null }; }
    catch (e) { return e instanceof FootageSearchNotBuilt ? { moments: [], notBuilt: true, error: null } : { moments: [], notBuilt: false, error: e instanceof Error ? e.message : String(e) }; }
  }, [rawDoc, q, owner]);
  const exactRows = useMemo(() => rowsOf(rawDoc, exact.moments, 'exact'), [rawDoc, exact.moments]);

  // ---- the part found in the pictures: asked on Enter, never on a keystroke
  const [asked, setAsked] = useState<Asked | null>(null);
  const abort = useRef<AbortController | null>(null);
  const askPicture = useCallback(async () => {
    if (!pid || !qNow) return;
    if (qNow.length > FOOTAGE_LIMITS.queryChars) { setProblem(F('footage.queryTooLong')); return; }
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    setProblem(null);
    setAsked({ q: qNow, answer: null, failure: null, busy: true });
    try {
      const answer = await searchApi.picture(pid, qNow, c.signal);
      if (!c.signal.aborted) setAsked({ q: qNow, answer, failure: null, busy: false });
    } catch (e) {
      if (!c.signal.aborted) setAsked({ q: qNow, answer: null, failure: failureOf(e), busy: false });
    }
  }, [pid, qNow, F]);
  useEffect(() => () => abort.current?.abort(), []);
  const askRef = useRef(askPicture);
  askRef.current = askPicture;
  const current = asked && asked.q === qNow ? asked : null;
  const pictureRows = useMemo(() => rowsOf(rawDoc, pictureMomentsOf(current?.answer ?? null), 'picture'), [rawDoc, current]);
  const answerState = current?.answer?.pictureState ?? null;

  // ---- the box: Enter asks the pictures, ArrowDown goes into the list
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void askRef.current(); }
      else if (e.key === 'ArrowDown') {
        const first = listRef.current?.querySelector<HTMLElement>(`[data-testid="${ID.row}"]`);
        if (first) { e.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [box]);

  // ---- the viewer and the placements
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  // the row is in the page while the viewer is open: the focus goes back to its button first, then the viewer closes, in one task
  const focusRowButton = (key: string) => focusNow(listRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"] [data-testid="${ID.rowView}"]`));
  const view = (r: Row) => {
    if (!r.canView) return;
    const m = r.moment;
    if (m.start && m.end) setViewing({ assetId: m.assetId, span: { start: m.start, end: m.end }, key: r.key });
    else onView(m.assetId);
  };
  const closeViewer = useCallback(() => { const k = viewing?.key; if (k) focusRowButton(k); setViewing(null); }, [viewing]);
  const place = async (r: Row, mode: 'add' | 'insert') => {
    if (!rawDoc) return;
    const doc = state.doc;
    const asset = Object.hasOwn(rawDoc.assets, r.moment.assetId) ? rawDoc.assets[r.moment.assetId] : undefined;
    if (!doc || !asset) return;
    setPlacing(`${mode}:${r.key}`); setProblem(null);
    try {
      const rate = editor.rate;
      const range: SourceRange = { id: 'footage-moment', assetId: asset.id, kind: 'pearl', span: r.moment.start && r.moment.end ? { start: r.moment.start, end: r.moment.end } : null, label: '', createdBy: 'user:local' };
      const a = placeRangeArgs(rawDoc, range, rate);
      const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
      const live = (id: string | null, kind: 'video' | 'audio') => (id && tracks.some((t) => t.id === id && t.kind === kind && !t.locked) ? id : undefined);
      const playhead = T.frameTime(editor.frame, rate);
      const where = addAssetArgs(doc, asset.id, { appendPoint: editor.appendPoint(), playhead, videoTarget: editor.target('video'), audioTarget: editor.target('audio') });
      const picture = !!asset.video || asset.kind === 'image';
      const trackId = mode === 'add' ? (where.trackId as string | undefined) : live(editor.target(picture ? 'video' : 'audio'), picture ? 'video' : 'audio');
      const audioTrackId = mode === 'add' ? (where.audioTrackId as string | undefined) : picture && asset.audio ? live(editor.target('audio'), 'audio') : undefined;
      const ops = placementOps({
        mode, assetId: asset.id, at: mode === 'add' ? (where.start as T.RationalTime) : playhead,
        range: 'sourceIn' in a ? { sourceIn: a.sourceIn, duration: a.duration } : null, ...('sourceIn' in a ? {} : { wholeDuration: addedClipDuration(asset, rate) }),
        ...(trackId ? { trackId } : {}), ...(audioTrackId ? { audioTrackId } : {}),
      });
      if (!ops.length) return;
      const c = await commitWords(editor, ops, placementLabel(mode), F('footage.notBuilt'));
      if (!c.ok) setProblem(c.message);
    } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); } finally { setPlacing(null); }
  };

  // ---- the scan, its stop, and forgetting
  const startScan = async () => {
    if (!pid) return;
    setBusyAction('scan'); setProblem(null); setNote(null);
    try { await searchApi.scan(pid); setNote(F('footage.startedScan')); await refresh(); }
    catch (e) { setProblem(words(e)); await refresh(); }
    finally { setBusyAction(null); }
  };
  const stopScan = async () => {
    const jobId = index.status?.job?.jobId;
    if (!jobId) return;
    setBusyAction('stop'); setProblem(null); setNote(F('footage.stopping'));
    try { await api.cancelJob(jobId); await refresh(); }
    catch (e) { setProblem(words(e)); setNote(null); }
    finally { setBusyAction(null); }
  };
  const forget = async () => {
    if (!pid) return;
    setBusyAction('forget'); setProblem(null); setNote(null);
    try {
      const r = await searchApi.forget(pid);
      setConfirming(false);
      setAsked(null);
      setNote(F('footage.forgetCount', { files: r.forgotten.files }));
      await refresh();
    } catch (e) { setProblem(words(e)); setConfirming(false); }
    finally { setBusyAction(null); }
  };
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) setNote(F('footage.scanStopped'));
    wasBusy.current = busy;
  }, [busy, F]);

  // ---- keyboard on the rows
  const rowEls = () => [...(listRef.current?.querySelectorAll<HTMLElement>(`[data-testid="${ID.row}"]`) ?? [])];
  const focusRow = (i: number) => { const els = rowEls(); els[Math.max(0, Math.min(i, els.length - 1))]?.focus(); };
  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, r: Row) => {
    const i = rowEls().indexOf(e.currentTarget);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) box.current?.focus(); else focusRow(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusRow(0); }
    else if (e.key === 'End') { e.preventDefault(); focusRow(rowEls().length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); box.current?.focus(); }
    else if (e.target !== e.currentTarget) return; // the keys below belong to the row, not to a button inside it
    else if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) void place(r, 'insert'); else view(r); }
  };
  const focusId = useRef<string | null>(null);

  if (!rawDoc || !pid) return null;

  // ---- what to say
  const total = exactRows.length + pictureRows.length;
  const dataState = exact.notBuilt ? 'not-built' : pictureRows.length ? 'picture' : exactRows.length ? 'exact' : 'empty';
  const exactSection = sectionState(true, exactRows.length);
  const pictureAsked = !!current && !current.busy && !current.failure && !!current.answer;
  const pictureSection = sectionState(pictureAsked && (answerState === 'ready' || answerState === 'busy' || answerState === 'partly_scanned' || answerState === 'stale'), pictureRows.length);
  const liveText = exact.notBuilt ? F('footage.notBuilt') : F(liveKey(total), { count: total });
  const files = index.status?.files;
  const lineText = (): string => {
    switch (line) {
      case 'not_built': return F('footage.notBuilt');
      case 'owner_only': return F('footage.ownerOnly');
      case 'not_installed': return `${F('footage.notInstalled')}. ${F(setupReasonKey(index.status?.setup))}`;
      case 'busy': return progress ? F('footage.scanning', { done: progress.done, total: progress.total }) : F('footage.scanning', { done: '…', total: '…' });
      case 'ready': return F('footage.ready', { files: files?.scanned ?? 0, of: files?.of ?? 0 });
      case 'partly_scanned': return F('footage.partlyScanned', { files: files?.scanned ?? 0, of: files?.of ?? 0 });
      case 'stale': return `${F('footage.stale')}. ${F('footage.staleDetail', { stale: files?.stale ?? 0, of: files?.of ?? 0 })}`;
      case 'not_scanned': return files && files.of === 0 ? F('footage.noVideos') : F('footage.notScanned');
      default: return F('footage.loading');
    }
  };
  const lineState = line ?? 'loading';
  const setup = index.status?.setup;
  const showScan = line === 'ready' || line === 'not_scanned' || line === 'partly_scanned' || line === 'stale' || line === 'busy';
  const mayAsk = line !== 'owner_only' && line !== 'not_built';
  const askFailure = current?.failure;
  const forgetFiles = (files?.scanned ?? 0) + (files?.stale ?? 0);
  const roving = focusId.current && [...exactRows, ...pictureRows].some((r) => r.key === focusId.current) ? focusId.current : [...exactRows, ...pictureRows][0]?.key ?? null;

  const renderRow = (r: Row): ReactElement => {
    const asset = Object.hasOwn(rawDoc.assets, r.moment.assetId) ? rawDoc.assets[r.moment.assetId] : undefined;
    const span = spanText(r.moment);
    const src = sourcesOf(r);
    const m = r.moment;
    return (
      <li key={r.key} className="pf-fs-row" tabIndex={r.key === roving ? 0 : -1} data-testid={ID.row} data-row-key={r.key} data-section={r.section}
        data-asset-id={m.assetId} data-start={timeAttr(m.start)} data-end={timeAttr(m.end)} data-sources={src.join(',')}
        aria-label={`${r.name}${span ? ` — ${span}` : ` — ${F('footage.wholeFile')}`}`}
        onFocus={(e) => { if (e.target === e.currentTarget) focusId.current = r.key; }} onKeyDown={(e) => onRowKey(e, r)}>
        {asset && <PearlThumb projectId={pid} asset={asset} span={m.start && m.end ? { start: m.start, end: m.end } : null} />}
        <div className="pf-fs-main">
          <b className="pf-fs-name" dir="auto">{r.name}</b>
          <span className="pf-fs-time">{span ? <bdi dir="ltr" className="num">{span}</bdi> : F('footage.wholeFile')}</span>
          {r.section === 'exact' && m.snippet && <span className="pf-fs-snippet" dir="auto">{isolate(m.snippet)}</span>}
          <span className="pf-fs-chips">{src.map((s) => <Badge key={s} tone={s === 'picture' ? 'hollow' : 'neutral'}>{F(`footage.src.${s}`)}</Badge>)}</span>
          {r.section === 'picture' && <span className="pf-fs-model">{F('footage.modelLabel')}</span>}
        </div>
        <div className="pf-fs-actions">
          {r.canView && <Button size="sm" variant="ghost" icon={<Eye size={14} aria-hidden="true" />} data-testid={ID.rowView} onClick={() => view(r)}>{F('footage.view')}</Button>}
          <Button size="sm" variant="ghost" icon={<Plus size={14} aria-hidden="true" />} data-testid={ID.rowAppend} busy={placing === `add:${r.key}`} onClick={() => void place(r, 'add')}>{F('footage.append')}</Button>
          <Button size="sm" variant="ghost" icon={<FilmIcon size={14} aria-hidden="true" />} data-testid={ID.rowInsert} busy={placing === `insert:${r.key}`} onClick={() => void place(r, 'insert')}>{F('footage.insert')}</Button>
        </div>
      </li>
    );
  };

  return (
    <section className="pf-fs pf-ds" aria-label={F('footage.title')} data-testid={ID.results} data-state={dataState}>
      <div className="pf-fs-live" role="status" aria-live="polite" data-testid={ID.live}>{liveText}</div>
      <p className="pf-fs-keys">{F('footage.textOnly')}. {F('footage.keys')}</p>
      {problem && <p className="pf-fs-problem" role="alert" data-testid="footage-problem">{isolate(problem)}</p>}
      <div ref={listRef} className="pf-fs-sections">
        <section className="pf-fs-section" aria-labelledby="pf-fs-h-exact" data-testid={ID.sectionExact}>
          <h4 id="pf-fs-h-exact">{F('footage.sectionExact')}</h4>
          {exact.notBuilt && <p className="pf-fs-note" role="status">{F('footage.notBuilt')}</p>}
          {exact.error && <p className="pf-fs-problem" role="alert">{isolate(exact.error)}</p>}
          {exactSection === 'rows' && <ul className="pf-fs-rows" aria-label={F('footage.listLabel')}>{exactRows.map(renderRow)}</ul>}
          {exactSection === 'empty' && !exact.notBuilt && !exact.error && <p className="pf-fs-empty" role="status" data-testid={ID.empty} data-section="exact">{F('footage.nothing')}</p>}
        </section>

        <section className="pf-fs-section" aria-labelledby="pf-fs-h-picture" data-testid={ID.sectionPicture}>
          <h4 id="pf-fs-h-picture">{F('footage.sectionPicture')} <Badge tone="attention">{F('footage.experimental')}</Badge></h4>
          <div className="pf-fs-status" role="group" aria-label={F('footage.status')} data-testid={ID.status} data-state={lineState} aria-busy={line === null || busy || undefined}>
            <p className="pf-fs-status-text">{lineText()}</p>
            {line === 'not_installed' && (
              <div className="pf-fs-setup" data-testid={ID.setup} data-code={setup?.code ?? ''}>
                <p>{F('footage.setupSteps')}</p>
                {setup?.missingBytes ? <p>{F('footage.missingBytes', { size: sizeText(setup.missingBytes) })}</p> : null}
                {setup?.detail ? <p className="pf-fs-detail">{F('footage.setupDetail')}: <bdi dir="ltr">{setup.detail}</bdi></p> : null}
              </div>
            )}
            {busy && progress && progress.total > 0 && <progress className="pf-fs-progress" max={progress.total} value={progress.done} aria-label={F('footage.scanning', { done: progress.done, total: progress.total })} />}
            {(showScan || canForget(index)) && (
              <div className="pf-fs-controls">
                {line === 'busy'
                  ? <Button size="sm" variant="secondary" icon={<Square size={14} aria-hidden="true" />} data-testid={ID.scanCancel} busy={busyAction === 'stop'} onClick={() => void stopScan()}>{F('footage.stop')}</Button>
                  : showScan && <Button size="sm" variant="secondary" icon={<ScanSearch size={14} aria-hidden="true" />} data-testid={ID.scan} busy={busyAction === 'scan'} {...(canScan(index) ? {} : { disabledReason: files && files.of === 0 ? F('footage.noVideos') : F('footage.ready', { files: files?.scanned ?? 0, of: files?.of ?? 0 }) })} onClick={() => void startScan()}>{F('footage.scan')}</Button>}
                {canForget(index) && <Button size="sm" variant="danger-quiet" icon={<Trash2 size={14} aria-hidden="true" />} data-testid={ID.forget} busy={busyAction === 'forget'} onClick={() => setConfirming(true)}>{F('footage.forget')}</Button>}
              </div>
            )}
            {showScan && <p className="pf-fs-fine">{F('footage.scanNote')}. {F('footage.scanTime')}</p>}
            {note && <p className="pf-fs-note" role="status">{note}</p>}
          </div>
          <p className="pf-fs-fine">{F('footage.pictureHint')}</p>
          {mayAsk && (
            <p className="pf-fs-ask">
              <Button size="sm" variant="ghost" icon={<ScanSearch size={14} aria-hidden="true" />} busy={!!current?.busy} onClick={() => void askPicture()}>{F('footage.pressEnter')}</Button>
            </p>
          )}
          {current?.busy && <p className="pf-fs-note" role="status">{F('footage.pictureSearching')}</p>}
          {askFailure && <p className="pf-fs-problem" role="alert" data-testid="footage-picture-failure">{isolate(askFailure.status === 501 ? F('footage.notBuilt') : translateRefusal(lang, askFailure.message) ?? askFailure.message)}</p>}
          {pictureAsked && (answerState === 'ready' || answerState === 'busy' || answerState === 'partly_scanned' || answerState === 'stale') && /[֐-׿]/.test(qNow) && !/[A-Za-z]/.test(qNow) && <p className="pf-fs-fine">{F('footage.hebrewAsTyped')}</p>}
          {pictureSection === 'rows' && <ul className="pf-fs-rows" aria-label={F('footage.listLabel')}>{pictureRows.map(renderRow)}</ul>}
          {pictureSection === 'empty' && <p className="pf-fs-empty" role="status" data-testid={ID.empty} data-section="picture">{F('footage.pictureNothing')}</p>}
          {pictureAsked && answerState && answerState !== 'ready' && answerState !== 'busy' && answerState !== 'partly_scanned' && answerState !== 'stale' && <p className="pf-fs-note" role="status">{answerState === 'not_installed' ? F('footage.notInstalled') : answerState === 'owner_only' ? F('footage.ownerOnly') : answerState === 'not_scanned' ? F('footage.notScanned') : F('footage.notBuilt')}</p>}
        </section>
        {/* «לפי מה שתואר» (wave 8 understand): the notes section, every credential; mounted only once built (W3) */}
        {UNDERSTAND_UI_BUILT && <NotesSection query={qNow} onView={onView} />}
      </div>
      {viewing && <SourceViewer assetId={viewing.assetId} startAt={viewing.span!.start} initialSpan={viewing.span!} onClose={closeViewer} />}
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={F('footage.forgetTitle')} size="sm" dismissOnBackdrop={false} closeLabel={F('footage.forgetCancel')} testId="footage-forget-dialog"
        footer={<>
          <Button variant="secondary" data-autofocus onClick={() => setConfirming(false)}>{F('footage.forgetCancel')}</Button>
          <Button variant="danger" busy={busyAction === 'forget'} data-testid="footage-forget-confirm" onClick={() => void forget()}>{F('footage.forgetDo')}</Button>
        </>}>
        <p>{F('footage.forgetConfirm')}</p>
        <p>{F('footage.forgetWhat', { files: forgetFiles, size: sizeText(index.status?.bytes ?? 0) })}</p>
      </Dialog>
    </section>
  );
}
