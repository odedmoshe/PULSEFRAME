/**
 * Reading the capture date of an uploaded file from its ORIGINAL bytes, before any conform (life line, ADR-0021). The conformed
 * copy carries neither the container's creation time nor Apple's creation date, so this is the only moment the date can be read.
 *
 * The signatures are the lead's contract. The rules (plan §4.1, with the verifier's corrections, which win):
 * - Order of trust: (1) format.tags['com.apple.quicktime.creationdate'] (wall clock + offset; source container);
 *   (2) JPEG EXIF: IFD0 tag 0x8769 → Exif IFD → 0x9003 DateTimeOriginal and 0x9011 OffsetTimeOriginal, both byte orders,
 *   every offset bounds-checked (source exif); (3) format.tags.creation_time, a UTC instant printed as …00Z or …00.000000Z,
 *   converted to the wall clock of the home zone with wallInZone, `assumedZone` recorded, offset null (source container);
 *   (4) file-name patterns, always circa (source filename): IMG|VID|MVIMG_YYYYMMDD_HHMMSS, YYYYMMDD_HHMMSS,
 *   PXL_YYYYMMDD_HHMMSSmmm (UTC, converted), VID|IMG|AUD|PTT-YYYYMMDD-WAnnnn (day only), "WhatsApp Video|Image YYYY-MM-DD at HH.MM.SS".
 * - A date taken from a file whose NAME matches a messaging-app pattern (isMessagingAppName) is circa whatever its source:
 *   a forwarded video carries the time it was re-encoded or sent.
 * - Rejected: impossible dates, years before 1995, more than 48 hours after `now`, unset camera clocks (1904, 1970,
 *   2000-01-01 00:00:00 exactly). The result always passes CaptureSchema.
 * - Never throws: any failure is "no date", and never fails the import. Use the existing ffprobe() helper (protocol whitelist).
 * - NO LOCATION: only the tags named above are read; nothing about where a file was taken is read, stored or logged.
 * - Known limits, to state and not to guess around: cameras that write local time labelled as UTC, and Android cameras that
 *   write the END of the recording as creation time (https://bugs.kde.org/show_bug.cgi?id=405589). The remedy is the manual
 *   clock shift. HEIC stills are converted to PNG at import and their EXIF is not read in this wave.
 * - Do not change jpegOrientation (ingest.ts).
 *
 * UNTRUSTED BYTES. Everything read here comes from an uploaded file or its name:
 * - at most HEAD_BYTES of the file are read; a JPEG's EXIF is parsed inside its own APP1 segment only, so no offset or count
 *   written in the file can make a read leave that segment; counts are capped and no pointer is followed twice (no loops);
 * - tag values and names are cut to short lengths before any pattern is applied, and every pattern is anchored and linear;
 * - a source whose date is refused (an unset clock, a day that does not exist, the future) is skipped and the next one is
 *   tried, so a camera with a dead clock still gets the estimate its file name carries;
 * - the result is checked against CaptureSchema before it is returned, so the import operation never refuses it.
 * The only use of Intl and Date in the life line is here (and in the route's `now`): nothing on the render path calls either.
 */
import fs from 'node:fs';
import { CaptureSchema, isRealWallDate, type Capture } from '@pulseframe/core';
import { ffprobe } from './ingest.ts';

/** What the reader needs besides the file: the home zone for files that give only a UTC instant, and the time of the import. */
export interface CaptureContext { homeZone: string; now: Date }

/** At most this much of the start of a file is read for EXIF (APP1 follows the start of a JPEG; one segment is at most 64 KiB). */
export const HEAD_BYTES = 512 * 1024;
/** Dates before this year are a camera clock that was never set (1904 and 1970 are the zero of two common clocks). */
export const MIN_READ_YEAR = 1995;
/** A date this long after the import is a clock that is wrong, not a date anyone filmed on. */
export const MAX_FUTURE_MS = 48 * 3600 * 1000;
const MAX_NAME = 256, MAX_TAG_VALUE = 64, MAX_TAGS = 256, MAX_SEGMENTS = 64, MAX_IFD_ENTRIES = 512;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const wall = (y: number, mo: number, d: number, h?: number, mi?: number, s?: number) => `${pad(y, 4)}-${pad(mo)}-${pad(d)}${h === undefined ? '' : `T${pad(h)}:${pad(mi!)}:${pad(s!)}`}`;
/** Milliseconds of a wall string read as if it were UTC: for comparing two wall clocks, never an instant. */
const wallMs = (at: string) => Date.UTC(+at.slice(0, 4), +at.slice(5, 7) - 1, +at.slice(8, 10), at.length > 10 ? +at.slice(11, 13) : 0, at.length > 10 ? +at.slice(14, 16) : 0, at.length > 10 ? +at.slice(17, 19) : 0);

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
/** YYYY-MM-DDTHH:MM:SS on the wall clock of `zone` at the UTC instant `utcMs` (Intl; server only, never on the render path). RangeError for a zone this machine does not know or an instant outside the years 1–9999. */
export function wallInZone(utcMs: number, zone: string): string {
  if (!Number.isFinite(utcMs)) throw new RangeError('not an instant');
  let f = zoneFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone: zone, hourCycle: 'h23', era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (zoneFormats.size >= 16) zoneFormats.clear(); // the zone comes from the server's own setting; this only bounds a misuse
    zoneFormats.set(zone, f);
  }
  const part: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(utcMs))) part[p.type] = p.value;
  const y = Number(part.year);
  if (part.era !== 'AD' || !Number.isInteger(y) || y < 1 || y > 9999) throw new RangeError('instant outside the years 1 to 9999');
  return wall(y, Number(part.month), Number(part.day), Number(part.hour) % 24, Number(part.minute), Number(part.second));
}

/** A real day from MIN_READ_YEAR on, as a file wrote it, and not the zero of a clock (2000-01-01 00:00:00 exactly). */
const written = (at: string) => isRealWallDate(at) && Number(at.slice(0, 4)) >= MIN_READ_YEAR && at !== '2000-01-01T00:00:00';
/**
 * Not more than 48 hours after the import (and a real day from MIN_READ_YEAR on). `offset` is the file's own UTC offset when
 * it states one; without it the import time is read on the home zone's wall clock (the 48 hours cover every zone).
 */
function notAhead(at: string, offset: number | null, cx: CaptureContext): boolean {
  if (!isRealWallDate(at) || Number(at.slice(0, 4)) < MIN_READ_YEAR) return false;
  const now = cx.now instanceof Date ? cx.now.getTime() : NaN;
  if (!Number.isFinite(now)) return true; // no usable import time: nothing to compare with
  let nowWall = now + (offset ?? 0) * 60_000;
  if (offset === null) { try { nowWall = wallMs(wallInZone(now, cx.homeZone)); } catch { /* an unknown zone: compare on the UTC clock */ } }
  return wallMs(at) <= nowWall + MAX_FUTURE_MS;
}
const offsetMinutes = (sign: string, hh: string, mm: string): number | null => {
  const h = Number(hh), m = Number(mm);
  if (!(h <= 14 && m <= 59) || h * 60 + m > 840) return null;
  return sign === '-' && h * 60 + m > 0 ? -(h * 60 + m) : h * 60 + m; // never a negative zero
};

// ---------- container tags ----------
const APPLE_KEY = 'com.apple.quicktime.creationdate';
const APPLE_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:(Z)|([+-])(\d{2}):?(\d{2}))?$/;
const UTC_DATE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z?$/;
/** A tag's value as a short string, looked up as an own property (the tag names of a file are untrusted), also by a name that differs only in case. */
function tag(tags: Record<string, unknown>, name: string): string | null {
  let v: unknown = Object.hasOwn(tags, name) ? tags[name] : undefined;
  if (v === undefined) {
    let seen = 0;
    for (const k of Object.keys(tags)) { if (++seen > MAX_TAGS) break; if (k.length === name.length && k.toLowerCase() === name) { v = tags[k]; break; } }
  }
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_TAG_VALUE ? v.trim() : null;
}
/** Apple's creation date: the wall clock where it was filmed, with its UTC offset. */
function fromAppleTag(tags: Record<string, unknown>, cx: CaptureContext): Capture | null {
  const m = APPLE_DATE.exec(tag(tags, APPLE_KEY) ?? '');
  if (!m) return null;
  const at = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const offset = m[7] ? 0 : m[8] ? offsetMinutes(m[8], m[9]!, m[10]!) : null;
  if (m[8] && offset === null) return null; // an offset no clock has: the tag is not to be trusted
  return written(at) && notAhead(at, offset, cx) ? { at, utcOffsetMinutes: offset, source: 'container' } : null;
}
/** The container's creation time: a UTC instant, shown on the home zone's wall clock; the zone is recorded as assumed. */
function fromCreationTime(tags: Record<string, unknown>, cx: CaptureContext): Capture | null {
  const m = UTC_DATE.exec(tag(tags, 'creation_time') ?? '');
  if (!m) return null;
  const utc = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (!written(utc)) return null; // the clock's zero is refused as the file wrote it, before any zone moves it
  let at: string;
  try { at = wallInZone(wallMs(utc), cx.homeZone); } catch { return null; }
  return notAhead(at, null, cx) ? { at, utcOffsetMinutes: null, source: 'container', assumedZone: cx.homeZone.slice(0, 64) } : null;
}
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** The format tags of an ffprobe result, or undefined. Stream tags are not read. */
function formatTags(probe: unknown): Record<string, unknown> | undefined {
  const format = isRecord(probe) && Object.hasOwn(probe, 'format') ? probe.format : undefined;
  const tags = isRecord(format) && Object.hasOwn(format, 'tags') ? format.tags : undefined;
  return isRecord(tags) ? tags : undefined;
}
/** From ffprobe's format tags: Apple's creation date first, then the container's creation time (UTC → the home zone's wall clock). */
export function captureFromTags(tags: Record<string, unknown> | undefined, cx: CaptureContext): Capture | null {
  if (!isRecord(tags)) return null;
  try { return fromAppleTag(tags, cx) ?? fromCreationTime(tags, cx); } catch { return null; }
}

// ---------- JPEG EXIF ----------
const EXIF_DATE = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET = /^([+-])(\d{2}):(\d{2})/;
/**
 * The TIFF block of an EXIF segment (`t` is exactly that block: no read can leave it). IFD0 tag 0x8769 points to the Exif
 * IFD; there 0x9003 is DateTimeOriginal and 0x9011 OffsetTimeOriginal. Nothing else is read: not the GPS pointer (0x8825),
 * not the maker's notes.
 */
function exifDate(t: Buffer): Capture | null {
  if (t.length < 14) return null;
  const order = t.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (p: number) => (le ? t.readUInt16LE(p) : t.readUInt16BE(p));
  const u32 = (p: number) => (le ? t.readUInt32LE(p) : t.readUInt32BE(p));
  if (u16(2) !== 42) return null;
  /** The 12-byte entry of `wanted` in the IFD at `ifd`, or -1. Every position is checked against the block. */
  const entry = (ifd: number, wanted: number): number => {
    if (ifd < 8 || ifd + 2 > t.length) return -1;
    const count = Math.min(u16(ifd), MAX_IFD_ENTRIES);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > t.length) return -1;
      if (u16(e) === wanted) return e;
    }
    return -1;
  };
  /** The text of an ASCII entry (type 2): inside the entry when it has at most 4 characters, else where its offset points. */
  const ascii = (e: number, max: number): string | null => {
    if (e < 0 || u16(e + 2) !== 2) return null;
    const n = u32(e + 4);
    if (n < 1 || n > 64) return null;
    const at = n <= 4 ? e + 8 : u32(e + 8);
    if (at < 8 || at + n > t.length) return null;
    return t.toString('latin1', at, at + Math.min(n, max));
  };
  const pointer = entry(u32(4), 0x8769);
  if (pointer < 0 || (u16(pointer + 2) !== 4 && u16(pointer + 2) !== 13) || u32(pointer + 4) !== 1) return null;
  const exifIfd = u32(pointer + 8);
  const m = EXIF_DATE.exec(ascii(entry(exifIfd, 0x9003), 19) ?? '');
  if (!m) return null;
  const at = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const o = EXIF_OFFSET.exec(ascii(entry(exifIfd, 0x9011), 6) ?? '');
  const offset = o ? offsetMinutes(o[1]!, o[2]!, o[3]!) : null;
  return written(at) ? { at, utcOffsetMinutes: offset, source: 'exif' } : null; // readCapture adds the check against the import time
}
/** From the start of a JPEG file: APP1 Exif, IFD0 0x8769 → Exif IFD 0x9003 / 0x9011. null for anything else, truncated or hostile. */
export function captureFromExif(head: Buffer): Capture | null {
  try {
    const b = head.length > HEAD_BYTES ? head.subarray(0, HEAD_BYTES) : head;
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    let o = 2;
    for (let segments = 0; segments < MAX_SEGMENTS && o + 4 <= b.length && b[o] === 0xff; segments++) {
      const marker = b[o + 1]!;
      if (marker === 0xff) { o += 1; continue; } // a fill byte before a marker
      if (marker === 0xda || marker === 0xd9) return null; // the picture data starts, or the file ends: no more headers
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { o += 2; continue; } // markers without a length
      const len = b.readUInt16BE(o + 2);
      if (len < 2) return null;
      if (marker === 0xe1 && o + 10 <= b.length && b.toString('latin1', o + 4, o + 10) === 'Exif\0\0')
        return exifDate(b.subarray(o + 10, Math.min(o + 2 + len, b.length))); // a JPEG has one EXIF segment
      o += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------- file names ----------
/** The name without folders and without its last extension, cut to what a library name can hold. */
function stem(fileName: string): string {
  const name = String(fileName);
  return name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).slice(0, MAX_NAME).replace(/\.[A-Za-z0-9]{1,5}$/, '');
}
const MESSAGING = /^(?:(?:VID|IMG|AUD|PTT)-\d{8}-WA\d{1,6}|WhatsApp (?:Video|Image|Audio|Ptt)\b)/i;
/** True for names a messaging app gives (VID|IMG|AUD|PTT-YYYYMMDD-WAnnnn, "WhatsApp Video|Image …"): any date of such a file is an estimate. */
export function isMessagingAppName(fileName: string): boolean {
  return typeof fileName === 'string' && MESSAGING.test(stem(fileName));
}
const NAME_PIXEL = /^PXL_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\d{3}(?!\d)/i;
const NAME_CAMERA = /^(?:(?:IMG|VID|MVIMG)_)?(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?!\d)/i;
const NAME_WA_DAY = /^(?:VID|IMG|AUD|PTT)-(\d{4})(\d{2})(\d{2})-WA\d{1,6}(?!\d)/i;
const NAME_WA_TIME = /^WhatsApp (?:Video|Image|Audio|Ptt) (\d{4})-(\d{2})-(\d{2}) at (\d{1,2})\.(\d{2})\.(\d{2})(?: ?([AP])M)?/i;
/** From the file-name patterns; always circa. */
export function captureFromFileName(fileName: string, cx: CaptureContext): Capture | null {
  try {
    if (typeof fileName !== 'string') return null;
    const name = stem(fileName);
    const circa = { source: 'filename' as const, circa: true as const };
    let m = NAME_PIXEL.exec(name);
    if (m) { // a Pixel phone names its files by the UTC clock
      const utc = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
      if (!written(utc)) return null;
      const at = wallInZone(wallMs(utc), cx.homeZone);
      return notAhead(at, null, cx) ? { at, utcOffsetMinutes: null, ...circa, assumedZone: cx.homeZone.slice(0, 64) } : null;
    }
    let at: string | null = null;
    if ((m = NAME_CAMERA.exec(name))) at = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    else if ((m = NAME_WA_DAY.exec(name))) at = `${m[1]}-${m[2]}-${m[3]}`;
    else if ((m = NAME_WA_TIME.exec(name))) {
      let h = Number(m[4]);
      if (m[7]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[7].toUpperCase() === 'P' ? 12 : 0); }
      at = `${m[1]}-${m[2]}-${m[3]}T${pad(h)}:${m[5]}:${m[6]}`;
    }
    return at && written(at) && notAhead(at, null, cx) ? { at, utcOffsetMinutes: null, ...circa } : null;
  } catch {
    return null;
  }
}

// ---------- the file ----------
/** The first HEAD_BYTES of a file, or null when it cannot be read (missing, a folder, no permission). */
function readHead(file: string): Buffer | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(HEAD_BYTES);
    return b.subarray(0, fs.readSync(fd, b, 0, b.length, 0));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* nothing to do */ }
  }
}
/**
 * The capture date of the file at `file` (the original upload), or null when none can be read. `fileName` is the name it was
 * uploaded with (for the file-name patterns); `probe` is that file's ffprobe output when the caller already has it.
 * Order of trust: Apple's creation date, a JPEG's EXIF, the container's creation time, the file name. Never throws.
 */
export async function readCapture(file: string, fileName: string, cx: CaptureContext, probe?: unknown): Promise<Capture | null> {
  try {
    const name = typeof fileName === 'string' ? fileName : '';
    const head = readHead(file);
    if (!head || head.length === 0) return null; // the bytes cannot be read: nothing is said about a file that was not looked at
    const jpeg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    // A JPEG carries its date in EXIF and has no container tags, so it is not probed here (the import probes it once, later).
    const tags = probe !== undefined ? formatTags(probe) : jpeg ? undefined : formatTags(await ffprobe(file).catch(() => null));
    const exif = jpeg ? captureFromExif(head) : null;
    const found = (tags && fromAppleTag(tags, cx)) ?? (exif && notAhead(exif.at, exif.utcOffsetMinutes, cx) ? exif : null) ?? (tags && fromCreationTime(tags, cx)) ?? captureFromFileName(name, cx);
    if (!found) return null;
    // A forwarded file carries the time it was re-encoded or sent: whatever the source says, its date is an estimate.
    const capture: Capture = isMessagingAppName(name) ? { ...found, circa: true } : found;
    const checked = CaptureSchema.safeParse(capture);
    return checked.success ? checked.data : null;
  } catch {
    return null; // no date is simply no date: reading one never fails an import
  }
}
