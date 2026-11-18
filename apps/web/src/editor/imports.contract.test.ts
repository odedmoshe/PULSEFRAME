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
    expect(emoji.length).toBeLessThanOrEqual(256);
    expect(() => encodeURIComponent(emoji)).not.toThrow();
  });
  // reviewer: the cut counted code points, so names of 3- and 4-byte characters and long Hebrew folder paths that were already
  // cut still went over the 2048-byte header and were refused (400 invalid_filename) instead of imported.
  const fits = (cut: string, what?: string) => {
    const header = encodeURIComponent(cut);
    expect(header.length).toBeLessThanOrEqual(MAX_NAME_HEADER_BYTES);
    expect(decodeUploadHeader(header, what)).toBe(cut);
  };
  it('a 256-character name of emoji (4 bytes each) is cut so its header fits, whole emoji only, the extension kept', () => {
    const cut = cutUploadName('😀'.repeat(300) + '.jpg');
    fits(cut);
    expect(cut.endsWith('.jpg')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(256); // what Asset.name (z.string().max(256), UTF-16 units) accepts
    expect(cut.slice(0, -4)).toBe('😀'.repeat((cut.length - 4) / 2));
  });
  it('a long CJK name (3 bytes each) is cut so its header fits', () => {
    const cut = cutUploadName('写真'.repeat(200) + '.HEIC');
    fits(cut);
    expect(cut.endsWith('.HEIC')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(256);
  });
  it('a long Hebrew folder path is cut to 512 characters and to the header limit', () => {
    const path = 'תיקייה של המשפחה/'.repeat(24) + 'IMG_0001.jpg';
    const cut = cutUploadName(path, 512);
    fits(cut, 'folder path');
    expect(cut.endsWith('.jpg')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(512); // UploadProvenanceSchema.relativePath max(512)
    expect(path.startsWith(cut.slice(0, -4))).toBe(true);
    // an ASCII path is cut to 512 characters too (the schema's limit; the header would allow 2048)
    const ascii = cutUploadName('a/'.repeat(400) + 'IMG_0001.jpg', 512);
    expect(ascii.length).toBe(512);
    expect(ascii.endsWith('.jpg')).toBe(true);
  });
  it('the cut uses the whole budget: a name just inside both limits is kept as it is', () => {
    const name = 'א'.repeat(337) + '.mp4'; // 337 × 6 + 4 = 2026 bytes encoded, 341 characters
    expect(cutUploadName(name, 512)).toBe(name);
    const over = 'א'.repeat(341) + '.mp4'; // 2050 bytes
    const cut = cutUploadName(over, 512);
    fits(cut);
    expect(cut).toBe('א'.repeat(340) + '.mp4');
  });
  it('a name holding a lone surrogate (invalid UTF-16 from a file system) still encodes', () => {
    const cut = cutUploadName('IMG\uD800_1.jpg');
    expect(cut).toBe('IMG\uFFFD_1.jpg');
    fits(cut);
  });
});
