/**
 * The editor's handling of a drawn clip (wave 8 carrier) with the TEST-ONLY drawn kind (core drawn.testKind.ts): the inspector
 * calls it a drawing with its own tab (the kind's mount point), Position and Effects, and no text control; the timeline names
 * it by its kind in both languages (its accessible name); the ride bar's "animation" opens Position.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, type ProjectDocument } from '@pulseframe/core';
import { registerTestDrawnOp, testDrawn } from '@pulseframe/core/drawn.testKind.ts';
import { activeTab, firstTab, objectActions, objectKind, pinnedTab, tabsFor } from './inspector.model.ts';
import { clipLabel } from './Timeline.tsx';
import { panelTab } from './Inspector.tsx';

const R = { num: 30, den: 1 };
function project(): { doc: ProjectDocument; id: string } {
  registerTestDrawnOp();
  const r = applyTransaction(createProject({ id: 'prj_dm', name: 'DM', width: 1920, height: 1080 }), [{ op: 'add_test_drawn', args: { start: T.frameTime(0, R), duration: T.frameTime(60, R), drawn: testDrawn() } }], { idSeed: 'dm_', actor: 'test' });
  return { doc: r.doc, id: r.results[0]!.output!.clipId as string };
}

describe('a drawn clip in the editor', () => {
  it('the inspector: kind drawn, its own tab first, then Position and Effects; no text, style or letter-animation tab', () => {
    const { doc, id } = project();
    expect(objectKind(doc, [id], null)).toBe('drawn');
    expect(tabsFor('drawn')).toEqual(['drawn', 'place', 'effects']);
    expect(firstTab('drawn')).toBe('drawn');
    for (const t of ['text', 'style', 'anim'] as const) expect(tabsFor('drawn')).not.toContain(t);
    expect(objectActions('drawn')).toEqual(['duplicate', 'split', 'delete']);
    expect(pinnedTab('motion', 'drawn')).toBe('place');
    expect(activeTab('drawn', 'text', 'pro')).toBe('drawn'); // a title's tab chosen before does not carry over
    expect(panelTab('animation', 'drawn')).toBe('place');
  });
  it('the timeline names it by its kind, in Hebrew and in English (its accessible name)', () => {
    const { doc, id } = project();
    const clip = findClip(doc, id)!.clip;
    expect(clipLabel(doc, clip, 'he')).toBe('צורת בדיקה');
    expect(clipLabel(doc, clip, 'en')).toBe('Test shape');
  });
});
