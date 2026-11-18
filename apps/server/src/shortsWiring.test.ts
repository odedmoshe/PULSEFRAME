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
import { applyTransaction, BROWSER_EXPORT_SIDECAR_REFUSED, createProject, summarize, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { Exporter, outputDoc, usesGpuEffects } from './export.ts';
import { preflight } from './preflight.ts';
import { exportCaptions, startExportBatch } from './http.ts';
import { registerBrowserExportRoutes } from './browser-export.ts';
import { Hono } from 'hono';
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

describe('browser export of a short', () => {
  it('the tab is handed the short alone as its snapshot (it renders the snapshot as it is), at the short\'s frame', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-shorts-bx-'));
    fs.mkdirSync(path.join(d, 'web/assets'), { recursive: true });
    fs.writeFileSync(path.join(d, 'web/assets/heebo-latin-400.woff2'), 'x');
    const st = new Store(path.join(d, 'data'));
    const ex = new Exporter(st, {} as never, () => '', path.join(d, 'web'));
    const p = st.createProject({ name: 'bx' });
    // titles only (no media files needed): the short of project() without its picture, and the main edit's title
    const doc = project();
    for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) if (t.kind === 'video') t.clips = [];
    doc.assets = {};
    st.db.prepare('UPDATE projects SET doc = ? WHERE id = ?').run(JSON.stringify({ ...doc, id: p.doc.id }), p.doc.id);
    const app = new Hono<any>();
    app.onError((e, ctx) => (e instanceof ApiError ? ctx.json(e.toJSON(), e.status as any) : ctx.json({ error: { code: 'internal', message: String(e) } }, 500)));
    app.use('*', async (ctx, next) => { ctx.set('principal', { actor: 'user:a', kind: 'user', scopes: ['observe', 'edit'] } satisfies Principal); await next(); });
    const be = registerBrowserExportRoutes(app, st, ex, { now: () => 1_000_000, sweepIntervalMs: 0 });
    try {
      const r = await app.request(`/api/v1/projects/${p.doc.id}/exports/browser`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'session-short', sequenceId: 'seq_short' }) });
      const body = (await r.json()) as any;
      expect(r.status, JSON.stringify(body).slice(0, 300)).toBe(201);
      expect(Object.keys(body.snapshot.sequences)).toEqual(['seq_short']);
      expect(body.snapshot.mainSequenceId).toBe('seq_short');
      expect(body.snapshot.settings).toMatchObject({ width: 720, height: 1280 });
      expect(body.manifest.output).toMatchObject({ width: 720, height: 1280, frames: 60 });
    } finally {
      be.stop(); st.close(); fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('browser export and captions', () => {
  it('a subtitle file is refused on the browser route (it writes none), with a code and a hint (Hebrew: shorts-wording.test.ts); burned keeps the captions in the picture, none hides them', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-shorts-bxc-'));
    fs.mkdirSync(path.join(d, 'web/assets'), { recursive: true });
    fs.writeFileSync(path.join(d, 'web/assets/heebo-latin-400.woff2'), 'x');
    const st = new Store(path.join(d, 'data'));
    const ex = new Exporter(st, {} as never, () => '', path.join(d, 'web'));
    const p = st.createProject({ name: 'bxc' });
    const doc = project();
    for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) if (t.kind === 'video') t.clips = [];
    doc.assets = {};
    st.db.prepare('UPDATE projects SET doc = ? WHERE id = ?').run(JSON.stringify({ ...doc, id: p.doc.id }), p.doc.id);
    const app = new Hono<any>();
    app.onError((e, ctx) => (e instanceof ApiError ? ctx.json(e.toJSON(), e.status as any) : ctx.json({ error: { code: 'internal', message: String(e) } }, 500)));
    app.use('*', async (ctx, next) => { ctx.set('principal', { actor: 'user:a', kind: 'user', scopes: ['observe', 'edit'] } satisfies Principal); await next(); });
    const be = registerBrowserExportRoutes(app, st, ex, { now: () => 1_000_000, sweepIntervalMs: 0 });
    const start = async (captions: string, n: number) => {
      const r = await app.request(`/api/v1/projects/${p.doc.id}/exports/browser`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: `session-cap-${n}`, sequenceId: 'seq_short', captions }) });
      return { status: r.status, body: (await r.json()) as any };
    };
    const jobs = () => (st.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND type = 'export'").get(p.doc.id) as { n: number }).n;
    const captionHidden = (snapshot: ProjectDocument) => Object.values(snapshot.sequences).flatMap((s) => s.tracks.filter((t) => t.kind === 'caption').map((t) => t.hidden));
    try {
      let n = 0;
      for (const captions of ['sidecar-srt', 'sidecar-vtt']) {
        const r = await start(captions, n++);
        expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(422);
        expect(r.body.error).toMatchObject({ code: 'unsupported_in_browser_export', message: BROWSER_EXPORT_SIDECAR_REFUSED.message, hint: BROWSER_EXPORT_SIDECAR_REFUSED.hint, details: { captions, supported: ['burned', 'none'] } });
      }
      expect(jobs()).toBe(0);
      const burned = await start('burned', n++);
      expect(burned.status, JSON.stringify(burned.body).slice(0, 300)).toBe(201);
      expect(captionHidden(burned.body.snapshot)).toEqual([false]);
      const none = await start('none', n++);
      expect(none.status).toBe(201);
      expect(captionHidden(none.body.snapshot)).toEqual([true]);
    } finally {
      be.stop(); st.close(); fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
