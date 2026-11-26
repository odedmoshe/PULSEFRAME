import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, clipEnd, createProject, findClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { activeTab, cutBefore, firstTab, framesToNearestBeat, keyframeSummary, matchingPreset, objectActions, objectKind, trackRole, pagesFor, pinnedTab, rollCutOps, shortTimecode, tabsFor } from './inspector.model.ts';
import { ratioLabel } from './FormatPrism.tsx';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const fi = (t: T.RationalTime) => T.frameIndexAt(t, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `i${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = (name: string, hash: string) => ({
  kind: 'video' as const, name, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1),
  video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, provenance,
});
const music = { kind: 'audio' as const, name: 'music.mp3', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'mp3', mimeType: 'audio/mpeg', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 2, codec: 'mp3' }, provenance };

/** Two picture clips that touch at frame 120 (each with a second of spare footage on both sides), a title and a music clip. */
function project() {
  let r = tx(createProject({ id: 'prj_i', name: 'I', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset: video('a.mp4', 'a') } }, { op: 'import_asset', args: { asset: video('b.mp4', 'b') } }, { op: 'import_asset', args: { asset: music } }], true);
  const [a, b, m] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: a, start: f(0), sourceIn: f(30), duration: f(120) } },
    { op: 'add_clip', args: { assetId: b, start: f(120), sourceIn: f(45), duration: f(90) } },
    { op: 'add_clip', args: { assetId: m, start: f(0), duration: f(210) } },
    { op: 'add_text', args: { text: 'כותרת', start: f(10), duration: f(60) } },
  ]);
  const ids = r.results.map((x) => x.output!.clipId as string);
  return { doc: r.doc, first: ids[0]!, second: ids[1]!, song: ids[2]!, title: ids[3]! };
}

describe('what the inspector shows for a selection', () => {
  const p = project();
  it('names the kind of object', () => {
    expect(objectKind(p.doc, [], null)).toBe('none');
    expect(objectKind(p.doc, [p.first], null)).toBe('video');
    expect(objectKind(p.doc, [p.title], null)).toBe('text');
    expect(objectKind(p.doc, [p.song], null)).toBe('sound');
    expect(objectKind(p.doc, [p.first, p.second], null)).toBe('multi');
    expect(objectKind(null, [p.first], null)).toBe('none');
    expect(objectKind(p.doc, ['clp_gone'], null)).toBe('none');
  });
  it('a cut is the object only on the clip that starts at one', () => {
    expect(objectKind(p.doc, [p.second], p.second)).toBe('cut');
    expect(objectKind(p.doc, [p.first], p.first)).toBe('video'); // nothing ends where the first clip starts
    expect(objectKind(p.doc, [p.second], p.first)).toBe('video'); // another clip's cut
  });
  it('gives a video clip its eight tabs (Beat after Speed: the moment is usually in the picture), basic first, and every kind at least one', () => {
    expect(tabsFor('video')).toEqual(['basic', 'motion', 'speed', 'beat', 'colour', 'effects', 'mask', 'audio']);
    expect(tabsFor('text')[0]).toBe('text');
    expect(tabsFor('cut')).toEqual(['cut', 'transition']);
    expect(tabsFor('sound')).toEqual(['audio', 'soundfx', 'speed', 'beat']);
    for (const k of ['none', 'multi', 'video', 'image', 'text', 'caption', 'sound', 'adjustment', 'cut'] as const) expect(firstTab(k)).toBe(tabsFor(k)[0]);
  });
  it('opens the first tab unless the person chose one the object has; Look opens colour, Motion opens motion', () => {
    expect(activeTab('video', null, 'pro')).toBe('basic');
    expect(activeTab('video', 'speed', 'pro')).toBe('speed');
    expect(activeTab('text', 'speed', 'pro')).toBe('text'); // a title has no speed tab
    expect(activeTab('video', null, 'color')).toBe('colour');
    expect(activeTab('video', 'effects', 'color')).toBe('effects'); // the mode opens a tab, it does not lock it
    expect(activeTab('text', null, 'motion')).toBe('place');
    expect(pinnedTab('color', 'sound')).toBeNull();
  });
});

describe('the panels a mode offers', () => {
  const custom = ['clip', 'sound'] as const;
  it('Edit, Look and Motion show the selection; Sound adds the mixer first; Deliver has no object panel', () => {
    expect(pagesFor('pro', { custom, waiting: 0, flat: false })).toEqual(['clip']);
    expect(pagesFor('color', { custom, waiting: 0, flat: false })).toEqual(['clip']);
    expect(pagesFor('sound', { custom, waiting: 0, flat: false })).toEqual(['sound', 'clip']);
    expect(pagesFor('captions', { custom, waiting: 0, flat: false })).toEqual(['captions', 'speech', 'clip']);
    expect(pagesFor('deliver', { custom, waiting: 0, flat: false })).toEqual(['deliver', 'review', 'recipes']);
    expect(pagesFor('custom', { custom, waiting: 0, flat: false })).toEqual(['clip', 'sound']);
  });
  it('offers review wherever something waits for the owner, once', () => {
    expect(pagesFor('pro', { custom, waiting: 2, flat: false })).toEqual(['clip', 'review']);
    expect(pagesFor('deliver', { custom, waiting: 2, flat: false })).toEqual(['deliver', 'review', 'recipes']);
  });
  it('all tools on one screen offers every panel', () => {
    expect(pagesFor('pro', { custom, waiting: 0, flat: true })).toHaveLength(8);
  });
});

describe('the cut at the start of a clip', () => {
  const p = project();
  it('finds the clip that ends where this one starts, the cut frame and both handles', () => {
    const cut = cutBefore(p.doc, p.second)!;
    expect(cut.prev.id).toBe(p.first);
    expect(cut.frame).toBe(120);
    expect(cut.handleAfter).toBe(300 - 30 - 120); // source left after the first clip's end
    expect(cut.handleBefore).toBe(45); // source before the second clip's start
    expect(cutBefore(p.doc, p.first)).toBeNull();
    expect(cutBefore(p.doc, p.song)).toBeNull();
    expect(cutBefore(p.doc, p.title)).toBeNull();
  });
  it('after a held frame (a freeze) the spare source after it is unlimited (null), as for a still (wave 8, core spareAfter)', () => {
    const r = tx(p.doc, [{ op: 'add_clip', args: { assetId: (findClip(p.doc, p.first)!.clip as { assetId: string }).assetId, start: f(210), sourceIn: f(299), duration: f(30), freeze: true } }, { op: 'add_clip', args: { assetId: (findClip(p.doc, p.second)!.clip as { assetId: string }).assetId, start: f(240), sourceIn: f(0), duration: f(30), withLinkedAudio: false } }]);
    const cut = cutBefore(r.doc, r.results[1]!.output!.clipId as string)!;
    expect(cut.prev.id).toBe(r.results[0]!.output!.clipId);
    expect(cut.handleAfter).toBeNull();
    expect(cut.handleBefore).toBe(0);
  });
  it('rolls the cut with two trims, the side that gives frames up first, and the core accepts both directions', () => {
    const cut = cutBefore(p.doc, p.second)!;
    const later = rollCutOps(p.doc, cut, 3)!;
    expect(later.map((o) => (o.args as { clipId: string }).clipId)).toEqual([p.second, p.first]);
    const earlier = rollCutOps(p.doc, cut, -3)!;
    expect(earlier.map((o) => (o.args as { clipId: string }).clipId)).toEqual([p.first, p.second]);
    for (const [ops, at] of [[later, 123], [earlier, 117]] as const) {
      const d = tx(p.doc, ops as OpCall[]).doc;
      expect(fi(clipEnd(findClip(d, p.first)!.clip))).toBe(at);
      expect(fi(findClip(d, p.second)!.clip.start)).toBe(at);
      expect(fi(clipEnd(findClip(d, p.second)!.clip))).toBe(210); // the total length is unchanged
    }
  });
  it('refuses a roll that would make a clip vanish, and a roll of nothing', () => {
    const cut = cutBefore(p.doc, p.second)!;
    expect(rollCutOps(p.doc, cut, 0)).toBeNull();
    expect(rollCutOps(p.doc, cut, 90)).toBeNull(); // the second clip is 90 frames long
    expect(rollCutOps(p.doc, cut, -120)).toBeNull();
  });
  it('measures the way to the nearest beat in frames, signed', () => {
    expect(framesToNearestBeat(120, [], 30)).toBeNull();
    expect(framesToNearestBeat(120, [3.5, 4, 4.5], 30)).toBe(0);
    expect(framesToNearestBeat(118, [3.5, 4, 4.5], 30)).toBe(2);
    expect(framesToNearestBeat(125, [3.5, 4, 4.5], 30)).toBe(-5);
  });
});

describe('small formats', () => {
  it('writes a frame as minutes, seconds and frames', () => {
    expect(shortTimecode(0, 30)).toBe('0:00.00');
    expect(shortTimecode(240, 30)).toBe('0:08.00');
    expect(shortTimecode(1837, 30)).toBe('1:01.07');
  });
  it('counts keyframes over the animated properties', () => {
    const p = project();
    const d = tx(p.doc, [{ op: 'set_keyframe', args: { clipId: p.first, property: 'scale', time: f(0), value: 1 } }, { op: 'set_keyframe', args: { clipId: p.first, property: 'scale', time: f(30), value: 1.2 } }, { op: 'set_keyframe', args: { clipId: p.first, property: 'x', time: f(0), value: 0 } }]).doc;
    expect(keyframeSummary(findClip(d, p.first)!.clip)).toEqual({ count: 3, props: expect.arrayContaining(['scale', 'x']) });
    expect(keyframeSummary(findClip(p.doc, p.second)!.clip).count).toBe(0);
  });
  it('names a frame shape in the smallest whole numbers', () => {
    expect(ratioLabel(1920, 1080)).toBe('16:9');
    expect(ratioLabel(1080, 1920)).toBe('9:16');
    expect(ratioLabel(1080, 1080)).toBe('1:1');
    expect(ratioLabel(1080, 1350)).toBe('4:5');
    expect(ratioLabel(1998, 1080)).toBe('1.85:1');
  });
});

describe('objectActions: what the ⋯ menu and the footer may do to what the panel names', () => {
  it('a cut offers no clip action: the selection under it is the clip after the cut, which the panel does not name', () => {
    expect(objectActions('cut')).toEqual([]);
  });
  it('the project offers none; a multi-selection duplicates and deletes; a clip also splits', () => {
    expect(objectActions('none')).toEqual([]);
    expect(objectActions('multi')).toEqual(['duplicate', 'delete']);
    for (const k of ['video', 'image', 'text', 'caption', 'sound', 'adjustment'] as const) expect(objectActions(k)).toEqual(['duplicate', 'split', 'delete']);
  });
});

describe('trackRole: what a mixer strip says its track carries', () => {
  // `assets` is empty: trackRole follows a file's lineage (core lineage.ts), and a file that is not in the library is its own root
  const doc = { assets: {}, analyses: { music: { beats: { bpm: 120 } } }, transcripts: { talk: { segments: [] } } } as unknown as ProjectDocument;
  const m = (assetId: string, linkGroupId?: string) => ({ type: 'media', assetId, ...(linkGroupId ? { linkGroupId } : {}) }) as unknown as Parameters<typeof trackRole>[1]['clips'][number];
  it('music when its sound was analysed for beats, speech when it has a transcript, the video sound when every clip is linked', () => {
    expect(trackRole(doc, { clips: [m('other'), m('music')] })).toBe('music');
    expect(trackRole(doc, { clips: [m('talk')] })).toBe('speech');
    expect(trackRole(doc, { clips: [m('v1', 'g1'), m('v2', 'g2')] })).toBe('linked');
  });
  it('nothing is claimed for an empty track or plain files (the strip shows the first file)', () => {
    expect(trackRole(doc, { clips: [] })).toBeNull();
    expect(trackRole(doc, { clips: [m('fx1'), m('v1', 'g1')] })).toBeNull();
  });
});

describe('matchingPreset: which ready text style a title wears', () => {
  const P = [
    { id: 'white', style: { fontFamily: 'Heebo', fontWeight: 700, color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0 } },
    { id: 'outline', style: { fontFamily: 'Heebo', fontWeight: 700, color: '#FFFFFF', background: null, stroke: '#000000', strokeFrac: 0.08 } },
  ];
  it('finds the style whose font, colour, box and outline the title has, in any letter case', () => {
    expect(matchingPreset({ fontFamily: 'Heebo', fontWeight: 700, color: '#ffffff', stroke: '#000000', strokeFrac: 0.08, background: null }, P)?.id).toBe('outline');
    expect(matchingPreset({ fontFamily: 'Heebo', fontWeight: 700, color: '#FFFFFF' }, P)?.id).toBe('white');
  });
  it('a title changed by hand wears none', () => {
    expect(matchingPreset({ fontFamily: 'Rubik', fontWeight: 700, color: '#FFFFFF' }, P)).toBeNull();
  });
});
