/**
 * The voice-cleanup proof fixtures (voiceclean-fixtures.ts) and an in-process dry run of the proof's C1, C2 and C4 measurements on
 * the engine alone (voiceMeter, then cleanup.dehum + cleanup.denoise as clean_voice sets them at strength 0.6, without the speech
 * enhancer, which is not W1's): what the proof will find through the server, minus the server.
 */
import { describe, expect, it } from 'vitest';
import { cleanVoiceEffects, NOISE_BAND_EDGES_HZ } from '@pulseframe/core';
import { voiceMeter } from '@pulseframe/engine';
import { renderFx } from '@pulseframe/engine/audiofx/kernels/index.ts';
import { band, bestLag, between, burstRecording, coverage, lineOver, rmsDbOver, voiceRecording, VC_SR } from './voiceclean-fixtures.ts';

const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-12));

describe('voice-cleanup fixtures', () => {
  const rec = voiceRecording({ seconds: 30, seed: 1301 });
  const meter = voiceMeter();
  meter.push(rec.pcm);
  const m = meter.finish();
  it('the recording is what the plan describes: about 30 % pauses, speech at -20 dBFS RMS over the phrases, noise -48 dBFS, hum -40 dBFS', () => {
    const share = rec.pauses.reduce((s, p) => s + p.end - p.start, 0) / rec.seconds;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.38);
    expect(rec.truth.hum).toEqual({ hz: 50, lines: 4, totalDb: -40 });
    // broadband noise level from the band truth: Σ 10^(b/10)·width/24000 over the bands is a little below the 0–24 kHz total
    const E = NOISE_BAND_EDGES_HZ, inBands = 10 * Math.log10(rec.truth.bandsDb.reduce((sum, b, j) => sum + (10 ** (b / 10) * (E[j + 1]! - E[j]!)) / 24000, 0));
    expect(inBands).toBeLessThan(-48);
    expect(inBands).toBeGreaterThan(-49.5);
  });
  it('C1 dry run: voiceMeter finds every band within ±2 dB of the truth, hum at 50 Hz, and at least 80 % of the pauses', () => {
    const worst = Math.max(...m.noise.bandsDb.map((v, j) => Math.abs(v - rec.truth.bandsDb[j]!)));
    const cov = coverage(m.noise.ranges, rec.pauses);
    console.log(`C1 dry run: worst band ${worst.toFixed(2)} dB, hum ${JSON.stringify(m.hum)}, coverage ${(100 * cov).toFixed(1)} %, SNR ${m.speech.snrDb} dB, confidence ${m.noise.confidence}`);
    expect(worst).toBeLessThanOrEqual(2);
    expect(m.hum?.hz).toBe(50);
    expect(cov).toBeGreaterThanOrEqual(0.8);
  });
  it('C2 dry run (dehum + denoise at strength 0.6): noise in pauses at least 10 dB lower, hum lines at least 30 dB lower, vowel band within 1.5 dB', () => {
    let y = rec.pcm;
    for (const e of cleanVoiceEffects({ strength: 0.6, profile: m.noise.profile, mainsHz: '50', speech: false })) y = renderFx(e.type, e.params, y, { sampleRate: VC_SR });
    const speech = between(rec.pauses, rec.seconds);
    const noise = rmsDbOver(band(rec.pcm, 0, 250, null), rec.pauses) - rmsDbOver(band(y, 0, 250, null), rec.pauses);
    const hum = [50, 100, 150, 200].map((hz) => db(lineOver(rec.pcm, 0, hz, rec.pauses)) - db(lineOver(y, 0, hz, rec.pauses)));
    const vowel = rmsDbOver(band(y, 0, 300, 3400), speech) - rmsDbOver(band(rec.pcm, 0, 300, 3400), speech);
    console.log(`C2 dry run: noise in pauses −${noise.toFixed(2)} dB; hum lines −${hum.map((v) => v.toFixed(1)).join(', ')} dB; vowel band ${vowel.toFixed(2)} dB`);
    expect(noise).toBeGreaterThanOrEqual(10);
    for (const v of hum) expect(v).toBeGreaterThanOrEqual(30);
    expect(Math.abs(vowel)).toBeLessThanOrEqual(1.5);
  });
  it('C4 dry run: every burst lines up within 1 sample after the cleanup', () => {
    const b = burstRecording(12, 1302), mb = voiceMeter();
    mb.push(b.pcm);
    let y = b.pcm;
    for (const e of cleanVoiceEffects({ strength: 0.6, profile: mb.finish().noise.profile, mainsHz: '50', speech: false })) y = renderFx(e.type, e.params, y, { sampleRate: VC_SR });
    const lags = b.onsets.map((n0) => bestLag(b.pcm, y, n0 - 240, 0.05 * VC_SR));
    expect(lags.length).toBeGreaterThanOrEqual(10);
    expect(lags.every((l) => Math.abs(l) <= 1)).toBe(true);
  });
});
