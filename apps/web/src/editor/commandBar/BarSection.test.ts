/** BarSection and the preview, rendered to markup: the first option, its ids, the kinds, the bidi isolation, the live region. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { applyTransaction, barPlanHash, createProject, type BarPlan, type BarResult, type OpCall } from '@pulseframe/core';
import * as T from '@pulseframe/time';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { EditorContext } = await import('../store.ts');
const { BarSection } = await import('./BarSection.tsx');
const P = await import('./BarPreview.tsx');
const U = await import('./useBarResult.ts');
const { COMMAND_BAR_TESTIDS: TID, BAR_DOM_IDS } = await import('./commandBar.testids.ts');

const R = { num: 30, den: 1 };
const doc = applyTransaction(createProject({ id: 'prj_s', name: 'S', width: 1920, height: 1080, frameRate: R }), [], { idSeed: 's_', actor: 't' }).doc;
const ops: OpCall[] = [{ op: 'split_clip', args: { clipId: 'clp_1', at: T.frameTime(365, R) } }];
const plan: BarPlan = { kind: 'plan', intent: 'split_here', tokens: [], readings: [{ role: 'verb', span: [0, 4], value: null }], ops, steps: [{ op: 'split_clip', detail: { kind: 'at', frame: 365, time: T.frameTime(365, R), rounded: false } }],
  notes: [{ code: 'ripple_moves', data: { n: 2 } }], label: 'Command bar: split_here', basisRevision: 3, planHash: barPlanHash('split_here', ops, 3) };
const fake = (lang: 'he' | 'en') => ({ subscribe: () => () => {}, getState: () => ({ lang, doc, actor: 'user:local' }), t: (k: string) => k }) as never;

function html(result: BarResult | null, query: string, activeKey: string | null = 'bar', lang: 'he' | 'en' = 'he') {
  const session = new U.BarSession({ context: () => null } as never, { lang, close: () => {} }, undefined, {});
  const view = result ? U.viewOf(query, { doc, rawDoc: doc, activeSequenceId: doc.mainSequenceId, revision: 3, selection: [], playheadFrame: 0, cutClipId: null, workspace: 'pro', performRecording: false, viewVariantId: null, lang, undoTarget: null, redoTarget: null, inject: (c) => c }, () => result) : U.EMPTY_VIEW;
  session.setView(view);
  const keys = view.entries.map((e) => e.key);
  const slot = { keys, activate: () => {}, describedBy: view.kind ? BAR_DOM_IDS.preview : null, session, view, version: 0, pending: false };
  return renderToStaticMarkup(createElement(EditorContext.Provider, { value: fake(lang) }, createElement(BarSection, { slot, query, activeKey, onHover: () => {}, optionDomId: (k: string) => `pf-palette-opt-${k}` })));
}

describe('BarSection', () => {
  it('draws only the live region while the query is empty (so it exists before it speaks)', () => {
    const h = html(null, '');
    expect(h).toContain(`data-testid="${TID.live}"`);
    expect(h).toContain('role="status"');
    expect(h).toContain('aria-live="polite"');
    expect(h).not.toContain('role="option"');
  });
  it('a plan: the first option has the fixed id, data-kind, intent and plan hash, and describes the preview', () => {
    const h = html(plan, 'חתוך כאן');
    expect(h).toContain(`id="${BAR_DOM_IDS.result}"`);
    expect(h).toContain('role="option"');
    expect(h).toContain(`data-testid="${TID.result}"`);
    expect(h).toContain('data-kind="plan"');
    expect(h).toContain('data-intent="split_here"');
    expect(h).toContain(`data-plan-hash="${plan.planHash}"`);
    expect(h).toContain(`aria-describedby="${BAR_DOM_IDS.preview}"`);
    expect(h).toContain(`id="${BAR_DOM_IDS.preview}"`);
    expect(h).toContain('aria-selected="true"');
    expect((h.match(/role="option"/g) ?? []).length).toBe(1);
  });
  it('the preview: «הבנתי:», one step with its op and detail kind, the time in an ltr bdi, the note, the footer', () => {
    const h = html(plan, 'חתוך כאן');
    expect(h).toContain('הבנתי:');
    expect(h).toContain(`data-testid="${TID.step}" data-op="split_clip" data-detail="at"`);
    expect(h).toContain('<bdi dir="ltr" class="num">0:12.17</bdi>');
    expect(h).toContain(`data-testid="${TID.note}" data-code="ripple_moves"`);
    expect(h).toContain('Enter לביצוע · פעולה אחת לביטול');
    expect(h).toContain('<mark>חתוך</mark>');
  });
  it('a title\'s quoted words are isolated for their own direction', () => {
    expect(renderToStaticMarkup(createElement(P.Rich, { text: 'a ⁨יום הולדת⁩ b' }))).toContain('<bdi dir="auto">יום הולדת</bdi>');
    expect(P.stepQuote({ op: 'add_text', args: { text: 'מזל טוב' } })).toBe('מזל טוב');
    expect(P.stepQuote({ op: 'split_clip', args: {} })).toBeNull();
  });
  it('ambiguous: the question row and each choice as its own option, with the index', () => {
    const amb: BarResult = { kind: 'ambiguous', intent: 'sync_beat', tokens: [], readings: [], question: { he: 'מה לסנכרן?', en: 'Sync what?' }, choices: [{ he: 'קטע אחד', en: 'One cut', result: plan }, { he: 'מונטאז׳', en: 'Montage', result: plan }] };
    const h = html(amb, 'סנכרן לקצב');
    expect((h.match(/role="option"/g) ?? []).length).toBe(3);
    expect(h).toContain(`data-testid="${TID.choice}" data-index="0"`);
    expect(h).toContain('id="pf-palette-opt-bar-choice-1"');
    expect(h).toContain('יש כמה אפשרויות:');
    const second = html(amb, 'סנכרן לקצב', 'bar-choice-1');
    expect(second).toContain('data-testid="bar-step"'); // the active choice's own preview
  });
  it('incomplete, refused and unknown say it in words and run nothing', () => {
    const inc = html({ kind: 'incomplete', intent: 'add_title', tokens: [], readings: [{ role: 'verb', span: [0, 10], value: null }], missing: ['text'], example: { he: 'הוסף כותרת "מזל טוב" כאן', en: 'add title "Mazal tov" here' } }, 'הוסף כותרת');
    expect(inc).toContain('data-kind="incomplete"'); expect(inc).toContain('data-missing="text"'); expect(inc).toContain('הבנתי &quot;הוסף כותרת&quot;'); expect(inc).toContain('חסר: הטקסט.'); expect(inc).toContain('שום דבר לא ירוץ');
    const ref = html({ kind: 'refused', intent: 'split_here', tokens: [], readings: [], code: 'nothing_selected' }, 'מחק');
    expect(ref).toContain(`data-testid="${TID.refused}" data-code="nothing_selected"`); expect(ref).toContain('לא נבחר קליפ'); expect(ref).toContain('בחרו קליפ בציר הזמן');
    const unk = html({ kind: 'unknown', tokens: [], readings: [], unread: [[0, 3]], partial: [] }, 'blah blah');
    expect(unk).toContain('data-kind="unknown"'); expect(unk).toContain('לא הבנתי את הבקשה.'); expect(unk).toContain(`data-testid="${TID.unread}"`);
  });
  it('an action says it does not change the project', () => {
    const h = html({ kind: 'action', intent: 'export_to', tokens: [], readings: [], action: { kind: 'export_sheet', destination: 'whatsapp' }, notes: [] }, 'ייצא לוואטסאפ');
    expect(h).toContain('data-kind="action"'); expect(h).toContain('לא משנה את הפרויקט:'); expect(h).toContain('הייצוא מתחיל רק בכפתור');
  });
  it('English words the same rows', () => { expect(html(plan, 'split here', 'bar', 'en')).toContain('Enter to apply · one step to undo'); });
  it('highlightSegments merges the read spans in order', () => {
    expect(P.highlightSegments('abcdef', [{ role: 'verb', span: [0, 2], value: 0 }, { role: 'object', span: [1, 3], value: 0 }, { role: 'text', span: [4, 6], value: 0 }])).toEqual([{ text: 'abc', hit: true }, { text: ' ', hit: false }].slice(0, 1).concat([{ text: 'd', hit: false }, { text: 'ef', hit: true }]));
  });
});
