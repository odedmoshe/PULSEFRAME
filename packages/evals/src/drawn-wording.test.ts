/**
 * Keeps the Hebrew of the drawn-clip carrier's refusals (packages/i18n/src/drawn.ts HE_DRAWN) in step with the English sentences
 * of core: each refusal is provoked for real with the TEST-ONLY drawn kind (core drawn.testKind.ts), worded in Hebrew with the
 * next step, and every pattern of the table is used. The payload refusal (reached only by a kind op that does not parse its payload
 * itself) and drawn_track (reached only by a document no op makes) are worded from their sentences. The error codes have both names.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, DRAWN_NOT_TEXT, OpError, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { registerTestDrawnOp, testDrawn } from '@pulseframe/core/drawn.testKind.ts';
import { dictionaries, translateRefusal } from '../../i18n/src/index.ts';
import { HE_DRAWN } from '../../i18n/src/drawn.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `dw${n++}_`, actor: 'test' });
const caught = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };

function provoked(): { code: string; message: string }[] {
  registerTestDrawnOp();
  let r = tx(createProject({ id: 'prj_dw', name: 'DW', width: 640, height: 360 }), [{ op: 'add_test_drawn', args: { start: f(0), duration: f(30), drawn: testDrawn() } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  const doc = r.doc;
  r = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }]);
  const video = r.results[0]!.output!.trackId as string;
  return [
    caught(() => tx(doc, [{ op: 'update_text', args: { clipId, text: 'x' } }])),
    caught(() => tx(r.doc, [{ op: 'add_test_drawn', args: { trackId: video, start: f(0), duration: f(10), drawn: testDrawn() } }])),
  ];
}

describe('drawn clips: the Hebrew of every carrier refusal', () => {
  const got = provoked();
  it('each refusal is worded in Hebrew and says what to do next', () => {
    expect(got.map((e) => e.code)).toEqual(['drawn_not_text', 'incompatible']);
    for (const e of got) {
      const he = translateRefusal('he', e.message);
      expect(he, e.message).toMatch(/[א-ת]/);
      expect(he, e.message).toMatch(/בחרו|העבירו|השאירו/);
    }
  });
  it('every pattern of HE_DRAWN is used (the payload refusal by its own sentence)', () => {
    const messages = [...got.map((e) => e.message), DRAWN_NOT_TEXT.message('trip map') /* the map's own line, provoked in tripmap-wording.test.ts */, 'drawn payload refused: color: Invalid string', 'transaction would produce an invalid project: drawn clip clp_1 on video track: a drawing goes on a titles track'];
    for (const [re] of HE_DRAWN) expect(messages.some((m) => re.test(m)), String(re)).toBe(true);
  });
  it('the error codes have Hebrew and English names', () => {
    for (const k of ['error.code.drawn_not_text', 'error.code.drawn_track'] as const) {
      expect(dictionaries.he[k]).toMatch(/[א-ת]/);
      expect(dictionaries.en[k]).toMatch(/[a-z]/);
    }
  });
});
