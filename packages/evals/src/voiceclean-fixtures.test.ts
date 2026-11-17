/**
 * The voice-cleanup proof fixtures (voiceclean-fixtures.ts) and an in-process dry run of the proof's C1, C2 and C4 measurements on
 * the engine alone (voiceMeter, then the cleanup effects as clean_voice sets them at strength 0.6; C2 without the speech
 * enhancer): what the proof will find through the server, minus the server.
 */
import { describe, expect, it } from 'vitest';
import { cleanVoiceEffects, NOISE_BAND_EDGES_HZ } from '@pulseframe/core';
import { voiceMeter } from '@pulseframe/engine';
import { renderFx } from '@pulseframe/engine/audiofx/kernels/index.ts';
import { band, bestLag, between, burstRecording, cleanupPhaseDelay, coverage, lagAndMatch, lineOver, rmsDbOver, voiceRecording, VC_SR } from './voiceclean-fixtures.ts';

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
    const noise = rmsDbOver(band(rec.pcm, 0, 400, null), rec.pauses) - rmsDbOver(band(y, 0, 400, null), rec.pauses);
    const hum = [50, 100, 150, 200].map((hz) => db(lineOver(rec.pcm, 0, hz, rec.pauses)) - db(lineOver(y, 0, hz, rec.pauses)));
    const vowel = rmsDbOver(band(y, 0, 300, 3400), speech) - rmsDbOver(band(rec.pcm, 0, 300, 3400), speech);
    console.log(`C2 dry run: noise in pauses −${noise.toFixed(2)} dB; hum lines −${hum.map((v) => v.toFixed(1)).join(', ')} dB; vowel band ${vowel.toFixed(2)} dB`);
    expect(noise).toBeGreaterThanOrEqual(10);
    for (const v of hum) expect(v).toBeGreaterThanOrEqual(30);
    expect(Math.abs(vowel)).toBeLessThanOrEqual(1.5);
  });
  describe('C4 dry run (sync), each effect alone and the whole chain with the speech enhancer', () => {
    const b = burstRecording(12, 1302), mb = voiceMeter();
    mb.push(b.pcm);
    const chain = cleanVoiceEffects({ strength: 0.6, profile: mb.finish().noise.profile, mainsHz: '50' });
    const through = (effects: typeof chain) => { let y = b.pcm; for (const e of effects) y = renderFx(e.type, e.params, y, { sampleRate: VC_SR }); return y; };
    const lagsOf = (y: Float32Array, onsets: number[]) => onsets.map((n0) => bestLag(b.pcm, y, n0 - 240, 0.05 * VC_SR));
    const sets = [...chain.map((e) => ({ name: e.type, effects: [e] })), { name: 'the chain', effects: chain }];
    it('the recording holds at least ten tone bursts and ten noise bursts, and the chain is dehum, denoise, speech', () => {
      expect(b.onsets.length).toBeGreaterThanOrEqual(10);
      expect(b.noiseOnsets.length).toBeGreaterThanOrEqual(10);
      expect(chain.map((e) => e.type)).toEqual(['cleanup.dehum', 'cleanup.denoise', 'cleanup.speech']);
    });
    for (const set of sets) {
      it(`${set.name}: no latency: every broadband burst lines up exactly (lag 0)`, () => {
        expect(lagsOf(through(set.effects), b.noiseOnsets).every((l) => l === 0)).toBe(true);
      });
      it(`${set.name}: the carrier of every 1 kHz burst sits where the phase of its filters puts it, within one sample (the lag is a whole number)`, () => {
        const designed = cleanupPhaseDelay(set.effects, 1000);
        const lags = lagsOf(through(set.effects), b.onsets);
        console.log(`C4 dry run, ${set.name}: 1 kHz carrier lag ${[...new Set(lags)].join(', ')} samples; designed phase delay ${designed.toFixed(2)} samples`);
        expect(lags.every((l) => Math.abs(l - designed) < 1)).toBe(true);
      });
    }
    it('the filters of the chain lead a 1 kHz tone by more than two samples of phase (why a tone cannot show the latency)', () => {
      const designed = cleanupPhaseDelay(chain, 1000);
      expect(designed).toBeLessThan(-2);
      expect(designed).toBeGreaterThan(-4);
      expect(cleanupPhaseDelay(chain.filter((e) => e.type === 'cleanup.denoise'), 1000)).toBeCloseTo(0, 12);
    });
    it('a lag counts only where the sounds match: the cleaned bursts match the dry ones (normalised correlation above 0.8); silence and a broken signal match nothing', () => {
      const y = through(chain);
      const matches = [...b.noiseOnsets, ...b.onsets].map((n0) => lagAndMatch(b.pcm, y, n0 - 240, 0.05 * VC_SR).match);
      console.log(`C4 dry run: normalised correlation of the cleaned bursts with the dry ones ${Math.min(...matches).toFixed(3)} to ${Math.max(...matches).toFixed(3)}`);
      expect(Math.min(...matches)).toBeGreaterThan(0.8);
      expect(lagAndMatch(b.pcm, new Float32Array(y.length), b.noiseOnsets[0]! - 240, 0.05 * VC_SR).match).toBe(0);
      expect(lagAndMatch(b.pcm, new Float32Array(y.length).fill(NaN), b.noiseOnsets[0]! - 240, 0.05 * VC_SR)).toEqual({ lag: 0, match: 0 });
    });
    it('the measurement can fail: a cleaned sound that is 2 samples late shows as a lag of 2 on the noise bursts and more than 1 sample off the designed phase on the tone bursts', () => {
      const y = through(chain), late = new Float32Array(y.length);
      late.set(y.subarray(0, y.length - 4), 4);
      expect(lagsOf(late, b.noiseOnsets).every((l) => l === 2)).toBe(true);
      const designed = cleanupPhaseDelay(chain, 1000);
      expect(lagsOf(late, b.onsets).every((l) => Math.abs(l - designed - 2) < 1 && Math.abs(l - designed) > 1)).toBe(true);
    });
  });
});
