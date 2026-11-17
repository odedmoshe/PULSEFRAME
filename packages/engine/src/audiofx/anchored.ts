/**
 * Sliding windows anchored to the timeline grid (ADR-0013): the minimum and the sum of the last L values of a stream, computed the
 * van Herk / Gil-Werman way. The stream is cut into blocks of L values that start where t % L === 0 (t = the timeline sample, so
 * the two parts of a split clip and a render started anywhere share one grid). A window [t − L + 1, t] covers the end of one block
 * and the start of the next: its result combines that block's SUFFIX (from t − L + 1 to the block end) and the next block's PREFIX
 * (from its start to t). Both are recomputed from scratch inside their block, in a fixed order, so a result depends only on the
 * values inside its window, never on where the stream started or how it was pushed. There is no running sum that carries rounding
 * from one window to the next (that would drift with the start point).
 *
 * Cost: amortised 3 operations per value; memory 2·L values. Runtime arithmetic only (+, comparisons): no transcendental Math.
 */

/** Minimum of the last L values pushed, on blocks anchored at t % L === 0. */
export class AnchoredMin {
  readonly L: number;
  /** values of the current block, by offset (+Infinity where nothing was pushed) */
  private readonly cur: Float64Array;
  /** suffix minima of the previous complete block: suf[o] = min of its values at offsets o..L−1 */
  private readonly suf: Float64Array;
  private pre = Infinity;
  constructor(L: number) {
    if (!Number.isInteger(L) || L < 1) throw new RangeError('AnchoredMin: L is a whole number ≥ 1');
    this.L = L;
    this.cur = new Float64Array(L).fill(Infinity);
    this.suf = new Float64Array(L).fill(Infinity);
  }
  /**
   * Push the value at timeline index t (pushes are consecutive: t, t + 1, …) and return the minimum over [t − L + 1, t]. Values
   * before the first push count as +Infinity, so a window that reaches before the stream start is not a full window.
   */
  push(t: number, v: number): number {
    const L = this.L, cur = this.cur;
    let o = t % L;
    if (o < 0) o += L;
    cur[o] = v;
    const pre = o === 0 ? v : v < this.pre ? v : this.pre;
    this.pre = pre;
    if (o === L - 1) {
      // the block is complete: its window is the whole block; keep its suffix minima for the windows that start in it
      const suf = this.suf;
      let m = Infinity;
      for (let i = L - 1; i >= 0; i--) { const c = cur[i]!; if (c < m) m = c; suf[i] = m; }
      return m;
    }
    const s = this.suf[o + 1]!;
    return s < pre ? s : pre;
  }
}

/** Sum of the last L values pushed, on blocks anchored at t % L === 0 (each block's prefix and suffix sums recomputed from scratch). */
export class AnchoredSum {
  readonly L: number;
  private readonly cur: Float64Array;
  /** suffix sums of the previous complete block, each accumulated from the block end backwards */
  private readonly suf: Float64Array;
  private pre = 0;
  constructor(L: number) {
    if (!Number.isInteger(L) || L < 1) throw new RangeError('AnchoredSum: L is a whole number ≥ 1');
    this.L = L;
    this.cur = new Float64Array(L);
    this.suf = new Float64Array(L);
  }
  /** Push the value at timeline index t (consecutive pushes) and return the sum over [t − L + 1, t] (values before the first push count as 0). */
  push(t: number, v: number): number {
    const L = this.L, cur = this.cur;
    let o = t % L;
    if (o < 0) o += L;
    cur[o] = v;
    const pre = o === 0 ? v : this.pre + v;
    this.pre = pre;
    if (o === L - 1) {
      const suf = this.suf;
      let s = 0;
      for (let i = L - 1; i >= 0; i--) { s += cur[i]!; suf[i] = s; }
      return s;
    }
    return this.suf[o + 1]! + pre;
  }
}
