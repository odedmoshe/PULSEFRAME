/**
 * The built-in music browser (ADR-0022): its logic (rows, lengths and sizes from the server's own arithmetic, the section strip
 * from the real layout, URLs and bodies of the planned routes, error words), its strings (equal to the shared label, tempo
 * line and section names; Hebrew and English cover the same keys; every style is still called unheard), the component rendered
 * with fixture data (every MUSIC_TESTIDS id present, text labels on the strip, no autoplay), and the contrast of the colours its
 * stylesheet uses.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { MUSIC_SECTION_KINDS, MUSIC_STYLES, MUSIC_UNHEARD_LABEL, musicLayout } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { contrast, readThemes } from '../ds/contrast.ts';
import { MusicBrowser } from './MusicBrowser.tsx';
import { MUSIC_TESTIDS } from './packs.testids.ts';
import { MUSIC_STRINGS } from './music.strings.ts';
import { addBody, errorText, formatDuration, formatMegabytes, lengthChoices, musicRows, parseFitSeconds, previewUrl, sectionStrip, sizeOf, stepSeed } from './music.logic.ts';

const he = MUSIC_STRINGS.he, en = MUSIC_STRINGS.en;

describe('strings', () => {
  it('Hebrew and English have the same keys; the shared words are the shared tables\' words', () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v).map((x) => `${k}.${x}`) : [k])).sort();
    expect(keys(en)).toEqual(keys(he));
    for (const lang of ['he', 'en'] as const) {
      const s = MUSIC_STRINGS[lang];
      expect(s.unheard).toBe(MUSIC_UNHEARD_LABEL[lang]);
      expect(s.knownFromRecipe).toBe(dictionaries[lang]['music.knownFromRecipe' as keyof typeof dictionaries.he]);
      for (const k of MUSIC_SECTION_KINDS) expect(s.section[k]).toBe(dictionaries[lang][`music.section.${k}` as keyof typeof dictionaries.he]);
    }
  });
  it('no string calls the music good, measured or tested by ear', () => {
    const all = JSON.stringify(MUSIC_STRINGS);
    for (const w of ['נמדד', 'measured', 'מומלץ', 'recommended', 'approved', 'מאושר']) expect(all.includes(w), w).toBe(false);
  });
});

describe('rows and lengths', () => {
  it('six rows, all unheard, each with the unheard label', () => {
    const rows = musicRows('he');
    expect(rows.map((r) => r.id)).toEqual(MUSIC_STYLES.map((s) => s.id));
    for (const r of rows) { expect(r.unheard).toBe(true); expect(r.label).toBe(MUSIC_UNHEARD_LABEL.he); }
  });
  it('sizes are the server\'s: 44 + 16·bars·samplesPerBeat bytes, 240·bars/bpm seconds', () => {
    for (const s of MUSIC_STYLES) for (const bars of [4, 8, 16, 32]) {
      const L = musicLayout(s.id, bars);
      expect(sizeOf(s, bars)).toEqual({ seconds: T.toSeconds(L.duration), bytes: 44 + 4 * L.totalFrames });
    }
    expect(formatMegabytes(sizeOf({ bpm: 120 }, 16).bytes)).toBe('6.1'); // 32 s at 192,000 bytes a second
    expect([formatDuration(32), formatDuration(40 / 3), formatDuration(64), formatDuration(0.5)]).toEqual(['0:32', '0:14', '1:04', '0:01']);
  });
  it('«כאורך הסרטון» rounds the film\'s exact length up to whole bars; an empty or too long film is a reason, not a hidden chip', () => {
    const birthday = musicRows('he').find((r) => r.id === 'music.birthday')!.style;
    const at = (fit: string | null) => lengthChoices(birthday, fit, he).find((c) => c.key === 'fit')!;
    expect(lengthChoices(birthday, '10', he).map((c) => c.key)).toEqual(['8', '16', '32', 'fit']);
    expect(at('10')).toMatchObject({ bars: 5, seconds: 10, disabledReason: null });
    expect(at('21/2')).toMatchObject({ bars: 6, disabledReason: null }); // 10.5 s → 5.25 bars → 6
    expect(at(null)).toMatchObject({ bars: null, disabledReason: he.fitEmpty });
    expect(at('0')).toMatchObject({ disabledReason: he.fitEmpty });
    expect(at('301')).toMatchObject({ disabledReason: he.fitTooLong });
    expect(parseFitSeconds('40/3')).toEqual(T.rt(40, 3));
    expect(parseFitSeconds('abc')).toBeNull();
  });
  it('the section strip is the layout the server makes, with a word on every part', () => {
    for (const s of MUSIC_STYLES) for (const bars of [8, 16, 32]) {
      const strip = sectionStrip(s.id, bars, he);
      expect(strip.map((p) => [p.kind, p.startBar, p.bars])).toEqual(musicLayout(s.id, bars).sections.map((x) => [x.kind, x.startBar, x.bars]));
      expect(strip.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 12);
      for (const p of strip) expect(p.label).toBe(he.section[p.kind]);
    }
  });
});

describe('requests', () => {
  it('the preview plays at most 32 bars; the add body carries one length, the seed and the start of the film', () => {
    expect(previewUrl('music.pop', 16, 3)).toBe('/api/v1/music/music.pop/audio?bars=16&seed=3');
    expect(previewUrl('music.pop', 60, 3)).toBe('/api/v1/music/music.pop/audio?bars=32&seed=3');
    const pop = musicRows('en').find((r) => r.id === 'music.pop')!.style;
    const [c8, , , fit] = lengthChoices(pop, '30', en);
    expect(addBody('music.pop', c8!, '30', 2)).toEqual({ styleId: 'music.pop', bars: 8, seed: 2, start: T.ZERO });
    expect(addBody('music.pop', fit!, '30', 2)).toEqual({ styleId: 'music.pop', fitSeconds: '30', seed: 2, start: T.ZERO });
    expect([stepSeed(0, -1), stepSeed(1, 1), stepSeed(1_000_000, 1)]).toEqual([0, 2, 1_000_000]);
  });
  it('errors: busy is its own line; a known refusal is worded in Hebrew; anything else keeps the server\'s words', () => {
    expect(errorText('he', he, 429, { error: { code: 'synthesis_busy', message: 'x' } })).toBe(he.busy);
    expect(errorText('he', he, 404, { error: { code: 'not_found', message: 'there is no built-in music style "music.x"' } })).toBe(`${he.failed}: סגנון המוזיקה המובנית הזה אינו קיים בגרסה הזו`);
    expect(errorText('en', en, 500, { error: { code: 'music_invalid', message: 'boom' } })).toBe(`${en.failed}: boom`);
    expect(errorText('en', en, 502, null)).toBe(`${en.failed}: HTTP 502`);
  });
});

describe('the component, rendered with fixture data', () => {
  const html = (fit: string | null, lang: 'he' | 'en' = 'he') => renderToStaticMarkup(createElement(MusicBrowser, { projectId: 'prj_1', lang, fitSeconds: fit }));
  it('every test id is there; six rows; the strip has words; nothing plays by itself', () => {
    const out = html('20');
    for (const id of [MUSIC_TESTIDS.panel, MUSIC_TESTIDS.row, MUSIC_TESTIDS.play, MUSIC_TESTIDS.bars, MUSIC_TESTIDS.seed, MUSIC_TESTIDS.sections, MUSIC_TESTIDS.unheard, MUSIC_TESTIDS.add, MUSIC_TESTIDS.size]) expect(out, id).toContain(`data-testid="${id}"`);
    expect(out.match(/data-testid="music-row"/g)).toHaveLength(6);
    expect(out.match(/data-testid="music-unheard"/g)).toHaveLength(6);
    expect(out).toContain(MUSIC_UNHEARD_LABEL.he);
    expect(out).toContain('data-bars="fit"');
    expect(out).toContain('data-kind="peak"');
    expect(out).toContain(`>${he.section.ending}<`);
    expect(out).toContain(he.knownFromRecipe);
    expect(out).not.toMatch(/autoplay|<audio/i);
    expect(out).toContain('aria-pressed="false"');
  });
  it('an empty film says why «כאורך הסרטון» cannot be used; English renders too', () => {
    expect(html(null)).toContain(he.fitEmpty);
    expect(html('20', 'en')).toContain(en.add);
  });
});

describe('contrast of the colours the stylesheet uses', () => {
  const tokens = readFileSync(new URL('../ds/tokens.css', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./musicBrowser.css', import.meta.url), 'utf8');
  const themes = readThemes(tokens);
  it('uses only tokens, never a literal colour', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
  it.each(['dark', 'light'] as const)('%s: text, secondary text and the tempo token are at least 4.5:1 on the row', (theme) => {
    const t = themes[theme];
    for (const fg of ['--pf-text', '--pf-text-2', '--pf-k-music', '--pf-danger', '--pf-ok']) expect(contrast(t[fg]!, t['--pf-surface-2']!), `${theme} ${fg}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--pf-text']!, t['--pf-surface-4']!), `${theme} strip text`).toBeGreaterThanOrEqual(4.5);
  });
});
