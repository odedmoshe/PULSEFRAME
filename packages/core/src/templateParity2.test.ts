/**
 * The second parity golden (wave 8 owntemplate, verifier C4 and answer 2): the seven content-pack templates and the family film
 * plan byte for byte as they did on the tree before the owntemplate track touched templatePlan.ts. templateParity2.golden.json was
 * recorded by running templateParity2.fixture.ts on commit 2dcd371 (PF_RECORD_PARITY2=1 writes it). A change here is a change of
 * what an existing template or film makes: an own-template change must never cause one (its planner branch is gated on `d.own`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parity2Hashes } from './templateParity2.fixture.ts';

const FILE = new URL('./templateParity2.golden.json', import.meta.url);

describe('pack templates and the family film plan exactly as before the own templates', () => {
  it('96 plans (7 pack templates × 4 inputs and the family film × 4 inputs, at three frame rates) have the recorded SHA-256', () => {
    const now = parity2Hashes();
    if (process.env.PF_RECORD_PARITY2 === '1') writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n');
    const golden = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;
    expect(Object.keys(now)).toHaveLength(96);
    expect(now).toEqual(golden);
  });
});
