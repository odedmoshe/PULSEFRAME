/**
 * ADR-0019 W1: the v1 easings are sampled bit for bit as Step 0 recorded them. The same comparison as
 * `pnpm baseline:keys --check` (keys-baseline.ts), run inside the unit tests so every test run guards it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { V1_EASINGS } from '@pulseframe/core';
import { keysBaseline, type KeysBaseline } from './keys-baseline.lib.ts';

describe('keys baseline --check (in the unit tests)', () => {
  it('0 differences against docs/evidence/keys-baseline.json: 5 v1 easings × 2000 times, Float64 bits', () => {
    const was = JSON.parse(readFileSync(new URL('../../../docs/evidence/keys-baseline.json', import.meta.url), 'utf8')) as KeysBaseline;
    const now = keysBaseline();
    expect(was.count).toBe(2000);
    let diffs = 0;
    for (const e of V1_EASINGS) for (let i = 0; i < now.count; i++) if (!T.eq(was.times[i]!, now.times[i]!) || was.samples[e][i] !== now.samples[e][i]) diffs++;
    expect(diffs).toBe(0);
  });
});
