/**
 * The tempo head's facts follow a derived copy by the same lineage as the beat markers (core beatsFor): a time-preserving copy of
 * measured music has its tempo and is not offered for measuring; a reversed (untimed) copy has no beats and is offered.
 * The derived assets are hand-built fixtures standing in for provider results (labelled: no provider ran).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, timelineMarkers, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { assetHasBeats, timelineTempo } from './pulse.logic.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pl${n++}_`, actor: 'test', allowInternal });
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const music = { kind: 'audio' as const, name: 'song.wav', contentHash: hash('1'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test' } };
const derived = (src: string, extra: Record<string, unknown>) => ({
  origin: 'derived' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test',
  derived: { jobId: 'job_fixture', capabilityId: 'local.audio.voice-clean', capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, logicDigest: hash('a'), ...extra },
});

function setup() {
  let r = tx(createProject({ id: 'prj_pl', name: 'PL' }), [{ op: 'import_asset', args: { asset: music } }], true);
  const song = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [
    { op: 'import_asset', args: { asset: { ...music, name: 'clean.wav', contentHash: hash('2'), duration: T.rt(19, 1), provenance: derived(song, { sourceRangeStart: T.rt(1, 2), audio: 'processed' }) } } },
    { op: 'import_asset', args: { asset: { ...music, name: 'backwards.wav', contentHash: hash('3'), provenance: derived(song, {}) } } },
    { op: 'attach_analysis', args: { assetId: song, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: Array.from({ length: 30 }, (_, i) => T.rt(1 + i, 2)), bpm: 120, confidence: 0.9 } },
  ], true);
  return { doc: r.doc, song, clean: r.results[0]!.output!.assetId as string, backwards: r.results[1]!.output!.assetId as string };
}
const place = (doc: ProjectDocument, assetId: string) => tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(300) } }]).doc;

describe('the timeline tempo head and a derived copy of measured music', () => {
  it('a time-preserving copy: music with the measured tempo, beat markers on the timeline, nothing offered for measuring', () => {
    const s = setup();
    const d = place(s.doc, s.clean);
    expect(assetHasBeats(d, s.clean)).toBe(true);
    expect(timelineTempo(d)).toEqual({ bpm: 120, analysable: null });
    expect(timelineMarkers(d).beats.length).toBeGreaterThan(10);
    expect(timelineTempo(place(s.doc, s.song))).toEqual({ bpm: 120, analysable: null });
  });
  it('a reversed (untimed) copy: no tempo, no beat markers, and it is what "analyse the beat" would measure', () => {
    const s = setup();
    const d = place(s.doc, s.backwards);
    expect(assetHasBeats(d, s.backwards)).toBe(false);
    expect(timelineTempo(d)).toEqual({ bpm: null, analysable: s.backwards });
    expect(timelineMarkers(d).beats).toEqual([]);
  });
});
