/**
 * wave 8 qc (B1), verifier C10: flash_clip must stay silent on what the generators make. Every template of the catalogue (the six
 * built-ins and the pack templates) is planned and applied through apply_template, at three frame rates, and documentChecks lists
 * no flash_clip on the result. (perform takes, family-film slots, growing-up holds and the beat montage keep a picture at least
 * flashGapFrames by their own contracts and tests — performFlash.ts, familyFilmContract.ts, growingContract.ts — and are not
 * re-run here.)
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, documentChecks, TEMPLATES, type Asset, type ProjectDocument, type TemplatePlan } from './index.ts';
import { planTemplate } from './templatePlan.ts';
import { useApplyTemplateDoubleIfStub } from './templatePlan.testDouble.ts';

useApplyTemplateDoubleIfStub(); // labelled test double only while apply_template is still the contracts stub (templatePlan.test.ts does the same)

type Rate = { num: number; den: number };
const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00.000Z', importedBy: 'test' };
let n = 1;
const video = (id: string, rate: Rate): Asset => ({ id, kind: 'video', name: `${id}.mp4`, contentHash: hash(n++), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.fromSeconds(120), video: { width: 540, height: 960, frameRate: rate, codec: 'h264', rotation: 0, frameCount: null }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
const image = (id: string): Asset => ({ id, kind: 'image', name: `${id}.png`, contentHash: hash(n++), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 1080, height: 1080, codec: 'png', hasAlpha: false }, provenance: prov });
const origin = { method: 'test grid', params: {}, createdAt: '2026-11-26T00:00:00.000Z', createdBy: 'test', edited: false };
function project(rate: Rate, wide: boolean): ProjectDocument {
  const doc = createProject({ id: 'prj_qct', name: 't', width: wide ? 960 : 540, height: wide ? 540 : 960, frameRate: rate });
  for (const id of ['vid_a', 'vid_b', 'vid_c', 'vid_d']) doc.assets[id] = video(id, rate);
  doc.assets.img_a = image('img_a'); doc.assets.img_b = image('img_b');
  doc.assets.mus = { id: 'mus', kind: 'audio', name: 'mus.wav', contentHash: hash(n++), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.fromSeconds(600), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
  const beats = Array.from({ length: 200 }, (_, i) => T.rt(400 + i * 500, 1000));
  doc.analyses.mus = { assetId: 'mus', beats: { origin, bpm: 120, confidence: 0.9, beats, downbeats: beats.filter((_, i) => i % 4 === 0), meter: 4 } };
  return doc;
}
const madeAssets = (plan: TemplatePlan) => plan.assetsNeeded.map((x, i) => ({ key: x.key, asset: x.kind === 'sfx'
  ? { kind: 'audio' as const, name: `${x.id}.wav`, contentHash: hash(900_000 + i), byteSize: 10, container: 'wav', mimeType: 'audio/wav', duration: T.rt(3, 10), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { ...prov, origin: 'generated' as const } }
  : { kind: 'image' as const, name: `${x.id}.png`, contentHash: hash(800_000 + i), byteSize: 10, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 1024, height: 1024, codec: 'png', hasAlpha: true }, provenance: { ...prov, origin: 'generated' as const } } }));

describe('flash_clip on generated edits (C10)', () => {
  for (const rate of [{ num: 24, den: 1 }, { num: 30, den: 1 }, { num: 60, den: 1 }]) it(`${rate.num} fps: no template of the catalogue gives a flash_clip`, () => {
    let applied = 0;
    for (const def of TEMPLATES) {
      const doc = project(rate, def.designedFor === 'wide');
      const plan = planTemplate(doc, def, { media: ['vid_a', 'img_a', 'vid_b', 'vid_c', 'img_b', 'vid_d'], musicAssetId: def.music.need === 'none' ? null : 'mus', lang: 'he' });
      const r = applyTransaction(doc, [{ op: 'apply_template', args: { templateId: plan.templateId, templateVersion: plan.version, params: plan.params, steps: plan.steps, assets: madeAssets(plan), ops: plan.ops, slots: plan.slots } }], { idSeed: 'qct', actor: 'test', allowInternal: true });
      const flashes = documentChecks(r.doc).issues.filter((i) => i.code === 'flash_clip');
      expect(flashes.map((i) => ({ ids: i.ids, measured: i.measured })), def.id).toEqual([]);
      applied++;
    }
    expect(applied).toBe(TEMPLATES.length);
  });
});
