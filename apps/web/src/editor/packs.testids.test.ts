/**
 * The fixed test ids of the content packs, built-in music and font picker (packs.testids.ts) are distinct and keep the plan's
 * prefixes; the title-font import list (../titleFonts.ts, not imported until the lead activates the fonts) names exactly the
 * hebrew and latin file of every weight of core TITLE_FONT_ROWS. Read as text: no stylesheet is loaded here.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACK_FIELD_KEYS, TITLE_FONT_ROWS } from '@pulseframe/core';
import { FONT_TESTIDS, MUSIC_TESTIDS, PACK_TABS, PACK_TESTIDS } from './packs.testids.ts';

const flat = (table: Record<string, unknown>): string[] => Object.values(table).flatMap((v) => (typeof v === 'string' ? [v] : []));
describe('content-pack test ids (ADR-0022)', () => {
  it('are distinct across the three tables, including every tab, field and music source, and keep their prefixes', () => {
    const ids = [
      ...flat(PACK_TESTIDS), ...PACK_TABS.flatMap((t) => [PACK_TESTIDS.tab(t), PACK_TESTIDS.panel(t)]), ...PACK_FIELD_KEYS.map((k) => PACK_TESTIDS.field(k)),
      ...(['none', 'library', 'builtin'] as const).map((s) => PACK_TESTIDS.musicSourceOption(s)), ...flat(MUSIC_TESTIDS), ...flat(FONT_TESTIDS),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^(pack|tpl|music|font)-[a-z0-9-]+$/);
  });
});
describe('title fonts waiting for activation', () => {
  it('titleFonts.ts imports exactly the hebrew and latin file of each weight of TITLE_FONT_ROWS', () => {
    const source = fs.readFileSync(new URL('../titleFonts.ts', import.meta.url), 'utf8');
    const imported = [...source.matchAll(/^import '(@fontsource\/[^']+\.css)';$/gm)].map((m) => m[1]).sort();
    const expected = TITLE_FONT_ROWS.flatMap((f) => f.weights.flatMap((w) => ['hebrew', 'latin'].map((s) => `${f.package}/${s}-${w}.css`))).sort();
    expect(imported).toEqual(expected);
    expect(source).toContain(`[${TITLE_FONT_ROWS.map((f) => `'${f.family}'`).join(', ')}]`);
  });
});
