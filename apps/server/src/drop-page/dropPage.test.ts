/**
 * The phone page (page.html, page.css, page.js, index.ts). No browser and no server here: the script's pure half (strings, the
 * error table, the name cut, the checks before a send, the upload queue with its retry and backoff rules) runs in node:vm with
 * LABELLED FAKE deps; what the page looks like on a real phone, the pickers and the real door are the lead's proof.
 *
 * The ES2017 gate is a DENY-LIST (heuristic), not a parser: acorn is not a dependency here. It strips comments, strings and
 * template text, then rejects what is newer than ES2017: optional chaining `?.`, `??`, logical assignment, BigInt literals,
 * numeric separators, #private names, object spread/rest (`...` directly inside `{}`), optional catch binding, `for await`,
 * async generators, class static blocks, import/export/import.meta, regexp lookbehind, named groups, the s flag and \p{…}, and
 * the APIs replaceAll, flat, flatMap, fromEntries, allSettled, Promise.any, .finally, .at(, matchAll, trimStart, trimEnd,
 * hasOwn, globalThis, structuredClone, BigInt, WeakRef. The script must also compile under this Node (vm.Script).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cutUploadName } from '@pulseframe/core';
import { DROP_WIRE_ERROR_CODES } from '../importContracts.ts';
import { buildDropPage, loadDropPage } from './index.ts';
import { DROP_PAGE_TESTIDS } from './testids.ts';

const dir = new URL('.', import.meta.url);
const read = (n: string) => fs.readFileSync(new URL(n, dir), 'utf8');
const html = read('page.html'), css = read('page.css'), js = read('page.js');

// ---- the deny-list scanner -----------------------------------------------------------------------------------------------
/** Source with comments, string contents and template text blanked; regex literals returned separately. */
export function strip(src: string): { code: string; regexes: { body: string; flags: string }[] } {
  let out = '';
  const regexes: { body: string; flags: string }[] = [];
  let i = 0;
  let last = ''; // last significant char of the code written so far
  const tmpl: number[] = []; // brace depth at each open ${ of a template
  let depth = 0;
  const regexAllowed = () => last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || /(^|[^\w$])(return|typeof|case|in|of|delete|void|throw|new)$/.test(out.trimEnd());
  const readTemplate = () => { // at a backtick or after the } of an interpolation: blank text until ${ or the closing backtick
    for (i++; i < src.length; i++) {
      const c = src[i]!;
      if (c === '\\') { i++; out += '  '; continue; }
      if (c === '`') { i++; out += '`'; last = '`'; return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; out += '${'; tmpl.push(depth); depth++; last = '{'; return; }
      out += c === '\n' ? '\n' : ' ';
    }
  };
  while (i < src.length) {
    const c = src[i]!, n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += ' '; continue; }
    if (c === '"' || c === "'") {
      out += c; i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; out += c; last = c; continue;
    }
    if (c === '`') { out += '`'; readTemplate(); continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      for (; j < src.length; j++) { const d = src[j]!; if (d === '\\') { j++; continue; } if (d === '[') inClass = true; else if (d === ']') inClass = false; else if (d === '/' && !inClass) break; }
      const body = src.slice(i + 1, j);
      let k = j + 1; while (k < src.length && /[a-z]/i.test(src[k]!)) k++;
      regexes.push({ body, flags: src.slice(j + 1, k) });
      out += '/R/'; last = '/'; i = k; continue;
    }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (tmpl.length && tmpl[tmpl.length - 1] === depth) { tmpl.pop(); out += '}'; readTemplate(); continue; } }
    out += c;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return { code: out, regexes };
}
/** What the deny-list finds in a script (empty = clean). */
export function es2017Problems(src: string): string[] {
  const { code, regexes } = strip(src);
  const found: string[] = [];
  const deny: [string, RegExp][] = [
    ['optional chaining ?.', /\?\.(?!\d)/], ['nullish ??', /\?\?/], ['logical assignment', /(&&|\|\||\?\?)=/], ['BigInt literal', /\b\d+n\b/], ['numeric separator', /\d_\d/],
    ['#private name', /#[A-Za-z_$]/], ['optional catch binding', /\bcatch\s*\{/], ['for await', /\bfor\s+await\b/], ['async generator', /async\s+function\s*\*/],
    ['static block', /\bstatic\s*\{/], ['import/export', /(^|[\n;{}])\s*(import|export)\b/], ['dynamic import / import.meta', /\bimport\s*[(.]/],
    ['replaceAll', /\.replaceAll\b/], ['flat', /\.flat\s*\(/], ['flatMap', /\.flatMap\b/], ['fromEntries', /\bfromEntries\b/], ['allSettled', /\ballSettled\b/], ['Promise.any', /\bPromise\.any\b/],
    ['.finally(', /\.finally\s*\(/], ['.at(', /\.at\s*\(/], ['matchAll', /\.matchAll\b/], ['trimStart/trimEnd', /\.trim(Start|End)\b/], ['hasOwn', /\.hasOwn\b/], ['globalThis', /\bglobalThis\b/],
    ['structuredClone', /\bstructuredClone\b/], ['BigInt', /\bBigInt\b/], ['WeakRef', /\bWeakRef\b/],
  ];
  for (const [name, re] of deny) if (re.test(code)) found.push(name);
  // object spread / rest: `...` whose innermost open bracket is `{`
  const stack: string[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if ('([{'.includes(c)) stack.push(c);
    else if (')]}'.includes(c)) stack.pop();
    else if (c === '.' && code.startsWith('...', i)) { if (stack[stack.length - 1] === '{') found.push('object spread/rest'); i += 2; }
  }
  for (const r of regexes) {
    if (/\(\?<[=!A-Za-z]/.test(r.body)) found.push('regexp lookbehind or named group');
    if (r.flags.includes('s')) found.push('regexp s flag');
    if (/\\[pP]\{/.test(r.body)) found.push('regexp \\p{}');
  }
  return found;
}

describe('the deny-list gate itself (so a pass means something)', () => {
  it('rejects each newer construct and accepts plain ES2017', () => {
    const bad: Record<string, string> = {
      'optional chaining ?.': 'var a = b?.c;', 'nullish ??': 'var a = b ?? 1;', 'logical assignment': 'a ||= 1;', 'BigInt literal': 'var a = 10n;', 'numeric separator': 'var a = 1_000;',
      '#private name': 'class A { #x = 1 }', 'optional catch binding': 'try { f() } catch { g() }', 'for await': 'async function f(){ for await (var x of y) {} }',
      'async generator': 'async function* g() {}', 'static block': 'class A { static { f() } }', 'import/export': 'import x from "y";', 'dynamic import / import.meta': 'var m = import("x");',
      replaceAll: 'a.replaceAll("a","b");', flat: 'a.flat();', flatMap: 'a.flatMap(f);', fromEntries: 'Object.fromEntries(a);', allSettled: 'Promise.allSettled(a);', 'Promise.any': 'Promise.any(a);',
      '.finally(': 'p.finally(f);', '.at(': 'a.at(-1);', matchAll: 's.matchAll(/a/g);', 'trimStart/trimEnd': 's.trimStart();', hasOwn: 'Object.hasOwn(a, "b");', globalThis: 'var g = globalThis;',
      structuredClone: 'structuredClone(a);', BigInt: 'BigInt(1);', WeakRef: 'new WeakRef(a);', 'object spread/rest': 'var a = { ...b };',
      'regexp lookbehind or named group': 'var r = /(?<=a)b/;', 'regexp s flag': 'var r = /a/s;', 'regexp \\p{}': 'var r = /\\p{L}/u;',
    };
    for (const [name, src] of Object.entries(bad)) expect(es2017Problems(src), name).toContain(name);
    const good = 'var a = [1, ...b]; f(...c); function g(...r) {} var o = { x: 1 }; async function h() { await 1; } `x${a}y`; var s = "a?.b ?? c"; // b?.c\n /* x ?? y */ var re = /a?.b/; a ** 2; Object.entries(o); "x".padStart(2);';
    expect(es2017Problems(good)).toEqual([]);
  });
});

describe('page.js and the page', () => {
  it('ES2017 syntax gate (deny-list heuristic) and it compiles', () => {
    expect(es2017Problems(js)).toEqual([]);
    expect(() => new vm.Script(js, { filename: 'page.js' })).not.toThrow();
    expect(js).not.toContain('</script');
  });
  it('the CSP hashes equal the inlined blocks, and the policy is the fixed one', () => {
    for (const page of [loadDropPage(), buildDropPage(html, css, js)]) {
      const body = page.body.toString('utf8');
      const styles = [...body.matchAll(/<style>([\s\S]*?)<\/style>/g)], scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      expect(styles).toHaveLength(1); expect(scripts).toHaveLength(1);
      const h = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
      expect(page.csp).toBe(`default-src 'none'; script-src ${h(scripts[0]![1]!)}; style-src ${h(styles[0]![1]!)}; connect-src 'self'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`);
      expect(body).not.toContain('{{');
    }
  });
  it('dollar signs in the script are inlined literally and line endings do not change the hashes', () => {
    const a = buildDropPage('<style>{{css}}</style><script>{{js}}</script>', 'a{}', 'var x = "$&$1$$";');
    expect(a.body.toString()).toContain('var x = "$&$1$$";');
    const b = buildDropPage('<style>{{css}}</style><script>{{js}}</script>', 'a{}', 'var x = 1;\r\nvar y = 2;');
    const c = buildDropPage('<style>{{css}}</style><script>{{js}}</script>', 'a{}', 'var x = 1;\nvar y = 2;');
    expect(b.csp).toBe(c.csp);
    expect(() => buildDropPage('<p>', '', '')).toThrow();
  });
  it('no http(s) URL, no external request, no inline handler or style attribute (the policy would block them)', () => {
    const all = html + css + js;
    expect(all).not.toMatch(/https?:\/\//i);
    expect(all).not.toMatch(/\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(all).not.toMatch(/@import|url\(|<link\b|<img\b|<iframe\b|\bfetch\(|\bsrc=|EventSource|WebSocket|sendBeacon|importScripts/);
    const markup = html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '');
    expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
    expect(markup).not.toMatch(/\sstyle\s*=/i);
    expect(js).not.toMatch(/setAttribute\(\s*['"]style/);
  });
  it('the size limit: html, css and script together are under 30 KB', () => {
    const total = Buffer.byteLength(html) + Buffer.byteLength(css) + Buffer.byteLength(js);
    expect(total).toBeLessThan(30 * 1024);
    expect(loadDropPage().body.length).toBeLessThan(30 * 1024);
  });
  it('the fixed test ids are on the page, the pickers are right, the live region, language, direction and viewport are set', () => {
    const all = html + js;
    for (const id of [DROP_PAGE_TESTIDS.pickMedia, DROP_PAGE_TESTIDS.pickOriginal, DROP_PAGE_TESTIDS.pin, DROP_PAGE_TESTIDS.pinSubmit, DROP_PAGE_TESTIDS.fileState, DROP_PAGE_TESTIDS.fileProgress, DROP_PAGE_TESTIDS.total, DROP_PAGE_TESTIDS.status, DROP_PAGE_TESTIDS.done, DROP_PAGE_TESTIDS.lang])
      expect(all, id).toContain(`data-testid="${id}"`);
    expect(js).toContain(DROP_PAGE_TESTIDS.file(0).replace('0', ''));
    expect(html).toMatch(/id="pickMedia" type="file" accept="image\/\*,video\/\*" multiple/);
    expect(html).toMatch(/id="pickOriginal" type="file" multiple/);
    expect(html).not.toMatch(/id="pickOriginal"[^>]*accept=/);
    expect(html).toMatch(/id="status"[^>]*role="status"/);
    expect(html).toMatch(/<html lang="he" dir="rtl">/);
    expect(html).toContain('name="viewport"');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toMatch(/min-height:\s*4[4-9]px|min-height:\s*5\d px/);
    expect(html).toMatch(/hidden/);
  });
});

// ---- the script's pure half, in node:vm ------------------------------------------------------------------------------------
interface Api {
  STR: { he: Record<string, string>; en: Record<string, string> };
  BACKOFF: number[];
  cutName(name: string, max?: number, maxBytes?: number): string;
  classify(status: number, code: string | null): 'wait' | 'retry' | 'fatal' | 'file';
  precheck(file: { size: number }, lim: Lim): string | null;
  errText(lang: 'he' | 'en', code: string): string;
  sizeText(n: number): string;
  createUploader(deps: Deps, lim: Lim): { items: Item[]; add(files: { name: string; size: number }[]): Promise<void>; retry(it: Item): Promise<void>; readonly fatal: string | null };
}
interface Lim { maxFileBytes: number | null; remainingBytes: number | null; filesLeft: number | null }
interface Item { file: { name: string; size: number }; state: string; pct: number; code: string | null; tries: number; notSent: boolean }
interface Reply { status: number; body?: unknown; code?: string | null; retryAfter?: number }
interface Deps {
  status(): Promise<Reply>; upload(file: unknown, onProgress: (p: number) => void): Promise<Reply>; rehello(): Promise<boolean>; sleep(ms: number): Promise<void>;
  onItem(it: Item): void; onLimits(l: Lim): void; onFatal(code: string): void;
}
const ctx: { __pfDrop?: Api } = {};
vm.runInNewContext(js, ctx, { filename: 'page.js' });
const api = ctx.__pfDrop!;
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const file = (name: string, size = 1000) => ({ name, size });
const LIMS = { maxFileBytes: 2_000_000, remainingBytes: 10_000_000, filesLeft: 50 };
/** A scripted FAKE door: each call takes the next scripted reply of its kind (the last one repeats). */
function fake(script: { status?: Reply[]; upload?: Reply[]; rehello?: boolean[] }) {
  const log: string[] = [];
  const delays: number[] = [];
  let inFlight = 0, maxInFlight = 0;
  const next = <T>(arr: T[] | undefined, i: number, dflt: T): T => (arr && arr.length ? arr[Math.min(i, arr.length - 1)]! : dflt);
  const n = { status: 0, upload: 0, rehello: 0 };
  const items: Item[] = [];
  const fatals: string[] = [];
  const deps: Deps = {
    status: async () => { log.push('status'); return next(script.status, n.status++, { status: 200, body: { state: 'connected', ...LIMS } }); },
    upload: async (f) => {
      log.push(`upload:${(f as { name: string }).name}`);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return next(script.upload, n.upload++, { status: 201, body: { accepted: true, bytes: 1, remainingBytes: 9_000_000, filesLeft: 49 } });
    },
    rehello: async () => { log.push('rehello'); return next(script.rehello, n.rehello++, false); },
    sleep: async (ms) => { delays.push(ms); },
    onItem: (it) => { items.push(plain(it)); }, onLimits: () => {}, onFatal: (c) => { fatals.push(c); },
  };
  return { deps, log, delays, fatals, items, maxInFlight: () => maxInFlight };
}
const run = async (f: ReturnType<typeof fake>, files: { name: string; size: number }[], lim: Lim = { ...LIMS }) => {
  const up = api.createUploader(f.deps, lim);
  await up.add(files);
  return up;
};

describe('page.js strings', () => {
  it('Hebrew and English have the same keys and placeholders; Hebrew is Hebrew, English is not', () => {
    expect(Object.keys(api.STR.en).sort()).toEqual(Object.keys(api.STR.he).sort());
    for (const [k, v] of Object.entries(api.STR.he)) {
      const en = api.STR.en[k]!;
      if (k === 'langBtn') { expect([v, en]).toEqual(['English', 'עברית']); continue; } // the toggle names the OTHER language, in its own script
      expect(/[֐-׿]/.test(v), k).toBe(true);
      expect(en.trim(), k).not.toBe('');
      expect(/[֐-׿]/.test(en), `${k} (en)`).toBe(false);
      expect([...en.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...v.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });
  it('every code the door answers with has plain words in both languages (and the page has a fallback)', () => {
    for (const c of DROP_WIRE_ERROR_CODES) { expect(api.STR.he[`e.${c}`], c).toBeTruthy(); expect(api.STR.en[`e.${c}`], c).toBeTruthy(); }
    expect(api.errText('he', 'never_heard_of_it')).toBe(api.STR.he['e.unknown']);
    expect(api.errText('he', 'disk_full')).toBe('אין מספיק מקום פנוי בדיסק של המחשב.');
    expect(api.errText('en', 'code_expired')).toContain('expired');
  });
  it('the keys the markup names with data-i exist in both languages', () => {
    for (const m of html.matchAll(/data-i="(\w+)"/g)) { expect(api.STR.he[m[1]!], m[1]).toBeTruthy(); expect(api.STR.en[m[1]!], m[1]).toBeTruthy(); }
  });
  it('sizes read in KB, MB, GB', () => {
    expect([api.sizeText(500), api.sizeText(5 * 1048576), api.sizeText(1.5 * 1073741824)]).toEqual(['1 KB', '5 MB', '1.5 GB']);
  });
});

describe('name cut: the page keeps its own copy of core\'s rule', () => {
  const samples = ['IMG_0001.MOV', 'חתונה '.repeat(80) + '.mp4', '😀'.repeat(300) + '.jpg', '日本語'.repeat(120), 'a'.repeat(400), ('תיקייה של המשפחה/').repeat(24) + 'IMG_0001.jpg', 'x\uD800y.png', '.hidden', 'noext' + 'é'.repeat(300)];
  for (const s of samples)
    it(`${JSON.stringify(s.slice(0, 18))} (${s.length} units)`, () => {
      expect(api.cutName(s, 256, 2048)).toBe(cutUploadName(s, 256, 2048));
      expect(api.cutName(s, 512, 2048)).toBe(cutUploadName(s, 512, 2048));
      expect(encodeURIComponent(api.cutName(s)).length).toBeLessThanOrEqual(2048);
    });
});

describe('classify and precheck', () => {
  it('maps what the door says to what the page does', () => {
    const c = (s: number, code: string | null) => api.classify(s, code);
    expect([c(0, null), c(429, 'rate_limited'), c(201, null)]).toEqual(['retry', 'wait', 'file']);
    for (const code of ['session_invalid', 'code_closed', 'code_expired']) expect(c(401, code), code).toBe('fatal');
    for (const code of ['upload_incomplete', 'internal_error']) expect(c(400, code), code).toBe('retry');
    expect(c(500, null)).toBe('retry');
    for (const [s, code] of [[413, 'upload_too_large'], [413, 'code_budget'], [507, 'storage_quota_exceeded'], [507, 'disk_full'], [400, 'empty_upload'], [400, 'invalid_filename'], [411, 'length_required']] as const) expect(c(s, code), code).toBe('file');
  });
  it('checks a file against the numbers before a byte is sent', () => {
    const p = (size: number, l: Partial<Lim>) => api.precheck({ size }, { ...LIMS, ...l });
    expect(p(0, {})).toBe('empty_upload');
    expect(p(5, {})).toBeNull();
    expect(p(3_000_000, {})).toBe('upload_too_large');
    expect(p(5, { filesLeft: 0 })).toBe('code_budget');
    expect(p(500, { remainingBytes: 100 })).toBe('code_budget');
    expect(p(500, { maxFileBytes: null, remainingBytes: null, filesLeft: null })).toBeNull();
  });
});

describe('upload queue (fake deps)', () => {
  it('sends one file at a time in the order chosen, asks /status before each file, and keeps the numbers the door returns', async () => {
    const f = fake({});
    const lim = { ...LIMS };
    const up = await run(f, [file('a.jpg'), file('b.mov'), file('c.png')], lim);
    expect(f.log).toEqual(['status', 'upload:a.jpg', 'status', 'upload:b.mov', 'status', 'upload:c.png']);
    expect(f.maxInFlight()).toBe(1);
    expect(up.items.map((i) => i.state)).toEqual(['saved', 'saved', 'saved']);
    expect(lim.remainingBytes).toBe(9_000_000);
    expect(lim.filesLeft).toBe(49);
    expect(f.delays).toEqual([]);
    // the states a card shows, in order, for the first file
    expect(f.items.filter((i) => i.file.name === 'a.jpg').map((i) => i.state)).toEqual(['waiting', 'uploading', 'saved']);
  });
  it('a lost connection is retried three times after 2, 4 and 8 s, resending the file; /status is asked after each network error; then it fails honestly', async () => {
    const f = fake({ upload: [{ status: 0 }] });
    const up = await run(f, [file('a.mov')]);
    expect(f.delays).toEqual([2000, 4000, 8000]);
    expect(api.BACKOFF).toEqual([2000, 4000, 8000]);
    expect(f.log.filter((l) => l.startsWith('upload')).length).toBe(4);
    expect(f.log.filter((l) => l === 'status').length).toBe(4);
    expect(up.items[0]).toMatchObject({ state: 'failed', code: 'network' });
    expect(f.fatals).toEqual([]);
  });
  it('succeeds on the third try; the card says it is retrying with the count', async () => {
    const f = fake({ upload: [{ status: 0 }, { status: 0 }, { status: 201, body: { remainingBytes: 1, filesLeft: 1 } }] });
    const up = await run(f, [file('a.mov'), file('b.mov')]);
    expect(f.delays).toEqual([2000, 4000]);
    expect(up.items.map((i) => i.state)).toEqual(['saved', 'saved']);
    expect(f.items.filter((i) => i.state === 'retrying').map((i) => i.tries)).toEqual([1, 2]);
  });
  it('a 429 waits Retry-After and resends WITHOUT spending a retry', async () => {
    const f = fake({ upload: [{ status: 429, code: 'rate_limited', retryAfter: 3 }, { status: 429, code: 'rate_limited', retryAfter: 1 }, { status: 0 }, { status: 0 }, { status: 0 }, { status: 201 }] });
    const up = await run(f, [file('a.mov')]);
    expect(f.delays).toEqual([3000, 1000, 2000, 4000, 8000]); // two waits, then the full three retries are still there
    expect(up.items[0]!.state).toBe('saved');
  });
  it('a file the numbers say cannot go is never sent; one the door refuses for its own reason is never resent', async () => {
    const f = fake({ status: [{ status: 200, body: { state: 'connected', maxFileBytes: 5000, remainingBytes: 1e9, filesLeft: 9 } }] });
    const up = await run(f, [file('big.mov', 6000), file('empty.jpg', 0), file('ok.jpg', 10)], { ...LIMS });
    expect(f.log.filter((l) => l.startsWith('upload'))).toEqual(['upload:ok.jpg']);
    expect(up.items.map((i) => [i.state, i.code])).toEqual([['failed', 'upload_too_large'], ['failed', 'empty_upload'], ['saved', null]]);
    const g = fake({ upload: [{ status: 413, code: 'upload_too_large' }] });
    const up2 = await run(g, [file('a.mov')]);
    expect(g.log.filter((l) => l.startsWith('upload')).length).toBe(1);
    expect(g.delays).toEqual([]);
    expect(up2.items[0]).toMatchObject({ state: 'failed', code: 'upload_too_large' });
  });
  it('the code budget is exhausted by the files before: the next file is refused before sending', async () => {
    const f = fake({ upload: [{ status: 201, body: { remainingBytes: 100, filesLeft: 5 } }], status: [{ status: 200, body: { state: 'connected', ...LIMS } }, { status: 200, body: { state: 'connected', ...LIMS, remainingBytes: 100 } }] });
    const up = await run(f, [file('a.jpg', 50), file('b.jpg', 500)]);
    expect(up.items.map((i) => [i.state, i.code])).toEqual([['saved', null], ['failed', 'code_budget']]);
    expect(f.log.filter((l) => l.startsWith('upload')).length).toBe(1);
  });
  it('a session that is gone ends the batch: the rest is not sent; with a new session from the token the batch goes on', async () => {
    const f = fake({ upload: [{ status: 201 }, { status: 401, code: 'session_invalid' }], rehello: [false] });
    const up = await run(f, [file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    expect(up.items.map((i) => i.state)).toEqual(['saved', 'failed', 'failed']);
    expect(up.items[2]).toMatchObject({ notSent: true, code: 'session_invalid' });
    expect(f.fatals).toEqual(['session_invalid']);
    expect(f.log.filter((l) => l.startsWith('upload')).length).toBe(2);
    const g = fake({ upload: [{ status: 401, code: 'session_invalid' }, { status: 201 }], rehello: [true] });
    const up2 = await run(g, [file('a.jpg'), file('b.jpg')]);
    expect(up2.items.map((i) => i.state)).toEqual(['saved', 'saved']);
    expect(g.fatals).toEqual([]);
    expect(g.log).toContain('rehello');
  });
  it('a closed code is fatal at once, without a re-hello', async () => {
    const f = fake({ upload: [{ status: 410, code: 'code_closed' }] });
    const up = await run(f, [file('a.jpg'), file('b.jpg')]);
    expect(f.log).not.toContain('rehello');
    expect(up.fatal).toBe('code_closed');
    expect(up.items.every((i) => i.state === 'failed')).toBe(true);
  });
  it('a /status that finds the session invalid after a reload re-claims first, then sends', async () => {
    const f = fake({ status: [{ status: 401, code: 'session_invalid' }, { status: 200, body: { state: 'connected', ...LIMS } }], rehello: [true] });
    const up = await run(f, [file('a.jpg')]);
    expect(f.log).toEqual(['status', 'rehello', 'status', 'upload:a.jpg']);
    expect(up.items[0]!.state).toBe('saved');
  });
  it('a failed file can be tried again by hand and then goes', async () => {
    const f = fake({ upload: [{ status: 507, code: 'disk_full' }, { status: 201 }] });
    const up = await run(f, [file('a.mov')]);
    expect(up.items[0]).toMatchObject({ state: 'failed', code: 'disk_full' });
    await up.retry(up.items[0]!);
    expect(up.items[0]!.state).toBe('saved');
  });
  it('files added while another batch runs wait their turn: still never two uploads at once', async () => {
    const f = fake({});
    const up = api.createUploader(f.deps, { ...LIMS });
    await Promise.all([up.add([file('a.jpg'), file('b.jpg')]), up.add([file('c.jpg')])]);
    expect(up.items.map((i) => i.state)).toEqual(['saved', 'saved', 'saved']);
    expect(f.maxInFlight()).toBe(1);
  });
});
