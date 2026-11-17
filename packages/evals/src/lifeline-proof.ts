/**
 * `pnpm proof:lifeline` — the proof of the life line (ADR-0021) on a CPU, with no model: capture dates read from generated
 * fixtures, a title field against the same words typed by hand, export against still, exact undo of every operation, the
 * preflight, and the calendar inside headless Chromium (through window.__pfLife on the self-test page).
 * Evidence: docs/evidence/lifeline-proof.json.
 *
 *   pnpm build && pnpm proof:lifeline          needs ffmpeg/ffprobe and Playwright's Chromium; port 8887 free
 *   exit 0 = every check passed · 1 = a check failed · 2 = blocked (the web bundle is not built)
 *
 * Eleven checks, with the numbers of plan §8 (10 and 11 were about people and the family-free archive, which are not part
 * of this build and have no check here):
 *   1. Capture dates: eight generated files of different shapes, each uploaded through the route, get exactly the date
 *      typed here (8/8), including one UTC hour that is 17:30 in a Jerusalem winter and 18:30 in a Jerusalem summer and a
 *      rotated variable-frame-rate file whose date survives the conform. A dead clock gets no date; a file that says where
 *      it was taken is imported with no location anywhere in the project.
 *   2. Field = the same words typed by hand: for eight kinds of field, the server still of a title with the field has the
 *      same PNG SHA-256 as the still of a plain title holding the words typed HERE (never computed by the code under
 *      test), and a different SHA-256 from a title with other words.
 *   3. Two dates over a cut: one title «{date}» across a cut between a picture of June 2021 and one of December 2024 (the
 *      same pixels, so the words are the only difference): the last frame before the cut equals the first date typed by
 *      hand, the first frame after it the second.
 *   4. Export against still, measured inside the title's box (the pixels where the two stills differ): each of the two
 *      frames of the H.264 export is within the parity suite's text bound of its own still AND clearly farther from the
 *      other still, and within the suite's whole-frame PSNR bound. The PNG export of both frames is byte-equal to
 *      render_frame, which is recorded as determinism only (a PNG export IS the still path, export.ts renderStill).
 *   5. The paused editor preview of those two frames against the server stills, with the parity suite's own preview bound
 *      (99.9 % of samples within 2 levels, none off by more than 16), and inside the title's box clearly far from the
 *      other still.
 *   6. The date stamp from the capture date: its still equals the still of the same stamp with the text typed by hand;
 *      with the clock, the frame 60 seconds later equals the typed next minute and differs from the typed first minute.
 *   7. "Make it plain text": the still before and after committing the operations freezeOps returns is byte-equal, the
 *      title holds the typed words and no fields; undo restores the fields and the same still.
 *   8. Exact undo: each of the seven public operations through REST, and attach_asset_capture through the re-read route,
 *      undone and redone: the creative projection is equal to before and to after; at the end store.replay equals the
 *      stored document.
 *   9. Preflight: an undated picture under a title with a field, with a DATED picture later on the same track: the field
 *      is empty (the still equals the title without it), the preflight has the blocker field_no_data with the title's id
 *      and frames, and an export is refused. An evening picture with {hebrewDate}: field_sunset_undecided naming the
 *      event; after update_event afterSunset=true the still equals «כ״ה בכסלו תשפ״ה» typed by hand and the plan is clear.
 *  12. The calendar inside headless Chromium: every day of 2022–2027 against the page's own Intl (Hebrew year, month and
 *      day; the Hebrew-letter day and year; the weekday; both round trips): 0 mismatches. The holiday table of 5785–5787
 *      is written into the evidence for the owner's review.
 *  13. Cost (recorded, not judged beyond being measured): evaluate over 1,000 frames of a timeline with 20 live titles
 *      against the same timeline with plain titles (added median time per frame; budget 0.2 ms), and the commit latency
 *      of a project with 500 dated files and 60 events.
 *
 * Fourteen lines are printed for these eleven checks: 1 and 9 have two lines each (1, 1b; 9a, 9b) and 4 has its
 * determinism line (4a). The result is PASSED only when all fourteen hold.
 * What a check must be able to fail for is why the expected words are typed in this file, why 4 and 5 measure against
 * BOTH stills, and why the "no data" fixture of 9 has a dated picture on the same track.
 * Synthetic files only; nobody looked at the pictures. The one time-zone conversion is the import's (Asia/Jerusalem here).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, freezeOps, gregorianFromRd, holidayTable, type Asset, type Capture, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { withExif } from '../../../apps/server/src/captureMeta.fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/lifeline-proof');
const PORT = 8887;
const W = 640, H = 360;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 30, input });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const r3 = (x: number) => (Number.isFinite(x) ? Number(x.toFixed(3)) : x);

/** The parity suite's own bounds (packages/evals/src/parity-suite.ts TH): preview and text-region export. */
const TH = { previewWithin2: 0.999, previewTol: 2, outlier: 16, psnr: 36, regionalPsnr: 30 };
/** "Clearly farther from the other still": at least this many dB worse inside the title's box, and at least this share of the box's differing pixels still differing. */
const FAR_DB = 6, FAR_SHARE = 0.5;

const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const measurements: Record<string, unknown> = {};
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 700)}` : ''}`); };
let blocked: string | null = null;

// ---------- pixels ----------
type Rect = { x0: number; y0: number; x1: number; y1: number };
const decodePng = (png: Buffer) => { const b = ff(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], png); if (b.length !== W * H * 4) throw new Error(`unexpected still size ${b.length}`); return b; };
/** The smallest rectangle (padded) that holds every pixel where two RGBA frames differ by more than `tol` in a channel; null when none does. */
function differingBox(a: Buffer, b: Buffer, tol = 8, pad = 4): { box: Rect; pixels: number } | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1, pixels = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    if (Math.abs(a[p]! - b[p]!) > tol || Math.abs(a[p + 1]! - b[p + 1]!) > tol || Math.abs(a[p + 2]! - b[p + 2]!) > tol) { pixels++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { box: { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(W, x1 + 1 + pad), y1: Math.min(H, y1 + 1 + pad) }, pixels };
}
/** PSNR of `test` (stride 3 or 4) against the RGBA `ref`, over the whole frame or inside `box`. */
function psnr(ref: Buffer, test: Buffer, stride: number, box?: Rect): number {
  const r = box ?? { x0: 0, y0: 0, x1: W, y1: H };
  let se = 0, n = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) for (let c = 0; c < 3; c++) { const d = ref[(y * W + x) * 4 + c]! - test[(y * W + x) * stride + c]!; se += d * d; n++; }
  const mse = se / Math.max(1, n);
  return mse === 0 ? 99 : Math.min(99, 10 * Math.log10((255 * 255) / mse));
}
/** How `test` sits against the RGBA `ref`: the share of samples within 2 levels, the largest difference, and the pixels off by more than 16 in a channel. */
function closeness(ref: Buffer, test: Buffer, stride: number, box?: Rect) {
  const r = box ?? { x0: 0, y0: 0, x1: W, y1: H };
  let n = 0, within = 0, max = 0, farPixels = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    let far = false;
    for (let c = 0; c < 3; c++) { const d = Math.abs(ref[(y * W + x) * 4 + c]! - test[(y * W + x) * stride + c]!); n++; if (d <= TH.previewTol) within++; if (d > max) max = d; if (d > TH.outlier) far = true; }
    if (far) farPixels++;
  }
  return { fractionWithin2: n ? within / n : 1, maxDiff: max, farPixels };
}

// ---------- expected words: typed here, in Hebrew and English ----------
/** A daytime clock of 26 December 2024, the first day of Hanukkah: 25 Kislev 5785. [the field as stored, the title with it, the same title typed by hand] */
const KINDS: [string, string, string][] = [
  ['{date}', 'צולם ב־{date}', 'צולם ב־26 בדצמבר 2024'],
  ['{date:numeric}', 'צולם ב־{date:numeric}', 'צולם ב־26.12.2024'],
  ['{hebrewDate}', '{hebrewDate} · חנוכה', 'כ״ה בכסלו תשפ״ה · חנוכה'],
  ['{year}', 'שנת {year}', 'שנת 2024'],
  ['{hebrewYear}', 'שנת {hebrewYear}', 'שנת תשפ״ה'],
  ['{event}', 'האירוע: {event}', 'האירוע: חנוכה אצל סבתא'],
  ['{date:long-en}', 'Filmed on {date:long-en}', 'Filmed on 26 December 2024'],
  ['{date:monthYear-en}', '{date:monthYear-en} at home', 'December 2024 at home'],
];
const EVENT_NAME = 'חנוכה אצל סבתא';
const JUNE_WORDS = '1 ביוני 2021', DECEMBER_WORDS = '26 בדצמבר 2024';
const TITLE_STYLE = { sizeFrac: 0.11, color: '#FFFFFF', stroke: '#000000', strokeFrac: 0.06, background: '#101418CC' };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html')) || !fs.existsSync(path.join(root, 'apps/web/dist/selftest.html'))) {
    blocked = 'the web bundle (apps/web/dist: render.html, selftest.html) is not built: run `pnpm build` first';
    console.error(`proof:lifeline is BLOCKED: ${blocked}. Nothing was checked.`);
    return;
  }

  // ---------------------------------------------------------------- fixtures, made here (nothing binary is committed)
  const file = (name: string) => path.join(art, name);
  const plain = file('plain.mp4');
  ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=30`, '-t', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-bitexact', '-map_metadata', '-1', plain]);
  /** A copy of the plain video with these container tags; `mark` makes its bytes its own (the library keeps one file per content). */
  const tagged = (name: string, meta: string[], extra: string[] = []) => { ff(['-i', plain, '-c', 'copy', ...extra, ...[...meta, `comment=${name}`].flatMap((m) => ['-metadata', m]), file(name)]); return file(name); };
  ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}`, '-frames:v', '1', '-q:v', '3', file('picture.jpg')]);
  const picture = fs.readFileSync(file('picture.jpg'));
  const photo = (name: string, exif: Parameters<typeof withExif>[1]) => { fs.writeFileSync(file(name), withExif(picture, exif)); return file(name); };
  const barcode = await generateBarcodeFixture({ out: file('barcode.mp4'), frames: 60 });
  ff(['-display_rotation', '90', '-i', barcode.file, '-vf', "select='mod(n\\,3)'", '-fps_mode', 'vfr', '-an', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-metadata', 'creation_time=2023-04-06T07:00:00Z', file('phone.mp4')]);
  // 62 seconds for the clock of the date stamp, with Apple's creation date 18:15:10
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '62', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', 'use_metadata_tags', '-metadata', 'com.apple.quicktime.creationdate=2024-12-25T18:15:10+0200', file('clock.mov')]);

  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data'), homeZone: 'Asia/Jerusalem' });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: OpCall[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction failed ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body as { revision: number; results: { output?: Record<string, any> }[] }; };
  const newProject = async (name: string) => (await call('/projects', { name, width: W, height: H, frameRate: R })).body.project.id as string;
  const upload = async (pid: string, path_: string, name = path.basename(path_)) => {
    const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': encodeURIComponent(name) }, body: new Uint8Array(fs.readFileSync(path_)) });
    const b = (await r.json()) as { assetId?: string; asset?: Asset };
    if (!b.assetId || !b.asset) throw new Error(`upload of ${name} failed: ${JSON.stringify(b).slice(0, 300)}`);
    return { assetId: b.assetId, asset: b.asset };
  };
  const getDoc = async (pid: string) => (await call(`/projects/${pid}`)).body.project as ProjectDocument;
  const still = async (pid: string, n: number) => { const r = await call(`/projects/${pid}/frame?index=${n}`); if (r.status !== 200) throw new Error(`still ${n} of ${pid}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body as Buffer; };
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled', 'refused'].includes(j.status)) return j; await sleep(200); } };
  const undo = async (pid: string, mode: 'undo' | 'redo' = 'undo') => { const r = await call(`/projects/${pid}/${mode}`, {}); if (r.status !== 200) throw new Error(`${mode} failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const lifeIssues = async (pid: string) => ((await call(`/projects/${pid}/preflight`)).body.issues as { code: string; severity: string; ids: string[]; range?: { startFrame: number; endFrame: number } }[]).filter((i) => ['field_no_data', 'field_sunset_undecided', 'capture_estimated', 'stamp_no_date'].includes(i.code));
  /** A picture on the video track and a title over it. */
  const titled = async (pid: string, assetId: string, text: string, opts: { fields?: boolean; start?: number; frames?: number } = {}) => {
    const clip = await tx(pid, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(60) } }]);
    const t = await tx(pid, [{ op: 'add_text', args: { text, start: f(opts.start ?? 0), duration: f(opts.frames ?? 60), style: TITLE_STYLE, transform: { y: 0.2 } } }]);
    const titleId = t.results[0]!.output!.clipId as string;
    if (opts.fields) await tx(pid, [{ op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]);
    return { clipId: clip.results[0]!.output!.clipId as string, titleId };
  };

  const browser = await chromium.launch();
  try {
    // ================================================================ 1. capture dates of eight files
    {
      const pid = await newProject('1 capture dates');
      const expected: [string, string, Capture][] = [
        ['container creation time, winter (15:30 UTC)', tagged('winter.mp4', ['creation_time=2024-12-25T15:30:00Z']), { at: '2024-12-25T17:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' }],
        ['container creation time, summer (15:30 UTC)', tagged('summer.mp4', ['creation_time=2024-07-01T15:30:00Z']), { at: '2024-07-01T18:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' }],
        ['Apple creation date beside another creation time', tagged('apple.mov', ['com.apple.quicktime.creationdate=2023-08-10T09:05:07-0700', 'creation_time=2023-08-11T00:00:00Z'], ['-movflags', 'use_metadata_tags']), { at: '2023-08-10T09:05:07', utcOffsetMinutes: -420, source: 'container' }],
        ['JPEG EXIF, little-endian, with its offset', photo('le.jpg', { date: '2024:12:26 10:00:00', offset: '+02:00' }), { at: '2024-12-26T10:00:00', utcOffsetMinutes: 120, source: 'exif' }],
        ['JPEG EXIF, big-endian, no offset', photo('be.jpg', { le: false, date: '2019:07:04 08:00:00' }), { at: '2019-07-04T08:00:00', utcOffsetMinutes: null, source: 'exif' }],
        ['no date inside, a camera file name', tagged('VID_20240315_181500.mp4', []), { at: '2024-03-15T18:15:00', utcOffsetMinutes: null, source: 'filename', circa: true }],
        ['a forwarded video: container time, marked as an estimate', tagged('VID-20241226-WA0003.mp4', ['creation_time=2024-12-26T08:00:00Z']), { at: '2024-12-26T10:00:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem', circa: true }],
        ['rotated, variable frame rate: conformed, the date kept', file('phone.mp4'), { at: '2023-04-06T10:00:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' }],
      ];
      const rows: { what: string; ok: boolean; got: unknown; want: Capture; conformed: boolean }[] = [];
      for (const [what, path_, want] of expected) {
        const { asset } = await upload(pid, path_);
        rows.push({ what, ok: JSON.stringify(sortKeys(asset.capture)) === JSON.stringify(sortKeys(want)), got: asset.capture ?? null, want, conformed: !!asset.conform });
      }
      const right = rows.filter((r) => r.ok).length;
      const phone = rows[7]!;
      check(`1. capture dates: ${right}/8 uploaded files get exactly the date typed here; the same UTC hour is 17:30 in winter and 18:30 in summer; the conformed file keeps its date`, right === 8 && phone.conformed, { wrong: rows.filter((r) => !r.ok), conformedPhone: phone.conformed });
      const dead = await upload(pid, tagged('dead.mp4', ['creation_time=1970-01-01T00:00:00Z']));
      const place = await upload(pid, tagged('place.mov', ['com.apple.quicktime.creationdate=2024-07-01T18:30:00+0300', 'com.apple.quicktime.location.ISO6709=+32.0853+034.7818+040.000/', 'location=+32.0853+034.7818/'], ['-movflags', 'use_metadata_tags']));
      const gpsPhoto = await upload(pid, photo('gps.jpg', { date: '2024:07:01 18:30:00', offset: '+03:00', gps: true }));
      const fixtureHasPlace = /32\.0853/.test(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', file('place.mov')], { encoding: 'utf8' })) && fs.readFileSync(file('gps.jpg')).includes(Buffer.from([0x25, 0x88]));
      const everything = JSON.stringify(await getDoc(pid)) + JSON.stringify((await call(`/projects/${pid}/history?since=0`)).body) + JSON.stringify((await call(`/projects/${pid}/summary`)).body);
      const leaked = everything.match(/32\.08|34\.78|0853|7818|ISO6709|location|gps|latitude|longitude/i);
      check('1b. a clock that was never set (1970) gives no date; files that say where they were taken are imported with their date and no location anywhere in the project, its summary or its history', dead.asset.capture === undefined && fixtureHasPlace && !leaked && place.asset.capture?.at === '2024-07-01T18:30:00' && gpsPhoto.asset.capture?.at === '2024-07-01T18:30:00' && Object.keys(place.asset.capture ?? {}).sort().join() === 'at,source,utcOffsetMinutes', { deadClock: dead.asset.capture ?? null, fixtureHasPlace, leaked: leaked?.[0] ?? null, placeCapture: place.asset.capture, gpsCapture: gpsPhoto.asset.capture });
      measurements.captures = { right, of: 8, rows: rows.map((r) => ({ what: r.what, got: r.got, conformed: r.conformed })) };
    }

    // ================================================================ 2. field = the same words typed by hand
    {
      const pid = await newProject('2 field equals literal');
      const { assetId } = await upload(pid, file('le.jpg')); // 26 December 2024, 10:00 at +02:00
      const { titleId } = await titled(pid, assetId, 'x');
      await tx(pid, [{ op: 'add_event', args: { assetIds: [assetId], name: EVENT_NAME } }]);
      const rows: { field: string; literal: string; equal: boolean; sha: string }[] = [];
      let sensitive = true;
      for (const [field, stored, literal] of KINDS) {
        await tx(pid, [{ op: 'update_text', args: { clipId: titleId, text: literal } }]);
        const typed = sha(await still(pid, 30));
        await tx(pid, [{ op: 'update_text', args: { clipId: titleId, text: stored } }, { op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]);
        const withField = sha(await still(pid, 30));
        await undo(pid); // back to the plain title, ready for the next kind
        rows.push({ field, literal, equal: typed === withField, sha: withField });
      }
      // the hash is sensitive to the words: other words give another picture
      await tx(pid, [{ op: 'update_text', args: { clipId: titleId, text: 'צולם ב־27 בדצמבר 2024' } }]);
      sensitive = sha(await still(pid, 30)) !== rows[0]!.sha && new Set(rows.map((r) => r.sha)).size === rows.length;
      const equal = rows.filter((r) => r.equal).length;
      check(`2. field = literal: ${equal}/${KINDS.length} kinds of field give a still with the same PNG SHA-256 as the words typed by hand (six Hebrew-side kinds and two English), and other words give another hash`, equal === KINDS.length && sensitive, { rows: rows.map((r) => ({ field: r.field, literal: r.literal, equal: r.equal })), sensitive });
      measurements.fieldEqualsLiteral = { equal, of: KINDS.length, rows };
    }

    // ================================================================ 3, 4, 5. two dates over a cut; export and preview against the stills
    {
      const pid = await newProject('3 two dates over a cut');
      // the same pixels with two dates, so between the two sides of the cut the words are the only difference
      const june = await upload(pid, photo('june.jpg', { date: '2021:06:01 10:00:00', offset: '+03:00' }));
      const december = await upload(pid, photo('december.jpg', { le: false, date: '2024:12:26 10:00:00', offset: '+02:00' }));
      await tx(pid, [{ op: 'add_clip', args: { assetId: june.assetId, start: f(0), duration: f(60) } }, { op: 'add_clip', args: { assetId: december.assetId, start: f(60), duration: f(60) } }]);
      const t = await tx(pid, [{ op: 'add_text', args: { text: '{date}', start: f(30), duration: f(60), style: TITLE_STYLE, transform: { y: 0.2 } } }]);
      const titleId = t.results[0]!.output!.clipId as string;
      await tx(pid, [{ op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]);
      const A = 59, B = 60;
      const pngA = await still(pid, A), pngB = await still(pid, B);
      const stillA = decodePng(pngA), stillB = decodePng(pngB);
      fs.writeFileSync(file('still-59.png'), pngA); fs.writeFileSync(file('still-60.png'), pngB);
      const diff = differingBox(stillA, stillB);
      if (!diff) throw new Error('the stills on the two sides of the cut are identical: the title did not change');
      const box = diff.box;

      // ---- 4a. PNG export (determinism only) and 4b. H.264 export, inside the title's box
      const pngJob = async (frame: number) => { const j = await waitJob((await call(`/projects/${pid}/exports`, { format: 'png', frame })).body.jobId); if (j.status !== 'succeeded') throw new Error(`png export ${j.status}: ${JSON.stringify(j.error)}`); return (await call(`/jobs/${j.id}/output`)).body as Buffer; };
      const pngEqual = sha(await pngJob(A)) === sha(pngA) && sha(await pngJob(B)) === sha(pngB);
      const acc = await call(`/projects/${pid}/exports`, { format: 'mp4-h264-aac', quality: 'high' });
      if (acc.status !== 202) throw new Error(`export refused ${acc.status}: ${JSON.stringify(acc.body).slice(0, 400)}`);
      const job = await waitJob(acc.body.jobId);
      if (job.status !== 'succeeded') throw new Error(`export ${job.status}: ${JSON.stringify(job.error)}`);
      fs.writeFileSync(file('export.mp4'), (await call(`/jobs/${job.id}/output`)).body);
      const raw = ff(['-i', file('export.mp4'), '-vf', 'scale=in_color_matrix=bt709:in_range=limited:out_range=full', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const frames = raw.length / (W * H * 3);
      const exported = (n: number) => raw.subarray(n * W * H * 3, (n + 1) * W * H * 3);
      const side = (n: number, own: Buffer, other: Buffer) => ({ frame: n, psnrGlobal: r3(psnr(own, exported(n), 3)), psnrBoxOwn: r3(psnr(own, exported(n), 3, box)), psnrBoxOther: r3(psnr(other, exported(n), 3, box)), farPixelsOwn: closeness(own, exported(n), 3, box).farPixels, farPixelsOther: closeness(other, exported(n), 3, box).farPixels });
      const eA = side(A, stillA, stillB), eB = side(B, stillB, stillA);
      const differingPixels = closeness(stillA, stillB, 4, box).farPixels;
      const exportOk = (e: typeof eA) => e.psnrGlobal >= TH.psnr && e.psnrBoxOwn >= TH.regionalPsnr && e.psnrBoxOther <= e.psnrBoxOwn - FAR_DB && e.farPixelsOther >= FAR_SHARE * differingPixels;
      check(`4. export = still, inside the title's box: each H.264 frame is within the suite's bounds of its own still (PSNR ≥ ${TH.psnr} dB whole frame, ≥ ${TH.regionalPsnr} dB in the box) and at least ${FAR_DB} dB farther from the other still; ${frames} frames exported`, frames === 120 && exportOk(eA) && exportOk(eB), { box, differingPixels, lastFrameOfA: eA, firstFrameOfB: eB });
      check('4a. (determinism only) the PNG export of both frames is byte-equal to render_frame', pngEqual);
      measurements.exportAgainstStill = { box, differingPixels, frames, lastFrameOfA: eA, firstFrameOfB: eB, bounds: { psnr: TH.psnr, regionalPsnr: TH.regionalPsnr, fartherByDb: FAR_DB, shareStillDiffering: FAR_SHARE } };

      // ---- 5. the paused editor preview of the same two frames
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.addInitScript(() => { (window as any).__pfAudioTap = true; }); // exposes the editor's own player as window.__pfPlayer (player.ts)
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement)?.dataset.frame === '0', undefined, { timeout: 60_000 });
      const preview = async (n: number) => {
        const sought = await page.evaluate((frame) => { const p = (window as any).__pfPlayer; if (!p?.seek) return false; p.pause?.(); p.seek(frame); return true; }, n);
        if (!sought) // the player is not exposed in this build: move the playhead on the ruler as the parity suite does (90 px a second)
          await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); }, (n / 30) * 90 + 0.5);
        await page.waitForFunction((frame) => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return c?.dataset.frame === String(frame) && c.dataset.quality === 'full'; }, n, { timeout: 30_000 });
        await sleep(80);
        const shot = await page.evaluate(async () => {
          const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
          const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
          const data: string = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]!); fr.readAsDataURL(blob); });
          return { w: c.width, h: c.height, frame: c.dataset.frame, data };
        });
        if (shot.w !== W || shot.h !== H || shot.frame !== String(n)) throw new Error(`preview canvas ${shot.w}x${shot.h} frame ${shot.frame}, wanted ${W}x${H} frame ${n}`);
        fs.writeFileSync(file(`preview-${n}.png`), Buffer.from(shot.data, 'base64'));
        return decodePng(Buffer.from(shot.data, 'base64'));
      };
      const pvA = await preview(A), pvB = await preview(B);
      await page.close();
      const pv = (n: number, shot: Buffer, own: Buffer, other: Buffer) => ({ frame: n, own: closeness(own, shot, 4), ownBox: closeness(own, shot, 4, box), otherBoxFarPixels: closeness(other, shot, 4, box).farPixels });
      const pA = pv(A, pvA, stillA, stillB), pB = pv(B, pvB, stillB, stillA);
      const previewOk = (p: typeof pA) => p.own.fractionWithin2 >= TH.previewWithin2 && p.own.farPixels === 0 && p.ownBox.farPixels === 0 && p.otherBoxFarPixels >= FAR_SHARE * differingPixels;
      check(`5. the paused editor preview of both frames equals its server still by the parity suite's preview bound (≥ ${TH.previewWithin2 * 100} % within ${TH.previewTol} levels, none off by more than ${TH.outlier}) and inside the title's box is far from the other still`, previewOk(pA) && previewOk(pB) && pageErrors.length === 0, { lastFrameOfA: pA, firstFrameOfB: pB, differingPixels, pageErrors: pageErrors.slice(0, 3) });
      measurements.previewAgainstStill = { lastFrameOfA: pA, firstFrameOfB: pB };

      // ---- 3. the same two frames with the dates typed by hand (last, because it makes the title plain)
      await tx(pid, [{ op: 'update_text', args: { clipId: titleId, text: JUNE_WORDS } }, { op: 'set_text_fields', args: { clipId: titleId, enabled: false } }]);
      const typedA = sha(await still(pid, A));
      const typedAatB = sha(await still(pid, B));
      await tx(pid, [{ op: 'update_text', args: { clipId: titleId, text: DECEMBER_WORDS } }]);
      const typedB = sha(await still(pid, B));
      check(`3. two dates over a cut: the last frame before the cut equals «${JUNE_WORDS}» typed by hand, the first frame after it equals «${DECEMBER_WORDS}», and they are two pictures (PNG SHA-256)`, typedA === sha(pngA) && typedB === sha(pngB) && sha(pngA) !== sha(pngB) && typedAatB !== sha(pngB), { beforeCut: typedA === sha(pngA), afterCut: typedB === sha(pngB), differ: sha(pngA) !== sha(pngB), juneWordsAfterTheCutAreAnotherPicture: typedAatB !== sha(pngB) });
    }

    // ================================================================ 6. the date stamp from the capture date
    {
      const pid = await newProject('6 date stamp');
      const { assetId, asset } = await upload(pid, file('clock.mov'));
      const clip = await tx(pid, [{ op: 'add_clip', args: { assetId, start: f(0), withLinkedAudio: false } }]);
      const clipId = clip.results[0]!.output!.clipId as string;
      const fx = await tx(pid, [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { source: 'capture' } } }]);
      const effectId = fx.results[0]!.output!.effectId as string;
      const set = (params: Record<string, unknown>) => tx(pid, [{ op: 'update_effect', args: { clipId, effectId, params } }]);
      const LATER = 60 * 30; // 60 seconds on: 18:15:10 has become 18:16:10
      const captured = sha(await still(pid, 0));
      await set({ source: 'text', text: "'24 12 25" });
      const typed = sha(await still(pid, 0));
      await set({ source: 'capture', clock: true });
      const clock0 = sha(await still(pid, 0)), clock60 = sha(await still(pid, LATER));
      await set({ source: 'text', text: "'24 12 25 18:15" });
      const typed0 = sha(await still(pid, 0)), typedOld60 = sha(await still(pid, LATER));
      await set({ text: "'24 12 25 18:16" });
      const typed60 = sha(await still(pid, LATER));
      check('6. the date stamp from the capture date equals the same stamp typed by hand; with the clock, the frame 60 seconds later equals the typed next minute and not the first', captured === typed && clock0 === typed0 && clock60 === typed60 && clock60 !== typedOld60 && captured !== clock0, { capture: asset.capture, dateEqualsTyped: captured === typed, clockAtStartEqualsTyped: clock0 === typed0, clockAfter60sEqualsTypedNextMinute: clock60 === typed60, minuteMoved: clock60 !== typedOld60 });
    }

    // ================================================================ 7. "make it plain text"
    {
      const pid = await newProject('7 freeze');
      const { assetId } = await upload(pid, file('le.jpg'));
      const { titleId } = await titled(pid, assetId, 'צולם ב־{date} · {hebrewDate}', { fields: true });
      const WORDS = 'צולם ב־26 בדצמבר 2024 · כ״ה בכסלו תשפ״ה';
      const before = sha(await still(pid, 30));
      const doc = await getDoc(pid);
      const frozen = freezeOps(doc, doc.mainSequenceId, titleId);
      await tx(pid, frozen.ops);
      const titleOf = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === titleId) as { text: string; fields?: true };
      const plainDoc = await getDoc(pid);
      const after = sha(await still(pid, 30));
      await undo(pid);
      const back = titleOf(await getDoc(pid));
      const restored = sha(await still(pid, 30));
      check('7. "make it plain text": the still is byte-equal before and after, the title holds the words typed here and no fields; undo restores the fields and the same still', before === after && restored === before && titleOf(plainDoc).text === WORDS && titleOf(plainDoc).fields === undefined && back.fields === true && back.text === 'צולם ב־{date} · {hebrewDate}' && frozen.missing.length === 0 && frozen.tooLong.length === 0 && frozen.varies === false, { stillEqual: before === after, text: titleOf(plainDoc).text, fieldsAfter: titleOf(plainDoc).fields ?? null, fieldsAfterUndo: back.fields ?? null, ops: frozen.ops.map((o) => o.op) });
    }

    // ================================================================ 8. exact undo of every operation
    {
      const pid = await newProject('8 exact undo');
      const a = await upload(pid, tagged('undo-a.mp4', ['creation_time=2024-12-25T15:30:00Z'])), b = await upload(pid, tagged('undo-b.mp4', ['creation_time=2024-12-25T16:00:00Z'])), c = await upload(pid, tagged('undo-c.mp4', ['creation_time=2024-07-01T15:30:00Z']));
      const { titleId } = await titled(pid, a.assetId, '{date}');
      const projection = async () => JSON.stringify(creativeProjection(await getDoc(pid)));
      const rows: { op: string; undoExact: boolean; redoExact: boolean; changed: boolean }[] = [];
      /** Commit through `act`, then undo and redo, comparing the creative projection each time. */
      const round = async (op: string, act: () => Promise<unknown>) => {
        const before = await projection();
        await act();
        const after = await projection();
        await undo(pid);
        const undone = await projection();
        await undo(pid, 'redo');
        const redone = await projection();
        rows.push({ op, undoExact: undone === before, redoExact: redone === after, changed: after !== before });
      };
      let eventId = '';
      await round('set_asset_capture', () => tx(pid, [{ op: 'set_asset_capture', args: { assetId: c.assetId, capture: { at: '2020-02-02T12:00:00', utcOffsetMinutes: 120 } } }]));
      await round('shift_asset_captures', () => tx(pid, [{ op: 'shift_asset_captures', args: { assetIds: [a.assetId, b.assetId], minutes: 90 } }]));
      await round('set_text_fields', () => tx(pid, [{ op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]));
      await round('cluster_events', () => tx(pid, [{ op: 'cluster_events', args: {} }]));
      await round('add_event', async () => { eventId = (await tx(pid, [{ op: 'add_event', args: { assetIds: [c.assetId], name: 'יום ההולדת של סבא' } }])).results[0]!.output!.eventId as string; });
      await round('update_event', () => tx(pid, [{ op: 'update_event', args: { eventId, afterSunset: true, addAssetIds: [a.assetId] } }]));
      await round('remove_event', () => tx(pid, [{ op: 'remove_event', args: { eventId } }]));
      // attach_asset_capture is internal: it is reached through the re-read route, on a file whose own date was taken off
      await tx(pid, [{ op: 'set_asset_capture', args: { assetId: b.assetId, capture: null } }]);
      let reread: any = null;
      await round('attach_asset_capture (POST captures/read)', async () => { const r = await call(`/projects/${pid}/captures/read`, {}); if (r.status !== 200) throw new Error(`captures/read ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`); reread = r.body; });
      const attached = (await getDoc(pid)).assets[b.assetId]!.capture;
      const replayEqual = JSON.stringify(s.store.replay(pid).doc) === JSON.stringify(s.store.getProject(pid).doc);
      const exact = rows.filter((r) => r.undoExact && r.redoExact && r.changed).length;
      check(`8. exact undo: ${exact}/${rows.length} operations (seven public ones through REST, attach through the re-read route) are undone to the creative projection of before and redone to that of after; replay equals the stored document`, exact === 8 && rows.length === 8 && replayEqual && reread?.dated === 1 && attached?.at === '2024-12-25T18:00:00', { rows, replayEqual, reread, attached });
      measurements.exactUndo = { exact, of: rows.length, rows, replayEqual };
    }

    // ================================================================ 9. preflight
    {
      // (a) an undated picture under the title, and a DATED picture later on the same track
      const pid = await newProject('9a field without data');
      const undated = await upload(pid, file('picture.jpg'));
      const dated = await upload(pid, file('le.jpg'));
      const clips = await tx(pid, [{ op: 'add_clip', args: { assetId: undated.assetId, start: f(0), duration: f(60) } }, { op: 'add_clip', args: { assetId: dated.assetId, start: f(60), duration: f(60) } }]);
      const t = await tx(pid, [{ op: 'add_text', args: { text: 'צולם ב־{date}', start: f(0), duration: f(60), style: TITLE_STYLE, transform: { y: 0.2 } } }]);
      const titleId = t.results[0]!.output!.clipId as string;
      await tx(pid, [{ op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]);
      const empty = sha(await still(pid, 30));
      const issues = await lifeIssues(pid);
      const refused = await call(`/projects/${pid}/exports`, { format: 'mp4-h264-aac' });
      // the same title with the field taken out, and with the date of the OTHER picture, typed by hand
      await tx(pid, [{ op: 'update_text', args: { clipId: titleId, text: 'צולם ב־' } }, { op: 'set_text_fields', args: { clipId: titleId, enabled: false } }]);
      const without = sha(await still(pid, 30));
      await tx(pid, [{ op: 'update_text', args: { clipId: titleId, text: 'צולם ב־26 בדצמבר 2024' } }]);
      const borrowed = sha(await still(pid, 30));
      const noData = issues.length === 1 && issues[0]!.code === 'field_no_data' && issues[0]!.severity === 'blocker' && issues[0]!.ids[0] === titleId && issues[0]!.ids.includes(clips.results[0]!.output!.clipId) && issues[0]!.range?.startFrame === 0 && issues[0]!.range?.endFrame === 60;
      check('9a. an undated picture under a title with a field, a dated one later on the same track: the field is empty (not the other picture\'s date), the preflight has the blocker field_no_data with the title and its frames, and the export is refused', noData && empty === without && empty !== borrowed && undated.asset.capture === undefined && refused.status === 422 && refused.body?.error?.code === 'render_blocked' && JSON.stringify(refused.body.error.details?.blockers ?? []).includes('field_no_data'), { issues, stillEqualsTitleWithoutTheField: empty === without, stillDiffersFromTheOtherDate: empty !== borrowed, exportStatus: refused.status, exportCode: refused.body?.error?.code });

      // (b) the evening of 25 December 2024 (18:00 on an Israeli winter clock): 24 Kislev before sunset, 25 Kislev after it
      const p2 = await newProject('9b sunset');
      const evening = await upload(p2, photo('evening.jpg', { date: '2024:12:25 18:00:00', offset: '+02:00' }));
      const e = await titled(p2, evening.assetId, '{hebrewDate}', { fields: true });
      const eventId = (await tx(p2, [{ op: 'add_event', args: { assetIds: [evening.assetId] } }])).results[0]!.output!.eventId as string;
      const undecided = await lifeIssues(p2);
      const blockedPlan = (await call(`/projects/${p2}/exports/plan`, { format: 'mp4-h264-aac' })).body.blockers as { code: string }[];
      await tx(p2, [{ op: 'update_event', args: { eventId, afterSunset: true } }]);
      const answered = sha(await still(p2, 30));
      const cleared = await lifeIssues(p2);
      const clearPlan = (await call(`/projects/${p2}/exports/plan`, { format: 'mp4-h264-aac' })).body.blockers as { code: string }[];
      await tx(p2, [{ op: 'update_text', args: { clipId: e.titleId, text: 'כ״ה בכסלו תשפ״ה' } }, { op: 'set_text_fields', args: { clipId: e.titleId, enabled: false } }]);
      const typed = sha(await still(p2, 30));
      await tx(p2, [{ op: 'update_text', args: { clipId: e.titleId, text: 'כ״ד בכסלו תשפ״ה' } }]);
      const dayBefore = sha(await still(p2, 30));
      const sunset = undecided.length === 1 && undecided[0]!.code === 'field_sunset_undecided' && undecided[0]!.severity === 'blocker' && undecided[0]!.ids[0] === e.titleId && undecided[0]!.ids.includes(eventId) && undecided[0]!.range?.startFrame === 0 && undecided[0]!.range?.endFrame === 60;
      check('9b. an evening picture with {hebrewDate}: field_sunset_undecided naming the title and the event; after update_event afterSunset=true the still equals «כ״ה בכסלו תשפ״ה» typed by hand (not the day before) and the plan has no blocker', sunset && blockedPlan.some((b) => b.code === 'field_sunset_undecided') && cleared.length === 0 && clearPlan.length === 0 && answered === typed && answered !== dayBefore, { undecided, blockedPlan: blockedPlan.map((b) => b.code), cleared, clearPlan: clearPlan.map((b) => b.code), stillEqualsTyped: answered === typed, differsFromTheDayBefore: answered !== dayBefore });
    }

    // ================================================================ 12. the calendar inside headless Chromium
    {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${s.url}/selftest.html`);
      await page.waitForFunction(() => typeof (window as any).__pfLife?.hebrewFromRd === 'function', undefined, { timeout: 120_000 });
      const r = await page.evaluate(() => {
        const L = (window as any).__pfLife;
        // the month names this browser's ICU writes (they differ a little between ICU versions; an unknown one is counted as a mismatch)
        const MONTHS: Record<string, string> = { Tishri: 'tishrei', Tishrei: 'tishrei', Heshvan: 'cheshvan', Cheshvan: 'cheshvan', Kislev: 'kislev', Tevet: 'tevet', Shevat: 'shevat', Adar: 'adar', 'Adar I': 'adar1', 'Adar II': 'adar2', Nisan: 'nisan', Iyar: 'iyar', Iyyar: 'iyar', Sivan: 'sivan', Tamuz: 'tammuz', Tammuz: 'tammuz', Av: 'av', Elul: 'elul' };
        const en = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
        const he = new Intl.DateTimeFormat('he-u-ca-hebrew', { timeZone: 'UTC', dateStyle: 'long' });
        const out = { days: 0, date: 0, numerals: 0, weekday: 0, roundTrip: 0, unknownMonth: 0, first: [] as string[], sample: '' };
        const note = (kind: 'date' | 'numerals' | 'weekday' | 'roundTrip' | 'unknownMonth', text: string) => { out[kind]++; if (out.first.length < 8) out.first.push(`${kind}: ${text}`); };
        for (let ms = Date.UTC(2022, 0, 1, 12); ms <= Date.UTC(2027, 11, 31, 12); ms += 86400000) {
          const d = new Date(ms), g = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }, iso = d.toISOString().slice(0, 10);
          out.days++;
          const rd = L.rdFromGregorian(g), h = L.hebrewFromRd(rd), back = L.gregorianFromRd(rd);
          const parts: Record<string, string> = {};
          for (const p of en.formatToParts(d)) parts[p.type] = p.value;
          const month = MONTHS[parts.month!];
          if (!month) note('unknownMonth', `${iso} ${parts.month}`);
          if (h.y !== Number(parts.year) || h.m !== month || h.d !== Number(parts.day)) note('date', `${iso} ours ${h.d} ${h.m} ${h.y}, Intl ${parts.day} ${parts.month} ${parts.year}`);
          if (L.weekdayOf(rd) !== d.getUTCDay()) note('weekday', iso);
          if (L.rdFromHebrew(h) !== rd || back.y !== g.y || back.m !== g.m || back.d !== g.d) note('roundTrip', iso);
          const hp: Record<string, string> = {};
          for (const p of he.formatToParts(d)) if (p.type === 'day' || p.type === 'year') hp[p.type] = p.value;
          if (L.hebrewNumeral(h.d) !== hp.day || L.hebrewNumeral(h.y) !== hp.year) note('numerals', `${iso} ours ${L.hebrewNumeral(h.d)} ${L.hebrewNumeral(h.y)}, Intl ${hp.day} ${hp.year}`);
          if (iso === '2024-12-26') out.sample = `${L.formatHebrewDate(h)} | Hanukkah day ${L.hanukkahDay(rd)} | ${L.holidaysOn(rd, 'day').map((x: { he: string }) => x.he).join(', ')}`;
        }
        return out;
      });
      const version = browser.version();
      await page.close();
      const mismatches = r.date + r.numerals + r.weekday + r.roundTrip + r.unknownMonth;
      check(`12. the calendar inside headless Chromium ${version}: ${r.days} days of 2022–2027 against the page's own Intl (date, Hebrew-letter numerals, weekday, round trips): ${mismatches} mismatches`, r.days === 2191 && mismatches === 0 && r.sample.startsWith('כ״ה בכסלו תשפ״ה | Hanukkah day 1'), r);
      measurements.calendarInChromium = { chromium: version, ...r };
      // for the owner's review: every row of the holiday table of three Hebrew years, with its Gregorian day
      measurements.holidayTable = Object.fromEntries([5785, 5786, 5787].map((y) => [y, holidayTable(y).map((row) => { const g = gregorianFromRd(row.rd); return { date: `${g.y}-${String(g.m).padStart(2, '0')}-${String(g.d).padStart(2, '0')}`, part: row.part, id: row.holiday.id, he: row.holiday.he, en: row.holiday.en }; })]));
    }

    // ================================================================ 13. cost
    {
      const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'proof' };
      const fileOf = (n: number, at: string): Omit<Asset, 'id'> => ({ kind: 'video', name: `cost-${n}.mp4`, contentHash: `sha256:${n.toString(16).padStart(64, '0')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 1800 }, provenance: prov, capture: { at, utcOffsetMinutes: 120, source: 'container' } });
      let n = 0;
      const apply = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `cost${n++}_`, actor: 'proof', allowInternal });
      // 20 pictures of 50 frames each (1,000 frames), each under its own title
      const lib = apply(createProject({ id: 'prj_cost', name: 'cost', width: 1920, height: 1080, frameRate: R }), Array.from({ length: 20 }, (_, i) => ({ op: 'import_asset', args: { asset: fileOf(i + 1, `2024-${String((i % 12) + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}T10:00:00`) } })), true);
      const withClips = apply(lib.doc, lib.results.map((r, i) => ({ op: 'add_clip', args: { assetId: r.output!.assetId, start: f(i * 50), duration: f(50), withLinkedAudio: false } })));
      const build = (text: (i: number) => string, fields: boolean) => {
        const t = apply(withClips.doc, Array.from({ length: 20 }, (_, i) => ({ op: 'add_text', args: { text: text(i), start: f(i * 50), duration: f(50) } })));
        return fields ? apply(t.doc, t.results.map((r) => ({ op: 'set_text_fields', args: { clipId: r.output!.clipId, enabled: true } }))).doc : t.doc;
      };
      const live = build(() => '{date} · {hebrewDate} · {year}', true), typed = build(() => '15 במרץ 2024 · ה׳ באדר ב׳ תשפ״ד · 2024', false);
      const run = (doc: ProjectDocument) => { const per: number[] = []; for (let i = 0; i < 1000; i++) { const t0 = performance.now(); evaluate(doc, f(i)); per.push(performance.now() - t0); } return median(per); };
      run(live); run(typed); // warm-up (the engine's per-document index is built on first use, as in the editor)
      const liveMs: number[] = [], typedMs: number[] = [];
      for (let round = 0; round < 7; round++) { typedMs.push(run(typed)); liveMs.push(run(live)); }
      // a fresh document each time: the cost of the first frame after an edit (the index is rebuilt)
      const firstFrame = median(Array.from({ length: 15 }, () => { const d = structuredClone(live); const t0 = performance.now(); evaluate(d, f(0)); return performance.now() - t0; }));
      const added = median(liveMs) - median(typedMs);
      const titlesLive = evaluate(live, f(10)).layers.filter((l) => l.kind === 'text').length;

      // commit latency in a project with 500 dated files and 60 events (through REST, on this server)
      const pid = await newProject('13 commit latency');
      const day = (i: number) => `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
      const ops: OpCall[] = Array.from({ length: 500 }, (_, i) => ({ op: 'import_asset', args: { asset: fileOf(10_000 + i, `${day(i % 60)}T${String(9 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`) } }));
      const imported = s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops }).results.map((r) => r.output!.assetId as string);
      const clustered = await tx(pid, [{ op: 'cluster_events', args: { gapMinutes: 600 } }]);
      const events = Object.keys((await getDoc(pid)).events ?? {});
      const timed = async (op: OpCall) => { const t0 = performance.now(); await tx(pid, [op]); return performance.now() - t0; };
      const latencies: number[] = [];
      for (let i = 0; i < 15; i++) {
        latencies.push(await timed({ op: 'update_event', args: { eventId: events[i % events.length]!, afterSunset: i % 2 === 0 } }));
        latencies.push(await timed({ op: 'set_asset_capture', args: { assetId: imported[i]!, capture: { at: `2023-01-${String(i + 1).padStart(2, '0')}T12:00:00` } } }));
      }
      const cost = { evaluate: { frames: 1000, liveTitles: 20, medianMsPerFrameLive: r3(median(liveMs)), medianMsPerFrameTyped: r3(median(typedMs)), addedMsPerFrame: r3(added), budgetMs: 0.2, withinBudget: added <= 0.2, firstFrameAfterAnEditMs: r3(firstFrame) }, commit: { datedFiles: imported.length, events: events.length, created: (clustered.results[0]!.output!.created as string[]).length, commits: latencies.length, medianMs: r3(median(latencies)), maxMs: r3(Math.max(...latencies)) } };
      measurements.cost = cost;
      if (!cost.evaluate.withinBudget) console.log(`  note: the added cost per frame (${cost.evaluate.addedMsPerFrame} ms) is over the 0.2 ms budget on this run; recorded, not judged (the machine is shared)`);
      check('13. cost recorded: evaluate over 1,000 frames with 20 live titles against the same timeline with typed titles, and the commit latency with 500 dated files and 60 events', Number.isFinite(added) && titlesLive === 1 && imported.length === 500 && events.length === 60 && latencies.every((x) => Number.isFinite(x)), cost);
    }
  } finally {
    await browser.close().catch(() => {});
    await s.close();
  }
}

/** A value with its object keys in order, so two captures compare by content. */
function sortKeys(v: unknown): unknown {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortKeys(x)])) : v;
}

main().catch((e) => { console.error(e); check('the proof ran to the end', false, { error: String(e?.stack ?? e).slice(0, 800) }); }).finally(() => {
  const failed = checks.filter((x) => !x.ok);
  const result = blocked ? 'BLOCKED' : failed.length || checks.length === 0 ? 'FAILED' : 'PASSED';
  const report = {
    proof: 'lifeline', adr: 'ADR-0021', ranAt: new Date().toISOString(), result, passed: checks.length - failed.length, total: checks.length, ...(blocked ? { blocked } : {}),
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, node: process.version, icu: process.versions.icu, ffmpeg: (() => { try { return execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0]; } catch { return null; } })() },
    scope: 'The life line (ADR-0021) through the real server, the render worker and headless Chromium, on files generated here (ffmpeg -metadata, a hand-built EXIF segment) at 640x360: capture dates at import, title fields and the capture-sourced date stamp against the same words typed by hand, H.264 export and the paused preview against the stills, "make it plain text", undo of every operation, the preflight, the calendar in Chromium, cost. Not covered: real phone files (the owner\'s own clips), cameras that write local time labelled as UTC or the end of the recording, HEIC photos, people (not part of this build), the editor screens (proof:lifeline-ui). Nobody looked at the pictures.',
    homeZone: 'Asia/Jerusalem', measurements, checks,
  };
  if (!blocked) {
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/lifeline-proof.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`\nLife line proof ${report.result}: ${report.passed}/${report.total}`);
  process.exitCode = result === 'PASSED' ? 0 : result === 'BLOCKED' ? 2 : 1;
});
