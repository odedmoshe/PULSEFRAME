/**
 * pnpm proof:tripmap — «מפת טיול», the trip map (wave 8 tripmap track; .artifacts/wave8/tripmap-plan.md §5 as corrected by
 * tripmap-verify.md: no follow camera, no place route or find_place, two looks, bars only, no MAP_DATA_SHA256, no preflight blocker).
 * LEAD: the entry point and the list of checks. Built in parts: tripmap-proof.core.ts (W1: 1, 8, 12, 14 against the real ops and the
 * server), tripmap-proof.draw.ts (W2: 2–4, 6, 7, 9–11, 13, 16–19 against the pinned Chromium render page) and tripmap-proof.ui.ts
 * (W3: 5, 15); the integration step imports them here and sets TRIPMAP_PROOF_BUILT. Until then it runs nothing and exits 2 (blocked),
 * the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC only, made at proof time: a 6-second accented click loop at 120 bpm in 4/4 from ffmpeg sine bursts (the first
 * of every four louder), analysed by the existing beat job; stops typed as coordinates; a 1280×720 project at 30 fps (60 fps for the
 * second flash sweep) and a 720×1280 linked format. No owner media; deleted at the end. Nobody here can look: every check is a
 * measurement, none says how a map looks.
 */
export const TRIPMAP_PROOF_BUILT = false;
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

if (!TRIPMAP_PROOF_BUILT) {
  console.error(`tripmap-proof: not built yet; ${Object.keys(TRIPMAP_CHECKS).length} checks pending (${Object.keys(TRIPMAP_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
