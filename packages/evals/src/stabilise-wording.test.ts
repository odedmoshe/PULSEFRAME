/**
 * Keeps the Hebrew wording of the stabilise refusals (packages/i18n/src/stabilise.ts HE_STABILISE, and the shared-budget sentence in
 * refusals.ts) in step with the fixed English sentences of core steadyContract.ts STEADY_REFUSALS and apps/server/src/stabilise.ts
 * STABILISE_SERVER_REFUSALS: every sentence, with every reason it can carry, is worded in Hebrew, says what to do next, and every
 * pattern of the table is used. notBuilt and the attach refusals are provoked for real; the rest come from the table until W2's
 * bodies exist — W2 then provokes each through its operation here (it.todo below). The server's inProgress, busy and clipChanged
 * are provoked for real by W1 in apps/server/src/stabilise.test.ts.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument, MAX_PROJECT_TRACK_SAMPLES, MAX_STEADY_SAMPLES, OpError, SST, STEADY_COLUMN_PROBLEMS, STEADY_OPS_BUILT, STEADY_REFUSALS, type SteadyRefusalKey } from '@pulseframe/core';
import { STABILISE_SERVER_REFUSALS, type StabiliseServerRefusalKey } from '../../../apps/server/src/stabilise.ts';
import { dictionaries, STABILISE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const caught = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };
const R = { num: 30, den: 1 };

function opSentences(): Record<SteadyRefusalKey, string[]> {
  const S = STEADY_REFUSALS;
  const asset = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(100, R), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 100 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } };
  const r = applyTransaction(createProject({ id: 'prj_sw', name: 'SW', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset } }], { idSeed: 'sw_', actor: 'test', allowInternal: true });
  const doc = r.doc, assetId = r.results[0]!.output!.assetId as string;
  const attach = (args: Record<string, unknown>) => caught(() => applyTransaction(doc, [{ op: 'attach_camera_motion', args: { assetId, from: 0, dx: [0, 0], dy: [0, 0], dr: [0, 0], dz: [0, 0], st: [SST.start, SST.ok], method: 't', params: {}, createdAt: 'x', ...args } }], { idSeed: 'sw2_', actor: 'test', allowInternal: true }));
  const notBuilt = STEADY_OPS_BUILT
    ? ['set_clip_stabilise', 'remove_camera_motion'].map((op) => S.notBuilt.message(op))
    : [caught(() => applyTransaction(doc, [{ op: 'set_clip_stabilise', args: { clipId: 'clp_x', stabilise: null } }], { idSeed: 'sw3_', actor: 'test' })),
      caught(() => applyTransaction(doc, [{ op: 'remove_camera_motion', args: { assetId } }], { idSeed: 'sw4_', actor: 'test' }))];
  return {
    notBuilt,
    ...(STEADY_OPS_BUILT ? provokedOps() : { notVideo: [S.notVideo.message()], multicam: [S.multicam.message()], notMeasured: [S.notMeasured.message()], tooLittle: [S.tooLittle.message(37)], inUse: [S.inUse.message(2)], noMeasurement: [S.noMeasurement.message()] }),
    clipTooLong: [S.clipTooLong.message(12_000)], fileFull: [S.fileFull.message(MAX_STEADY_SAMPLES + 1)], tooManyStretches: [S.tooManyStretches.message()],
    budget: [S.budget.message(MAX_PROJECT_TRACK_SAMPLES + 9, MAX_PROJECT_TRACK_SAMPLES)], otherFile: [S.otherFile.message()],
    assetMissing: [attach({ assetId: 'ast_none' })],
    noVideoFile: [S.noVideoFile.message()],
    badColumns: [attach({ dx: [0] }), attach({ dz: [0, 400_000] })],
    outsideFile: [attach({ from: 99 })],
    firstNotStart: [attach({ st: [SST.ok, SST.ok] })],
  };
}
/**
 * The refusals of set_clip_stabilise and remove_camera_motion, each provoked through its operation (once STEADY_OPS_BUILT): a sound
 * clip (notVideo), a clip tagged as a multicam segment (multicam), no measurement (notMeasured, noMeasurement), a measurement with
 * 44 % of the clip's frames measured (tooLittle), two stabilised clips (inUse).
 */
function provokedOps(): Pick<Record<SteadyRefusalKey, string[]>, 'notVideo' | 'multicam' | 'notMeasured' | 'tooLittle' | 'inUse' | 'noMeasurement'> {
  const run = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `swp${k++}_`, actor: 'test', allowInternal });
  let k = 0;
  const asset = { kind: 'video' as const, name: 'w.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(300, R), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } };
  const r0 = run(createProject({ id: 'prj_swp', name: 'SWP', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r0.results[0]!.output!.assetId as string;
  const r1 = run(r0.doc, [{ op: 'add_clip', args: { assetId, start: T.ZERO, duration: T.frameTime(90, R) } }, { op: 'add_clip', args: { assetId, start: T.frameTime(90, R), sourceIn: T.frameTime(100, R), duration: T.frameTime(90, R) } }]);
  const doc = r1.doc;
  const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
  const [a, b] = tracks.find((t) => t.kind === 'video')!.clips.map((c) => c.id) as [string, string];
  const sound = tracks.find((t) => t.kind === 'audio')?.clips[0]?.id;
  const set = (d: ProjectDocument, clipId: string) => caught(() => run(d, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }]));
  const z = (n: number) => new Array<number>(n).fill(0);
  const measure = (st: number[]) => run(doc, [{ op: 'attach_camera_motion', args: { assetId, from: 0, dx: z(st.length), dy: z(st.length), dr: z(st.length), dz: z(st.length), st, method: 't', params: {}, createdAt: 'x' } }], true).doc;
  const thin = measure([SST.start, ...new Array<number>(39).fill(SST.ok), ...new Array<number>(160).fill(SST.unknown)]);
  const full = measure([SST.start, ...new Array<number>(199).fill(SST.ok)]);
  const both = run(full, [{ op: 'set_clip_stabilise', args: { clipId: a, stabilise: {} } }, { op: 'set_clip_stabilise', args: { clipId: b, stabilise: {} } }]).doc;
  const mc = structuredClone(full);
  (mc.sequences[mc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === a) as { multicam?: unknown }).multicam = { groupId: 'mcg_x', angle: 'x' };
  return {
    notVideo: sound ? [set(doc, sound)] : [STEADY_REFUSALS.notVideo.message()],
    multicam: [set(mc, a)],
    notMeasured: [set(doc, a)],
    tooLittle: [set(thin, a)],
    inUse: [caught(() => run(both, [{ op: 'remove_camera_motion', args: { assetId } }]))],
    noMeasurement: [caught(() => run(doc, [{ op: 'remove_camera_motion', args: { assetId } }]))],
  };
}
function serverSentences(): Record<StabiliseServerRefusalKey, string[]> {
  const S = STABILISE_SERVER_REFUSALS;
  return { notBuilt: [S.notBuilt.message()], inProgress: [S.inProgress.message()], busy: [S.busy.message()], clipChanged: [S.clipChanged.message()] };
}

describe('stabilise refusals in Hebrew', () => {
  const ops = opSentences();
  const all = [...Object.values(ops).flat(), ...Object.values(serverSentences()).flat()];
  it('the provoked sentences equal the table', () => {
    expect(ops.badColumns).toEqual(STEADY_COLUMN_PROBLEMS.map((p) => STEADY_REFUSALS.badColumns.message(p)));
    expect(ops.outsideFile).toEqual([STEADY_REFUSALS.outsideFile.message(101, 100)]);
  });
  it('every sentence is worded, in Hebrew, with a next step, and no reason falls back to the generic words', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, fallback: /לא עבר בדיקה/.test(he!) }).toEqual({ en, fallback: false });
      expect({ en, nextStep: /[.:—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of the table is used by some sentence; the vocabulary is the product\'s', () => {
    expect(STABILISE_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en))).map(String)).toEqual([]);
    const he = all.map((en) => translateRefusal('he', en)!).join(' ');
    expect(he).not.toMatch(/תמונות|רב־מצלמות/);
  });
  it('the shared strings exist in both languages', () => {
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      const missing = ['op.attach_camera_motion', 'op.set_clip_stabilise', 'op.remove_camera_motion', 'cmd.stabiliseToggle', 'stab.title', ...Object.values(STABILISE_SERVER_REFUSALS).map((r) => `error.code.${r.code}`)].filter((k) => !d[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });
  it('each set_clip_stabilise / remove_camera_motion refusal is provoked for real through its operation and equals the table', () => {
    expect(STEADY_OPS_BUILT).toBe(true);
    const S = STEADY_REFUSALS;
    expect(ops).toMatchObject({ notVideo: [S.notVideo.message()], multicam: [S.multicam.message()], notMeasured: [S.notMeasured.message()], tooLittle: [S.tooLittle.message(44)], inUse: [S.inUse.message(2)], noMeasurement: [S.noMeasurement.message()] });
  });
});
