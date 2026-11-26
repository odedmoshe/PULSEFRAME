/**
 * The page and field checks of «קליפ מקוד» (wave 8 motioncode; verify C4 as amended by the owner's autonomy decision). Never repairs
 * a page and refuses nothing by policy:
 * - `problems` are FACTS that make a page undrawable as sent: more than MADE_LIMITS.pageBytes UTF-8 bytes, a NUL character, or text
 *   that was not UTF-8 (U+FFFD, the decoder's mark for bytes that were not UTF-8; a lone surrogate; a byte-order mark after the start);
 * - everything else is a `warning` with its character offset (UTF-16 index into the string), so an author can look at every one in a
 *   single round. The browser lock (apps/renderer) is the judge; this scan only gives words.
 * How it matches: JavaScript names are case-sensitive and matched at identifier boundaries (a letter, digit, `_` or `$` on either side
 * means no match), so "update", "validate", "evaluate", "allocation" and "myfetch" give nothing. HTML tags and CSS properties are
 * matched case-insensitively, as browsers read them. Text inside `<!-- -->` and `/* *\/` comments is not scanned; text inside string
 * literals is (a heuristic: string-built names fool any scan, which is why the lock exists). A protocol-relative `//host` counts only
 * where an address is read (src=, href=, action=, url(), @import), so a `//comment` gives nothing. The SVG, XLink and XHTML namespace
 * strings and addresses on https://made.invalid/ (the pinned libraries, the owner's media, fetched copies) give nothing; any other
 * internet address is a warning (the job fetches it once before drawing, decision 5). At most MADE_CHECK_MAX_WARNINGS are returned.
 */
import { MADE_LIMITS, type MadeField } from './madeContract.ts';

/** A warning from the static scan of a page (verify C4: case-sensitive identifiers at word boundaries; warnings only, with offsets). */
export interface MadePageWarning { what: string; at: number }
/** Facts that make a page undrawable as sent (size, NUL, not UTF-8): the only things the static check refuses. */
export interface MadePageProblem { what: 'too_large' | 'nul' | 'not_utf8'; at: number }
/** The scan stops reporting after this many warnings (the answer stays bounded); problems are each reported once per kind and offset, up to the same number. */
export const MADE_CHECK_MAX_WARNINGS = 200;

const NAMESPACES = ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink', 'http://www.w3.org/1999/xhtml'];
const LOCAL = /^https:\/\/made\.invalid\//;

/** JavaScript names (case-sensitive, at identifier boundaries): what the page may reach outside its frame, or read the clock with. */
const IDENTIFIERS: readonly string[] = [
  // network, messages and navigation
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'sendBeacon', 'RTCPeerConnection', 'RTCDataChannel', 'navigator', 'location', 'postMessage',
  // code that outlives a frame
  'Worker', 'SharedWorker', 'serviceWorker', 'importScripts',
  // storage
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookie', 'BroadcastChannel',
  // clock and randomness: a frame must be a pure function of its number
  'Date', 'performance', 'getRandomValues', 'randomUUID', 'requestAnimationFrame', 'setTimeout', 'setInterval', 'requestIdleCallback',
  // the editor's content security policy forbids these; a word here beats a console error
  'eval', 'Function',
];
/** Dotted names (case-sensitive; the boundary is checked before the first and after the last character). */
const DOTTED: readonly string[] = ['Math.random', 'window.open', 'document.write', 'document.timeline'];
/** HTML tags (case-insensitive, `<tag` followed by a space, `>` or `/`). SMIL animation elements run on the document clock. */
const TAGS: readonly [string, string][] = [
  ['link', '<link'], ['base', '<base'], ['iframe', '<iframe'], ['frame', '<frame'], ['object', '<object'], ['embed', '<embed'], ['form', '<form'],
  ['video', '<video'], ['audio', '<audio'], ['animate', 'SMIL <animate>'], ['animateTransform', 'SMIL <animateTransform>'], ['animateMotion', 'SMIL <animateMotion>'], ['set', 'SMIL <set>'],
];

const idRe = (name: string) => new RegExp(`(?<![\\w$])${name.replace(/\./g, '\\.')}(?![\\w$])`, 'g');
const MATCHERS: readonly { what: string; re: RegExp; ok?: (m: RegExpExecArray, text: string) => boolean }[] = [
  ...IDENTIFIERS.map((n) => ({ what: n, re: idRe(n) })),
  ...DOTTED.map((n) => ({ what: n, re: idRe(n) })),
  ...TAGS.map(([tag, what]) => ({ what, re: new RegExp(`<${tag}(?=[\\s>/])`, 'gi') })),
  { what: '<meta http-equiv', re: /<meta\b[^>]*\bhttp-equiv\b/gi },
  { what: '<script src', re: /<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]*)/gi, ok: (m) => LOCAL.test(m[1] ?? '') },
  { what: '<img src', re: /<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]*)/gi, ok: (m) => /^data:image\//i.test(m[1] ?? '') || LOCAL.test(m[1] ?? '') },
  { what: 'CSS transition', re: /(?<![\w-])transition(?:-[a-z]+)?\s*:/gi },
  { what: 'javascript: address', re: /(?<![\w-])javascript:/gi },
  // an internet address: fetched once before drawing (decision 5), so a warning that names it
  { what: 'internet address', re: /(?<![\w-])(?:https?|wss?|ftp|file):\/\/[^\s"'<>()]*/gi, ok: (m) => NAMESPACES.includes(m[0]) || LOCAL.test(m[0]) },
  // a protocol-relative address only where an address is read, so a //comment gives nothing
  { what: 'protocol-relative address', re: /(?:\b(?:src|href|action|xlink:href)\s*=\s*["']?|url\(\s*["']?|@import\s+["']?)\/\/[^\s"'<>()]+/gi },
];

/** Comments (HTML and block) are blanked with spaces, so offsets stay the same and their words are not scanned. */
function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)|\/\*[\s\S]*?(?:\*\/|$)/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Scan a page. Never repairs; refuses only `problems`; everything else is a warning with its offset, in offset order. */
export function checkMadePage(html: string): { problems: MadePageProblem[]; warnings: MadePageWarning[] } {
  const problems: MadePageProblem[] = [];
  let bytes = 0, overAt = -1;
  for (let i = 0; i < html.length; i++) {
    const c = html.charCodeAt(i);
    let len: number;
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < html.length && (html.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { len = 4; }
    else if (c >= 0xd800 && c <= 0xdfff) { len = 3; if (problems.length < MADE_CHECK_MAX_WARNINGS) problems.push({ what: 'not_utf8', at: i }); }
    else { len = c < 0x80 ? 1 : c < 0x800 ? 2 : 3; }
    if (c === 0 && problems.length < MADE_CHECK_MAX_WARNINGS) problems.push({ what: 'nul', at: i });
    if ((c === 0xfffd || (c === 0xfeff && i > 0)) && problems.length < MADE_CHECK_MAX_WARNINGS) problems.push({ what: 'not_utf8', at: i });
    bytes += len;
    if (overAt < 0 && bytes > MADE_LIMITS.pageBytes) overAt = i;
    if (len === 4) i++;
  }
  if (overAt >= 0) problems.unshift({ what: 'too_large', at: overAt });

  const text = blankComments(html);
  const warnings: MadePageWarning[] = [];
  for (const m of MATCHERS) {
    m.re.lastIndex = 0;
    for (let x = m.re.exec(text); x; x = m.re.exec(text)) {
      if (x[0].length === 0) { m.re.lastIndex++; continue; }
      if (m.ok?.(x, text)) continue;
      warnings.push({ what: m.what === 'internet address' ? `internet address ${x[0].slice(0, 120)}` : m.what, at: x.index });
    }
  }
  warnings.sort((p, q) => p.at - q.at || p.what.localeCompare(q.what));
  return { problems, warnings: warnings.slice(0, MADE_CHECK_MAX_WARNINGS) };
}

/**
 * Validate field values against their fields: a value whose key names no field (unknown), a colour that is not #rrggbb (colour), a
 * number field whose value does not parse as a finite number (number) or lies outside min..max (range), a text longer than its
 * maxLength or MADE_LIMITS.valueChars characters (length; counted in code points). One problem per key, in the order of `values`.
 */
export function madeFieldsCheck(fields: readonly MadeField[], values: Readonly<Record<string, string>>): { key: string; why: 'unknown' | 'colour' | 'number' | 'range' | 'length' }[] {
  const out: { key: string; why: 'unknown' | 'colour' | 'number' | 'range' | 'length' }[] = [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(values)) {
    const f = byKey.get(key);
    if (!f) { out.push({ key, why: 'unknown' }); continue; }
    if ([...value].length > MADE_LIMITS.valueChars) { out.push({ key, why: 'length' }); continue; }
    if (f.kind === 'colour') { if (!/^#[0-9a-fA-F]{6}$/.test(value)) out.push({ key, why: 'colour' }); continue; }
    if (f.kind === 'number') {
      const n = value.trim() === '' ? NaN : Number(value);
      if (!Number.isFinite(n)) out.push({ key, why: 'number' });
      else if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) out.push({ key, why: 'range' });
      continue;
    }
    if (f.maxLength !== undefined && [...value].length > f.maxLength) out.push({ key, why: 'length' });
  }
  return out;
}
