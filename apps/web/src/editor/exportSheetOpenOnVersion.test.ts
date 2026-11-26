/**
 * openExportSheet({ variantId }) opens the export sheet ON a version (wave 8 audiences: the panel's «לשליחה»): the version's target is
 * chosen alone, as a click on its format row would leave it. Node only: the sheet's pick is read through readExportPick, nothing renders.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject } from '@pulseframe/core';
import { DEFAULT_CHOICES, exportTargets, variantPick, variantTargetKey } from './exportSheet.logic.ts';
import { openExportSheet, readExportPick } from './ExportSheet.tsx';

describe('openExportSheet on a version', () => {
  it('the version key is the key exportTargets gives that version', () => {
    const doc = createProject({ id: 'prj_x', name: 'x', width: 320, height: 180, frameRate: { num: 30, den: 1 } });
    doc.variants.var_calm = { id: 'var_calm', name: 'רגועה', width: 320, height: 180, fit: 'contain', overrides: {} } as never;
    const t = exportTargets(doc).find((x) => x.variantId === 'var_calm');
    expect(t?.key).toBe(variantTargetKey('var_calm'));
    expect(variantPick('var_calm', { ...DEFAULT_CHOICES, targetBytes: 16_000_000 })).toEqual({ dest: 'custom', keys: ['variant:var_calm'], choices: { ...DEFAULT_CHOICES, targetBytes: null } });
  });
  it('opens with that version alone chosen; a destination asked for at the same time does not override it; a later plain open keeps it', () => {
    openExportSheet({ destination: 'whatsapp' });
    expect(readExportPick().want).toBe('whatsapp');
    openExportSheet({ variantId: 'var_calm', destination: 'reels' });
    expect(readExportPick()).toMatchObject({ keys: ['variant:var_calm'], dest: 'custom', want: null });
    expect(readExportPick().choices.targetBytes).toBeNull();
    openExportSheet();
    expect(readExportPick().keys).toEqual(['variant:var_calm']);
  });
  it('the audience panel\'s «לשליחה» passes its version, and the sentence asking to choose the version by hand is gone', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'audience', 'AudiencePanel.tsx'), 'utf8');
    expect(src).toMatch(/openExportSheet\(\{ variantId: variant\.id \}\)/);
    expect(src).not.toMatch(/sendNote/);
  });
});
