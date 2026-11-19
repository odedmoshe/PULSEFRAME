/** The «עוזר השפה» Settings section and the assistant's row, rendered to markup: owner only, no key shown back, the honest not-connected row. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { EditorContext } = await import('../store.ts');
const S = await import('./AssistantSettings.tsx');
const Row = await import('./AssistantRow.tsx');
const { COMMAND_BAR_TESTIDS: TID } = await import('./commandBar.testids.ts');

// labelled stand-in: just what useEditorState reads
const fake = (actor: string | null, lang: 'he' | 'en' = 'he') => ({ subscribe: () => () => {}, getState: () => ({ actor, lang, doc: null, selection: [], activeSequenceId: '' }), t: (k: string) => k, frame: 0 }) as never;
const render = (el: ReturnType<typeof createElement>, actor: string | null, lang: 'he' | 'en' = 'he') => renderToStaticMarkup(createElement(EditorContext.Provider, { value: fake(actor, lang) }, el));

describe('AssistantSettings', () => {
  it('is not rendered for a non-owner actor (an agent, an unknown session)', () => {
    for (const actor of ['agent:codex', 'agent:assistant', null, 'user:other']) expect(render(createElement(S.AssistantSettings), actor)).toBe('');
    expect(S.settingsVisible('agent:x')).toBe(false);
  });
  it('is rendered for the owner session, with its heading, and says so while loading', () => {
    const html = render(createElement(S.AssistantSettings), 'user:local');
    expect(html).toContain(`data-testid="${TID.settings}"`);
    expect(html).toContain('עוזר השפה');
    expect(html).not.toContain('type="password"'); // the fields come with the status
  });
  it('configBodyOf: prices and limits are numbers above zero, prices come as a pair, the toggles are sent as they are', () => {
    const ok = { ...S.formOf(null), host: 'api.example.com', model: 'm', priceIn: '300', priceOut: '1500', monthly: '500', cap: '20', titles: true };
    expect(S.configBodyOf(ok)).toMatchObject({ host: 'api.example.com', pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: 500, perRequestCapCents: 20, toggles: { titlesAndMarkers: true, peopleNames: false } });
    expect(S.configBodyOf({ ...ok, priceIn: '0' })).toBeNull();
    expect(S.configBodyOf({ ...ok, priceOut: '' })).toBeNull();
    expect(S.configBodyOf({ ...ok, monthly: '1.5' })).toBeNull();
    expect(S.configBodyOf({ ...ok, cap: 'x' })).toBeNull();
    expect(S.configBodyOf(S.formOf(null))).toMatchObject({ pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { titlesAndMarkers: false, peopleNames: false } });
  });
  it('the toggles default to off', () => { expect(S.formOf(null)).toMatchObject({ titles: false, people: false }); });
  it('a server refusal of a save reads in Hebrew with its next step, never the English message or hint (lead decision)', async () => {
    const { ApiFailure } = await import('../../api.ts');
    const cases = [
      new ApiFailure(403, 'owner_required', 'the language assistant is set up and used from the owner\'s own session only', undefined, 'The owner sets it up in Settings.'),
      new ApiFailure(409, 'host_not_allowed', 'the host evil.example.test is not listed in PF_ASSISTANT_HOSTS', { host: 'evil.example.test' }, 'Add exactly this host to PF_ASSISTANT_HOSTS and restart the server, then save again.'),
      new ApiFailure(400, 'invalid_request', '✖ a price is more than 0 cents per million tokens: type the price from the provider\'s price list (for example 300 for $3 per million tokens)\n  → at pricesCentsPerMTok.input'),
      new ApiFailure(400, 'invalid_request', 'the language assistant is reached over https only', { host: 'http://x' }, 'Give the service\'s host name, for example api.example.com; requests go to https://<host>.'),
    ];
    for (const e of cases) {
      const w = S.wordsOf('he', e);
      expect(w.untranslated, e.message).toBeNull();
      expect(/[א-ת]/.test(w.reason), e.message).toBe(true);
      expect(w.reason.split('; ').length, `${e.message}: reason; next step`).toBe(2);
      expect(w.reason, e.message).not.toContain(e.hint ?? '@@');
    }
    expect(S.wordsOf('en', cases[0]!)).toMatchObject({ reason: cases[0]!.message, next: 'The owner sets it up in Settings.' });
  });
});

describe('AssistantRow', () => {
  const opt = (k: string) => `pf-palette-opt-${k}`;
  it('reads «עוזר השפה לא מחובר» with «איך מחברים» for the owner until the status says ready', () => {
    const html = render(createElement(Row.AssistantRow, { query: 'חתוך הכול', lang: 'he', optionDomId: opt }), 'user:local');
    expect(html).toContain(`data-testid="${TID.assistantRow}"`);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('עוזר השפה לא מחובר');
    expect(html).toContain('איך מחברים');
    expect(html).toContain(`data-testid="${TID.assistantConnect}"`);
    expect(html).toContain('לבקש מהעוזר: חתוך הכול');
  });
  it('a session that is not the owner gets the words but no link', () => {
    const html = render(createElement(Row.AssistantRow, { query: 'x', lang: 'en', optionDomId: opt }), 'agent:x', 'en');
    expect(html).toContain('Language assistant not connected');
    expect(html).not.toContain(TID.assistantConnect);
  });
  it('words: a missing status is not connected; a setup state has its own words; stages are words, never a percentage', () => {
    expect(Row.setupWords('he', null)).toBe('עוזר השפה לא מחובר');
    expect(Row.setupWords('he', { setup: 'limit_missing' } as never)).toMatch(/מגבלת הוצאה/);
    expect(Row.stageWords('he', 'awaiting-provider')).toBe('ממתין לתשובה');
    expect(Row.stageWords('en', 'checking')).toBe('Checking the proposal');
    expect(Row.stageWords('he', 'sending')).not.toMatch(/%|\d/);
    expect(Row.isReady({ setup: 'ready' } as never)).toBe(true);
    expect(Row.isReady({ setup: 'prices_missing' } as never)).toBe(false);
  });
  it('the status is fetched at most every 5 s, and a failed or 501 status is "not known"', async () => {
    Row.resetStatusCache();
    const f = vi.fn(async () => { throw new Error('501'); });
    expect(await Row.loadStatus(1000, f as never)).toBeNull();
    await Row.loadStatus(2000, f as never);
    expect(f).toHaveBeenCalledTimes(1);
    await Row.loadStatus(7000, f as never);
    expect(f).toHaveBeenCalledTimes(2);
    Row.resetStatusCache();
  });
  it('the send line names the cap in cents and the switches that are on', () => {
    const line = Row.sendLine('he', { perRequestCapCents: 12, toggles: { titlesAndMarkers: true, peopleNames: false } } as never);
    expect(line).toContain('12¢');
    expect(line).toContain('נשלח: סיכום הפרויקט בלי מדיה ובלי פרטי משפחה');
    expect(line).toContain('נוסח כותרות');
  });
});
