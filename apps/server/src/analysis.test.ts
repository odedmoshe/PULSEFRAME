import { describe, expect, it } from 'vitest';
import { limiter } from './analysis.ts';
import { ApiError } from './store.ts';

describe('limiter for heavy read-only work', () => {
  it('runs at most N at once, queues the rest in order, and refuses when the queue is full', async () => {
    const run = limiter(2, 2);
    let active = 0, peak = 0;
    const order: number[] = [];
    const release: (() => void)[] = [];
    const job = (i: number) => run(async () => { active++; peak = Math.max(peak, active); order.push(i); await new Promise<void>((r) => release.push(r)); active--; return i; });
    const started = [job(1), job(2), job(3), job(4)];
    const refused = await job(5).then(() => null, (e) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBe(429);
    await Promise.resolve();
    expect(order).toEqual([1, 2]);
    for (let k = 0; k < 4; k++) { await new Promise((r) => setTimeout(r, 5)); release.shift()?.(); }
    expect(await Promise.all(started)).toEqual([1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4]);
  });
  it('a failing job frees its slot', async () => {
    const run = limiter(1, 1);
    await expect(run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await run(async () => 7)).toBe(7);
  });
});
