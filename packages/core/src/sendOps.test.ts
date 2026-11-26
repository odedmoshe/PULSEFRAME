/**
 * Track send (wave 7): the two lead-built ops and the loudness plan. set_master_limiter (on, off, range, exact undo, plans of other
 * documents unchanged) and match_clip_loudness (plan per clip, peak and range limits, refusals, one undo for every clip).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, diffEntities, findClip, matchCeiling, medianLufs, OpError, planMatchGain, restoreEntities, SEND_REFUSALS, type MediaClip, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `so${n++}_`, actor: 'test', allowInternal });
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const voice = { kind: 'audio' as const, name: 'voice.wav', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov };

function project() {
  let r = tx(createProject({ id: 'prj_so', name: 'so' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: voice } }], true);
  const [vid, vox] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(120) } },
    { op: 'add_clip', args: { assetId: vox, start: f(0), duration: f(180) } },
    { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } },
  ]);
  const o = r.results.map((x) => x.output!);
  return { doc: r.doc, picture: o[0]!.clipId as string, sound: o[0]!.audioClipId as string, voice: o[1]!.clipId as string, title: o[2]!.clipId as string };
}
const gainOf = (d: ProjectDocument, id: string) => (findClip(d, id)!.clip as MediaClip).gain;
function undone(before: ProjectDocument, after: ProjectDocument): ProjectDocument {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return back;
}

describe('set_master_limiter', () => {
  it('sets and removes settings.limiter; one undo restores the document', () => {
    const p = project();
    const on = tx(p.doc, [{ op: 'set_master_limiter', args: { ceiling: -1 } }]);
    expect(on.doc.settings.limiter).toEqual({ ceiling: -1 });
    expect(on.summary).toBe('Master limiter -1 dB');
    expect(undone(p.doc, on.doc)).toEqual(p.doc);
    const off = tx(on.doc, [{ op: 'set_master_limiter', args: { ceiling: null } }]);
    expect('limiter' in off.doc.settings).toBe(false);
    expect(off.summary).toBe('Master limiter off');
  });
  it('refuses a ceiling outside −9…0 with invalid_args', () => {
    for (const c of [-9.5, 0.5]) expect(refusal(() => tx(project().doc, [{ op: 'set_master_limiter', args: { ceiling: c } }])).code).toBe('invalid_args');
  });
});

describe('match_clip_loudness', () => {
  it('raises and lowers clips to the target in one transaction; one undo restores every gain', () => {
    const p = project();
    const r = tx(p.doc, [{ op: 'match_clip_loudness', args: { target: -18, clips: [{ clipId: p.sound, measuredLufs: -24, peakDbfs: -12, gain: 1 }, { clipId: p.voice, measuredLufs: -12, peakDbfs: -2, gain: 1 }] } }]);
    expect(gainOf(r.doc, p.sound)).toBeCloseTo(10 ** (6 / 20), 4);
    expect(gainOf(r.doc, p.voice)).toBeCloseTo(10 ** (-6 / 20), 4);
    const out = r.results[0]!.output as { clips: { limitedBy: unknown }[]; ceilingDb: number; headroomDb: number };
    expect(out.clips.map((c) => c.limitedBy)).toEqual([null, null]);
    expect([out.ceilingDb, out.headroomDb]).toEqual([0, 0]);
    expect(undone(p.doc, r.doc)).toEqual(p.doc);
  });
  it('stops at the peak ceiling (limitedBy peak); with a master limiter it may use 6 dB more', () => {
    const p = project();
    const args = { target: -10, clips: [{ clipId: p.voice, measuredLufs: -30, peakDbfs: -8, gain: 1 }] };
    const plain = tx(p.doc, [{ op: 'match_clip_loudness', args }]);
    expect(gainOf(plain.doc, p.voice)).toBeCloseTo(10 ** (8 / 20), 4);
    expect((plain.results[0]!.output as { clips: { limitedBy: unknown }[] }).clips[0]!.limitedBy).toBe('peak');
    const lim = tx(tx(p.doc, [{ op: 'set_master_limiter', args: { ceiling: -1 } }]).doc, [{ op: 'match_clip_loudness', args }]);
    expect(gainOf(lim.doc, p.voice)).toBeCloseTo(10 ** (13 / 20), 4); // −1 + 6 − (−8)
  });
  it('caps at the gain range (limitedBy range)', () => {
    const r = planMatchGain({ clipId: 'c', measuredLufs: -60, peakDbfs: -60, gain: 2 }, -10, { ceilingDb: 0, headroomDb: 0 });
    expect(r).toMatchObject({ to: 8, limitedBy: 'range' });
  });
  it('refuses a repeated clip, a clip without sound and a stale measurement, each with its hint', () => {
    const p = project();
    const dup = refusal(() => tx(p.doc, [{ op: 'match_clip_loudness', args: { target: -18, clips: [{ clipId: p.voice, measuredLufs: -20, peakDbfs: -6, gain: 1 }, { clipId: p.voice, measuredLufs: -20, peakDbfs: -6, gain: 1 }] } }]));
    expect([dup.code, dup.hint]).toEqual([SEND_REFUSALS.duplicate.code, SEND_REFUSALS.duplicate.hint]);
    for (const id of [p.picture, p.title]) {
      const e = refusal(() => tx(p.doc, [{ op: 'match_clip_loudness', args: { target: -18, clips: [{ clipId: id, measuredLufs: -20, peakDbfs: -6, gain: 1 }] } }]));
      expect([e.code, e.hint]).toEqual(['incompatible', SEND_REFUSALS.notSound.hint]);
    }
    const changed = tx(p.doc, [{ op: 'set_clip_gain', args: { clipId: p.voice, gain: 0.5 } }]).doc;
    const stale = refusal(() => tx(changed, [{ op: 'match_clip_loudness', args: { target: -18, clips: [{ clipId: p.voice, measuredLufs: -20, peakDbfs: -6, gain: 1 }] } }]));
    expect([stale.code, stale.details.reason, stale.hint]).toEqual(['incompatible', 'stale_measurement', SEND_REFUSALS.stale.hint]);
    expect(refusal(() => tx(p.doc, [{ op: 'match_clip_loudness', args: { target: -18, clips: [{ clipId: 'clp_none', measuredLufs: -20, peakDbfs: -6, gain: 1 }] } }])).code).toBe('not_found');
  });
});

describe('loudness plan helpers', () => {
  it('median of the selection; null for none', () => {
    expect(medianLufs([])).toBeNull();
    expect(medianLufs([-20, -14, -30])).toBe(-20);
    expect(medianLufs([-20, -14, -30, -16])).toBe(-18);
  });
  it('the ceiling: limiter, else the loudness true peak, else 0; headroom only with a limiter', () => {
    const p = project();
    expect(matchCeiling(p.doc)).toEqual({ ceilingDb: 0, headroomDb: 0 });
    const lt = tx(p.doc, [{ op: 'set_loudness_target', args: { target: -16, truePeak: -2 } }]).doc;
    expect(matchCeiling(lt)).toEqual({ ceilingDb: -2, headroomDb: 0 });
    expect(matchCeiling(tx(lt, [{ op: 'set_master_limiter', args: { ceiling: -1.5 } }]).doc)).toEqual({ ceilingDb: -1.5, headroomDb: 6 });
  });
});

// The size-fit plan and the export checks of builder B are tested in sizeFit.test.ts and exportChecks.test.ts.
