/**
 * The local language assistant in the editor (wave 7; .artifacts/wave7/assistant-decisions.md §5 builder C): the pure logic, the Settings
 * fields and the row's states rendered to markup against small local fixtures of the contract's shapes. NO model and no server run here:
 * what these prove is the editor's own behaviour (honest states, no host field, no money word, nothing claimed about quality).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ASSISTANT_LOCAL_ADAPTER_ID, ASSISTANT_LOCAL_DEFAULTS, LOCAL_RUNTIME_STATES, type AssistantLocalOutput } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { COMMAND_BAR_TESTIDS: TID } = await import('./commandBar.testids.ts');
const { BAR_EN, BAR_HE, placeholdersOf } = await import('./commandBar.strings.ts');
const L = await import('./localAssistant.logic.ts');
const Row = await import('./AssistantRow.tsx');
const S = await import('./AssistantSettings.tsx');

const out = (over: Partial<AssistantLocalOutput> = {}): AssistantLocalOutput => ({ kind: 'local-intent', intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' }, dropped: [], phrase: 'הנמך את המוזיקה ב־6 דציבל', model: 'MODEL-FIXTURE.gguf', wallMs: 1200, ...over });
const job = (over: Partial<{ id: string; status: string; stage: string | null; output: unknown; error: unknown; attempt: number | null }> = {}) => ({ id: 'job_1', status: 'succeeded', stage: null, output: out(), error: null, attempt: 1, ...over });
const MONEY = /חויב|חיוב|שמור|שחרור|charge|reserv|billed|held amount|cents|¢/i;
const QUALITY = /חכם|מדויק|מבין היטב|מצוין|smart|accurate|understands well|intelligent|reliable|great/i;

describe('the local assistant\'s contract in the editor', () => {
  it('has its test ids and its Settings words in both languages', () => {
    for (const k of ['assistantLocalSettings', 'assistantLocalPort', 'assistantLocalCheck', 'assistantLocalAsk', 'assistantLocalInsert', 'assistantLocalBadge'] as const) expect(TID[k]).toBeTruthy();
    for (const k of Object.keys(BAR_HE).filter((k) => k.startsWith('set.local.') || k.startsWith('row.local.'))) expect((BAR_EN as Record<string, string>)[k], k).toBeTruthy();
    expect(BAR_HE['set.local.check']).toBe('בדיקת חיבור');
  });
  it('is built', () => { expect(L.LOCAL_UI_BUILT).toBe(true); });
});

describe('localRowState', () => {
  it('offers the question only under an unknown result and with no request yet', () => {
    expect(L.localRowState('unknown', null)).toEqual({ kind: 'offer' });
    for (const k of ['plan', 'action', 'ambiguous', 'incomplete', 'refused', null] as const) expect(L.localRowState(k, null)).toEqual({ kind: 'hidden' });
  });
  it('says what a running request is doing, from the job itself', () => {
    for (const status of ['queued', 'running', 'cancel-requested']) expect(L.localRowState('unknown', job({ status, stage: 'awaiting-local-model', output: null }))).toEqual({ kind: 'pending', stage: 'awaiting-local-model' });
  });
  it('a suggestion carries its phrase and intent; a dropped slot is flagged; none and a cleared output offer nothing', () => {
    expect(L.localRowState('unknown', job())).toEqual({ kind: 'suggested', jobId: 'job_1', phrase: 'הנמך את המוזיקה ב־6 דציבל', intent: 'gain_change', dropped: false });
    expect(L.localRowState('unknown', job({ output: out({ dropped: [{ slot: 'db', why: 'ungrounded' }], phrase: 'הנמך את המוזיקה' }) }))).toMatchObject({ kind: 'suggested', dropped: true });
    expect(L.localRowState('unknown', job({ output: out({ intent: 'none', slots: {}, phrase: null }) }))).toEqual({ kind: 'none', jobId: 'job_1' });
    expect(L.localRowState('unknown', job({ output: out({ cleared: true, phrase: null, slots: {} }) }))).toEqual({ kind: 'none', jobId: 'job_1' });
    expect(L.localRowState('unknown', job({ output: out({ intent: 'none', phrase: 'invented' }) }))).toEqual({ kind: 'none', jobId: 'job_1' }); // none never shows a phrase
  });
  it('a cloud proposal in a local row is a failure, never a phrase', () => {
    expect(L.localRowState('unknown', job({ output: { proposalId: 'p', explanation: null, opsCount: 1, costCents: 0, costBasis: 'reported' } })).kind).toBe('failed');
  });
  it('canceled keeps whether anything was sent; failed keeps the code and the fixed sentence', () => {
    expect(L.localRowState('unknown', job({ status: 'canceled', attempt: 0, output: null }))).toEqual({ kind: 'canceled', sent: false });
    expect(L.localRowState('unknown', job({ status: 'canceled', attempt: 1, output: null }))).toEqual({ kind: 'canceled', sent: true });
    expect(L.localRowState('unknown', job({ status: 'failed', output: null, error: { code: 'local_timeout', message: 'the local assistant took longer than the time limit, and the request was stopped' } }))).toEqual({ kind: 'failed', code: 'local_timeout', message: 'the local assistant took longer than the time limit, and the request was stopped' });
    expect(L.localRowState('unknown', job({ status: 'submission-unknown', output: null, error: null }))).toMatchObject({ kind: 'failed' });
  });
});

describe('canInsert', () => {
  it('only an uncleared phrase of a real intent', () => {
    expect(L.canInsert(out())).toBe(true);
    expect(L.canInsert(null)).toBe(false);
    expect(L.canInsert(out({ phrase: null }))).toBe(false);
    expect(L.canInsert(out({ phrase: '   ' }))).toBe(false);
    expect(L.canInsert(out({ cleared: true, phrase: null }))).toBe(false);
    expect(L.canInsert(out({ intent: 'none' }))).toBe(false);
  });
});

describe('parseLocalSettings: a port and a time limit, never an address', () => {
  it('accepts whole numbers in range and returns exactly those two fields', () => {
    expect(L.parseLocalSettings('8791', '60')).toEqual({ ok: true, local: { port: 8791, timeoutSeconds: 60 } });
    expect(L.parseLocalSettings(' 1024 ', '5')).toEqual({ ok: true, local: { port: 1024, timeoutSeconds: 5 } });
    expect(L.parseLocalSettings('65535', '600')).toEqual({ ok: true, local: { port: 65535, timeoutSeconds: 600 } });
  });
  it('refuses everything else, including every way of typing a host, a URL or a path', () => {
    for (const port of ['', '1023', '65536', '0', '-1', '80.5', '8e3', '0x1F90', ' ', 'abc', '١٢٣٤٥', 'localhost:8791', '127.0.0.1:8791', 'http://127.0.0.1:8791', '10.0.0.5', '8791/v1', '8791 8792', '99999999']) expect(L.parseLocalSettings(port, '60'), port).toEqual({ ok: false });
    for (const t of ['', '4', '601', '6.5', 'sixty', '-5']) expect(L.parseLocalSettings('8791', t), t).toEqual({ ok: false });
    expect(L.LOCAL_ADDRESS).toBe('127.0.0.1');
  });
  it('the fields start from what is saved, else 8791 and 60', () => {
    expect(L.localFormOf(null)).toEqual({ port: String(ASSISTANT_LOCAL_DEFAULTS.port), timeout: String(ASSISTANT_LOCAL_DEFAULTS.timeoutSeconds) });
    expect(L.localFormOf({ port: 9000, timeoutSeconds: 90 })).toEqual({ port: '9000', timeout: '90' });
    expect(ASSISTANT_LOCAL_DEFAULTS).toEqual({ port: 8791, timeoutSeconds: 60 });
  });
});

describe('the words', () => {
  const dictLocal = (lang: 'he' | 'en') => Object.entries(dictionaries[lang] as Record<string, string>).filter(([k]) => /^assistant\.local\./.test(k) || /^error\.code\.local_/.test(k));
  const HE_L = L.LOCAL_TEXT_KEYS.map((k) => BAR_HE[k]), EN_L = L.LOCAL_TEXT_KEYS.map((k) => BAR_EN[k]);
  it('this builder\'s strings are the command bar\'s own (same keys and placeholders in Hebrew and English, Hebrew has Hebrew, English none)', () => {
    for (const k of L.LOCAL_TEXT_KEYS) {
      expect(BAR_HE[k], k).toBeTruthy();
      expect(placeholdersOf(BAR_EN[k]), k).toEqual(placeholdersOf(BAR_HE[k]));
      expect(/[א-ת]/.test(BAR_HE[k]), k).toBe(true);
      expect(BAR_EN[k], k).not.toMatch(/[א-ת]/);
      expect(L.localText('he', k), k).toBe(BAR_HE[k]);
      expect(L.localText('en', k), k).toBe(BAR_EN[k]);
    }
  });
  it('no local-assistant sentence has a money word or claims anything about how well it understands', () => {
    const all = [...HE_L, ...EN_L, ...dictLocal('he').map(([, v]) => v), ...dictLocal('en').map(([, v]) => v),
      ...Object.entries(BAR_HE).filter(([k]) => /^(set|row)\.local\./.test(k)).map(([, v]) => v), ...Object.entries(BAR_EN).filter(([k]) => /^(set|row)\.local\./.test(k)).map(([, v]) => v)];
    expect(all.length).toBeGreaterThan(60);
    for (const w of all) { expect(w, w).not.toMatch(MONEY); expect(w, w).not.toMatch(QUALITY); }
  });
  it('no sentence takes a host or a URL', () => {
    for (const w of [...HE_L, ...EN_L]) expect(w, w).not.toMatch(/https?:\/\/|:\/\//);
  });
  it('every state the check can find has words in both languages', () => {
    for (const s of LOCAL_RUNTIME_STATES) for (const lang of ['he', 'en'] as const) expect((dictionaries[lang] as Record<string, string>)[`assistant.local.state.${s}`], `${lang} ${s}`).toBeTruthy();
  });
});

const nop = () => {};
const view = (over: Partial<import('./AssistantRow.tsx').LocalRowViewProps> = {}, lang: 'he' | 'en' = 'he') =>
  renderToStaticMarkup(createElement(Row.LocalRowView, { lang, owner: true, q: 'תעשה את זה רגוע', rs: { kind: 'offer' }, kind: 'unknown', asking: false, canceling: false, inserted: null, note: null, failedWords: null, on: { ask: nop, cancel: nop, insert: nop, ignore: nop }, ...over }));

describe('the row\'s states (markup)', () => {
  it('offer: one button «לשאול את העוזר המקומי», and the line that nothing leaves the computer', () => {
    const html = view();
    expect(html).toContain(`data-testid="${TID.assistantLocalAsk}"`);
    expect(html).toContain('לשאול את העוזר המקומי');
    expect(html).toContain('שום דבר לא יוצא מהמחשב');
    expect(view({}, 'en')).toContain('Ask the local assistant');
  });
  it('the question is not offered to a session that is not the owner\'s', () => { expect(view({ owner: false })).not.toContain(TID.assistantLocalAsk); });
  it('hidden under a result the bar reads itself: no button, and the sentence that says why', () => {
    const html = view({ rs: { kind: 'hidden' }, kind: 'plan' });
    expect(html).not.toContain(TID.assistantLocalAsk);
    expect(html).toContain('שורת הפקודות מבינה את הבקשה בעצמה');
  });
  it('pending: the stage in words (never a percentage), «ביטול הבקשה», and while canceling no cancel button', () => {
    for (const stage of ['sending', 'waiting-for-compute', 'awaiting-local-model', 'checking']) {
      const html = view({ rs: { kind: 'pending', stage } });
      expect(html).toContain(`data-stage="${stage}"`);
      expect(html).toContain(`data-testid="${TID.assistantCancel}"`);
      expect(html).toContain('ביטול הבקשה');
      expect(html).not.toMatch(/\d\s*%/);
    }
    expect(view({ rs: { kind: 'pending', stage: 'awaiting-local-model' } })).toContain('העוזר המקומי חושב');
    expect(view({ rs: { kind: 'pending', stage: 'awaiting-local-model' }, canceling: true })).not.toContain(TID.assistantCancel);
  });
  it('suggested: the phrase in ONE dir=auto span, the origin label, «הכנס לשורה» and «התעלם»; a dropped slot says so', () => {
    const html = view({ rs: { kind: 'suggested', jobId: 'j', phrase: 'הנמך את המוזיקה ב־6 דציבל', intent: 'gain_change', dropped: false } });
    expect(html).toContain(`data-testid="${TID.assistantLocalSuggestion}"`);
    expect(html).toContain('data-intent="gain_change"');
    expect(html.match(/dir="auto"/g)?.length).toBe(1);
    expect(html).toContain('<span dir="auto" class="pf-bar-phrase">הנמך את המוזיקה ב־6 דציבל</span>');
    expect(html).toContain('עוזר שפה מקומי');
    expect(html).toContain(`data-testid="${TID.assistantLocalInsert}"`);
    expect(html).toContain(`data-testid="${TID.assistantLocalIgnore}"`);
    expect(html).toContain('הכנס לשורה');
    expect(html).toContain('התעלם');
    expect(html).not.toContain('השמיט');
    expect(view({ rs: { kind: 'suggested', jobId: 'j', phrase: 'הנמך את המוזיקה', intent: 'gain_change', dropped: true } })).toContain('השמיט מספר או טקסט שלא נאמרו בבקשה');
  });
  it('the phrase is never concatenated into a sentence: the sentence and the span are separate nodes (a name with an angle bracket stays text)', () => {
    const html = view({ rs: { kind: 'suggested', jobId: 'j', phrase: 'שים כיתוב <b>x</b>', intent: 'add_title', dropped: false } });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
  it('not understood (intent none): its sentence, no phrase, no insert button; the question may be asked again', () => {
    const html = view({ rs: { kind: 'none', jobId: 'j' } });
    expect(html).toContain('data-local-state="none"');
    expect(html).toContain('העוזר לא מצא פקודה מתאימה');
    expect(html).not.toContain(TID.assistantLocalInsert);
    expect(html).not.toContain(TID.assistantLocalSuggestion);
    expect(html).toContain(TID.assistantLocalAsk);
  });
  it('every failure reads as a reason and a next step in Hebrew, with no insert button and no money control', async () => {
    const cases: [string, string][] = [
      ['local_not_running', 'the local assistant is not running on this computer'],
      ['local_loading', 'the local assistant is still loading its model'],
      ['local_timeout', 'the local assistant took longer than the time limit, and the request was stopped'],
      ['local_not_loopback', 'the local assistant\'s address did not lead to this computer, so nothing was sent'],
      ['grammar_understood', 'the command bar reads this request itself, so it is not sent to the local assistant'],
    ];
    const { refusalWords } = await import('./describe.ts');
    for (const [code, message] of cases) {
      const w = refusalWords('he', { code, message });
      expect(w.untranslated, code).toBeNull();
      expect(/[א-ת]/.test(w.reason), code).toBe(true);
      expect(w.reason.split('; ').length, `${code}: a reason and a next step`).toBe(2);
      const html = view({ rs: { kind: 'failed', code, message }, failedWords: w });
      expect(html, code).toContain('data-local-state="failed"');
      expect(html, code).toContain('הבקשה לעוזר נכשלה');
      expect(html, code).toContain('שום דבר לא שונה');
      expect(html, code).not.toContain(TID.assistantLocalInsert);
      expect(html, code).not.toMatch(MONEY);
      expect(html, code).not.toContain(TID.releaseHeld);
      const en = refusalWords('en', { code, message, hint: 'next step' });
      expect(view({ rs: { kind: 'failed', code, message }, failedWords: en }, 'en'), code).toContain('The request to the assistant failed');
    }
  });
  it('canceled: what the cancel did, no money word, no release button', () => {
    for (const sent of [false, true]) {
      const html = view({ rs: { kind: 'canceled', sent } });
      expect(html).toContain(`data-sent="${sent}"`);
      expect(html).not.toMatch(MONEY);
      expect(html).not.toContain(TID.releaseHeld);
    }
  });
  it('inserted: the badge «הצעת העוזר — בדקו לפני Enter» while the text is the phrase, gone after the first edit', () => {
    const on = view({ rs: { kind: 'hidden' }, kind: 'plan', inserted: 'הנמך את המוזיקה ב־6 דציבל', q: 'הנמך את המוזיקה ב־6 דציבל' });
    expect(on).toContain(`data-testid="${TID.assistantLocalBadge}"`);
    expect(on).toContain('הצעת העוזר — בדקו לפני Enter');
    const edited = view({ rs: { kind: 'hidden' }, kind: 'plan', inserted: 'הנמך את המוזיקה ב־6 דציבל', q: 'הנמך את המוזיקה ב־7 דציבל' });
    expect(edited).not.toContain(TID.assistantLocalBadge);
  });
  it('the ignored note and the failed-erase note are statuses; nothing in any state names a commit', () => {
    expect(view({ rs: { kind: 'hidden' }, kind: 'plan', note: 'ignored' })).toContain('ההצעה הוסרה');
    expect(view({ rs: { kind: 'hidden' }, kind: 'plan', note: 'takenFailed' })).toContain('לא הצלחנו למחוק');
  });
});

describe('the Settings fields (markup)', () => {
  const form = { ...S.formOf(null), adapter: ASSISTANT_LOCAL_ADAPTER_ID };
  const fields = (over: Partial<Parameters<typeof S.LocalSettingsFields>[0]> = {}, lang: 'he' | 'en' = 'he') =>
    renderToStaticMarkup(createElement(S.LocalSettingsFields, { lang, form, set: nop, savedPort: 8791, check: { busy: false, result: null, failed: null }, onCheck: nop, ...over }));
  it('shows only the port and the time limit (defaults 8791 and 60), the check, what is sent, the unmeasured note and the guide; no host, model, key, price, limit or switch', () => {
    const html = fields();
    for (const id of [TID.assistantLocalSettings, TID.assistantLocalPort, TID.assistantLocalTimeout, TID.assistantLocalCheck, TID.assistantLocalState, TID.assistantLocalUnmeasured, TID.assistantLocalGuide]) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('value="8791"');
    expect(html).toContain('value="60"');
    expect(html.match(/<input/g)?.length).toBe(2);
    for (const id of [TID.settingsHost, TID.settingsModel, TID.settingsKey, TID.settingsPriceIn, TID.settingsMonthly, TID.settingsCap, TID.settingsToggleTitles, TID.settingsTogglePeople]) expect(html).not.toContain(id);
    expect(html).not.toContain('type="password"');
    expect(html).toContain('רק המשפט שהקלדתם בשורה, בלי כלום מהפרויקט');
    expect(html).toContain('המודל פועל רק על המחשב הזה');
    expect(html).toContain('איכות העברית והמהירות של העוזר על המחשב הזה לא נמדדו');
    expect(html).toContain('בדיקת חיבור');
    expect(html).not.toMatch(/https?:\/\//);
  });
  it('English says the same', () => {
    const html = fields({}, 'en');
    expect(html).toContain('Only the sentence you typed in the bar is sent');
    expect(html).toContain('The model runs only on this computer');
    expect(html).toContain('have not been measured');
    expect(html).toContain('Check the connection');
  });
  it('the check is allowed only for the saved port, and says to save first otherwise', () => {
    expect(fields()).not.toMatch(/<button[^>]*disabled[^>]*data-testid="assistant-local-check"|data-testid="assistant-local-check"[^>]*disabled/);
    const other = fields({ form: { ...form, port: '9000' } });
    expect(other).toContain('שמרו את ההגדרות ואז בדקו');
    expect(other).toMatch(/disabled/);
    expect(fields({ savedPort: null })).toContain('שמרו את ההגדרות ואז בדקו');
  });
  it('the honest state in words, one for each thing the check can find; the model name only when it is running', () => {
    expect(fields()).toContain('data-state="unchecked"');
    expect(fields()).toContain('עוד לא נבדק');
    const at = '2026-11-25T10:00:00.000Z';
    const r = (state: string, model: string | null) => fields({ check: { busy: false, failed: null, result: { state, model, checkedAt: at } as never } });
    expect(r('running', 'MODEL-FIXTURE.gguf')).toContain('העוזר המקומי פועל');
    expect(r('running', 'MODEL-FIXTURE.gguf')).toContain('MODEL-FIXTURE.gguf');
    expect(r('running', 'MODEL-FIXTURE.gguf')).toContain(TID.assistantLocalModel);
    expect(r('loading', null)).toContain('עוד טוען את המודל');
    expect(r('stopped', null)).toContain('לא פועל כרגע');
    expect(r('not_llama', null)).toContain('ביציאה הזו עונה תוכנה אחרת');
    expect(r('loading', null)).not.toContain(TID.assistantLocalModel);
    expect(r('stopped', 'ignored.gguf')).not.toContain('ignored.gguf');
    expect(fields({ check: { busy: true, result: null, failed: null } })).toContain('בודק…');
  });
  it('no money word and no claim of quality anywhere in the fields', () => {
    for (const lang of ['he', 'en'] as const) { const html = fields({}, lang); expect(html).not.toMatch(MONEY); expect(html).not.toMatch(QUALITY); }
  });
});

describe('configBodyOf with the local assistant chosen', () => {
  const form = { ...S.formOf(null), adapter: ASSISTANT_LOCAL_ADAPTER_ID, host: 'evil.example.test', model: 'x', priceIn: '5', priceOut: '5', monthly: '500', cap: '20', titles: true, people: true };
  it('sends the adapter and the two local fields, and nothing a cloud service would need (typed leftovers are dropped)', () => {
    const b = S.configBodyOf({ ...form, port: '8791', timeout: '60' });
    expect(b).toEqual({ adapter: ASSISTANT_LOCAL_ADAPTER_ID, host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { titlesAndMarkers: false, peopleNames: false }, local: { port: 8791, timeoutSeconds: 60 } });
  });
  it('an invalid port or time limit saves nothing (null)', () => {
    expect(S.configBodyOf({ ...form, port: '80' })).toBeNull();
    expect(S.configBodyOf({ ...form, port: '127.0.0.1:8791' })).toBeNull();
    expect(S.configBodyOf({ ...form, timeout: '1' })).toBeNull();
  });
});
