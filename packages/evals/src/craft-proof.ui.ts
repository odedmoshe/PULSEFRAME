/** pnpm proof:craft, part ui (W3): checks R8, F7, F8, F10, U1–U3 of craft-proof.ts. Not built: the runner exits 2 until `built` is true. */
import type { CraftProofPart } from './craft-proof.ts';

export const CRAFT_PROOF_UI: CraftProofPart = { built: false, checks: {} };
