/**
 * The generic tools-Python launcher of the picture-model runtime (wave 8 picmodels; verify C17: a NEW file used by picmodels only —
 * search/workers.ts keeps its own KeptWorker, untouched; the two are joined in a later wave). W1 OWNS THIS FILE and builds both
 * functions to the contracts in picmodels/contract.ts (RunToolsOnce, ProbePicturePython): one process per request, SIGKILL on abort,
 * on the timeout and after the answer, nothing written, nothing logged, no raw text in an error. Until then they throw the typed
 * not-built error (never a made-up answer).
 */
import { PictureModelsNotBuilt } from '@pulseframe/core';
import type { ProbePicturePython, RunToolsOnce } from './picmodels/contract.ts';

export const runToolsOnce: RunToolsOnce = async () => { throw new PictureModelsNotBuilt('runToolsOnce'); };
export const probePicturePython: ProbePicturePython = async () => { throw new PictureModelsNotBuilt('probePicturePython'); };
