/**
 * The reserved namespaces of the redesigned interface (ui.ts): the place of each one in this package, and every table a
 * worker declares in a `*.strings.ts` of the web app, are in step in Hebrew and English.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defineUiStrings, en, he, isUiStrings, UI_NAMESPACES, UI_NAMESPACE_SCOPE, UI_SHARED, uiStringProblems, uiText, type UiStrings } from './index.ts';

const web = path.resolve(import.meta.dirname, '../../../apps/web/src');
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.strings.ts') ? [path.join(dir, d.name)] : []));
/** Every table declared with defineUiStrings in the web app, with the file that declares it. */
async function workerTables(): Promise<{ file: string; name: string; table: UiStrings }[]> {
  const out: { file: string; name: string; table: UiStrings }[] = [];
  for (const file of walk(web)) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) if (isUiStrings(value)) out.push({ file: path.relative(web, file), name, table: value });
  }
  return out;
}

describe('reserved interface namespaces', () => {
  it('are the eight of the redesign, each described, each with a place in both languages', () => {
    expect([...UI_NAMESPACES]).toEqual(['ui.top', 'ui.rail', 'ui.tl', 'ui.insp', 'ui.gal', 'ui.ai', 'ui.export', 'ui.hub']);
    expect(Object.keys(UI_NAMESPACE_SCOPE).sort()).toEqual([...UI_NAMESPACES].sort());
    expect(Object.keys(UI_SHARED).sort()).toEqual([...UI_NAMESPACES].sort());
    for (const ns of UI_NAMESPACES) {
      const table = UI_SHARED[ns];
      expect(isUiStrings(table), ns).toBe(true);
      expect(table.ns).toBe(ns);
      expect(Object.keys(table.en).sort(), ns).toEqual(Object.keys(table.he).sort());
      expect(uiStringProblems(table), ns).toEqual([]);
    }
  });

  it('are kept out of the flat dictionaries: no key there starts with a reserved namespace', () => {
    for (const dict of [he, en]) expect(Object.keys(dict).filter((k) => k === 'ui' || k.startsWith('ui.'))).toEqual([]);
  });

  it('hold every table a worker declares in a *.strings.ts of the web app, and no full id is declared twice', async () => {
    const tables = await workerTables();
    const seen = new Map<string, string>();
    for (const ns of UI_NAMESPACES) for (const k of Object.keys(UI_SHARED[ns].he)) seen.set(`${ns}.${k}`, 'packages/i18n/src/ui.ts');
    const problems: string[] = [];
    for (const { file, name, table } of tables) {
      problems.push(...uiStringProblems(table).map((p) => `${file} ${name}: ${p}`));
      for (const k of Object.keys(table.he)) {
        const id = `${table.ns}.${k}`;
        if (seen.has(id)) problems.push(`${id} is declared in ${seen.get(id)} and again in ${file}`);
        seen.set(id, file);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('the check that keeps the two languages in step', () => {
  const good = defineUiStrings('ui.top', { saved: 'נשמר', 'undo.named': 'ביטול: {op}', moved: (n: number) => `${n} קליפים זזו`, times: '×', brand: 'PULSEFRAME' }, { saved: 'Saved', 'undo.named': 'Undo: {op}', moved: (n: number) => `${n} clips moved`, times: '×', brand: 'PULSEFRAME' }, { sameScript: ['brand'] });
  it('passes a table that is in step, and gives its text by language', () => {
    expect(uiStringProblems(good)).toEqual([]);
    expect(uiText(good, 'he').saved).toBe('נשמר');
    expect(uiText(good, 'en').saved).toBe('Saved');
    expect(uiText(good, 'he').moved(4)).toBe('4 קליפים זזו');
    expect(uiText(good, 'en').moved(4)).toBe('4 clips moved');
  });
  it('names each way a table can be out of step', () => {
    // built by hand, the way a table that skipped the types would be
    const broken = { ...good, ns: 'ui.nowhere', he: { saved: 'נשמר', onlyHebrew: 'רק כאן', empty: ' ', latin: 'Saved', copied: 'נשמר', filled: 'עוד {n}', fn: (a: number) => `${a}`, kind: 'טקסט', 'Bad Key': 'מפתח' }, en: { saved: 'Saved', onlyEnglish: 'Only here', empty: 'x', latin: 'Saved', copied: 'נשמר', filled: '{count} more', fn: (a: number, b: number) => `${a}${b}`, kind: (n: number) => `${n}`, 'Bad Key': 'Key' }, sameScript: ['missing'] } as unknown as UiStrings;
    expect(uiStringProblems(broken).sort()).toEqual([
      '"ui.nowhere" is not a reserved namespace',
      'ui.nowhere.Bad Key: a key is plain words joined by dots (camelCase parts)',
      'ui.nowhere.copied: the English text has Hebrew letters',
      'ui.nowhere.empty is empty in Hebrew',
      'ui.nowhere.filled fills in {n} in Hebrew and {count} in English',
      'ui.nowhere.fn takes 1 values in Hebrew and 2 in English',
      'ui.nowhere.kind is a string in Hebrew and a function in English',
      'ui.nowhere.latin: the Hebrew text has no Hebrew letters',
      'ui.nowhere.missing is listed in sameScript but is not a key',
      'ui.nowhere.onlyEnglish has no Hebrew text',
      'ui.nowhere.onlyHebrew has no English text',
    ].sort());
  });
  it('the types refuse an English table with a missing key, an extra key or other parameters', () => {
    // @ts-expect-error English lacks `saved`
    defineUiStrings('ui.rail', { saved: 'נשמר' }, {});
    // @ts-expect-error English has a key Hebrew does not
    defineUiStrings('ui.rail', { saved: 'נשמר' }, { saved: 'Saved', extra: 'Extra' });
    // @ts-expect-error a sentence built from a number is built from a number in English too
    defineUiStrings('ui.rail', { moved: (n: number) => `${n}` }, { moved: (s: { a: 1 }) => `${s.a}` });
    // @ts-expect-error not a reserved namespace
    defineUiStrings('ui.elsewhere', {}, {});
    expect(true).toBe(true);
  });
});
