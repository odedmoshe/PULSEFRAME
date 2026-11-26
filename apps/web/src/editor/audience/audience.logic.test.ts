/**
 * Tests of the audiences surfaces (wave 8 audiences, W3). The change rows are built from LABELLED STAND-IN data behind the contract
 * type (AudienceChanges): W1's list builder is not in this worktree, and the real routes are exercised by the integrator's proof.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AudienceChange, AudienceChanges } from '@pulseframe/core';
import { AUDIENCE_DEFAULT_NAMES } from '@pulseframe/core';
import { appliedCount, changeField, changeText, isDiverged, jumpable, jumpRows, keepOp, keepRuleOf, overrideCount, sizeToCommit, snapRange, stageNote } from './audience.logic.ts';
import { audienceMenuChoice, audienceMenuItems, isAudienceMenuId } from './audienceMenu.ts';
import { AUDIENCE_TESTIDS } from './audience.testids.ts';

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
// STAND-IN (test only): what the server's list could look like; not a measurement of anything
const change = (p: Partial<AudienceChange>): AudienceChange => ({ key: 'effect:c1:strobe', rule: 'effect', clipId: 'c1', trackId: 't1', sequenceId: 'seq_main', startFrame: 30, endFrame: 60, before: 'strobe', after: null, keepable: true, kept: false, ...p });
const list = (changes: AudienceChange[]): AudienceChanges => ({ projectId: 'p', variantId: 'v', revision: 1, profile: 'calm', rules: 1, musicDb: -6, changes, fastCuts: [{ startFrame: 90, endFrame: 120, cuts: 5, limit: 4, windowSeconds: 2 }], soundRoles: [], notHandled: ['pace', 'keys', 'not_medical', 'flash_check', 'sound_unheard'], method: 'stand-in' } as AudienceChanges);

describe('the «+» menu group', () => {
  it('has the two profiles, in both languages, with the contract test ids', () => {
    for (const lang of ['he', 'en'] as const) {
      const items = audienceMenuItems(lang);
      expect(items.map((i) => i.id)).toEqual(['audience:calm', 'audience:grandparents']);
      expect(items.map((i) => i.testId)).toEqual([AUDIENCE_TESTIDS.menuCalm, AUDIENCE_TESTIDS.menuGrandparents]);
      expect(items.every((i) => isAudienceMenuId(i.id) && i.label.length > 0)).toBe(true);
    }
    expect(audienceMenuChoice('audience:calm', 'he')).toEqual({ profile: 'calm', name: AUDIENCE_DEFAULT_NAMES.calm.he });
    expect(audienceMenuChoice('audience:grandparents', 'en')).toEqual({ profile: 'grandparents', name: 'For grandparents' });
    expect(audienceMenuChoice('audience:everyone', 'en')).toBeNull();
  });
  it('is rendered whatever formats exist (verifier C14): FormatPrism no longer gates the menu on addable formats', () => {
    const src = read('../FormatPrism.tsx');
    expect(src).not.toMatch(/addable\.length\s*>\s*0\s*&&/);
    expect(src).toMatch(/<Menu label=\{S\.addFormat\}/);
    expect(src).toContain('audienceMenuItems(state.lang)');
    expect(src).toContain('add_audience_version');
    expect(src).toContain('editor.setViewVariant(vid)');
  });
});

describe('«adjusted» counts (C14)', () => {
  it('a keep-only override does not mark a format adjusted', () => {
    expect(isDiverged({ overrides: { c1: { keep: ['effect'] } } as never })).toBe(false);
    expect(overrideCount({ overrides: { c1: { keep: ['effect'] } } as never })).toBe(0);
    expect(isDiverged({ overrides: { c1: { keep: ['effect'], hidden: true } } as never })).toBe(true);
    expect(overrideCount({ overrides: { c1: { hidden: true }, c2: { keep: ['effect'] } } as never })).toBe(1);
    expect(isDiverged({ overrides: {} })).toBe(false);
  });
  it('the Deliver panel counts and clears with the same rule', () => {
    const src = read('../DeliverPanel.tsx');
    expect(src).toContain('overrideCount(v)');
    expect(src).toContain('hasFormatOverride(overrideOf)');
  });
});

describe('the change rows', () => {
  it('word each rule in both languages from its machine values, with no placeholder left over', () => {
    const rows = [change({}), change({ rule: 'transition', before: 'flash' }), change({ rule: 'text_loop' }), change({ rule: 'title_size', before: 0.06, after: 0.08 }), change({ rule: 'music_level', clipId: null, before: 0, after: -6 }), change({ rule: 'ducking', before: 12, after: 18 })];
    for (const lang of ['he', 'en'] as const) for (const c of rows) { const s = changeText(c, lang); expect(s.length).toBeGreaterThan(3); expect(s).not.toMatch(/\{\w+\}/); }
    expect(changeText(rows[4]!, 'en')).toContain('6 dB');
    expect(changeText(rows[5]!, 'en')).toContain('6 dB');
  });
  it('keep and give back are ONE set_audience_keep, the opposite of the row\'s state; rows with no clip or not keepable have none', () => {
    expect(keepOp('v', change({}))).toEqual({ op: 'set_audience_keep', args: { variantId: 'v', clipId: 'c1', rule: 'effect', keep: true } });
    expect(keepOp('v', change({ kept: true }))).toEqual({ op: 'set_audience_keep', args: { variantId: 'v', clipId: 'c1', rule: 'effect', keep: false } });
    expect(keepOp('v', change({ rule: 'music_level', clipId: null }))).toBeNull();
    expect(keepRuleOf(change({ rule: 'caption_look', keepable: false }))).toBeNull();
  });
  it('every change is a jump row (a button), then the fast cuts; the stage count leaves kept rules out', () => {
    const r = list([change({}), change({ key: 'k2', kept: true, startFrame: 5 })]);
    expect(jumpRows(r).map((j) => [j.kind, j.startFrame])).toEqual([['change', 30], ['change', 5], ['fastCut', 90]]);
    expect(appliedCount(r)).toBe(1);
    expect(stageNote('גרסה רגועה', 3, 'he')).toBe('גרסה רגועה · 3 שינויים · לא נצפתה');
    expect(stageNote('Calm version', 3, 'en')).toBe('Calm version · 3 changes · not watched');
  });
});

describe('rows of another sequence and caption rows (integration)', () => {
  it('a row of a short is listed without a jump; the roving group holds only main-sequence rows and fast cuts', () => {
    const r = list([change({ key: 'effect:c1:fx1' }), change({ key: 'effect:c9:fx2', clipId: 'c9', sequenceId: 'seq_short', startFrame: 40 })]);
    expect(jumpable(r.changes[1]!, 'seq_main')).toBe(false);
    expect(jumpable(r.changes[0]!, 'seq_main')).toBe(true);
    expect(jumpRows(r, 'seq_main').map((j) => j.key)).toEqual(['effect:c1:fx1', 'fast:0:90']);
    const src = read('AudiencePanel.tsx');
    expect(src).toMatch(/!jumpable\(c, main\) \?/);
    expect(src).toMatch(/t\('elsewhere', \{ name: seqName\(c\.sequenceId\) \}\)/);
  });
  it('the four caption rows of one track are worded by their field, not one sentence four times', () => {
    const rows = ['sizeFrac', 'maxCharsPerLine', 'background', 'preset'].map((d) => change({ key: `caption_look:t2:${d}`, rule: 'caption_look', clipId: null, trackId: 't2', after: d === 'maxCharsPerLine' ? 26 : null, keepable: false }));
    expect(rows.map(changeField)).toEqual(['sizeFrac', 'maxCharsPerLine', 'background', 'preset']);
    expect(changeField({ key: 'effect:c1:fx1#2' })).toBe('fx1');
    for (const lang of ['he', 'en'] as const) {
      const words = rows.map((c) => changeText(c, lang));
      expect(new Set(words).size).toBe(4);
      expect(words[1]).toContain('26');
      expect(words.join(' ')).not.toMatch(/audience\.|rule\.|\{/);
    }
  });
});

describe('the panel source (keyboard, focus, honesty)', () => {
  const src = read('AudiencePanel.tsx');
  it('uses every contract id and the roving helper; moves no focus in a later task', () => {
    for (const k of ['panel', 'change', 'keep', 'fastCut', 'soundRow', 'roleSelect', 'musicDb', 'notHandled', 'send']) expect(src, k).toContain(`ID.${k}`);
    expect(src).toContain('rovingNext');
    expect(src).not.toMatch(/setTimeout|requestAnimationFrame|queueMicrotask/);
    expect(src).toMatch(/onClick=\{\(\) => jump\(/);
    expect(src).toContain('editor.seek(frame)');
  });
  it('shows the not-handled sentences always, every sound row «לא נשמע», and a 501 as notBuilt', () => {
    expect(src).toContain("?? ['pace', 'keys', 'not_medical', 'flash_check', 'sound_unheard']");
    expect(src).toContain("t('unheard')");
    expect(src).toContain('status === 501');
    expect(src).toContain("t('notBuilt')");
  });
});

describe('C3: the size control of a version', () => {
  const R = { min: 0.02, max: 0.2, step: 0.005 };
  it('snaps like a range input', () => {
    expect(snapRange(0.107, R.min, R.max, R.step)).toBe(0.105);
    expect(snapRange(0.3, R.min, R.max, R.step)).toBe(0.2);
    expect(snapRange(0.01, R.min, R.max, R.step)).toBe(0.02);
  });
  it('viewing and leaving the control commits nothing: the projected 0.08 × 4/3 comes back snapped and is no change', () => {
    const projected = (0.08 * 4) / 3; // 0.10666…
    expect(sizeToCommit(snapRange(projected, R.min, R.max, R.step), projected, R, true)).toBeNull();
    expect(sizeToCommit(snapRange(0.3, R.min, R.max, R.step), 0.3, R, true)).toBeNull(); // projected above the range
  });
  it('a real change by the owner commits; the master keeps its old rule', () => {
    expect(sizeToCommit(0.12, (0.08 * 4) / 3, R, true)).toBe(0.12);
    expect(sizeToCommit(0.08, 0.08, R, false)).toBeNull();
    expect(sizeToCommit(0.1, 0.08, R, false)).toBe(0.1);
  });
  it('InspectorObject routes every size commit through it', () => {
    const src = fs.readFileSync(path.join(dir, '../InspectorObject.tsx'), 'utf8');
    expect(src).toContain('sizeToCommit(v, size, SIZE_RANGE, audienceViewed)');
  });
});
