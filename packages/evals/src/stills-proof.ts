/**
 * pnpm proof:stills — «הפריים הכי חד» and «שמירת התמונה» (wave 8 cover, version 1; .artifacts/wave8/cover-verify.md "Proof additions",
 * cover-plan §5 as cut). LEAD: the entry point and the list of checks. Parts, each owned by one builder: stills-proof.measure.ts (W1:
 * M1–M12, Node and server only), stills-proof.still.ts (W2: P1–P9, server only), stills-proof.ui.ts (W3: U1–U5, the editor in
 * Chromium) — W3 also wires them together here and sets STILLS_PROOF_BUILT at integration. Until then it runs nothing and exits 2
 * (blocked), the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC only, made by the proof (ffmpeg and Node), in a temp dir, deleted after. Frames and ranks are asserted on
 * lossless fixtures, never absolute numbers against a committed value (C12). Writes docs/evidence/stills-proof.json when built; one
 * timing sample, labelled "one sample, this container", never gated.
 */
export const STILLS_PROOF_BUILT = false;
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
  P1: 'F5 photo 3000x2000 PNG (one-pixel checkerboard + coordinate barcode), 10x15 landscape crop at (37, 21): the PNG output equals the source crop pixel for pixel; JPEG (mjpeg 4:4:4) within PSNR ≥ 40 dB of it',
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

/** One part of the proof: its checks answer true or the reason they failed. W1 (stills-proof.measure.ts) and W2 (stills-proof.still.ts) export the same shape as W3's. */
export interface StillsProofPart { built: boolean; checks: Record<string, () => Promise<true | string>>; details?: Record<string, unknown> }

async function main(): Promise<void> {
  if (!STILLS_PROOF_BUILT) {
    console.error(`stills-proof: not built yet; ${Object.keys(STILLS_CHECKS).length} checks pending (${Object.keys(STILLS_CHECKS).join(', ')}); nothing was measured`);
    process.exit(2);
  }
  // each part by name, found at run time so a part that is not merged yet is a blocked row, not a crash
  const names = ['./stills-proof.measure.ts', './stills-proof.still.ts', './stills-proof.ui.ts'];
  const rows: { id: string; status: 'pass' | 'fail' | 'pending'; say?: string }[] = [];
  const done = new Set<string>();
  for (const n of names) {
    let part: StillsProofPart | undefined;
    try { const mod = (await import(n)) as Record<string, unknown>; part = Object.values(mod).find((v): v is StillsProofPart => !!v && typeof v === 'object' && 'checks' in v && 'built' in v); } catch { part = undefined; }
    if (!part?.built) continue;
    for (const [id, run] of Object.entries(part.checks)) { const r = await run(); done.add(id); rows.push(r === true ? { id, status: 'pass' } : { id, status: 'fail', say: r }); }
  }
  for (const id of Object.keys(STILLS_CHECKS)) if (!done.has(id)) rows.push({ id, status: 'pending' });
  for (const r of rows) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id.padEnd(4)} ${STILLS_CHECKS[r.id]}${r.say ? `\n         ${r.say}` : ''}`);
  const bad = rows.filter((r) => r.status === 'fail').length, pend = rows.filter((r) => r.status === 'pending').length;
  console.log(`\n${rows.length - bad - pend} pass, ${bad} fail, ${pend} pending`);
  process.exit(bad ? 1 : pend ? 2 : 0);
}
void main();
