/**
 * `pnpm proof:phone-drop-baseline` — step 0 of the phone drop (ADR-0023): BEFORE the import queue replaces the synchronous
 * upload, record what today's POST …/assets makes of fixture A (HEVC, rotated, variable rate), fixture B (H.264) and one HDR or
 * non-square sample: the asset JSON and the conformed sha256, in docs/evidence/phone-drop-baseline.json. proof:phone-drop P18
 * compares the queue's result against this file (a comparison of the new code with itself could not fail).
 *
 * CONTRACT FILE (lead pre-pass): the script name and the evidence path are fixed. It must be run on a tree whose ingest.ts and
 * upload route are still today's (the pre-pass changes neither). Until it is written this exits 2 = blocked, and records nothing.
 */
console.error('proof:phone-drop-baseline is not built yet (phone drop, ADR-0023, lead step 0). Nothing was recorded.');
process.exit(2);
