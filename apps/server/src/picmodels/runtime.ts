/**
 * The picture-model runtime (wave 8 picmodels; contract.ts PictureModelsRuntime and RULES; verify C9–C11, C17).
 * - setup/list: per model, models.ts (ledger-only lookup, resolveInside, size and SHA-256 cached by path + size + mtime, the probe
 *   through ../toolsWorker.ts cached 60 s ready / 5 s otherwise). Rows hold no path and no file name.
 * - proposeEyes, in the order of contract.ts RULES (the route has already checked scope, owner and project and parsed the body):
 *   the asset and its frame (picmodels refusals) → yunet ready (not_built → 501 eyes_not_built; any other code → 409 eyes_not_ready
 *   naming it) → one at a time (429 eyes_busy) → decode AS SHOWN (frames.ts) → ONE worker process (runToolsOnce, `serve --role eyes
 *   --model <verified path> --threads 2`, EYES.timeoutMs, SIGKILL on abort/timeout/answer) → the strict line → the answer (eyes.ts).
 * - NOTHING IS STORED: no job, no event, no file (pixels inline on stdin), no log line. Any failure becomes a picmodelsError.
 * Creating the runtime has no side effect: no file, no process, until a setup row or an eyes request is asked for.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EYES, EYES_METHOD_YUNET, PICTURE_MODELS, type Asset, type PictureModel, type PictureModelId, type PictureModelStatus } from '@pulseframe/core';
import { jpegOrientation } from '../ingest.ts';
import { LibraryService, libraryServiceFor } from '../library/index.ts';
import { ApiError } from '../store.ts';
import { assetFrames, frameSource } from '../tracking.ts';
import { probePicturePython, runToolsOnce } from '../toolsWorker.ts';
import {
  PICTURE_TEST_ADAPTER_LABEL, PICTURE_WORKER, PICTURE_WORKER_SHA256, picmodelsError,
  type ProbePicturePython, type PictureModelsRuntime, type PictureModelsRuntimeDeps, type PictureModelsTestSeams, type RunToolsOnce,
} from './contract.ts';
import { eyesAnswerFrom, parseEyesLine } from './eyes.ts';
import { decodeShown, type DecodeTarget } from './frames.ts';
import { createModelChecker } from './models.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
/** The reviewed worker of this installation. */
export const PICTURE_WORKER_FILE = path.join(REPO, ...PICTURE_WORKER.split('/'));

/** TEST ONLY additions (unit tests of the launcher seams); never from configuration. */
export interface PictureModelsRuntimeInternals { runOnce?: RunToolsOnce; probe?: ProbePicturePython }

export function createPictureModelsRuntime(deps: PictureModelsRuntimeDeps & PictureModelsTestSeams & PictureModelsRuntimeInternals): PictureModelsRuntime {
  const { cfg, store } = deps;
  const registry: readonly PictureModel[] = deps.registry ?? PICTURE_MODELS;
  const worker = deps.worker ?? PICTURE_WORKER_FILE;
  const reviewed = deps.worker ? (deps.workerSha256 ?? null) : PICTURE_WORKER_SHA256;
  const method = deps.worker ? PICTURE_TEST_ADAPTER_LABEL : EYES_METHOD_YUNET;
  const runOnce = deps.runOnce ?? runToolsOnce;
  let seamLibrary: LibraryService | null = null;
  const library = (): LibraryService => {
    if (deps.libraryRoot) return (seamLibrary ??= new LibraryService({ ...cfg, libraryDir: deps.libraryRoot }, { noStartupBuild: true }));
    return libraryServiceFor(cfg);
  };
  const checker = createModelChecker({
    libraryRoot: () => library().configuredRoot(),
    ledger: () => library().ledgerEntries(),
    worker, reviewed, toolsPython: cfg.toolsPython, tmpDir: store.tmpDir,
    probe: deps.probe ?? ((spec) => probePicturePython(spec)),
  });
  const modelOf = (id: PictureModelId): PictureModel => registry.find((m) => m.id === id) ?? PICTURE_MODELS.find((m) => m.id === id)!;
  /** Never throws: an unexpected failure of a check is an honest model_missing row with no detail beyond that. */
  const safeCheck = async (m: PictureModel) => {
    try { return await checker.check(m); } catch {
      return { status: { id: m.id, output: m.output, code: 'model_missing', module: null, device: null, missingBytes: 0, detail: 'the model could not be checked; check the library folder' } as PictureModelStatus, paths: null };
    }
  };

  let running: AbortController | null = null;

  async function proposeEyes(_p: unknown, projectId: string, body: { assetId: string; frame: number | null }, signal: AbortSignal) {
    // the asset and its frame
    const doc = store.getProject(projectId).doc;
    const asset: Asset | undefined = Object.hasOwn(doc.assets, body.assetId) ? doc.assets[body.assetId] : undefined;
    if (!asset) throw picmodelsError('assetMissing');
    let target: DecodeTarget;
    if (asset.kind === 'image' && asset.image) {
      if (body.frame !== null) throw picmodelsError('frameOnStill');
      target = { kind: 'still', file: store.blobPath(asset.contentHash), orientation: asset.container === 'jpeg' ? jpegOrientation(store.blobPath(asset.contentHash)) : 1, shown: { width: asset.image.width, height: asset.image.height } };
    } else if (asset.kind === 'video' && asset.video) {
      if (body.frame === null) throw picmodelsError('noFrame');
      if (body.frame >= assetFrames(asset)) throw picmodelsError('noSuchFrame');
      const src = frameSource(store, undefined, asset, 'original');
      target = { kind: 'video', file: src.file, frame: body.frame, shown: { width: src.width, height: src.height } };
    } else throw picmodelsError('noPicture');
    // yunet ready
    const yunet = modelOf('yunet');
    const { status, paths } = await safeCheck(yunet);
    if (status.code === 'not_built') throw picmodelsError('notBuilt');
    if (status.code !== 'ready' || !paths?.[0]) throw picmodelsError('notReady', { setup: status.code }, status.code);
    // one at a time
    if (running) throw picmodelsError('busy');
    const ac = new AbortController();
    running = ac;
    const onAbort = () => ac.abort(signal.reason);
    if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener('abort', onAbort, { once: true });
    try {
      const pic = await decodeShown(target, ac.signal);
      const id = 1;
      const raw = await runOnce({ python: cfg.toolsPython!, script: worker, tmpDir: store.tmpDir },
        ['serve', '--role', 'eyes', '--model', paths[0], '--threads', String(EYES.threads)],
        { id, cmd: 'eyes', w: pic.w, h: pic.h, rgb: pic.rgb.toString('base64') }, ac.signal, EYES.timeoutMs);
      let answer;
      try { answer = eyesAnswerFrom(parseEyesLine(raw, id), pic, target.shown, method); } catch (e) {
        if (e instanceof ApiError && e.code === 'eyes_not_ready') checker.forget(paths[0]); // the worker refused the file: check it again
        throw e;
      }
      return answer;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'eyes_engine_failed' && e.details.code === 'model_mismatch') { checker.forget(paths[0]); throw picmodelsError('notReady', { setup: 'model_missing' }, 'model_missing'); }
        throw e;
      }
      // the request was aborted (the client went away or «עצרו»), or anything else: a code, never the error's text
      throw picmodelsError('engineFailed', { reason: ac.signal.aborted ? 'aborted' : 'internal' });
    } finally {
      signal.removeEventListener('abort', onAbort);
      running = null;
    }
  }

  return {
    setup: async (id) => (await safeCheck(modelOf(id))).status,
    list: async () => { const out: PictureModelStatus[] = []; for (const m of registry) out.push((await safeCheck(m)).status); return out; },
    proposeEyes,
    stop: async () => { running?.abort(new Error('server stopping')); running = null; seamLibrary?.close(); seamLibrary = null; },
  };
}
