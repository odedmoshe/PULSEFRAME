/**
 * The tap-along (W3): the «סיפור» tab of the perform workspace, shown while editor state storyDraft exists (PerformView mounts it).
 * Its own TapCapture (perform/capture.ts) on the player's clock; «התחילו» (R) blurs, seeks to the narration's first frame, sets
 * recording and setPerformRecording(true), plays; «התמונה הבאה» on pointerdown, Enter through a synthetic pointer id, digits 1–8
 * through TapCapture.keyDown; Space stops (the transport); «המשיכו מכאן» / «מההתחלה»; the live picture through core
 * storyLiveDocument at most once per animation frame (Player.setPictureDoc: the sound is not restarted); the review ghost is planned
 * in the browser with the plan view's `context` (the same pure code and inputs as the server); «אישור» applies at the plan's
 * revision, compares the cut frames with the server's and says so when they differ. The clips' own sound is not heard while
 * tapping (said on screen). The proof hook window.__pfStory exists only under __pfStoryProof.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import * as T from '@pulseframe/time';
import { planStory, storyLiveDocument, type StoryApplyResult, type StoryChip } from '@pulseframe/core';
import { AnchoredError, Button } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { api } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { TapCapture } from '../perform/capture.ts';
import { calibrationState, loadPrefs, offsetSeconds } from '../perform/prefs.ts';
import { storyStrings } from './story.strings.ts';
import { STORY_TESTIDS as ID } from './story.testids.ts';
import {
  afterApply, chipLine, cutsFromSnapshot, ENTER_POINTER_ID, frameThrottle, laneFraction, narrationClip, pauseTicks, reviewOf, storyFailure, tapMsOf, tapsBefore, timelineOfMs,
  type StoryPlannerPort, type StoryReview,
} from './story.logic.ts';
import './story.css';

export interface StoryTapViewProps { lang: 'he' | 'en'; /** Back to the workspace the owner came from. */ onDone: () => void; /** The planner (the core functions; tests and proofs of the double pass theirs). */ planner?: StoryPlannerPort }
const CORE_PLANNER: StoryPlannerPort = { plan: planStory, live: storyLiveDocument };
type Phase = 'idle' | 'tapping' | 'review';
declare global {
  interface Window {
    __pfStory?: {
      /** Taps now, as a real press would (a synthetic pointer): the narration ms, the timeline seconds and the player's frame at that moment; null when nothing plays. */
      tap(): { ms: number; seconds: number; frame: number } | null;
      /** Timeline seconds heard at a performance time (null when nothing plays). */
      now(perfMs?: number): number | null;
      playerFrame(): number;
      state(): { phase: string; cutsMs: number[]; chips: StoryChip[]; reviewCuts: number[]; narrationStartSeconds: number | null; revision: number; differs: boolean };
    };
  }
}
const typingNow = (): boolean => {
  const el = document.activeElement as (HTMLElement & { type?: string }) | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'range', 'button', 'submit'].includes((el.type ?? '').toLowerCase());
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
};
const modalNow = (): boolean => !!document.querySelector('[aria-modal="true"]');

export function StoryTapView({ lang, onDone, planner = CORE_PLANNER }: StoryTapViewProps): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const S = storyStrings(lang);
  const draft = state.storyDraft;
  const doc = state.doc;
  const [phase, setPhase] = useState<Phase>('idle');
  const [cuts, setCuts] = useState<number[]>([]);
  const [review, setReview] = useState<StoryReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<{ result: StoryApplyResult; differs: boolean } | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [live, setLive] = useState('');
  const prefs = useMemo(() => loadPrefs(), []);
  const lat = editor.player?.syncStats().outputLatencyMs ?? null;
  const cal = calibrationState(prefs, lat);

  const L = useRef({ phase, cuts, draft, doc, cal, review });
  L.current = { phase, cuts, draft, doc, cal, review };
  /** Where the narration clip lies in the picture being played: start and source-in, seconds. */
  const nar = useRef<{ start: number; sourceIn: number } | null>(null);
  const alive = useRef(true);
  const differsRef = useRef(false);
  const base = () => editor.viewDoc ?? L.current.doc!;

  const capture = useRef<TapCapture | null>(null);
  if (!capture.current) {
    capture.current = new TapCapture({
      timelineSecondsAt: (ms) => editor.player?.timelineSecondsAt(ms) ?? null,
      offsetSeconds: () => offsetSeconds(L.current.cal),
      keyContext: () => ({ performActive: editor.performActive, multicamDigitsLive: false, typing: typingNow(), modalOpen: modalNow() }),
      onChange: () => throttle.current?.schedule(),
    });
  }
  const cap = capture.current;
  const snapshotCuts = (nowSec?: number): number[] => (nar.current ? cutsFromSnapshot(cap.snapshot(nowSec), nar.current.start, nar.current.sourceIn) : []);

  // ---- the live picture: the taps so far planned and applied in memory, at most once per animation frame
  const throttle = useRef<ReturnType<typeof frameThrottle> | null>(null);
  if (!throttle.current) {
    throttle.current = frameThrottle(() => {
      const l = L.current, p = editor.player;
      if (l.phase !== 'tapping' || !l.draft?.view || !p) return;
      const now = p.timelineSecondsAt(performance.now()) ?? undefined;
      const c = snapshotCuts(now);
      setCuts(c);
      setLive(S.tapped(c.length));
      try {
        const d = planner.live(base(), l.draft.params, l.draft.view.context, c);
        if (d) p.setPictureDoc(d);
      } catch { /* a refused plan keeps the picture as it is; the review says why */ }
    }, (f) => requestAnimationFrame(f), (i) => cancelAnimationFrame(i));
  }

  const stopCapture = useCallback((closeAt: number) => {
    throttle.current?.cancel();
    cap.recording = false; cap.closeAll(closeAt);
    editor.setPerformRecording(false);
  }, [cap, editor]);

  const finalize = useCallback(() => {
    const l = L.current;
    const p = editor.player;
    const closeAt = p ? p.timelineSecondsAt(performance.now()) ?? T.toSeconds(editor.playhead) : T.toSeconds(editor.playhead);
    stopCapture(closeAt);
    const c = snapshotCuts();
    setCuts(c);
    if (nar.current) setStoppedAt(tapMsOf(T.toSeconds(editor.playhead), nar.current.start, nar.current.sourceIn) / 1000);
    if (!l.draft?.view) return;
    if (!c.length) { editor.showGhost(null); setPhase('idle'); setReview(null); setNotice(S.noTaps); return; }
    const r = reviewOf(base(), l.draft.params, l.draft.view, c, planner);
    setReview(r);
    if (r.notBuilt) setError(S.notBuilt); else if (r.refusal) setError(r.refusal);
    editor.showGhost(r.ghost);
    setPhase('review');
  }, [editor, stopCapture, planner]); // eslint-disable-line react-hooks/exhaustive-deps

  /** «התחילו» / «מההתחלה» (from undefined) or «המשיכו מכאן» (from the narration ms the last take stopped at). */
  const start = useCallback(async (fromMs?: number) => {
    const l = L.current;
    const p = editor.player;
    if (!l.draft?.view || !l.doc) return;
    setError(null); setNotice(null); setApplied(null); differsRef.current = false;
    if (!p) { setError(S.planFailed); return; }
    (document.activeElement as HTMLElement | null)?.blur?.();
    let ghost0;
    try { ghost0 = planner.live(base(), l.draft.params, l.draft.view.context, []); } catch (e) { setError(storyFailure(lang, e, t as never).message); return; }
    const clip = ghost0 ? narrationClip(ghost0, l.draft.params.narrationAssetId!) : null;
    if (!ghost0 || !clip) { setError(S.planFailed); return; }
    nar.current = { start: T.toSeconds(clip.start), sourceIn: T.toSeconds(clip.sourceIn) };
    editor.showGhost(ghost0);
    const rate = ghost0.settings.frameRate;
    const kept = fromMs === undefined ? [] : tapsBefore(l.cuts, fromMs);
    cap.reset();
    if (kept.length) cap.inject(kept.map((ms) => { const s = timelineOfMs(ms, nar.current!.start, nar.current!.sourceIn); return { pad: 0, down: s, up: s }; }));
    setCuts(kept); setReview(null); setStoppedAt(null);
    const startAt = fromMs === undefined ? clip.start : T.rt(Math.round(timelineOfMs(fromMs, nar.current.start, nar.current.sourceIn) * 1000), 1000);
    p.seek(T.nearestFrameIndex(startAt, rate));
    cap.recording = true;
    editor.setPerformRecording(true);
    setPhase('tapping'); setLive('');
    await p.play();
  }, [cap, editor, planner, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = useCallback(() => {
    const back = L.current.draft?.returnTo ?? 'pro';
    if (L.current.phase === 'tapping') { editor.player?.pause(); }
    stopCapture(0);
    editor.showGhost(null);
    editor.setStoryDraft(null);
    editor.setWorkspace(back);
    onDone();
  }, [editor, stopCapture, onDone]);

  const stopTaking = () => { editor.player?.pause(); };

  const accept = async () => {
    const l = L.current;
    if (!l.draft?.view || !l.review || busy) return;
    setBusy(true); setError(null);
    const params = { ...l.draft.params, cutsMs: l.cuts } as never;
    try {
      const r = await api.applyStory(l.doc!.id, params, l.draft.view.revision);
      editor.setStoryRun({ runId: r.runId, params, picks: r.picks, excluded: r.excluded, chips: r.chips });
      await editor.load(l.doc!.id);
      const after = afterApply(l.review.cuts, r, lang);
      differsRef.current = after.differs;
      if (after.differs) { setApplied({ result: r, differs: true }); return; }
      leave();
    } catch (e) {
      const f = storyFailure(lang, e, t as never);
      if (f.stale) {
        // the project changed since the plan: plan again at the new revision, show the review again, ask once more
        try {
          const view = await api.planStory(l.doc!.id, params);
          editor.setStoryDraft({ ...l.draft, view });
          const r = reviewOf(base(), l.draft.params, view, l.cuts, planner);
          setReview(r); editor.showGhost(r.ghost);
        } catch (e2) { setError(storyFailure(lang, e2, t as never).message); return; }
      }
      setError(f.message);
    } finally { if (alive.current) setBusy(false); }
  };

  // the take ends when the player stops (Space, the end of the narration, the stop button)
  useEffect(() => {
    if (phase === 'tapping' && !editor.player?.active) finalize();
  }, [state.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // keys: R starts; while tapping Enter and the digits tap, Escape drops the take; a lost focus closes an open press
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const ph = L.current.phase;
      if (ph === 'tapping') {
        if (e.key === 'Escape') { e.preventDefault(); stopCapture(0); editor.player?.pause(); cap.reset(); editor.showGhost(null); setCuts([]); setPhase('idle'); return; }
        if (e.key === 'Enter' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typingNow() && !modalNow()) { e.preventDefault(); cap.pointerDown(0, ENTER_POINTER_ID, e.timeStamp); return; }
        cap.keyDown(e);
        return;
      }
      if (e.code === 'KeyR' && ph === 'idle' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat && !typingNow() && !modalNow()) { e.preventDefault(); void start(); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Enter') cap.pointerUp(ENTER_POINTER_ID, e.timeStamp); cap.keyUp(e); };
    const blur = () => { cap.blur(performance.now()); };
    const hidden = () => { if (document.visibilityState === 'hidden') blur(); };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); };
  }, [cap, editor, start, stopCapture]);

  // leaving the view: nothing is left recording (the store also resets its flags)
  useEffect(() => { alive.current = true; return () => { alive.current = false; throttle.current?.cancel(); cap.recording = false; if (L.current.phase === 'tapping') { editor.player?.pause(); editor.setPerformRecording(false); } if (editor.getState().performGhost) editor.showGhost(null); }; }, [cap, editor]);

  // the proof's test hook, only when the proof's flag is set
  useEffect(() => {
    if (!(globalThis as { __pfStoryProof?: unknown }).__pfStoryProof) return;
    let n = 0;
    window.__pfStory = {
      tap: () => {
        const p = editor.player, perf = performance.now();
        const sec = p?.timelineSecondsAt(perf) ?? null;
        if (!p || sec === null || !nar.current) return null;
        const id = -100 - n++;
        if (!cap.pointerDown(0, id, perf)) return null;
        cap.pointerUp(id, perf);
        return { ms: tapMsOf(sec - offsetSeconds(L.current.cal), nar.current.start, nar.current.sourceIn), seconds: sec, frame: p.frame };
      },
      now: (perfMs) => editor.player?.timelineSecondsAt(perfMs ?? performance.now()) ?? null,
      playerFrame: () => editor.player?.frame ?? -1,
      state: () => ({ phase: L.current.phase, cutsMs: L.current.cuts, chips: L.current.review?.chips ?? [], reviewCuts: L.current.review?.cuts ?? [], narrationStartSeconds: nar.current?.start ?? null, revision: editor.getState().revision, differs: differsRef.current }),
    };
    return () => { delete window.__pfStory; };
  }, [cap, editor]);

  if (!draft || !draft.view || !doc) return null;
  const view = draft.view;
  const pictures = draft.params.assetIds?.length ?? 0;
  const narrationSeconds = view.narration.seconds;
  const ticks = pauseTicks(view.narration.onsetsMs, narrationSeconds);
  const chips = review?.chips ?? [];
  const blocked = review ? (review.blocking[0]?.message ?? null) : null;
  const warnings = review ? [...review.blocking.map((w) => ({ w, blocking: true })), ...review.warnings.map((w) => ({ w, blocking: false }))] : [];

  return (
    <section className="pf-story-tap" data-testid={ID.tapView} data-phase={phase} dir={lang === 'he' ? 'rtl' : 'ltr'} aria-label={S.name}>
      <p className="pf-story-muted">{S.tapIntro}</p>
      <div className="pf-story-row">
        {phase === 'idle' && <Button variant="primary" keys={['R']} data-testid={ID.tapStart} onClick={() => void start()}>{S.start}</Button>}
        {phase === 'tapping' && (
          <>
            <button type="button" className="pf-story-next" data-testid={ID.tapNext}
              onPointerDown={(e) => { e.preventDefault(); cap.pointerDown(0, e.pointerId, e.timeStamp); }} onPointerUp={(e) => cap.pointerUp(e.pointerId, e.timeStamp)} onPointerCancel={(e) => cap.pointerUp(e.pointerId, e.timeStamp)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); }}>{S.next}</button>
            <Button variant="danger" keys={['Space']} data-testid={ID.tapStop} onClick={stopTaking}>{S.stopTapping}</Button>
          </>
        )}
        {phase === 'review' && !applied && (
          <>
            <Button variant="primary" keys={['Enter']} busy={busy} data-testid={ID.tapAccept} disabledReason={blocked ?? (review?.notBuilt ? S.notBuilt : review?.refusal ?? undefined)} onClick={() => void accept()}>{busy ? S.accepting : S.accept}</Button>
            {stoppedAt !== null && stoppedAt * 1000 < narrationSeconds * 1000 - 500 && <Button data-testid={ID.tapResume} disabled={busy} onClick={() => void start(Math.round((stoppedAt ?? 0) * 1000))}>{S.resume}</Button>}
            <Button data-testid={ID.tapRestart} disabled={busy} onClick={() => void start()}>{S.restart}</Button>
          </>
        )}
        {phase !== 'tapping' && !applied && <Button variant="ghost" data-testid={ID.tapDiscard} disabled={busy} onClick={leave}>{S.discard}</Button>}
        {applied && <Button variant="primary" data-testid={ID.tapDone} onClick={leave}>{S.close}</Button>}
        <span className="pf-story-count" data-testid={ID.tapCount} aria-live="polite">{isolate(S.count(cuts.length, Math.max(0, pictures - 1)))}</span>
        <span className="pf-story-badge" data-testid={cal.state === 'none' ? ID.tapNotCalibrated : undefined} data-state={cal.state}>{cal.state === 'none' ? S.notCalibrated : ''}</span>
      </div>
      <p className="pf-story-muted">{phase === 'tapping' ? S.tapHintTapping : S.tapHintIdle}</p>
      <p className="pf-story-muted">{S.ownSoundSilent}</p>
      {cal.state === 'none' && <p className="pf-story-muted">{S.calibrateHint}</p>}
      <p className="pf-sr" role="status" aria-live="polite" data-testid={ID.tapLive}>{live}</p>

      <div className="pf-story-lane" data-testid={ID.tapLane} role="img" aria-label={S.tapLaneLabel}>
        {ticks.map((f, i) => <span key={`p${i}`} className="pf-story-tick" data-testid={ID.tapPause} title={S.pauseTick} style={{ insetInlineStart: `${(f * 100).toFixed(2)}%` }} />)}
        {cuts.map((ms, i) => <span key={`c${i}`} className="pf-story-mark" style={{ insetInlineStart: `${(laneFraction(ms, narrationSeconds) * 100).toFixed(2)}%` }} />)}
      </div>

      {notice && <p className="pf-story-muted" role="status">{notice}</p>}
      {error && <div data-testid={ID.error}><AnchoredError blocking onDismiss={() => setError(null)} dismissLabel={S.close}>{error}</AnchoredError></div>}

      {phase === 'review' && review && (
        <div className="pf-story-review">
          <h3>{S.reviewTitle}</h3>
          <p className="pf-story-muted" data-testid={ID.tapGhost}>{S.ghostLabel} · {isolate(S.predictedLine(review.cuts.length, review.seconds))}</p>
          {applied?.differs && <p className="pf-story-warn" role="alert" data-testid={ID.tapDiffers}>{S.differs}</p>}
          {warnings.length > 0 && (
            <ul className="pf-story-warnings">
              {warnings.map(({ w, blocking }, i) => <li key={`${w.code}-${i}`} data-testid={ID.warning} data-code={w.code} className={blocking ? 'is-blocking' : ''}>{isolate(S.warning[w.code as keyof typeof S.warning] ?? w.message)}</li>)}
            </ul>
          )}
          <ol className="pf-story-chips" aria-label={S.chipsLabel}>
            {chips.map((c) => (
              <li key={c.index} className={`pf-story-chip is-${c.state}`} data-testid={ID.tapChip} data-state={c.state} data-reason={c.reason ?? ''}>{isolate(chipLine(c, lang))}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
