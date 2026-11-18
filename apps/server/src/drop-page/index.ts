/**
 * The phone's upload page (ADR-0023): one self-contained HTML document the drop door serves at GET /. No build step: page.html,
 * page.css and page.js (ES2017, no imports, no external URL, under 30 KB together) sit next to this file, and this module inlines
 * the CSS and the script into the HTML's {{css}} and {{js}} slots and computes the Content-Security-Policy from the sha256 of
 * exactly the inlined blocks:
 *   default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; connect-src 'self'; img-src data:; form-action 'none';
 *   base-uri 'none'; frame-ancestors 'none'
 * The page has no inline event handlers and no style attributes (neither would pass that policy). Its elements carry the ids of
 * DROP_PAGE_TESTIDS (./testids.ts). Line endings are normalised to \n before hashing, so a Windows checkout hashes the same.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface DropPage {
  /** One self-contained HTML document: inline style and script, no external URL. */
  body: Buffer;
  /** Content-Security-Policy with the sha256 of exactly those inline blocks. */
  csp: string;
}
const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const lf = (s: string) => s.replace(/\r\n?/g, '\n');

/** Inlines the style and the script into the document and writes the policy that allows exactly those two blocks. Pure. */
export function buildDropPage(html: string, css: string, js: string): DropPage {
  const style = lf(css), script = lf(js);
  if (!html.includes('{{css}}') || !html.includes('{{js}}')) throw new Error('page.html must hold the {{css}} and {{js}} slots');
  // a replacer function: the css and js hold '$' characters that a replacement string would read as patterns
  const doc = lf(html).replace('{{css}}', () => style).replace('{{js}}', () => script);
  const csp = `default-src 'none'; script-src ${sha(script)}; style-src ${sha(style)}; connect-src 'self'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`;
  return { body: Buffer.from(doc, 'utf8'), csp };
}

let cached: DropPage | null = null;
/** The page from the three files next to this module (read once). */
export function loadDropPage(): DropPage {
  if (cached) return cached;
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const read = (n: string) => fs.readFileSync(`${dir}${n}`, 'utf8');
  cached = buildDropPage(read('page.html'), read('page.css'), read('page.js'));
  return cached;
}
