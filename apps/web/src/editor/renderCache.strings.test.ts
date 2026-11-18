/** Strings of the fast export and the render cache (ADR-0024): both languages, the plan's Hebrew lines, and nothing that promises speed or certainty. */
import { describe, expect, it } from 'vitest';
import { dictionaries } from '@pulseframe/i18n';
import { RENDER_CACHE_LINES, cacheText, failureText, formatBytes, numberParts, renderCacheStrings, stageLabel } from './renderCache.strings.ts';

const he = renderCacheStrings('he');
const en = renderCacheStrings('en');

function everyString(lang: 'he' | 'en'): string[] {
  const s = renderCacheStrings(lang);
  const out = [
    ...[0, 1, 2, 16, 284, 300].flatMap((n) => [s.reuseLine(n, 300), s.renderLine(n, n * 2), s.firstExport(n), s.uncacheableLine(n), s.eta(n * 10), s.laneSummary(n, 300), s.storageRow(n * 2 ** 26, 2 ** 31), s.cleared(n * 2 ** 26, n % 2)]),
    s.done({ reused: 284, rendered: 16, framesChecked: 12, notStored: 0 }), s.done({ reused: 1, rendered: 0, framesChecked: 0, notStored: 3 }), s.storageRow(0, 0),
  ];
  for (const k of Object.keys(dictionaries[lang]).filter((x) => x.startsWith('cache.') || /^error\.code\.(incremental_|render_cache_|segment_join)/.test(x))) out.push(dictionaries[lang][k as keyof typeof dictionaries.he]);
  return out;
}

describe('both languages', () => {
  it('every key exists in Hebrew and English, and every line renders', () => {
    expect(Object.keys(RENDER_CACHE_LINES.he).sort()).toEqual(Object.keys(RENDER_CACHE_LINES.en).sort());
    for (const k of Object.keys(RENDER_CACHE_LINES.he) as (keyof typeof he)[]) { expect(typeof he[k]).toBe('function'); expect(typeof en[k]).toBe('function'); }
    for (const lang of ['he', 'en'] as const) for (const line of everyString(lang)) expect(line.trim().length, line).toBeGreaterThan(0);
  });
  it('the fixed cache.* keys exist in both dictionaries', () => {
    const keys = Object.keys(dictionaries.he).filter((k) => k.startsWith('cache.'));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) { expect(k in dictionaries.en, k).toBe(true); expect((dictionaries.en as Record<string, string>)[k]!.length).toBeGreaterThan(0); }
  });
  it('Hebrew lines are Hebrew and English lines are not', () => {
    for (const line of [he.reuseLine(1, 2), he.renderLine(2, 4), he.firstExport(300), he.laneSummary(1, 2)]) expect(/[֐-׿]/.test(line)).toBe(true);
    for (const line of [en.reuseLine(1, 2), en.renderLine(2, 4), en.firstExport(300), en.laneSummary(1, 2)]) expect(/[֐-׿]/.test(line)).toBe(false);
  });
});

describe('the lines of plan section 8', () => {
  it('reuse line', () => {
    expect(he.reuseLine(284, 300)).toBe('נעשה שימוש חוזר ב-284 מתוך 300 מקטעים');
    expect(en.reuseLine(284, 300)).toBe('Reusing 284 of 300 segments');
  });
  it('to-render line, first export, uncacheable, lane summary', () => {
    expect(he.renderLine(16, 32)).toBe('יירנדרו מחדש 16 מקטעים (32 שניות של סרטון)');
    expect(he.renderLine(1, 1)).toBe('יירנדר מחדש מקטע אחד (שנייה אחת של סרטון)');
    expect(he.firstExport(300)).toBe('ייצוא ראשון: כל 300 המקטעים ירונדרו ויישמרו לפעם הבאה');
    expect(he.uncacheableLine(3)).toBe('3 מקטעים ירונדרו בכל ייצוא ולא יישמרו במטמון');
    expect(he.laneSummary(284, 300)).toBe('מטמון רינדור: 284 מתוך 300 מקטעים שמורים');
    expect(en.laneSummary(284, 300)).toBe('Render cache: 284 of 300 segments kept');
  });
  it('the measured estimate names its basis; minutes above a minute', () => {
    expect(he.eta(40)).toBe('זמן משוער: כ-40 שניות (נמדד בייצואים קודמים במחשב הזה)');
    expect(he.eta(180)).toContain('כ-3 דקות');
    expect(en.eta(40)).toContain('measured in earlier exports');
  });
  it('done line claims the frames it checked, not the cache', () => {
    expect(he.done({ reused: 284, rendered: 16, framesChecked: 12, notStored: 0 })).toBe('284 מקטעים מהמטמון · 16 רונדרו · בדיקה עצמית: 12 פריימים זהים ✓');
    expect(he.done({ reused: 2, rendered: 0, framesChecked: 0, notStored: 2 })).toContain('לא נשמרו');
    expect(en.done({ reused: 284, rendered: 16, framesChecked: 12, notStored: 0 })).toBe('284 segments from the cache · 16 rendered · self-check: 12 frames identical ✓');
  });
  it('storage row, sizes, cleared', () => {
    expect(he.storageRow(1.2 * 2 ** 30, 2 * 2 ** 30)).toBe('מטמון רינדור 1.2 / 2 GB');
    expect(en.storageRow(0, 0)).toBe(dictionaries.en['cache.storage.off']);
    expect(formatBytes(2 ** 31)).toBe('2 GB'); expect(formatBytes(300 * 2 ** 20)).toBe('0.3 GB');
    expect(he.cleared(2 ** 30, 1)).toContain(dictionaries.he['cache.storage.keptPinned']);
  });
});

describe('stage labels, failure text and numbers', () => {
  it('words the stage rows of the incremental route, with their counts', () => {
    expect(stageLabel('keying', 'he')).toBe('בדיקה מה השתנה');
    expect(stageLabel('self-check 3/12', 'he')).toBe('בדיקה עצמית של המטמון 3/12');
    expect(stageLabel('rendering 2/16', 'en')).toBe(`${cacheText('en', 'cache.stage.rendering')} 2/16`);
    expect(stageLabel('joining', 'he')).toBe('חיבור המקטעים');
    expect(stageLabel('preparing', 'he')).toBeNull();
    // names of Object.prototype members are not stages (review item: 'constructor' used to give undefined, not null)
    for (const name of ['constructor', 'tostring', 'hasownproperty']) expect(stageLabel(name, 'he')).toBeNull();
    expect(stageLabel('constructor', 'en')).toBeNull();
  });
  it('the failure sentences are the fixed ones; other codes are not ours', () => {
    expect(failureText('render_cache_self_check_failed', 'he')).toBe(dictionaries.he['cache.failed.selfCheck']);
    expect(failureText('segment_join_mismatch', 'en')).toBe(dictionaries.en['cache.failed.join']);
    expect(failureText('render_cache_purged', 'he')).toBe(dictionaries.he['cache.failed.purged']);
    expect(failureText('export_failed', 'he')).toBeNull();
    expect(failureText(undefined, 'he')).toBeNull();
  });
  it('numberParts finds each number so it can sit in <bdi dir=ltr>', () => {
    expect(numberParts(he.reuseLine(284, 300)).filter((p) => p.num).map((p) => p.text)).toEqual(['284', '300']);
    expect(numberParts('1.2 / 2 GB').filter((p) => p.num).map((p) => p.text)).toEqual(['1.2', '2']);
    expect(numberParts('abc').every((p) => !p.num)).toBe(true);
    expect(numberParts(he.eta(40)).map((p) => p.text).join('')).toBe(he.eta(40));
  });
});

describe('no promise of speed, no certainty', () => {
  const speed = /מהיר פי|פי \d|מהר יותר|מהירות|בשניות ספורות|תוך שניות|\d+x\b|faster|times faster|instant|in seconds|speed-?up|\bquick(ly)?\b/i;
  const certain = /בטוח|מובטח|ודאי|מאומת|אומת|הוכח|מבטיח|תמיד|verified|guarantee|certain|proven|always|never fails|safe to/i;
  it.each(['he', 'en'] as const)('%s: nothing promises a speed or says anything is certain', (lang) => {
    for (const line of everyString(lang)) { expect(line, line).not.toMatch(speed); expect(line, line).not.toMatch(certain); }
  });
  it('the notes name limits instead: a ripple and a music move re-render, the self-check proves the checked frames', () => {
    expect(cacheText('he', 'cache.plan.ripple')).toContain('מרנדר מחדש');
    expect(cacheText('he', 'cache.plan.music')).toContain('מרנדר מחדש');
    expect(he.done({ reused: 1, rendered: 1, framesChecked: 3, notStored: 0 })).not.toMatch(/המטמון (אומת|נבדק)/);
  });
});
