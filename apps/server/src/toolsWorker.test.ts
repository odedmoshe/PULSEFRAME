/**
 * The generic tools-Python launcher (toolsWorker.ts) with the LABELLED fake worker (picmodels/testdata/fake_pf_picture.py): one process
 * per request, the first line with the id, SIGKILL on abort / timeout / answer, errors with codes and integers only, stderr only to
 * the callback.
 */
import fs from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ApiError } from './store.ts';
import { makePicWorld, pidsRunning } from './picmodels/testWorld.ts';
import { probePicturePython, runToolsOnce } from './toolsWorker.ts';

const w = makePicWorld('pf-toolsworker-');
afterAll(() => fs.rmSync(w.root, { recursive: true, force: true }));
afterEach(() => { delete process.env.PF_FAKE_PICTURE_MODE; });
const spec = () => ({ python: w.python!, script: w.worker, tmpDir: w.root });
const ARGS = ['serve', '--role', 'eyes', '--model', 'x', '--threads', '2'];
/** 32 × 8 grey with two drawn eyes. */
const req = (id = 3) => {
  const W = 32, H = 8, b = Buffer.alloc(W * H * 3, 128);
  for (const cx of [7, 23]) for (let y = 1; y < 7; y++) for (let x = cx - 3; x < cx + 3; x++) { const i = 3 * (y * W + x); b[i] = 255; b[i + 1] = 0; b[i + 2] = 255; }
  return { id, cmd: 'eyes' as const, w: W, h: H, rgb: b.toString('base64') };
};
const never = () => new AbortController().signal;
const gone = async (ms = 1000) => { const t = Date.now(); while (pidsRunning(w.worker).length && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20)); return pidsRunning(w.worker); };
const fail = async (p: Promise<unknown>) => { const e = await p.then(() => null, (x) => x); expect(e).toBeInstanceOf(ApiError); return e as ApiError; };

describe.skipIf(!w.python)('runToolsOnce', () => {
  it('answers the raw line with the id and the process is gone afterwards', async () => {
    const line = await runToolsOnce(spec(), ARGS, req(), never(), 20_000);
    expect(line).toEqual({ id: 3, event: 'result', faces: [[[7, 4], [23, 4]]] });
    expect(await gone()).toEqual([]);
  });
  it('the timeout and an abort SIGKILL the process; the abort rejects with the signal\'s reason', async () => {
    process.env.PF_FAKE_PICTURE_MODE = 'slow';
    const t = await fail(runToolsOnce(spec(), ARGS, req(), never(), 800));
    expect([t.status, t.code, t.details]).toEqual([502, 'eyes_engine_failed', { reason: 'timeout' }]);
    expect(await gone()).toEqual([]);
    const ac = new AbortController();
    const p = runToolsOnce(spec(), ARGS, req(), ac.signal, 20_000);
    const t0 = Date.now();
    while (!pidsRunning(w.worker).length && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 20));
    expect(pidsRunning(w.worker)).toHaveLength(1);
    ac.abort(new Error('client went away'));
    await expect(p).rejects.toThrow('client went away');
    expect(await gone()).toEqual([]);
  });
  it('an exit before the line, a crash and a non-JSON line are engineFailed with codes and integers only; stderr goes only to the callback', async () => {
    for (const mode of ['exit-early', 'crash', 'garbage']) {
      process.env.PF_FAKE_PICTURE_MODE = mode;
      let tail = '';
      const e = await fail(runToolsOnce(spec(), ARGS, req(), never(), 20_000, (t) => { tail = t; }));
      expect([e.status, e.code], mode).toEqual([502, 'eyes_engine_failed']);
      expect(e.details.reason, mode).toBe('exited');
      expect(typeof e.details.exit).toBe('number');
      expect(Object.keys(e.details).sort()).toEqual(['exit', 'reason']);
      expect(JSON.stringify(e.toJSON())).not.toMatch(/fake crash|Traceback|not json/);
      if (mode === 'crash') expect(tail).toContain('Traceback');
    }
  });
  it('an id-less error line (the worker refusing its model before the request) rejects with that code only', async () => {
    const e = await fail(runToolsOnce(spec(), ['nonsense'], req(), never(), 20_000));
    expect(e.details).toEqual({ reason: 'worker', code: 'bad_request' });
  });
  it('a python that cannot start is engineFailed spawn', async () => {
    const e = await fail(runToolsOnce({ ...spec(), python: `${w.root}/no-python` }, ARGS, req(), never(), 5000));
    expect(e.details).toEqual({ reason: 'spawn' });
  });
});

describe.skipIf(!w.python)('probePicturePython', () => {
  it('ok with versions; a missing module named; a python that cannot start is not ok', async () => {
    expect(await probePicturePython(spec())).toMatchObject({ ok: true, missing: null, cudaDevices: 0, versions: { numpy: 'TEST', onnxruntime: 'TEST' } });
    process.env.PF_FAKE_PICTURE_MODE = 'missing:onnxruntime';
    expect(await probePicturePython(spec())).toMatchObject({ ok: false, missing: 'onnxruntime' });
    expect(await probePicturePython({ ...spec(), python: `${w.root}/no-python` })).toEqual({ ok: false, python: null, versions: {}, missing: null, cudaDevices: 0 });
  });
});
