/**
 * The sampler voice (wave 7 instruments track; builder W1 owns this file). Every bank here is a SYNTHETIC TEST BANK written by code
 * (sines, decays, constants, impulses: packages/evals/src/instruments-proof.sampler.ts), held in memory; no file of any instrument is
 * read. Nothing here listens: lengths in samples, peaks, levels, frequencies, spectra, hashes.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTS_LIMITS, KIT_PART_ROLES, MUSIC_SAMPLER_VERSION, musicLayout } from '@pulseframe/core';
import { arrange, clicks } from './arrange.ts';
import { compose } from './compose.ts';
import { renderMusic, sampledNotesOf } from './render.ts';
import { decodedBytesOf, KERNEL, KERNEL_PHASES, KERNEL_TAPS, kernelTable, midiVelocity, planZones, renderSampled, SamplerBankError, SamplerRangeError, selectRegions, velocityGain, type ResolvedBank, type SampledNote } from './sampler.ts';
import { styleSpec } from './styles.ts';
import {
  checkI1, checkI14, checkI2, checkI3, checkI3b, checkI4, checkI5, checkI6, GOLDEN_RENDERS, goldenKey, playNote, readInstrumentsGolden, samplerTestBank, sineZone,
  testInstrument, testPart, testRegion, testZone,
} from '../../../../packages/evals/src/instruments-proof.sampler.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const musicGolden = JSON.parse(fs.readFileSync(path.join(here, '..', 'music.golden.json'), 'utf8')) as { bars: number; seed: number; sha256: Record<string, string> };
const calmNotes = (bars = 8, seed = 1) => sampledNotesOf('music.calm', bars, seed, ['pad', 'double', 'arp', 'lead']);

describe('sampler (lead rows)', () => {
  it('every note of the arranger is tagged with its part: a pitched role of the style, drum.<kind>, or click', () => {
    const layout = musicLayout('music.calm', 16);
    const spec = styleSpec('music.calm');
    const notes = arrange(spec, layout, compose(spec, layout, 1), 1);
    const roles = new Set(spec.parts.map((p) => p.role as string));
    for (const n of notes) expect(roles.has(n.part) || /^drum\.[a-z]+$/.test(n.part), n.part).toBe(true);
    expect(new Set(notes.filter((n) => (KIT_PART_ROLES as readonly string[]).includes(n.part)).map((n) => n.part))).toEqual(roles);
    expect(clicks(layout).every((n) => n.part === 'click')).toBe(true);
  });
  it('the sampler is built: planZones answers for an empty request', () => {
    expect(planZones([], { parts: {} })).toEqual({ needs: [], outOfRange: null });
  });
});

describe('with no bank, the built-in music is byte for byte what it was', () => {
  it('music.calm and music.cinematic, 8 bars, seed 1: equal to music.golden.json, with and without an explicit bank: undefined', async () => {
    for (const id of ['music.calm', 'music.cinematic']) {
      expect(sha((await renderMusic(id, musicGolden.bars, musicGolden.seed)).wav)).toBe(musicGolden.sha256[id]);
      expect(sha((await renderMusic(id, musicGolden.bars, musicGolden.seed, { bank: undefined })).wav)).toBe(musicGolden.sha256[id]);
    }
  }, 120_000);
  it('a click-only render ignores a bank (the onset test stays the synthesiser\'s)', async () => {
    const a = await renderMusic('music.calm', 4, 1, { clickOnly: true }), b = await renderMusic('music.calm', 4, 1, { clickOnly: true, bank: samplerTestBank() });
    expect(a.wav.equals(b.wav)).toBe(true);
  });
});

describe('the kernel', () => {
  it('4 tables × 4,096 phases × 8 taps (1 MiB); every row sums to 1; table 0 phase 0 is the unit impulse; r picks the table', () => {
    expect(KERNEL.length * 8).toBe(1024 * 1024);
    for (let row = 0; row < KERNEL.length / KERNEL_TAPS; row++) {
      let s = 0;
      for (let k = 0; k < KERNEL_TAPS; k++) s += KERNEL[row * KERNEL_TAPS + k]!;
      expect(Math.abs(s - 1)).toBeLessThan(1e-12);
    }
    expect([...KERNEL.subarray(0, 8)]).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
    expect([0.5, 1, 1.0001, 1.26, 1.3, 1.59, 1.6, 2, 2.0001].map(kernelTable)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, -1]);
    expect(KERNEL_PHASES).toBe(4096);
  });
});

describe('proof checks on in-memory banks (I1–I6, I3b)', () => {
  const pass = (r: { status: string; measured?: unknown }) => { if (r.status !== 'pass') console.log(JSON.stringify(r.measured)); expect(r.status).toBe('pass'); };
  it('I1: at r = 1, amp_veltrack 0, 0 dB, renderSampled equals the source from sample 32 to the start of release (table 0 is full band)', () => pass(checkI1()));
  it('I2: 440 Hz at 44.1 kHz sounds 440 Hz ± 0.05 cent at its root; ±1 and ±3 semitones within ± 0.1 cent (exact phase, stepQ integer)', () => pass(checkI2()));
  it('I3: 1 kHz up a semitone: all but the fundamental below −60 dB', () => pass(checkI3()));
  it('I3b: 15 kHz +7 semitones: largest alias below 20 kHz below −40 dB (8-tap kernel aliasing, measured)', () => { const r = checkI3b(); console.log('I3b', JSON.stringify(r.measured)); pass(r); });
  it('I4: velocity 0.3 plays the soft layer, 0.9 the loud; the amp_veltrack gain matches its formula within 0.01 dB', () => pass(checkI4()));
  it('I5: release to −60 dB within its time ± 2 ms; the note\'s first and last samples are 0', () => pass(checkI5()));
  it('I6: a 0.25 s loop held 3 s holds its level within 0.5 dB, and no seam step exceeds the largest step of the source', () => pass(checkI6()));
});

describe('regions, gains and envelopes', () => {
  it('layering: every matching region sounds; locc/hicc at the fixed CC, sw_default, seq_position 1 and the region covering 0 decide', () => {
    const z = sineZone(48000, 440, 0.1);
    const inst = testInstrument('sel', [z], [
      testRegion({ lokey: 60, hikey: 72 }),
      testRegion({ lokey: 60, hikey: 72, locc: { 1: 64 } }), // CC1 is 20: out
      testRegion({ lokey: 60, hikey: 72, hicc: { 1: 30 } }), // in
      testRegion({ lokey: 60, hikey: 72, sw: { lokey: 24, hikey: 26, last: 25, default: 24 } }), // switched off by default
      testRegion({ lokey: 60, hikey: 72, sw: { lokey: 24, hikey: 26, last: 24, default: 24 } }), // on
      testRegion({ lokey: 60, hikey: 72, seqPosition: 2 }),
      testRegion({ lokey: 60, hikey: 72, lorand: 0.5, hirand: 1 }),
      testRegion({ lokey: 60, hikey: 72, xfin: { cc: 1, lo: 0, hi: 40 } }), // gain 0.5
      testRegion({ lokey: 60, hikey: 72, xfout: { cc: 1, lo: 0, hi: 20 } }), // gain 0: out
    ], { 1: 20 });
    expect(selectRegions(inst, 66, 100).map((r) => inst.regions.indexOf(r))).toEqual([0, 2, 4, 7]);
    expect(selectRegions(inst, 59, 100)).toEqual([]);
    // a layered pair is the sum of its regions
    const one = testPart(testInstrument('a', [z], [testRegion({ keycenter: 69, ampVeltrack: 0 })]));
    const two = testPart(testInstrument('b', [z], [testRegion({ keycenter: 69, ampVeltrack: 0 }), testRegion({ keycenter: 69, ampVeltrack: 0 })]));
    const a = playNote(one, 69, 1, 2000, 4800), b = playNote(two, 69, 1, 2000, 4800);
    for (let i = 0; i < 4800; i++) expect(b.L[i]).toBeCloseTo(2 * a.L[i]!, 12);
  });
  it('velocity: the part maps 0..1 to MIDI; amp_velcurve_N points join linearly with (0, 0) and (127, 1) implied; negative veltrack inverts', () => {
    expect(midiVelocity({ vel: [40, 100] }, 0)).toBe(40);
    expect(midiVelocity({ vel: [40, 100] }, 1)).toBe(100);
    expect(midiVelocity({ vel: [1, 127] }, 0.3)).toBe(39);
    expect(velocityGain({ ampVeltrack: 100, velcurve: [[64, 0.8]] }, 32)).toBeCloseTo(0.4, 12);
    expect(velocityGain({ ampVeltrack: 100, velcurve: [[64, 0.8]] }, 127)).toBe(1);
    expect(velocityGain({ ampVeltrack: 0, velcurve: null }, 10)).toBe(1);
    expect(velocityGain({ ampVeltrack: -100, velcurve: null }, 127)).toBeCloseTo(1 / (127 * 127), 12);
  });
  it('volume, the kit gain and pan as balance; a stereo zone keeps its channels', () => {
    const z = testZone(48000, 2, 9600, (n, ch) => (ch === 0 ? 0.5 : -0.25) * Math.sin(n / 20), { start: 0, end: 9599 });
    const ref = playNote(testPart(testInstrument('g', [z], [testRegion({ ampVeltrack: 0, loopMode: 'loop_continuous' })])), 60, 1, 4800, 4800);
    const quiet = playNote(testPart(testInstrument('g', [z], [testRegion({ ampVeltrack: 0, loopMode: 'loop_continuous', volume: -3 })]), { gainDb: -3 }), 60, 1, 4800, 4800);
    const right = playNote(testPart(testInstrument('g', [z], [testRegion({ ampVeltrack: 0, loopMode: 'loop_continuous', pan: 50 })])), 60, 1, 4800, 4800);
    for (const i of [100, 777, 3000]) {
      expect(quiet.L[i]! / ref.L[i]!).toBeCloseTo(10 ** (-6 / 20), 10);
      expect(right.L[i]! / ref.L[i]!).toBeCloseTo(0.5, 12);
      expect(right.R[i]).toBe(ref.R[i]);
      expect(ref.R[i]! / ref.L[i]!).toBeCloseTo(-0.5, 4);
    }
  });
  it('the attack is linear from 0 over at least 32 frames; attackMax and releaseMax cap the instrument', () => {
    const z = testZone(48000, 1, 4800, () => 0.5, { start: 0, end: 4799 });
    const part = testPart(testInstrument('e', [z], [testRegion({ ampVeltrack: 0, loopMode: 'loop_continuous', attack: 0.01, release: 1 })]), { attackMax: 0, releaseMax: 0.1 });
    const { L, n } = playNote(part, 60, 1, 4800, 96000);
    expect(L[0]).toBe(0);
    for (let i = 0; i < INSTRUMENTS_LIMITS.minAttackFrames; i++) expect(L[i]).toBeCloseTo((0.5 * i) / INSTRUMENTS_LIMITS.minAttackFrames, 6);
    expect(n).toBe(4800 + 4800); // gate + releaseMax
    expect(L[n - 1]).toBe(0);
  });
  it('a zone that ends before the gate ends the note there (plus its release); one_shot ignores the gate', () => {
    const z = sineZone(48000, 440, 0.05);
    const short = playNote(testPart(testInstrument('s', [z], [testRegion({ keycenter: 69, release: 0.01 })])), 69, 1, 48000, 96000);
    expect(short.n).toBe(2400 + 480);
    const shot = playNote(testPart(testInstrument('s', [z], [testRegion({ keycenter: 69, release: 0.01, loopMode: 'one_shot' })])), 69, 1, 100, 96000);
    expect(shot.n).toBe(2400 + 480);
  });
  it('loop_sustain loops while the gate is open, then plays on into the tail after the loop', () => {
    // frames 0..999 a constant 0.25 (loop 200..399), 1000.. a constant −0.5: only the tail after the loop reads −0.5
    const z = testZone(48000, 1, 3000, (n) => (n < 1000 ? 0.25 : -0.5), { start: 200, end: 399 });
    const part = testPart(testInstrument('ls', [z], [testRegion({ ampVeltrack: 0, loopMode: 'loop_sustain', release: 0.5 })]));
    const { L } = playNote(part, 60, 1, 9000, 40000);
    expect(Math.min(...L.subarray(100, 9000))).toBeGreaterThan(0); // looped: never reached the tail while held
    expect(Math.min(...L.subarray(9000, 12000))).toBeLessThan(0); // after the gate: into the tail
  });
});

describe('planZones: range and frames before anything is made', () => {
  const z = sineZone(44100, 440, 0.2);
  const part = testPart(testInstrument('one', [z], [testRegion({ keycenter: 69, lokey: 40, hikey: 100 })]));
  it('a note that needs r > 2, or has no region, is out of range: the first such note is named', () => {
    // 44.1 kHz at its root: r = 0.919; +13 semitones: 1.946 (in); +14: 2.06 (out)
    expect(planZones([{ part: 'lead', midi: 82, vel: 1, gate: 100 }], { parts: { lead: part } }).outOfRange).toBeNull();
    const notes: SampledNote[] = [{ part: 'lead', midi: 70, vel: 1, gate: 100 }, { part: 'lead', midi: 83, vel: 1, gate: 100 }, { part: 'lead', midi: 30, vel: 1, gate: 100 }];
    expect(planZones(notes, { parts: { lead: part } }).outOfRange).toEqual({ part: 'lead', instrument: 'one', midi: 83 });
    expect(planZones([notes[2]!], { parts: { lead: part } }).outOfRange).toEqual({ part: 'lead', instrument: 'one', midi: 30 });
  });
  it('a recorded render with a note out of range is refused before any sample is made, as a whole (never a synthesised note in its part)', async () => {
    const bank = samplerTestBank();
    const narrow = { ...bank.parts.lead!, instrument: { ...bank.parts.lead!.instrument, regions: bank.parts.lead!.instrument.regions.map((r) => ({ ...r, hikey: Math.min(r.hikey, 70) })) } };
    const err = await renderMusic('music.calm', 8, 1, { bank: { ...bank, parts: { ...bank.parts, lead: narrow, arp: narrow } } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SamplerRangeError);
    expect((err as SamplerRangeError).outOfRange.instrument).toBe('piano');
  });
  it('needs: one row per zone, its largest need, sorted; the decoded size of the test kit is far inside the limit', () => {
    const bank = samplerTestBank();
    const { needs, outOfRange } = planZones(calmNotes(64), bank);
    expect(outOfRange).toBeNull();
    expect(needs.map((n) => `${n.instrument}/${n.zone}`)).toEqual([...new Set(needs.map((n) => `${n.instrument}/${n.zone}`))].sort((a, b) => (a.split('/')[0]! < b.split('/')[0]! ? -1 : a.split('/')[0]! > b.split('/')[0]! ? 1 : Number(a.split('/')[1]) - Number(b.split('/')[1]))));
    for (const n of needs) expect(n.frames).toBeLessThanOrEqual(bank.parts.pad!.instrument.id === n.instrument ? 44100 : 72000);
    expect(decodedBytesOf(needs, bank)).toBeLessThan(INSTRUMENTS_LIMITS.maxDecodedBytes);
  });
  it('decoding only the frames planZones asks for gives the same bytes as the whole zones (bytes depend on the files, not on the decode)', async () => {
    const bank = samplerTestBank();
    const { needs } = planZones(calmNotes(8), bank);
    const cut = (inst: ResolvedBank['parts']['pad']) => {
      const i = inst!.instrument;
      return { ...inst!, instrument: { ...i, zones: i.zones.map((z, zi) => { const need = needs.find((n) => n.instrument === i.id && n.zone === zi)?.frames ?? 0; return { ...z, frames: need, samples: z.samples.slice(0, need * z.channels) }; }) } };
    };
    const truncated: ResolvedBank = { ...bank, parts: { pad: cut(bank.parts.pad), double: cut(bank.parts.double), arp: cut(bank.parts.arp), lead: cut(bank.parts.lead) } };
    expect(needs.some((n) => n.frames < (n.instrument === 'piano' ? 72000 : 44100))).toBe(true); // something really was left undecoded
    const a = await renderMusic('music.calm', 8, 1, { bank }), b = await renderMusic('music.calm', 8, 1, { bank: truncated });
    expect(a.wav.equals(b.wav)).toBe(true);
    // a zone whose samples hold fewer frames than it claims is refused, never read as silence
    const zones = truncated.parts.arp!.instrument.zones.map((z) => (z.frames > 0 ? { ...z, samples: z.samples.slice(0, (z.frames - 1) * z.channels) } : z));
    const piano = { ...truncated.parts.arp!, instrument: { ...truncated.parts.arp!.instrument, zones } };
    const malformed: ResolvedBank = { ...truncated, parts: { ...truncated.parts, arp: piano, lead: { ...piano, vel: truncated.parts.lead!.vel } } };
    const err = await renderMusic('music.calm', 8, 1, { bank: malformed }).catch((e: unknown) => e);
    expect((err as SamplerBankError).reason).toBe('zone_short');
  }, 120_000);
});

describe('all or nothing: the bank is the whole kit or the render is refused', () => {
  it('a missing part, an extra part, another kit or another instrument: SamplerBankError before anything is made', async () => {
    const bank = samplerTestBank();
    const { pad: _pad, ...noPad } = bank.parts;
    for (const [b, reason] of [
      [{ ...bank, parts: noPad }, 'parts'],
      [{ ...bank, parts: { ...bank.parts, bass: bank.parts.pad } }, 'parts'],
      [{ ...bank, kitId: 'kit.calm.other' }, 'kit'],
      [{ ...bank, version: 2 }, 'kit'],
      [{ ...bank, parts: { ...bank.parts, pad: bank.parts.arp } }, 'parts'],
    ] as const) {
      const err = await renderMusic('music.calm', 4, 1, { bank: b as ResolvedBank }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SamplerBankError);
      expect((err as SamplerBankError).reason).toBe(reason);
    }
    await expect(renderMusic('music.pop', 4, 1, { bank })).rejects.toThrow(SamplerBankError); // a style without this kit
  });
  it('every note of every kit part is sampled: silencing the bank silences exactly those parts', async () => {
    const bank = samplerTestBank();
    const mute = (p: ResolvedBank['parts']['pad']) => ({ ...p!, gainDb: -60 });
    const quiet: ResolvedBank = { ...bank, parts: { pad: mute(bank.parts.pad), double: mute(bank.parts.double), arp: mute(bank.parts.arp), lead: mute(bank.parts.lead) } };
    const a = await renderMusic('music.calm', 8, 1, { bank }), q = await renderMusic('music.calm', 8, 1, { bank: quiet });
    expect(q.rms).toBeLessThan(a.rms); // the kit parts carried level, and nothing synthesised replaced them
    expect(a.wav.equals(q.wav)).toBe(false);
  }, 60_000);
});

describe('determinism', () => {
  it('I8: the synthetic test kit renders twice with equal bytes, equal to instruments.golden.json', async () => {
    const golden = readInstrumentsGolden();
    expect(golden.sampler).toBe(MUSIC_SAMPLER_VERSION);
    expect(Object.keys(golden.renders).sort()).toEqual(GOLDEN_RENDERS.map(goldenKey).sort());
    for (const g of GOLDEN_RENDERS) {
      const a = await renderMusic(g.styleId, g.bars, g.seed, { bank: samplerTestBank() }), b = await renderMusic(g.styleId, g.bars, g.seed, { bank: samplerTestBank() });
      expect(a.wav.equals(b.wav)).toBe(true);
      expect(sha(a.wav)).toBe(golden.renders[goldenKey(g)]);
    }
  }, 120_000);
  it('a note renders the same whatever was rendered before it, and planZones is the same for any order of the notes', () => {
    const bank = samplerTestBank();
    const notes = calmNotes(8).slice(0, 60);
    const once = (ns: readonly SampledNote[]) => new Map(ns.map((n) => { const L = new Float64Array(96000), R = new Float64Array(96000); const k = renderSampled(bank.parts[n.part]!, n.midi, n.vel, n.gate, L, R); return [notes.indexOf(n), sha(Buffer.from(L.buffer, 0, k * 8)) + sha(Buffer.from(R.buffer, 0, k * 8))]; }));
    const forward = once(notes), backward = once([...notes].reverse());
    for (const [k, v] of forward) expect(backward.get(k)).toBe(v);
    const shuffled = [...notes].sort((a, b) => ((a.midi * 7919 + a.gate) % 13) - ((b.midi * 7919 + b.gate) % 13));
    expect(planZones(shuffled, bank)).toEqual(planZones(notes, bank));
  });
  it('the source of the sampler and the renderer reads no clock and no platform randomness (M9 scans the rest)', () => {
    for (const f of ['sampler.ts', 'render.ts']) {
      const src = fs.readFileSync(path.join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(/\bDate\b/.test(src), `${f}: Date`).toBe(false);
      expect(/Math\.random/.test(src), `${f}: Math.random`).toBe(false);
    }
  });
  it('no drift over a long note: impulses every 4,800 source frames peak exactly where integer arithmetic puts them, to the end of 8 s', () => {
    for (const [rate, semis] of [[48000, 0], [44100, 7], [44100, -5]] as const) {
      const z = testZone(rate, 1, 12 * rate, (n) => (n % 4800 === 0 ? 0.9 : 0), null, 'impulses'); // longer than any read: no zone end inside 8 s
      const part = testPart(testInstrument('imp', [z], [testRegion({ keycenter: 60, ampVeltrack: 0, release: 0.01 })]));
      const out = playNote(part, 60 + semis, 1, 8 * 48000 - 480, 8 * 48000).L;
      // closed form in exact integers (BigInt): output frame i reads position Q(i) = floor((i·stepQ + 2048) / 4096) in 1/4096 frames;
      // impulse k peaks at the frame whose Q is nearest to k·4800·4096
      const stepQ = BigInt(Math.round((rate / 48000) * 2 ** (semis / 12) * 2 ** 24));
      const Q = (i: bigint) => (i * stepQ + 2048n) / 4096n;
      let checked = 0, lastFrame = 0;
      for (let k = 1; ; k++) {
        const target = BigInt(k * 4800 * 4096);
        let i = (target * 4096n) / stepQ;
        while (Q(i + 1n) <= target) i++;
        const best = target - Q(i) <= Q(i + 1n) - target ? i : i + 1n;
        const at = Number(best);
        if (at >= 8 * 48000 - 1000) break;
        let m = at - 3;
        for (let j = at - 3; j <= at + 3; j++) if (Math.abs(out[j]!) > Math.abs(out[m]!)) m = j;
        expect(m, `impulse ${k} at ${rate} Hz, ${semis} semitones`).toBe(at);
        if (semis === 0) expect(out[at]).toBe(z.samples[k * 4800]! / 8388608);
        checked++; lastFrame = at;
      }
      expect(checked).toBeGreaterThan(50);
      expect(lastFrame).toBeGreaterThan(7 * 48000);
    }
  });
});

describe('memory: one render at a time, nothing decoded kept after it', () => {
  it('the kernel tables are the only module state of the sampler (1 MiB); render.ts keeps no state between renders', () => {
    for (const f of ['sampler.ts', 'render.ts']) {
      const src = fs.readFileSync(path.join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const topLevel = [...src.matchAll(/^(?:export )?(?:let|var|const) ([A-Za-z0-9_]+)\s*=\s*new\s+([A-Za-z0-9_]+)/gm)].map((m) => `${m[1]}:${m[2]}`);
      expect(topLevel, f).toEqual(f === 'sampler.ts' ? ['KERNEL:Float64Array'] : []);
      expect(/^(?:export )?let /m.test(src), `${f}: a module-level let`).toBe(false);
    }
  });
  it('after a recorded render the bank\'s decoded samples can be collected (no reference kept anywhere)', async () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    let bank: ResolvedBank | null = samplerTestBank();
    const ref = new WeakRef(bank.parts.pad!.instrument.zones[2]!.samples);
    await renderMusic('music.calm', 4, 1, { bank });
    bank = null;
    for (let i = 0; i < 5 && ref.deref(); i++) { await new Promise((r) => setImmediate(r)); gc(); }
    expect(ref.deref()).toBeUndefined();
  });
});

describe('I14: the track checks hold for recorded renders of the synthetic test kit', () => {
  it('M1, M6, M7 and M8 at 4, 7, 16, 33 and 64 bars', async () => {
    const r = await checkI14([4, 7, 16, 33, 64]);
    console.log('I14', JSON.stringify(r.measured));
    expect(r.status).toBe('pass');
  }, 300_000);
});
