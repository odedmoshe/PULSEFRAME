/** pnpm proof:library, part server (worker A): checks 1–11, 16, 18 of library-proof.ts. Not built: the runner exits 2 until `built` is true. */
import type { LibraryProofPart } from './library-proof.ts';

export const LIBRARY_PROOF_SERVER: LibraryProofPart = { built: false, checks: {} };
