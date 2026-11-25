/**
 * The microphone recorder engine (W2; contract recorder.contract.ts). LEAD PRE-PASS: final signatures only. Until built,
 * createRecorder reports the honest 'unsupported' state and never asks for the microphone.
 */
import type { RecorderPorts, StoryRecorderHandle } from './recorder.contract.ts';

/** True once the engine is built (W2 flips it). */
export const RECORDER_BUILT: boolean = false;

/** A 16-bit PCM mono WAV of `samples` at `rate` (RIFF header, little-endian). */
export function encodeWav(_samples: Int16Array, _rate: number): Uint8Array {
  throw new Error('encodeWav: not built in this build yet');
}

export function createRecorder(ports: RecorderPorts): StoryRecorderHandle {
  return {
    start: async () => { ports.onState({ kind: 'unsupported' }); },
    stop: () => {}, discard: () => {}, release: () => {}, tracks: () => [],
  };
}
