/**
 * Lead contracts of the import cards and the phone drop dialog (ADR-0023): the strings modules cover both languages, the fixed
 * test ids are distinct, and the name cut that keeps the upload headers inside the server's limit. The components, the store
 * and the logic are W3's (imports.logic.test.ts and its component check).
 */
import { describe, expect, it } from 'vitest';
import { decodeUploadHeader, MAX_NAME_HEADER_BYTES } from '../../../server/src/importContracts.ts';
import { DROP_PAGE_TESTIDS } from '../../../server/src/drop-page/testids.ts';
import { cutUploadName } from './imports.api.ts';
import { IMPORTS_STRINGS } from './imports.strings.ts';
import { IMPORT_TESTIDS, PHONE_DROP_TESTIDS } from './imports.testids.ts';
import { PHONE_DROP_STRINGS } from './phoneDrop.strings.ts';

describe('strings', () => {
  for (const [name, table] of [['imports', IMPORTS_STRINGS], ['phoneDrop', PHONE_DROP_STRINGS]] as const)
    it(`${name}: the same keys in both languages, Hebrew in Hebrew, and the same placeholders`, () => {
      expect(Object.keys(table.en).sort()).toEqual(Object.keys(table.he).sort());
      for (const [k, v] of Object.entries(table.he)) {
        expect(/[֐-׿]/.test(v), k).toBe(true);
        const en = (table.en as Record<string, string>)[k]!;
        expect(en.trim(), k).not.toBe('');
        expect([...en.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...v.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
      }
    });
});

describe('test ids', () => {
  it('are distinct across the cards, the dialog and the phone page', () => {
    const flat = (o: Record<string, unknown>) => Object.values(o).map((v) => (typeof v === 'function' ? (v as (x: never) => string)('X' as never) : String(v)));
    const all = [...flat(IMPORT_TESTIDS), ...flat(PHONE_DROP_TESTIDS), ...flat(DROP_PAGE_TESTIDS)];
    expect(new Set(all).size).toBe(all.length);
    expect(IMPORT_TESTIDS.card('job_1')).toBe('import-card-job_1');
    expect(IMPORT_TESTIDS.fileInput).toBe('file-input'); // today's picker keeps its id
  });
});

describe('cutUploadName', () => {
  it('keeps short names and the extension of long ones; the encoded header then fits', () => {
    expect(cutUploadName('IMG_0001.MOV')).toBe('IMG_0001.MOV');
    const long = 'חתונה '.repeat(80) + '.mp4';
    const cut = cutUploadName(long);
    expect([...cut].length).toBe(256);
    expect(cut.endsWith('.mp4')).toBe(true);
    const header = encodeURIComponent(cut);
    expect(header.length).toBeLessThanOrEqual(MAX_NAME_HEADER_BYTES);
    expect(decodeUploadHeader(header)).toBe(cut);
    // a code point is never split (an emoji is two UTF-16 units)
    const emoji = cutUploadName('😀'.repeat(300), 256);
    expect([...emoji].length).toBe(256);
    expect(() => encodeURIComponent(emoji)).not.toThrow();
  });
});
