/**
 * The story interface's logic (W3), against the labelled planner double (packages/core/src/story.testDouble.ts) until W1's planner
 * is merged: choices → params, the strip, the music line, the honest unplayable probe, the recorder session (the privacy line: the
 * engine's release() on every path, the WAV only through the import queue), tap times, the review, the failures, the bar's options.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, STORY_TEMPLATE_ID, STORY_VERSION, StoryNotBuilt, storyRunRecordParams, type Asset, type ImportJobView, type ProjectDocument, type StoryPlanContext } from '@pulseframe/core';
import { planStoryDouble, planViewDouble } from '../../../../../packages/core/src/story.testDouble.ts';
import type { RecorderPorts, RecorderState, StoryRecorderHandle } from './recorder.contract.ts';
import {
  addableAssets, afterApply, buildBlocker, buildStoryParams, chipLine, createRecorderSession, cutsFromSnapshot, defaultChoices, frameThrottle, isNotBuilt, laneFraction, moveItem, moveOfKey, musicShort,
  narrationClip, pauseTicks, probePlayable, recordingName, rebuildOptions, reviewOf, sameCutFrames, saveRecording, savedJob, storyFailure, takeNotice, tapMsOf, tapsBefore, timelineOfMs,
  type AudioProbe, type StoryPlannerPort,
} from './story.logic.ts';

const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const R = { num: 30, den: 1 };
function doc(): ProjectDocument {
  const d = createProject({ id: 'prj_story', name: 'S', width: 640, height: 360, frameRate: R });
  const audio = (id: string, seconds: number, codec = 'pcm_s16le') => ({ id, kind: 'audio', name: `${id}.wav`, contentHash: `sha256:${id.padEnd(64, '0')}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(seconds, 1), audio: { sampleRate: 48000, channels: 1, codec }, provenance: prov }) as Asset;
  d.assets.nar = audio('nar', 24); d.assets.mus = audio('mus', 10); d.assets.alac = audio('alac', 24, 'alac');
  for (const id of ['i1', 'i2', 'i3', 'i4', 'i5']) d.assets[id] = { id, kind: 'image', name: `${id}.png`, contentHash: `sha256:${id.padEnd(64, '0')}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov } as Asset;
  return d;
}
const ctx: StoryPlanContext = { voice: null, voiceState: 'pending', capture: {}, title: null };
/** The double as a planner port: the plan, and its picture applied in memory through the real apply_template. */
const doublePlanner: StoryPlannerPort = {
  plan: (d, p, c) => planStoryDouble(d, p, c),
  live: (d, p, c, taps) => {
    const plan = planStoryDouble(d, { ...(p as object), cutsMs: [...taps] }, c);
    return applyTransaction(d, [{ op: 'apply_template', args: { templateId: STORY_TEMPLATE_ID, templateVersion: STORY_VERSION, params: storyRunRecordParams(plan, []), steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true } }], { idSeed: 'live_', actor: 'test', allowInternal: true }).doc;
  },
};

describe('choices and the dialog', () => {
  it('the choices start from the files that can be shown, in order, without sound files', () => {
    const c = defaultChoices({ assetIds: ['i3', 'nar', 'i1', 'i3', 'zzz'], event: null }, doc(), 'he');
    expect(c.assetIds).toEqual(['i3', 'i1']);
    expect(c.ownSound).toBe('under'); expect(c.openingTitle).toBe(true);
  });
  it('params need a narration and pictures and pass the strict schema; the title text only with the title on', () => {
    const c = defaultChoices({ assetIds: ['i1', 'i2'], event: { id: 'ev', name: 'חנוכה' } }, doc(), 'he');
    expect(buildStoryParams(c)).toBeNull();
    const p = buildStoryParams({ ...c, narrationAssetId: 'nar', openingText: '  חנוכה אצל סבתא ' })!;
    expect(p).toMatchObject({ narrationAssetId: 'nar', assetIds: ['i1', 'i2'], musicAssetId: null, ownSound: 'under', openingTitle: true, openingText: 'חנוכה אצל סבתא', lang: 'he' });
    expect(buildStoryParams({ ...c, narrationAssetId: 'nar', openingTitle: false, openingText: 'x' })).not.toHaveProperty('openingText');
    expect(buildStoryParams({ ...c, narrationAssetId: 'nar', assetIds: [] })).toBeNull();
  });
  it('the blockers say what to do next, in both languages; an unplayable file blocks with its codec', () => {
    const c = { ...defaultChoices({ assetIds: ['i1'], event: null }, doc(), 'he'), narrationAssetId: null as string | null };
    expect(buildBlocker(c, 'ok', 'he', '?')).toMatch(/קריינות/);
    expect(buildBlocker({ ...c, narrationAssetId: 'nar', assetIds: [] }, 'ok', 'en', '?')).toMatch(/no pictures/);
    expect(buildBlocker({ ...c, narrationAssetId: 'alac' }, 'unplayable', 'he', 'alac')).toBe('הקובץ לא מתנגן בעורך (קודק ⁦alac⁩). הקליטו כאן או המירו אותו');
    expect(buildBlocker({ ...c, narrationAssetId: 'alac' }, 'unplayable', 'en', 'alac')).toMatch(/cannot be played in the editor/);
    expect(buildBlocker({ ...c, narrationAssetId: 'nar' }, 'ok', 'he', 'pcm')).toBeNull();
    expect(buildBlocker({ ...c, narrationAssetId: 'nar' }, 'unknown', 'he', 'pcm')).toBeNull();
  });
  it('the strip moves items, keys follow the interface direction, the library offers only what is not in yet', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 99)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a'], 5, 0)).toEqual(['a']);
    expect(moveOfKey({ key: 'ArrowLeft', altKey: true }, true)).toBe(1);
    expect(moveOfKey({ key: 'ArrowLeft', altKey: true }, false)).toBe(-1);
    expect(moveOfKey({ key: 'ArrowLeft', altKey: false }, true)).toBeNull();
    expect(addableAssets(doc(), ['i1', 'i2']).map((a) => a.id)).toEqual(['i3', 'i4', 'i5']);
  });
  it('music shorter than the narration is said before building, with both lengths', () => {
    expect(musicShort(doc(), 'mus', 'nar')).toEqual({ music: 10, narration: 24 });
    expect(musicShort(doc(), null, 'nar')).toBeNull();
    expect(musicShort(doc(), 'nar', 'nar')).toBeNull();
  });
});

describe('the unplayable probe', () => {
  const fake = () => {
    const l = new Map<string, () => void>();
    const a: AudioProbe & { fire(t: string): void } = { src: '', preload: '', addEventListener: (t, f) => { l.set(t, f); }, removeEventListener: (t) => { l.delete(t); }, load() {}, fire: (t) => l.get(t)?.() };
    return a;
  };
  it('loadedmetadata is ok, an error is unplayable, silence is unknown (never blocks)', async () => {
    const a = fake(); const p = probePlayable(() => a, '/x');
    expect(a.src).toBe('/x'); a.fire('loadedmetadata');
    expect(await p.result).toBe('ok');
    const b = fake(); const q = probePlayable(() => b, '/y'); b.fire('error');
    expect(await q.result).toBe('unplayable');
    let timer: (() => void) | null = null;
    const c = fake(); const r = probePlayable(() => c, '/z', 5, (fn) => { timer = fn; return 1; }, () => {});
    timer!();
    expect(await r.result).toBe('unknown');
  });
});

/** An engine that counts what the privacy line is about. */
function fakeEngine() {
  const calls = { start: 0, stop: 0, discard: 0, release: 0 };
  let ports!: RecorderPorts;
  const make = (p: RecorderPorts): StoryRecorderHandle => { ports = p; return { start: async () => { calls.start++; }, stop: () => { calls.stop++; }, discard: () => { calls.discard++; }, release: () => { calls.release++; }, tracks: () => [] }; };
  return { make, calls, emit: (s: RecorderState) => ports.onState(s), ports: () => ports };
}
const io = { getUserMedia: async () => ({}) as MediaStream, createContext: () => ({}) as AudioContext };

describe('PRIVACY: the recorder session releases the microphone on every path', () => {
  it('dialog closed (release) and unmount (dispose) each call the engine\'s release(); both are safe to repeat', () => {
    const e = fakeEngine();
    const states: string[] = [];
    const s = createRecorderSession(e.make, (st) => states.push(st.kind), io);
    s.release();                       // the dialog closes: button, Escape, backdrop, or a build
    expect(e.calls.release).toBe(1);
    s.dispose();                       // the component unmounts (route change)
    expect(e.calls.release).toBe(2);
    s.dispose(); s.release();          // repeated: idempotent on the engine, still counted, never throws
    expect(e.calls.release).toBe(4);
    expect(s.releases()).toBe(4);
  });
  it('after dispose no state is forwarded to the gone component, but the engine can still report', () => {
    const e = fakeEngine(); const seen: string[] = [];
    const s = createRecorderSession(e.make, (st) => seen.push(st.kind), io);
    e.emit({ kind: 'asking' }); s.dispose(); e.emit({ kind: 'idle' });
    expect(seen).toEqual(['asking']); expect(s.state.kind).toBe('idle');
  });
  it('record again drops the take through the engine; the test limit reaches the engine\'s port', () => {
    const e = fakeEngine();
    const s = createRecorderSession(e.make, () => {}, { ...io, maxMs: 3000 });
    s.discard(); s.stop(); void s.start();
    expect(e.calls).toMatchObject({ discard: 1, stop: 1, start: 1 });
    expect(e.ports().maxMs).toBe(3000);
  });
  it('the wiring: the component releases on unmount, StoryDialog on every close path, nothing is stored or sent another way', () => {
    const dir = import.meta.dirname;
    const rec = fs.readFileSync(path.join(dir, 'StoryRecorder.tsx'), 'utf8');
    const dlg = fs.readFileSync(path.join(dir, 'StoryDialog.tsx'), 'utf8');
    expect(rec).toMatch(/return \(\) => \{ s\.dispose\(\);/);
    expect(rec).toContain('releaseRef.current = () => s.release()');
    // one close(), which releases first; the Dialog, the close button and every build path use it
    expect(dlg).toMatch(/const close = \(\) => \{ releaseMic\.current\?\.\(\); editor\.closeStory\(\); \}/);
    expect(dlg).toContain('onClose={close}');
    expect(dlg).toContain('data-testid={ID.close} onClick={close}');
    expect(dlg).toContain('dismissOnBackdrop footer');
    expect(dlg.match(/editor\.closeStory\(\)/g)).toHaveLength(1);
    for (const f of ['StoryRecorder.tsx', 'StoryDialog.tsx', 'StoryTapView.tsx', 'StoryBar.tsx', 'StoryEntry.tsx', 'story.logic.ts']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/localStorage|sessionStorage|indexedDB|XMLHttpRequest|navigator\.sendBeacon|api\.upload|\bfetch\(/);
    }
    expect(rec).toContain('saveRecording(editor, wav, name)');
  });
  it('a recording is saved only through the import queue: one importFiles call with a File named by date and time only', () => {
    const calls: File[][] = [];
    const f = saveRecording({ importFiles: (fs_) => { calls.push(fs_); } }, new Blob([new Uint8Array(44)], { type: 'audio/wav' }), 'קריינות 2026-11-25 14.32.wav');
    expect(calls).toHaveLength(1); expect(calls[0]![0]).toBe(f);
    expect(f.name).toBe('קריינות 2026-11-25 14.32.wav'); expect(f.type).toBe('audio/wav');
    expect(recordingName(new Date(2026, 10, 25, 14, 32), 'he')).toBe('קריינות 2026-11-25 14.32.wav');
    expect(recordingName(new Date(2026, 0, 5, 9, 7), 'en')).toBe('Narration 2026-01-05 09.07.wav');
  });
  it('the saved job is the first one of that name that was not there before; ready gives the asset', () => {
    const job = (o: Partial<ImportJobView>) => ({ jobId: 'j1', name: 'n.wav', state: 'converting', assetId: null, error: null, ...o }) as ImportJobView;
    expect(savedJob([job({ jobId: 'old', state: 'ready', assetId: 'a0' })], 'n.wav', new Set(['old']))).toEqual({ state: 'waiting', assetId: null, message: null });
    expect(savedJob([job({ jobId: 'old', state: 'ready', assetId: 'a0' }), job({ state: 'ready', assetId: 'a1' })], 'n.wav', new Set(['old'])).assetId).toBe('a1');
    expect(savedJob([job({ state: 'failed', error: { code: 'x', message: 'm', retryable: false } as never })], 'n.wav', new Set()).state).toBe('failed');
  });
  it('a quiet or clipped take shows numbers, never "good"', () => {
    const st = (peakDbfs: number | null, clipped: number) => ({ kind: 'stopped' as const, samples: 1, rate: 48000, peakDbfs, clipped, wav: new Blob() });
    expect(takeNotice(st(-50, 0), 'he')).toEqual(['שקט מדי (⁦-50 dBFS⁩)']);
    expect(takeNotice(st(-3, 12), 'en')).toEqual(['Too loud: 12 samples clipped']);
    expect(takeNotice(st(-10, 0), 'en')).toEqual([]);
  });
});

describe('taps', () => {
  it('a tap is the narration\'s source millisecond, from timeline seconds, where the clip lies and its source-in', () => {
    expect(tapMsOf(5.2, 0, 0)).toBe(5200);
    expect(tapMsOf(7.2, 2, 0)).toBe(5200);
    expect(tapMsOf(5.2, 0, 1)).toBe(6200);
    expect(tapMsOf(-1, 0, 0)).toBe(0);
    expect(timelineOfMs(5200, 2, 0)).toBeCloseTo(7.2, 9);
    expect(cutsFromSnapshot([{ down: 9 }, { down: 3.0004 }], 0, 0)).toEqual([3000, 9000]);
    expect(tapsBefore([1000, 5000, 9000], 5000)).toEqual([1000]);
  });
  it('the narration clip is found in the picture being played', () => {
    const d = doc();
    const live = doublePlanner.live(d, { narrationAssetId: 'nar', assetIds: ['i1', 'i2'] }, ctx, [])!;
    const c = narrationClip(live, 'nar')!;
    expect(T.toSeconds(c.start)).toBe(0); expect(T.toSeconds(c.sourceIn)).toBe(0);
    expect(narrationClip(d, 'nar')).toBeNull();
  });
  it('the lane: ticks only inside the narration, positions clamp', () => {
    expect(pauseTicks([0, 4500, 8200, 99000], 24)).toEqual([4500 / 24000, 8200 / 24000]);
    expect(pauseTicks([4500], 0)).toEqual([]);
    expect(laneFraction(30000, 24)).toBe(1); expect(laneFraction(12000, 24)).toBe(0.5);
  });
  it('at most one live plan per animation frame', () => {
    const queue: (() => void)[] = []; let runs = 0;
    const t = frameThrottle(() => { runs++; }, (fn) => queue.push(fn), () => {});
    t.schedule(); t.schedule(); t.schedule();
    expect(queue).toHaveLength(1); queue.shift()!(); expect(runs).toBe(1);
    t.schedule(); expect(queue).toHaveLength(1);
  });
});

describe('the review, planned in the browser from the view\'s context', () => {
  const d = doc();
  const params = { narrationAssetId: 'nar', assetIds: ['i1', 'i2', 'i3', 'i4'] };
  it('chips, cut frames and the picture; held taps carry their Hebrew reason', () => {
    const view = planViewDouble(d, params);
    const r = reviewOf(d, params, view, [3000, 3100, 8000], doublePlanner);
    expect(r.chips.map((c) => c.state)).toEqual(['kept', 'held', 'kept']);
    expect(r.cuts.slice(0, 2)).toEqual([90, 240]);
    expect(r.ghost).not.toBeNull();
    expect(chipLine(r.chips[1]!, 'he')).toBe('הקשה 2, 0:03: לא נשמרה — קרוב מדי למעבר הקודם (בטיחות הבזקים)');
    expect(chipLine(r.chips[0]!, 'en')).toBe('Tap 1, 0:03: kept');
  });
  it('a planner that is not built is said, never replaced by a made-up plan', () => {
    const notBuilt: StoryPlannerPort = { plan: () => { throw new StoryNotBuilt('planStory'); }, live: () => { throw new StoryNotBuilt('x'); } };
    const r = reviewOf(d, params, planViewDouble(d, params), [3000], notBuilt);
    expect(r).toMatchObject({ notBuilt: true, ghost: null, chips: [], cuts: [] });
    expect(isNotBuilt(new StoryNotBuilt('x'))).toBe(true); expect(isNotBuilt(new Error('x'))).toBe(false);
  });
  it('the ghost and the server agree or the bar says so (U14)', () => {
    expect(sameCutFrames([90, 240], [90, 240])).toBe(true); expect(sameCutFrames([90], [91])).toBe(false);
    expect(afterApply([90], { predicted: { cuts: [91] } } as never, 'he')).toEqual({ differs: true, message: 'התוכנית בשרת יצאה שונה — בדקו שוב' });
    expect(afterApply([90], { predicted: { cuts: [90] } } as never, 'en')).toEqual({ differs: false, message: null });
  });
});

describe('failures and the bar', () => {
  it('a stale revision, "not built" and a retap are worded with their next step', () => {
    expect(storyFailure('he', { status: 409, code: 'stale_revision', message: 'x' })).toMatchObject({ stale: true, message: 'הפרויקט השתנה — בדקו שוב' });
    expect(storyFailure('he', { status: 501, code: 'story_not_built', message: 'x' }).message).toBe('יצירת סיפור עדיין לא נבנתה בגרסה הזו');
    expect(storyFailure('en', { status: 409, code: 'story_retap_not_built', message: 'x' }, (k) => `T:${k}`).message).toBe('T:error.code.story_retap_not_built');
    expect(storyFailure('en', { status: 409, code: 'story_blocked', message: 'the narration was deleted by hand' }).message).toBe('the narration was deleted by hand');
    expect(storyFailure('he', new Error('boom')).message).toBe('boom');
  });
  it('a rebuild offers changed options only: other music, none, the other own-sound; never other taps', () => {
    const p = { narrationAssetId: 'nar', assetIds: ['i1'], musicAssetId: 'mus', ownSound: 'under' as const };
    const o = rebuildOptions(doc(), p, 'he');
    expect(o.map((x) => x.id)).toEqual(['music-none', 'music-alac', 'own-sound']);
    expect(o.find((x) => x.id === 'own-sound')!.change).toEqual({ ownSound: 'mute' });
    for (const x of o) expect(Object.keys(x.change)).not.toContain('cutsMs');
    expect(rebuildOptions(doc(), { ...p, musicAssetId: null }, 'en').map((x) => x.id)).toEqual(['music-mus', 'music-alac', 'own-sound']);
  });
});
