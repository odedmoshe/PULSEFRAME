/** pnpm proof:library, part duties (worker B): checks 12–15 of library-proof.ts. Not built: the runner exits 2 until `built` is true. */
import type { LibraryProofPart } from './library-proof.ts';

export const LIBRARY_PROOF_DUTIES: LibraryProofPart = { built: false, checks: {} };
