/**
 * The phone's upload page (ADR-0023): one self-contained HTML document the drop door serves at GET /. No build step: W3 writes
 * page.html, page.css and page.js (ES2017, no imports, no external URL, under 30 KB together) next to this file, and this module
 * inlines the three and computes the Content-Security-Policy from the sha256 of exactly the inlined blocks:
 *   default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; connect-src 'self'; img-src data:; form-action 'none';
 *   base-uri 'none'; frame-ancestors 'none'
 * The page's elements carry the ids of DROP_PAGE_TESTIDS (./testids.ts).
 *
 * LEAD STUB (wave 5 pre-pass): until W3 writes the page, this serves a plain notice that uploading from a phone is not available
 * in this build. It has no script and no form, so it cannot send anything; its policy allows nothing at all.
 */
export interface DropPage {
  /** One self-contained HTML document: inline style and script, no external URL. */
  body: Buffer;
  /** Content-Security-Policy with the sha256 of exactly those inline blocks. */
  csp: string;
}
const NOT_BUILT = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>העלאה מהטלפון</title></head>'
  + '<body><p>העלאה מהטלפון עוד לא זמינה בגרסה הזו.</p><p lang="en" dir="ltr">Uploading from a phone is not available in this build yet.</p></body></html>';
export function loadDropPage(): DropPage {
  return { body: Buffer.from(NOT_BUILT, 'utf8'), csp: "default-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" };
}
