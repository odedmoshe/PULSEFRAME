/**
 * The phone drop dialog and the import cards render from props only (no server, no browser): createElement + renderToStaticMarkup.
 * The dialog is checked through PhoneDropBody (the ds Dialog portals into document.body, which a string render cannot do).
 * What a real browser does with focus, Esc and the QR scan is the lead's proof, not this file.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DropAddress, DropCodeView, DropPublicView, ImportJobView } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { ImportCards } from './ImportCards.tsx';
import { PhoneDropBody, formatClock, groupPin, type PhoneDropProps } from './PhoneDrop.tsx';
import { encodeQr } from '../qr.ts';
import { IMPORT_TESTIDS, PHONE_DROP_TESTIDS } from './imports.testids.ts';
import type { ImportsState } from './imports.ts';

const T0 = Date.parse('2026-11-18T10:00:00Z');
const addresses: DropAddress[] = [{ address: '192.168.1.20', netmask: '255.255.255.0', interfaceName: 'Wi-Fi', preferred: true }, { address: '10.0.0.5', netmask: '255.0.0.0', interfaceName: 'VPN', preferred: false }];
const URL_ = 'http://192.168.1.20:8788/#AAAAAAAAAAAAAAAAAAAAAA';
const code = (over: Partial<DropCodeView> = {}): DropCodeView => ({
  dropId: 'd1', projectId: 'p', state: 'waiting', closeReason: null, issuedAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 600_000).toISOString(), files: 0, bytes: 0, inFlight: 0, remainingBytes: 1e9, filesLeft: 200,
  address: '192.168.1.20', port: 8788, url: URL_, pin: '483921', ...over,
});
const base: PhoneDropProps = {
  lang: 'he', open: true, addresses, code: null, live: null, files: [], problem: null, now: T0,
  onOpenCode() {}, onCloseCode() {}, onNewCode() {}, onHide() {}, onRetry() {}, onCancel() {}, onDismiss() {},
};
const html = (p: Partial<PhoneDropProps>) => { const { open: _o, onHide: _h, ...rest } = { ...base, ...p }; return renderToStaticMarkup(createElement(PhoneDropBody, rest)); };
const job = (over: Partial<ImportJobView> = {}): ImportJobView => ({
  jobId: 'j1', projectId: 'p', name: 'IMG_1.MOV', byteSize: 412 * 1024 ** 2, via: 'phone', state: 'waiting', waitingFor: 'turn', percent: null, queuePosition: 2, reasons: [], assetId: null, deduplicated: false, error: null,
  batchId: null, dropId: 'd1', retryOf: null, attempt: 1, createdAt: 'x', updatedAt: 'x', ...over,
});
const id = (t: string) => `data-testid="${t}"`;

describe('PhoneDropBody', () => {
  it('before a code: the three steps, the address the owner confirms (preferred first), the start button and the Windows hint', () => {
    const h = html({});
    expect(h).toContain('הטלפון והמחשב באותה רשת Wi-Fi');
    expect(h).toContain(id(PHONE_DROP_TESTIDS.address));
    expect(h.indexOf('192.168.1.20 (Wi-Fi)')).toBeLessThan(h.indexOf('10.0.0.5 (VPN)'));
    expect(h).toContain(id(PHONE_DROP_TESTIDS.start));
    expect(h).toContain(id(PHONE_DROP_TESTIDS.hint));
    expect(h).not.toContain(id(PHONE_DROP_TESTIDS.qr));
    expect(h).toContain(id(PHONE_DROP_TESTIDS.disclosure));
    expect(h).toContain('מה נפתח לרשת?');
  });
  it('waiting: the QR on a white plate with the modules of the URL, the typed address and code in dir=ltr bdi, the status line and a separate countdown', () => {
    const h = html({ code: code(), now: T0 + 18_000 });
    expect(h).toContain(id(PHONE_DROP_TESTIDS.qr));
    expect(h).toContain('role="img"');
    expect(h).toContain('fill="#ffffff"');
    expect(h).toContain('fill="#000000"');
    const m = encodeQr(URL_);
    expect(h).toContain(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`);
    expect(h).toMatch(/<bdi dir="ltr"[^>]*data-testid="phone-drop-typed-address">192\.168\.1\.20:8788<\/bdi>/);
    expect(h).toMatch(/<bdi dir="ltr"[^>]*data-testid="phone-drop-pin">483 921<\/bdi>/);
    expect(h).toContain('אי אפשר לסרוק? הקלידו בדפדפן של הטלפון');
    expect(h).toMatch(/<span role="status" data-testid="phone-drop-status">ממתין לטלפון<\/span>/);
    expect(h).toContain('הקוד בתוקף עוד 9:42');
    // the countdown is NOT inside the live status element
    expect(h).not.toMatch(/role="status"[^>]*>[^<]*9:42/);
    expect(h).not.toContain('נשארה דקה אחת לקוד');
    expect(h).not.toContain(id(PHONE_DROP_TESTIDS.problem));
    expect(h).toContain(id(PHONE_DROP_TESTIDS.close));
    expect(h).toContain(id(PHONE_DROP_TESTIDS.renew));
  });
  it('one announcement at one minute left; the Windows and VPN hints after 45 s without a phone', () => {
    expect(html({ code: code(), now: T0 + 30_000 })).not.toContain(id(PHONE_DROP_TESTIDS.hint));
    const late = html({ code: code(), now: T0 + 545_000 });
    expect(late).toContain('נשארה דקה אחת לקוד');
    expect(late).toContain('אשרו גישה ברשתות פרטיות בלבד');
    expect(late).toContain('אם VPN פעיל');
  });
  it('claimed: the QR is gone and says the code was used; the status counts the files and bytes; the files are cards', () => {
    const live: DropPublicView = { ...code(), state: 'connected', files: 3, bytes: 412 * 1024 ** 2, inFlight: 1 };
    const h = html({ code: code({ url: null, pin: null, state: 'connected' }), live, files: [job(), job({ jobId: 'j2', state: 'ready', waitingFor: null, name: 'b.jpg', assetId: 'a' })] });
    expect(h).not.toContain(id(PHONE_DROP_TESTIDS.qr));
    expect(h).toContain('הקוד נוצל — הוא לא יעבוד במכשיר נוסף');
    expect(h).toContain('התקבלו 3 קבצים · 412 MB');
    expect(h).toContain(id(IMPORT_TESTIDS.card('j1')));
    expect(h).toContain(id(IMPORT_TESTIDS.card('j2')));
    expect(h).toContain(id(PHONE_DROP_TESTIDS.files));
  });
  it('the honest states: no home network, port failed (with retry), locked, expired, restarted', () => {
    expect(html({ addresses: [] })).toContain('המחשב אינו מחובר לרשת ביתית');
    expect(html({ addresses: [] })).not.toContain(id(PHONE_DROP_TESTIDS.start));
    const failed = html({ problem: 'drop_listen_failed' });
    expect(failed).toContain('לא הצלחנו לפתוח את הפתח לטלפון');
    expect(failed).toContain('ניסיון חוזר');
    expect(html({ problem: 'restarted' })).toContain('התוכנה הופעלה מחדש');
    for (const [reason, text] of [['locked', 'הקוד נסגר אחרי כמה ניסיונות שגויים'], ['expired', 'הקוד פג'], ['idle', 'הקוד פג'], ['shutdown', 'התוכנה הופעלה מחדש']] as const) {
      const live: DropPublicView = { ...code(), state: 'closed', closeReason: reason };
      const h = html({ code: code({ url: null, pin: null, state: 'closed', closeReason: reason }), live });
      expect(h, reason).toContain(text);
      expect(h, reason).not.toContain(id(PHONE_DROP_TESTIDS.qr));
      expect(h, reason).not.toContain(id(PHONE_DROP_TESTIDS.close)); // nothing to close
      expect(h, reason).toContain(id(PHONE_DROP_TESTIDS.renew)); // a new code is offered
    }
    const byOwner = html({ code: code({ url: null, pin: null, state: 'closed' }), live: { ...code(), state: 'closed', closeReason: 'owner' } });
    expect(byOwner).toContain('הקוד נסגר');
    expect(byOwner).not.toContain(id(PHONE_DROP_TESTIDS.problem));
  });
  it('the same dialog in English, left to right', () => {
    const h = html({ lang: 'en', code: code() });
    expect(h).toContain('dir="ltr"');
    expect(h).toContain('Waiting for the phone');
    expect(h).toContain('The code is valid for 10:00');
    expect(h).toContain('What is opened to the network?');
  });
  it('helpers', () => {
    expect(formatClock(9 * 60_000 + 41_200)).toBe('9:42');
    expect(formatClock(-5)).toBe('0:00');
    expect(groupPin('483921')).toBe('483 921');
  });
});

describe('ImportCards', () => {
  const state = (over: Partial<ImportsState>): ImportsState => ({ local: [], jobs: [], room: null, skipped: null, ...over });
  const cards = (s: ImportsState, lang: 'he' | 'en' = 'he') => renderToStaticMarkup(createElement(ImportCards, { lang, state: s, onRetry() {}, onCancel() {}, onDismiss() {}, onCancelLocal() {} }));
  it('draws nothing when there is nothing to show', () => expect(cards(state({}))).toBe(''));
  it('the four Hebrew states, the summary count and the test ids', () => {
    const jobs = [
      job({ jobId: 'w', state: 'waiting', waitingFor: 'turn', queuePosition: 3, name: 'a.mp4' }),
      job({ jobId: 'c', state: 'converting', waitingFor: null, percent: 42, reasons: ['rotation'], name: 'b.mov', via: 'browser' }),
      job({ jobId: 'r', state: 'ready', waitingFor: null, assetId: 'x', name: 'c.jpg' }),
      job({ jobId: 'f', state: 'failed', waitingFor: null, name: 'd.avi', error: { code: 'unsupported_media', message: 'x', retryable: false } }),
      job({ jobId: 'g', state: 'failed', waitingFor: null, name: 'e.mp4', error: { code: 'disk_full', message: 'x', retryable: true } }),
    ];
    const h = cards(state({ jobs }));
    expect(h).toContain('בייבוא (5)');
    expect(h).toContain(id(IMPORT_TESTIDS.summary));
    for (const j of jobs) expect(h).toContain(id(IMPORT_TESTIDS.card(j.jobId)));
    for (const t of ['ממתין', 'בתור: 3 לפניו', 'ממיר 42%', dictionaries.he['notice.reason.rotation'], 'מוכן', 'נכשל', dictionaries.he['error.code.unsupported_media'], 'אין מספיק מקום פנוי בדיסק']) expect(h).toContain(t);
    expect(h).toContain('מהטלפון');
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="42"');
    expect(h).toContain(id(IMPORT_TESTIDS.state));
    // retry only for the retryable failure; both failures can be removed; cancel on waiting and converting only
    expect((h.match(/data-testid="import-retry"/g) ?? []).length).toBe(1);
    expect((h.match(/data-testid="import-dismiss"/g) ?? []).length).toBe(2);
    expect((h.match(/data-testid="import-cancel"/g) ?? []).length).toBe(2);
    // the card list is not the library's ul.assets
    expect(h).not.toContain('class="assets"');
  });
  it('announces only the ready and failed cards in one live region, never a percent', () => {
    const h = cards(state({ jobs: [job({ jobId: 'c', state: 'converting', waitingFor: null, percent: 42, name: 'b.mov' }), job({ jobId: 'r', state: 'ready', waitingFor: null, name: 'c.jpg' }), job({ jobId: 'f', state: 'failed', waitingFor: null, name: 'd.avi', error: { code: 'internal_error', message: '', retryable: true } })] }));
    const live = /<div class="pf-sr" role="status"[^>]*>(.*?)<\/div>/.exec(h)![1]!;
    expect(live).toContain('c.jpg מוכן לעריכה');
    expect(live).toContain('הייבוא של d.avi נכשל');
    expect(live).not.toContain('b.mov');
    expect(live).not.toContain('42');
  });
  it('local uploads: «בהעלאה 42%», waiting, not uploaded with its reason, and the skipped-files notice', () => {
    const l = (localId: string, st: 'uploading' | 'pending-upload' | 'not-uploaded', percent: number, reason: string | null) => ({ localId, name: `${localId}.mp4`, byteSize: 1000, via: 'folder' as const, state: st, percent, jobId: null, reason });
    const h = cards(state({ local: [l('u', 'uploading', 42, null), l('p', 'pending-upload', 0, null), l('n', 'not-uploaded', 0, 'network_error')], skipped: { count: 3, reason: 'not-media' } }));
    expect(h).toContain('בהעלאה 42%');
    expect(h).toContain('ממתין להעלאה');
    expect(h).toContain('לא הועלה');
    expect(h).toContain('ההעלאה נקטעה');
    expect(h).toContain('מתיקייה');
    expect(h).toContain('דילגנו על 3 קבצים שאינם מדיה');
    expect(h).toContain(id(IMPORT_TESTIDS.localCard('u')));
    expect(h).toContain(id(IMPORT_TESTIDS.skipped));
    expect(cards(state({ skipped: { count: 120, reason: 'too-many' } }))).toContain('אפשר לייבא עד 500 בבת אחת');
  });
  it('English cards', () => {
    expect(cards(state({ jobs: [job({ state: 'ready', waitingFor: null })] }), 'en')).toContain('Ready');
  });
});
