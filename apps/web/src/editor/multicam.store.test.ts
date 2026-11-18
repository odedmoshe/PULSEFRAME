/**
 * The recording session's commit window and report in the real Editor (ADR-0020): api.commit and load are stand-ins (labelled);
 * the Editor, the session and the strings are real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { createProject } from '@pulseframe/core';
import { api } from '../api.ts';
import { record, type MulticamSession } from './multicamSession.ts';

// ---- labelled stand-ins (test only) ----
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { Editor } = await import('./store.ts');
// ---- end of stand-ins ----

const R = { num: 30, den: 1 };
const g = (f: number) => T.frameTime(f, R);
const base: MulticamSession = { groupId: 'mcg_1', sequenceId: 'seq_1', trackId: 'trk_v', cuts: [], baseRevision: 3, reactionFrames: 0 };
const doc = createProject({ id: 'prj_ms', name: 'MS', frameRate: R, width: 320, height: 180 });
const out = (extra: object = {}) => ({ cuts: [{ at: g(30), angleId: 'ang_a' }], switchedClipIds: [], createdClipIds: [], healedClipIds: [], skipped: [], dropped: [], warnings: [], ...extra });

function rig(output: object = out()) {
  const ed = new Editor();
  ed.set({ doc, rawDoc: doc, revision: 3, lang: 'en', multicamRec: record(record(base, g(30), 'ang_a'), g(60), 'ang_b') });
  vi.spyOn(ed, 'load').mockResolvedValue(undefined as never);
  const commit = vi.spyOn(api, 'commit').mockImplementation(async () => { await new Promise((r) => setTimeout(r, 30)); return { revision: 4, results: [{ output }] } as never; });
  return { ed, commit };
}
const live = (ed: InstanceType<typeof Editor>) => ed.getState().multicamLive?.text ?? '';

describe('the commit window of a recording', () => {
  afterEach(() => vi.restoreAllMocks());
  it('a second stop sends nothing: one switch_angles', async () => {
    const { ed, commit } = rig();
    const a = ed.stopRecording();
    const b = ed.stopRecording();
    await Promise.all([a, b]);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]![2]).toHaveLength(1);
  });
  it('digits, recordingSwitches and Escape are inert while the commit runs, and the saved text stands', async () => {
    const { ed, commit } = rig();
    const done = ed.stopRecording();
    expect(ed.recordingSwitches).toBe(false);
    const before = ed.getState().multicamRec;
    ed.recordCut('ang_c');
    expect(ed.getState().multicamRec).toBe(before);
    ed.discardRecording();
    await done;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(live(ed)).toContain('cuts saved');
    expect(live(ed)).not.toContain('discarded');
    expect(ed.getState().multicamRec).toBeNull();
  });
  it('a failed commit re-opens nothing and leaves no stuck window', async () => {
    const { ed, commit } = rig();
    commit.mockRejectedValue(new Error('down'));
    await ed.stopRecording();
    expect(live(ed)).toBe('The cuts were not saved');
    ed.set({ multicamRec: record(base, g(30), 'ang_a') });
    expect(ed.recordingSwitches).toBe(true);
  });
});

describe('what a commit reports', () => {
  afterEach(() => vi.restoreAllMocks());
  it('redaction_missing and dropped items reach the live text', async () => {
    const { ed } = rig(out({ warnings: [{ code: 'redaction_missing' }], dropped: [{ what: 'follow' }] }));
    await ed.stopRecording();
    expect(live(ed)).toContain('The new angle has no privacy regions');
    expect(live(ed)).toContain('Motion follow');
  });
  it('a paused digit switch says the same on the stage', async () => {
    const { ed } = rig();
    vi.spyOn(ed, 'commit').mockResolvedValue({ revision: 4, results: [{ output: out({ warnings: [{ code: 'redaction_missing' }], dropped: [{ what: 'follow' }] }) }] } as never);
    await (ed as unknown as { commitSwitch(a: object): Promise<unknown> }).commitSwitch({});
    expect(ed.getState().stageNote?.text).toContain('The new angle has no privacy regions');
    expect(ed.getState().stageNote?.text).toContain('Motion follow');
  });
});

describe('timeline badge strip', () => {
  it('a plain multicam segment shows its badge strip', async () => {
    const { hasClipBadges } = await import('./Timeline.tsx');
    const none = { fxCount: 0, speed: 1, ai: false, onBeatFx: false, media: false };
    expect(hasClipBadges({ ...none, mcBadge: '2 · Camera B' })).toBe(true);
    expect(hasClipBadges({ ...none, mcBadge: null })).toBe(false);
  });
});
