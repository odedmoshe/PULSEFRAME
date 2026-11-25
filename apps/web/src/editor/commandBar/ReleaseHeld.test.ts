/**
 * The owner's release of a held amount (ReleaseHeld.tsx; ADR-0027, note of 2026-11-25 "the release control"): which amounts the
 * editor offers to release (only what the OWNER'S status lists as held), what the confirmation says (a release frees the editor's
 * own monthly count and does not undo a charge), the confirm pattern (the design system's dialog, the way out focused first),
 * and what the row and Settings say afterwards. Markup is rendered without a DOM, so the dialog's own behaviour (focus, Escape)
 * is driven in the browser by pnpm proof:command-bar 11g; here its composition is read from the source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantPublicStatus, AssistantStatus } from '@pulseframe/core';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { EditorContext } = await import('../store.ts');
const R = await import('./ReleaseHeld.tsx');
const S = await import('./AssistantSettings.tsx');
const Row = await import('./AssistantRow.tsx');
const { COMMAND_BAR_TESTIDS: TID } = await import('./commandBar.testids.ts');
const { barText, plain } = await import('./commandBar.strings.ts');
const { refusalWords } = await import('./describe.ts');

const fake = (actor: string | null, lang: 'he' | 'en' = 'he') => ({ subscribe: () => () => {}, getState: () => ({ actor, lang, doc: null, selection: [], activeSequenceId: '' }), t: (k: string) => k, frame: 0 }) as never;
const render = (el: ReturnType<typeof createElement>, lang: 'he' | 'en' = 'he') => renderToStaticMarkup(createElement(EditorContext.Provider, { value: fake('user:local', lang) }, el));
const HELD = [
  { jobId: 'job_a', cents: 12, requestedAt: '2026-11-25T14:03:00.000Z', status: 'canceled' },
  { jobId: 'job_b', cents: 7, requestedAt: '2026-11-24T09:30:00.000Z', status: 'submission-unknown' },
  { jobId: 'job_c', cents: 5, requestedAt: '2026-11-20T08:00:00.000Z', status: null },
];
const OWNER_STATUS: AssistantStatus = {
  setup: 'ready', detail: 'ready', adapter: 'TEST-MOCK-chat', host: 'api.example.test', model: 'mock-model', pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: 1000, perRequestCapCents: 20,
  month: '2026-11', spentCents: 31, reservedCents: 24, held: HELD, toggles: { titlesAndMarkers: false, peopleNames: false }, keySet: true, keyAddedAt: '2026-11-01T00:00:00.000Z', adapters: ['TEST-MOCK-chat'],
};
const PUBLIC_READY: AssistantPublicStatus = { connected: true, setup: 'ready', detail: 'x' };
const PUBLIC_OFF: AssistantPublicStatus = { connected: false, setup: 'not_connected', detail: 'x' };

describe('which amount is offered for release', () => {
  it('only an amount the owner\'s status lists as held for that request; a status that is not the owner\'s lists none', () => {
    expect(R.heldAmount(OWNER_STATUS, 'job_a')).toEqual(HELD[0]);
    expect(R.heldAmount(OWNER_STATUS, 'job_settled')).toBeNull(); // settled, released, or never sent: nothing to release, no button
    expect(R.heldAmount(OWNER_STATUS, undefined)).toBeNull();
    expect(R.heldAmount(PUBLIC_READY, 'job_a')).toBeNull();
    expect(R.heldAmount(null, 'job_a')).toBeNull();
  });
  it('after a release the month counts exactly that much less; what was spent does not move; an unknown job changes nothing', () => {
    const after = R.withoutHeld(OWNER_STATUS, 'job_a');
    expect([after.reservedCents, after.spentCents, after.held.map((h) => h.jobId)]).toEqual([12, 31, ['job_b', 'job_c']]);
    expect(R.withoutHeld(OWNER_STATUS, 'job_x')).toBe(OWNER_STATUS);
    expect(OWNER_STATUS.held).toHaveLength(3); // not changed in place
  });
});

describe('the confirmation says what a release is and what it is not', () => {
  it('Hebrew and English: it frees the editor\'s own monthly count; it does not undo a charge; it is final; it never promises money back', () => {
    const he = plain(render(createElement(R.ReleaseConfirmBody, { lang: 'he', cents: 12, failed: null })).replace(/<[^>]+>/g, ' '));
    expect(he).toMatch(/מוריד\s+12¢\s+מהספירה החודשית של העורך/);
    expect(he).toMatch(/הוא לא מבטל חיוב: ייתכן שהשירות חייב אתכם על הבקשה הזו בכל זאת/);
    expect(he).toMatch(/דף החיובים של השירות/);
    expect(he).toMatch(/אי אפשר לבטל שחרור/);
    const en = plain(render(createElement(R.ReleaseConfirmBody, { lang: 'en', cents: 12, failed: null }), 'en').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\''));
    expect(en).toMatch(/takes\s+12¢\s+off the editor's own count for this month, and that is all it does/);
    expect(en).toMatch(/It does not undo a charge: the service may still have charged you/);
    expect(en).toMatch(/A release cannot be undone/);
    for (const text of [he, en, barText('he', 'release.done', { amount: 'x' }), barText('en', 'release.done', { amount: 'x' }), barText('he', 'release.button'), barText('en', 'release.button')])
      expect(text).not.toMatch(/refund|money back|החזר|זיכוי|יוחזר/i);
    // the amount keeps its own direction inside the Hebrew sentence
    expect(render(createElement(R.ReleaseConfirmBody, { lang: 'he', cents: 12, failed: null }))).toMatch(/<bdi[^>]*>12¢<\/bdi>/);
  });
  it('the sentence after a release names the amount, the editor\'s count, and that a charge (if there was one) stands', () => {
    expect(plain(R.releasedWords('he', 12))).toBe('הסכום 12¢ שוחרר מהספירה החודשית של העורך. אם השירות חייב על הבקשה, החיוב נשאר אצלו');
    expect(plain(R.releasedWords('en', 12))).toBe('12¢ was released from the editor\'s monthly count. If the service charged for the request, that charge stands');
    expect(Row.releasedLine('he', { cents: 12, gone: true })).toBe(barText('he', 'release.gone'));
    expect(plain(Row.releasedLine('en', { cents: 12, gone: false }))).toBe(plain(R.releasedWords('en', 12)));
  });
  it('a refusal of the release is shown inside the confirmation as a status, in Hebrew with its next step', () => {
    const words = refusalWords('he', { code: 'nothing_to_release', message: 'this job has no unresolved reservation', hint: 'Nothing is held for it any more' });
    const html = render(createElement(R.ReleaseConfirmBody, { lang: 'he', cents: 12, failed: words }));
    expect(html).toMatch(new RegExp(`<p class="pf-asst-bad" role="status" data-testid="${TID.releaseRefused}">הסכום לא שוחרר: `));
    expect(html).toContain('לבקשה הזו כבר אין סכום שמור');
    expect(html).not.toMatch(/no unresolved reservation|Nothing is held/);
  });
});

describe('the button and its confirm dialog', () => {
  it('a named button that says it opens a dialog: a text button in the palette row, the design system\'s small button in Settings', () => {
    const link = render(createElement(R.ReleaseHeld, { lang: 'he', held: HELD[0]!, look: 'link', onDone: () => {} }));
    expect(link).toMatch(new RegExp(`^<button type="button" class="pf-bar-link" data-testid="${TID.releaseHeld}" data-job="job_a" aria-label="שחרור הסכום השמור, 12¢, בקשה מ־[^"]+" aria-haspopup="dialog">שחרור הסכום השמור</button>$`));
    const button = render(createElement(R.ReleaseHeld, { lang: 'en', held: HELD[1]!, look: 'button', onDone: () => {} }), 'en');
    expect(button).toMatch(/class="[^"]*pf-btn pf-btn-secondary pf-btn-sm[^"]*"/);
    expect(button).toMatch(/aria-label="Release the held amount, 7¢, request of [^"]+"/);
    expect(button).toContain('>Release the held amount<');
    expect(button).not.toContain('role="dialog"'); // nothing is confirmed until the button is pressed
  });
  it('the confirmation follows the design system\'s pattern for an irreversible owner action (as ConfirmRemoveSequence): a small modal a click outside does not close, a quiet way out focused first, a danger button; its keys do not reach the dialog it was opened from', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'ReleaseHeld.tsx'), 'utf8');
    expect(src).toMatch(/<Dialog open onClose=\{close\} title=\{barText\(lang, 'release\.title'\)\} size="sm" dismissOnBackdrop=\{false\}/);
    expect(src).toMatch(/<Button variant="ghost" onClick=\{close\} data-autofocus="" data-testid=\{TID\.releaseKeep\}>/);
    expect(src).toMatch(/<Button variant="danger" busy=\{busy\} onClick=\{\(\) => void run\(\)\} data-testid=\{TID\.releaseConfirm\}>/);
    expect(src).toMatch(/<span onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}>\s*<Dialog /);
    expect(src).toMatch(/await api\.releaseBudget\(held\.jobId\);/);
    const other = fs.readFileSync(path.join(import.meta.dirname, '../SequenceSwitcher.tsx'), 'utf8');
    expect(other).toMatch(/size="sm" dismissOnBackdrop=\{false\}/);
    expect(other).toMatch(/<Button variant="danger"/);
  });
});

describe('Settings: the month\'s held amounts', () => {
  it('nothing is drawn when nothing is held', () => {
    expect(render(createElement(S.HeldAmounts, { lang: 'he', held: [], onDone: () => {} }))).toBe('');
  });
  it('one row per held amount: the amount, when the request was made, how it ended, and its own release button with its own name', () => {
    const html = render(createElement(S.HeldAmounts, { lang: 'he', held: HELD, onDone: () => {} }));
    expect(html).toMatch(new RegExp(`<div class="pf-asst" role="group" aria-labelledby="pf-asst-held-h" data-testid="${TID.settingsHeld}"><h4 id="pf-asst-held-h" class="pf-set-h">סכומים שמורים</h4>`));
    expect(html.match(new RegExp(`data-testid="${TID.settingsHeldRow}"`, 'g'))).toHaveLength(3);
    expect(html.match(/data-how="[^"]+"/g)).toEqual(['data-how="canceled"', 'data-how="submission-unknown"', 'data-how="gone"']);
    for (const how of ['בוטלה אחרי שנשלחה', 'לא ידוע אם הגיעה לשירות', 'הפרויקט שלה נמחק']) expect(html).toContain(how);
    const names = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3); // told apart by amount and time
    expect(html).toContain('לא ידוע אם חויבו');
    const en = render(createElement(S.HeldAmounts, { lang: 'en', held: [{ ...HELD[0]!, status: 'failed' }], onDone: () => {} }), 'en');
    expect(en).toContain('failed after it was sent');
    expect(en).toContain('Held amounts');
  });
});

describe('the row for a session that is not the owner\'s: connected or not, and no amount', () => {
  it('reads the connected-or-not status: ready is ready, not connected reads «עוזר השפה לא מחובר» without saying what is missing', () => {
    expect(Row.isReady(PUBLIC_READY)).toBe(true);
    expect(Row.isReady(PUBLIC_OFF)).toBe(false);
    expect(Row.setupWords('he', PUBLIC_OFF)).toBe('עוזר השפה לא מחובר');
    expect(Row.setupWords('en', PUBLIC_OFF)).toBe('Language assistant not connected');
    expect(Row.setupWords('he', { ...OWNER_STATUS, setup: 'limit_missing' })).toMatch(/חסרה מגבלת הוצאה/); // the owner is told which
    expect(Row.setupWords('he', null)).toBe('עוזר השפה לא מחובר');
  });
});
