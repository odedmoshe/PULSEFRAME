/**
 * Reading capture dates from uploaded files (life line, ADR-0021): container tags, a JPEG's EXIF and file-name patterns.
 * The files are made here, at test time (ffmpeg -metadata, a hand-built EXIF segment); nothing binary is committed.
 * The bytes are untrusted, so most of this file is about what must NOT happen: no throw, no read outside the EXIF segment,
 * no date from a dead clock, no location anywhere.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CaptureSchema, type Capture } from '@pulseframe/core';
import { generateBarcodeFixture, mulberry32 } from '../../../packages/fixtures/src/index.ts';
import { HEAD_BYTES, captureFromExif, captureFromFileName, captureFromTags, isMessagingAppName, readCapture, wallInZone, type CaptureContext } from './captureMeta.ts';
import { PLACE_PHOTO, PLACE_VIDEO, SOI, exifSegment, exifTiff, jpegHead, jpegSegment, placeLeak, withExif, type ExifOptions } from './captureMeta.fixtures.ts';
import { ingestUpload, jpegOrientation } from './ingest.ts';
import { Store } from './store.ts';

const cx: CaptureContext = { homeZone: 'Asia/Jerusalem', now: new Date('2026-11-17T10:00:00Z') };
const utc = (iso: string) => Date.parse(iso);

const tiff = exifTiff, segment = jpegSegment, app1 = exifSegment;
const exif = (at: string, utcOffsetMinutes: number | null = null): Capture => ({ at, utcOffsetMinutes, source: 'exif' });

describe('wallInZone: the one time-zone conversion of the life line (import only)', () => {
  it('the same UTC hour is 17:30 in a Jerusalem winter and 18:30 in a Jerusalem summer', () => {
    expect(wallInZone(utc('2024-12-25T15:30:00Z'), 'Asia/Jerusalem')).toBe('2024-12-25T17:30:00');
    expect(wallInZone(utc('2024-07-01T15:30:00Z'), 'Asia/Jerusalem')).toBe('2024-07-01T18:30:00');
  });
  it('crosses midnight, month and year ends, and follows each zone\'s own rules', () => {
    expect(wallInZone(utc('2024-12-31T22:30:00Z'), 'Asia/Jerusalem')).toBe('2025-01-01T00:30:00');
    expect(wallInZone(utc('2024-03-01T00:00:00Z'), 'America/Los_Angeles')).toBe('2024-02-29T16:00:00');
    expect(wallInZone(utc('2024-06-15T12:00:00Z'), 'Europe/London')).toBe('2024-06-15T13:00:00');
    expect(wallInZone(utc('2024-06-15T12:00:00Z'), 'UTC')).toBe('2024-06-15T12:00:00');
    expect(wallInZone(utc('2024-06-15T23:59:59Z'), 'Asia/Kolkata')).toBe('2024-06-16T05:29:59');
    // the hour the clock goes back in Israel (27 October 2024, 02:00 summer time = 01:00 winter time)
    expect(wallInZone(utc('2024-10-26T22:59:59Z'), 'Asia/Jerusalem')).toBe('2024-10-27T01:59:59');
    expect(wallInZone(utc('2024-10-26T23:00:00Z'), 'Asia/Jerusalem')).toBe('2024-10-27T01:00:00');
  });
  it('always answers in the stored form, and refuses a zone it does not know or a value that is not an instant', () => {
    for (const ms of [0, utc('1999-12-31T23:59:59Z'), utc('2038-01-19T03:14:08Z'), utc('0999-06-01T00:00:00Z')]) expect(wallInZone(ms, 'Asia/Jerusalem')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(() => wallInZone(0, 'Mars/Olympus')).toThrow(RangeError);
    expect(() => wallInZone(NaN, 'UTC')).toThrow(RangeError);
    expect(() => wallInZone(Infinity, 'UTC')).toThrow(RangeError);
    expect(() => wallInZone(utc('2024-01-01T00:00:00Z') - 1e14, 'UTC')).toThrow(RangeError); // before the year 1
  });
});

describe('captureFromTags: the container\'s own tags', () => {
  it('Apple\'s creation date gives the wall clock where it was filmed and its offset, in each way the offset is written', () => {
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2024-12-25T17:30:00+0200' }, cx)).toEqual({ at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' });
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2024-07-01T18:30:00+03:00' }, cx)).toEqual({ at: '2024-07-01T18:30:00', utcOffsetMinutes: 180, source: 'container' });
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2023-08-10T09:05:07-0700' }, cx)).toEqual({ at: '2023-08-10T09:05:07', utcOffsetMinutes: -420, source: 'container' });
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2023-08-10T09:05:07.250+0530' }, cx)).toEqual({ at: '2023-08-10T09:05:07', utcOffsetMinutes: 330, source: 'container' });
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2023-08-10T09:05:07Z' }, cx)).toEqual({ at: '2023-08-10T09:05:07', utcOffsetMinutes: 0, source: 'container' });
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2023-08-10T09:05:07' }, cx)).toEqual({ at: '2023-08-10T09:05:07', utcOffsetMinutes: null, source: 'container' });
    expect(captureFromTags({ 'COM.APPLE.QUICKTIME.CREATIONDATE': '2023-08-10T09:05:07+0300' }, cx)?.utcOffsetMinutes).toBe(180);
  });
  it('the container\'s creation time is a UTC instant: shown on the home zone\'s wall clock, the zone recorded as assumed, in both spellings ffprobe prints', () => {
    const winter = { at: '2024-12-25T17:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' };
    expect(captureFromTags({ creation_time: '2024-12-25T15:30:00.000000Z' }, cx)).toEqual(winter);
    expect(captureFromTags({ creation_time: '2024-12-25T15:30:00Z' }, cx)).toEqual(winter);
    expect(captureFromTags({ creation_time: '2024-12-25 15:30:00' }, cx)).toEqual(winter);
    expect(captureFromTags({ creation_time: '2024-07-01T15:30:00.000000Z' }, cx)).toEqual({ ...winter, at: '2024-07-01T18:30:00' });
    expect(captureFromTags({ creation_time: '2024-07-01T15:30:00Z' }, { ...cx, homeZone: 'Europe/London' })).toEqual({ at: '2024-07-01T16:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Europe/London' });
  });
  it('Apple\'s date wins over the creation time; an Apple date that cannot be trusted falls back to it', () => {
    const both = { 'com.apple.quicktime.creationdate': '2024-07-01T18:30:00+0300', creation_time: '2024-07-02T09:00:00Z' };
    expect(captureFromTags(both, cx)).toEqual({ at: '2024-07-01T18:30:00', utcOffsetMinutes: 180, source: 'container' });
    for (const bad of ['2024-07-01T18:30:00+2500', '2024-07-01T18:30:00+0275', '2024-02-30T18:30:00+0200', '1970-01-01T00:00:00+0000', 'yesterday', ''])
      expect(captureFromTags({ ...both, 'com.apple.quicktime.creationdate': bad }, cx), bad).toMatchObject({ at: '2024-07-02T12:00:00', assumedZone: 'Asia/Jerusalem' });
  });
  it('a clock that was never set is not a date: 1904, 1970, 2000-01-01 00:00:00 exactly, anything before 1995, a day that does not exist', () => {
    for (const t of ['1904-01-01T00:00:00.000000Z', '1970-01-01T00:00:00Z', '1970-01-01T00:00:00.000000Z', '2000-01-01T00:00:00.000000Z', '1994-12-31T23:59:59Z', '2024-02-30T10:00:00Z', '2024-13-01T10:00:00Z', '2024-06-31T10:00:00Z', '2024-01-01T24:00:00Z', '0000-00-00T00:00:00Z'])
      expect(captureFromTags({ creation_time: t }, cx), t).toBeNull();
    // one second later is a moment like any other; and midnight on the home clock at the turn of 2000 is not the zero of a clock
    expect(captureFromTags({ creation_time: '2000-01-01T00:00:01Z' }, cx)?.at).toBe('2000-01-01T02:00:01');
    expect(captureFromTags({ creation_time: '1999-12-31T22:00:00Z' }, cx)?.at).toBe('2000-01-01T00:00:00');
    expect(captureFromTags({ creation_time: '1995-01-01T00:00:00Z' }, cx)?.at).toBe('1995-01-01T02:00:00');
  });
  it('a date more than 48 hours after the import is a wrong clock; up to 48 hours is kept (time zones, a clock a little fast)', () => {
    expect(captureFromTags({ creation_time: '2026-11-19T09:59:00Z' }, cx)?.at).toBe('2026-11-19T11:59:00');
    expect(captureFromTags({ creation_time: '2026-11-19T10:00:01Z' }, cx)).toBeNull();
    expect(captureFromTags({ creation_time: '2031-05-05T10:00:00Z' }, cx)).toBeNull();
    // with the file's own offset the comparison is exact: 48 hours after 10:00 UTC is 22:00 at +12:00
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2026-11-19T22:00:00+1200' }, cx)?.at).toBe('2026-11-19T22:00:00');
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2026-11-19T22:00:01+1200' }, cx)).toBeNull();
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2026-11-19T22:00:01-1100' }, cx)).toBeNull();
  });
  it('hostile tags: wrong types, long values, names of Object.prototype, an unknown home zone, a broken import time. Never a throw', () => {
    const long = `2024-12-25T15:30:00Z${' '.repeat(100_000)}`;
    const proto = Object.create({ creation_time: '2024-12-25T15:30:00Z', 'com.apple.quicktime.creationdate': '2024-12-25T17:30:00+0200' }) as Record<string, unknown>;
    const cases: unknown[] = [undefined, null, 'creation_time', 42, [], [{ creation_time: '2024-12-25T15:30:00Z' }], {}, proto, { creation_time: 20241225 }, { creation_time: null }, { creation_time: ['2024-12-25T15:30:00Z'] }, { creation_time: { toString: () => '2024-12-25T15:30:00Z' } },
      { creation_time: long }, { creation_time: '2024-12-25T15:30:00Z\n2024-12-26T15:30:00Z' }, { creation_time: '٢٠٢٤-١٢-٢٥T15:30:00Z' }, { creation_time: '2024-12-25T15:30:00+02:00' }, { 'com.apple.quicktime.creationdate': `${'9'.repeat(60)}` }, { __proto__: null, constructor: 'x', toString: 'y' }];
    for (const c of cases) expect(captureFromTags(c as never, cx), JSON.stringify(c)?.slice(0, 60)).toBeNull();
    expect(captureFromTags({ creation_time: '2024-12-25T15:30:00Z' }, { ...cx, homeZone: 'Mars/Olympus' })).toBeNull();
    expect(captureFromTags({ creation_time: '2024-12-25T15:30:00Z' }, { ...cx, homeZone: '' })).toBeNull();
    // an Apple date needs no zone, and a broken import time only switches the "in the future" check off
    expect(captureFromTags({ 'com.apple.quicktime.creationdate': '2024-12-25T17:30:00+0200' }, { homeZone: 'Mars/Olympus', now: new Date(NaN) })).toEqual({ at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' });
    expect(captureFromTags({ creation_time: '2024-12-25T15:30:00Z' }, { homeZone: 'Asia/Jerusalem', now: 'now' as never })?.at).toBe('2024-12-25T17:30:00');
    // a tag table with very many names is not walked to its end
    const many: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) many[`tag_${i}`] = 'x';
    expect(captureFromTags({ ...many, CREATION_TIME: '2024-12-25T15:30:00Z' }, cx)).toBeNull();
    expect(captureFromTags({ ...many, creation_time: '2024-12-25T15:30:00Z' }, cx)?.at).toBe('2024-12-25T17:30:00');
  });
  it('only the two date tags are read: a location beside them changes nothing and appears nowhere', () => {
    const tags = { creation_time: '2024-12-25T15:30:00Z', location: '+32.0853+034.7818/', 'location-eng': '+32.0853+034.7818/', 'com.apple.quicktime.location.ISO6709': '+32.0853+034.7818+040.000/', 'com.apple.quicktime.make': 'Apple' };
    const c = captureFromTags(tags, cx)!;
    expect(c).toEqual(captureFromTags({ creation_time: '2024-12-25T15:30:00Z' }, cx));
    expect(Object.keys(c).sort()).toEqual(['assumedZone', 'at', 'source', 'utcOffsetMinutes']);
    expect(JSON.stringify(c)).not.toMatch(/32\.08|34\.78|ISO6709|location/i);
  });
});

describe('captureFromExif: a JPEG\'s DateTimeOriginal, through the Exif sub-IFD', () => {
  it('reads the date in both byte orders, with and without the offset tag', () => {
    for (const le of [true, false]) {
      expect(captureFromExif(jpegHead({ le })), `le=${le}`).toEqual(exif('2024-12-25T17:30:05'));
      expect(captureFromExif(jpegHead({ le, offset: '+02:00' })), `le=${le}`).toEqual(exif('2024-12-25T17:30:05', 120));
      expect(captureFromExif(jpegHead({ le, date: '2019:07:04 08:00:00', offset: '-07:00' })), `le=${le}`).toEqual(exif('2019-07-04T08:00:00', -420));
      expect(captureFromExif(jpegHead({ le, offset: '+05:45' })), `le=${le}`).toEqual(exif('2024-12-25T17:30:05', 345));
    }
  });
  it('the orientation walker of the import still reads the same file (it is not changed by this reader)', () => {
    const file = path.join(os.tmpdir(), `pf-exif-${process.pid}.jpg`);
    try {
      fs.writeFileSync(file, jpegHead({ orientation: 6 }));
      expect(jpegOrientation(file)).toBe(6);
      fs.writeFileSync(file, jpegHead({ le: false, orientation: 8 }));
      expect(jpegOrientation(file)).toBe(8);
    } finally { fs.rmSync(file, { force: true }); }
  });
  it('finds the EXIF segment after other segments (JFIF, a comment, an XMP segment, fill bytes) and ignores everything after the picture data starts', () => {
    const jfif = segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
    const xmp = segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta DateTimeOriginal="1999-01-01T00:00:00"/>', 'latin1'));
    const comment = segment(0xfe, Buffer.from('2001:01:01 01:01:01'));
    expect(captureFromExif(jpegHead({}, [jfif, xmp, comment]))).toEqual(exif('2024-12-25T17:30:05'));
    expect(captureFromExif(jpegHead({}, [jfif, Buffer.from([0xff, 0xff, 0xff])]))).toEqual(exif('2024-12-25T17:30:05'));
    expect(captureFromExif(Buffer.concat([SOI, Buffer.from([0xff, 0xda, 0, 2]), app1(tiff())]))).toBeNull();
    expect(captureFromExif(Buffer.concat([SOI, Buffer.from([0xff, 0xd9]), app1(tiff())]))).toBeNull();
    expect(captureFromExif(Buffer.concat([SOI, xmp, Buffer.from([0xff, 0xda, 0, 2])]))).toBeNull();
    // only so many segments are walked, however many a file strings together
    expect(captureFromExif(jpegHead({}, Array.from({ length: 200 }, () => comment)))).toBeNull();
  });
  it('accepts the separators some software writes, and refuses a date that is not one', () => {
    expect(captureFromExif(jpegHead({ date: '2024-12-25 17:30:05' }))).toEqual(exif('2024-12-25T17:30:05'));
    expect(captureFromExif(jpegHead({ date: '2024:12:25T17:30:05' }))).toEqual(exif('2024-12-25T17:30:05'));
    for (const date of ['0000:00:00 00:00:00', '    :  :     :  :  ', '2024:02:30 10:00:00', '2024:13:01 10:00:00', '2024:12:25 24:00:00', '2024:12:25 17:60:00', '1970:01:01 00:00:00', '2000:01:01 00:00:00', '1994:06:01 12:00:00', '2101:01:01 00:00:00', '24:12:25 17:30:05   ', 'not a date at all  ', '', null])
      expect(captureFromExif(jpegHead({ date })), String(date)).toBeNull();
    // an offset no clock has is dropped; the date stays
    for (const offset of ['+15:00', '+02:75', 'Z     ', '02:00 ', '      ']) expect(captureFromExif(jpegHead({ offset })), offset).toEqual(exif('2024-12-25T17:30:05'));
    expect(captureFromExif(jpegHead({ offset: '+14:00' }))).toEqual(exif('2024-12-25T17:30:05', 840));
    expect(captureFromExif(jpegHead({ offset: '-00:00' }))).toEqual(exif('2024-12-25T17:30:05', 0));
  });
  it('cut off at every length, the file gives the date or nothing, and never throws', () => {
    for (const le of [true, false]) {
      const full = jpegHead({ le, offset: '+02:00', gps: true });
      const want = exif('2024-12-25T17:30:05', 120);
      let dated = 0;
      for (let n = 0; n <= full.length; n++) {
        const got = captureFromExif(full.subarray(0, n));
        // a cut can lose the date, or the offset that follows it in the file, but never invents another value
        if (got !== null) { dated++; expect([want, { ...want, utcOffsetMinutes: null }], `cut at ${n}`).toContainEqual(got); }
      }
      expect(dated).toBeGreaterThan(0);
      expect(captureFromExif(full)).toEqual(want);
    }
  });
  it('hostile pointers and counts: outside the segment, into the header, onto itself, huge. Nothing is read outside the EXIF segment', () => {
    const hostile: ExifOptions[] = [
      { exifPointer: 0xffffffff }, { exifPointer: 0x7fffffff }, { exifPointer: 303 }, { exifPointer: 304 }, { exifPointer: 0 }, { exifPointer: 4 }, { exifPointer: 8 /* IFD0 again: it holds no date */ },
      { dateOffset: 0xffffffff }, { dateOffset: 0xfffffff0 }, { dateOffset: 300 }, { dateOffset: 285 }, { dateOffset: 0 }, { dateOffset: 2 },
      { dateCount: 0 }, { dateCount: 0xffffffff }, { dateCount: 65 }, { dateCount: 3 }, { dateType: 7 }, { dateType: 4 },
      { ifd0Count: 0 }, { exifCount: 0 }, { magic: 43 }, { magic: 0 },
    ];
    for (const le of [true, false]) for (const o of hostile) expect(captureFromExif(jpegHead({ ...o, le })), JSON.stringify(o)).toBeNull();
    // counts larger than the table: the entries that are there are still found, and the walk stops at the end of the segment
    expect(captureFromExif(jpegHead({ ifd0Count: 0xffff, exifCount: 0xffff }))).toEqual(exif('2024-12-25T17:30:05'));
    // a date placed AFTER the segment, where a careless reader would find it: the pointer is refused, not followed
    const t = tiff({ dateOffset: 304 });
    const beyond = Buffer.concat([SOI, app1(t), Buffer.from('2011:11:11 11:11:11\0', 'latin1'), Buffer.from([0xff, 0xda, 0, 2])]);
    expect(captureFromExif(beyond)).toBeNull();
    // a segment that says it is longer than the file
    const lying = Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0xff, 0xff]), Buffer.from('Exif\0\0', 'latin1'), tiff()]);
    expect(captureFromExif(lying)).toEqual(exif('2024-12-25T17:30:05'));
    expect(captureFromExif(Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0, 1]), Buffer.from('Exif\0\0', 'latin1'), tiff()]))).toBeNull(); // a length below 2
    expect(captureFromExif(Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0, 8]), Buffer.from('Exif\0\0', 'latin1'), tiff()]))).toBeNull(); // an empty EXIF segment
  });
  it('things that are not a JPEG with EXIF give nothing', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), tiff()]);
    for (const b of [Buffer.alloc(0), Buffer.from([0xff]), SOI, Buffer.from([0xff, 0xd8, 0xff]), png, tiff(), app1(tiff()), Buffer.alloc(4096), Buffer.alloc(4096, 0xff), Buffer.from('Exif\0\0II*\0', 'latin1')])
      expect(captureFromExif(b)).toBeNull();
    for (const b of [undefined, null, 'ÿØÿá', 12, {}, new Uint8Array([0xff, 0xd8, 0xff, 0xe1])]) expect(captureFromExif(b as never)).toBeNull();
    // an EXIF segment that starts beyond what is read from a file is not looked at
    const far = Buffer.concat([SOI, ...Array.from({ length: 9 }, () => segment(0xe2, Buffer.alloc(65000))), app1(tiff()), Buffer.from([0xff, 0xda, 0, 2])]);
    expect(far.length).toBeGreaterThan(HEAD_BYTES);
    expect(captureFromExif(far)).toBeNull();
  });
  it('random damage (4000 files, a fixed seed): never a throw, and whatever comes back is a capture the project can store', () => {
    const rnd = mulberry32(20261117);
    const clean = [jpegHead({ offset: '+02:00', gps: true }), jpegHead({ le: false, offset: '+03:00' })];
    let dated = 0;
    for (let i = 0; i < 4000; i++) {
      const b = Buffer.from(clean[i % 2]!);
      const hits = 1 + Math.floor(rnd() * 6);
      for (let k = 0; k < hits; k++) {
        const at = Math.floor(rnd() * b.length);
        // bytes, and whole 32-bit fields set to the values that break careless arithmetic
        if (rnd() < 0.7) b[at] = Math.floor(rnd() * 256);
        else if (at + 4 <= b.length) b.writeUInt32LE([0, 0xffffffff, 0x7fffffff, 0x80000000, b.length, b.length - 1][Math.floor(rnd() * 6)]!, at);
      }
      const got = captureFromExif(rnd() < 0.2 ? b.subarray(0, Math.floor(rnd() * b.length)) : b);
      if (got) { dated++; expect(CaptureSchema.safeParse(got).success, `file ${i}`).toBe(true); expect(got.source).toBe('exif'); expect(Object.keys(got).sort()).toEqual(['at', 'source', 'utcOffsetMinutes']); }
    }
    expect(dated).toBeGreaterThan(100); // most damage misses the date: the reader still reads those files
  });
  it('the GPS block of the same file is never followed: no coordinate reaches the result', () => {
    const got = captureFromExif(jpegHead({ gps: true, offset: '+02:00' }))!;
    expect(got).toEqual(exif('2024-12-25T17:30:05', 120));
    expect(JSON.stringify(got)).not.toMatch(/32|711|5445|gps|lat|lon/i);
  });
});

describe('captureFromFileName: an estimate, always marked as one', () => {
  const name = (at: string, extra: Partial<Capture> = {}): Capture => ({ at, utcOffsetMinutes: null, source: 'filename', circa: true, ...extra });
  it('camera names give the day and the time on the phone\'s own clock', () => {
    expect(captureFromFileName('IMG_20240315_181500.jpg', cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName('VID_20240315_181500.mp4', cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName('MVIMG_20190704_080001.jpg', cx)).toEqual(name('2019-07-04T08:00:01'));
    expect(captureFromFileName('20240315_181500.mp4', cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName('20240315_181500(1).mp4', cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName('img_20240315_181500_HDR.JPG', cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName('/sdcard/DCIM/Camera/VID_20240315_181500.mp4', cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName('C:\\Users\\me\\IMG_20240315_181500.jpg', cx)).toEqual(name('2024-03-15T18:15:00'));
  });
  it('a Pixel names its files by the UTC clock: shown on the home zone\'s wall clock, the zone recorded as assumed', () => {
    expect(captureFromFileName('PXL_20241225_153000123.mp4', cx)).toEqual(name('2024-12-25T17:30:00', { assumedZone: 'Asia/Jerusalem' }));
    expect(captureFromFileName('PXL_20240701_153000999.MP.jpg', cx)).toEqual(name('2024-07-01T18:30:00', { assumedZone: 'Asia/Jerusalem' }));
    expect(captureFromFileName('PXL_20241231_223000000.mp4', cx)).toEqual(name('2025-01-01T00:30:00', { assumedZone: 'Asia/Jerusalem' }));
    expect(captureFromFileName('PXL_20241225_153000123.mp4', { ...cx, homeZone: 'Mars/Olympus' })).toBeNull();
  });
  it('messaging-app names give the day they were saved or sent: day only for -WAnnnn, with the time for "WhatsApp Video … at …"', () => {
    expect(captureFromFileName('VID-20240315-WA0007.mp4', cx)).toEqual(name('2024-03-15'));
    expect(captureFromFileName('IMG-20241225-WA0001.jpg', cx)).toEqual(name('2024-12-25'));
    expect(captureFromFileName('AUD-20230101-WA0123.opus', cx)).toEqual(name('2023-01-01'));
    expect(captureFromFileName('PTT-20230101-WA0002.opus', cx)).toEqual(name('2023-01-01'));
    expect(captureFromFileName('WhatsApp Video 2024-03-15 at 18.15.00.mp4', cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName('WhatsApp Image 2024-03-15 at 06.05.09 (1).jpeg', cx)).toEqual(name('2024-03-15T06:05:09'));
    expect(captureFromFileName('WhatsApp Image 2024-03-15 at 6.15.00 PM.jpeg', cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName('WhatsApp Image 2024-03-15 at 12.15.00 AM.jpeg', cx)).toEqual(name('2024-03-15T00:15:00'));
    expect(captureFromFileName('WhatsApp Image 2024-03-15 at 12.15.00 PM.jpeg', cx)).toEqual(name('2024-03-15T12:15:00'));
    for (const n of ['VID-20240315-WA0007.mp4', 'img-20241225-wa0001.jpg', 'AUD-20230101-WA0123.opus', 'PTT-20230101-WA0002.opus', 'WhatsApp Video 2024-03-15 at 18.15.00.mp4', 'WhatsApp Image 2024-03-15 at 6.15.00 PM.jpeg', 'folder/VID-20240315-WA0007.mp4'])
      expect(isMessagingAppName(n), n).toBe(true);
    for (const n of ['IMG_20240315_181500.jpg', 'PXL_20241225_153000123.mp4', 'holiday.mp4', 'my WhatsApp Video.mp4', 'VID-20240315.mp4', 'WhatsApplication.mp4', '', 'WA0007.mp4'])
      expect(isMessagingAppName(n), n).toBe(false);
    expect(isMessagingAppName(undefined as never)).toBe(false);
  });
  it('names that only look like a date, dead clocks and the future give nothing', () => {
    for (const n of ['holiday.mp4', 'IMG_1234.JPG', 'IMG_1234.HEIC', 'DSC00012.jpg', 'video 2024.mp4', '2024-03-15.mp4', 'IMG_20240230_101010.jpg', 'IMG_20241301_101010.jpg', 'IMG_20240315_246000.jpg', 'IMG_19700101_000000.jpg', 'IMG_20000101_000000.jpg',
      'VID_19940101_120000.mp4', 'VID-20240230-WA0001.mp4', 'VID-19800101-WA0001.mp4', 'IMG_20270101_101010.jpg', 'VID-20261125-WA0001.mp4', 'xIMG_20240315_181500.jpg', 'IMG_202403151_81500.jpg', '202403151815001234.mp4', 'IMG_20240315_1815001.jpg',
      'WhatsApp Image 2024-03-15 at 13.15.00 PM.jpeg', 'WhatsApp Image 2024-03-15 at 0.15.00 AM.jpeg', 'WhatsApp Image 2024-03-15 at 25.15.00.jpeg', 'Screenshot_20240315-181500.png', '', '.', '.mp4'])
      expect(captureFromFileName(n, cx), n).toBeNull();
    for (const n of [undefined, null, 42, {}, ['IMG_20240315_181500.jpg']]) expect(captureFromFileName(n as never, cx)).toBeNull();
    // the day after the import is within the 48 hours; three days after is not
    expect(captureFromFileName('VID-20261118-WA0001.mp4', cx)).toEqual(name('2026-11-18'));
    expect(captureFromFileName('VID-20261120-WA0001.mp4', cx)).toBeNull();
  });
  it('a very long or strange name is cut before it is looked at, and never throws', () => {
    expect(captureFromFileName(`IMG_20240315_181500${'_x'.repeat(200_000)}.jpg`, cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName(`${'a/'.repeat(100_000)}IMG_20240315_181500.jpg`, cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName(`${'9'.repeat(300_000)}`, cx)).toBeNull();
    expect(captureFromFileName('IMG_20240315_181500\n.jpg\0', cx)).toEqual(name('2024-03-15T18:15:00'));
    expect(captureFromFileName('IMG_٢٠٢٤٠٣١٥_181500.jpg', cx)).toBeNull();
  });
});

describe('readCapture: files made here with ffmpeg and a hand-built EXIF segment', () => {
  let dir: string, store: Store, base: string, picture: Buffer;
  const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
  const tagged = (name: string, meta: string[], extra: string[] = []) => { const out = path.join(dir, name); ff(['-i', base, '-c', 'copy', ...extra, ...meta.flatMap((m) => ['-metadata', m]), out]); return out; };
  const upload = (file: string, name = path.basename(file)) => ingestUpload(store, Readable.toWeb(fs.createReadStream(file)) as any, name, 'test', 1 << 30, cx);
  const write = (name: string, bytes: Buffer) => { const out = path.join(dir, name); fs.writeFileSync(out, bytes); return out; };
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-capture-'));
    store = new Store(path.join(dir, 'data'));
    base = path.join(dir, 'plain.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30', '-t', '0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bitexact', '-map_metadata', '-1', base]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x336699:size=64x48', '-frames:v', '1', path.join(dir, 'picture.jpg')]);
    picture = fs.readFileSync(path.join(dir, 'picture.jpg'));
  }, 60_000);
  afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('eight shapes of file, each with the date it must get (and one UTC hour as 17:30 in winter and 18:30 in summer)', async () => {
    const shapes: [string, string, Capture | null][] = [
      ['container creation time, winter', tagged('winter.mp4', ['creation_time=2024-12-25T15:30:00Z']), { at: '2024-12-25T17:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' }],
      ['container creation time, summer', tagged('summer.mp4', ['creation_time=2024-07-01T15:30:00Z']), { at: '2024-07-01T18:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' }],
      ['Apple creation date in a .mov, beside a creation time', tagged('apple.mov', ['com.apple.quicktime.creationdate=2024-07-01T18:30:00+0300', 'creation_time=2024-07-02T09:00:00Z'], ['-movflags', 'use_metadata_tags']), { at: '2024-07-01T18:30:00', utcOffsetMinutes: 180, source: 'container' }],
      ['Apple creation date in an .mp4', tagged('apple.mp4', ['com.apple.quicktime.creationdate=2023-08-10T09:05:07-0700'], ['-movflags', 'use_metadata_tags']), { at: '2023-08-10T09:05:07', utcOffsetMinutes: -420, source: 'container' }],
      ['JPEG with EXIF, little-endian, with the offset', write('le.jpg', withExif(picture, { offset: '+02:00' })), exif('2024-12-25T17:30:05', 120)],
      ['JPEG with EXIF, big-endian, without the offset', write('be.jpg', withExif(picture, { le: false, date: '2019:07:04 08:00:00' })), exif('2019-07-04T08:00:00')],
      ['no date inside, a camera name', write('VID_20240315_181500.mp4', fs.readFileSync(base)), { at: '2024-03-15T18:15:00', utcOffsetMinutes: null, source: 'filename', circa: true }],
      ['no date inside, a messaging-app name', write('IMG-20241225-WA0001.jpg', picture), { at: '2024-12-25', utcOffsetMinutes: null, source: 'filename', circa: true }],
    ];
    for (const [what, file, want] of shapes) {
      expect(await readCapture(file, path.basename(file), cx), what).toEqual(want);
      // through the import, the asset carries exactly that
      expect((await upload(file)).capture, `${what} (import)`).toEqual(want ?? undefined);
    }
  }, 120_000);
  it('a file with no date inside and an ordinary name has no date, and its import is what it was', async () => {
    expect(await readCapture(base, 'holiday.mp4', cx)).toBeNull();
    const a = await upload(base, 'holiday.mp4');
    expect(a.capture).toBeUndefined();
    expect('capture' in a).toBe(false);
    expect(await readCapture(path.join(dir, 'picture.jpg'), 'picture.jpg', cx)).toBeNull();
  });
  it('a forwarded file: whatever its container says, the date is an estimate', async () => {
    const forwarded = tagged('VID-20241226-WA0003.mp4', ['creation_time=2024-12-26T08:00:00Z']);
    expect(await readCapture(forwarded, 'VID-20241226-WA0003.mp4', cx)).toEqual({ at: '2024-12-26T10:00:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem', circa: true });
    expect(await readCapture(forwarded, 'WhatsApp Video 2024-12-26 at 10.00.00.mp4', cx)).toMatchObject({ source: 'container', circa: true });
    expect(await readCapture(path.join(dir, 'le.jpg'), 'IMG-20241226-WA0009.jpg', cx)).toEqual({ ...exif('2024-12-25T17:30:05', 120), circa: true });
    // the same bytes under the camera's own name are a date like any other
    expect(await readCapture(forwarded, 'VID_20241226_100000.mp4', cx)).toEqual({ at: '2024-12-26T10:00:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' });
  });
  it('a dead clock inside the file falls back to the estimate in the name, and to nothing without one', async () => {
    const dead = tagged('dead.mp4', ['creation_time=1970-01-01T00:00:00Z']);
    expect(await readCapture(dead, 'dead.mp4', cx)).toBeNull();
    expect(await readCapture(dead, 'VID_20240315_181500.mp4', cx)).toEqual({ at: '2024-03-15T18:15:00', utcOffsetMinutes: null, source: 'filename', circa: true });
    const ahead = tagged('ahead.mp4', ['creation_time=2031-05-05T10:00:00Z']);
    expect(await readCapture(ahead, 'ahead.mp4', cx)).toBeNull();
    expect((await upload(ahead)).capture).toBeUndefined();
    const zero = write('zero.jpg', withExif(picture, { date: '2000:01:01 00:00:00' }));
    expect(await readCapture(zero, 'zero.jpg', cx)).toBeNull();
    const future = write('future.jpg', withExif(picture, { date: '2026:11:20 10:00:00' }));
    expect(await readCapture(future, 'future.jpg', cx)).toBeNull();
    expect(await readCapture(future, 'future.jpg', { ...cx, now: new Date('2026-11-19T00:00:00Z') })).toEqual(exif('2026-11-20T10:00:00'));
  });
  it('the probe the caller already has is used as given, and the order of trust holds with it', async () => {
    const probe = { format: { tags: { creation_time: '2022-02-02T10:00:00Z' } } };
    expect(await readCapture(base, 'x.mp4', cx, probe)).toMatchObject({ at: '2022-02-02T12:00:00', source: 'container' });
    // Apple's date over EXIF over the creation time over the name
    const le = path.join(dir, 'le.jpg');
    expect(await readCapture(le, 'IMG_20200101_101010.jpg', cx, probe)).toEqual(exif('2024-12-25T17:30:05', 120));
    expect(await readCapture(le, 'x.jpg', cx, { format: { tags: { 'com.apple.quicktime.creationdate': '2021-01-01T10:00:00+0200' } } })).toMatchObject({ at: '2021-01-01T10:00:00', source: 'container' });
    expect(await readCapture(path.join(dir, 'picture.jpg'), 'IMG_20200101_101010.jpg', cx, probe)).toMatchObject({ at: '2022-02-02T12:00:00', source: 'container' });
    for (const p of [null, 'probe', 7, [], { format: null }, { format: { tags: 'x' } }, { format: { tags: [] } }, Object.create({ format: probe.format })])
      expect(await readCapture(base, 'IMG_20200101_101010.mp4', cx, p), JSON.stringify(p)).toMatchObject({ at: '2020-01-01T10:10:10', source: 'filename', circa: true });
  });
  it('never throws and never dates a file it could not look at: a missing file, a folder, an empty file, noise, text that looks like a playlist', async () => {
    const rnd = mulberry32(7);
    const noise = write('noise.bin', Buffer.from(Array.from({ length: 5000 }, () => Math.floor(rnd() * 256))));
    const jpegNoise = write('noise.jpg', Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0x13, 0x88]), Buffer.from('Exif\0\0', 'latin1'), Buffer.from(Array.from({ length: 5000 }, () => Math.floor(rnd() * 256)))]));
    const playlist = write('list.m3u8', Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1,\nfile:///etc/hostname\nhttp://127.0.0.1:9/x.ts\n'));
    const empty = write('IMG_20240315_181500.jpg', Buffer.alloc(0));
    expect(await readCapture(path.join(dir, 'none.mp4'), 'IMG_20240315_181500.mp4', cx)).toBeNull();
    expect(await readCapture(dir, 'IMG_20240315_181500.mp4', cx)).toBeNull();
    expect(await readCapture(empty, 'IMG_20240315_181500.jpg', cx)).toBeNull();
    expect(await readCapture(noise, 'noise.bin', cx)).toBeNull();
    expect(await readCapture(jpegNoise, 'noise.jpg', cx)).toBeNull();
    expect(await readCapture(playlist, 'list.m3u8', cx)).toBeNull();
    for (const args of [[undefined, undefined, undefined], [null, null, null], [base, 42, cx], [base, 'x.mp4', {}], [base, 'x.mp4', null], [base, 'x.mp4', { homeZone: 7, now: 'x' }], [{}, [], 0]])
      await expect(readCapture(...(args as [never, never, never]))).resolves.toBeNull();
    // bytes that could be read are named honestly: a file that is noise inside still has the estimate its name carries
    expect(await readCapture(noise, 'VID_20240315_181500.mp4', cx)).toMatchObject({ source: 'filename', circa: true });
  }, 60_000);
  it('a rotated, variable-frame-rate file keeps its date through the conform (the conformed copy itself carries none)', async () => {
    const barcode = path.join(dir, 'barcode.mp4');
    await generateBarcodeFixture({ out: barcode, frames: 30 });
    const vfr = path.join(dir, 'phone.mp4');
    ff(['-display_rotation', '90', '-i', barcode, '-vf', "select='mod(n\\,3)'", '-fps_mode', 'vfr', '-an', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-metadata', 'creation_time=2024-12-25T15:30:00Z', vfr]);
    const a = await upload(vfr);
    expect(a.conform?.reasons).toEqual(expect.arrayContaining(['variable-frame-rate']));
    expect(a.contentHash).not.toBe(a.conform!.originalContentHash);
    expect(a.capture).toEqual({ at: '2024-12-25T17:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' });
    // the copy that is edited has no date of its own, the kept original has: this is why the date is read before the conform
    expect(await readCapture(store.blobPath(a.contentHash), 'copy.mp4', cx)).toBeNull();
    expect(await readCapture(store.blobPath(a.conform!.originalContentHash), 'original.mp4', cx)).toEqual(a.capture);
  }, 120_000);
  it('no location: a file that says where it was taken is imported with its date and nothing about the place', async () => {
    const video = tagged(PLACE_VIDEO.name, [...PLACE_VIDEO.tags], ['-movflags', 'use_metadata_tags']);
    // the fixture really carries the place, or this test would prove nothing
    const probed = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', video]).toString());
    expect(JSON.stringify(probed.format.tags)).toMatch(/32\.0853/);
    expect(placeLeak(probed.format.tags)).toMatch(/ISO6709|location/);
    const photo = write(PLACE_PHOTO.name, withExif(picture, PLACE_PHOTO.exif));
    expect(fs.readFileSync(photo).includes(Buffer.from([0x25, 0x88]))).toBe(true); // the GPS pointer (0x8825, little-endian) is in the file
    for (const file of [video, photo]) {
      const a = await upload(file);
      expect(a.capture).toMatchObject({ at: '2024-07-01T18:30:00', utcOffsetMinutes: 180 });
      expect(Object.keys(a.capture!).sort()).toEqual(['at', 'source', 'utcOffsetMinutes']);
      expect(placeLeak(a)).toBeNull();
      expect(Object.keys(a).sort().join(' ')).not.toMatch(/place|geo|location|gps/i);
    }
  }, 60_000);
});

describe('placeLeak: what the "no location" checks of the tests and of proof:lifeline look for', () => {
  it('the two fixtures are kept in the library under names that say nothing about a place (a name is stored as given)', () => {
    expect(placeLeak(PLACE_VIDEO.name)).toBeNull();
    expect(placeLeak(PLACE_PHOTO.name)).toBeNull();
    expect(placeLeak({ label: `Import ${PLACE_PHOTO.name}`, summary: `Imported image "${PLACE_PHOTO.name}"` })).toBeNull();
    expect(PLACE_VIDEO.name).not.toBe(PLACE_PHOTO.name);
  });
  it('finds the place in each shape it could be stored in: the tag as written, a key, a word, the coordinates as numbers', () => {
    expect(placeLeak({ tags: { other: '+32.0853+034.7818+040.000/' } })).toMatch(/^"32\.08" in value 0\.tags\.other/);
    expect(placeLeak({ capture: { at: '2024-07-01T18:30:00', gps: [1, 2] } })).toMatch(/^"gps" in a key of value 0\.capture/);
    expect(placeLeak({ a: 1 }, { capture: { Location: null } })).toMatch(/^"Location" in a key of value 1\.capture/);
    expect(placeLeak([{ note: 'GPSLatitude present' }])).toMatch(/^"GPS" in value 0\[0\]\.note/);
    // the EXIF block of the photo, as degrees: 32°5'7.11" N, 34°46'54.45" E
    expect(placeLeak({ where: [32 + 5 / 60 + 7.11 / 3600, 34 + 46 / 60 + 54.45 / 3600] })).toMatch(/^32\.085\d* in value 0\.where\[0\]/);
    expect(placeLeak({ x: -34.7818 })).toMatch(/^-34\.7818 in value 0\.x/);
    expect(placeLeak('lat 320853 lon 347818')).toMatch(/^"0853" in value 0/);
    expect(placeLeak({ summary: 'Imported video "trip.mov" (taken at 34.78 east)' })).toMatch(/^"34\.78"/);
  });
  it('is not set off by chance: digits inside a content hash or a generated id, a byte count, a date', () => {
    const asset = { id: 'ast_08537818aa0', name: 'trip.mov', contentHash: `sha256:${'0853'.repeat(8)}${'7818'.repeat(8)}`, byteSize: 7818, capture: { at: '2024-07-01T18:30:00', utcOffsetMinutes: 180, source: 'container' }, provenance: { importedAt: '2026-11-17T08:53:07.818Z' } };
    expect(placeLeak(asset, { assets: { [asset.id]: asset } }, { transactionId: 'tx_a0853b7818c', affectedIds: [asset.id] })).toBeNull();
    // the same digits in words a person or the server wrote are still found
    expect(placeLeak({ ...asset, name: 'trip-0853.mov' })).toMatch(/^"0853" in value 0\.name/);
    expect(placeLeak({ ...asset, contentHash: 'sha256:0853' })).toMatch(/^"0853"/);
  });
});
