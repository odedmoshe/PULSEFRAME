/**
 * The WAV file of a built-in music track (ADR-0022), written by this code: a 44-byte RIFF header, then 16-bit PCM,
 * little-endian, stereo, 48 kHz, frames interleaved left/right. Byte order is written explicitly, so the bytes do not depend on
 * the machine.
 */
import { SR } from './dsp.ts';

export const WAV_HEADER_BYTES = 44;
/** A zeroed file of `frames` stereo frames with its header written; the caller writes the samples (wavSampleWriter). */
export function allocWav(frames: number): Buffer {
  const dataBytes = frames * 4;
  const buf = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM format chunk
  buf.writeUInt16LE(1, 20); // integer PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); // bytes a second
  buf.writeUInt16LE(4, 32); // bytes a frame
  buf.writeUInt16LE(16, 34); // bits a sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}
/** Writes sample i (interleaved: 2·frame + channel) of a file from allocWav, little-endian whatever the machine. */
export function wavSampleWriter(buf: Buffer): (i: number, v: number) => void {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return (i, v) => dv.setInt16(WAV_HEADER_BYTES + 2 * i, v, true);
}
/** The whole file for interleaved stereo samples (length = 2 · frames). */
export function writeWav(samples: Int16Array): Buffer {
  const buf = allocWav(samples.length / 2), put = wavSampleWriter(buf);
  for (let i = 0; i < samples.length; i++) put(i, samples[i]!);
  return buf;
}
/** The interleaved samples of a file written by writeWav (for tests and measurements). */
export function readWavSamples(wav: Buffer): Int16Array {
  const n = (wav.length - WAV_HEADER_BYTES) / 2;
  const out = new Int16Array(n);
  for (let i = 0, o = WAV_HEADER_BYTES; i < n; i++, o += 2) out[i] = wav.readInt16LE(o);
  return out;
}
