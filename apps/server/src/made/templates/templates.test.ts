/**
 * The built-in pages of «קליפ מקוד» (verify C9): owner-typed values never become markup (no innerHTML, outerHTML, insertAdjacentHTML,
 * document.write; text through textContent or Canvas/SVG text), only catalogue fonts are named (system fallbacks would decide the look
 * on Windows), no network, clock, randomness, storage or library, no SMIL; fields fit the contract; Hebrew and English samples for every
 * text field; the catalogue's sha256 is the page's. Functional rendering and the pictures are the proof's (made-proof.ts check 18).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FONT_CATALOG, MadeFieldSchema, MADE_LIBRARIES, MADE_LIMITS } from '@pulseframe/core';
import { MADE_TEMPLATES } from './index.ts';

const families = new Set(FONT_CATALOG.map((f) => f.family));
const scriptOf = (page: string) => [...page.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).join('\n');
/** The one kind of address a built-in page may name (integration decision 8): an ES module import of a file of an installed, pinned
 *  MADE_LIBRARIES row, served locally at https://made.invalid/lib/. Stripped before the no-network checks; nothing else is allowed. */
const LIB_IMPORT = /^import \* as [A-Z]+ from 'https:\/\/made\.invalid\/lib\/([a-z0-9.-]+)@(\d+\.\d+\.\d+)\/([^']+)';$/gm;
const libImports = (page: string) => [...page.matchAll(LIB_IMPORT)].map((m) => ({ name: m[1]!, version: m[2]!, file: m[3]! }));
const withoutLibImports = (page: string) => page.replace(LIB_IMPORT, '');

describe('built-in made pages', () => {
  it('six general-purpose pages (the sixth uses three.js, integration decision 8), unique ids, valid fields, a Hebrew and an English sample for every text field', () => {
    expect(MADE_TEMPLATES.map((t) => t.id)).toEqual(['rising-title', 'lower-third', 'counter', 'intro-plate', 'end-card', 'card-3d']);
    for (const t of MADE_TEMPLATES) {
      expect(t.fields.length).toBeLessThanOrEqual(MADE_LIMITS.fields);
      for (const f of t.fields) expect(() => MadeFieldSchema.parse(f), `${t.id}.${f.key}`).not.toThrow();
      expect(t.seconds).toBeLessThanOrEqual(MADE_LIMITS.maxSeconds);
      for (const f of t.fields.filter((x) => x.kind === 'text')) {
        expect(/[א-ת]/.test(t.samples.he[f.key]!), `${t.id}.${f.key} he`).toBe(true);
        expect(/^[\x20-\x7e]+$/.test(t.samples.en[f.key]!), `${t.id}.${f.key} en`).toBe(true);
      }
      for (const f of t.fields.filter((x) => x.kind === 'colour')) expect(f.default).toMatch(/^#[0-9a-f]{6}$/);
      expect(Buffer.byteLength(t.page, 'utf8')).toBeLessThan(MADE_LIMITS.pageBytes);
      expect(t.pageSha256).toBe(`sha256:${createHash('sha256').update(t.page, 'utf8').digest('hex')}`);
    }
  });
  it('a library is imported only from an installed, pinned row, served locally; exactly one page (card-3d) uses one', () => {
    const using = MADE_TEMPLATES.filter((t) => libImports(t.page).length > 0).map((t) => t.id);
    expect(using).toEqual(['card-3d']);
    for (const t of MADE_TEMPLATES) for (const l of libImports(t.page)) {
      const row = MADE_LIBRARIES.find((r) => r.name === l.name);
      expect(row, `${t.id}: ${l.name}`).toMatchObject({ version: l.version, installed: true });
      expect(row!.files, `${t.id}: ${l.file}`).toContain(l.file);
    }
  });
  it('values never become markup; no network, clock, randomness, storage, workers, other libraries or SMIL', () => {
    for (const t0 of MADE_TEMPLATES) {
      const t = { ...t0, page: withoutLibImports(t0.page) };
      const js = scriptOf(t.page);
      expect(js, t.id).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\b|Function\(/);
      expect(t.page, t.id).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|Worker|localStorage|sessionStorage|indexedDB|Date|performance|requestAnimationFrame|setTimeout|setInterval)\b|Math\.random|getRandomValues|randomUUID/);
      expect(t.page, t.id).not.toMatch(/<(animate|set|animateTransform|animateMotion)\b|<script\s+src|<link\b|<iframe|<img\b|@import|url\(/i);
      expect(t.page.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, ''), t.id).not.toMatch(/https?:|\/\/[a-z]/i);
      expect(js, `${t.id} sets text with textContent or draws it`).toMatch(/textContent|fillText/);
    }
  });
  it('only catalogue fonts are named (CSS font-family, Canvas font, SVG font-family)', () => {
    for (const t of MADE_TEMPLATES) {
      const named = [
        ...[...t.page.matchAll(/font-family\s*:\s*([^;}"]+)/g)].map((m) => m[1]!.trim()),
        ...[...t.page.matchAll(/px (?:\\?"([^"\\]+)\\?"|([A-Z][A-Za-z ]+))'/g)].map((m) => (m[1] ?? m[2])!.trim()),
        ...[...t.page.matchAll(/'font-family',\s*'([^']+)'/g)].map((m) => m[1]!),
      ];
      expect(named.length, `${t.id} names a font`).toBeGreaterThan(0);
      for (const f of named) expect(families.has(f.replace(/^["']|["']$/g, '')), `${t.id}: ${f}`).toBe(true);
    }
  });
});
