/** pnpm proof:craft, part ops (W1): checks R1–R7, P1–P3, P5–P8, F1–F6, F9, F11 of craft-proof.ts. Not built: the runner exits 2 until `built` is true. */
import type { CraftProofPart } from './craft-proof.ts';

export const CRAFT_PROOF_OPS: CraftProofPart = { built: false, checks: {} };
