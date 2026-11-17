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
export function chainReach(chain: readonly PlannedFx[], sampleRate: number): { warmWindow: number; warmRing: number; tail: number } {
  let warmWindow = 0, warmRing = 0, tail = 0;
  for (const fx of chain) {
    const k = kernelFor(fx.type, fx.version);
    if (!k) throw new Error(`no kernel for ${fx.type}@${fx.version}`);
    const r = k.reach(fx.params, sampleRate);
    if (fx.stage <= 3) warmWindow += r.warm; else { warmRing += r.warm; tail += r.tail; }
  }
  return { warmWindow, warmRing, tail };
}
