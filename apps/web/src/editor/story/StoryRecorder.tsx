/**
 * The recorder's interface (W3) on W2's engine (recorder.ts, contract recorder.contract.ts): record, stop, listen, save, record
 * again; the numeric level line (dBFS and clipped samples, never "good"); every state worded in both languages.
 *
 * PRIVACY (the lead checks these lines): the engine's release() runs (1) when the component unmounts (the effect's cleanup, through
 * RecorderSession.dispose), (2) when the dialog closes — StoryDialog calls `releaseRef.current()` on EVERY close path (button,
 * Escape, backdrop, «הקישו את המעברים», «בנו בלי הקשות»), and (3) after «שמירה». The WAV is saved only through the existing import
 * queue (Editor.importFiles → POST …/imports, via 'browser'); it is never written to localStorage, sessionStorage, IndexedDB or any
 * other upload path (story.privacy.test.ts reads this file for that).
 */
import { useEffect, useRef, useState, type MutableRefObject, type ReactElement } from 'react';
import { Button } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { useEditorState } from '../store.ts';
import { createRecorder } from './recorder.ts';
import { storyStrings } from './story.strings.ts';
import { STORY_TESTIDS as ID } from './story.testids.ts';
import { createRecorderSession, recorderSeconds, recorderStateText, recordingName, saveRecording, savedJob, takeNotice, type EngineFactory, type RecorderSession } from './story.logic.ts';
import type { RecorderState } from './recorder.contract.ts';
import './story.css';

export interface StoryRecorderProps {
  lang: 'he' | 'en';
  /** The saved recording's asset id, once the import has committed it. */
  onSaved: (assetId: string) => void;
  /** The dialog fills this with a function that releases the microphone; it calls it on every close path. */
  releaseRef?: MutableRefObject<(() => void) | null>;
  /** The engine (tests pass a fake that counts release()). */
  createEngine?: EngineFactory;
}
type Proof = { __pfStoryProof?: unknown; __pfStoryRecorderMaxMs?: number };

export function StoryRecorder({ lang, onSaved, releaseRef, createEngine = createRecorder }: StoryRecorderProps): ReactElement {
  const { editor, state: editorState } = useEditorState();
  const S = storyStrings(lang);
  const [rec, setRec] = useState<RecorderState>({ kind: 'idle' });
  const session = useRef<RecorderSession | null>(null);
  const [saving, setSaving] = useState<{ name: string; known: Set<string> } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [listenUrl, setListenUrl] = useState<string | null>(null);

  useEffect(() => {
    const g = globalThis as Proof;
    const maxMs = g.__pfStoryProof && typeof g.__pfStoryRecorderMaxMs === 'number' ? g.__pfStoryRecorderMaxMs : undefined;
    const s = createRecorderSession(createEngine, setRec, {
      ...(maxMs ? { maxMs } : {}),
      getUserMedia: (c) => (navigator.mediaDevices?.getUserMedia ? navigator.mediaDevices.getUserMedia(c) : Promise.reject(Object.assign(new Error('no microphone api'), { name: 'NotSupportedError' }))),
      createContext: () => new AudioContext(),
    });
    session.current = s;
    if (releaseRef) releaseRef.current = () => s.release();
    return () => { s.dispose(); session.current = null; if (releaseRef) releaseRef.current = null; };
  }, [createEngine, releaseRef]);

  const wav = rec.kind === 'stopped' || rec.kind === 'limit' ? rec.wav : null;
  useEffect(() => {
    if (!wav) { setListenUrl(null); return; }
    const url = URL.createObjectURL(wav);
    setListenUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [wav]);

  // the import job of the saved recording
  useEffect(() => {
    if (!saving) return;
    const j = savedJob(editorState.imports.jobs, saving.name, saving.known);
    if (j.state === 'ready' && j.assetId) { setSaving(null); setSaved(saving.name); void editor.load(editorState.doc?.id ?? '').catch(() => undefined).then(() => onSaved(j.assetId!)); }
    else if (j.state === 'failed') { setSaving(null); setFailed(true); }
  }, [editorState.imports.jobs, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => { setSaved(null); setFailed(false); void session.current?.start(); };
  const again = () => { setSaved(null); setFailed(false); session.current?.discard(); };
  const save = () => {
    if (!wav || saving) return;
    const name = recordingName(new Date(), lang);
    const known = new Set(editorState.imports.jobs.map((j) => j.jobId));
    setFailed(false);
    setSaving({ name, known });
    saveRecording(editor, wav, name);
    session.current?.release(); // the take is in the queue: nothing keeps the microphone
  };

  const text = recorderStateText(rec, S);
  const busy = rec.kind === 'asking';
  const recording = rec.kind === 'recording';
  const done = rec.kind === 'stopped' || rec.kind === 'limit';
  const notices = done ? takeNotice(rec, lang) : [];
  const uiState = saving ? 'saving' : rec.kind;
  return (
    <div className="pf-story-recorder" data-testid={ID.recorder} data-state={uiState} role="group" aria-label={S.recorderLabel}>
      <p className="pf-story-muted">{S.recordHint}</p>
      <div className="pf-story-row">
        {(rec.kind === 'idle' || rec.kind === 'denied' || rec.kind === 'no-device' || rec.kind === 'unsupported' || busy) && (
          <Button variant="primary" data-testid={ID.recStart} busy={busy} disabledReason={rec.kind === 'unsupported' ? S.recState.unsupported : undefined} onClick={start}>{S.record}</Button>
        )}
        {recording && <Button variant="danger" data-testid={ID.recStop} onClick={() => session.current?.stop()}>{S.stop}</Button>}
        {done && (
          <>
            <Button variant="primary" data-testid={ID.recSave} busy={!!saving} onClick={save}>{S.save}</Button>
            <Button data-testid={ID.recAgain} disabled={!!saving} onClick={again}>{S.recordAgain}</Button>
          </>
        )}
        {saved && !done && <Button data-testid={ID.recAgain} onClick={again}>{S.recordAgain}</Button>}
      </div>
      <p className="pf-story-state" role="status" data-testid={ID.recState}>
        {saving ? S.recState.saving : saved ? isolate(S.savedLine(saved)) : recording ? S.recording(recorderSeconds(rec), 600) : done ? isolate(rec.kind === 'limit' ? S.limitLine(recorderSeconds(rec)) : S.stoppedLine(recorderSeconds(rec))) : (text ?? '')}
        {failed && ` ${S.saveFailed}`}
      </p>
      {(recording || done) && (
        <p className="pf-story-level" data-testid={ID.recLevel} dir="auto">
          {isolate(S.levelLine(rec.peakDbfs, rec.clipped))}
          {recording && rec.device ? <span className="pf-story-muted"> · {isolate(S.deviceLine(rec.device))}</span> : null}
        </p>
      )}
      {notices.map((n) => <p key={n} className="pf-story-warn" role="status">{isolate(n)}</p>)}
      {done && listenUrl && <audio className="pf-story-audio" data-testid={ID.recListen} controls src={listenUrl} aria-label={S.listenLabel} />}
    </div>
  );
}
