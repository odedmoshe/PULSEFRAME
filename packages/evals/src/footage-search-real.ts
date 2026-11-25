/**
 * pnpm proof:search-real — the REAL picture model of «חיפוש בצילומים», optional (wave 7 search track; decisions §4, laptop step L7). BUILDER B
 * owns this file. It runs only where PF_TOOLS_PYTHON names an environment with torch and transformers AND the seven pinned SigLIP 2 files
 * are present at exact bytes and SHA-256 (PF_SEARCH_MODEL_DIR or the library root); otherwise it exits 2 (blocked) and says which is
 * missing. Synthetic pictures only, never the owner's clips. Nothing is downloaded. Checks (each one sample, reported, never tuned):
 *   R1 every vector has length 768, is finite and of unit length within 1e-3;
 *   R2 the same frames embedded twice on one device give the same int8 bytes (a difference is reported as a finding);
 *   R3 the device (cuda/cpu), the versions and the load and run seconds are recorded.
 */
export const FOOTAGE_REAL_BUILT = false;
export const FOOTAGE_REAL_CHECKS: Readonly<Record<string, string>> = {
  R1: 'every vector has length 768, is finite and of unit length within 1e-3',
  R2: 'the same frames embedded twice on one device give the same int8 bytes (a difference is a finding, not tuned)',
  R3: 'device, versions, load and run seconds recorded (one sample)',
};
if (!FOOTAGE_REAL_BUILT) {
  console.error(`footage-search-real: not built yet; ${Object.keys(FOOTAGE_REAL_CHECKS).length} checks pending; nothing was measured`);
  process.exit(2);
}
