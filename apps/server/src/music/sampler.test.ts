/**
 * The sampler voice (wave 7 instruments track; builder W1 owns this file). The lead's rows hold the stub's honest state and the
 * byte-neutral part tag; the it.todo rows name what W1 must make pass, on in-memory banks only (no file is read).
 */
import { describe, expect, it } from 'vitest';
import { KIT_PART_ROLES, musicLayout } from '@pulseframe/core';
import { arrange, clicks } from './arrange.ts';
import { compose } from './compose.ts';
import { planZones, SamplerNotBuilt } from './sampler.ts';
import { styleSpec } from './styles.ts';

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
  it('until W1 builds it, the sampler says so', () => {
    expect(() => planZones([], { parts: {} })).toThrow(SamplerNotBuilt);
  });
  it.todo('W1 I1: at r = 1, amp_veltrack 0, 0 dB, renderSampled equals the source from sample 32 to the start of release (table 0 is full band)');
  it.todo('W1 I2: 440 Hz at 44.1 kHz sounds 440 Hz ± 0.05 cent at its root; ±1 and ±3 semitones within ± 0.1 cent (exact phase, stepQ integer)');
  it.todo('W1 I3 / I3b: 1 kHz up a semitone: all but the fundamental below −60 dB; 15 kHz +7 semitones: largest alias below 20 kHz below −40 dB');
  it.todo('W1 I4–I6: velocity layers and veltrack gain; release to −60 dB; first and last samples 0; loops hold their level with no seam step');
  it.todo('W1: planZones refuses a note that needs r > 2 or has no region (outOfRange), and never mixes sampled and synth notes in one part');
  it.todo('W1 I8 / I9 / I14: the synthetic kit renders equal twice and equal instruments.golden.json; music.golden.json unchanged; M1, M6, M7, M8 hold');
});
