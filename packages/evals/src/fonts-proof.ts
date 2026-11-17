/**
 * `pnpm proof:fonts` — the Hebrew title fonts (ADR-0022) in headless Chromium through the still route. Evidence:
 * docs/evidence/fonts-proof.json and docs/evidence/fonts-golden.json.
 *
 * CONTRACT FILE (lead pre-pass): the script name and the evidence paths are fixed; the proof is W2's. Until it is written this
 * exits 2 = blocked, and proves nothing.
 *
 * What the checks must be able to fail for (the verifier's corrections win over the plan):
 * - per-mark zone check, for every family and weight: render letter+mark and the letter alone at 200 px; the changed pixels'
 *   horizontal centre lies inside the letter's ink box ± 10 % of the em; below-points (U+05B0–05B8, U+05BB, U+05C7) entirely
 *   below the baseline row; holam U+05B9 above the x-height row; dagesh U+05BC inside the ink box; shin dot U+05C1 in the upper
 *   right half, sin dot U+05C2 in the upper left half. A control that must fail: the mark drawn as a separate fillText at the
 *   pen origin;
 * - goldens: one pointed line per family and weight, starting and ending with unpointed wide letters; SHA-256 pinned for the
 *   recorded Chromium, all pairwise different; the evidence says that a first recording proves nothing by itself;
 * - preview canvas = still = exported frame for one family per category;
 * - the ensureFonts time and both bundle totals (woff2, and woff2 + woff) are recorded.
 */
console.error('proof:fonts is not built yet (Hebrew title fonts, ADR-0022): the contracts are in place and the proof is W2\'s. Nothing was checked.');
process.exit(2);
