/**
 * `pnpm proof:lifeline` — the proof of the life line (ADR-0021) on a CPU, with no model: capture dates read from generated
 * fixtures, a title field against the same words typed by hand, export against still, exact undo of every operation, the
 * preflight, and the calendar inside headless Chromium (through window.__pfLife on the self-test page).
 * Evidence: docs/evidence/lifeline-proof.json.
 *
 * CONTRACT FILE (lead pre-pass): the script name and the evidence path are fixed; the proof is W2's (plan §8 with the
 * verifier's corrections). Until it is written this exits 2 = blocked, and proves nothing.
 *
 * What the checks must be able to fail for (the corrections win over the plan):
 * - expected strings are typed in this file, in Hebrew and English, never computed by the code under test;
 * - export against still is measured inside the title's box: frame A within the parity suite's text bound of still A AND
 *   clearly farther from still B (and the reverse); a PNG export equal to render_frame is determinism only;
 * - the paused preview uses the parity suite's own preview bound;
 * - exact undo: the seven public operations through REST and attach_asset_capture through the re-read route, each undone
 *   and redone, and store.replay equal to the stored document at the end;
 * - the "no data" fixture has an undated clip under the title AND a dated clip later on the same track;
 * - people (ages, names, birth dates, the family-free archive) are not part of this build and have no checks.
 */
console.error('proof:lifeline is not built yet (life line, ADR-0021): the contracts are in place and the proof is W2\'s. Nothing was checked.');
process.exit(2);
