/**
 * The sound effects the built-in templates (ADR-0016) place are built-in sounds of this server (sfx.ts SFX): the template
 * flow makes each with makeSfx and attaches it through apply_template, so an id missing here would refuse every apply.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@pulseframe/core';
import { SFX } from './sfx.ts';

describe('built-in templates and the sound effect catalogue', () => {
  it('every sfxId a built-in template names exists in SFX', () => {
    const known = new Set(SFX.map((s) => s.id));
    const used = TEMPLATES.flatMap((t) => t.sfx.map((s) => ({ template: t.id, sfxId: s.sfxId })));
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((u) => !known.has(u.sfxId))).toEqual([]);
  });
});
