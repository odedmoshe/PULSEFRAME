/**
 * The built-in pages of «קליפ מקוד» (verify C9): owner-typed values never become markup (no innerHTML, outerHTML, insertAdjacentHTML,
 * document.write; text through textContent or Canvas/SVG text), only catalogue fonts are named (system fallbacks would decide the look
 * on Windows), no network, clock, randomness, storage or library, no SMIL; fields fit the contract; Hebrew and English samples for every
 * text field; the catalogue's sha256 is the page's. Functional rendering and the pictures are the proof's (made-proof.ts check 18).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FONT_CATALOG, MadeFieldSchema, MADE_LIMITS } from '@pulseframe/core';
import { MADE_TEMPLATES } from './index.ts';

const families = new Set(FONT_CATALOG.map((f) => f.family));
const scriptOf = (page: string) => [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).join('\n');

describe('built-in made pages', () => {
  it('five general-purpose pages, unique ids, valid fields, a Hebrew and an English sample for every text field', () => {
    expect(MADE_TEMPLATES.map((t) => t.id)).toEqual(['rising-title', 'lower-third', 'counter', 'intro-plate', 'end-card']);
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
  it('values never become markup; no network, clock, randomness, storage, workers, libraries or SMIL', () => {
    for (const t of MADE_TEMPLATES) {
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
