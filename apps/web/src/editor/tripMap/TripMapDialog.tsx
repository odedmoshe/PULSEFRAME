/**
 * «מפת טיול» — the dialog that makes or edits a trip map (wave 8 tripmap track, W3). Library.tsx opens it from «מפת טיול חדשה»
 * (TripMapEntry, mounted once TRIPMAP_UI_BUILT) and the inspector panel from «עריכת המפה». It holds (plan §3.8 as corrected by the
 * verifier): the stop list in travel order (name as typed, «הסתרת השם», remove, up/down; the travel mode chooser between rows), the search
 * field over the committed list (places.data.ts, loaded lazily; core searchPlaces; Enter adds the owner's typed text as the name and the
 * place's coordinates; no route, no tool), the picker (a canvas drawn by drawGraph with one map layer: the one compositor; click or keyboard
 * crosshair; views «ישראל והסביבה» / «כל העולם»), look, camera (one choice), length (frame-exact), «לפי התיבות של המוזיקה» (enabled when
 * musicAt finds music with bars at the clip's start in its own sequence, else the reason) and the honest lines. The logic is in
 * tripMap.logic.ts (pure, tested). Create commits ONE add_trip_map (with timing 'bars' when the box is ticked: one transaction, one
 * undo); Save commits trim_clip / update_trip_map / time_trip_map in ONE transaction.
 * Ids: TRIPMAP_TESTIDS. No focus is moved in a later task: focus goes to the picker and back in layout effects (an intent kept in a ref).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ArrowDown, ArrowUp, EyeOff, Map as MapIcon, X } from 'lucide-react';
import { translateRefusal } from '@pulseframe/i18n';
import { drawGraph, MAP_NOT_BUILT_WHY, type RenderGraph } from '@pulseframe/engine';
import { cameraAt, musicAt, MAP_MODES, MAX_MAP_STOPS, MAX_STOP_NAME, isMapPayload, type DrawnClip, type MapCamera, type MapLook, type MapMode, type PlaceHit, type PlaceRow } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import { Button, Dialog, Seg } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { TRIPMAP_TESTIDS as TID } from './tripMap.testids.ts';
import { tripMapT } from './tripMap.strings.ts';
import {
  barsState, createPlan, defaultFrames, degText, draftOf, draftProblems, framesOfSeconds, hitLabel, initialPicker, loadPlaces, moveStop, newStopId, PICKER_SIZE,
  pickerKey, pickerLayer, pickerPayload, pixelToPlace, placeToPixel, retimePlan, savePlan, secondsText, stopFromHit, stopFromPoint, suggestionsFor, type Draft, type OpCallLike, type PickerState, type PickerViewId,
} from './tripMap.logic.ts';
import './tripMap.css';

/** True once W3 has built the dialog, the panel and the entry against built ops and a built painter. */
export const TRIPMAP_UI_BUILT = true;

const LOOKS: readonly MapLook[] = ['paper', 'night'];
let stopCounter = 0;

export function TripMapDialog({ clip, onClose }: { clip?: DrawnClip; onClose: () => void }): ReactElement {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const t = tripMapT(lang);
  const doc = state.doc;
  const rate = doc?.settings.frameRate ?? { num: 30, den: 1 };
  const map = clip && isMapPayload(clip.drawn) ? clip.drawn : null;
  const seqId = state.activeSequenceId || undefined;
  const at = clip?.start ?? editor.playhead;

  const initial = useMemo<Draft>(() => {
    if (clip && map) return draftOf(map, T.frameIndexAt(clip.duration, rate), rate);
    return { stops: [], look: 'paper', seconds: secondsText(defaultFrames(2, rate), rate), bars: false };
    // the draft starts once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [draft, setDraft] = useState<Draft>(initial);
  const [lengthTouched, setLengthTouched] = useState(!!clip);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<readonly PlaceRow[] | 'loading' | 'failed'>('loading');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<PickerState | null>(null);
  const uid = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const focusIntent = useRef<'picker' | 'search' | null>(null);

  useEffect(() => {
    let on = true;
    loadPlaces().then((r) => { if (on) setRows(r); }, () => { if (on) setRows('failed'); });
    return () => { on = false; };
  }, []);

  // while the owner has not typed a length, it follows the number of stops (three seconds a leg)
  const stopsN = draft.stops.length;
  useEffect(() => {
    if (lengthTouched || clip) return;
    setDraft((d) => ({ ...d, seconds: secondsText(defaultFrames(Math.max(2, stopsN), rate), rate) }));
  }, [stopsN, lengthTouched, clip, rate.num, rate.den]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const want = focusIntent.current;
    if (!want) return;
    focusIntent.current = null;
    (want === 'picker' ? pickerRef.current : searchRef.current)?.focus();
  }, [picker !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const hits: PlaceHit[] = useMemo(() => (Array.isArray(rows) ? suggestionsFor(rows as readonly PlaceRow[], query) : []), [rows, query]);
  useEffect(() => { setActive(0); }, [query]);
  const problems = draftProblems(draft, rate);
  const music = doc && !picker ? musicAt(doc, at, clip ? seqId : seqId) : null;
  const bars = barsState(music);
  const frames = framesOfSeconds(draft.seconds, rate);

  const change = (f: (d: Draft) => Draft) => { setDraft(f); setError(''); };
  const addStop = (s: ReturnType<typeof stopFromPoint>) => { if (draft.stops.length >= MAX_MAP_STOPS) return; change((d) => ({ ...d, stops: [...d.stops, s] })); setQuery(''); };
  const nextId = () => newStopId(Date.now() % 100000 * 100 + (stopCounter++ % 100));
  const addHit = (h: PlaceHit) => addStop(stopFromHit(h, query.trim() === '' ? h.nameHe : query.trim(), nextId()));
  const openPicker = () => { focusIntent.current = 'picker'; setPicker(initialPicker('near')); };
  const closePicker = () => { focusIntent.current = 'search'; setPicker(null); };
  const place = () => {
    if (!picker) return;
    addStop(stopFromPoint(picker.lon, picker.lat, query.trim(), nextId()));
    closePicker();
  };

  const searchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (query.trim() === '') return;
      const h = hits[active];
      if (h) addHit(h); else openPicker();
    }
  };

  /** One transaction against the revision shown; a refusal is worded in Hebrew with its next step. Returns the result or null. */
  const run = async (ops: OpCallLike[], label: string) => {
    const r = await editor.commitExact(ops, label, state.revision, `trip:${crypto.randomUUID()}`);
    if (r.kind === 'committed') return r.result;
    if (r.kind === 'stale') setError(t('staleRetry'));
    else setError([translateRefusal(lang, r.message) ?? r.message, r.hint && lang === 'en' ? r.hint : ''].filter(Boolean).join(' '));
    return null;
  };
  const submit = async () => {
    if (busy || problems.length || !doc) return;
    setBusy(true); setError('');
    try {
      if (clip && map) {
        const ops = savePlan(clip, draftOf(map, T.frameIndexAt(clip.duration, rate), rate), draft, rate);
        if (!ops) { onClose(); return; }
        if (await run(ops, 'Edit trip map')) onClose();
        return;
      }
      const plan = createPlan(draft.bars && !bars.ok ? { ...draft, bars: false } : draft, rate, at, seqId);
      if (!plan) return;
      const r = await run(plan, 'Add trip map');
      if (!r) return;
      const id = (r.results[0]?.output as { clipId?: string } | undefined)?.clipId;
      if (id) editor.select(id);
      onClose();
    } finally { setBusy(false); }
  };
  const retime = async () => {
    if (!clip || busy) return;
    setBusy(true);
    try { if (await run(retimePlan(clip.id), 'Time trip map')) onClose(); } finally { setBusy(false); }
  };

  const problemText = (p: ReturnType<typeof draftProblems>[number]): string => {
    switch (p.code) {
      case 'needStops': return t('needStops');
      case 'needName': return t('needName', { n: p.n });
      case 'needShown': return t('needShown');
      case 'tooShort': return t('tooShort', { n: p.stops, min: p.minSeconds });
      case 'samePlace': return lang === 'he' ? `עצירות ${p.n - 1} ו־${p.n} באותו מקום. הסירו אחת מהן או הזיזו אותה` : `Stops ${p.n - 1} and ${p.n} are at the same place. Remove one or move it`;
      case 'badLength': return lang === 'he' ? 'האורך צריך להיות מספר חיובי של שניות' : 'The length must be a positive number of seconds';
    }
  };
  const timedName = map?.timedTo ? doc?.assets[map.timedTo.assetId]?.name ?? '' : '';

  return (
    <Dialog open onClose={onClose} title={t('title')} size="lg" testId={TID.dialog} closeLabel={t('close')} className="pf-trip"
      footer={<>
        <Button variant="secondary" onClick={onClose} data-testid={TID.cancel}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy || problems.length > 0 || !doc} onClick={() => void submit()} data-testid={TID.create}>{busy ? t('working') : clip ? t('save') : t('create')}</Button>
      </>}>
      <div className="pf-trip-body" data-mode={clip ? 'edit' : 'create'} data-testid={`${TID.dialog}-body`}
        ref={(el) => { el?.closest('[role=dialog]')?.setAttribute('data-mode', clip ? 'edit' : 'create'); }}>
        {/* ---- search ---- */}
        <section aria-labelledby={`${uid}-add`}>
          <label id={`${uid}-add`} htmlFor={`${uid}-q`} className="pf-trip-h">{t('searchLabel')}</label>
          <div className="pf-trip-search">
            <input id={`${uid}-q`} ref={searchRef} className="pf-trip-input" type="text" role="combobox" aria-expanded={hits.length > 0} aria-controls={`${uid}-list`} aria-autocomplete="list"
              aria-activedescendant={hits[active] ? `${uid}-o${hits[active]!.placeId}` : undefined} placeholder={t('search')} value={query} maxLength={MAX_STOP_NAME}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={searchKey} disabled={draft.stops.length >= MAX_MAP_STOPS} data-testid={TID.search} />
            <ul id={`${uid}-list`} role="listbox" className="pf-trip-list" hidden={hits.length === 0} aria-label={t('searchLabel')} data-testid={TID.suggestions}>
              {hits.map((h, i) => (
                <li key={h.placeId} id={`${uid}-o${h.placeId}`} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''} data-place-id={h.placeId} data-testid={TID.suggestion}
                  onMouseDown={(e) => { e.preventDefault(); addHit(h); }}>{hitLabel(h)}</li>
              ))}
            </ul>
          </div>
          {rows === 'loading' && <p className="muted pf-trip-note">{t('listLoading')}</p>}
          {rows === 'failed' && <p className="muted pf-trip-note">{t('listFailed')}</p>}
          {query.trim() !== '' && hits.length === 0 && rows !== 'loading' && (
            <p className="pf-trip-note" data-testid={TID.notInList}>{t('notInList')}</p>
          )}
          <Button variant="secondary" size="sm" onClick={openPicker} disabled={draft.stops.length >= MAX_MAP_STOPS}>{t('pickButton')}</Button>
        </section>

        {picker && <Picker st={picker} look={draft.look} lang={lang} rate={rate} onState={setPicker} onPlace={place} onCancel={closePicker} boxRef={pickerRef} />}

        {/* ---- stops ---- */}
        <section aria-labelledby={`${uid}-stops`}>
          <h3 id={`${uid}-stops`} className="pf-trip-h">{t('stops')}</h3>
          {draft.stops.length === 0 && <p className="muted pf-trip-note">{t('stopsEmpty')}</p>}
          <ol className="pf-trip-stops" data-testid={TID.stops}>
            {draft.stops.map((s, i) => (
              <li key={s.id} className="pf-trip-stopitem">
                {i > 0 && (
                  <div className="pf-trip-mode" data-testid={TID.mode} data-leg={i}>
                    <Seg size="sm" label={t('legMode', { name: draft.stops[i]!.name || t('stop', { n: i + 1 }) })} value={s.via}
                      options={MAP_MODES.map((m) => ({ value: m, label: t(`mode.${m}`) }))} onChange={(v: MapMode) => change((d) => ({ ...d, stops: d.stops.map((x, j) => (j === i ? { ...x, via: v } : x)) }))} />
                  </div>
                )}
                <div className="pf-trip-row" data-testid={TID.stopRow} data-index={i} data-stop-id={s.id}>
                  <span className="pf-trip-n num">{i + 1}</span>
                  <input className="pf-trip-input" type="text" value={s.name} maxLength={MAX_STOP_NAME} aria-label={`${t('stopName')} ${i + 1}`} aria-invalid={!s.hidden && s.name.trim() === ''}
                    onChange={(e) => change((d) => ({ ...d, stops: d.stops.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} data-testid={TID.stopName} />
                  <button type="button" className="pf-trip-ib" aria-pressed={s.hidden} title={t('hideName')} aria-label={t('hideName')} data-testid={TID.stopHide}
                    onClick={() => change((d) => ({ ...d, stops: d.stops.map((x, j) => (j === i ? { ...x, hidden: !x.hidden } : x)) }))}><EyeOff size={16} aria-hidden="true" /></button>
                  <button type="button" className="pf-trip-ib" aria-label={t('up')} title={t('up')} disabled={i === 0} data-testid={TID.stopUp} onClick={() => change((d) => ({ ...d, stops: moveStop(d.stops, i, -1) }))}><ArrowUp size={16} aria-hidden="true" /></button>
                  <button type="button" className="pf-trip-ib" aria-label={t('down')} title={t('down')} disabled={i === draft.stops.length - 1} data-testid={TID.stopDown} onClick={() => change((d) => ({ ...d, stops: moveStop(d.stops, i, 1) }))}><ArrowDown size={16} aria-hidden="true" /></button>
                  <button type="button" className="pf-trip-ib" aria-label={t('remove')} title={t('remove')} data-testid={TID.stopRemove} onClick={() => change((d) => ({ ...d, stops: d.stops.filter((_, j) => j !== i) }))}><X size={16} aria-hidden="true" /></button>
                  <span className="muted pf-trip-xy"><bdi dir="ltr">{degText(s.lat)}, {degText(s.lon)}</bdi>{s.hidden ? ` · ${t('hiddenName')}` : ''}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- look, camera, length, timing ---- */}
        <section className="pf-trip-opts">
          <div data-testid={TID.look}><span className="pf-trip-h">{t('look')}</span>
            <Seg size="sm" label={t('look')} value={draft.look} options={LOOKS.map((l) => ({ value: l, label: t(`look.${l}`) }))} onChange={(v: MapLook) => change((d) => ({ ...d, look: v }))} /></div>
          <div data-testid={TID.camera}><span className="pf-trip-h">{t('camera')}</span>
            <Seg size="sm" label={t('camera')} value="whole" options={[{ value: 'whole', label: t('camera.whole') }]} onChange={() => undefined} /></div>
          <div className="pf-trip-len"><label htmlFor={`${uid}-len`} className="pf-trip-h">{t('length')} ({t('seconds')})</label>
            <input id={`${uid}-len`} className="pf-trip-input pf-trip-short" inputMode="decimal" dir="ltr" value={draft.seconds} aria-invalid={frames === null} data-testid={TID.length}
              onChange={(e) => { setLengthTouched(true); change((d) => ({ ...d, seconds: e.target.value })); }} />
            {frames !== null && <span className="muted"> <bdi dir="ltr">{t('lengthFrames', { frames })}</bdi></span>}
          </div>
          <div>
            <label className="pf-trip-check"><input type="checkbox" checked={draft.bars && bars.ok} disabled={!bars.ok} aria-describedby={bars.ok ? undefined : `${uid}-br`} data-testid={TID.bars}
              onChange={(e) => change((d) => ({ ...d, bars: e.target.checked }))} /> {t('bars')}</label>
            {!bars.ok && <p className="muted pf-trip-note" id={`${uid}-br`} data-testid={TID.barsReason}>{t(bars.reason)}</p>}
            {draft.bars && bars.ok && <p className="muted pf-trip-note">{t('snapped')}</p>}
            {clip && map?.timing === 'bars' && map.timedTo && (
              <p className="pf-trip-note"><span data-testid={TID.timedTo}>{t('timedTo', { name: timedName })}</span>{' '}
                <Button variant="secondary" size="sm" onClick={() => void retime()} disabled={busy || !bars.ok} data-testid={TID.retime}>{t('retime')}</Button></p>
            )}
          </div>
        </section>

        {problems.length > 0 && <ul className="pf-trip-problems" aria-label={t('title')}>{problems.map((p, i) => <li key={i} className="muted">{problemText(p)}</li>)}</ul>}
        {error && <p role="alert" className="pf-trip-error">{error}</p>}

        {/* ---- honest lines ---- */}
        <div className="pf-trip-honest">
          {(['unseen', 'coastsOnly', 'roadStraight', 'agents', 'listSource'] as const).map((c) => <p key={c} className="muted" data-testid={TID.honest} data-code={c}>{t(c)}</p>)}
        </div>
      </div>
    </Dialog>
  );
}

/** The picker: one map layer through drawGraph (the one compositor), a keyboard crosshair over it and the two views. */
function Picker({ st, look, lang, rate, onState, onPlace, onCancel, boxRef }: {
  st: PickerState; look: MapLook; lang: 'he' | 'en'; rate: T.Rate; onState: (s: PickerState) => void; onPlace: () => void; onCancel: () => void; boxRef: React.RefObject<HTMLDivElement | null>;
}): ReactElement {
  const t = tripMapT(lang);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState('');
  const payload = useMemo(() => pickerPayload(st, look), [st.view, st.zoom, st.zoom === 0 ? 0 : st.lon, st.zoom === 0 ? 0 : st.lat, look]); // eslint-disable-line react-hooks/exhaustive-deps
  const cam = useMemo<MapCamera | null>(() => { try { return cameraAt(payload, -1, PICKER_SIZE); } catch { return null; } }, [payload]);
  useEffect(() => {
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let on = true;
    const g: RenderGraph = { time: T.frameTime(0, rate), frameIndex: 0, width: PICKER_SIZE.width, height: PICKER_SIZE.height, background: '#000000', fit: 'contain', layers: [pickerLayer(payload, rate)], audio: [] };
    drawGraph(ctx as never, g, async () => null).then((r) => {
      if (!on) return;
      const why = r.unavailableReasons?.['drawn.map'] ?? (r.unavailableEffects.includes('drawn.map') ? MAP_NOT_BUILT_WHY : '');
      setNote(why);
    }, (e: unknown) => { if (on) setNote(String((e as Error)?.message ?? e).slice(0, 160)); });
    return () => { on = false; };
  }, [payload, rate]);
  const pos = cam ? placeToPixel(cam, PICKER_SIZE, st.lon, st.lat) : null;
  const onKey = (e: React.KeyboardEvent) => {
    const k = pickerKey(st, e.key, e.shiftKey);
    if (!k) return;
    e.preventDefault(); e.stopPropagation(); // Escape cancels the picker only, not the dialog
    if (k.kind === 'move' || k.kind === 'zoom') onState(k.state);
    else if (k.kind === 'place') onPlace();
    else onCancel();
  };
  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!cam) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = pixelToPlace(cam, PICKER_SIZE, ((e.clientX - r.left) / r.width) * PICKER_SIZE.width, ((e.clientY - r.top) / r.height) * PICKER_SIZE.height);
    onState({ ...st, ...p });
  };
  const zoom = (k: '+' | '-') => { const r = pickerKey(st, k, false); if (r && r.kind === 'zoom') onState(r.state); };
  const view = (v: PickerViewId) => onState({ ...initialPicker(v) });
  return (
    <section className="pf-trip-picker" aria-label={t('pickOnMap')}>
      <h3 className="pf-trip-h">{t('pickOnMap')}</h3>
      <div ref={boxRef} tabIndex={0} role="application" aria-label={t('pickOnMap')} aria-describedby="pf-trip-pickhelp" className="pf-trip-pick" onKeyDown={onKey} data-testid={TID.picker}>
        <canvas ref={canvas} width={PICKER_SIZE.width} height={PICKER_SIZE.height} className="pf-trip-canvas" aria-hidden="true" onClick={click} />
        <div className="pf-trip-cross" data-testid={TID.crosshair} data-lon={st.lon} data-lat={st.lat} aria-hidden="true"
          style={pos ? { left: `${(pos.x / PICKER_SIZE.width) * 100}%`, top: `${(pos.y / PICKER_SIZE.height) * 100}%` } : { display: 'none' }} />
      </div>
      <p id="pf-trip-pickhelp" className="muted pf-trip-note">{t('pickHelp')}</p>
      <p className="pf-trip-note" aria-live="off">{t('crosshairAt', { lat: degText(st.lat), lon: degText(st.lon) }).split(/(\-?\d+\.\d+)/).map((part, i) => (/^-?\d+\.\d+$/.test(part) ? <bdi key={i} dir="ltr">{part}</bdi> : part))}</p>
      {note && <p className="muted pf-trip-note" data-testid={`${TID.picker}-note`}>{t('pickNotDrawn', { why: note })}</p>}
      {!cam && <p className="muted pf-trip-note">{t('pickNoClick')}</p>}
      <div className="pf-trip-pickbar">
        <Seg size="sm" label={t('view')} value={st.view} options={[{ value: 'near', label: t('viewNear'), testId: TID.viewNear }, { value: 'world', label: t('viewWorld'), testId: TID.viewWorld }]} onChange={view} />
        <Button variant="secondary" size="sm" onClick={() => zoom('-')}>{t('zoomOut')}</Button>
        <Button variant="secondary" size="sm" onClick={() => zoom('+')}>{t('zoomIn')}</Button>
        <Button variant="primary" size="sm" onClick={onPlace}>{t('place')}</Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>{t('pickCancel')}</Button>
      </div>
    </section>
  );
}

/**
 * The entry in the Text pane (Library.tsx mounts it only once TRIPMAP_UI_BUILT): the secondary button «מפת טיול חדשה»
 * (TRIPMAP_TESTIDS.newButton) after «הוספת טקסט», which opens TripMapDialog at the playhead.
 */
export function TripMapEntry(): ReactElement {
  const { state } = useEditorState();
  const [open, setOpen] = useState(false);
  const t = tripMapT(state.lang);
  return (
    <>
      <Button variant="secondary" size="md" icon={<MapIcon size={16} aria-hidden="true" />} disabled={!state.doc} onClick={() => setOpen(true)} data-testid={TID.newButton}>{t('new')}</Button>
      {open && <TripMapDialog onClose={() => setOpen(false)} />}
    </>
  );
}
