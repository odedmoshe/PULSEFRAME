/**
 * `pnpm proof:packs` — the end-to-end proof of the content packs (ADR-0022; plan §10 with the verifier's corrections), on a CPU,
 * with no model. Evidence: docs/evidence/packs-proof.json.
 *
 * CONTRACT FILE (lead pre-pass): the script name and the evidence path are fixed; the proof is the lead's, written after W1,
 * W2 and W3 have merged. Until then this exits 2 = blocked, and proves nothing.
 *
 * What the checks must be able to fail for:
 * - P0: `git diff --stat <contracts commit>..<each worker branch head> -- packages/engine` is empty, taken per worker branch
 *   before integration, with the commit ids recorded (sibling tracks may touch the engine; they are not this track);
 * - P1: each pack template and tpl.birthday: plan → apply on fixtures → one transaction; undo restores the pre-apply document
 *   hash, redo the applied one; media counts 1, 3, 8, 12, tempo normal/half/double, 24/25/30 fps, with and without built-in
 *   music: apply never fails after a clean plan;
 * - P2: all pack elements rasterise at 1024 px with alpha, 2–90 % coverage, pairwise different;
 * - P3: each pack look at its defaults over a bright and a dark fixture for 10 s: the flash analyser reports no range;
 * - P5: one pack project: preview canvas = still = exported frame at 5 sampled frames (the parity suite's bounds);
 * - P10: check:notices lists every bundled title font with its OFL text; the bundle delta is recorded (woff2 and woff2 + woff);
 * - P11: suggestion: 2026-11-17 → Hanukkah first, 17 days to the evening of 4 December; 2027-01-05 → none;
 * - an element or a sound added from a pack page: one undo removes the clip and the file stays in the library (said in the UI);
 * - expected strings are typed in this file, never computed by the code under test.
 */
console.error('proof:packs is not built yet (content packs, ADR-0022): the contracts are in place and the proof is the lead\'s after the workers merge. Nothing was checked.');
process.exit(2);
