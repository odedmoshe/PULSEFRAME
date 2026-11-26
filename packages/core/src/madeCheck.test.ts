/**
 * The static check of a page (madeCheck.ts; verify C4 as amended): problems only for size, NUL and text that was not UTF-8; every
 * other hit a warning with its offset; case-sensitive identifiers at identifier boundaries; SVG namespace strings, comments and
 * https://made.invalid/ addresses give nothing. And the field check (madeFieldsCheck).
 */
import { describe, expect, it } from 'vitest';
import { checkMadePage, MADE_CHECK_MAX_WARNINGS, MADE_LIMITS, madeFieldsCheck, type MadeField } from './index.ts';

const page = (script: string) => `<!doctype html><html><body><canvas></canvas><script>${script}</script></body></html>`;
const whats = (html: string) => checkMadePage(html).warnings.map((w) => w.what);

describe('checkMadePage', () => {
  it('an ordinary page gives no problem and no warning, even with words that contain forbidden names', () => {
    const html = page('// a //comment about update\nfunction update(t){ const allocation = 1; validate(); evaluate(); myfetch(); _location = 2; ctx.fillText(PF.fields.title, 10, 10); }\nPF.render = (frame, t) => update(t);');
    expect(checkMadePage(html)).toEqual({ problems: [], warnings: [] });
  });
  it('each forbidden name alone gives a warning at its offset (never a problem)', () => {
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection', 'navigator', 'location', 'postMessage', 'Worker', 'localStorage', 'indexedDB', 'Date', 'performance', 'requestAnimationFrame', 'setTimeout', 'setInterval', 'eval', 'Function', 'Math.random', 'window.open']) {
      const html = page(`x = ${name};`);
      const r = checkMadePage(html);
      expect(r.problems, name).toEqual([]);
      expect(r.warnings, name).toEqual([{ what: name, at: html.indexOf(`${name};`) }]);
    }
  });
  it('identifiers are case-sensitive and bounded: "date", "Dates", "$Date" differ as stated', () => {
    expect(whats(page('let date = 1; let Dates = 2;'))).toEqual([]);
    expect(whats(page('let a = $Date; let b = a.Date;'))).toEqual(['Date']); // `$` is part of the name; `.` is a boundary
  });
  it('tags, CSS transitions, SMIL, meta refresh and outside scripts and pictures warn; data: pictures and made.invalid libraries do not', () => {
    const html = '<link rel=stylesheet href=x.css><iframe src=a></iframe><form></form><style>.a{transition: all 1s}</style><svg><animate attributeName="x"/><set to="1"/></svg><meta http-equiv="refresh" content="0"><script src="https://made.invalid/lib/gsap@3.15.1/dist/gsap.min.js"></script><script src="x.js"></script><img src="data:image/png;base64,AA"><img src="a.png">';
    expect(whats(html)).toEqual(['<link', '<iframe', '<form', 'CSS transition', 'SMIL <animate>', 'SMIL <set>', '<meta http-equiv', '<script src', '<img src']);
  });
  it('internet addresses warn with the address; the SVG namespaces and https://made.invalid/ give nothing; //host only where an address is read', () => {
    const html = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="https://made.invalid/assets/ast_1"/></svg><div style="background:url(//evil.example/a.png)"></div><script>// see the notes\nconst u = "https://example.com/pic.png";</script>';
    const w = checkMadePage(html).warnings;
    expect(w.map((x) => x.what)).toEqual(['protocol-relative address', 'internet address https://example.com/pic.png']);
    expect(w[1]!.at).toBe(html.indexOf('https://example.com'));
    expect(whats('<a href="javascript:void 0">x</a>')).toEqual(['javascript: address']);
  });
  it('text in HTML and block comments is not scanned; offsets after a comment stay those of the original text', () => {
    const html = page('/* fetch Date */ <!-- WebSocket --> x = fetch;');
    expect(checkMadePage(html).warnings).toEqual([{ what: 'fetch', at: html.lastIndexOf('fetch') }]);
  });
  it('problems: too large (offset where the limit is crossed), NUL, U+FFFD, a lone surrogate, a BOM after the start; a BOM at the start is fine', () => {
    const big = 'a'.repeat(MADE_LIMITS.pageBytes - 1) + 'שׁ';
    expect(checkMadePage(big).problems).toEqual([{ what: 'too_large', at: MADE_LIMITS.pageBytes - 1 }]);
    expect(checkMadePage('a'.repeat(MADE_LIMITS.pageBytes)).problems).toEqual([]);
    expect(checkMadePage('ab\u0000c').problems).toEqual([{ what: 'nul', at: 2 }]);
    expect(checkMadePage('a�b\uD800c﻿').problems).toEqual([{ what: 'not_utf8', at: 1 }, { what: 'not_utf8', at: 3 }, { what: 'not_utf8', at: 5 }]);
    expect(checkMadePage('﻿<p>שלום 😀</p>').problems).toEqual([]);
  });
  it('the warnings are bounded', () => {
    expect(checkMadePage(page('fetch;'.repeat(MADE_CHECK_MAX_WARNINGS + 50))).warnings.length).toBe(MADE_CHECK_MAX_WARNINGS);
  });
});

describe('madeFieldsCheck', () => {
  const F: MadeField[] = [
    { key: 'title', kind: 'text', label: { he: 'כותרת', en: 'Title' }, default: 'x', maxLength: 5 },
    { key: 'colour', kind: 'colour', label: { he: 'צבע', en: 'Colour' }, default: '#ffffff' },
    { key: 'count', kind: 'number', label: { he: 'מספר', en: 'Number' }, default: '1', min: 0, max: 10 },
  ];
  it('good values pass; each bad value is named by its key and why', () => {
    expect(madeFieldsCheck(F, { title: 'שלום', colour: '#A0b0C0', count: '7.5' })).toEqual([]);
    expect(madeFieldsCheck(F, { title: 'שלום עולם', colour: 'red', count: 'x', nope: '1' })).toEqual([
      { key: 'title', why: 'length' }, { key: 'colour', why: 'colour' }, { key: 'count', why: 'number' }, { key: 'nope', why: 'unknown' },
    ]);
    expect(madeFieldsCheck(F, { count: '11' })).toEqual([{ key: 'count', why: 'range' }]);
    expect(madeFieldsCheck(F, { count: ' ' })).toEqual([{ key: 'count', why: 'number' }]);
    expect(madeFieldsCheck(F, { __proto__x: '1', constructor: '1' })).toEqual([{ key: '__proto__x', why: 'unknown' }, { key: 'constructor', why: 'unknown' }]);
  });
});
