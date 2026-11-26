/**
 * Keeps the Hebrew wording of the «תמונה חיה» refusals (packages/i18n/src/living.ts HE_LIVING, and the adjustment reason in refusals.ts)
 * in step with the fixed English of core livingContract.ts LIVING_REFUSALS: every sentence is worded in Hebrew, says what to do next
 * (a plural imperative), every pattern is used, and the refusals the pre-pass can provoke are provoked through the real ops. W1 owns
 * this file after the pre-pass (provoke notPhoto…tooFast through set_living_picture once built).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, LIVING_EFFECT, LIVING_REFUSALS, OpError, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { HE_LIVING, LIVING_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const SAMPLES: Record<keyof typeof LIVING_REFUSALS, string> = {
  notBuilt: LIVING_REFUSALS.notBuilt.message(), notPhoto: LIVING_REFUSALS.notPhoto.message(), tooShort: LIVING_REFUSALS.tooShort.message(),
  tooFast: LIVING_REFUSALS.tooFast.message(0.43), needsDepth: LIVING_REFUSALS.needsDepth.message(), depthInUse: LIVING_REFUSALS.depthInUse.message(),
  useOp: LIVING_REFUSALS.useOp.message(), rotated: LIVING_REFUSALS.rotated.message(), depthInvalid: LIVING_REFUSALS.depthInvalid.message('stroke 1 has an odd number of coordinates'),
  depthOtherFile: LIVING_REFUSALS.depthOtherFile.message(),
};
const IMPERATIVE = /(הסירו|ציירו|בחרו|האריכו|הנמיכו|החזירו|עדכנו|השאירו|הוסיפו|נסו)/;

describe('living wording', () => {
  it('every refusal is worded in Hebrew with a next step by its own pattern, and every pattern is used', () => {
    const used = new Set<RegExp>();
    for (const [k, msg] of Object.entries(SAMPLES)) {
      const he = translateRefusal('he', msg);
      expect(he && /[א-ת]/.test(he), k).toBe(true);
      expect(IMPERATIVE.test(he!), `${k}: says what to do next`).toBe(true);
      const own = HE_LIVING.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
      expect(LIVING_REFUSALS[k as keyof typeof LIVING_REFUSALS].hint.length, k).toBeGreaterThan(10);
    }
    expect(translateRefusal('he', SAMPLES.tooFast)).toContain('0.43');
    expect(LIVING_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('provoked for real: add_effect, set_clip_depth on a video and with null under a living picture, the adjustment reason', () => {
    const R = { num: 30, den: 1 }, f = (n: number) => T.frameTime(n, R);
    const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
    let doc: ProjectDocument = createProject({ id: 'p', name: 'p', frameRate: R });
    const run = (ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `w${Math.random().toString(36).slice(2, 6)}_`, actor: 'test', allowInternal: true });
    let r = run([{ op: 'import_asset', args: { asset: { kind: 'image', name: 'a.png', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov } } }]);
    doc = r.doc;
    r = run([{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(0), duration: f(90) } }, { op: 'add_adjustment', args: { span: 'edit' } }]);
    doc = r.doc;
    const clip = r.results[0]!.output!.clipId as string, adj = r.results[1]!.output!.clipId as string;
    const msg = (ops: OpCall[]) => { try { run(ops); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };
    for (const m of [msg([{ op: 'add_effect', args: { clipId: clip, type: LIVING_EFFECT } }]), msg([{ op: 'set_clip_depth', args: { clipId: adj, depth: null } }]), msg([{ op: 'set_living_picture', args: { clipId: clip } }])]) {
      const he = translateRefusal('he', m);
      expect(he && /[א-ת]/.test(he) && IMPERATIVE.test(he), m).toBe(true);
    }
    const onAdj = translateRefusal('he', msg([{ op: 'add_effect', args: { clipId: adj, type: LIVING_EFFECT } }]));
    expect(onAdj).toContain('לתמונה חיה צריך תמונה משלה');
  });
});
