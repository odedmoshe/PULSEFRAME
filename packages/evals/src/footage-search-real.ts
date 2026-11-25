/**
 * pnpm proof:search-real — the REAL picture model of «חיפוש בצילומים», optional (wave 7 search track; decisions §4, laptop step L7). BUILDER B
 * owns this file. It runs only where PF_TOOLS_PYTHON names an environment with torch and transformers AND the seven pinned SigLIP 2 files
 * are present at exact bytes and SHA-256 (PF_SEARCH_MODEL_DIR or the library root) AND this build carries the reviewed worker digest;
 * otherwise it exits 2 (blocked) and says which is missing (the runtime's own setup state). Synthetic pictures only (flat colours with the
 * fixture barcode, made here), never the owner's clips. Nothing is downloaded: the worker runs with the network disarmed. Checks (each one
 * sample, reported, never tuned):
 *   R1 every vector has length 768, is finite and of unit length within 1e-3 (pictures and a text);
 *   R2 the same frames embedded twice on one device give the same int8 bytes (a difference is reported as a finding);
 *   R3 the device (cuda/cpu), the versions and the load and run seconds are recorded.
 * Writes docs/evidence/footage-search-real.json when it runs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOTAGE_LIMITS, FOOTAGE_SEARCH_BUILT, quantiseInt8 } from '@pulseframe/core';
import { BARCODE } from '@pulseframe/fixtures';
import { loadConfig } from '../../../apps/server/src/config.ts';
import { FifoComputeLane } from '../../../apps/server/src/lane.ts';
import { Store } from '../../../apps/server/src/store.ts';
import { validateVectors } from '../../../apps/server/src/search/answer.ts';
import { createSearchRuntime } from '../../../apps/server/src/search/runtime.ts';
import { SearchWorkers } from '../../../apps/server/src/search/workers.ts';

export const FOOTAGE_REAL_BUILT = true;
export const FOOTAGE_REAL_CHECKS: Readonly<Record<string, string>> = {
  R1: 'every vector has length 768, is finite and of unit length within 1e-3',
  R2: 'the same frames embedded twice on one device give the same int8 bytes (a difference is a finding, not tuned)',
  R3: 'device, versions, load and run seconds recorded (one sample)',
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** n flat-colour 256×256 frames with the frame-index barcode strip (synthetic). */
function frames(n: number): Uint8Array {
  const colours: [number, number, number][] = [[220, 30, 30], [30, 50, 220], [30, 190, 40], [230, 220, 30], [240, 240, 240], [20, 20, 20], [128, 128, 128], [200, 120, 30]];
  const S = 256, out = new Uint8Array(n * S * S * 3), strip = Math.round(S * BARCODE.stripFrac), cell = S / BARCODE.bits;
  for (let k = 0; k < n; k++)
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const o = ((k * S + y) * S + x) * 3;
        const c = y < strip ? (((k >> (BARCODE.bits - 1 - Math.floor(x / cell))) & 1) ? [235, 235, 235] : [16, 16, 16]) : colours[k % colours.length]!;
        out[o] = c[0]!; out[o + 1] = c[1]!; out[o + 2] = c[2]!;
      }
  return out;
}

async function main(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg.toolsPython) { console.error('footage-search-real: BLOCKED — PF_TOOLS_PYTHON is not set (no tools environment); nothing was measured'); return 2; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-search-real-'));
  const store = new Store(path.join(tmp, 'data'));
  const runtime = createSearchRuntime({ cfg: { ...cfg, dataDir: store.dataDir }, store, lane: new FifoComputeLane() });
  let workers: SearchWorkers | null = null;
  try {
    const setup = await runtime.setup();
    if (setup.code !== 'ready') { console.error(`footage-search-real: BLOCKED — picture search is not ready here: ${setup.code}: ${setup.detail}; nothing was measured`); return 2; }
    if (!FOOTAGE_SEARCH_BUILT) { console.error('footage-search-real: BLOCKED — builder A\'s quantiseInt8 is not merged (R2 compares its int8 bytes); nothing was measured'); return 2; }
    const device = setup.device === 'cuda' ? 'cuda' : 'cpu';
    workers = new SearchWorkers({ python: cfg.toolsPython, script: path.join(ROOT, 'apps/server/tools/pf_search.py'), tmpDir: store.tmpDir, modelDir: runtime.modelDir()!, keepSeconds: 600 }, device);
    const n = FOOTAGE_LIMITS.batchFrames, rgb = frames(n), signal = new AbortController().signal;
    const t0 = performance.now();
    const a = await workers.embedImages(rgb, n, signal);
    const t1 = performance.now();
    const b = await workers.embedImages(rgb, n, signal);
    const t2 = performance.now();
    const text = await workers.embedText(['a red picture', 'תמונה כחולה'], signal);
    const t3 = performance.now();
    const results: Record<string, { pass: boolean; detail: unknown }> = {};
    try { validateVectors(a, n); validateVectors(b, n); validateVectors(text, 2); results.R1 = { pass: true, detail: { pictures: 2 * n, texts: 2, dim: FOOTAGE_LIMITS.embedDim } }; }
    catch (e) { results.R1 = { pass: false, detail: (e as Error).message }; }
    let differing = 0;
    for (let k = 0; k < n; k++) {
      const qa = quantiseInt8(a.slice(k * 768, (k + 1) * 768)).q, qb = quantiseInt8(b.slice(k * 768, (k + 1) * 768)).q;
      if (Buffer.compare(Buffer.from(qa.buffer), Buffer.from(qb.buffer)) !== 0) differing++;
    }
    results.R2 = { pass: differing === 0, detail: differing ? `FINDING: ${differing} of ${n} frames gave other int8 bytes the second time on ${device} (reported, not tuned)` : `all ${n} frames identical in int8 on ${device}` };
    const scanInfo = workers.scan.readyInfo, queryInfo = workers.query.readyInfo;
    results.R3 = { pass: true, detail: { device, scanDevice: scanInfo?.device, dtype: scanInfo?.dtype, versions: { ...setup.versions, ...scanInfo?.versions }, loadSeconds: { scan: scanInfo?.loadSeconds, query: queryInfo?.loadSeconds }, runSeconds: { firstBatchIncludingLoad: (t1 - t0) / 1000, secondBatch: (t2 - t1) / 1000, twoTexts: (t3 - t2) / 1000 }, batch: n, note: 'one sample each' } };
    for (const [k, r] of Object.entries(results)) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${k}: ${typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)}`);
    fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'footage-search-real.json'), JSON.stringify({ when: new Date().toISOString(), model: 'google/siglip2-base-patch16-256@3f9f96cb', results, note: 'synthetic pictures only; one sample each' }, null, 1) + '\n');
    return results.R1!.pass ? 0 : 1; // R2's difference is a finding, not a failure
  } finally {
    await workers?.release();
    await runtime.stop();
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
