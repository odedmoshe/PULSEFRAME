/**
 * pnpm proof:multicam-ui — multicam (ADR-0020). LEAD: the entry point; W3 (editor: U1–U8, headless Chromium in the editor-interactions style) builds the checks.
 * Writes .artifacts/multicam/multicam-ui-proof.json. Until it is built it
 * runs nothing and exits 2 (blocked), the exit code the proofs use for "cannot run here", never a pass.
 */
console.error('multicam-ui-proof: not built yet (ADR-0020); nothing was measured');
process.exit(2);
