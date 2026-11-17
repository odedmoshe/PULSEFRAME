/** Kernels by type and version (ADR-0010). Kernels register themselves (kernels/index.ts); tests may register their own. */
import type { FxKernel, PlannedFx } from './kernel.ts';
const kernels = new Map<string, FxKernel>();
export function registerKernel(k: FxKernel): () => void {
  const key = `${k.type}@${k.version}`;
  if (kernels.has(key)) throw new Error(`duplicate kernel ${key}`);
  kernels.set(key, k);
  return () => { kernels.delete(key); };
}
export const kernelFor = (type: string, version: number): FxKernel | undefined => kernels.get(`${type}@${version}`);
/** Reach of a planned chain at plan rate (ADR-0010 D3, ADR-0013): window stages add their warm-up AND their look-ahead to
 *  warmWindow (the voice processes from windowStart = ringStart − warmWindow), and aheadWindow is their summed look-ahead. */
export interface ChainReach { warmWindow: number; warmRing: number; tail: number; aheadWindow: number }
export function chainReach(chain: readonly PlannedFx[], sampleRate: number, speed = 1): ChainReach {
  let warmWindow = 0, warmRing = 0, tail = 0, aheadWindow = 0;
  for (const fx of chain) {
    const k = kernelFor(fx.type, fx.version);
    if (!k) throw new Error(`no kernel for ${fx.type}@${fx.version}`);
    const r = k.reach(fx.params, sampleRate, speed), a = r.ahead ?? 0;
    if (fx.stage <= 3) { warmWindow += r.warm + a; aheadWindow += a; }
    else { if (a > 0) throw new Error(`${fx.type}: look-ahead is allowed in stages 1–3 only (ADR-0010 D4)`); warmRing += r.warm; tail += r.tail; }
  }
  return { warmWindow, warmRing, tail, aheadWindow };
}
