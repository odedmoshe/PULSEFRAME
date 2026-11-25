import { describe, expect, it } from 'vitest';
import { exitCode, verdict } from './library-proof.verdict.ts';

describe('proof:library verdicts', () => {
  it('a BLOCKED sentence is blocked, not a failure and never a pass', () => {
    expect(verdict(true)).toBe('PASS');
    expect(verdict('BLOCKED (no SVG rasteriser on this machine)')).toBe('BLOCKED');
    expect(verdict('BLOCKED: web bundle missing (run `pnpm build`)')).toBe('BLOCKED');
    expect(verdict('the export was refused')).toBe('FAIL');
    expect(verdict('BLOCKEDX is not a reason')).toBe('FAIL');
    expect(verdict('not BLOCKED at the start')).toBe('FAIL');
    expect(verdict('')).toBe('FAIL');
  });
  it('exit code: any failure 1, else any blocked 2, else 0', () => {
    expect(exitCode(['PASS', 'PASS'])).toBe(0);
    expect(exitCode(['PASS', 'BLOCKED'])).toBe(2);
    expect(exitCode(['BLOCKED', 'FAIL', 'PASS'])).toBe(1);
    expect(exitCode([])).toBe(0);
  });
});
