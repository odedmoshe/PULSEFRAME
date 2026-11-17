/**
 * The six built-in templates plan byte-for-byte as they did before the content packs (ADR-0022; the verifier's check that the
 * pack fields, built-in music and the element guard leave tpl.countdown-list's per-slot {n} and every other template alone).
 * templateParity.golden.json was recorded by running templateParity.fixture.ts against the core tree of commit 159a301 (the
 * tree before this track, extracted with git archive) and compared equal with this tree when it was written. A change here
 * is a change of what an existing template makes, and must be deliberate (then re-record and say why).
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, canonical, createProject } from './index.ts';
import { planTemplate } from './templatePlan.ts';
import { parityHashes } from './templateParity.fixture.ts';
import { readFileSync } from 'node:fs';

const golden = JSON.parse(readFileSync(new URL('./templateParity.golden.json', import.meta.url), 'utf8')) as Record<string, string>;

describe('built-in templates plan exactly as before the content packs', () => {
  it('36 plans (six templates, three frame rates, two inputs) have the recorded SHA-256, and none has a notice', () => {
    const now = parityHashes({ createProject, planTemplate, canonical, TEMPLATES: BUILTIN_TEMPLATES });
    expect(Object.keys(now)).toHaveLength(36);
    expect(now).toEqual(golden);
  });
});
