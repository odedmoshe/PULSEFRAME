/**
 * Reading the capture date of an uploaded file from its ORIGINAL bytes, before any conform (life line, ADR-0021). The conformed
 * copy carries neither the container's creation time nor Apple's creation date, so this is the only moment the date can be read.
 *
 * CONTRACT FILE (lead pre-pass). The signatures are fixed; the bodies are W2's. Until then readCapture reads nothing and
 * answers "no date" (the honest state: the file's date is unknown), and the pure helpers throw "not built".
 *
 * Rules for the bodies (plan §4.1, with the verifier's corrections, which win):
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
 */
import type { Capture } from '@pulseframe/core';

const notBuilt = (what: string): never => { throw new Error(`life line: ${what} is not built yet (captureMeta.ts, W2)`); };

/** What the reader needs besides the file: the home zone for files that give only a UTC instant, and the time of the import. */
export interface CaptureContext { homeZone: string; now: Date }
/**
 * The capture date of the file at `file` (the original upload), or null when none can be read. `fileName` is the name it was
 * uploaded with (for the file-name patterns); `probe` is that file's ffprobe output when the caller already has it.
 */
export async function readCapture(_file: string, _fileName: string, _cx: CaptureContext, _probe?: unknown): Promise<Capture | null> {
  // CONTRACT STUB: nothing is read, so the date is unknown. W2 replaces this body.
  return null;
}
/** From ffprobe's format tags: Apple's creation date first, then the container's creation time (UTC → the home zone's wall clock). */
export function captureFromTags(_tags: Record<string, unknown> | undefined, _cx: CaptureContext): Capture | null { return notBuilt('captureFromTags'); }
/** From the start of a JPEG file: APP1 Exif, IFD0 0x8769 → Exif IFD 0x9003 / 0x9011. null for anything else, truncated or hostile. */
export function captureFromExif(_head: Buffer): Capture | null { return notBuilt('captureFromExif'); }
/** From the file-name patterns; always circa. */
export function captureFromFileName(_fileName: string, _cx: CaptureContext): Capture | null { return notBuilt('captureFromFileName'); }
/** True for names a messaging app gives (VID|IMG|AUD|PTT-YYYYMMDD-WAnnnn, "WhatsApp Video|Image …"): any date of such a file is an estimate. */
export function isMessagingAppName(_fileName: string): boolean { return notBuilt('isMessagingAppName'); }
/** YYYY-MM-DDTHH:MM:SS on the wall clock of `zone` at the UTC instant `utcMs` (Intl; server only, never on the render path). */
export function wallInZone(_utcMs: number, _zone: string): string { return notBuilt('wallInZone'); }
