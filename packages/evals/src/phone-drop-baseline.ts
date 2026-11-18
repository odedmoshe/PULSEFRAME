/**
 * `pnpm proof:phone-drop-baseline` — step 0 of the phone drop (ADR-0023): BEFORE the import queue replaces the synchronous
 * upload, record what today's POST …/assets makes of a fixed set of files, in docs/evidence/phone-drop-baseline.json.
 * proof:phone-drop P18 compares the queue's result against this file in a fresh data directory (a comparison of the new code
 * with itself could not fail, because the queue reuses an earlier conversion of the same original).
 *
 *   pnpm proof:phone-drop-baseline            records the evidence (run on a tree whose ingest.ts and upload route are today's)
 *   pnpm proof:phone-drop-baseline --check    uploads the same files again through POST …/assets and compares with the record
 *
 * Fixtures (made here by ffmpeg, deterministic encoder settings; nothing binary is committed). Each one's sha256 is recorded,
 * so a comparison that regenerates them knows whether it is looking at the same bytes:
 *   A  HEVC, display rotation 90°, variable frame rate, AAC, creation_time and com.apple.quicktime.creationdate (conform: vfr, rotation, codec)
 *   B  H.264 constant rate with creation_time (stored as it is)
 *   C  H.264 with non-square pixels 4:3 (conform: pixel-aspect)
 *   D  HEVC 10-bit, PQ transfer, BT.2020 (conform: codec, hdr)
 *   E  a BMP still (lossless PNG copy: still-format)
 * Recorded per file: the source sha256 and size, the HTTP status, and the whole 201 body (assetId, deduplicated, asset). The
 * comparison ignores only: id, provenance.importedAt, capture, provenance.upload (plan §9 P18 with the verifier's correction).
 *
 * The server runs in this process on its own port with its own data directory under .artifacts/phone-drop-baseline.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phone-drop-baseline');
export const PHONE_DROP_BASELINE_EVIDENCE = path.join(root, 'docs/evidence/phone-drop-baseline.json');
const PORT = Number(process.env.PF_PROOF_PORT ?? 8931);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 28 });
const probe = (file: string): any => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { maxBuffer: 1 << 24 }).toString());
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** Deterministic encoders: one thread, bit-exact flags, no encoder string. */
const BITEXACT = ['-threads', '1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact'];
const X265 = (extra = '') => ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', `pools=1:frame-threads=1:log-level=none${extra}`, '-tag:v', 'hvc1'];

export interface BaselineFixture { key: 'A' | 'B' | 'C' | 'D' | 'E'; name: string; file: string; expect: string }
/** The fixtures of the baseline, made in `dir`. proof:phone-drop P18 calls this to make the same bytes again. */
export function makeBaselineFixtures(dir: string): BaselineFixture[] {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n: string) => path.join(dir, n);
  const av = ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-map', '0:v', '-map', '1:a'];
  // A: HEVC with dropped frames (variable rate), then the display rotation set on a stream copy, Apple's creation date kept.
  ff([...av, '-vf', "select='mod(n\\,3)'", '-fps_mode', 'vfr', ...X265(), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', ...BITEXACT, '-map_metadata', '-1', f('a0.mp4')]);
  ff(['-display_rotation', '90', '-i', f('a0.mp4'), '-c', 'copy', '-movflags', 'use_metadata_tags', '-metadata', 'creation_time=2025-08-14T15:03:22.000000Z', '-metadata', 'com.apple.quicktime.creationdate=2025-08-14T18:03:22+0300', ...BITEXACT, f('A-hevc-rotated-vfr.mp4')]);
  fs.rmSync(f('a0.mp4'));
  // B: H.264 constant rate with creation_time.
  ff([...av, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', ...BITEXACT, '-map_metadata', '-1', '-metadata', 'creation_time=2024-03-01T09:30:00.000000Z', f('B-h264.mp4')]);
  // C: H.264 with a 4:3 sample aspect ratio (anamorphic).
  ff([...av, '-vf', 'setsar=4/3', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', ...BITEXACT, '-map_metadata', '-1', f('C-h264-sar43.mp4')]);
  // D: HEVC 10-bit tagged PQ / BT.2020 (high dynamic range).
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '1', ...X265(':colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc'), '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', ...BITEXACT, '-map_metadata', '-1', f('D-hevc-hdr-pq.mp4')]);
  // E: a BMP still.
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=64x48', '-frames:v', '1', '-c:v', 'bmp', ...BITEXACT, f('E-still.bmp')]);
  return [
    { key: 'A', name: 'A-hevc-rotated-vfr.mp4', file: f('A-hevc-rotated-vfr.mp4'), expect: 'conform: variable-frame-rate, rotation, codec' },
    { key: 'B', name: 'B-h264.mp4', file: f('B-h264.mp4'), expect: 'stored as it is' },
    { key: 'C', name: 'C-h264-sar43.mp4', file: f('C-h264-sar43.mp4'), expect: 'conform: pixel-aspect' },
    { key: 'D', name: 'D-hevc-hdr-pq.mp4', file: f('D-hevc-hdr-pq.mp4'), expect: 'conform: codec, hdr' },
    { key: 'E', name: 'E-still.bmp', file: f('E-still.bmp'), expect: 'still-format: lossless PNG copy' },
  ];
}
/** The fixture is what its row says (checked with ffprobe before use, so a wrong fixture never becomes the baseline). */
function fixtureFacts(fx: BaselineFixture): { ok: boolean; facts: Record<string, unknown> } {
  const p = probe(fx.file);
  const v = (p.streams ?? []).find((s: any) => s.codec_type === 'video');
  const rotation = Number(v?.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? 0);
  const facts = { codec: v?.codec_name, width: v?.width, height: v?.height, avg: v?.avg_frame_rate, r: v?.r_frame_rate, rotation, sar: v?.sample_aspect_ratio ?? null, transfer: v?.color_transfer ?? null, tags: p.format?.tags ?? {} };
  const ok = {
    A: v?.codec_name === 'hevc' && rotation % 360 !== 0 && v?.avg_frame_rate !== v?.r_frame_rate && !!p.format?.tags?.['com.apple.quicktime.creationdate'],
    B: v?.codec_name === 'h264' && v?.avg_frame_rate === v?.r_frame_rate && rotation === 0,
    C: v?.codec_name === 'h264' && v?.sample_aspect_ratio === '4:3',
    D: v?.codec_name === 'hevc' && v?.color_transfer === 'smpte2084',
    E: v?.codec_name === 'bmp',
  }[fx.key];
  return { ok, facts };
}
/** What P18 compares: the asset without the fields a queued import may legitimately add or that depend on the moment. */
export function comparableAsset(asset: any): unknown {
  const { id: _id, capture: _capture, provenance, ...rest } = asset ?? {};
  const { importedAt: _at, upload: _upload, ...prov } = provenance ?? {};
  return { ...rest, provenance: prov };
}
export interface PhoneDropBaseline {
  commit: string; recordedAt: string; ffmpeg: string; freeDiskBytes: number | null;
  compareIgnores: string[];
  files: Record<string, { name: string; expect: string; source: { sha256: string; bytes: number; facts: Record<string, unknown> }; status: number; body: any; conformedSha256: string | null; originalSha256: string | null }>;
}

async function main(): Promise<number> {
  const CHECK = process.argv.includes('--check');
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  const recorded: PhoneDropBaseline | null = CHECK ? JSON.parse(fs.readFileSync(PHONE_DROP_BASELINE_EVIDENCE, 'utf8')) : null;
  const fixtures = makeBaselineFixtures(path.join(art, 'fixtures'));
  for (const fx of fixtures) {
    const { ok, facts } = fixtureFacts(fx);
    if (!ok) { console.error(`fixture ${fx.key} is not what it should be (${fx.expect}): ${JSON.stringify(facts)}`); return 1; }
  }
  let freeDiskBytes: number | null = null;
  try { const s = fs.statfsSync(art); freeDiskBytes = s.bavail * s.bsize; } catch { /* not measurable */ }
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data'), homeZone: 'Asia/Jerusalem' });
  const out: PhoneDropBaseline = {
    commit, recordedAt: new Date().toISOString(), ffmpeg: execFileSync('ffmpeg', ['-version']).toString().split('\n')[0]!, freeDiskBytes,
    compareIgnores: ['id', 'provenance.importedAt', 'capture', 'provenance.upload'], files: {},
  };
  try {
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
    const created = await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'phone drop baseline', width: 640, height: 360, frameRate: { num: 30, den: 1 } }) });
    const pid = ((await created.json()) as any).project.id as string;
    for (const fx of fixtures) {
      const bytes = fs.readFileSync(fx.file);
      const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': encodeURIComponent(fx.name) }, body: new Uint8Array(bytes) });
      const body = (await r.json()) as any;
      out.files[fx.key] = {
        name: fx.name, expect: fx.expect, source: { sha256: sha(bytes), bytes: bytes.length, facts: fixtureFacts(fx).facts }, status: r.status, body,
        conformedSha256: body?.asset?.conform ? String(body.asset.contentHash).replace(/^sha256:/, '') : null,
        originalSha256: body?.asset ? String(body.asset.conform?.originalContentHash ?? body.asset.contentHash).replace(/^sha256:/, '') : null,
      };
      console.log(`${fx.key} ${fx.name}: ${r.status} ${body?.asset?.conform ? `conformed ${out.files[fx.key]!.conformedSha256} (${body.asset.conform.reasons.join(', ')})` : body?.asset ? 'stored as it is' : JSON.stringify(body).slice(0, 200)}`);
    }
  } finally {
    await s.close();
  }
  for (const [k, v] of Object.entries(out.files)) {
    if (v.status !== 201) { console.error(`${k}: the upload was refused (${v.status}); a baseline must hold accepted files`); return 1; }
    if (v.originalSha256 !== v.source.sha256) { console.error(`${k}: the stored original is not the source`); return 1; }
  }
  if (!CHECK) {
    fs.mkdirSync(path.dirname(PHONE_DROP_BASELINE_EVIDENCE), { recursive: true });
    fs.writeFileSync(PHONE_DROP_BASELINE_EVIDENCE, JSON.stringify(out, null, 2) + '\n');
    console.log(`recorded ${Object.keys(out.files).length} files in ${path.relative(root, PHONE_DROP_BASELINE_EVIDENCE)} at ${commit.slice(0, 12)}`);
    return 0;
  }
  let differences = 0;
  for (const [k, then] of Object.entries(recorded!.files)) {
    const now = out.files[k];
    if (!now) { console.error(`${k}: missing now`); differences++; continue; }
    if (now.source.sha256 !== then.source.sha256) { console.error(`${k}: the fixture's bytes differ from the recorded ones (this ffmpeg makes another file); the comparison of this file is not meaningful`); differences++; continue; }
    const same = JSON.stringify(comparableAsset(now.body.asset)) === JSON.stringify(comparableAsset(then.body.asset)) && now.conformedSha256 === then.conformedSha256;
    console.log(`${k}: ${same ? 'same asset and conformed bytes as recorded' : 'DIFFERENT'}`);
    if (!same) differences++;
  }
  return differences ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
