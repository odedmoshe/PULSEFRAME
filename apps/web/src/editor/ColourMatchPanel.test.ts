/**
 * The colour match panel (ColourMatchPanel.tsx, ADR-0014) decides without a browser what it asks the server and what its still tiles
 * show; checked here on a document made by the real operations. The ops it would commit are the server's (match_colour), committed
 * as one transaction: that is checked by the server test and by proof:colourmatch M10.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { GRADE_DEFAULTS } from '@pulseframe/engine';
import { pictureClipIds, requestFor, tileDocs } from './ColourMatchPanel.tsx';
import { COLOUR_MATCH_STRINGS, fill } from './colourMatch.strings.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `cmui${n++}_`, actor: 'test', allowInternal });
const image = (name: string) => ({ kind: 'image' as const, name, contentHash: `sha256:${Buffer.from(name).toString('hex').padEnd(64, '0').slice(0, 64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(10, 1), image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } });
const sound = { kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'6'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
/** Track 1: a (0–30), b (30–60); track 2: c (0–30); a title; a sound clip. */
function project() {
  let r = tx(createProject({ id: 'prj_cm', name: 'CM', frameRate: R }), [{ op: 'import_asset', args: { asset: image('a.png') } }, { op: 'import_asset', args: { asset: image('c.png') } }, { op: 'import_asset', args: { asset: sound } }], true);
  const [ia, ic, is] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: ia, start: f(0), duration: f(30) } }, { op: 'add_clip', args: { assetId: ia, start: f(30), duration: f(30) } }]);
  const [a, b] = r.results.map((x) => x.output!.clipId as string) as [string, string];
  r = tx(r.doc, [{ op: 'add_track', args: { kind: 'video' } }]);
  const t2 = r.results[0]!.output!.trackId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: ic, trackId: t2, start: f(0), duration: f(30) } }, { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } }, { op: 'add_clip', args: { assetId: is, start: f(0), duration: f(60) } }]);
  const [c, title, voice] = r.results.map((x) => x.output!.clipId as string) as [string, string, string];
  return { doc: r.doc, a, b, c, title, voice };
}

describe('colour match panel: what is asked', () => {
  it('picture clips only, by start then track; one track when asked', () => {
    const p = project();
    expect(pictureClipIds(p.doc)).toEqual([p.a, p.c, p.b]);
    expect(pictureClipIds(p.doc, findClip(p.doc, p.a)!.track.id)).toEqual([p.a, p.b]);
  });
  it('match needs a reference that exists; the reference is never its own target', () => {
    const p = project(), base = { scope: 'clip' as const, method: 'match' as const, amount: 1 };
    expect(requestFor(p.doc, p.b, { ...base, referenceId: null })).toEqual({ blocked: 'needReference' });
    expect(requestFor(p.doc, p.b, { ...base, referenceId: 'clp_gone' })).toEqual({ blocked: 'needReference' });
    expect(requestFor(p.doc, p.a, { ...base, referenceId: p.a })).toEqual({ blocked: 'referenceIsTarget' });
    expect(requestFor(p.doc, p.b, { ...base, referenceId: p.a })).toEqual({ request: { method: 'match', referenceClipId: p.a, targetClipIds: [p.b], amount: 1, samples: 3 } });
  });
  it('track scope lists the other picture clips of the track; all scope asks for all', () => {
    const p = project();
    expect(requestFor(p.doc, p.b, { scope: 'track', method: 'match', amount: 1, referenceId: p.a })).toEqual({ request: { method: 'match', referenceClipId: p.a, targetClipIds: [p.b], amount: 1, samples: 3 } });
    expect(requestFor(p.doc, p.c, { scope: 'track', method: 'match', amount: 1, referenceId: p.c })).toEqual({ blocked: 'noTargets' });
    expect(requestFor(p.doc, p.b, { scope: 'all', method: 'match', amount: 0.5, referenceId: p.a })).toEqual({ request: { method: 'match', referenceClipId: p.a, targetClipIds: 'all', amount: 0.5, samples: 3 } });
  });
  it('balance takes no reference, even when one is set; the amount is kept within 0..1 in hundredths', () => {
    const p = project();
    expect(requestFor(p.doc, p.a, { scope: 'clip', method: 'balance', amount: 0.733, referenceId: p.a })).toEqual({ request: { method: 'balance', targetClipIds: [p.a], amount: 0.73, samples: 3 } });
    expect(requestFor(p.doc, p.a, { scope: 'track', method: 'balance', amount: 7, referenceId: null })).toEqual({ request: { method: 'balance', targetClipIds: [p.a, p.b], amount: 1, samples: 3 } });
  });
});

describe('colour match panel: still tiles', () => {
  it('before is the clip alone as it is; after carries the proposed grade through the real op; the reference alone', () => {
    const p = project();
    const doc = tx(p.doc, [{ op: 'apply_look', args: { clipId: p.b, lookId: 'teal-orange' } }, { op: 'set_clip_transform', args: { clipId: p.b, transform: { scale: 0.5 } } }]).doc;
    const params = { ...GRADE_DEFAULTS, exposure: 0.25, temperature: -0.3 };
    const t = tileDocs(doc, { clipId: p.b, params }, p.a);
    const clipsOf = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.filter((x) => x.kind !== 'audio').flatMap((x) => x.clips.map((c) => c.id));
    expect(clipsOf(t.before)).toEqual([p.b]);
    expect(clipsOf(t.after!)).toEqual([p.b]);
    expect(clipsOf(t.reference!)).toEqual([p.a]);
    const grade = (d: ProjectDocument) => (findClip(d, p.b)!.clip as MediaClip).effects!.find((e) => e.type === 'color.grade')!.params;
    expect(grade(t.before)).toMatchObject({ shadows: 0.8, highlights: 0.7 }); // the look it has now
    expect(grade(t.after!)).toEqual(params);
    expect((findClip(t.before, p.b)!.clip as MediaClip).transform.scale).toBe(1); // alone, filling the frame
    expect(t.before.settings.fit).toBe('cover');
    expect(tileDocs(doc, { clipId: p.b, params }, null).reference).toBeNull();
    expect(findClip(doc, p.a)).toBeDefined(); // the document itself is untouched
  });
  it('a clip whose grade is animated still gets an after tile (the keyframes dropped in the scratch copy only)', () => {
    const p = project();
    let doc = tx(p.doc, [{ op: 'apply_look', args: { clipId: p.b, lookId: 'teal-orange' } }]).doc;
    const gid = (findClip(doc, p.b)!.clip as MediaClip).effects![0]!.id;
    doc = tx(doc, [{ op: 'set_effect_keyframe', args: { clipId: p.b, effectId: gid, param: 'exposure', time: f(0), value: 0.5 } }]).doc;
    const t = tileDocs(doc, { clipId: p.b, params: { ...GRADE_DEFAULTS } }, null);
    expect((findClip(t.after!, p.b)!.clip as MediaClip).effects![0]!.keyframes).toBeUndefined();
    expect((findClip(doc, p.b)!.clip as MediaClip).effects![0]!.keyframes?.exposure).toHaveLength(1);
  });
});

describe('colour match strings', () => {
  it('fill replaces the named placeholders and leaves others', () => {
    expect(fill(COLOUR_MATCH_STRINGS.he.applyN, { n: 3 })).toBe('החל על 3 קטעים');
    expect(fill('{a} {b}', { a: 1 })).toBe('1 {b}');
  });
  it('no string promises a perfect match', () => {
    for (const lang of ['he', 'en'] as const) for (const v of Object.values(COLOUR_MATCH_STRINGS[lang])) expect(v).not.toMatch(/perfect|exact match|מושלמ|זהה לחלוטין/i);
  });
});
