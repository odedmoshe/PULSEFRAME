/**
 * pnpm proof:multicam — multicam (ADR-0020). LEAD: the entry point; W2 (server: M1–M8, plan and multicam-workers.json) builds the checks.
 * Writes .artifacts/multicam/multicam-proof.json and docs/evidence/multicam-proof.json. Until it is built it
 * runs nothing and exits 2 (blocked), the exit code the proofs use for "cannot run here", never a pass.
 */
console.error('multicam-proof: not built yet (ADR-0020); nothing was measured');
process.exit(2);
