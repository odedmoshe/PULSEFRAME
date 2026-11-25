/**
 * The microphone recorder's contract (wave 7 story track; lead pre-pass). W2 builds the engine (recorder.ts, apps/web/public/pf-recorder.js);
 * W3 builds the interface on it (StoryRecorder.tsx). Ports are injected so the engine is unit-tested without a browser.
 *
 * - Capture: getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
 *   → MediaStreamAudioSourceNode → the static worklet '/pf-recorder.js' (the page policy allows only same-origin scripts) which
 *   posts mono Int16 blocks of at least RECORDER_LIMITS.blockSamples, the running peak and a count of full-scale samples. Never
 *   connected to the output. The default device only.
 * - Stop builds a 16-bit mono WAV at the context's own rate (encodeWav). Nothing is stored until «שמירה»: then the WAV goes
 *   through the import queue (POST …/imports, via 'browser'), named with a date only («קריינות 2026-11-25 14.32.wav»).
 * - Release (privacy, C10): every track of the stream is stopped and the context closed on stop, on «הקלטה מחדש», on closing the
 *   dialog, on unmount and when the page is hidden. A check reads readyState === 'ended' for each track (U12).
 * - The limit: the engine stops by itself when the sample count reaches maxMs at the context's rate (state 'limit').
 * - The meter shows numbers (dBFS of the peak, clipped samples); it never says the recording is good.
 */
export const RECORDER_LIMITS = {
  /** The recorder stops by itself after this many milliseconds of samples (core STORY.maxRecordMs). */
  maxMs: 600_000,
  /** Samples per worklet message, at least. */
  blockSamples: 2048,
  /** Peak under this many dBFS while speaking is shown as «שקט מדי». */
  quietDbfs: -38,
  worklet: '/pf-recorder.js',
} as const;
export type RecorderState =
  | { kind: 'idle' } | { kind: 'unsupported' } | { kind: 'asking' } | { kind: 'denied' } | { kind: 'no-device' }
  | { kind: 'recording'; samples: number; rate: number; peakDbfs: number | null; clipped: number; device: string | null }
  | { kind: 'stopped' | 'limit'; samples: number; rate: number; peakDbfs: number | null; clipped: number; wav: Blob };
/** What the engine needs from the browser (injected; the tests pass fakes). */
export interface RecorderPorts {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  /** A new AudioContext (its own rate). */
  createContext(): AudioContext;
  /** Called on every state change. */
  onState(state: RecorderState): void;
  /** Test hook of the proof (U5): a lower limit than RECORDER_LIMITS.maxMs. */
  maxMs?: number;
}
export interface StoryRecorderHandle {
  start(): Promise<void>;
  stop(): void;
  /** Drops the take and releases the microphone (also «הקלטה מחדש» before starting again). */
  discard(): void;
  /** Releases everything (dialog closed, unmount, page hidden). Idempotent. */
  release(): void;
  /** The tracks of the current stream, for the release check (U12); [] when none. */
  tracks(): readonly MediaStreamTrack[];
}
