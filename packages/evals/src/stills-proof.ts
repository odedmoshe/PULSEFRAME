/**
 * pnpm proof:stills — «הפריים הכי חד» and «שמירת התמונה» (wave 8 cover, version 1; .artifacts/wave8/cover-verify.md "Proof additions",
 * cover-plan §5 as cut). The entry point and the list of checks. Parts, each owned by one builder: stills-proof.measure.ts (W1:
 * M1–M12, Node and server only), stills-proof.still.ts (W2: P1–P9, server only), stills-proof.ui.ts (W3: U1–U5, the editor in
 * Chromium), run one after the other (never two at once on this machine). Exit 0 = every check passed; 1 = a check failed (its
 * numbers are in the evidence, never relaxed); 2 = blocked (a part could not run here), never a pass.
 * Fixtures are SYNTHETIC only, made by the proof (ffmpeg and Node), in a temp dir, deleted after. Frames and ranks are asserted on
 * lossless fixtures, never absolute numbers against a committed value (C12). Writes docs/evidence/stills-proof.json when built; one
 * timing sample, labelled "one sample, this container", never gated.
 */
export const STILLS_PROOF_BUILT = true;
export const STILLS_CHECKS: Readonly<Record<string, string>> = {
  // W1 — the measurement
  M1: 'F1 blur ramp (120 frames 1280x720, lossless, frame k box-blurred by |k−47|): every frame measured (complete), candidate 1 is frame 47; the proof\'s own decode + Sobel + Immerkær σ gives the same integers',
  M2: 'a barcode clip with B-frames, measured at frames 913–960 of 1200 by input seek, delivers exactly those frames (barcode read in rgb24 from the same seek)',
  M3: 'the same file remuxed to MPEG-TS with a start time of about 1.4 s delivers exactly the same frames',
  M4: 'a 60 fps file in a 30 fps project: rangeOfClip counts every source frame of the clip; the answer has one record per source frame',
  M5: 'noise (C3) PASSES: a blurred frame with grain σ 6 ranks below a clean sharp frame; its sigma100 is about 600 and its raw sobel above its sharp',
  M6: 'F3 motion: frames 31–35 shifted 6 px and box-blurred along x rank below the static frame 37; their motion > 0 and frame 37\'s is 0',
  M7: 'F4 exposure: candidates in 60–70 report hi ≥ 250‰ and manyClipped; the answer carries STILLS_METHOD and both labels',
  M8: 'a second request is { cached: true } and starts no ffmpeg (spawn counter); extending the stretch reads only the new frames (plus the one before); two cold runs give byte-identical data files',
  M9: 'a stretch of 601 frames is 422 stills_range_too_long with its Hebrew; a picture file is no_video; a clip of another file invalid_request',
  M10: 'cancel during the read writes no derivative; a job cut off by a restart is recovered and completes',
  M11: 'a server export started during a measurement finishes first (the moments lane); one stills job per project (409), three per server (429)',
  M12: 'an agent credential: find_sharp_frames and read_sharp_frames answer numbers only (no image part); the observer may read and not start',
  // W2 — the saved picture
  P1: 'F5 photo 3000x2000 PNG (one-pixel checkerboard + coordinate barcode), 10x15 landscape crop at (37, 21): the PNG output equals the source crop pixel for pixel (PNG is the exact form); JPEG (mjpeg 4:4:4, lossy) within PSNR ≥ 40 dB of it',
  P2: 'an odd-sized PNG (3001x2001) saved whole is exactly 3001x2001 and equal pixel for pixel',
  P3: 'F6 barcode video 1920x1080 in a 1280x720 project: the still is 1920x1080 (above the project size) and its barcode reads the asked source frame',
  P4: 'a JPEG photo with EXIF orientation 6 (APP1 inserted by proof code) is saved turned, equal to the server still of the same stillDocument',
  P5: 'printFit: 1920x1080 → 10x15 landscape 270 usual, A4 landscape 130 soft; 3840x2160 A4 261; a table of 12 hand values; the ppi tiers are labelled a rule of thumb',
  P6: 'a still output carries no format or stream tags (ffprobe), the codec is png or mjpeg and the size equals the crop; no date, no EXIF',
  P7: 'an agent asking for still gets 403 owner_required at POST …/exports, export_project, export_batch and retry; the browser route refuses it 409',
  P8: 'a picture over 8192 on a side is still_too_large with its Hebrew; over 24 MP is labelled untried; a frame outside the file out_of_bounds',
  P9: 'a conformed file\'s still says so (reasons; «הומר מ־HDR» for hdr) and the output records source.conformed',
  // W3 — the editor
  U1: 'Hebrew: the inspector section «הפריים הכי חד» on a selected clip → up to three tiles with numbers, σ and the label; «נמצאו {n}» for a clip shorter than 2 s',
  U2: '← / → change the tile\'s frame by one source frame and its numbers; Shift one second; a frame without a record says «לא נמדד»',
  U3: 'the save dialog by keyboard only: paper radios, orientation, the crop moved with arrows changes the ppi line; Escape returns focus; RTL without overlap; English pass too',
  U4: 'the paused editor tile equals the server still of the same one-clip document byte for byte (the same stillDocument)',
  U5: 'one timing sample of a 600-frame 1080p stretch (stage times), labelled "one sample, this container"; new states in audit:a11y, ids in audit:testids',
};

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EVIDENCE = path.join(ROOT, 'docs/evidence/stills-proof.json');
type Row = { id: string; status: 'pass' | 'fail' | 'blocked'; say?: string; numbers?: unknown };

async function main(): Promise<void> {
  if (!STILLS_PROOF_BUILT) {
    console.error(`stills-proof: not built yet; ${Object.keys(STILLS_CHECKS).length} checks pending; nothing was measured`);
    process.exit(2);
  }
  const rows: Row[] = [];
  const evidence: Record<string, unknown> = {};
  const t0 = Date.now();
  // W1: the measurement (server modules in this process)
  {
    const { runStillsMeasureChecks } = await import('./stills-proof.measure.ts');
    const r = await runStillsMeasureChecks();
    evidence.measure = r.evidence;
    for (const [id, v] of Object.entries(r.results)) rows.push(v === true ? { id, status: 'pass' } : { id, status: v.startsWith('BLOCKED') ? 'blocked' : 'fail', say: v });
  }
  // W2: the saved picture (its own server on port 0)
  {
    const { runStillChecks } = await import('./stills-proof.still.ts');
    const checks = await runStillChecks();
    for (const c of checks) rows.push({ id: c.id, status: c.pass === true ? 'pass' : c.pass === null ? 'blocked' : 'fail', ...(c.pass === true ? {} : { say: c.blocked ?? c.name }), numbers: c.numbers });
  }
  // W3: the editor in Chromium (one browser, stopped after)
  {
    const ui = await import('./stills-proof.ui.ts');
    try {
      for (const [id, run] of Object.entries(ui.STILLS_UI_PART.checks)) { const r = await run(); rows.push(r === true ? { id, status: 'pass' } : { id, status: 'fail', say: r }); }
    } finally { await ui.stopUi(); }
    evidence.ui = ui.STILLS_UI_PART.details;
  }
  const seen = new Set(rows.map((r) => r.id));
  for (const id of Object.keys(STILLS_CHECKS)) if (!seen.has(id)) rows.push({ id, status: 'blocked', say: 'not run by any part' });
  rows.sort((a, b) => Object.keys(STILLS_CHECKS).indexOf(a.id) - Object.keys(STILLS_CHECKS).indexOf(b.id));
  for (const r of rows) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id.padEnd(4)} ${STILLS_CHECKS[r.id]}${r.say ? `\n         ${r.say}` : ''}`);
  const n = (s: Row['status']) => rows.filter((r) => r.status === s).length;
  const status = n('fail') ? 'fail' : n('blocked') ? 'blocked' : 'pass';
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify({
    proof: 'stills', status, at: new Date().toISOString(), wallMs: Date.now() - t0,
    summary: { pass: n('pass'), fail: n('fail'), blocked: n('blocked') },
    checks: rows.map((r) => ({ ...r, says: STILLS_CHECKS[r.id] })), evidence,
    notes: ['synthetic fixtures only, made and deleted by the proof', 'timings are one sample in this container, never gated', 'nobody has looked at a tile or a saved picture'],
  }, null, 1)}\n`);
  console.log(`\n${n('pass')} pass, ${n('fail')} fail, ${n('blocked')} blocked · evidence ${path.relative(ROOT, EVIDENCE)}`);
  process.exit(n('fail') ? 1 : n('blocked') ? 2 : 0);
}
void main();
