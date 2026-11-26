/**
 * Finding and verifying a picture model (wave 8 picmodels; plan §3.3 as corrected by verify; contract.ts RULES). Per model, the setup
 * state in the order of core PICTURE_MODEL_SETUP_CODES:
 *   not_built (the row says built: false) → licence_blocked (the row's licence is not allowed, or the ledger's current entry of a pin
 *   names another SPDX id) → engine_unverified (no reviewed digest, or the worker file is another one) → engine_not_configured
 *   (PF_TOOLS_PYTHON unset) → engine_not_working (the probe names the module it cannot import) → disk_insufficient / model_missing
 *   (the exact missing bytes) → ready (device cpu).
 * Models are found ONLY through the library ledger (LibraryService.ledgerEntries: the current entry of `pin.item`, kind 'file', its
 * sha256 the pin's), the place through library/paths.ts resolveInside (no link out, no `..`), the size by stat, the SHA-256 by reading
 * (cached by path + size + mtime). Never a guessed folder, never a download. Detail sentences hold no path and no file name.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  PICTURE_MODEL_LICENCES_ALLOWED, notBuiltPictureModelStatus, pictureModelBytes,
  type LedgerEntry, type PictureModel, type PictureModelStatus,
} from '@pulseframe/core';
import { resolveInside } from '../library/paths.ts';
import type { PicturePythonProbe, ToolsProcessSpec } from './contract.ts';

export async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}
/** Free bytes where `dir` is (or its nearest existing parent), or null when it cannot be read. */
export function freeBytes(dir: string): number | null {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

export interface LedgerView { state: string; rootReal: string | null; entries: LedgerEntry[] }
export interface ModelCheckDeps {
  /** the configured library root as written, or null (LibraryService.configuredRoot) */
  libraryRoot: () => string | null;
  ledger: () => Promise<LedgerView>;
  /** the worker script and the digest that counts as reviewed for it (null = none yet) */
  worker: string;
  reviewed: string | null;
  toolsPython: string | null;
  tmpDir: string;
  probe: (spec: ToolsProcessSpec) => Promise<PicturePythonProbe>;
}

const status = (m: PictureModel, code: PictureModelStatus['code'], detail: string, extra: Partial<PictureModelStatus> = {}): PictureModelStatus =>
  ({ id: m.id, output: m.output, code, module: null, device: null, missingBytes: 0, detail, ...extra });

/** A verified model: its setup row, and for a ready one the real paths of its pins (never shown to anyone). */
export interface ModelCheck { status: PictureModelStatus; paths: string[] | null }

export function createModelChecker(deps: ModelCheckDeps) {
  const hashCache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
  let workerDigest: { size: number; mtimeMs: number; sha256: string | null } | null = null;
  let probe: { key: string; at: number; value: PicturePythonProbe } | null = null;

  const digestOf = async (file: string, st: fs.Stats): Promise<string> => {
    const c = hashCache.get(file);
    if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.sha256;
    const sha256 = await sha256File(file);
    hashCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha256 });
    return sha256;
  };
  const workerSha = async (): Promise<string | null> => {
    let st: fs.Stats;
    try { st = fs.statSync(deps.worker); } catch { return null; }
    if (workerDigest && workerDigest.size === st.size && workerDigest.mtimeMs === st.mtimeMs) return workerDigest.sha256;
    let sha256: string | null;
    try { sha256 = await sha256File(deps.worker); } catch { sha256 = null; }
    workerDigest = { size: st.size, mtimeMs: st.mtimeMs, sha256 };
    return sha256;
  };
  /** The probe, cached 60 s when it answered ok, 5 s otherwise. */
  const probed = async (): Promise<PicturePythonProbe> => {
    const key = `${deps.toolsPython}|${deps.worker}`;
    if (probe && probe.key === key && Date.now() - probe.at < (probe.value.ok ? 60_000 : 5_000)) return probe.value;
    const value = await deps.probe({ python: deps.toolsPython!, script: deps.worker, tmpDir: deps.tmpDir });
    probe = { key, at: Date.now(), value };
    return value;
  };

  async function check(m: PictureModel): Promise<ModelCheck> {
    const total = pictureModelBytes(m);
    if (!m.built) return { status: notBuiltPictureModelStatus(m), paths: null };
    if (!PICTURE_MODEL_LICENCES_ALLOWED.includes(m.licence.spdx)) return { status: status(m, 'licence_blocked', `the model's licence (${m.licence.spdx}) is not allowed in this build`), paths: null };
    const ledger = deps.libraryRoot() ? await deps.ledger().catch((): LedgerView => ({ state: 'unreadable', rootReal: null, entries: [] })) : null;
    const entryOf = (item: string) => ledger?.entries.find((e) => e.item === item) ?? null;
    for (const pin of m.pins) {
      const spdx = entryOf(pin.item)?.licence.spdx;
      if (spdx !== undefined && spdx !== m.licence.spdx) return { status: status(m, 'licence_blocked', `the library ledger records another licence (${spdx.slice(0, 40)}) for this model than the one this build allows`), paths: null };
    }
    if (!deps.reviewed) return { status: status(m, 'engine_unverified', 'this build has no reviewed digest of the picture-model worker yet; update the editor'), paths: null };
    const digest = await workerSha();
    if (digest === null) return { status: status(m, 'engine_unverified', 'the picture-model worker is missing from this installation; reinstall the editor'), paths: null };
    if (digest !== deps.reviewed) return { status: status(m, 'engine_unverified', 'the installed picture-model worker differs from the reviewed one; reinstall the editor'), paths: null };
    if (!deps.toolsPython) return { status: status(m, 'engine_not_configured', 'PF_TOOLS_PYTHON is not set: create the tools Python environment with the picture requirements and set PF_TOOLS_PYTHON to its python (the integrations guide, picture models section)'), paths: null };
    const pr = await probed();
    if (!pr.ok) {
      return { status: status(m, 'engine_not_working', pr.missing
        ? `the tools environment cannot import ${pr.missing}: install the picture requirements into PF_TOOLS_PYTHON`
        : 'the tools Python did not answer its probe; check PF_TOOLS_PYTHON', { module: pr.missing }), paths: null };
    }
    if (!ledger) return { status: status(m, 'model_missing', `the library folder is not set: set it, then fetch the model with the library tool (${total} bytes); the editor never downloads it`, { missingBytes: total }), paths: null };
    let missing = 0;
    const paths: string[] = [];
    for (const pin of m.pins) {
      const e = entryOf(pin.item);
      if (ledger.state !== 'ok' || !ledger.rootReal || !e || e.kind !== 'file' || e.sha256 !== pin.sha256) { missing += pin.bytes; continue; }
      let real: string | null;
      try { real = (await resolveInside(ledger.rootReal, e.path, ''))?.real ?? null; } catch { real = null; } // a link out of the library: never opened
      if (!real) { missing += pin.bytes; continue; }
      let st: fs.Stats;
      try { st = fs.statSync(real); } catch { missing += pin.bytes; continue; }
      if (!st.isFile() || st.size !== pin.bytes) { missing += pin.bytes; continue; }
      let sha: string;
      try { sha = await digestOf(real, st); } catch { missing += pin.bytes; continue; }
      if (sha !== pin.sha256) { missing += pin.bytes; continue; }
      paths.push(real);
    }
    if (missing > 0) {
      const free = ledger.rootReal ? freeBytes(ledger.rootReal) : null;
      if (free !== null && free < missing) return { status: status(m, 'disk_insufficient', `the model needs ${missing} more bytes and ${free} are free in the library folder; make room, then fetch it`, { missingBytes: missing }), paths: null };
      return { status: status(m, 'model_missing', `the model's files are not all present and verified in the library: ${missing} bytes to fetch with the library tool; the editor never downloads them`, { missingBytes: missing }), paths: null };
    }
    return { status: status(m, 'ready', 'ready on the CPU (this model always runs on the CPU)', { device: 'cpu' }), paths };
  }
  /** Forget the cached digest of a file (the worker said it is not the pinned one). */
  const forget = (file: string) => { hashCache.delete(file); };
  return { check, forget };
}
