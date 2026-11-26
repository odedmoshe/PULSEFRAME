/**
 * The microphone card's logic (wave 8 booth, builder W2). The recorder is the story's own (createRecorderSession over createRecorder:
 * recorder.ts releases the microphone on stop, discard, release, page hidden, the sample limit, an ended track and every failure; the
 * session adds release on dispose). This file adds only the 5-second limit, the measurements and one more hidden-page release. Nothing is
 * recorded to disk or sent anywhere: the WAV is a Blob in this card's memory until the card is closed.
 */
import type { RecorderState } from './../story/recorder.contract.ts';
import { createRecorder } from '../story/recorder.ts';
import { createRecorderSession, recorderSeconds, type EngineFactory, type RecorderSession } from '../story/story.logic.ts';

/** The take is 5 seconds: the recorder stops by itself at the limit (state 'limit'). */
export const MIC_MS = 5000;
export const MIC_SECONDS = MIC_MS / 1000;

/** The session of one card: the story's recorder with the booth's limit. `factory` is the real engine; the tests pass a fake. */
export function createMicSession(onState: (s: RecorderState) => void, factory: EngineFactory = createRecorder, nav: { mediaDevices?: { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> } } = (globalThis as { navigator: Navigator }).navigator): RecorderSession {
  return createRecorderSession(factory, onState, {
    maxMs: MIC_MS,
    // the permission is asked here, from the card's own «הקלטה» button, and nowhere else in the booth
    getUserMedia: (c) => (nav.mediaDevices?.getUserMedia ? nav.mediaDevices.getUserMedia(c) : Promise.reject(Object.assign(new Error('no microphone api'), { name: 'NotSupportedError' }))),
    createContext: () => new AudioContext(),
  });
}

export interface MicMeasure { peakDbfs: number | null; clipped: number }
/** The measurements of a finished take (peak in dBFS, null for digital silence; samples at full scale), else null. Numbers only. */
export function micMeasure(s: RecorderState): MicMeasure | null {
  return s.kind === 'stopped' || s.kind === 'limit' ? { peakDbfs: s.peakDbfs, clipped: s.clipped } : null;
}
/** One decimal, an ASCII minus; digital silence has no peak. */
export const peakText = (dbfs: number | null): string => (dbfs === null ? '-∞' : dbfs.toFixed(1));
export const takeSeconds = (s: RecorderState): number => ('samples' in s && 'rate' in s ? recorderSeconds(s) : 0);
export const micBusy = (s: RecorderState): boolean => s.kind === 'asking' || s.kind === 'recording';

/**
 * One more release path, beyond the recorder's own: when the page is hidden (or goes away) the take is ended and the playback stops.
 * Returns the function that removes the listeners.
 */
export function attachHiddenRelease(doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>, win: Pick<Window, 'addEventListener' | 'removeEventListener'>, onHidden: () => void): () => void {
  const vis = () => { if (doc.visibilityState === 'hidden') onHidden(); };
  doc.addEventListener('visibilitychange', vis); win.addEventListener('pagehide', onHidden);
  return () => { doc.removeEventListener('visibilitychange', vis); win.removeEventListener('pagehide', onHidden); };
}
