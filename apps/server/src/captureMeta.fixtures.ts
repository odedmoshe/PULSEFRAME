/**
 * Test files for the capture-date reader (life line, ADR-0021), built by hand so nothing binary is committed: the TIFF block
 * of an EXIF segment with a DateTimeOriginal in the Exif sub-IFD, optionally its offset and a GPS block (which the reader must
 * never follow), in either byte order, with overrides for hostile pointers and counts. Used by the unit tests and by
 * `pnpm proof:lifeline`. Not part of the server.
 */
export interface ExifOptions {
  le?: boolean;
  /** DateTimeOriginal as written; null = no such tag. */
  date?: string | null;
  /** OffsetTimeOriginal as written. */
  offset?: string;
  /** Adds a GPS IFD (pointer 0x8825) with a latitude (32°5'7.11" N) and a longitude (34°46'54.45" E). */
  gps?: boolean;
  orientation?: number;
  /** Overrides, for hostile files. */
  exifPointer?: number; dateOffset?: number; dateCount?: number; dateType?: number; ifd0Count?: number; exifCount?: number; magic?: number;
}
/** Length of the block `exifTiff` returns. */
export const EXIF_TIFF_BYTES = 304;
/** The TIFF block of an EXIF segment: IFD0 (orientation, Exif pointer, optional GPS pointer), the Exif IFD, the GPS IFD and their data. */
export function exifTiff(o: ExifOptions = {}): Buffer {
  const le = o.le ?? true;
  const b = Buffer.alloc(512);
  const w16 = (p: number, v: number) => (le ? b.writeUInt16LE(v, p) : b.writeUInt16BE(v, p));
  const w32 = (p: number, v: number) => (le ? b.writeUInt32LE(v >>> 0, p) : b.writeUInt32BE(v >>> 0, p));
  const entry = (p: number, tagId: number, type: number, count: number, value: number) => { w16(p, tagId); w16(p + 2, type); w32(p + 4, count); w32(p + 8, value); };
  b.write(le ? 'II' : 'MM', 0, 'latin1'); w16(2, o.magic ?? 42); w32(4, 8);
  const exifIfd = 100, gpsIfd = 160, dateAt = 220, offsetAt = 244, latAt = 256, lonAt = 280;
  const ifd0 = [[0x0112, 3, 1, 0], [0x8769, 4, 1, o.exifPointer ?? exifIfd], ...(o.gps ? [[0x8825, 4, 1, gpsIfd]] : [])] as const;
  w16(8, o.ifd0Count ?? ifd0.length);
  ifd0.forEach(([t, ty, n, v], i) => entry(10 + i * 12, t, ty, n, v));
  w16(10 + 8, o.orientation ?? 1); // the orientation's value sits inside its entry
  const date = o.date === undefined ? '2024:12:25 17:30:05' : o.date;
  const exif = [...(date !== null ? [[0x9003, o.dateType ?? 2, o.dateCount ?? 20, o.dateOffset ?? dateAt]] : []), ...(o.offset !== undefined ? [[0x9011, 2, 7, offsetAt]] : [])] as const;
  w16(exifIfd, o.exifCount ?? exif.length);
  exif.forEach(([t, ty, n, v], i) => entry(exifIfd + 2 + i * 12, t!, ty!, n!, v!));
  if (date !== null) b.write(`${date}\0`, dateAt, 'latin1');
  if (o.offset !== undefined) b.write(`${o.offset}\0`, offsetAt, 'latin1');
  if (o.gps) {
    w16(gpsIfd, 4);
    entry(gpsIfd + 2, 0x0001, 2, 2, 0); b.write('N\0', gpsIfd + 2 + 8, 'latin1');
    entry(gpsIfd + 14, 0x0002, 5, 3, latAt);
    entry(gpsIfd + 26, 0x0003, 2, 2, 0); b.write('E\0', gpsIfd + 26 + 8, 'latin1');
    entry(gpsIfd + 38, 0x0004, 5, 3, lonAt);
    [[32, 1], [5, 1], [711, 100]].forEach(([n, d], i) => { w32(latAt + i * 8, n!); w32(latAt + i * 8 + 4, d!); });
    [[34, 1], [46, 1], [5445, 100]].forEach(([n, d], i) => { w32(lonAt + i * 8, n!); w32(lonAt + i * 8 + 4, d!); });
  }
  return b.subarray(0, EXIF_TIFF_BYTES);
}
export const jpegSegment = (marker: number, data: Buffer) => Buffer.concat([Buffer.from([0xff, marker, ((data.length + 2) >> 8) & 255, (data.length + 2) & 255]), data]);
export const exifSegment = (t: Buffer) => jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]));
export const SOI = Buffer.from([0xff, 0xd8]);
/** The start of a JPEG with this EXIF segment (enough for the reader; not a picture). */
export const jpegHead = (o: ExifOptions = {}, before: Buffer[] = []) => Buffer.concat([SOI, ...before, exifSegment(exifTiff(o)), Buffer.from([0xff, 0xda, 0, 2])]);
/** A real picture file with the EXIF segment put in right after the start. */
export const withExif = (jpeg: Buffer, o: ExifOptions = {}) => Buffer.concat([jpeg.subarray(0, 2), exifSegment(exifTiff(o)), jpeg.subarray(2)]);
