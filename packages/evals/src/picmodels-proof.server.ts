/**
 * proof:picmodels, server part (W1 owns this file): a real server (startServer port 0, deps.picmodelsTest = the labelled fake, its
 * digest, a synthetic registry whose yunet pin names a tiny synthetic file, and a synthetic library root with _manifests/ledger.json),
 * the fixtures of picmodels-fixtures.ts plus EXIF stills from apps/server/src/captureMeta.fixtures.ts. Checks: E3, E5, E6, E7, E8,
 * E10 (server side), E11, E12, R1, R2 of PICMODELS_CHECKS. Not built: the entry point exits 2.
 */
import type { PicmodelsProofPart } from './picmodels-proof.ts';

export const PICMODELS_PROOF_SERVER: PicmodelsProofPart = { built: false, checks: {} };
