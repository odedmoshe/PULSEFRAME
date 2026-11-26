/**
 * The picture-model runtime (wave 8 picmodels; contract.ts PictureModelsRuntime). W1 OWNS THIS FILE and builds it: per-model setup in
 * the order of core PICTURE_MODEL_SETUP_CODES (models.ts: ledger-only lookup, resolveInside, size and SHA-256 cached by path+size+mtime;
 * the probe through ../toolsWorker.ts), and proposeEyes (eyes.ts + frames.ts). The pre-pass stub is the honest not-built runtime:
 * every row not_built, eyes 501. Creating it has no side effect (no file, no process).
 */
import { notBuiltPictureModels, type PictureModelsRuntime, type PictureModelsRuntimeDeps, type PictureModelsTestSeams } from './contract.ts';

export function createPictureModelsRuntime(deps: PictureModelsRuntimeDeps & PictureModelsTestSeams): PictureModelsRuntime {
  return notBuiltPictureModels(deps.registry);
}
