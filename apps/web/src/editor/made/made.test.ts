/**
 * «קליפ מקוד» interface tests (wave 8 motioncode W3). There is no DOM here: the pure logic runs against a LABELLED FAKE (a scripted
 * stand-in for the job routes, test only), the result renders to markup, and the dialog's source is read for the rules that cannot be
 * seen in markup (never autoplays, only the contract's test ids, no deferred focus). The browser states made-dialog / made-result are the
 * integrator's audit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MadeField, MadeJobReport, MadeRecord, MadeTemplateInfo } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { MADE_TESTIDS } from './made.testids.ts';
import { MADE_UI_EN, MADE_UI_HE, madeParts, madeT } from './made.strings.ts';
import { buildRequest, checkLines, clipsUsing, fieldProblems, flashOver, lengthChoices, pollMade, POLL_MS, progressParts, partsText, warningLines, failureText } from './made.logic.ts';
import { MadeResult } from './MadeResult.tsx';
import { MADE_UI_BUILT } from './MadeEntry.tsx';

const here = import.meta.dirname;
const src = (f: string) => fs.readFileSync(path.join(here, f), 'utf8');

const FIELDS: MadeField[] = [
  { key: 'title', kind: 'text', label: { he: 'כותרת', en: 'Title' }, default: 'שלום', maxLength: 10 },
  { key: 'tint', kind: 'colour', label: { he: 'צבע', en: 'Colour' }, default: '#ff0000' },
  { key: 'size', kind: 'number', label: { he: 'גודל', en: 'Size' }, default: '5', min: 1, max: 9 },
];
const TEMPLATE: MadeTemplateInfo = { id: 'title-card', version: 1, name: { he: 'כרטיס כותרת', en: 'Title card' }, fields: FIELDS, seconds: 4, pageSha256: 'x', page: '<p>', samples: { he: { title: 'שלום' }, en: { title: 'Hello' } } };
const REC = (flash: number, sandbox: MadeRecord['sandbox'] = 'chromium'): MadeRecord => ({
  v: 1, pageSha256: `sha256:${'a'.repeat(64)}`, pageBytes: 10, fields: [], values: {}, frames: 120, width: 640, height: 360, browser: 'x', sandbox,
  checks: { determinism: { frames: [0, 60, 119] }, flash: { black: { general: flash, red: 0 }, white: { general: 0.5, red: 0 } }, alpha: true },
});
const REPORT = (over: Partial<MadeJobReport> = {}): MadeJobReport => ({ jobId: 'j1', status: 'succeeded', stage: 'done', progress: null, submittedBy: 'owner', warnings: [], record: REC(1), stills: ['a', 'b', 'c'], seconds: 3.2, ...over });

describe('request and fields', () => {
  it('a tile sends its id, its fields and the typed values; the name is the tile\'s in the interface language', () => {
    const r = buildRequest({ source: { kind: 'template', template: TEMPLATE }, values: { title: 'Hi', tint: '#00ff00', size: '3' }, seconds: 4, paste: '', lang: 'en' });
    expect(r.page).toEqual({ templateId: 'title-card' });
    expect(r.values).toEqual({ title: 'Hi', tint: '#00ff00', size: '3' });
    expect(r.name).toBe('Title card');
    expect(r.seconds).toBe(4);
  });
  it('a pasted page wins over the tile and carries no tile fields', () => {
    const r = buildRequest({ source: { kind: 'template', template: TEMPLATE }, values: {}, seconds: 2, paste: '<html></html>', lang: 'he' });
    expect(r.page).toBe('<html></html>');
    expect(r.fields).toBeUndefined();
  });
  it('an edited clip sends its own page text with its fields', () => {
    const r = buildRequest({ source: { kind: 'page', text: '<b>', fields: FIELDS }, values: { title: 'x' }, seconds: 2, paste: '', lang: 'he' });
    expect(r.page).toBe('<b>');
    expect(r.fields).toHaveLength(3);
  });
  it('field problems name the field and the limit, in both languages', () => {
    expect(fieldProblems(FIELDS, { title: 'x'.repeat(11), tint: 'red', size: '12' }, 'he')).toHaveLength(3);
    expect(fieldProblems(FIELDS, { title: 'ok', tint: '#a1b2c3', size: '5' }, 'en')).toEqual([]);
    expect(fieldProblems(FIELDS, { title: 'ok', tint: 'red', size: '5' }, 'en')[0]).toContain('Colour');
  });
  it('length choices run 1 to 20 s and keep a clip\'s own length', () => {
    const c = lengthChoices(2.5);
    expect(c[0]).toBe(1); expect(c.at(-1)).toBe(20); expect(c).toContain(2.5);
  });
});

describe('polling (fake job routes, test only)', () => {
  it('asks again after POLL_MS until the job ends, and stops when told to', async () => {
    const script: MadeJobReport[] = [REPORT({ status: 'running', stage: 'drawing', progress: { frame: 3, frames: 120 } }), REPORT({ status: 'running', stage: 'encoding' }), REPORT()];
    const slept: number[] = [], seen: MadeJobReport[] = [];
    const fin = await pollMade({ report: async () => script.shift()!, sleep: async (ms) => { slept.push(ms); }, onReport: (r) => seen.push(r), stopped: () => false });
    expect(fin?.status).toBe('succeeded');
    expect(slept).toEqual([POLL_MS, POLL_MS]);
    expect(POLL_MS).toBeGreaterThanOrEqual(2000);
    expect(seen).toHaveLength(3);
    let calls = 0;
    expect(await pollMade({ report: async () => { calls++; return REPORT({ status: 'running' }); }, sleep: async () => {}, onReport: () => {}, stopped: () => calls >= 1 })).toBeNull();
  });
  it('the progress line reads «מצייר פריים k מתוך n» with the numbers apart', () => {
    const r = REPORT({ status: 'running', stage: 'drawing', progress: { frame: 7, frames: 120 } });
    expect(partsText(progressParts(r, 'he'))).toBe('מצייר פריים 7 מתוך 120');
    expect(progressParts(r, 'he').filter((p) => 'num' in p)).toHaveLength(2);
    expect(partsText(progressParts(r, 'en'))).toBe('Drawing frame 7 of 120');
    expect(partsText(progressParts(null, 'en'))).toBe(MADE_UI_EN['ui.starting']);
  });
});

describe('the report\'s lines', () => {
  it('check lines carry the measured numbers', () => {
    const l = checkLines(REC(4.5), 3.2, 'en');
    expect(l.map((x) => partsText(x.parts))).toEqual([
      'Checked: the same frames in two drawings (0, 60, 119)', 'Flashes: 4.5 a second on black, 0.5 on white (measured on black and white)', 'Transparency: yes', 'Took 3.2 seconds on this computer (one sample)',
    ]);
    expect(l.flatMap((x) => x.parts.filter((p) => 'num' in p)).length).toBe(4);
  });
  it('the flash warning is read from the numbers, never a refusal; below the limit nothing', () => {
    expect(flashOver(REC(1))).toBeNull();
    expect(flashOver(REC(4.5))).toEqual({ rate: 4.5, on: 'black' });
    const w = warningLines(REPORT({ warnings: [{ why: 'made_flash' as never, message: 'the clip flashes 4.5 times a second (measured on black), above 3' }] }), 'he');
    expect(w[0]).toContain('4.5');
    expect(w[0]).toContain('שחור');
    expect(w[0]).not.toMatch(/\{/);
  });
  it('warnings with numbers read from the server wording; the sandbox line is not said twice', () => {
    const r = REPORT({ record: REC(1, 'none'), warnings: [
      { why: 'made_no_sandbox' as never, message: "the browser ran without Chromium's sandbox" },
      { why: 'made_clock' as never, message: 'the page read the clock or a random number (Date.now) at frame 12', at: 12 },
      { why: 'made_webgl_differs' as never, message: 'the WebGL page drew 40 pixels differently the second time (frame 3)' },
    ] });
    const w = warningLines(r, 'en');
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('Date.now'); expect(w[0]).toContain('frame 12');
    expect(w[1]).toContain('40 pixels');
    expect(checkLines(r.record!, undefined, 'en').map((x) => x.key)).toContain('check.sandbox.none');
  });
  it('a failure is worded with its numbers and next step in Hebrew', () => {
    expect(failureText({ why: 'made_frame_timeout' as never, message: 'the page did not finish drawing frame 9 within 2 seconds', hint: 'h' }, 'he')).toContain('9');
    expect(failureText({ why: 'made_empty' as never, message: 'x', hint: 'h' }, 'he')).toBe(dictionaries.he['made.fail.made_empty']);
  });
  it('clipsUsing counts the clips that show a file in every sequence', () => {
    const doc = { sequences: { a: { tracks: [{ clips: [{ type: 'media', assetId: 'x' }, { type: 'media', assetId: 'y' }] }] }, b: { tracks: [{ clips: [{ type: 'media', assetId: 'x' }, { type: 'text' }] }] } } };
    expect(clipsUsing(doc as never, 'x')).toBe(2);
  });
});

describe('the result', () => {
  const html = renderToStaticMarkup(createElement(MadeResult, { projectId: 'p1', jobId: 'j1', report: REPORT({ record: REC(4.5), warnings: [{ why: 'made_flash' as never, message: 'the clip flashes 4.5 times a second (measured on black), above 3' }] }), lang: 'he' }));
  it('three stills, a paused video that does not autoplay, play button, checks, the honest line', () => {
    for (const k of [0, 1, 2]) expect(html).toContain(`data-testid="${MADE_TESTIDS.still(k)}"`);
    for (const id of [MADE_TESTIDS.result, MADE_TESTIDS.video, MADE_TESTIDS.play, MADE_TESTIDS.checks, MADE_TESTIDS.unseen]) expect(html).toContain(`data-testid="${id}"`);
    expect(html.toLowerCase()).not.toContain('autoplay');
    expect(html).toContain('נוצר בקוד — אף אחד עוד לא צפה בו');
    expect(html.indexOf('made-still-0')).toBeLessThan(html.indexOf('made-video'));
  });
  it('numbers sit in <bdi dir="ltr">, the checkerboard wraps pictures', () => {
    expect(html).toContain('<bdi dir="ltr">4.5</bdi>');
    expect(html).toContain('pf-made-checker');
  });
  it('says nothing is good, sharp or safe', () => {
    for (const w of [...Object.values(MADE_UI_HE), ...Object.values(MADE_UI_EN)]) expect(w).not.toMatch(/\b(safe|sharp|verified)\b|בטוח|חד |נבדק בעין/i);
  });
});

describe('strings and rules', () => {
  it('ui rows have he and en with the same keys and placeholders; every made.* key the interface reads exists', () => {
    expect(Object.keys(MADE_UI_EN).sort()).toEqual(Object.keys(MADE_UI_HE).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(MADE_UI_HE) as (keyof typeof MADE_UI_HE)[]) expect(ph(MADE_UI_EN[k])).toBe(ph(MADE_UI_HE[k]));
    for (const k of ['entry', 'dialog.title', 'tiles', 'length', 'render', 'place', 'library', 'replace', 'edit', 'cancel', 'stopAsk', 'paste', 'progress', 'unseen', 'inspector', 'play', 'pause', 'browserPlays']) {
      expect(madeT('he')(k)).not.toBe(k); expect(madeT('en')(k)).not.toBe(k);
    }
    expect(madeT('he')('stopAsk')).toBe('לעצור את הציור?');
    expect(madeParts('he', 'replace', { n: 3 })).toEqual([{ text: 'עדכון בכל המקומות (' }, { num: '3' }, { text: ')' }]);
  });
  it('the entry is built; the dialog never autoplays, uses only contract test ids and moves no focus later', () => {
    expect(MADE_UI_BUILT).toBe(true);
    const code = ['MadeClipDialog.tsx', 'MadeResult.tsx', 'MadeEntry.tsx', 'MadeInspectorLine.tsx'].map(src).join('\n');
    expect(code).not.toMatch(/autoPlay|\.play\(\).*useEffect/);
    expect(code).not.toMatch(/setTimeout\([^)]*focus|requestAnimationFrame|queueMicrotask/);
    const used = [...code.matchAll(/data-testid=\{?["']([a-z-]+)["']/g)].map((m) => m[1]);
    expect(used).toEqual([]);
    for (const m of code.matchAll(/TID\.(\w+)/g)) expect(m[1]! in MADE_TESTIDS).toBe(true);
    expect(code).toContain('role="radiogroup"');
    expect(code).toContain('dir="auto"');
    expect(src('MadeClipDialog.tsx')).toContain('stopAsk');
  });
});
