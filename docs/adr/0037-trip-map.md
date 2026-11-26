# ADR-0037: «מפת טיול» — a trip map drawn as a clip (wave 8, track tripmap, version 1)

Status: **Accepted (lead, 2026-11-26)** — a pre-pass, three builders and an integration round, merged. `pnpm proof:tripmap` passes 18 of
18 gated checks in one run on synthetic fixtures in the pinned Chromium (check 19, drawing time, is recorded and not gated). The
integrator looked at a few rendered stills for coastline, route and Hebrew labels; nobody has judged how the two looks read. The place
list is Natural Earth v5.1.2's populated places inside the box that have a Hebrew name: «אילת», «פטרה», «טאבה» and «דהב» are not in
that file and are placed with the picker. Not run on the merged tree: `pnpm check` as a whole, the phase proofs, parity. Check 5 (the
font in the picker) is not verified on the owner's laptop.

## Context
The owner wants «מפת טיול»: a moving map of a trip (stops, travel modes, a marker that travels, names in Hebrew) inside a film,
drawn by the same compositor as everything else, with no network, no tiles and no online maps. The carrier pre-pass made one clip
type `drawn` on titles tracks with a discriminated payload; ink and map are its two kinds.

## Decision
1. Storage. A map is `type: 'drawn'` with `drawn: { kind: 'map', v: 1, look, camera: 'whole', timing, timedTo?, stops[] }`. Stops
   hold the owner's integers only: id, name (≤ 40 letters, verbatim), lon/lat in micro-degrees on the 0.01° grid (the schema refuses
   other values and every op rounds), `at` in clip-local frames, `via` (road, flight, boat) for the leg INTO the stop, `hidden` for a
   via-point, optional `placeId`. Nothing computed (camera, route samples, label boxes) is stored. No schema version bump: a document
   without a map is byte-identical; an older build refuses one with an unknown clip type.
2. Ops. `add_trip_map`, `update_trip_map`, `time_trip_map` are public ops through `Store.commit`; each refusal has its reason, its
   Hebrew wording and a next step. `add_trip_map` takes an optional `timing: 'even' | 'bars'` that gives the same document as add
   then time in ONE transaction (one undo); the dialog's «יצירה» uses it. Text ops on a map refuse with `drawn_not_text`, worded in
   Hebrew as a trip map pointing to «עריכת המפה». The ops are kept out of the assistants; agents may add a map through MCP with an
   edit grant and see only the summary (stop count, modes, names, look, timing) in `get_timeline`. There is no place route and no
   `find_place`: the place search lives in the dialog over a committed list.
3. Time (ADR-0003). Even timing: `at_i` = INTRO + i·(D − INTRO − OUTRO)/(n − 1), each one integer fraction rounded once (ties up).
   Bar timing: the nearest frame to each chosen bar start from `musicAt(...).bars`, 1 bar a leg, else 2 when 1 leaves a leg under
   a second; the residual (|r| ≤ half a frame) is reported, never stored as time. Progress inside a leg is a ratio of two integers.
   Nothing drawn reads the clip's start or length (C4): trim-start and split leave stills byte-identical at the same timeline times.
4. One path (ADR-0005). Preview, `render_frame` and export draw the map through the carrier's painter registry (`paintDrawn` →
   engine `map/paintMap.ts`); the outline chunk is loaded by the carrier's `ready` hook; a page that cannot load it refuses a still
   naming `drawn.map` with the reason. The dialog's picker draws through the same `drawGraph`.
5. Geometry, shared by the painter and the proof: core `stopPoints`, `cameraAt` (whole-trip fit with label room, push-in by 0.9
   from the first stop's `at` to the last, snapped to a power-of-two grid no coarser than 1/64 output pixel), `toScreen`, `legPath`
   (flight: 64 slerp samples with a visual lift), `pathPointAt` (arc length; the marker and the travelled route), `placeLabels`
   (a heuristic: beside, then above, then below, within a 5 % inset; a stop within 1 em of a labelled one is hidden; decided once
   per payload and output size from widths measured in the bundled Heebo 700 once it is loaded, then kept on every frame). Labels are
   placed against EVERY stop's dot, hidden via-points included. The dialog lists the names that will not be shown from the same layout.
6. Data. Natural Earth v5.1.2 (public domain) at a pinned commit, processed by `tools/tripmap/build-data.mjs` into committed files:
   land and lakes outlines in three levels (coarse, world, detail box around Israel), projected at build time, coastlines only, never
   a border, never a stroked cut edge (C2); a place list of [id, Hebrew name, English name, lon, lat]. Sizes and SHA-256 are tested;
   THIRD_PARTY_NOTICES.txt carries the Natural Earth block. The list has no Eilat, Petra, Taba, Dahab or Sharm el-Sheikh: those
   are placed by clicking on the picker and named by the owner.
7. Flash safety (ADR-0009). The two looks (paper, night) are a fixed colour table whose fills differ by < 0.1 and whose coast step
   is ≤ 0.35 (unit rule through `flashCells`); the gate is the analyser sweep per look at 30 and 60 fps over the Aegean and a wide view.

## Consequences
- The interface shows the entry only when ops, painter and interface are all built (`TRIPMAP_ENTRY_SHOWN`).
- What nobody has done: looked at a map with a person's eyes for taste, checked the Hebrew spellings of the place list, run it on
  the owner's laptop (check 5's editor-equals-still is measured in the pinned Chromium only, C12).
- Cut in version 1: a follow camera, a place route or MCP tool, more than two looks, preflight blockers, roads, tiles, terrain.

## Evidence
`pnpm proof:tripmap` (docs/evidence/tripmap-proof.json): 18 of 18 gated checks pass on synthetic fixtures; check 19 recorded
(painter at 1920×1080: 1.28 ms/frame Israel view, 2.55 ms/frame Europe view; round joins 8.61 ms, bevel 11.17 ms per draw; one
sample each in this container).
