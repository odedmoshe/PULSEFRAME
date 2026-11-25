/**
 * Third-party SVG before it reaches the rasteriser (wave 7 library track; plan §4.2). WORKER A builds the body.
 * Refuses — never repairs — on any of: `<script`, `<foreignObject`, `<image`, `<iframe`, `<a `, animation elements (`<animate`,
 * `<set`), an `on…=` attribute, `<!ENTITY` or a DOCTYPE internal subset, `xml-stylesheet`, `@import`, any `href` or `url(` that is
 * not a `#fragment`; and text above SVG_MAX_BYTES. Case-insensitive. Third-party SVG never reaches the browser either way.
 *
 * Worker A's reading of "fail closed" (stricter than the list above, never looser):
 * - The raw text is scanned, comments and CDATA included: a forbidden word inside a comment refuses the file too.
 * - Element names are matched with or without a namespace prefix (`<svg:script`, `<x:image`).
 * - Any DOCTYPE is refused (an external DTD is an external reference as much as an internal subset is an entity source), and so
 *   is any entity reference other than the five XML ones and numeric character references.
 * - Any processing instruction other than the XML declaration is refused; a declared encoding other than UTF-8 is refused.
 * - Text holding NUL, U+FFFD (bytes that were not UTF-8) or a byte-order mark after the start is refused, and so is text whose
 *   first element is not `<svg`.
 * - `javascript:`, `data:` and `xml:base` anywhere, and the event-handler and listener elements of SVG Tiny, are refused.
 */
export const SVG_MAX_BYTES = 512 * 1024;
export type SvgCheck = { ok: true; svg: string } | { ok: false; why: string };

const NAME = '(?:[A-Za-z_][\\w.-]*:)?';
const RULES: readonly [RegExp, string][] = [
  [new RegExp(`<\\s*${NAME}script\\b`, 'i'), 'it holds a script'],
  [new RegExp(`<\\s*${NAME}foreignObject\\b`, 'i'), 'it holds foreign content (foreignObject)'],
  [new RegExp(`<\\s*${NAME}(?:image|feImage)\\b`, 'i'), 'it holds an image element'],
  [new RegExp(`<\\s*${NAME}(?:iframe|embed|object|video|audio)\\b`, 'i'), 'it holds embedded content'],
  [new RegExp(`<\\s*${NAME}a[\\s>/]`, 'i'), 'it holds a link element'],
  [new RegExp(`<\\s*${NAME}(?:animate\\w*|set|discard)\\b`, 'i'), 'it holds animation'],
  [new RegExp(`<\\s*${NAME}(?:handler|listener)\\b`, 'i'), 'it holds an event handler'],
  [/[\s/"']on[a-z][\w:.-]*\s*=/i, 'it holds an event-handler attribute'],
  [/<!ENTITY/i, 'it declares entities'],
  [/<!DOCTYPE/i, 'it has a document type declaration'],
  [/<\?(?!xml\s)/i, 'it holds a processing instruction (such as xml-stylesheet)'],
  [/xml-stylesheet/i, 'it links a style sheet'],
  [/@import/i, 'its styles import another file'],
  [/javascript\s*:/i, 'it holds a javascript: address'],
  [/data\s*:/i, 'it holds a data: address'],
  [/xml:base/i, 'it sets a base address'],
  [/&(?!(?:amp|lt|gt|quot|apos);|#[0-9]{1,7};|#x[0-9a-f]{1,6};)/i, 'it uses an entity reference'],
];
/** Every `href` value (any namespace prefix) must be a `#fragment`; every `url(` must hold a `#fragment`. */
const HREF = /(?:^|[\s"'])(?:[\w.-]+:)?href\s*=\s*(["'])([\s\S]*?)\1/gi;
const HREF_ANY = /(?:^|[\s"'])(?:[\w.-]+:)?href\s*=/gi;
const URL_CALL = /url\s*\(\s*(["']?)([^)"']*)/gi;
const ENCODING = /^\s*<\?xml\s[^>]*?encoding\s*=\s*(["'])([^"']*)\1/i;

export function sanitiseSvg(text: string): SvgCheck {
  const no = (why: string): SvgCheck => ({ ok: false, why });
  if (typeof text !== 'string' || text.length === 0) return no('it is empty');
  if (new TextEncoder().encode(text).length > SVG_MAX_BYTES) return no(`it is larger than ${SVG_MAX_BYTES} bytes`);
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  if (/[\u0000�﻿]/.test(body)) return no('it is not plain UTF-8 text');
  const enc = ENCODING.exec(body);
  if (enc && !/^utf-?8$/i.test(enc[2]!.trim())) return no(`it declares the encoding ${enc[2]!.slice(0, 20)}`);
  for (const [re, why] of RULES) if (re.test(body)) return no(why);
  let hrefs = 0;
  for (const m of body.matchAll(HREF)) {
    hrefs++;
    if (!m[2]!.trim().startsWith('#')) return no('it refers to another file or address');
  }
  // an href whose value is not a quoted string (or is split oddly) is not understood: refused
  if ([...body.matchAll(HREF_ANY)].length !== hrefs) return no('it refers to another file or address');
  for (const m of body.matchAll(URL_CALL)) if (!m[2]!.trim().startsWith('#')) return no('its styles refer to another file or address');
  // the first element must be the svg root (after an XML declaration, comments and white space)
  const lead = body.replace(/^\s*(?:<\?xml\s[^>]*\?>)?(?:\s*<!--[\s\S]*?-->)*\s*/, '');
  if (!/^<(?:[A-Za-z_][\w.-]*:)?svg[\s>/]/.test(lead)) return no('it does not start with an svg element');
  return { ok: true, svg: text };
}
