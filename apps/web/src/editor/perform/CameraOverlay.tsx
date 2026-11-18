/**
 * The virtual camera («צלם»; ADR-0025): the selected clip is shown WHOLE with a crop rectangle that follows the pointer; the wheel
 * zooms in ×1.1 steps up to the ceiling cameraLimits gives, and the arrows and +/− do the same from the keyboard. Filming plays the
 * timeline at half speed, silent (Player.shuttle: no sound at any speed but 1), taking ONE sample per painted frame; at the end
 * planCamera turns the samples into three replace_clip_keyframes over the filmed range (a partial retake: keys outside it stay)
 * and the result is shown as a ghost for review. Accept is ONE transaction (commitCamera). Nothing is written while filming.
 * Sample frames are TIMELINE frames (performContract.ts CameraSample; planCamera maps them through the clip's start), while the
 * take's range {from, to} is clip-local: cameraSample() is the one place that turns a clip-local frame into a sample.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import * as T from '@pulseframe/time';
import { applyTransaction, cameraLimits, DEFAULT_CAMERA, fitScale, planCamera, type Asset, type CameraGeometry, type CameraPlan, type CameraRefusal, type CameraSample, type Fit, type MediaClip, type ProjectDocument } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Player } from '../../player.ts';
import { Button, Slider } from '../../ds/index.ts';
import { sourceDocument } from '../SourceViewer.tsx';
import { useEditorState } from '../store.ts';
import type { PerformPrefs } from './contract.ts';
import { PERFORM_TESTIDS as ID } from './perform.testids.ts';
import { performT, type PerformKey } from './perform.strings.ts';

// ---- pure geometry (tested in CameraOverlay.test.ts)
export const ZOOM_STEP = 1.1;
export const geometryOf = (doc: ProjectDocument, clip: MediaClip): CameraGeometry | null => {
  const a = doc.assets[clip.assetId];
  const dims = a?.video ?? a?.image;
  if (!a || !dims) return null;
  const turned = a.video && Math.abs(a.video.rotation % 180) === 90;
  return { frameW: doc.settings.width, frameH: doc.settings.height, srcW: turned ? dims.height : dims.width, srcH: turned ? dims.width : dims.height, fit: (doc.settings.fit ?? 'contain') as Fit };
};
/** The visible window as fractions of the source width and height at camera zoom `zoom` (plan 4.4: ωu = W/(w·S), ωv = H/(h·S), S = S_fill·Z). */
export function windowFractions(g: CameraGeometry, zoom: number): { wu: number; wv: number } {
  const f = fitScale(g.frameW, g.frameH, g.srcW, g.srcH, g.fit);
  const w = g.srcW * f, h = g.srcH * f, fill = Math.max(g.frameW / w, g.frameH / h), S = fill * zoom;
  return { wu: Math.min(1, g.frameW / (w * S)), wv: Math.min(1, g.frameH / (h * S)) };
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** The centre kept inside the picture: the window never leaves the source. */
export const clampCentre = (u: number, v: number, wu: number, wv: number) => ({ u: clamp(u, wu / 2, 1 - wu / 2), v: clamp(v, wv / 2, 1 - wv / 2) });
/** The centre under a pointer, in source-normalised coordinates, from the picture's on-screen box. */
export function centreFromPointer(px: number, py: number, box: { left: number; top: number; width: number; height: number }, wu: number, wv: number) {
  return clampCentre((px - box.left) / Math.max(1, box.width), (py - box.top) / Math.max(1, box.height), wu, wv);
}
/** One wheel or key step: ×1.1 in, ÷1.1 out, between 1 (the fill) and the ceiling. */
export const stepZoom = (z: number, dir: 1 | -1, max: number): number => clamp(+(dir > 0 ? z * ZOOM_STEP : z / ZOOM_STEP).toFixed(6), 1, Math.max(1, max));
/** Clip-local frame of a timeline frame (negative before the clip). */
export const localFrame = (clip: MediaClip, frame: number, rate: T.Rate): number => frame - T.frameIndexAt(clip.start, rate);
/** The camera sample taken at a clip-local frame: its frame is the TIMELINE frame (the contract's basis), not the clip-local one. */
export const cameraSample = (clip: MediaClip, local: number, rate: T.Rate, pose: { u: number; v: number; zoom: number }): CameraSample => ({ frame: local + T.frameIndexAt(clip.start, rate), u: pose.u, v: pose.v, zoom: pose.zoom });
/** The source frame a clip shows at a clip-local frame, for the whole-clip picture (speed and reverse respected). */
export function sourceFrameAt(clip: MediaClip, local: number, rate: T.Rate): number {
  const localS = (local * rate.den) / rate.num, sp = clip.speed ? clip.speed.num / clip.speed.den : 1, inS = T.toSeconds(clip.sourceIn);
  const s = clip.reverse ? inS + T.toSeconds(clip.duration) * sp - localS * sp : inS + localS * sp;
  return Math.max(0, Math.round((s * rate.num) / rate.den));
}

/**
 * The document of the whole-clip picture: the source viewer's one-clip document, with the selected clip's privacy regions (ADR-0015)
 * and the motion tracks they follow carried over. Both are in source time and the overlay clip starts at source 0 at normal speed, so
 * they map one to one. A local document, never saved; without this a blurred face would show unblurred for the whole take.
 */
export function cameraSourceDocument(doc: ProjectDocument, clip: MediaClip, asset: Asset): ProjectDocument {
  const base = sourceDocument(doc, asset);
  if (!clip.redact?.length) return base;
  const out = structuredClone(base);
  const mine = out.sequences[out.mainSequenceId]?.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media');
  if (!mine || mine.type !== 'media') return base;
  mine.redact = structuredClone(clip.redact);
  for (const r of clip.redact) {
    const id = r.motionTrackId;
    const track = id !== null && Object.hasOwn(doc.motionTracks ?? {}, id) ? doc.motionTracks[id] : undefined;
    if (track) (out.motionTracks ??= {})[track.id] = structuredClone(track);
  }
  return out;
}

type Phase = 'idle' | 'filming' | 'review';
export interface CameraOverlayProps { lang: Lang; camera: PerformPrefs['camera']; onCamera(c: PerformPrefs['camera']): void; say(text: string): void; onClose(): void }

export function CameraOverlay({ lang, camera, onCamera, say, onClose }: CameraOverlayProps) {
  const { editor, state, t } = useEditorState();
  const S = performT(lang);
  const doc = state.doc;
  const sel = editor.selected;
  const clip = sel && sel.clip.type === 'media' && sel.track.kind === 'video' ? sel.clip : null;
  const geo = useMemo(() => (doc && clip ? geometryOf(doc, clip) : null), [doc, clip]);
  const limits = useMemo(() => { try { return geo ? cameraLimits(geo) : null; } catch { return null; } }, [geo]);
  const [pose, setPose] = useState({ u: 0.5, v: 0.5, zoom: 1 });
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<CameraPlan | null>(null);
  const [refusal, setRefusal] = useState<CameraRefusal | null>(null);
  const [message, setMessage] = useState<PerformKey | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const samples = useRef<CameraSample[]>([]);
  const range = useRef({ from: 0, to: 0 });
  const poseRef = useRef(pose); poseRef.current = pose;
  const lastFrame = useRef(-1);
  const lastPlanTo = useRef(0);
  const viewPlayer = useRef<Player | null>(null);
  const rate = doc?.settings.frameRate ?? { num: 30, den: 1 };
  const maxZoom = limits?.maxZoom ?? 1;
  const win = geo ? windowFractions(geo, pose.zoom) : { wu: 1, wv: 1 };
  const clipId = clip?.id;

  // the whole clip, on its own small player (draft frames, no sound), following the timeline frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc || !clip || !editor.pool) return;
    const asset = doc.assets[clip.assetId];
    if (!asset) return;
    let p: Player | null = null;
    try {
      p = new Player(canvas, editor.pool, () => {}, () => {}, { draftOnly: { maxHeight: 360 } });
      p.setDoc(cameraSourceDocument(doc, clip, asset));
      viewPlayer.current = p;
    } catch { viewPlayer.current = null; }
    return () => { p?.dispose(); if (viewPlayer.current === p) viewPlayer.current = null; };
  }, [clipId, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const follow = useCallback(() => { if (clip) viewPlayer.current?.follow(sourceFrameAt(clip, localFrame(clip, editor.frame, rate), rate)); }, [clip, editor, rate]);
  useEffect(follow, [follow, state.tick]);

  const finish = useCallback(() => {
    editor.player?.pause();
    editor.setPerformRecording(false);
    if (!doc || !clip) { setPhase('idle'); return; }
    const to = Math.min(localFrame(clip, editor.frame, rate), Math.max(0, T.frameIndexAt(clip.duration, rate) - 1));
    const from = range.current.from;
    if (samples.current.length < 2 || to <= from) { setPhase('idle'); setMessage('pv.cam.tooShort'); say(S('pv.cam.tooShort')); return; }
    setBusy(true);
    try {
      lastPlanTo.current = to;
      const r = planCamera(doc, { clipId: clip.id, from, to, samples: samples.current, settings: { ...DEFAULT_CAMERA, ...camera } });
      if ('refused' in r) { setRefusal(r.refused); setPlan(null); setPhase('idle'); say(S('pv.cam.refused', { why: t(`perform.camera.${r.refused}` as 'perform.camera.locked') })); return; }
      setRefusal(null); setPlan(r); setPhase('review');
      editor.showGhost(applyTransaction(doc, r.ops, { idSeed: 'perform_cam_', actor: 'perform-preview' }).doc);
    } catch (e) {
      setPhase('idle'); setMessage('pv.plannerMissing'); say(e instanceof Error && /not built/.test(e.message) ? S('pv.plannerMissing') : S('pv.planRefused', { why: e instanceof Error ? e.message : String(e) }));
    } finally { setBusy(false); }
  }, [doc, clip, editor, rate, camera, say, S, t]);

  // the project changed under a take in review (a reload, a remote edit): plan the same samples again on the new document
  useEffect(() => {
    if (phase !== 'review' || !doc) return;
    if (!clip || samples.current.length < 2) { editor.showGhost(null); setPlan(null); setPhase('idle'); return; }
    try {
      const r = planCamera(doc, { clipId: clip.id, from: range.current.from, to: lastPlanTo.current, samples: samples.current, settings: { ...DEFAULT_CAMERA, ...camera } });
      if ('refused' in r) { editor.showGhost(null); setRefusal(r.refused); setPlan(null); setPhase('idle'); say(S('pv.cam.refused', { why: t(`perform.camera.${r.refused}` as 'perform.camera.locked') })); return; }
      setPlan(r);
      editor.showGhost(applyTransaction(doc, r.ops, { idSeed: 'perform_cam_', actor: 'perform-preview' }).doc);
    } catch { editor.showGhost(null); setPlan(null); setPhase('idle'); }
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    if (!doc || !clip || !limits || phase === 'filming') return;
    const f = localFrame(clip, editor.frame, rate);
    if (f < 0 || f >= T.frameIndexAt(clip.duration, rate)) { setMessage('pv.cam.noPicture'); return; }
    editor.showGhost(null); setPlan(null); setRefusal(null); setMessage(null);
    samples.current = [cameraSample(clip, f, rate, poseRef.current)];
    range.current = { from: f, to: f }; lastFrame.current = f;
    editor.setPerformRecording(true);
    setPhase('filming');
    editor.player?.shuttle(0.5); // half speed: silent by construction (the player plays sound only at normal speed)
  };
  // one sample per painted frame; the shot ends when the player stops (the end of the edit, Space) or leaves the clip
  useEffect(() => {
    if (phase !== 'filming' || !clip) return;
    const p = editor.player;
    const f = localFrame(clip, editor.frame, rate);
    if (f !== lastFrame.current && f >= 0) {
      for (let k = lastFrame.current + 1; k <= f; k++) samples.current.push(cameraSample(clip, k, rate, poseRef.current));
      lastFrame.current = f;
    }
    if (!p?.playing || f >= T.frameIndexAt(clip.duration, rate) - 1) finish();
  }, [phase, state.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const discard = () => { editor.showGhost(null); setPlan(null); setPhase('idle'); say(S('pv.live.discarded')); };
  const accept = async () => {
    if (!plan || plan.overTolerance) return;
    setBusy(true);
    const rev = await editor.commitCamera(plan.ops);
    setBusy(false);
    if (rev === null) { setMessage('pv.cam.commitFailed'); say(S('pv.cam.commitFailed')); return; }
    editor.showGhost(null); setPlan(null); setPhase('idle'); say(S('pv.cam.committed'));
  };
  // leaving: whatever is playing or shown goes back
  useEffect(() => () => { editor.setPerformRecording(false); if (editor.getState().performGhost) editor.showGhost(null); }, [editor]);

  // pointer, wheel, keys
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || !geo) return;
    const c = centreFromPointer(e.clientX, e.clientY, r, win.wu, win.wv);
    setPose((p) => ({ ...p, ...c }));
  };
  const zoomBy = useCallback((dir: 1 | -1) => setPose((p) => { const zoom = stepZoom(p.zoom, dir, maxZoom); const w = geo ? windowFractions(geo, zoom) : { wu: 1, wv: 1 }; return { ...p, zoom, ...clampCentre(p.u, p.v, w.wu, w.wv) }; }), [geo, maxZoom]);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoomBy, clipId]);
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.shiftKey ? 0.05 : 0.01;
    const dx = e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0, dy = e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0;
    if (dx || dy) { e.preventDefault(); setPose((p) => ({ ...p, ...clampCentre(p.u + dx, p.v + dy, win.wu, win.wv) })); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1); } else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (phase === 'filming') finish(); else if (phase === 'idle') start(); }
    else if (e.key === 'Escape') { e.preventDefault(); if (phase === 'review') discard(); else if (phase === 'filming') { editor.player?.pause(); editor.setPerformRecording(false); setPhase('idle'); } }
  };

  const dial = (k: keyof PerformPrefs['camera'], label: PerformKey, min: number, max: number, step: number, id: string, fmt: (v: number) => string) => (
    <div className="pf-perform-dial"><span>{S(label)}</span>
      <Slider kind="magnitude" label={S(label)} min={min} max={max} step={step} value={camera[k]} valueText={fmt(camera[k])} testId={id} onChange={(v) => onCamera({ ...camera, [k]: v })} /></div>
  );
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const ready = !!clip && !!geo && !!limits;
  return (
    <section className="pf-perform-camera" data-testid={ID.cameraOverlay} aria-label={S('pv.cam.title')} data-phase={phase}>
      <header className="pf-perform-camera-head"><h2>{S('pv.cam.title')}</h2><Button size="sm" variant="ghost" onClick={onClose}>{S('pv.cam.pads')}</Button></header>
      <p className="pf-perform-note">{S('pv.cam.intro')}</p>
      {!clip && <p role="status" className="pf-perform-note">{S('pv.cam.pickClip')}</p>}
      {clip && !limits && <p role="status" className="pf-perform-note">{S('pv.plannerMissing')}</p>}
      {message && <p role="status" className="pf-perform-note">{S(message)}</p>}
      {ready && (
        <>
          <div className="pf-perform-camera-picture" ref={boxRef} dir="ltr" tabIndex={0} role="group" aria-label={S('pv.cam.rect')} aria-describedby="pf-perform-cam-help"
            style={{ aspectRatio: `${geo!.srcW} / ${geo!.srcH}`, inlineSize: `min(100%, 480px, calc(30vh * ${geo!.srcW} / ${geo!.srcH}))` }} onPointerMove={move} onPointerDown={move} onKeyDown={key}>
            <canvas ref={canvasRef} className="pf-perform-camera-canvas" aria-hidden="true" />
            <div className="pf-perform-camera-crop" data-testid={ID.cameraCrop} data-u={pose.u.toFixed(4)} data-v={pose.v.toFixed(4)} data-zoom={pose.zoom.toFixed(4)}
              style={{ left: pct(pose.u - win.wu / 2), top: pct(pose.v - win.wv / 2), width: pct(win.wu), height: pct(win.wv) }} />
          </div>
          <p id="pf-perform-cam-help" className="pf-perform-note">{S('pv.cam.help')}</p>
          <div className="pf-perform-camera-bar">
            <Button size="sm" variant="secondary" aria-label={S('pv.cam.zoomOut')} onClick={() => zoomBy(-1)}>−</Button>
            <span className="pf-perform-zoom" role="status"><bdi dir="ltr">{S('pv.cam.zoom', { z: pose.zoom.toFixed(2) })}</bdi> · <bdi dir="ltr">{S('pv.cam.zoomMax', { z: maxZoom.toFixed(2) })}</bdi></span>
            <Button size="sm" variant="secondary" aria-label={S('pv.cam.zoomIn')} onClick={() => zoomBy(1)}>+</Button>
            {phase !== 'filming'
              ? <Button variant="primary" onClick={start} disabled={busy || phase === 'review'} data-testid={ID.record}>{S('pv.cam.start')}</Button>
              : <Button variant="danger" onClick={finish} data-testid={ID.stop}>{S('pv.cam.stop')}</Button>}
          </div>
          <p className="pf-perform-note" role="status">{phase === 'filming' ? S('pv.cam.recording') : S('pv.cam.slow')}</p>
          <div className="pf-perform-dials">
            <span data-testid={ID.cameraSettle}>{dial('settleSeconds', 'pv.cam.settle', 0.1, 2, 0.05, 'perform-camera-settle-slider', (v) => S('pv.cam.seconds', { n: v.toFixed(2) }))}</span>
            <span data-testid={ID.cameraLead}>{dial('leadSeconds', 'pv.cam.lead', 0, 0.5, 0.05, 'perform-camera-lead-slider', (v) => S('pv.cam.seconds', { n: v.toFixed(2) }))}</span>
            <span data-testid={ID.cameraSway}>{dial('sway', 'pv.cam.sway', 0, 1, 0.05, 'perform-camera-sway-slider', (v) => `${Math.round(v * 100)}%`)}</span>
          </div>
        </>
      )}
      {refusal && <p role="alert" className="pf-perform-error" data-testid={ID.cameraRefusal} data-code={refusal}>{t(`perform.camera.${refusal}` as 'perform.camera.locked')}</p>}
      {plan && phase === 'review' && (
        <div className="pf-perform-camera-review">
          <p className="pf-perform-ghost" role="note">{t('perform.ghostBanner')}</p>
          <p data-testid={ID.cameraConfirm} data-count={plan.replacedKeys} role="status">{plan.replacedKeys > 0 ? S('pv.cam.confirm', { n: plan.replacedKeys }) : S('pv.cam.confirmNone')} <bdi dir="ltr">{S('pv.cam.keys', { n: plan.keys.length })}</bdi></p>
          {plan.overTolerance && <p role="alert" className="pf-perform-error" data-testid={ID.cameraOverTolerance}>{S('pv.cam.over', { n: (plan.residual * 100).toFixed(2) })}</p>}
          {plan.warnings.includes('linked_formats') && <p role="note" data-testid={ID.cameraLinkedFormats}>{t('perform.linkedFormats')}</p>}
          <div className="pf-perform-camera-bar">
            <Button variant="primary" busy={busy} disabled={plan.overTolerance} disabledReason={plan.overTolerance ? S('pv.cam.over', { n: (plan.residual * 100).toFixed(2) }) : undefined} onClick={() => void accept()} data-testid={ID.accept}>{S('pv.cam.accept')}</Button>
            <Button variant="ghost" onClick={discard} data-testid={ID.discard}>{S('pv.cam.discard')}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
