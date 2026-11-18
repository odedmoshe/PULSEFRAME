/**
 * The perform view (ADR-0025; the workspace `perform`, «הופעה»), mounted by Transport.tsx while that workspace is chosen. The
 * pad row, record / stop / accept / discard, the snap settings, the take lane, the tap calibration and the camera («צלם»).
 *
 * Nothing is committed while playing. A take is recorded as raw taps (capture.ts); the live picture is the planned taps applied to
 * an in-memory document (no sound pads, same length) shown through Player.setPictureDoc, at most once per animation frame; at the
 * stop the snapped plan becomes a ghost (Editor.showGhost) with chips, and accept is ONE commitTake (one transaction, one undo).
 * Everything the planner cannot do yet is said in words: this view never fabricates a plan, a take or a sync claim.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { defaultBank, performGrid, type Chip, type PadBank, type Tap } from '@pulseframe/core';
import { api } from '../../api.ts';
import { Button, Dialog, Seg, Slider, Switch, Tabs } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { analyseCalibration, heardPerfMs, outputLatencyMs, scheduleClicks, type CalibrationResult, type ClickContext } from './calibration.ts';
import { liveDocument, padStatus, planTake, resolvePadAssets, TapCapture, type PadStatus, type PlanFailure, type TakePlan } from './capture.ts';
import { CameraOverlay } from './CameraOverlay.tsx';
import { CALIBRATION, type PerformPrefs } from './contract.ts';
import { PadEditor } from './PadEditor.tsx';
import { PadGrid } from './PadGrid.tsx';
import { PERFORM_TESTIDS as ID } from './perform.testids.ts';
import { performT, type PerformKey } from './perform.strings.ts';
import { calibrationState, defaultPrefs, loadPrefs, offsetSeconds, savePrefs } from './prefs.ts';
import { TakeLane } from './TakeLane.tsx';
import './perform.css';

type Phase = 'idle' | 'recording' | 'review';
const CHOICE_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit']);
/** Whether the focus is somewhere that takes text: the pads' number keys are then not pads (a slider or switch keeps no digits, so pads stay live there). */
const typingNow = (): boolean => {
  const el = document.activeElement as (HTMLElement & { type?: string }) | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'INPUT') return !CHOICE_INPUTS.has((el.type ?? '').toLowerCase());
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
};
const modalNow = (): boolean => !!document.querySelector('[aria-modal="true"]');
const hasMotionPad = (bank: PadBank) => bank.some((m) => m && (m.kind === 'punch' || (m.kind === 'adjust' && m.effects.some((e) => e.type.startsWith('motion.')))));

declare global { interface Window { __pfPerform?: { injectTaps(taps: Tap[]): number; state(): { phase: string; taps: Tap[]; chips: Chip[] } }; } }

export function PerformView() {
  const { editor, state, t } = useEditorState();
  const lang = state.lang === 'en' ? 'en' : 'he';
  const S = performT(lang);
  const doc = state.doc;
  const [prefs, setPrefsRaw] = useState<PerformPrefs>(() => loadPrefs());
  const [tab, setTab] = useState<'pads' | 'camera'>('pads');
  const [phase, setPhase] = useState<Phase>('idle');
  const [take, setTake] = useState<TakePlan | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [failure, setFailure] = useState<PlanFailure | null>(null);
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [overFrom, setOverFrom] = useState<number>(Infinity);
  const [reducedDismissed, setReducedDismissed] = useState(false);
  const [liveText, setLiveText] = useState('');
  const say = useCallback((text: string) => setLiveText((p) => (p === text ? `${text}​` : text)), []);

  const setPrefs = useCallback((fn: (p: PerformPrefs) => PerformPrefs) => {
    setPrefsRaw((p) => { const n = fn(p); if (!savePrefs(n)) queueMicrotask(() => say(performT(lang)('pv.live.notSaved'))); return n; });
  }, [lang, say]);

  // ---- derived: bank, pads, music
  const bank = useMemo<PadBank | null>(() => { try { return prefs.bank ?? defaultBank(prefs.bankId); } catch { return null; } }, [prefs.bank, prefs.bankId]);
  const base = editor.viewDoc ?? doc;
  const hasBeats = useMemo(() => { try { return !!base && performGrid(base, { ...prefs.settings, snap: 'beat', tempo: 'normal' }).length > 0; } catch { return false; } }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  const assets = useMemo(() => (base && bank ? resolvePadAssets(base, bank) : Array.from({ length: 8 }, () => null)), [base, bank]);
  const gpu = editor.gpuReady;
  const statuses = useMemo<PadStatus[]>(() => Array.from({ length: 8 }, (_, i) => padStatus(bank?.[i] ?? null, { gpu, hasBeats, noFlashes: prefs.noFlashes, asset: assets[i] ?? null })), [bank, gpu, hasBeats, prefs.noFlashes, assets]);
  const latency = editor.player?.syncStats().outputLatencyMs ?? null;
  const cal = calibrationState(prefs, latency);

  // ---- refs the event handlers read (they outlive renders)
  const live = useRef({ bank, assets, statuses, prefs, base, gpu, cal, phase });
  live.current = { bank, assets, statuses, prefs, base, gpu, cal, phase };
  const raf = useRef(0);
  const liveShown = useRef(false);
  const failedOnce = useRef(false);
  const capture = useRef<TapCapture | null>(null);
  if (!capture.current) {
    capture.current = new TapCapture({
      timelineSecondsAt: (ms) => editor.player?.timelineSecondsAt(ms) ?? null,
      offsetSeconds: () => offsetSeconds(live.current.cal),
      keyContext: () => ({ performActive: editor.performActive, multicamDigitsLive: editor.multicamDigitsLive, typing: typingNow(), modalOpen: modalNow() }),
      padUsable: (pad) => live.current.statuses[pad]?.state === 'ready',
      onChange: () => { setHeld(capture.current!.heldPads()); setOverFrom(capture.current!.overCount > 0 ? 200 : Infinity); scheduleReplan(); },
      onPadDown: (pad) => { const m = live.current.bank?.[pad], a = live.current.assets[pad]; if (m?.kind === 'sound' && a) editor.player?.monitorSound(a, m.gain); },
    });
  }
  const cap = capture.current;

  const ctxOf = () => ({ bank: live.current.bank!, assets: live.current.assets, settings: live.current.prefs.settings, gpu: live.current.gpu });
  const fail = useCallback((f: PlanFailure) => { setFailure(f); if (!failedOnce.current) { failedOnce.current = true; say(f.kind === 'not_built' ? S('pv.plannerMissing') : S('pv.planRefused', { why: f.message })); } }, [S, say]);

  // ---- the live picture: raw taps planned and applied in memory, at most once per animation frame
  const replan = () => {
    raf.current = 0;
    const l = live.current, p = editor.player;
    if (l.phase !== 'recording' || !l.bank || !l.base || !p) return;
    const now = p.timelineSecondsAt(performance.now()) ?? T.toSeconds(editor.playhead);
    const r = liveDocument(l.base, cap.snapshot(now), ctxOf());
    if (r.failure) fail(r.failure);
    if (r.doc) { p.setPictureDoc(r.doc); liveShown.current = true; }
    else if (liveShown.current) { p.setPictureDoc(l.base); liveShown.current = false; }
  };
  function scheduleReplan() { if (!raf.current) raf.current = requestAnimationFrame(replan); }

  // ---- after the stop: the snapped plan, its ghost and its chips
  const planNow = useCallback((taps: Tap[]) => {
    const l = live.current;
    if (!l.bank || !l.base) return;
    const r = planTake(l.base, taps, ctxOf());
    if ('kind' in r) { fail(r); setTake(null); setChips([]); editor.showGhost(null); return; }
    setFailure(null); setTake(r); setChips(r.chips);
    editor.showGhost(r.ghost);
    const k = r.chips.filter((c) => c.state === 'kept').length, m = r.chips.filter((c) => c.state === 'merged').length;
    say(r.ghost ? S('pv.live.counts', { kept: k, merged: m, held: r.chips.length - k - m }) : S('pv.nothingKept'));
  }, [editor, fail, S, say]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRecording = useCallback((closeAt: number) => {
    cancelAnimationFrame(raf.current); raf.current = 0;
    cap.recording = false; cap.closeAll(closeAt);
    editor.setPerformRecording(false);
    setHeld(new Set());
    liveShown.current = false;
  }, [cap, editor]);

  const finalize = useCallback(() => {
    stopRecording(T.toSeconds(editor.playhead));
    const taps = cap.snapshot();
    say(S('pv.live.stopped'));
    if (!taps.length) { editor.showGhost(null); setPhase('idle'); say(S('pv.live.nothing')); return; }
    if (cap.overCount > 0) say(S('pv.live.overflow', { n: 201, max: 200 }));
    setPhase('review');
    planNow(taps);
  }, [cap, editor, planNow, stopRecording, S, say]);

  const record = useCallback(() => {
    const l = live.current, p = editor.player;
    if (!l.bank) { fail({ kind: 'not_built' }); return; }
    if (!p || !l.base) { say(S('pv.noPlayer')); return; }
    if (p.frameCount === 0) { say(S('pv.noClips')); return; }
    (document.activeElement as HTMLElement | null)?.blur?.();
    cap.reset(); cap.recording = true; failedOnce.current = false;
    setFailure(null); setTake(null); setChips([]); setOverFrom(Infinity);
    editor.showGhost(null);
    editor.setPerformRecording(true);
    setPhase('recording'); say(S('pv.live.recording'));
    void p.play().then(() => { for (const [i, m] of (l.bank ?? []).entries()) { const a = live.current.assets[i]; if (m?.kind === 'sound' && a) p.monitorSound(a, 0); } }); // decode the sound pads before the first tap
  }, [cap, editor, fail, S, say]);

  const discard = useCallback(() => {
    if (live.current.phase === 'recording') { editor.player?.pause(); stopRecording(0); }
    cap.reset(); editor.showGhost(null);
    setPhase('idle'); setTake(null); setChips([]); setFailure(null); setOverFrom(Infinity);
    say(S('pv.live.discarded'));
  }, [cap, editor, stopRecording, S, say]);

  const stop = useCallback(() => { editor.player?.pause(); }, [editor]);

  const accept = useCallback(async () => {
    const l = live.current;
    if (!l.bank || !take?.planned.args || saving) return;
    setSaving(true);
    const res = await editor.commitTake({ taps: cap.snapshot(), bank: [...l.bank], assets: [...l.assets], settings: l.prefs.settings, gpu: l.gpu });
    setSaving(false);
    if (!res) { say(S('pv.commitFailed')); return; }
    const k = res.chips.filter((c) => c.state === 'kept').length;
    cap.reset(); setPhase('idle'); setTake(null); setChips([]); setOverFrom(Infinity);
    say(S('pv.live.accepted', { kept: k, held: res.chips.filter((c) => c.state === 'held').length }));
  }, [cap, editor, take, saving, S, say]);

  const again = () => { discard(); record(); };

  // the take ends when the player stops (Space, the end of the edit, the stop button)
  useEffect(() => {
    if (phase === 'recording' && !editor.player?.active) finalize();
  }, [state.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // snap settings, the bank or the document (a reload, a remote edit) changed in review: the same taps, planned again
  useEffect(() => { if (live.current.phase === 'review') planNow(cap.snapshot()); }, [prefs.settings, prefs.bank, prefs.bankId, hasBeats, base]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keys: pads (capture), R record, Enter accept, Escape discard; blur closes open hits
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!editor.performActive) return;
      const ph = live.current.phase;
      if (ph === 'recording') { cap.keyDown(e); if (e.key === 'Escape') { e.preventDefault(); discard(); } return; }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || typingNow() || modalNow()) return;
      const inField = (e.target as HTMLElement | null)?.closest?.('button,a,input,select,textarea,[role="slider"],[role="switch"],[role="radio"],[role="tab"]');
      if (tabRef.current !== 'pads') return;
      if (e.code === 'KeyR' && ph === 'idle') { e.preventDefault(); record(); }
      else if (e.key === 'Enter' && ph === 'review' && !inField) { e.preventDefault(); void accept(); }
      else if (e.key === 'Escape' && ph === 'review') { e.preventDefault(); discard(); }
    };
    const up = (e: KeyboardEvent) => { cap.keyUp(e); };
    const blur = () => { if (cap.blur(performance.now())) setHeld(cap.heldPads()); };
    const hidden = () => { if (document.visibilityState === 'hidden') blur(); };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); };
  }, [cap, editor, record, accept, discard]);
  const tabRef = useRef(tab); tabRef.current = tab;

  // leaving the view or the workspace: nothing is left recording (the store also resets its own flags)
  useEffect(() => () => { cancelAnimationFrame(raf.current); cap.recording = false; if (live.current.phase === 'recording') { editor.player?.pause(); editor.setPerformRecording(false); } if (editor.getState().performGhost) editor.showGhost(null); }, [cap, editor]);

  // the proof's test hook, only when the proof's flag is set (like __pfAudioTap)
  const hook = useRef({ finalize, planNow });
  hook.current = { finalize, planNow };
  useEffect(() => {
    if (!(globalThis as { __pfPerformProof?: unknown }).__pfPerformProof) return;
    window.__pfPerform = {
      injectTaps: (taps) => {
        if (live.current.phase === 'idle') { cap.reset(); const n = cap.inject(taps); setPhase('review'); live.current.phase = 'review'; hook.current.planNow(cap.snapshot()); return n; }
        return cap.inject(taps);
      },
      state: () => ({ phase: live.current.phase, taps: cap.snapshot(), chips }),
    };
    return () => { delete window.__pfPerform; };
  }, [cap, chips]);

  // ---- pad pointer events
  const padDown = (pad: number, id: number, ts: number) => { if (live.current.phase === 'recording') cap.pointerDown(pad, id, ts); };
  const padUp = (id: number, ts: number) => { cap.pointerUp(id, ts); };

  const addToLibrary = async (pad: number) => {
    const m = bank?.[pad], pid = doc?.id;
    if (!m || !pid) return;
    setAdding(pad);
    try {
      if (m.kind === 'sound') await api.addSoundEffect(pid, { sfxId: m.source.sfxId });
      else if (m.kind === 'sticker') await api.addElement(pid, { elementId: m.source.elementId, ...(m.source.color ? { color: m.source.color } : {}), ...(m.source.color2 ? { color2: m.source.color2 } : {}) });
      say(S('pv.added'));
    } catch { say(S('pv.addFailed')); } finally { setAdding(null); }
  };

  const setSettings = (patch: Partial<PerformPrefs['settings']>) => setPrefs((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const heldWords = (r: NonNullable<Chip['reason']>) => t(`perform.held.${r}` as 'perform.held.flash_limit');
  if (!doc) return null;

  const empty = Array.from({ length: 8 }, () => null);
  const calText = cal.state === 'none' ? t('perform.notCalibrated')
    : cal.state === 'stale' ? S('pv.cal.stale', { date: new Date(cal.calibratedAt).toLocaleDateString(lang) })
    : S('pv.cal.on', { date: new Date(cal.calibratedAt).toLocaleDateString(lang), ms: cal.offsetMs.toFixed(0) });

  return (
    <section className="pf-ds pf-perform pf-force-dark" data-testid={ID.view} data-phase={phase} aria-label={S('pv.aria.view')} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <p className="pf-sr" role="status" aria-live="polite" data-testid={ID.live}>{liveText}</p>
      {tab === 'camera' ? (
        <CameraOverlay lang={lang} camera={prefs.camera} onCamera={(c) => setPrefs((p) => ({ ...p, camera: c }))} say={say} onClose={() => setTab('pads')} />
      ) : (
        <div className="pf-perform-panel">
          <div className="pf-perform-top">
            <Tabs label={S('pv.cam.tabs')} value={tab} onChange={(id) => setTab(id as 'pads' | 'camera')} tabs={[{ id: 'pads', label: S('pv.cam.pads') }, { id: 'camera', label: t('perform.camera'), testId: ID.camera }]} />
            <div className="pf-perform-transport" role="group" aria-label={S('pv.record')}>
              {phase === 'idle' && <Button variant="primary" onClick={record} keys={['R']} data-testid={ID.record} disabledReason={!bank ? S('pv.plannerMissing') : undefined}>{S('pv.record')}</Button>}
              {phase === 'recording' && <Button variant="danger" onClick={stop} keys={['Space']} data-testid={ID.stop}>{S('pv.stop')}</Button>}
              {phase === 'review' && (<>
                <Button variant="primary" busy={saving} onClick={() => void accept()} keys={['Enter']} data-testid={ID.accept} disabledReason={take?.planned.args ? undefined : S('pv.nothingKept')}>{saving ? S('pv.saving') : S('pv.accept')}</Button>
                <Button variant="ghost" onClick={discard} keys={['Esc']} data-testid={ID.discard}>{S('pv.discard')}</Button>
                <Button variant="secondary" onClick={again} data-testid={ID.again}>{S('pv.again')}</Button>
              </>)}
            </div>
            <div className="pf-perform-cal">
              <span className="pf-perform-badge" data-testid={cal.state === 'ok' ? undefined : ID.notCalibrated} data-state={cal.state}>{calText}</span>
              <Button size="sm" variant="secondary" onClick={() => setCalOpen(true)} data-testid={ID.calibrate}>{t('perform.calibrate')}</Button>
            </div>
          </div>
          <p className="pf-perform-hint" dir="auto">{S(`pv.hint.${phase === 'idle' ? 'idle' : phase === 'recording' ? 'recording' : 'review'}` as PerformKey)}</p>
          {state.performLeftVariant && <p className="pf-perform-note" role="note" data-testid={ID.masterOnly}>{t('perform.masterOnly')}</p>}
          {editor.multicamDigitsLive && <p className="pf-perform-note" role="note" data-testid={ID.multicamDigits}>{t('perform.multicamDigits')}</p>}
          {!bank && <p className="pf-perform-note" role="status">{S('pv.plannerMissing')}</p>}
          {failure && <p className="pf-perform-note" role="alert">{failure.kind === 'not_built' ? S('pv.plannerMissing') : S('pv.planRefused', { why: failure.message })}</p>}
          {reduced && !reducedDismissed && bank && hasMotionPad(bank) && (
            <p className="pf-perform-note" role="note" data-testid={ID.reducedMotion}>{S('pv.reduced')} <Button size="sm" variant="ghost" onClick={() => setReducedDismissed(true)}>{S('pv.reducedOk')}</Button></p>
          )}
          <PadGrid bank={bank ?? empty} statuses={statuses} held={held} lang={lang} keysLive={!editor.multicamDigitsLive} addLabel={t('perform.addToLibrary')} adding={adding}
            onDown={padDown} onUp={padUp} onEdit={(p) => setEditing(p)} onAdd={(p) => void addToLibrary(p)} />
          <p className="pf-perform-hint" dir="auto">{S('pv.keyHint')}</p>
          <div className="pf-perform-settings">
            <div data-testid={ID.snap} data-snap={prefs.settings.snap}>
              <Seg label={S('pv.snap')} value={prefs.settings.snap} onChange={(v) => setSettings({ snap: v })} size="sm"
                options={(['off', 'beat', 'half'] as const).map((v) => ({ value: v, label: t(`perform.snap.${v}` as 'perform.snap.off') }))} />
            </div>
            <div className="pf-perform-strength" data-testid={ID.strength}>
              <Slider label={t('perform.strength')} min={0} max={100} step={5} value={Math.round(prefs.settings.strength * 100)} valueText={S('pv.strengthValue', { n: Math.round(prefs.settings.strength * 100) })}
                onChange={(v) => setSettings({ strength: v / 100 })} disabled={prefs.settings.snap === 'off'} />
              <span className="pf-perform-strength-label" dir="auto">{t('perform.strength')} <bdi dir="ltr">{S('pv.strengthValue', { n: Math.round(prefs.settings.strength * 100) })}</bdi></span>
            </div>
            <div data-testid={ID.tempo} data-tempo={prefs.settings.tempo}>
              <Seg label={S('pv.tempo')} value={prefs.settings.tempo} onChange={(v) => setSettings({ tempo: v })} size="sm"
                options={(['half', 'normal', 'double'] as const).map((v) => ({ value: v, label: v === 'half' ? '÷2' : v === 'double' ? '×2' : '×1', ariaLabel: t(`perform.tempo.${v}` as 'perform.tempo.half') }))} />
            </div>
            <Button size="sm" variant="secondary" aria-pressed={prefs.settings.parity === 1} disabled={prefs.settings.tempo !== 'half'} data-testid={ID.shiftBeat}
              onClick={() => setSettings({ parity: prefs.settings.parity === 1 ? 0 : 1 })}>{t('perform.shiftBeat')}</Button>
            <Switch checked={prefs.noFlashes} onChange={(v) => setPrefs((p) => ({ ...p, noFlashes: v }))} label={t('perform.noFlashes')} testId={ID.noFlashes} />
            <div data-testid={ID.bank} data-bank={prefs.bankId}>
              <Seg label={S('pv.bank')} value={prefs.bankId} size="sm" onChange={(v) => setPrefs((p) => ({ ...p, bankId: v, bank: null }))}
                options={(['canvas', 'gpu'] as const).map((v) => ({ value: v, label: t(`perform.bank.${v}` as 'perform.bank.canvas') }))} />
            </div>
          </div>
          {!hasBeats && prefs.settings.snap !== 'off' && <p className="pf-perform-note" role="note">{S('pv.noBeats')}</p>}
          {prefs.settings.snap !== 'off' && <p className="pf-perform-hint" dir="auto">{S('pv.snapNote')}</p>}
          <TakeLane chips={chips} lang={lang} ghost={phase === 'review' && !!take?.ghost} ghostBanner={t('perform.ghostBanner')} heldWords={heldWords} overFrom={overFrom} />
        </div>
      )}
      <PadEditor open={editing !== null} pad={editing ?? 0} current={editing !== null ? bank?.[editing] ?? null : null} lang={lang} onClose={() => setEditing(null)}
        onSave={(m) => { if (editing === null || !bank) return; const next = bank.map((x, i) => (i === editing ? m : x)); setPrefs((p) => ({ ...p, bank: next })); setEditing(null); }}
        onReset={() => { if (editing === null) return; try { const d = defaultBank(prefs.bankId); setPrefs((p) => ({ ...p, bank: (bank ?? d).map((x, i) => (i === editing ? d[i] ?? null : x)) })); } catch { setPrefs((p) => ({ ...p, bank: null })); } setEditing(null); }} />
      {calOpen && <CalibrationDialog lang={lang} onClose={() => setCalOpen(false)} onSave={(tap) => { setPrefs((p) => ({ ...p, tap })); setCalOpen(false); say(S('pv.cal.on', { date: new Date(tap.calibratedAt).toLocaleDateString(lang), ms: tap.offsetMs.toFixed(0) })); }} />}
    </section>
  );
}

// ---------------------------------------------------------------- calibration dialog
function CalibrationDialog({ lang, onClose, onSave }: { lang: 'he' | 'en'; onClose(): void; onSave(tap: NonNullable<PerformPrefs['tap']>): void }) {
  const S = performT(lang);
  const [step, setStep] = useState<'intro' | 'listening' | 'result' | 'noaudio'>('intro');
  const [taps, setTaps] = useState(0);
  const [result, setResult] = useState<(CalibrationResult & { latency: number }) | null>(null);
  const run = useRef<{ ctx: AudioContext; clicks: number[]; taps: number[]; timer: number } | null>(null);
  const cleanup = () => { const r = run.current; run.current = null; if (r) { clearTimeout(r.timer); void r.ctx.close().catch(() => undefined); } };
  useEffect(() => cleanup, []);
  useEffect(() => {
    if (step !== 'listening') return;
    const tapIn = (e: Event) => {
      const r = run.current;
      if (!r) return;
      if (e instanceof KeyboardEvent && (e.repeat || e.key === 'Tab' || e.key === 'Escape')) return;
      if (e instanceof KeyboardEvent && (e.target as HTMLElement | null)?.closest('button') && e.key === 'Enter') return;
      if (e instanceof KeyboardEvent && e.key === ' ') e.preventDefault();
      r.taps.push(e.timeStamp); setTaps(r.taps.length);
    };
    window.addEventListener('keydown', tapIn, true); window.addEventListener('pointerdown', tapIn, true);
    return () => { window.removeEventListener('keydown', tapIn, true); window.removeEventListener('pointerdown', tapIn, true); };
  }, [step]);
  const start = async () => {
    const Ctor = globalThis.AudioContext;
    if (!Ctor) { setStep('noaudio'); return; }
    try {
      const ctx = new Ctor({ latencyHint: 'interactive' });
      await ctx.resume();
      if (ctx.state !== 'running') { void ctx.close(); setStep('noaudio'); return; }
      const clicks = scheduleClicks(ctx as unknown as ClickContext);
      const last = clicks[clicks.length - 1]!;
      const timer = window.setTimeout(() => {
        const r = run.current;
        if (!r) return;
        const heard = r.clicks.map((c) => heardPerfMs(r.ctx as unknown as ClickContext, c));
        setResult({ ...analyseCalibration(heard, r.taps), latency: outputLatencyMs(r.ctx) });
        setStep('result');
        const c = r.ctx; run.current = null; void c.close().catch(() => undefined);
      }, Math.max(0, (last - ctx.currentTime) * 1000) + 900);
      run.current = { ctx, clicks, taps: [], timer };
      setTaps(0); setStep('listening');
    } catch { setStep('noaudio'); }
  };
  const close = () => { cleanup(); onClose(); };
  return (
    <Dialog open onClose={close} title={S('pv.cal.title')} size="sm" testId={ID.calibrateDialog}
      footer={step === 'result' && result ? (<>
        {result.ok && <Button variant="primary" onClick={() => onSave({ offsetMs: +result.offsetMs.toFixed(1), outputLatencyMs: result.latency, calibratedAt: new Date().toISOString() })}>{S('pv.cal.save')}</Button>}
        <Button variant="secondary" onClick={() => { setResult(null); setStep('intro'); }}>{S('pv.cal.again')}</Button>
        <Button variant="ghost" onClick={close}>{S('pv.cal.close')}</Button></>)
        : step === 'listening' ? <Button variant="ghost" onClick={close}>{S('pv.cal.cancel')}</Button>
        : <><Button variant="primary" onClick={() => void start()} disabled={step === 'noaudio'}>{S('pv.cal.start')}</Button><Button variant="ghost" onClick={close}>{S('pv.cal.close')}</Button></>}>
      <div className="pf-perform-form">
        {step === 'intro' && <p>{S('pv.cal.intro')}</p>}
        {step === 'noaudio' && <p role="alert">{S('pv.cal.noAudio')}</p>}
        {step === 'listening' && <p role="status">{S('pv.cal.listening')} <bdi dir="ltr">{S('pv.cal.progress', { n: taps })}</bdi></p>}
        <div data-testid={ID.calibrateResult} data-ok={result ? String(result.ok) : undefined} role="status">
          {step === 'result' && result && (result.ok
            ? S('pv.cal.ok', { ms: result.offsetMs.toFixed(0), mad: `${result.madMs.toFixed(0)}` })
            : result.reason === 'unsteady' ? S('pv.cal.unsteady', { mad: result.madMs.toFixed(0), max: CALIBRATION.maxMadMs }) : S('pv.cal.tooFew', { n: result.used }))}
        </div>
        <p className="pf-perform-note">{S('pv.cal.note')}</p>
      </div>
    </Dialog>
  );
}
