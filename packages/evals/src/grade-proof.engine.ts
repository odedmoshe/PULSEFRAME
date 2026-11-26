/** proof:grade, part «engine» (W1: G1–G10; grade-proof.ts GRADE_CHECKS). Set built when every check of the part has a run. */
import type { GradeProofPart } from './grade-proof.ts';

export const GRADE_PROOF_ENGINE: GradeProofPart = { built: false, checks: {} };
