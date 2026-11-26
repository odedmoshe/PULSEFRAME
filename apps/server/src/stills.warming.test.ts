/**
 * Wave 8 cover integration (W1 note 5): before the ffmpeg build line is known, the stills read and start cannot check the cache, so
 * they used to answer "nothing measured" (measuredFrames 0) for frames that ARE stored. Now the routes and the MCP tools wait for
 * the line (stillsReady), and a direct call that did not wait is refused honestly with 503 stills_warming («עוד רגע»), never with a
 * false "nothing measured". The version line of tracking.ts is held back here by a deferred promise (the only stand-in in this
 * file; everything else is the real module).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { translateRefusal } from '../../../packages/i18n/src/index.ts';

let release: (line: string) => void = () => {};
const held = new Promise<string>((r) => { release = r; });
vi.mock('./tracking.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./tracking.ts')>()), ffmpegVersionLine: () => held }));

const { createStillsHarness } = await import('../../../packages/evals/src/stills-proof.measure.ts');
const { readSharpFrames, startStillsJob } = await import('./stills.ts');
const { OWNER } = await import('../../../packages/evals/src/stills-proof.measure.ts');

const h = createStillsHarness();
afterAll(async () => { release('ffmpeg version test'); await h.close(); });

describe('the first stills read before the ffmpeg build line is known', () => {
  it('a direct call is refused 503 stills_warming with the next step (never "nothing measured"); the routes wait and then answer', async () => {
    const pid = h.project('warming');
    let err: any = null;
    try { readSharpFrames(h.store, pid, { assetId: 'ast_none', from: 0, to: 10 }, h.deps()); } catch (e) { err = e; }
    expect([err?.status, err?.code, err?.hint]).toEqual([503, 'stills_warming', 'Try again in a moment.']);
    expect(translateRefusal('he', err.message)).toMatch(/^עוד רגע: .*נסו שוב בעוד רגע$/);
    let err2: any = null;
    try { startStillsJob(h.store, h.gov, OWNER, pid, { assetId: 'ast_none', from: 0, to: 10 }, h.deps()); } catch (e) { err2 = e; }
    expect(err2?.code).toBe('stills_warming');
    // the route waits for the line instead of answering early
    let settled = false;
    const get = h.rest('GET', `/projects/${pid}/stills?assetId=ast_none&from=0&to=10`, undefined, h.auth.tokens.observer).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);
    release('ffmpeg version test');
    const r = await get;
    // the line is known now: the read goes on to the asset (absent here: 404), not 503 and not an empty answer
    expect([r.status, r.body.error.code]).toEqual([404, 'not_found']);
  });
});
