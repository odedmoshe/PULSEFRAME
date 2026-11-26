/**
 * «קליפ מקוד» core contract (wave 8 motioncode; madeContract.ts): the record parses and is optional (a project without a made clip is
 * unchanged), validate's made_provenance rows, whole frames for a length, the render size, the library table (licences read at the
 * source or marked not read), WebGL as a capability whose determinism difference is a warning. Todos: what W2 builds (madeCheck.ts,
 * the op body) — named after the plan's checks as corrected by the verifier.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { AssetSchema, createProject, MADE_JOB_FAILURES, MADE_LIBRARIES, MADE_LIMITS, MADE_WARNINGS, madeFramesFor, madeSizeFor, MadeRecordSchema, MadeRenderRequestSchema, validateProject, type ProjectDocument } from './index.ts';

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
  it('libraries: GSAP and three.js pinned exactly with the licence read at the source; a row not read is a todo and names why', () => {
    for (const l of MADE_LIBRARIES) {
      expect(l.version).toMatch(/^\d+\.\d+\.\d+$/);
      if (l.licenceRead === null) expect(l.note).toMatch(/TODO W1/);
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
  it.todo('W2 madeCheck (verify C4): problems only for size, NUL, not UTF-8; every other hit a warning with its offset, case-sensitive identifiers at word boundaries ("update", "evaluate", "allocation", "//comment" give none); SVG namespace strings pass; SMIL named');
  it.todo('W2 madeFieldsCheck: colour #rrggbb, numbers parse within min/max, text within maxLength, unknown keys named');
  it.todo('W2 apply_made_clip: dedup by hash; place adds one top track and one clip (exact start, duration); replace keeps clip ids, places, lengths and effects in every sequence; tooShort names the clip; placeAndReplace; one undo');
});
