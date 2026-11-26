/**
 * The lead's contract of the wave 8 qc track (qcContract.ts): the codes, severities, explained reasons and the cover allow-list
 * are consistent, the cut rules are not stubbed, and the not-built stubs are honest (no issue, nothing explained). The rules'
 * own tests are B1's (qcChecks.test.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  assembleChecks, createProject, documentChecks, EFFECTS, EXPLAINED_FOR, EXPLAINED_REASONS, explainFindings, PREFLIGHT_CODES_ENGLISH_ONLY_BEFORE_QC,
  PREFLIGHT_SHOWN_CODES, QC_BUILT, QC_CODES, QC_COVER_SAFE_EFFECTS, QC_LIMITS, QC_SEVERITY,
} from './index.ts';

describe('qc contract (wave 8)', () => {
  it('every code has one severity; every explained reason names the one finding kind it may explain', () => {
    expect(Object.keys(QC_SEVERITY).sort()).toEqual([...QC_CODES].sort());
    expect(Object.keys(EXPLAINED_FOR).sort()).toEqual([...EXPLAINED_REASONS].sort());
    expect(new Set(PREFLIGHT_SHOWN_CODES).size).toBe(PREFLIGHT_SHOWN_CODES.length);
    expect(PREFLIGHT_CODES_ENGLISH_ONLY_BEFORE_QC).toHaveLength(28); // verifier C12
  });
  it('the cover allow-list names real effects, and none that makes a clip transparent, moves or warps it (C3)', () => {
    const ids = new Set((EFFECTS as readonly { id: string }[]).map((e) => e.id));
    for (const id of QC_COVER_SAFE_EFFECTS) expect(ids.has(id), id).toBe(true);
    expect(QC_COVER_SAFE_EFFECTS.some((id) => /^(key|motion|distort|time|digital)\./.test(id))).toBe(false);
  });
  it('thresholds are exact rationals or integers, never float seconds', () => {
    for (const v of Object.values(QC_LIMITS)) if (typeof v === 'object') { expect(Number.isInteger(v.num) && Number.isInteger(v.den) && v.den > 0).toBe(true); }
    expect(Math.ceil((30 * QC_LIMITS.flashClipSeconds.num) / QC_LIMITS.flashClipSeconds.den)).toBe(3);
    expect(Math.ceil((60 * QC_LIMITS.flashClipSeconds.num) / QC_LIMITS.flashClipSeconds.den)).toBe(6);
  });
  it('the cut rules are not stubbed anywhere in the contract (faded_out C4, there C15, held_past_source C1)', () => {
    const text = ['qcContract.ts', 'qcChecks.ts'].map((f) => fs.readFileSync(path.join(import.meta.dirname, f), 'utf8')).join('\n');
    for (const cut of ["'faded_out'", "'held_past_source'", 'there?:']) expect(text.includes(cut), cut).toBe(false);
  });
  it.runIf(!QC_BUILT)('until B1 builds them, the stubs find nothing and explain nothing (never a fake finding)', () => {
    const doc = createProject({ id: 'prj_qc', name: 'qc' });
    expect(documentChecks(doc)).toEqual({ built: false, issues: [], skipped: [] });
    const checks = assembleChecks(
      { method: 'm', status: 'measured', findings: [{ kind: 'black', from: T.rt(0, 1), to: T.rt(1, 1), context: 'picture', measured: { frames: 30 } }] },
      { method: 'm', status: 'not_measured', findings: [] },
    );
    expect(explainFindings(doc, 0, checks)).toEqual(checks);
  });
});
