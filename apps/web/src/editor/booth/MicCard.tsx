/**
 * The microphone card «בדיקת מיקרופון» (wave 8 booth). BUILDER W2: 5 s through createRecorderSession
 * (apps/web/src/editor/story/story.logic.ts) with the recorder's own capture constraints, peak (dBFS) and clipped-sample counts shown as
 * measurements, played back from memory, dropped on close; the permission prompt happens only here.
 *
 * PRIVACY: the microphone is released on stop (the 5 s limit included), on a new take, when the card changes (the session is disposed
 * when `view.item.id` changes), when the dialog closes or this unmounts (dispose), and when the page is hidden (the recorder's own
 * listener plus attachHiddenRelease here). The take is a Blob in this component's memory; nothing is saved, uploaded or kept after the card.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createT, fillIn } from '@pulseframe/i18n';
import type { RecorderState } from '../story/recorder.contract.ts';
import type { RecorderSession } from '../story/story.logic.ts';
import { Button } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import type { BoothMicProps } from './booth.contract.ts';
import { BOOTH_TESTIDS as ID } from './booth.testids.ts';
import { boothPageStrings } from './check/check.strings.ts';
import { attachHiddenRelease, createMicSession, MIC_SECONDS, micBusy, micMeasure, peakText, takeSeconds } from './mic.logic.ts';

export function MicCard({ lang, view, onMeasured }: BoothMicProps): ReactElement {
  const t = createT(lang), S = boothPageStrings(lang);
  const [rec, setRec] = useState<RecorderState>({ kind: 'idle' });
  const [playing, setPlaying] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const session = useRef<RecorderSession | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const report = useRef(onMeasured);
  report.current = onMeasured;

  // One session per card: a different card, the dialog closing and the page unmounting all end in dispose(), which releases the microphone.
  useEffect(() => {
    setRec({ kind: 'idle' });
    const s = createMicSession(setRec);
    session.current = s;
    const stopPlayback = () => { const a = audio.current; if (a) { a.pause(); } setPlaying(false); };
    const off = attachHiddenRelease(document, window, () => { s.release(); stopPlayback(); });
    return () => { off(); stopPlayback(); s.dispose(); session.current = null; };
  }, [view.item.id]);

  const wav = rec.kind === 'stopped' || rec.kind === 'limit' ? rec.wav : null;
  // the take lives in memory only: a URL for the player, revoked as soon as the take is dropped or the card closes
  useEffect(() => {
    if (!wav) { setUrl(null); return; }
    const u = URL.createObjectURL(wav);
    setUrl(u);
    return () => { URL.revokeObjectURL(u); };
  }, [wav]);
  useEffect(() => {
    if (!url) { audio.current = null; return; }
    const a = new Audio(url);
    a.addEventListener('ended', () => setPlaying(false));
    audio.current = a;
    return () => { a.pause(); a.removeAttribute('src'); a.load(); audio.current = null; setPlaying(false); };
  }, [url]);
  // the measurements go to the dialog once per take
  useEffect(() => { const m = micMeasure(rec); if (m) report.current(m); }, [wav]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => { void session.current?.start(); };
  const recording = rec.kind === 'recording';
  const play = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) { a.pause(); a.currentTime = 0; setPlaying(false); return; }
    a.currentTime = 0;
    setPlaying(true);
    void a.play().catch(() => setPlaying(false));
  };
  const line = (() => {
    switch (rec.kind) {
      case 'idle': return S.micIdleHint;
      case 'asking': return S.micAsking;
      case 'recording': return S.micRecording(takeSeconds(rec), MIC_SECONDS);
      case 'limit': return S.micLimit;
      case 'stopped': return S.micStopped(takeSeconds(rec));
      case 'denied': return S.micDenied;
      case 'no-device': return S.micNoDevice;
      case 'unsupported': return S.micUnsupported;
    }
  })();
  const live = rec.kind === 'recording' ? rec : null;
  const done = micMeasure(rec);
  const shown = done ?? (live ? { peakDbfs: live.peakDbfs, clipped: live.clipped } : null);
  return (
    <div className="pf-booth-mic" role="group" aria-label={t('booth.mic.title')} dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang} data-state={rec.kind}>
      <p>{t('booth.mic.what')}</p>
      <p>{t('booth.mic.permission')}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-sp-4)' }}>
        {recording
          ? <Button variant="danger" data-testid={ID.micRecord} aria-pressed="true" onClick={() => session.current?.stop()}>{S.micStop}</Button>
          : <Button variant="primary" data-testid={ID.micRecord} busy={micBusy(rec)} onClick={start}>{done ? S.micAgain : t('booth.mic.record')}</Button>}
        <Button data-testid={ID.micPlay} aria-pressed={playing} disabled={!url} onClick={play}>{t('booth.mic.playBack')}</Button>
      </div>
      <p role="status">{isolate(line)}{playing ? ` · ${S.micPlaying}` : ''}</p>
      <p data-testid={ID.micLevels} aria-label={S.micLevelsLabel} dir="auto" data-peak={shown?.peakDbfs ?? ''} data-clipped={shown?.clipped ?? ''}>
        {shown
          ? <>{isolate(fillIn(t('booth.mic.peak'), { peak: peakText(shown.peakDbfs) }))} · {isolate(fillIn(t('booth.mic.clipped'), { n: String(shown.clipped) }))}</>
          : null}
      </p>
      {done && done.peakDbfs === null ? <p>{S.micSilent}</p> : null}
      <p>{S.micDropped}</p>
    </div>
  );
}
