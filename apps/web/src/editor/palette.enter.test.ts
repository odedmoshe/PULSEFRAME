/**
 * Enter routing in the palette (palette.enter.ts, ADR-0027 plan §6): the bar's answer is active by default; a typed name that is
 * exactly a registry command's runs that command when the bar has nothing to run for it; a near miss stays the bar's unknown
 * request, which runs nothing. The table at the end runs the real grammar on every registry name in both languages.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyTransaction, createProject, type BarContext } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { defaultActiveKey, exactCommandId } = await import('./palette.enter.ts');
const { viewOf } = await import('./commandBar/useBarResult.ts');
const { BAR_KEYS } = await import('./commandBar/commandBar.testids.ts');
const { COMMANDS } = await import('./commands.ts');
const { rankWithRescue } = await import('./palette.search.ts');

const ITEMS = COMMANDS.map((c) => ({ id: c.id, he: c.text?.he ?? dictionaries.he[c.label], en: c.text?.en ?? dictionaries.en[c.label] }));
const R = { num: 30, den: 1 };
const doc = applyTransaction(createProject({ id: 'prj_e', name: 'E', width: 1920, height: 1080, frameRate: R }), [], { idSeed: 'e_', actor: 't' }).doc;
const ctx = (lang: 'he' | 'en'): BarContext => ({ doc, rawDoc: doc, activeSequenceId: doc.mainSequenceId, revision: 3, selection: [], playheadFrame: 0, cutClipId: null, workspace: 'pro', performRecording: false, viewVariantId: null, lang, undoTarget: null, redoTarget: null, inject: (c) => c });

/** What Enter acts on for `query`, built the way CommandPalette.tsx builds it (scope 'all'). */
function enterTarget(query: string, lang: 'he' | 'en' = 'he'): { key: string | null; barKind: string | null } {
  const view = viewOf(query, ctx(lang));
  const barKeys = view.entries.map((e) => e.key);
  const ranked = rankWithRescue(query, ITEMS);
  const keys = [...barKeys, ...ranked.ids.slice(0, 8)];
  const exactId = exactCommandId(query, ITEMS) ?? exactCommandId(ranked.rescued, ITEMS);
  return { key: defaultActiveKey({ keys, barRuns: !!view.entries[0]?.target, exactId }), barKind: view.kind };
}

describe('exactCommandId', () => {
  it('matches a registry name in either language, ignoring case and punctuation', () => {
    expect(exactCommandId("Move the selected clip's track up", ITEMS)).toBe('track.moveUp');
    expect(exactCommandId('move the selected clip s track up', ITEMS)).toBe('track.moveUp');
    expect(exactCommandId(dictionaries.he['cmd.trackUp'], ITEMS)).toBe('track.moveUp');
    expect(exactCommandId('  Close empty gaps in the timeline. ', ITEMS)).toBe('edit.closeGaps');
  });
  it('a part of a name, or nothing, is not a name', () => {
    expect(exactCommandId('track up', ITEMS)).toBeNull();
    expect(exactCommandId('move track up', ITEMS)).toBeNull();
    expect(exactCommandId('close empty gaps', ITEMS)).toBeNull();
    expect(exactCommandId('', ITEMS)).toBeNull();
    expect(exactCommandId(null, ITEMS)).toBeNull();
  });
});

describe('defaultActiveKey', () => {
  const keys = [BAR_KEYS.result, BAR_KEYS.nearest(0), 'track.moveUp', 'track.moveDown'];
  it('the bar\'s answer is active by default', () => {
    expect(defaultActiveKey({ keys, barRuns: false, exactId: null })).toBe(BAR_KEYS.result);
    expect(defaultActiveKey({ keys, barRuns: true, exactId: null })).toBe(BAR_KEYS.result);
  });
  it('an exact name takes Enter when the bar runs nothing', () => {
    expect(defaultActiveKey({ keys, barRuns: false, exactId: 'track.moveUp' })).toBe('track.moveUp');
  });
  it('a bar plan or action keeps Enter even for an exact name', () => {
    expect(defaultActiveKey({ keys, barRuns: true, exactId: 'track.moveUp' })).toBe(BAR_KEYS.result);
  });
  it('an exact name that is not shown (another scope) does not take Enter', () => {
    expect(defaultActiveKey({ keys: ['effect:blur'], barRuns: false, exactId: 'track.moveUp' })).toBe('effect:blur');
    expect(defaultActiveKey({ keys: [], barRuns: false, exactId: 'track.moveUp' })).toBeNull();
  });
});

describe('Enter with the real grammar', () => {
  it('the names the phase 3 proof types run their commands; their near misses stay unknown and run nothing', () => {
    expect(enterTarget("Move the selected clip's track up")).toEqual({ key: 'track.moveUp', barKind: 'unknown' });
    expect(enterTarget('Close empty gaps in the timeline')).toMatchObject({ key: 'edit.closeGaps' });
    for (const q of ['track up', 'move track up', 'close empty gaps']) expect(enterTarget(q)).toEqual({ key: BAR_KEYS.result, barKind: 'unknown' });
  });
  it('a request the grammar plans keeps the bar\'s previewed answer', () => {
    expect(enterTarget('Remove empty tracks', 'en').key).toBe(BAR_KEYS.result);
  });
  it('every registry name, in both languages, gives Enter either that command or a bar plan or action', () => {
    const wrong: unknown[] = [];
    for (const item of ITEMS) for (const lang of ['he', 'en'] as const) {
      const text = item[lang];
      const view = viewOf(text, ctx(lang));
      const runs = !!view.entries[0]?.target;
      const { key } = enterTarget(text, lang);
      const want = runs ? BAR_KEYS.result : exactCommandId(text, ITEMS);
      if (key !== want || (!runs && key === BAR_KEYS.result)) wrong.push({ id: item.id, lang, text, kind: view.kind, key });
    }
    expect(wrong).toEqual([]);
  });
});
