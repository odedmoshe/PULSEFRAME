/**
 * Lead wiring of the shorts track (ADR-0018) on the server: every route reaches a non-main sequence only through the output
 * projection (export.ts outputDoc = core projectOutput), so the export plan, stills, preflight, captions and the batch
 * see the short alone at its own frame (ADR-0005). The short is written into the document by hand, as W1's add_sequence will
 * leave it (the sequence operations are W1's). The shorts routes' bodies are W2's and are not exercised here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, summarize, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { Exporter, outputDoc, usesGpuEffects } from './export.ts';
import { preflight } from './preflight.ts';
import { exportCaptions, startExportBatch } from './http.ts';
import { ApiError, Store } from './store.ts';
import type { Governance, Principal } from './governance.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `sw${seed++}_`, actor: 'user:local', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'talk.mp4', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(240, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 7200 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };

/** Main edit 1920×1080 with 300 frames of video and a title; a 720×1280 short of 90 frames with a title near the bottom and a caption track. */
function project() {
  let r = tx(createProject({ id: 'prj_sw', name: 'SW', width: 1920, height: 1080, frameRate: R }), [{ op: 'import_asset', args: { asset: video } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(300), withLinkedAudio: false } }, { op: 'add_text', args: { text: 'ראשי', start: f(0), duration: f(60) } }]);
  const doc = structuredClone(r.doc);
  const main = doc.sequences[doc.mainSequenceId]!;
  const clip = structuredClone(main.tracks.find((t) => t.kind === 'video')!.clips[0]!) as MediaClip;
  const title = structuredClone(main.tracks.find((t) => t.kind === 'text')!.clips[0]!);
  doc.sequences.seq_short = {
    id: 'seq_short', name: 'Short 1',
    format: { width: 720, height: 1280, fit: 'cover', profileId: 'vertical-9x16', safeArea: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.12 }, loudness: null },
    tracks: [
      { id: 'trk_sv', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, clips: [{ ...clip, id: 'clp_sv', duration: f(90) }] },
      { id: 'trk_st', kind: 'text', name: 'T1', locked: false, muted: false, hidden: false, clips: [{ ...title, id: 'clp_st', duration: f(60), transform: { ...title.transform, y: 0.45 } }] },
    ],
  };
  return tx(doc, [{ op: 'add_caption_track', args: { sequenceId: 'seq_short', mode: 'manual' } }]).doc;
}

let dir: string, store: Store, exporter: Exporter;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-shorts-')); store = new Store(dir); exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist')); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const fails = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ApiError) return { status: e.status, code: e.code, message: e.message }; throw e; } throw new Error('not refused'); };

describe('the export plan renders a short alone, at its own frame', () => {
  it('sequenceId: 720×1280, the short\'s own duration; the main edit without it is unchanged', () => {
    const doc = project();
    const short = exporter.plan(doc, 1, { sequenceId: 'seq_short' });
    // this test store holds no media bytes and no web build: only those environment blockers, the same as the main edit's
    const ENV = ['missing_media', 'renderer_unavailable'];
    expect(short.blockers.map((b) => b.code).filter((c) => !ENV.includes(c))).toEqual([]);
    expect(short.manifest.output).toMatchObject({ width: 720, height: 1280, frames: 90 });
    expect(short.manifest.options.sequenceId).toBe('seq_short');
    const main = exporter.plan(doc, 1, {});
    expect(main.blockers.map((b) => b.code)).toEqual(short.blockers.map((b) => b.code));
    expect(main.manifest.output).toMatchObject({ width: 1920, height: 1080, frames: 300 });
    expect('sequenceId' in main.manifest.options).toBe(false); // no default: options of older jobs stay as they were
  });
  it('an unknown sequence or one named like an Object.prototype member is 404 not_found', () => {
    const doc = project();
    for (const sequenceId of ['seq_none', 'constructor', '__proto__']) expect(fails(() => exporter.plan(doc, 1, { sequenceId }))).toMatchObject({ status: 404, code: 'not_found' });
    expect(fails(() => outputDoc(doc, { variantId: 'hasOwnProperty' }))).toMatchObject({ status: 404, code: 'not_found' });
  });
  it('a linked format over a short warns that it replaces the short\'s frame', () => {
    const doc = tx(project(), [{ op: 'add_variant', args: { profileId: 'square-1x1' } }]).doc;
    const variantId = Object.keys(doc.variants)[0]!;
    const p = exporter.plan(doc, 1, { sequenceId: 'seq_short', variantId });
    expect(p.manifest.output).toMatchObject({ width: 1080, height: 1080, frames: 90 });
    expect(p.warnings.map((w) => w.code)).toContain('variant_over_sequence_format');
    expect(exporter.plan(doc, 1, { variantId }).warnings.map((w) => w.code)).not.toContain('variant_over_sequence_format');
  });
  it('the projection keeps only the target sequence, so another sequence\'s GPU effect does not ask for a GPU', () => {
    const doc = project();
    doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.clips[0]!.effects = [{ id: 'fx_1', type: 'color.lut', enabled: true, params: {} }]; // a GPU effect (core GPU_EFFECT_IDS)
    expect(usesGpuEffects(outputDoc(doc, {}))).toBe(true);
    expect(usesGpuEffects(outputDoc(doc, { sequenceId: 'seq_short' }))).toBe(false);
    expect(usesGpuEffects(doc)).toBe(true); // the whole document would have asked for one
  });
});

describe('preflight of a short', () => {
  it('reads the short\'s own safe area; its fixes edit the short (a title transform, its caption track by sequenceId)', () => {
    const doc = project();
    const r = preflight(exporter, doc, 1, { sequenceId: 'seq_short' });
    expect(r.sequenceId).toBe('seq_short');
    expect(r.output).toMatchObject({ width: 720, height: 1280, frames: 90, safeArea: { bottom: 0.2 } });
    const title = r.issues.find((i) => i.code === 'outside_safe_area');
    expect(title?.fix?.ops).toEqual([{ op: 'set_clip_transform', args: { clipId: 'clp_st', transform: expect.objectContaining({ y: expect.any(Number) }) } }]);
    const captions = r.issues.find((i) => i.code === 'captions_outside_safe_area');
    expect(captions?.fix?.ops[0]).toMatchObject({ op: 'set_caption_style', args: { sequenceId: 'seq_short', style: { marginFrac: 0.22 } } });
    // the fixes are real operations on the stored document
    const fixed = tx(doc, [...title!.fix!.ops, ...captions!.fix!.ops]);
    const again = preflight(exporter, fixed.doc, 2, { sequenceId: 'seq_short' });
    expect(again.issues.filter((i) => i.code === 'outside_safe_area' || i.code === 'captions_outside_safe_area')).toEqual([]);
    // the main edit has no safe area of its own: no such issue there
    expect(preflight(exporter, doc, 1, {}).issues.some((i) => i.code === 'outside_safe_area')).toBe(false);
  });
  it('a blurred backdrop copy is not reported as upscaled; the same picture without the blur is', () => {
    const doc = project();
    const clip = doc.sequences.seq_short!.tracks[0]!.clips[0]! as MediaClip;
    clip.transform = { ...clip.transform, scale: 1.6 };
    expect(preflight(exporter, doc, 1, { sequenceId: 'seq_short' }).issues.some((i) => i.code === 'upscaled' && i.ids.includes('clp_sv'))).toBe(true);
    clip.effects = [{ id: 'fx_b', type: 'blur.gaussian', enabled: true, params: { radius: 0.035 } }];
    expect(preflight(exporter, doc, 1, { sequenceId: 'seq_short' }).issues.some((i) => i.code === 'upscaled' && i.ids.includes('clp_sv'))).toBe(false);
  });
});

describe('captions, summary and batch', () => {
  it('captions of a short come from the short\'s caption track; the main edit has none', () => {
    const doc = tx(project(), [{ op: 'add_cue', args: { sequenceId: 'seq_short', text: 'שלום', start: f(0), duration: f(30) } }]).doc;
    const out = exportCaptions(doc, undefined, 'srt', undefined, 'seq_short');
    expect(out.cues).toBe(1);
    expect(out.text).toContain('שלום');
    expect(fails(() => exportCaptions(doc, undefined, 'srt'))).toMatchObject({ status: 404 });
  });
  it('the summary lists every sequence, the main edit first', () => {
    const s = summarize(project());
    expect(s.sequences.map((q) => [q.id, q.main, q.frames])).toEqual([['seq_main', true, 300], ['seq_short', false, 90]]);
  });
  it('a batch is all or nothing: an unknown sequence among the items starts no job', () => {
    const p = store.createProject({ name: 'batch' });
    const doc = { ...project(), id: p.doc.id };
    store.db.prepare('UPDATE projects SET doc = ? WHERE id = ?').run(JSON.stringify(doc), p.doc.id);
    const pr: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
    const gov = { assertMayAct: () => undefined, takeExportQuota: () => undefined } as unknown as Governance;
    expect(fails(() => startExportBatch(store, gov, exporter, pr, p.doc.id, { items: [{ sequenceId: 'seq_none' }, { sequenceId: 'seq_short' }] }))).toMatchObject({ status: 404, code: 'not_found' });
    expect(fails(() => startExportBatch(store, gov, exporter, pr, p.doc.id, { items: [{ sequenceId: 'seq_short' }], variantIds: ['var_x'] }))).toMatchObject({ status: 400 });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND type = 'export'").get(p.doc.id)).toEqual({ n: 0 });
  });
});
