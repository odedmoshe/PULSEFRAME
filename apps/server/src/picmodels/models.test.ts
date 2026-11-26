/**
 * R1, R2: the setup state of every picture model, in the order of core PICTURE_MODEL_SETUP_CODES, with the labelled fake worker and a
 * synthetic library (testWorld.ts). Models are found only through the ledger; a link out of the library is never followed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PICTURE_MODEL_IDS, PICTURE_MODELS, pictureModelsFor, type PictureModel } from '@pulseframe/core';
import { loadConfig } from '../config.ts';
import { Store } from '../store.ts';
import { createPictureModelsRuntime } from './runtime.ts';
import { ledgerEntry, makePicWorld, pythonPath, SYNTHETIC_MODEL_PATH, type PicWorld } from './testWorld.ts';

let w: PicWorld, dir: string, store: Store;
const yunetPin = PICTURE_MODELS[0]!.pins[0]!;
beforeAll(() => { w = makePicWorld(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-picmodels-r-')); store = new Store(dir); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(w.root, { recursive: true, force: true }); });
afterEach(() => { delete process.env.PF_FAKE_PICTURE_MODE; w.goodLedger(); });
const cfg = (over: Record<string, unknown> = {}) => ({ ...loadConfig({}), dataDir: dir, libraryDir: null, toolsPython: w.python, ...over });
const rt = (over: { cfg?: Record<string, unknown>; registry?: PictureModel[]; workerSha256?: string | null; libraryRoot?: string } = {}) =>
  createPictureModelsRuntime({ cfg: cfg(over.cfg) as never, store, ...w.seams, ...('workerSha256' in over ? { workerSha256: over.workerSha256 } : {}), ...(over.registry ? { registry: over.registry } : {}), ...('libraryRoot' in over ? { libraryRoot: over.libraryRoot } : {}) });
const yunet = async (r: ReturnType<typeof rt>) => { const s = await r.setup('yunet'); await r.stop(); return s; };
const noPath = (detail: string) => { expect(detail).not.toMatch(/[\\/]/); expect(detail).not.toMatch(/\.onnx|\.py|face_detection|fake_pf/); };

describe.skipIf(!pythonPath())('R1: the setup order of a model', () => {
  it('ready on the CPU when everything is in place; depth and matte rows stay not_built', async () => {
    const r = rt();
    const rows = await r.list();
    await r.stop();
    expect(rows.map((x) => x.id)).toEqual([...PICTURE_MODEL_IDS]);
    expect(rows[0]).toMatchObject({ id: 'yunet', code: 'ready', device: 'cpu', missingBytes: 0, module: null });
    for (const x of rows.slice(1)) expect(x.code, x.id).toBe('not_built');
    for (const x of rows) noPath(x.detail);
  });
  it('the real registry: yunet is built, and without its file on this machine the honest state is model_missing', async () => {
    expect((await yunet(rt({ registry: [...PICTURE_MODELS] }))).code).toBe('model_missing');
  });
  it('licence not allowed → licence_blocked; the ledger naming another licence → licence_blocked', async () => {
    const bad = w.registry.map((m) => (m.id === 'yunet' ? { ...m, licence: { ...m.licence, spdx: 'GPL-3.0' as never } } : m));
    expect((await yunet(rt({ registry: bad }))).code).toBe('licence_blocked');
    w.writeLedger([ledgerEntry({ item: yunetPin.item, path: SYNTHETIC_MODEL_PATH, sha256: w.model.sha256, bytes: w.model.bytes, spdx: 'CC-BY-NC-4.0' })]);
    const s = await yunet(rt());
    expect(s.code).toBe('licence_blocked');
    noPath(s.detail);
  });
  it('no reviewed digest, or one changed byte of the worker → engine_unverified', async () => {
    const nd = await yunet(rt({ workerSha256: null }));
    expect(nd.code).toBe('engine_unverified');
    noPath(nd.detail);
    const keep = fs.readFileSync(w.worker);
    try {
      fs.appendFileSync(w.worker, '#');
      const s = await yunet(rt());
      expect(s.code).toBe('engine_unverified');
      noPath(s.detail);
    } finally { fs.writeFileSync(w.worker, keep); }
  });
  it('PF_TOOLS_PYTHON unset → engine_not_configured; the probe missing onnxruntime → engine_not_working naming it', async () => {
    const nc = await yunet(rt({ cfg: { toolsPython: null } }));
    expect(nc.code).toBe('engine_not_configured');
    noPath(nc.detail);
    process.env.PF_FAKE_PICTURE_MODE = 'missing:onnxruntime';
    const s = await yunet(rt());
    expect([s.code, s.module]).toEqual(['engine_not_working', 'onnxruntime']);
    expect(s.detail).toContain('onnxruntime');
    noPath(s.detail);
    const gone = await yunet(rt({ cfg: { toolsPython: path.join(w.root, 'no-such-python') } }));
    expect([gone.code, gone.module]).toEqual(['engine_not_working', null]);
  });
  it('library unset / item absent / another sha in the ledger / size off by one / not a file entry → model_missing with the exact bytes', async () => {
    const want = { code: 'model_missing', missingBytes: w.model.bytes };
    expect(await yunet(rt({ libraryRoot: undefined }))).toMatchObject(want);
    w.writeLedger([]);
    expect(await yunet(rt())).toMatchObject(want);
    w.writeLedger([ledgerEntry({ item: yunetPin.item, path: SYNTHETIC_MODEL_PATH, sha256: 'f'.repeat(64), bytes: w.model.bytes })]);
    expect(await yunet(rt())).toMatchObject(want);
    w.writeLedger([ledgerEntry({ item: yunetPin.item, path: SYNTHETIC_MODEL_PATH, sha256: w.model.sha256, bytes: w.model.bytes, kind: 'archive' })]);
    expect(await yunet(rt())).toMatchObject(want);
    w.goodLedger();
    const keep = fs.readFileSync(w.model.file);
    try {
      fs.writeFileSync(w.model.file, Buffer.concat([keep, Buffer.from('x')]));
      const s = await yunet(rt());
      expect(s).toMatchObject(want);
      noPath(s.detail);
      fs.writeFileSync(w.model.file, Buffer.from(keep).fill(65, 0, 1)); // same size, another checksum (the cache is by path+size+mtime)
      expect(await yunet(rt())).toMatchObject(want);
    } finally { fs.writeFileSync(w.model.file, keep); }
    expect((await yunet(rt())).code).toBe('ready');
  });
});

describe.skipIf(!pythonPath())('R2: only the ledger finds a model; nothing outside the library is opened', () => {
  it('the right file at the right path but absent from the ledger is model_missing', async () => {
    w.writeLedger([ledgerEntry({ item: 'something/else', path: 'models/other', sha256: w.model.sha256, bytes: w.model.bytes })]);
    expect(await yunet(rt())).toMatchObject({ code: 'model_missing', missingBytes: w.model.bytes });
  });
  it('a ledger item that is a link out of the library is model_missing (its target would verify: it is never followed)', async () => {
    const outside = path.join(w.root, 'outside.onnx');
    fs.copyFileSync(w.model.file, outside);
    const link = path.join(w.library, 'models', 'linked.onnx');
    fs.symlinkSync(outside, link);
    try {
      w.writeLedger([ledgerEntry({ item: yunetPin.item, path: 'models/linked.onnx', sha256: w.model.sha256, bytes: w.model.bytes })]);
      expect(await yunet(rt())).toMatchObject({ code: 'model_missing', missingBytes: w.model.bytes });
      w.writeLedger([ledgerEntry({ item: yunetPin.item, path: 'models/../../outside.onnx', sha256: w.model.sha256, bytes: w.model.bytes })]);
      expect(await yunet(rt())).toMatchObject({ code: 'model_missing', missingBytes: w.model.bytes });
    } finally { fs.rmSync(link, { force: true }); fs.rmSync(outside, { force: true }); }
  });
  it('an agent\'s rows hold five keys and no yunet row in every state', async () => {
    for (const over of [{}, { cfg: { toolsPython: null } }, { workerSha256: null }, { libraryRoot: undefined }]) {
      const r = rt(over as never);
      const rows = await r.list();
      await r.stop();
      const agent = pictureModelsFor(false, rows);
      expect(agent.map((x) => x.id)).not.toContain('yunet');
      for (const x of agent) expect(Object.keys(x).sort()).toEqual(['code', 'device', 'id', 'missingBytes', 'output']);
    }
  });
});
