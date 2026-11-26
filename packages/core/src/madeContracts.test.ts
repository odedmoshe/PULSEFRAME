/**
 * «קליפ מקוד» core contract (wave 8 motioncode; madeContract.ts): the record parses and is optional (a project without a made clip is
 * unchanged), validate's made_provenance rows, whole frames for a length, the render size, the library table (licences read at the
 * source or marked not read), WebGL as a capability whose determinism difference is a warning. Todos: what W2 builds (madeCheck.ts,
 * the op body) — now real tests (W2).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, AssetSchema, checkMadePage, createProject, creativeProjection, diffEntities, MADE_JOB_FAILURES, MADE_LIBRARIES, MADE_LIMITS, MADE_WARNINGS, madeFramesFor, madeSizeFor, madeFieldsCheck, MadeRecordSchema, MadeRenderRequestSchema, restoreEntities, validateProject, type MadeField, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const record = (frames = 60, alpha = true) => ({ v: 1, pageSha256: `sha256:${'c'.repeat(64)}`, pageBytes: 900, templateId: 'rising-title', templateVersion: 1, fields: [{ key: 'title', kind: 'text', label: { he: 'כותרת', en: 'Title' }, default: 'שלום' }], values: { title: 'טיול לגליל 2026' }, frames, width: 640, height: 360, browser: '153.0', sandbox: 'chromium-dropped-uid', checks: { determinism: { frames: [0, 30, 59] }, flash: { black: { general: 0, red: 0 }, white: { general: 0, red: 0 } }, alpha } });
const madeAsset = (frames: number, rec = record(), extra: Record<string, unknown> = {}) => ({ id: 'ast_m', kind: 'video', name: 'title.webm', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'webm', mimeType: 'video/webm', duration: T.frameTime(frames, R),
  video: { width: 640, height: 360, frameRate: R, codec: 'vp9', rotation: 0, frameCount: frames, hasAlpha: true }, provenance: { origin: 'generated', importedAt: '2026-11-26T00:00:00Z', importedBy: 'agent:x', made: rec }, ...extra });
const withAsset = (a: unknown): ProjectDocument => { const d = createProject({ id: 'p', name: 'p', frameRate: R }); (d.assets as Record<string, unknown>).ast_m = a; return d; };

describe('made contract', () => {
  it('a made record parses on a video asset; validate accepts a matching one and names each mismatch', () => {
    expect(() => MadeRecordSchema.parse(record())).not.toThrow();
    expect(() => AssetSchema.parse(madeAsset(60))).not.toThrow();
    expect(validateProject(withAsset(madeAsset(60))).filter((i) => i.code === 'made_provenance')).toEqual([]);
    const bad = validateProject(withAsset(madeAsset(61, record(60, false), { provenance: { origin: 'upload', importedAt: 'x', importedBy: 'x', made: { ...record(60, false), values: { nope: 'x' } } } }))).filter((i) => i.code === 'made_provenance');
    expect(bad.map((i) => i.message)).toEqual([
      'asset ast_m: only a generated video records the page that made it', 'asset ast_m: the made record says 60 frames, the file has 61',
      'asset ast_m: the made record and the file disagree about transparency', 'asset ast_m: the value nope names no field of the page',
    ]);
  });
  it('whole frames for a length (at least 1, at most maxFrames) and a render size with the long side at most 1920, even', () => {
    expect(madeFramesFor(4, R)).toBe(120);
    expect(madeFramesFor(1, { num: 30000, den: 1001 })).toBe(30);
    expect(madeFramesFor(0.001, R)).toBe(1);
    expect(madeFramesFor(20, { num: 120, den: 1 })).toBe(MADE_LIMITS.maxFrames);
    expect(madeSizeFor(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(madeSizeFor(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(madeSizeFor(641, 361)).toEqual({ width: 642, height: 362 });
  });
  it('libraries: GSAP and three.js pinned exactly with the licence read at the source; a row not read is never installed and names the lead\'s decision (integration decision 7: HyperFrames is out)', () => {
    for (const l of MADE_LIBRARIES) {
      expect(l.version).toMatch(/^\d+\.\d+\.\d+$/);
      if (l.licenceRead === null) { expect(l.installed).toBe(false); expect(l.files).toEqual([]); expect(l.note).toMatch(/^OUT of made clips \(lead, integration decision \d/); }
    }
    expect(MADE_LIBRARIES.find((l) => l.name === 'three')).toMatchObject({ version: '0.187.0', licence: expect.stringContaining('MIT') });
    expect(MADE_LIBRARIES.find((l) => l.name === 'gsap')).toMatchObject({ version: '3.15.1' });
  });
  it('WebGL is a capability of the page; a difference between two passes of a WebGL page is a warning, never a failure', () => {
    expect(MadeRenderRequestSchema.safeParse({ page: '<canvas></canvas>', seconds: 2, name: 'x', capabilities: { webgl: true, libraries: ['three@0.187.0'] } }).success).toBe(true);
    expect(MADE_WARNINGS.webglDiffers.message(12, 30)).toContain('12 pixels');
    expect(Object.keys(MADE_JOB_FAILURES)).not.toContain('webglDiffers');
    expect(Object.keys(MADE_JOB_FAILURES)).not.toContain('flash');
  });
  it('madeCheck (verify C4): problems only for size, NUL, not UTF-8; every other hit a warning with its offset; "update", "evaluate", "allocation", "//comment" give none; SVG namespace strings pass; SMIL named', () => {
    const quiet = '<svg xmlns="http://www.w3.org/2000/svg"></svg><script>// a //comment\nfunction update(){ evaluate(allocation); validate(); }</script>';
    expect(checkMadePage(quiet)).toEqual({ problems: [], warnings: [] });
    const loud = '<svg><animate attributeName="x"/></svg><script>fetch(Date.now())</script>';
    expect(checkMadePage(loud)).toEqual({ problems: [], warnings: [{ what: 'SMIL <animate>', at: 5 }, { what: 'fetch', at: loud.indexOf('fetch') }, { what: 'Date', at: loud.indexOf('Date') }] });
    expect(checkMadePage('a\u0000').problems).toEqual([{ what: 'nul', at: 1 }]);
    expect(checkMadePage('x'.repeat(MADE_LIMITS.pageBytes + 1)).problems).toEqual([{ what: 'too_large', at: MADE_LIMITS.pageBytes }]);
    expect(checkMadePage('\uFFFD').problems).toEqual([{ what: 'not_utf8', at: 0 }]);
  });
  it('madeFieldsCheck: colour #rrggbb, numbers parse within min/max, text within maxLength, unknown keys named', () => {
    const fields = record().fields.concat([{ key: 'c', kind: 'colour', label: { he: 'צבע', en: 'Colour' }, default: '#000000' }, { key: 'n', kind: 'number', label: { he: 'מספר', en: 'Number' }, default: '1', min: 1, max: 3 } as never]) as MadeField[];
    expect(madeFieldsCheck(fields, { title: 'טיול לגליל 2026', c: '#12ab34', n: '2' })).toEqual([]);
    expect(madeFieldsCheck(fields, { title: 'x'.repeat(MADE_LIMITS.valueChars + 1), c: '#12ab3', n: '4', other: '' })).toEqual([{ key: 'title', why: 'length' }, { key: 'c', why: 'colour' }, { key: 'n', why: 'range' }, { key: 'other', why: 'unknown' }]);
  });
  it('apply_made_clip: dedup by hash; place adds one top track and one clip (exact start, duration); replace keeps clip ids, places, lengths; tooShort names the clip; placeAndReplace; one undo', () => {
    const d0 = createProject({ id: 'p', name: 'p', frameRate: R });
    const { id: _id, ...asset } = madeAsset(60);
    const tx = (d: ProjectDocument, args: Record<string, unknown>, seed: string) => applyTransaction(d, [{ op: 'apply_made_clip', args }], { idSeed: seed, actor: 'agent:a', allowInternal: true });
    const placed = tx(d0, { asset, place: { start: T.frameTime(30, R) } }, 'a_');
    const o = placed.results[0]!.output as Record<string, string>;
    const clip = placed.doc.sequences[placed.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips)[0]!;
    expect(clip.id).toBe(o.clipId);
    expect(T.eq(clip.start, T.frameTime(30, R)) && T.eq(clip.duration, T.frameTime(60, R))).toBe(true);
    expect((tx(placed.doc, { asset }, 'b_').results[0]!.output as Record<string, unknown>).deduplicated).toBe(true);
    const next = { ...asset, contentHash: `sha256:${'d'.repeat(64)}` };
    const rep = tx(placed.doc, { asset: next, replaceAssetId: o.assetId }, 'c_');
    const after = rep.doc.sequences[rep.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips)[0]!;
    expect({ id: after.id, start: after.start, duration: after.duration }).toEqual({ id: clip.id, start: clip.start, duration: clip.duration });
    const back = structuredClone(rep.doc);
    restoreEntities(back, diffEntities(placed.doc, rep.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(placed.doc));
    const short = { ...madeAsset(30), contentHash: `sha256:${'e'.repeat(64)}` } as Record<string, unknown>;
    delete short.id;
    (short.provenance as { made: unknown }).made = record(30);
    expect(() => tx(placed.doc, { asset: short, replaceAssetId: o.assetId }, 'd_')).toThrow(`the new file is shorter than clip ${clip.id} that uses the old one (it needs 60 frames)`);
    expect(() => tx(d0, { asset, place: { start: T.ZERO }, replaceAssetId: 'ast_x' }, 'e_')).toThrow('place or replace, not both');
  });
});
