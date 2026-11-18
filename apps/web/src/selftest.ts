/**
 * Browser self-test (diagnostics): checks, in this browser's real WebAudio, that the audio chain used by preview and
 * browser export produces the same samples as the reference mixer the server export uses.
 * Result: document.body.dataset.ready = '1' and a JSON report in #out / window.__pfSelfTest.
 */
import './strictPage.ts';
import { audioEffectParams, type AudioFxParams } from '@pulseframe/core';
import { mixClip, type PlannedAudioClip } from '@pulseframe/engine';
import { FX_FIXTURE_SECONDS, fxFixture, renderFx } from '@pulseframe/engine/audiofx/kernels/index.ts';
import { plannedClipInput } from './audioGraph.ts';
import { curveHash, curveSamples, pathPointsMs } from './curveHash.ts';
import './editor/lifeline/lifeline.selftest.ts'; // life line (ADR-0021): window.__pfLife, the core calendar in this browser, for proof:lifeline

/**
 * Sound-effect kernels in this browser (ADR-0010 D6): window.__pfFxRun(type, params) runs one kernel over the fixed fixture
 * (48 kHz, FX_FIXTURE_SECONDS, 1024-frame blocks, at = 0; the same input and harness as the golden hashes in Node) and returns
 * the output as base64 of little-endian Float32 interleaved stereo, so the preview proof can compare it with Node's.
 */
function fxRun(type: string, params: AudioFxParams = {}): { base64: string; frames: number; ms: number } {
  const input = fxFixture(48000);
  const t = performance.now();
  const out = renderFx(type, audioEffectParams(type, params), input, { sampleRate: 48000 });
  const ms = performance.now() - t;
  const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), frames: out.length >> 1, ms: +ms.toFixed(2) };
}
(window as unknown as { __pfFxRun: typeof fxRun; __pfFxFixtureSeconds: number }).__pfFxRun = fxRun;
(window as unknown as { __pfFxFixtureSeconds: number }).__pfFxFixtureSeconds = FX_FIXTURE_SECONDS;
// keyframe curves (ADR-0019, keyframes-proof P12): the SHA-256 of 1e5 samples of the one sampler over every easing and the
// shutter-tap times (curveHash.ts, the same module Node runs), with the sampler's ns/sample here, and pathPoints' cost
(window as unknown as { __pfCurveHash: typeof curveHash }).__pfCurveHash = curveHash;
(window as unknown as { __pfCurveSamples: typeof curveSamples }).__pfCurveSamples = curveSamples;
(window as unknown as { __pfPathPointsMs: typeof pathPointsMs }).__pfPathPointsMs = pathPointsMs;

async function audioChainMatchesReference() {
  const sr = 48000, total = 60000;
  const clips: PlannedAudioClip[] = [
    // fades + duck dip + balance, starting mid-timeline
    { clipId: 'a', trackId: 't', assetId: 'x', at: 4800, length: 48000, source: 0, speed: 1, gain: 0.8, pan: -0.5, fade: [{ s: 0, g: 0 }, { s: 9600, g: 1 }, { s: 38400, g: 1 }, { s: 48000, g: 0 }], duck: [{ s: 0, g: 1 }, { s: 14400, g: 1 }, { s: 19200, g: 0.25 }, { s: 28800, g: 0.25 }, { s: 43200, g: 1 }, { s: 48000, g: 1 }] },
    // plain clip overlapping it, panned the other way
    { clipId: 'b', trackId: 'u', assetId: 'y', at: 0, length: 30000, source: 0, speed: 1, gain: 0.5, pan: 0.25, fade: [{ s: 0, g: 1 }, { s: 30000, g: 1 }], duck: [{ s: 0, g: 1 }, { s: 30000, g: 1 }], vol: [{ s: 0, g: 1 }, { s: 6000, g: 1 }, { s: 12000, g: 0.2 }, { s: 21000, g: 1.5 }, { s: 30000, g: 1.5 }] },
  ];
  // Deterministic non-trivial stereo signal.
  const signal = (len: number, k: number) => { const f = new Float32Array(len * 2); for (let i = 0; i < len; i++) { f[i * 2] = Math.sin(i * 0.013 * k) * 0.7; f[i * 2 + 1] = Math.cos(i * 0.007 * k) * 0.6; } return f; };
  const pcm = [signal(48000, 1), signal(30000, 2)];
  const reference = new Float32Array(total * 2);
  clips.forEach((c, i) => mixClip(reference, 0, c, pcm[i]!, 0));
  const ctx = new OfflineAudioContext(2, total, sr);
  clips.forEach((c, i) => {
    const buf = ctx.createBuffer(2, c.length, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let k = 0; k < c.length; k++) { L[k] = pcm[i]![k * 2]!; R[k] = pcm[i]![k * 2 + 1]!; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(plannedClipInput(ctx, c, sr, ctx.destination, c.at / sr, 0));
    src.start(c.at / sr);
  });
  const out = await ctx.startRendering();
  const L = out.getChannelData(0), R = out.getChannelData(1);
  let maxErr = 0, at = 0;
  for (let i = 0; i < total; i++) { const e = Math.max(Math.abs(L[i]! - reference[i * 2]!), Math.abs(R[i]! - reference[i * 2 + 1]!)); if (e > maxErr) { maxErr = e; at = i; } }
  // Mid-clip start (what the preview does when playback begins inside a clip): render only the second half.
  const half = 24000, c = clips[0]!;
  const ctx2 = new OfflineAudioContext(2, c.length - half, sr);
  const buf2 = ctx2.createBuffer(2, c.length, sr);
  for (let k = 0; k < c.length; k++) { buf2.getChannelData(0)[k] = pcm[0]![k * 2]!; buf2.getChannelData(1)[k] = pcm[0]![k * 2 + 1]!; }
  const src2 = ctx2.createBufferSource();
  src2.buffer = buf2;
  src2.connect(plannedClipInput(ctx2, c, sr, ctx2.destination, -half / sr, half));
  src2.start(0, half / sr);
  const out2 = await ctx2.startRendering();
  const ref2 = new Float32Array(c.length * 2);
  mixClip(ref2, c.at, c, pcm[0]!, 0);
  let maxErrMid = 0;
  for (let i = 0; i < c.length - half; i++) maxErrMid = Math.max(maxErrMid, Math.abs(out2.getChannelData(0)[i]! - ref2[(half + i) * 2]!), Math.abs(out2.getChannelData(1)[i]! - ref2[(half + i) * 2 + 1]!));
  return { samples: total, maxAbsError: maxErr, worstSample: at, maxAbsErrorMidClipStart: maxErrMid };
}

const report: Record<string, unknown> = { userAgent: navigator.userAgent };
try { report.audioChain = await audioChainMatchesReference(); } catch (e) { report.error = String(e); }
(window as unknown as { __pfSelfTest: unknown }).__pfSelfTest = report;
document.getElementById('out')!.textContent = JSON.stringify(report, null, 2);
document.body.dataset.ready = '1';
