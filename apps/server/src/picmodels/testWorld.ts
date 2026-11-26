/**
 * TEST SUPPORT ONLY (unit tests and the server part of proof:picmodels; never imported by the server): a synthetic world for the
 * picture-model runtime — a copy of the LABELLED fake worker (fake_pf_picture.py, «TEST-ADAPTER-picture/1») at a path unique to the
 * world (so its processes can be found by path), the digest that counts as reviewed for that copy, a synthetic registry whose yunet
 * row is built and pinned to a tiny synthetic file, and a synthetic library root with its own _manifests/ledger.json naming that
 * file. Nothing here is a model; nothing here is downloaded. The caller removes `root`.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PICTURE_MODELS, type PictureModel } from '@pulseframe/core';
import type { PictureModelsTestSeams } from './contract.ts';

export const FAKE_WORKER_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'testdata', 'fake_pf_picture.py');
export const SYNTHETIC_MODEL_PATH = 'models/face_detection/yunet/face_detection_yunet_2023mar.onnx';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export interface LedgerItemSpec { item: string; path: string; sha256: string; bytes: number; spdx?: string; kind?: 'file' | 'archive' }
export function ledgerEntry(s: LedgerItemSpec): Record<string, unknown> {
  return {
    item: s.item, source: 'synthetic', sourceTitle: 'synthetic test file', manifest: 'synthetic.json', manifestSha256: '0'.repeat(64),
    kind: s.kind ?? 'file', identity: s.sha256, url: 'https://example.invalid/synthetic', path: s.path, bytes: s.bytes, pinned: true, sha256: s.sha256,
    licence: { spdx: s.spdx ?? 'MIT', url: 'https://example.invalid/licence', readOn: '2026-11-26', quote: 'synthetic' }, credit: null, flags: {}, time: '2026-11-26T00:00:00Z',
  };
}

export interface PicWorld {
  root: string;
  /** the synthetic library root (not inside any data directory) */
  library: string;
  /** the world's own copy of the labelled fake worker */
  worker: string;
  model: { file: string; bytes: number; sha256: string };
  registry: PictureModel[];
  seams: PictureModelsTestSeams;
  writeLedger(entries: Record<string, unknown>[]): void;
  /** the ledger that names the synthetic model file correctly */
  goodLedger(): void;
  python: string | null;
}

export function pythonPath(): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const p = path.join(dir, 'python3');
    try { fs.accessSync(p, fs.constants.X_OK); return fs.realpathSync(p); } catch { /* next */ }
  }
  return null;
}

export function makePicWorld(prefix = 'pf-picworld-'): PicWorld {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const library = path.join(root, 'library');
  const worker = path.join(root, 'worker', `fake_pf_picture_${randomBytes(4).toString('hex')}.py`);
  fs.mkdirSync(path.dirname(worker), { recursive: true });
  fs.copyFileSync(FAKE_WORKER_SOURCE, worker);
  const bytes = Buffer.from(`synthetic stand-in of a model file, not a model ${randomBytes(8).toString('hex')}\n`);
  const file = path.join(library, ...SYNTHETIC_MODEL_PATH.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(library, '_manifests'), { recursive: true });
  fs.writeFileSync(file, bytes);
  const model = { file, bytes: bytes.length, sha256: sha(bytes) };
  const yunet = PICTURE_MODELS.find((m) => m.id === 'yunet')!;
  const registry: PictureModel[] = PICTURE_MODELS.map((m) => (m.id === 'yunet'
    ? { ...m, built: true, pins: [{ ...yunet.pins[0]!, bytes: model.bytes, sha256: model.sha256 }] }
    : m));
  const writeLedger = (entries: Record<string, unknown>[]) => fs.writeFileSync(path.join(library, '_manifests', 'ledger.json'), JSON.stringify({ ledgerVersion: 1, entries, licenceTexts: [] }));
  const goodLedger = () => writeLedger([ledgerEntry({ item: yunet.pins[0]!.item, path: SYNTHETIC_MODEL_PATH, sha256: model.sha256, bytes: model.bytes })]);
  goodLedger();
  return {
    root, library, worker, model, registry, writeLedger, goodLedger, python: pythonPath(),
    seams: { worker, workerSha256: sha(fs.readFileSync(worker)), registry, libraryRoot: library },
  };
}

/** Pids of live processes whose command line names `file` (Linux /proc; [] elsewhere). */
export function pidsRunning(file: string): number[] {
  let ids: string[];
  try { ids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return []; }
  const out: number[] = [];
  for (const id of ids) {
    try {
      const cmd = fs.readFileSync(`/proc/${id}/cmdline`, 'utf8');
      if (!cmd.includes(file)) continue;
      const st = fs.readFileSync(`/proc/${id}/stat`, 'utf8');
      if (/\) Z /.test(st)) continue; // a zombie is gone
      out.push(Number(id));
    } catch { /* gone */ }
  }
  return out;
}
