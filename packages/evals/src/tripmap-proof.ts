/**
 * pnpm proof:tripmap — «מפת טיול», the trip map (wave 8 tripmap track; .artifacts/wave8/tripmap-plan.md §5 as corrected by
 * tripmap-verify.md: no follow camera, no place route or find_place, two looks, bars only, no MAP_DATA_SHA256, no preflight blocker).
 * LEAD: the entry point and the list of checks. Built in parts: tripmap-proof.core.ts (W1: 1, 8, 12, 14 against the real ops and the
 * server), tripmap-proof.draw.ts (W2: 2–4, 6, 7, 9–11, 13, 16–19 against the pinned Chromium render page) and tripmap-proof.ui.ts
 * (W3: 5, 15); wired here at integration (TRIPMAP_PROOF_BUILT). The parts run one after another (one server and one browser at a time).
 * Exit 0 when every gated check passes, 1 when one fails, 2 when none fails but one is blocked (cannot run here). Check 19 is recorded,
 * not gated; check 5 is labelled "pinned Chromium only, not verified on the laptop" (C12). Evidence: docs/evidence/tripmap-proof.json.
 * Fixtures are SYNTHETIC only, made at proof time: a 6-second accented click loop at 120 bpm in 4/4 from ffmpeg sine bursts (the first
 * of every four louder), analysed by the existing beat job; stops typed as coordinates; a 1280×720 project at 30 fps (60 fps for the
 * second flash sweep) and a 720×1280 linked format. No owner media; deleted at the end. Nobody here can look: every check is a
 * measurement, none says how a map looks.
 */
import fs from 'node:fs';
import path from 'node:path';

export const TRIPMAP_PROOF_BUILT = true;
export const TRIPMAP_CHECKS: Readonly<Record<string, string>> = {
  1: 'add_trip_map with three stops makes exactly one drawn clip of kind map on a titles track, coordinates at 0.01°, even times; one undo restores the document hash',
  2: 'at each arrival frame the marker\'s centroid (its look colour, searched in a 24-px window) is within 1.5 px of the position Node predicts with cameraAt + mercator',
  3: 'at progress 0.5 of leg 1, the route colour is present at 10 sampled points of the predicted path before the marker and absent at 10 after it',
  4: 'a flight leg\'s midpoint lies on the lifted great circle (within 2 px) and not on the straight line',
  5: 'in the pinned Chromium only (not verified on the laptop: C12): the paused editor preview equals the server still byte for byte at 3 frames; an exported frame is within PSNR 40 dB of the still',
  6: 'stills of 20 frames rendered in shuffled order are byte-identical to the same frames rendered in order',
  7: 'trim the clip\'s start by 1 s and split it at its middle: stills at the same timeline times are byte-identical to before (nothing drawn reads the clip\'s start or length: C4)',
  8: 'time_trip_map bars: each at is the nearest frame to its bar start of the analysed loop and |residual| ≤ half a frame (C3); with no music the op answers map_no_music with its Hebrew wording over REST',
  9: 'labels, fixture «תל אביב / יפו / אילת» (Jaffa 4 km away): on every frame no two visible label boxes overlap, every visible label lies inside the 5 % inset, «יפו» is reported hidden, and each label\'s side is the same on every frame',
  10: 'the 9:16 format\'s last frame shows every stop marker inside its frame',
  11: 'flash gate per look (C6), paper and night: a scripted pan at MAX_PAN_RATE and a zoom at MAX_ZOOM_RATE over the densest region (the Aegean) at the widest and the narrowest level, labels and rings on, at 30 and 60 fps, through the painter on the render page: the analyser reports no failing stretch; plus the unit rule (fills < 0.1 apart through flashCells, coast step ≤ 0.35, no saturated red)',
  12: 'refusals answer with their reason and Hebrew text over REST: 13 stops, a 41-letter name, latitude 81°, two identical stops in a row, legs under 1 s, a travel mode on stop 0; update_text and apply_text_preset on a map clip answer drawn_not_text',
  13: 'with the outline chunk made unloadable (test flag on the render page), a still is refused naming drawn.map with the reason; with it loadable the same still succeeds',
  14: 'agent path: an edit-grant MCP client calls add_trip_map and get_timeline shows only the summary (stop count, modes, names, look, timing); a propose-mode client gets a proposal, not an edit; no route or tool named place exists',
  15: 'editor, keyboard only: Text rail → «מפת טיול חדשה» → type a listed name, Enter → type an unlisted name → the picker opens → arrows + Enter place it → «יצירה» → the clip is on the timeline at the playhead; «עריכת המפה» → change the look → one undo restores it',
  16: 'the web bundle holds the outline chunk; THIRD_PARTY_NOTICES.txt holds the Natural Earth block; nothing in the bundle\'s map data is a border (only land and lakes levels)',
  17: 'C2: on a 9° view centred on the detail box edge (lat 36.5) and on a view of north Greenland (lat 80), no pixel of the coast colour lies on the crop or clip line',
  18: 'antimeridian: a flight Tokyo → Los Angeles shows land on both sides of ±180° on every sampled frame (world copies at ±360°)',
  19: 'recorded, not gated: ms per frame of the painter at 1080p for an Israel view and a Europe view, round against bevel joins (one sample each)',
};

/** Checks that are measured and written down but never fail the proof. */
export const TRIPMAP_RECORDED_ONLY: readonly number[] = [19];
/** Labels written beside a check's result. */
export const TRIPMAP_LABELS: Readonly<Record<number, string>> = { 5: 'pinned Chromium only, not verified on the laptop (C12)', 19: 'recorded, not gated (one sample each)' };

interface Row { id: number; name: string; ok: boolean; blocked?: string; label?: string; detail?: unknown }

async function main(): Promise<number> {
  const { runTripmapCore } = await import('./tripmap-proof.core.ts');
  const { runTripmapDraw } = await import('./tripmap-proof.draw.ts');
  const { runTripmapUi } = await import('./tripmap-proof.ui.ts');
  const rows = new Map<number, Row>();
  const put = (r: Row) => { rows.set(r.id, { ...r, name: TRIPMAP_CHECKS[r.id] ?? r.name, ...(TRIPMAP_LABELS[r.id] ? { label: TRIPMAP_LABELS[r.id] } : {}) }); };
  const started = Date.now();
  console.log('tripmap-proof: part core (checks 1, 8, 12, 14)');
  const core = await runTripmapCore();
  if ('blocked' in core) for (const id of [1, 8, 12, 14]) put({ id, name: '', ok: false, blocked: core.blocked });
  else for (const [k, v] of Object.entries(core)) put({ id: Number(k), name: '', ok: v.ok, detail: v.detail });
  console.log('tripmap-proof: part draw (checks 2-4, 6, 7, 9-11, 13, 16-19)');
  const draw = await runTripmapDraw();
  for (const c of draw.checks) put({ id: c.id, name: c.name, ok: c.ok, ...(c.blocked ? { blocked: c.blocked } : {}), detail: c.detail });
  console.log('tripmap-proof: part ui (checks 5, 15)');
  const ui = await runTripmapUi();
  for (const [k, v] of Object.entries(ui)) put({ id: Number(k), name: '', ok: v === true, ...(v === true ? {} : { detail: v }) });
  // a check no part answered fails: every check of TRIPMAP_CHECKS runs and can fail
  for (const k of Object.keys(TRIPMAP_CHECKS)) if (!rows.has(Number(k))) put({ id: Number(k), name: '', ok: false, detail: 'no part answered this check' });
  const all = [...rows.values()].sort((a, b) => a.id - b.id);
  const gated = all.filter((r) => !TRIPMAP_RECORDED_ONLY.includes(r.id));
  const failed = gated.filter((r) => !r.ok && !r.blocked), blocked = gated.filter((r) => r.blocked);
  console.log('');
  for (const r of all) console.log(`${r.ok ? '  ok  ' : r.blocked ? ' BLOCK' : TRIPMAP_RECORDED_ONLY.includes(r.id) ? ' (rec)' : ' FAIL '} ${r.id}. ${r.label ? `[${r.label}] ` : ''}${r.blocked ?? ''}${!r.ok && !r.blocked ? ` ${JSON.stringify(r.detail).slice(0, 300)}` : ''}`);
  const evidence = {
    proof: 'proof:tripmap', ranAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000),
    note: 'Measurements on synthetic fixtures in the pinned headless Chromium. Nobody here has looked at a map: no check says how a map looks.',
    passed: gated.filter((r) => r.ok).length, gated: gated.length, failed: failed.map((r) => r.id), blocked: blocked.map((r) => r.id), recordedOnly: TRIPMAP_RECORDED_ONLY,
    checks: all, measurements: draw.measurements,
  };
  const out = path.resolve(import.meta.dirname, '../../../docs/evidence/tripmap-proof.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`tripmap-proof: ${evidence.passed}/${evidence.gated} gated checks passed; failed [${evidence.failed.join(', ')}]; blocked [${evidence.blocked.join(', ')}]; written ${path.relative(process.cwd(), out)}`);
  return failed.length ? 1 : blocked.length ? 2 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
