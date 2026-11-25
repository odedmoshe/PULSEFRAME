/**
 * How pnpm proof:library reads a check's answer (library-proof.ts). Kept apart from the runner so a test can import it without the
 * proof's side effects (the server part counts outbound connections from the moment it is imported).
 * - true passes;
 * - a sentence beginning with "BLOCKED" is blocked: the check could not run here and says why (exit 2), never a pass, never a failure;
 * - any other sentence, and a check that throws, is a failure (exit 1).
 */
export type Verdict = 'PASS' | 'BLOCKED' | 'FAIL';
export function verdict(r: true | string): Verdict {
  return r === true ? 'PASS' : /^BLOCKED\b/.test(r) ? 'BLOCKED' : 'FAIL';
}
/** 1 on any failure, else 2 when anything was blocked, else 0. */
export const exitCode = (verdicts: readonly Verdict[]): 0 | 1 | 2 => (verdicts.includes('FAIL') ? 1 : verdicts.includes('BLOCKED') ? 2 : 0);
