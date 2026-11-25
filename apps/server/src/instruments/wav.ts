/**
 * WAV reader of recorded instruments (wave 7 instruments track). Pure over bytes; throws only InstrumentError (fuzz check I19).
 * LEAD: signatures (final). BUILDER W2: bodies.
 * Accepts RIFF/WAVE with fmt PCM 16/24/32-bit integer, IEEE float 32, or WAVE_FORMAT_EXTENSIBLE of those; 1 or 2 channels; a `smpl`
 * chunk's first loop. Decodes to Int32Array at a 24-bit scale (float: Math.round(f · 2^23), clamped). Anything else (FLAC, Ogg, AIFF,
 * 8-bit, more channels, a truncated chunk) is InstrumentError('format' | 'unreadable').
 */
import { InstrumentError } from './contract.ts';

export interface WavInfo { rate: number; channels: 1 | 2; bits: 16 | 24 | 32; float: boolean; dataOffset: number; frames: number; loop: { start: number; end: number } | null }
/** The format, the data chunk's place and the loop, from the first bytes of the file (the caller reads more when `need` says so). */
export function readWavInfo(_head: Uint8Array): WavInfo { throw new InstrumentError('unreadable', 'the WAV reader is not built in this build yet'); }
/** `frames` frames from `fromFrame` of the data chunk (bytes = exactly those frames), interleaved, at a 24-bit integer scale. */
export function decodePcm(_bytes: Uint8Array, _info: WavInfo, _fromFrame: number, _frames: number): Int32Array { throw new InstrumentError('unreadable', 'the WAV reader is not built in this build yet'); }
