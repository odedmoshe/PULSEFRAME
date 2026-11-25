/** pnpm proof:craft, part versions (W2): checks V1–V7, V9–V11 of craft-proof.ts. Not built: the runner exits 2 until `built` is true. */
import type { CraftProofPart } from './craft-proof.ts';

export const CRAFT_PROOF_VERSIONS: CraftProofPart = { built: false, checks: {} };
