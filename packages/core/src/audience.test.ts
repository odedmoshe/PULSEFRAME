/**
 * Unit tests of audience.ts (wave 8 audiences, W1): the size rule, the sound roles of the main sequence, the fast-cut rows of the
 * change list and the arithmetic rules (no Math.pow at run time). The rule facts over a film are in audienceContracts.test.ts (W1
 * block); the properties over random documents in audience.property.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, audienceChanges, audienceTitleSize, createProject, DB_GAIN, pacingReport, projectVariant, soundRoles, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const HASH = (k: number) => `sha256:${k.toString(16).padStart(64, '0')}`;
const PROV = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };

describe('the size rule (C3)', () => {
  it('own sizes are absolute; inherited sizes ×4/3 within the cap in a grandparents version only; never made smaller', () => {
    expect(audienceTitleSize(0.06, undefined, 'grandparents')).toBe((0.06 * 4) / 3);
    expect(audienceTitleSize(0.06, 0.03, 'grandparents')).toBe(0.03);
    expect(audienceTitleSize(0.06, 0.9, 'grandparents')).toBe(0.9);
    expect(audienceTitleSize(0.06, undefined, 'calm')).toBe(0.06);
    expect(audienceTitleSize(0.45, undefined, 'grandparents')).toBe(0.5);
    expect(audienceTitleSize(0.8, undefined, 'grandparents')).toBe(0.8); // above the cap: a rule that makes text larger leaves it
  });
  it('no Math.pow and no ** at run time in audience.ts: levels come from the literal DB_GAIN table', () => {
    const src = readFileSync(new URL('./audience.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/Math\.pow|\*\*/);
    expect(DB_GAIN[-8]).toBe(0.3981071705534972);
  });
});

/** Twelve one-second pictures cut every five frames for the first two seconds: fast cuts there. */
function fastFilm(): ProjectDocument {
  let doc = createProject({ id: 'prj_fast', name: 'F', width: 640, height: 360, frameRate: R });
  doc.assets.ast_v = { id: 'ast_v', kind: 'video', name: 'v.mp4', contentHash: HASH(1), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, provenance: PROV } as never;
  const ops = [];
  let at = 0;
  for (let k = 0; k < 24; k++) { ops.push({ op: 'add_clip', args: { assetId: 'ast_v', start: f(at), duration: f(5), withLinkedAudio: false } }); at += 5; }
  ops.push({ op: 'add_clip', args: { assetId: 'ast_v', start: f(at), duration: f(300), withLinkedAudio: false } });
  doc = applyTransaction(doc, ops, { idSeed: 'fast_', actor: 'test' }).doc;
  doc = applyTransaction(doc, [{ op: 'add_audience_version', args: { profile: 'calm' } }], { idSeed: 'fastv_', actor: 'user:owner' }).doc;
  return doc;
}

describe('the change list', () => {
  it('lists fast cuts from the pacing report as frames on the project rate, and changes no timing', () => {
    const doc = fastFilm();
    const id = Object.keys(doc.variants)[0]!;
    const list = audienceChanges(doc, id, 3);
    const issues = pacingReport(doc, { windowSeconds: 5 }).issues.filter((i) => i.code === 'rapid_cuts');
    expect(issues.length).toBeGreaterThan(0);
    expect(list.fastCuts).toEqual(issues.map((i) => ({ startFrame: T.frameIndexAt(i.start, R), endFrame: T.frameIndexAt(i.end, R), cuts: i.value, limit: i.limit, windowSeconds: 5 })));
    expect(list.fastCuts[0]).toMatchObject({ startFrame: 0, endFrame: 150 });
    expect(list.changes).toEqual([]); // nothing in this film stirs, and the cutting is not changed
    const p = projectVariant(doc, id);
    expect(p.sequences[p.mainSequenceId]!.tracks.map((t) => t.clips.map((c) => [c.start, c.duration]))).toEqual(doc.sequences[doc.mainSequenceId]!.tracks.map((t) => t.clips.map((c) => [c.start, c.duration])));
  });
  it('soundRoles lists every sound track of the main sequence in track order, the owner\'s corrections first', () => {
    const doc = fastFilm();
    const id = Object.keys(doc.variants)[0]!;
    const audio = doc.sequences[doc.mainSequenceId]!.tracks.filter((t) => t.kind === 'audio');
    expect(soundRoles(doc).map((r) => r.trackId)).toEqual(audio.map((t) => t.id));
    expect(soundRoles(doc).every((r) => r.role === 'other' && r.why === 'empty')).toBe(true);
    const a = { ...doc.variants[id]!.audience!, sound: { [audio[0]!.id]: 'music' as const } };
    expect(soundRoles(doc, a)[0]).toEqual({ trackId: audio[0]!.id, role: 'music', why: 'owner' });
    expect(audienceChanges(doc, id, 1).soundRoles).toEqual(soundRoles(doc, doc.variants[id]!.audience));
  });
  it('every row names the sequence it is in; a row of a short has frames on the short\'s own clock (W1 note: nested sequences)', () => {
    let doc = fastFilm();
    const main = doc.mainSequenceId;
    const r = applyTransaction(doc, [{ op: 'add_sequence', args: { name: 'קצר' } }], { idSeed: 'seq_', actor: 'user:owner' });
    const short = r.results[0]!.output!.sequenceId as string;
    doc = applyTransaction(r.doc, [
      { op: 'add_clip', args: { sequenceId: short, assetId: 'ast_v', start: f(40), duration: f(20), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: 'ast_v', start: f(500), duration: f(20), withLinkedAudio: false } },
    ], { idSeed: 'sc_', actor: 'test' }).doc;
    const inShort = doc.sequences[short]!.tracks.flatMap((t) => t.clips)[0]!;
    const inMain = doc.sequences[main]!.tracks.flatMap((t) => t.clips).find((c) => T.eq(c.start, f(500)))!;
    doc = applyTransaction(doc, [{ op: 'add_effect', args: { clipId: inShort.id, type: 'light.strobe' } }, { op: 'add_effect', args: { clipId: inMain.id, type: 'light.strobe' } }], { idSeed: 'fx_', actor: 'test' }).doc;
    const id = Object.keys(doc.variants)[0]!;
    const rows = audienceChanges(doc, id, 9).changes.filter((c) => c.rule === 'effect');
    expect(rows.map((c) => [c.clipId, c.sequenceId, c.startFrame, c.endFrame])).toEqual(expect.arrayContaining([[inShort.id, short, 40, 60], [inMain.id, main, 500, 520]]));
    expect(rows).toHaveLength(2);
  });
});
