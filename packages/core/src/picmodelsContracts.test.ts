/**
 * The picmodels + eyes contract (wave 8 pre-pass): the registry equals the library manifest, the setup filter keeps the yunet row from
 * every credential but the owner's own session, and the eyes wire is STRICT — an extra key anywhere (a box, a score, a landmark, a
 * count) fails, more than eight faces cannot be sent, too_many carries no point.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EYES, EyesAnswerSchema, EyesProposeBodySchema, EyesWorkerLineSchema, notBuiltPictureModelStatus, PICTURE_MAP_KINDS, PICTURE_MODELS, PICTURE_MODEL_IDS,
  PictureModelSchema, pictureModelsFor, PictureModelStatusSchema, AgentPictureModelStatusSchema, PICMODELS_REFUSALS, PICMODELS_BUILT,
} from './index.ts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/library/manifests/models-01.json'), 'utf8')) as { sources: { id: string; licence: { spdx: string; url: string }; creditInExport: boolean; items: { id: string; kind: string; bytes: number; sha256: string; dest: string }[] }[] };
const p = { u: 0.4, v: 0.5 }, q = { u: 0.6, v: 0.5 };

describe('picture models registry', () => {
  it('every row parses, the ids are the declared ones, and only the yunet row is eyes', () => {
    expect(PICTURE_MODELS.map((m) => m.id)).toEqual([...PICTURE_MODEL_IDS]);
    for (const m of PICTURE_MODELS) expect(PictureModelSchema.safeParse(m).success, m.id).toBe(true);
    expect(PICTURE_MODELS.filter((m) => m.output === 'eyes').map((m) => m.id)).toEqual(['yunet']);
    expect(PICMODELS_BUILT).toBe(false);
    // depth and matte are not built in this wave (decisions); nothing may flip them before the laptop wave
    for (const m of PICTURE_MODELS.filter((x) => x.output !== 'eyes')) expect(m.built, m.id).toBe(false);
  });
  it('every pin equals its ledger item in models-01.json (item, file name, bytes, sha256), and the licence and duties agree', () => {
    for (const m of PICTURE_MODELS) {
      const src = manifest.sources.find((s) => s.id === m.source);
      expect(src, m.id).toBeTruthy();
      expect(src!.licence.spdx).toBe(m.licence.spdx);
      expect(src!.licence.url).toBe(m.licence.url);
      expect(src!.creditInExport).toBe(false);
      for (const pin of m.pins) {
        const item = src!.items.find((i) => i.id === pin.item);
        expect(item, pin.item).toBeTruthy();
        expect([item!.kind, item!.bytes, item!.sha256, path.posix.basename(item!.dest)]).toEqual(['file', pin.bytes, pin.sha256, pin.name]);
      }
      if (m.duties.keepLicenceItem) expect(src!.items.some((i) => i.id === m.duties.keepLicenceItem)).toBe(true);
    }
  });
});

describe('GET /picture-models filter', () => {
  const rows = PICTURE_MODELS.map(notBuiltPictureModelStatus);
  it('the not-built rows parse and are honest', () => {
    for (const r of rows) { expect(PictureModelStatusSchema.parse(r).code).toBe('not_built'); expect(r.detail).not.toMatch(/[\\/]/); }
  });
  it('the owner gets every row; anyone else gets five keys per row and never the yunet row', () => {
    expect(pictureModelsFor(true, rows).map((r) => r.id)).toEqual([...PICTURE_MODEL_IDS]);
    const agent = pictureModelsFor(false, rows);
    expect(agent.map((r) => r.id)).not.toContain('yunet');
    expect(agent.length).toBe(PICTURE_MODEL_IDS.length - 1);
    for (const r of agent) { expect(Object.keys(r).sort()).toEqual(['code', 'device', 'id', 'missingBytes', 'output']); expect(AgentPictureModelStatusSchema.safeParse(r).success).toBe(true); }
    expect(AgentPictureModelStatusSchema.safeParse({ ...agent[0], detail: 'x' }).success).toBe(false);
  });
});

describe('eyes wire (strict)', () => {
  it('the request is an asset id and a frame or null, nothing else', () => {
    expect(EyesProposeBodySchema.safeParse({ assetId: 'a1', frame: null }).success).toBe(true);
    expect(EyesProposeBodySchema.safeParse({ assetId: 'a1', frame: 12 }).success).toBe(true);
    expect(EyesProposeBodySchema.safeParse({ assetId: 'a1', frame: -1 }).success).toBe(false);
    expect(EyesProposeBodySchema.safeParse({ assetId: 'a1' }).success).toBe(false);
    expect(EyesProposeBodySchema.safeParse({ assetId: 'a1', frame: null, pixels: 'x' }).success).toBe(false);
  });
  it('an answer is faces of exactly two shown points; an extra key at any level fails', () => {
    const ok = { outcome: 'faces', faces: [{ eyes: [p, q] }], method: 'TEST' };
    expect(EyesAnswerSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, score: 0.99 },
      { ...ok, count: 1 },
      { ...ok, faces: [{ eyes: [p, q], box: [0, 0, 1, 1] }] },
      { ...ok, faces: [{ eyes: [p, q], score: 0.9 }] },
      { ...ok, faces: [{ eyes: [p, q], landmarks: [p] }] },
      { ...ok, faces: [{ eyes: [p, q, p] }] },
      { ...ok, faces: [{ eyes: [p] }] },
      { ...ok, faces: [{ eyes: [{ ...p, score: 1 }, q] }] },
      { ...ok, faces: [{ eyes: [{ u: 1.2, v: 0.5 }, q] }] },
      { ...ok, faces: [{ eyes: [{ u: Number.NaN, v: 0.5 }, q] }] },
      { ...ok, faces: [] },
      { ...ok, faces: Array.from({ length: EYES.maxFaces + 1 }, () => ({ eyes: [p, q] })) },
      { outcome: 'too_many', faces: [{ eyes: [p, q] }], method: 'TEST' },
      { outcome: 'none', faces: [{ eyes: [p, q] }], method: 'TEST' },
      { outcome: 'faces', faces: [{ eyes: [p, q] }] },
    ]) expect(EyesAnswerSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(EyesAnswerSchema.safeParse({ outcome: 'too_many', faces: [], method: 'TEST' }).success).toBe(true);
    expect(EyesAnswerSchema.safeParse({ outcome: 'none', faces: [], method: 'TEST' }).success).toBe(true);
    expect(EyesAnswerSchema.safeParse({ outcome: 'faces', faces: Array.from({ length: EYES.maxFaces }, () => ({ eyes: [p, q] })), method: 'TEST' }).success).toBe(true);
  });
  it('the worker line: two pixel points per face; tooMany has no point; a box, score or landmark fails', () => {
    expect(EyesWorkerLineSchema.safeParse({ id: 1, event: 'result', faces: [[[10, 20], [30, 20]]] }).success).toBe(true);
    expect(EyesWorkerLineSchema.safeParse({ id: 1, event: 'result', faces: [] }).success).toBe(true);
    expect(EyesWorkerLineSchema.safeParse({ id: 1, event: 'result', tooMany: true }).success).toBe(true);
    expect(EyesWorkerLineSchema.safeParse({ id: 1, event: 'error', code: 'engine_failed' }).success).toBe(true);
    for (const bad of [
      { id: 1, event: 'result', faces: [[[10, 20], [30, 20]]], scores: [0.9] },
      { id: 1, event: 'result', faces: [[[10, 20], [30, 20], [20, 30]]] },
      { id: 1, event: 'result', faces: [[[10, 20, 0.9], [30, 20]]] },
      { id: 1, event: 'result', faces: [[[10, 20], [30, Number.NaN]]] },
      { id: 1, event: 'result', faces: Array.from({ length: EYES.maxFaces + 1 }, () => [[1, 2], [3, 4]]) },
      { id: 1, event: 'result', tooMany: true, faces: [[[10, 20], [30, 20]]] },
      { id: 1, event: 'result', tooMany: true, count: 12 },
      { id: 1, event: 'result', faces: [[[10, 20], [30, 20]]], boxes: [[0, 0, 5, 5]] },
      { id: 1, event: 'error', code: 'engine_failed', message: 'Traceback …' },
      { event: 'result', faces: [] },
    ]) expect(EyesWorkerLineSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it('every refusal has a status, a code and a hint, and none takes a coordinate', () => {
    for (const [k, x] of Object.entries(PICMODELS_REFUSALS)) {
      expect(x.status, k).toBeGreaterThanOrEqual(400);
      expect(x.hint, k).toMatch(/\w/);
      expect((x.message as (...a: string[]) => string)('model_missing'), k).not.toMatch(/\d\.\d/);
    }
    expect(PICMODELS_REFUSALS.ownerOnly.status).toBe(403);
    expect(PICMODELS_REFUSALS.notBuilt.status).toBe(501);
  });
  it('the map contract is types and constants only (nothing to run)', () => {
    expect([...PICTURE_MAP_KINDS]).toEqual(['depth', 'matte']);
  });
});
