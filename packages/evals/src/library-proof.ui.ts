/** pnpm proof:library, part ui (worker C): checks 17 of library-proof.ts. Not built: the runner exits 2 until `built` is true. */
import type { LibraryProofPart } from './library-proof.ts';

export const LIBRARY_PROOF_UI: LibraryProofPart = { built: false, checks: {} };
