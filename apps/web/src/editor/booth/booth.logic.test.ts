/** Builder W3: the dialog's queue, progress, keyboard, rows and report box (plan checks 12, 14; verify C5, C9). Pure logic; the page itself is proven by booth-proof.ui.ts. */
import { describe, expect, it } from 'vitest';
import { BOOTH_CHECKS, BOOTH_FIRST_SITTING_CARDS, BoothNotBuiltError, INSTRUMENTS_FORBIDDEN_WORDS, INSTRUMENTS_FORBIDDEN_WORDS_HE, type BoothAnswer, type BoothGroup, type BoothItem, type BoothItemView, type BoothReportInput, type BoothView } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { BOOTH_COMMANDS } from './booth.commands.ts';
import {
  answerAllowed, answerBody, buildQueue, micExtras, pictureOnlySkip, viewQuery, commandIn, dateOf, firstPartCounts, hasNotes, isTyping, keyAction, localDay, moreGroups, nextPartIndex, noAdapter, orderWithinGroup, parseRows, playedHash,
  queueCounts, reportBox, rowWords, rowsInOrder, startIndex, stateLine, withAnswer,
} from './booth.logic.ts';
import { BOOTH_PAGE, makeSay } from './booth.strings.ts';
import { isOwnerActor } from '../library/library.logic.ts';

const HEX = 'a'.repeat(64);
const sha = `sha256:${HEX}`;
// LABELLED stand-ins: synthetic items shaped like the registry's (W1's registry is not in this worktree's tests)
const mk = (id: string, group: BoothGroup, kind: BoothItem['kind'], extra: Partial<BoothItem> = {}): BoothItem => ({
  id, source: kind === 'audio' ? 'music' : kind === 'picture' ? 'gpu-transition' : 'task', group, kind, title: { he: id, en: id }, what: { he: 'מה', en: 'what' }, recipe: sha,
  make: kind === 'audio' ? { route: 'music', styleId: 'music.calm', bars: 8, seed: 1 } : kind === 'picture' ? { route: 'scene', scene: 'transition', id: 'x' } : { route: 'task', task: 'mic' },
  changesLight: false, exportStrip: false, usedBy: [], minutes: 1, problems: ['other'], ...extra,
});
const ans = (id: string, verdict: BoothAnswer['verdict'], at = '2026-11-27T10:00:00.000Z', extra: Partial<BoothAnswer> = {}): BoothAnswer => ({ id, verdict, recipe: sha, at, build: 'unknown', ...extra });
const view = (item: BoothItem, a: BoothAnswer | null = null, state: BoothItemView['state'] = a ? 'answered' : 'unanswered'): BoothItemView => ({ item, answer: a, state });
const trans = ['gpu-transition:a', 'gpu-transition:b', 'gpu-transition:c'].map((id) => mk(id, 'first.gpu-new', 'picture'));
const music = ['music:m1', 'music:m2'].map((id) => mk(id, 'first.music', 'audio'));
const mic = mk('task:mic', 'first.mic', 'task');
const more = mk('sfx:s1', 'more.sounds', 'audio');
const items = [...trans, ...music, mic, more].map((i) => view(i));
const bv = (v: BoothItemView[]): BoothView => ({ build: { commit: 'unknown', bundle: 'unknown' }, machine: { os: 'x', cpus: 1, memGiB: 1 }, firstSitting: { cards: BOOTH_FIRST_SITTING_CARDS, groups: ['first.gpu-new', 'first.music', 'first.mic'] }, groups: ['first.gpu-new', 'first.music', 'first.mic', 'more.sounds'], items: v });
const discrete = { state: 'ok' as const, data: { discrete: true } };
const intel = { state: 'ok' as const, data: { discrete: false } };
const he = makeSay('he'), en = makeSay('en');

describe('booth dialog logic (builder W3)', () => {
  it('the first screen says «חלק ראשון: 0 מתוך 14» (BOOTH_FIRST_SITTING_CARDS), never a larger total; «עוד» opens the more.* groups only on request', () => {
    const c = firstPartCounts(items);
    expect(c).toEqual({ done: 0, total: 14 });
    expect(he('booth.firstPart', c)).toBe('חלק ראשון: 0 מתוך 14');
    expect(en('booth.firstPart', c)).toBe('First part: 0 of 14');
    // a more.* answer never moves the first part's number or its total
    const withMore = items.map((v) => (v.item.group === 'more.sounds' ? view(v.item, ans(v.item.id, 'ok')) : v));
    expect(firstPartCounts(withMore)).toEqual({ done: 0, total: 14 });
    expect(buildQueue(items, discrete, false).some((e) => e.t === 'card' && e.group === 'more.sounds')).toBe(false);
    expect(buildQueue(items, discrete, true).some((e) => e.t === 'card' && e.group === 'more.sounds')).toBe(true);
    expect(moreGroups(items)).toEqual([{ group: 'more.sounds', n: 1, done: 0 }]);
    // no string of the page words shows a total of everything
    expect(he('booth.firstPart', { done: 3, total: 14 })).not.toMatch(/196/);
  });

  it('queue order: boothFirstOrder(row browser-gpu) for the first sitting; the Windows step where the order says so; inside a group unanswered and changed first, then skip (oldest first), answered last', () => {
    const kinds = (q: ReturnType<typeof buildQueue>) => q.map((e) => (e.t === 'windows' ? 'windows' : e.group));
    expect([...new Set(kinds(buildQueue(items, discrete, false)))]).toEqual(['first.gpu-new', 'first.music', 'first.mic']);
    expect([...new Set(kinds(buildQueue(items, intel, false)))]).toEqual(['first.music', 'first.mic', 'windows', 'first.gpu-new']);
    expect([...new Set(kinds(buildQueue(items, null, false)))]).toEqual(['first.music', 'first.mic', 'windows', 'first.gpu-new']);
    const mixed = [
      view(trans[0]!, ans(trans[0]!.id, 'ok')), view(trans[1]!, ans(trans[1]!.id, 'skip', '2026-11-27T09:00:00.000Z')), view(trans[2]!, ans(trans[2]!.id, 'skip', '2026-11-26T09:00:00.000Z')),
      view(mk('gpu-transition:d', 'first.gpu-new', 'picture')), view(mk('gpu-transition:e', 'first.gpu-new', 'picture'), ans('gpu-transition:e', 'ok'), 'changed'),
    ];
    expect(orderWithinGroup(mixed).map((v) => v.item.id)).toEqual(['gpu-transition:d', 'gpu-transition:e', 'gpu-transition:c', 'gpu-transition:b', 'gpu-transition:a']);
    // the sitting starts at the first card that is not answered; part skipping goes to the first entry of the next part
    const q = buildQueue(items, discrete, false);
    expect(startIndex(q, items)).toBe(0);
    const allTrans = items.map((v) => (v.item.group === 'first.gpu-new' ? view(v.item, ans(v.item.id, 'ok')) : v));
    expect(q[startIndex(q, allTrans)]).toMatchObject({ id: 'music:m1' });
    expect(q[nextPartIndex(q, 0)!]).toMatchObject({ group: 'first.music' });
    expect(nextPartIndex(q, q.length - 1)).toBeNull();
  });

  it('keys by e.code (Digit1 ok, Digit2 bad, Digit3 skip, KeyR again), inert with a modifier, on repeat, while typing and outside the dialog; no keyboard focus moved in a later task (deferredFocus.test.ts rule)', () => {
    expect(keyAction({ code: 'Digit1' })).toBe('ok');
    expect(keyAction({ code: 'Digit2' })).toBe('bad');
    expect(keyAction({ code: 'Digit3' })).toBe('skip');
    expect(keyAction({ code: 'KeyR' })).toBe('again');
    expect(keyAction({ code: 'Digit1', ctrlKey: true })).toBeNull();
    expect(keyAction({ code: 'Digit1', shiftKey: true })).toBeNull();
    expect(keyAction({ code: 'KeyR', repeat: true })).toBeNull();
    expect(keyAction({ code: 'Space' })).toBeNull();
    expect(isTyping({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTyping({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTyping({ tagName: 'INPUT' })).toBe(true);
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTyping({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTyping({ tagName: 'BUTTON' })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it('progress «נבדקו n מתוך m» counts answered and not changed; changed (recipe, played, adapter) counts as unanswered with its own words', () => {
    const v = [view(trans[0]!, ans(trans[0]!.id, 'ok')), view(trans[1]!, ans(trans[1]!.id, 'ok'), 'changed'), view(trans[2]!)];
    const q = buildQueue(v, discrete, false);
    expect(queueCounts(q, v)).toEqual({ done: 1, total: 3 });
    expect(firstPartCounts(v)).toEqual({ done: 1, total: 14 });
    expect(he('booth.progress', { done: 1, total: 3 })).toBe('נבדקו 1 מתוך 3');
    for (const why of ['recipe', 'played', 'adapter'] as const) {
      const changed: BoothItemView = { item: trans[1]!, answer: ans(trans[1]!.id, 'ok'), state: 'changed', changedWhy: why };
      expect(stateLine(he, changed)).toBe(dictionaries.he[`booth.changed.${why}`]);
      expect(stateLine(en, changed)).toBe(dictionaries.en[`booth.changed.${why}`]);
    }
    expect(stateLine(he, view(trans[2]!))).toBe('עוד לא נענה');
    expect(stateLine(he, view(music[0]!, ans(music[0]!.id, 'ok')))).toBe('נשמע במחשב הזה, 27.11.2026 · בסדר');
    expect(stateLine(he, view(trans[0]!, ans(trans[0]!.id, 'bad')))).toBe('נראה במחשב הזה, 27.11.2026 · לא טוב');
    expect(dateOf('2026-01-05T00:00:00Z')).toBe('5.1.2026');
    expect(localDay(new Date(2026, 10, 5))).toBe('2026-11-05');
  });

  it('browser rows survive a closed Chrome in localStorage (parsed with the contract schema; garbage dropped; without storage it renders); the step says how to reopen the editor (booth.reopen)', () => {
    const good = { id: 'browser-gpu', state: 'ok', code: null, data: { discrete: true } };
    const text = JSON.stringify({ 'browser-gpu': good, 'browser-codecs': { id: 'ffmpeg', state: 'ok', code: null, data: {} }, mic: { id: 'mic', state: 'bogus', code: null, data: {} }, extra: 1 });
    expect(parseRows(text)).toEqual({ 'browser-gpu': good });
    expect(parseRows(null)).toEqual({});
    expect(parseRows('{not json')).toEqual({});
    expect(parseRows('[]')).toEqual({});
    expect(rowsInOrder(parseRows(text)).map((r) => r.id)).toEqual(['browser-gpu']);
    expect(he('booth.reopen')).toMatch(/start-pulseframe\.cmd/);
    expect(he('booth.afterRestart')).toMatch(/start-pulseframe\.cmd/);
    expect(noAdapter({ state: 'fail' })).toBe(true);
    expect(noAdapter({ state: 'setup' })).toBe(false);
    expect(noAdapter(null)).toBe(false);
  });

  it('the self-check rows say the state, the reason and the next step in words; a command in a next step is found as it stands', () => {
    const w = rowWords(he, 'export-gpu', { id: 'export-gpu', state: 'fail', code: 'fail', data: {} });
    expect(w).toMatchObject({ title: 'כרטיס המסך בייצוא', state: 'כשל', command: 'pnpm probe:gpu' });
    expect(w.next).toMatch(/pnpm probe:gpu/);
    const i = rowWords(he, 'browser-gpu', { id: 'browser-gpu', state: 'ok', code: 'integrated', data: {} });
    expect(i.code).toBe('הדפדפן מצייר בכרטיס המסך המובנה (Intel)');
    expect(i.next).toMatch(/Windows/);
    expect(rowWords(he, 'ffmpeg', undefined).state).toBe('');
    expect(rowWords(he, 'speech', { id: 'speech', state: 'setup', code: 'not_installed', data: {} }).code).toBe('לא מותקן — שלב שנעשה עם המפתחים');
    expect(commandIn('הריצו pnpm probe:gpu — והעתיקו')).toBe('pnpm probe:gpu');
    expect(commandIn('אין פקודה כאן')).toBeNull();
    // every row of the check has a title in both languages
    for (const c of BOOTH_CHECKS) { expect(he(`booth.check.${c.id}`)).not.toBe(`booth.check.${c.id}`); expect(en(`booth.check.${c.id}`)).not.toBe(`booth.check.${c.id}`); }
  });

  it('the answer body carries the recipe the card was opened with, problems only for «לא טוב» (the dialog sends a note only from that panel), the played hash and the adapter facts', () => {
    const a = mk('music:m1', 'first.music', 'audio', { problems: ['too-loud', 'harsh', 'other'] });
    const v = view(a);
    expect(answerBody(v, { verdict: 'ok', problems: ['harsh'] })).toEqual({ verdict: 'ok', recipe: sha });
    expect(answerBody(v, { verdict: 'bad', problems: ['harsh', 'harsh', 'broken'], note: ' קצת חזק ', extras: { played: sha } })).toEqual({ verdict: 'bad', recipe: sha, problems: ['harsh'], note: 'קצת חזק', played: sha });
    expect(answerBody(v, { verdict: 'skip', extras: { browserAdapter: 'intel|gen-12|x|y', browserSoftware: false, exportAdapter: 'nvidia|ampere|x|y', exportSoftware: false } }))
      .toEqual({ verdict: 'skip', recipe: sha, browserAdapter: 'intel|gen-12|x|y', browserSoftware: false, exportAdapter: 'nvidia|ampere|x|y', exportSoftware: false });
    expect(answerBody(v, { verdict: 'bad', note: 'ח'.repeat(400) }).note).toHaveLength(280);
    expect(playedHash(HEX)).toBe(sha);
    expect(playedHash(sha)).toBe(sha);
    expect(playedHash('nope')).toBeNull();
    expect(playedHash(null)).toBeNull();
    const after = withAnswer(bv(items), ans('music:m1', 'ok'));
    expect(after.items.find((x) => x.item.id === 'music:m1')).toMatchObject({ state: 'answered', answer: { verdict: 'ok' } });
    expect(after.items.filter((x) => x.state === 'answered')).toHaveLength(1);
    expect(hasNotes(after.items)).toBe(false);
    expect(hasNotes([view(a, ans('music:m1', 'bad', undefined, { note: 'ח' }))])).toBe(true);
  });

  it('the report box shows exactly boothReport(...) and «העתקת הדוח» copies exactly that text; while the report is not built it says so and copies nothing', () => {
    const input: BoothReportInput = { view: bv(items), checks: [], date: '2026-11-27' };
    // LABELLED stand-in for W1's boothReport: the box must show what the builder returns, byte for byte, and say() is the dialog's own
    const standIn = (i: BoothReportInput, say: (k: string) => string) => `${say('booth.report.title')} · ${i.date}\n-----BEGIN PF-BOOTH 1-----\n{}\n-----END PF-BOOTH 1-----`;
    const ok = reportBox(input, he, standIn);
    expect(ok).toEqual({ ok: true, text: `PULSEFRAME — דוח תא הבדיקה · 2026-11-27\n-----BEGIN PF-BOOTH 1-----\n{}\n-----END PF-BOOTH 1-----` });
    const notBuilt = reportBox(input, he, () => { throw new BoothNotBuiltError('boothReport'); });
    expect(notBuilt.ok).toBe(false);
    expect(notBuilt.text).toContain(dictionaries.he['error.code.booth_not_built']);
    expect(reportBox(input, he, () => { throw new Error('boom'); })).toEqual({ ok: false, text: he('page.reportFailed') });
    // the real (not yet merged or merged) function never leaks a thrown error into the page
    expect(typeof reportBox(input, he).text).toBe('string');
    expect(he('booth.report.notesWarning')).toMatch(/ההערות/);
    expect(he('booth.report.nameWarning')).toMatch(/שם/);
  });

  it('the rail button and the palette command exist only for the owner\'s own session (isOwnerActor), the command has no default key', () => {
    expect(isOwnerActor('user:local')).toBe(true);
    expect(isOwnerActor(null)).toBe(false);
    expect(isOwnerActor('agent:claude')).toBe(false);
    expect(BOOTH_COMMANDS).toHaveLength(1);
    const c = BOOTH_COMMANDS[0]!;
    expect(c.keys).toEqual([]);
    expect(c.text?.he).toBe('פתיחת תא הבדיקה');
    const editor = (actor: string | null) => ({ getState: () => ({ actor }) }) as never;
    expect(c.enabled?.(editor('user:local'))).toBe(true);
    expect(c.enabled?.(editor('agent:claude'))).toBe(false);
    expect(c.enabled?.(editor(null))).toBe(false);
  });

  it('the page-only strings: Hebrew and English with the same keys, plural address, no praise word, no word of the instruments list (whole words; the lead also adds this file to booth-wording.test.ts)', () => {
    const heb = /[\u0590-\u05FF]/;
    const heWord = (w: string) => new RegExp(`(^|[^\\u0590-\\u05FF])${w}([^\\u0590-\\u05FF]|$)`);
    const enWord = (w: string) => new RegExp(`\\b${w}\\b`, 'i');
    const gendered = ['לחץ', 'לחצי', 'בחר', 'בחרי', 'הקש', 'סמן', 'נסה', 'נסי', 'הקלט', 'בדוק', 'העתק', 'הפעל', 'דלג', 'פתח', 'סגור', 'הנמך', 'ענה', 'חכה', 'חכי'];
    const praiseHe = ['מעולה', 'מושלם', 'מצוין', 'חד', 'חדה', 'בטוח', 'בטוחה', 'מאומת', 'איכותי', 'נכון', 'נכונה'];
    const praiseEn = ['good', 'great', 'perfect', 'excellent', 'sharp', 'safe', 'verified', 'correct', 'right'];
    expect(Object.keys(BOOTH_PAGE.en).sort()).toEqual(Object.keys(BOOTH_PAGE.he).sort());
    for (const k of Object.keys(BOOTH_PAGE.he) as (keyof typeof BOOTH_PAGE.he)[]) {
      const h = BOOTH_PAGE.he[k], e = BOOTH_PAGE.en[k];
      expect({ k, hebrew: heb.test(h) }).toEqual({ k, hebrew: true });
      for (const w of gendered) expect({ k, w, hit: heWord(w).test(h) }).toEqual({ k, w, hit: false });
      for (const w of [...praiseHe, ...INSTRUMENTS_FORBIDDEN_WORDS_HE]) expect({ k, w, hit: heWord(w).test(h) }).toEqual({ k, w, hit: false });
      for (const w of [...praiseEn, ...INSTRUMENTS_FORBIDDEN_WORDS]) expect({ k, w, hit: enWord(w).test(e) }).toEqual({ k, w, hit: false });
      expect({ k, total: /196/.test(h) || /196/.test(e) }).toEqual({ k, total: false });
    }
  });
});

describe('integration (lead points 3, 4 and the seam of the picture card)', () => {
  it('the mic measurement goes with the answer of the mic card only, as numbers rounded to 0.1 dBFS; silence stays null', () => {
    expect(micExtras({ peakDbfs: -12.345, clipped: 3.7 })).toEqual({ mic: { peakDbfs: -12.3, clipped: 3 } });
    expect(micExtras({ peakDbfs: null, clipped: 0 })).toEqual({ mic: { peakDbfs: null, clipped: 0 } });
    expect(micExtras({ peakDbfs: -Infinity, clipped: -1 })).toEqual({ mic: { peakDbfs: null, clipped: 0 } });
    expect(micExtras({ peakDbfs: -0.04, clipped: 0 }).mic!.peakDbfs).toBe(0);
    expect(answerBody(view(mic), { verdict: 'ok', extras: micExtras({ peakDbfs: -20, clipped: 0 }) })).toEqual({ verdict: 'ok', recipe: sha, mic: { peakDbfs: -20, clipped: 0 } });
    // a measurement handed to another kind of card is not sent
    expect(answerBody(view(music[0]!), { verdict: 'ok', extras: { mic: { peakDbfs: -20, clipped: 0 } } })).toEqual({ verdict: 'ok', recipe: sha });
  });
  it('GET /booth is asked with the adapters the rows found (browser and export), none when a row has none', () => {
    const row = (id: 'browser-gpu' | 'export-gpu', adapter?: string) => ({ id, state: 'ok' as const, code: null, data: (adapter ? { adapter } : {}) as Record<string, string> });
    expect(viewQuery({})).toEqual({});
    expect(viewQuery({ 'browser-gpu': row('browser-gpu', 'intel|gen-12lp||'), 'export-gpu': row('export-gpu', 'nvidia|ampere||') })).toEqual({ browserAdapter: 'intel|gen-12lp||', exportAdapter: 'nvidia|ampere||' });
    expect(viewQuery({ 'browser-gpu': row('browser-gpu') })).toEqual({});
  });
  it('a picture with no graphics card offers only «דלגו», for the buttons and for the keys alike', () => {
    const pic = view(trans[0]!);
    expect(pictureOnlySkip(pic, { state: 'off' }, false)).toBe(true);
    expect(pictureOnlySkip(pic, { state: 'ok' }, true)).toBe(true);
    expect(pictureOnlySkip(pic, { state: 'ok' }, false)).toBe(false);
    expect(pictureOnlySkip(view(music[0]!), { state: 'off' }, true)).toBe(false);
    expect([answerAllowed('ok', true), answerAllowed('bad', true), answerAllowed('skip', true), answerAllowed('ok', false)]).toEqual([false, false, true, true]);
  });
});
