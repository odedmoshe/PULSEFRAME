/**
 * pnpm booth:ingest <file> — the lead's tool (wave 8 booth; verify C4). BUILDER W1 writes it: reads a pasted report, parses the machine
 * block with core parseBoothBlock (refuses non-ASCII, a checksum mismatch or an invalid block, with the reason), and writes
 * docs/evidence/owner-review/<date>.json with NO notes (that folder is committed and pushed). An answer whose recipe differs from the
 * recipe at the commit being ingested is marked `stale`. Status word, defined once in docs/CAPABILITIES.md at integration:
 * `owner-reviewed (their machine, <date>, adapter <x>, build <y>)` — the owner's statement, never "verified", never "good".
 */
console.error('booth:ingest is not built yet (wave 8 booth pre-pass).');
process.exitCode = 2;
export {};
