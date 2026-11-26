/** The living strings (lead seed): he and en have the same keys; the honest lines are there; nothing called safe or checked; plural Hebrew. */
import { describe, expect, it } from 'vitest';
import { LIVING_EN, LIVING_HE } from '@pulseframe/i18n';
import { livingT } from './living.strings.ts';

describe('living strings (seed)', () => {
  it('he and en have the same keys, none empty, the placeholders match', () => {
    expect(Object.keys(LIVING_EN).sort()).toEqual(Object.keys(LIVING_HE).sort());
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(LIVING_HE) as (keyof typeof LIVING_HE)[]) {
      expect(LIVING_HE[k].trim().length, k).toBeGreaterThan(0);
      expect(holes(LIVING_EN[k]), k).toEqual(holes(LIVING_HE[k]));
    }
  });
  it('the block says the depth is the owner\'s drawing and nobody has looked; the limits are a rule of thumb; the cut moves are not named', () => {
    const he = livingT('he');
    expect(he('living.drawnNote')).toBe('העומק הוא הציור שלכם, לא חישוב. אף אחד עוד לא הסתכל על התוצאה');
    expect(he('living.ruleOfThumb')).toMatch(/כלל אצבע/);
    expect([he('living.move.push'), he('living.move.slide'), he('living.compute'), he('depth.horizon'), he('depth.near'), he('depth.far')]).toEqual(['התקרבות', 'גלישה הצידה', 'חישוב עומק', 'קו אופק', 'קרוב', 'רחוק']);
    expect(he('living.amountCapped', { max: 0.43 })).toBe('העוצמה הוגבלה ל־0.43 כי הקליפ קצר');
    for (const s of Object.values(LIVING_HE)) expect(/סיבוב עדין|הצצה|חשבו עומק/.test(s), s).toBe(false);
  });
  it('nothing is called safe, comfortable, good or checked; the Hebrew is plural', () => {
    for (const s of [...Object.values(LIVING_HE), ...Object.values(LIVING_EN)]) {
      expect(/\b(safe|comfortable|perfect|verified|AI)\b|בטוח|נוח|מושלם|בינה מלאכותית/i.test(s), s).toBe(false);
      expect(/(^|\s)(בחר|בחרי|לחץ|לחצי|צייר|ציירי|הסר|הסירי|גרור|גררי)(\s|$)/.test(s), s).toBe(false);
    }
  });
});

describe('living strings (integration): every key the surfaces ask for is in the i18n dictionary, and the reasons a living picture is not shown are worded', () => {
  it('every living./depth. key used by the editor surfaces is a dictionary key in both languages (no local strings)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(import.meta.dirname, '..');
    const files = [...fs.readdirSync(path.join(dir, 'living')).map((f) => path.join(dir, 'living', f)), path.join(dir, 'craft', 'PasteAttributesDialog.tsx'), path.join(dir, 'InspectorObject.tsx')].filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    const used = new Set<string>();
    for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\(\s*'((?:living|depth)\.[A-Za-z_.]+)'/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((k) => !Object.hasOwn(LIVING_HE, k) || !Object.hasOwn(LIVING_EN, k)).sort()).toEqual([]);
  });
  it('livingReasonText: each reason the compositor gives is said in the interface language, with the next step', async () => {
    const { LIVING_UNAVAILABLE_WHY } = await import('@pulseframe/engine');
    const { livingReasonText } = await import('./living.strings.ts');
    expect(livingReasonText(LIVING_UNAVAILABLE_WHY.no_provider, 'he')).toBe('אין כרטיס מסך זמין, ולכן התמונה החיה לא מוצגת. פתחו את העורך בדפדפן שתומך ב־WebGPU');
    expect(livingReasonText('the drawn depth could not be made: grid too large', 'he')).toBe('לא הצלחנו להכין את העומק שצויר, ולכן התמונה החיה לא מוצגת. ציירו את העומק שוב («ציירו עומק»)');
    expect(livingReasonText(LIVING_UNAVAILABLE_WHY.no_depth, 'he')).toBe(LIVING_HE['living.unavailable.no_depth']);
    expect(livingReasonText(LIVING_UNAVAILABLE_WHY.rotated, 'en')).toBe(LIVING_EN['living.unavailable.rotated']);
    expect(livingReasonText('colour table x was not supplied to this view', 'he')).toBe('colour table x was not supplied to this view'); // not a living reason: unchanged
  });
});
