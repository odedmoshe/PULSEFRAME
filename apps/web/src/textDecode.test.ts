import { describe, expect, it } from 'vitest';
import { decodeTextFile } from './textDecode.ts';

const HEB = '1\n00:00:01,000 --> 00:00:02,000\nשלום עולם, מה נשמע?\n';
const cp1255 = (s: string) => Uint8Array.from([...s].map((ch) => { const c = ch.codePointAt(0)!; return c >= 0x05d0 && c <= 0x05ea ? c - 0x05d0 + 0xe0 : c; }));
const utf16 = (s: string, le: boolean, bom: boolean) => { const out: number[] = bom ? (le ? [0xff, 0xfe] : [0xfe, 0xff]) : []; for (const ch of s) { const c = ch.charCodeAt(0); out.push(...(le ? [c & 255, c >> 8] : [c >> 8, c & 255])); } return Uint8Array.from(out); };

describe('decoding subtitle and transcript files of unknown encoding', () => {
  it('UTF-8 with and without a byte-order mark is taken as is', () => {
    const plain = new TextEncoder().encode(HEB);
    expect(decodeTextFile(plain)).toEqual({ text: HEB, encoding: 'utf-8', guessed: false });
    const marked = decodeTextFile(Uint8Array.from([0xef, 0xbb, 0xbf, ...plain]));
    expect(marked.text.replace(/^﻿/, '')).toBe(HEB);
    expect(marked).toMatchObject({ encoding: 'utf-8', guessed: false });
    expect(decodeTextFile(new TextEncoder().encode('plain ascii'))).toEqual({ text: 'plain ascii', encoding: 'utf-8', guessed: false });
  });
  it('UTF-16 in either byte order, with a mark (certain) or without one (guessed)', () => {
    for (const le of [true, false]) {
      const marked = decodeTextFile(utf16(HEB, le, true));
      expect(marked.text.replace(/^﻿/, '')).toBe(HEB);
      expect(marked).toMatchObject({ encoding: le ? 'utf-16le' : 'utf-16be', guessed: false });
      expect(decodeTextFile(utf16('1\n00:00:01,000 --> 00:00:02,000\nHello there, world\n', le, false))).toEqual({ text: '1\n00:00:01,000 --> 00:00:02,000\nHello there, world\n', encoding: le ? 'utf-16le' : 'utf-16be', guessed: true });
    }
  });
  it('a Hebrew file saved as Windows-1255 is read as Hebrew, and flagged as a guess', () => {
    expect(decodeTextFile(cp1255(HEB))).toEqual({ text: HEB, encoding: 'windows-1255', guessed: true });
  });
  it('a Western European legacy file (accented Latin) is read as Windows-1252, not as Hebrew', () => {
    const bytes = Uint8Array.from([...'Caf'].map((c) => c.charCodeAt(0)).concat([0xe9, 0x20, 0x66, 0x72, 0x61, 0x6e, 0xe7, 0x61, 0x69, 0x73, 0x20, 0x96, 0x20, 0x6e, 0x61, 0xef, 0x66]));
    const r = decodeTextFile(bytes);
    expect(r.text).toBe('Café français – naïf');
    expect(r).toMatchObject({ encoding: 'windows-1252', guessed: true });
  });
  it('an empty file is empty UTF-8', () => {
    expect(decodeTextFile(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8', guessed: false });
  });
});
