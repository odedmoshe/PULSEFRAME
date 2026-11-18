/**
 * The editor's active sequence (ADR-0018, W3): the projection state, the injection of the active sequence into operation calls
 * (derived from the registered schemas), the guards of the project-level writers, and the add-format guard. The store is
 * driven without a browser: a stub for localStorage and for fetch (the project route), nothing else.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, listOps, getOp, projectSequence, SequenceFormatSchema, validateProject, type MediaClip, type OpCall, type ProjectDocument, type Sequence, type SequenceFormat } from '@pulseframe/core';
import { addVariantGuard, declaresSequenceId, frameOps, injectSequenceId, isShortActive, loudnessOps } from './shorts.view.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'talk.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(240, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 7200 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance };
const FORMAT: SequenceFormat = { width: 720, height: 1280, fit: 'cover', profileId: 'vertical-9x16', safeArea: null, loudness: { target: -14, truePeak: -1 } };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `as${n++}_`, actor: 'test', allowInternal });

/** A main edit and, written by hand, a short with its own frame (what add_sequence leaves). */
function withShort(): ProjectDocument {
  let r = tx(createProject({ id: 'prj_as', name: 'AS', width: 1920, height: 1080, frameRate: R }), [{ op: 'import_asset', args: { asset: video } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(300) } }]);
  const doc = structuredClone(r.doc);
  const clip = structuredClone(doc.sequences[doc.mainSequenceId]!.tracks[0]!.clips[0]!) as MediaClip;
  const short: Sequence = { id: 'seq_short', name: 'Short 1', format: FORMAT, tracks: [{ id: 'trk_sv', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, clips: [{ ...clip, id: 'clp_short', start: f(0), duration: f(90), linkGroupId: null }] }] };
  doc.sequences.seq_short = short;
  return doc;
}

describe('injection of the active sequence into an operation call', () => {
  const doc = withShort();
  it('every registered op whose args declare sequenceId gets the active id; an explicit id is kept', () => {
    const declared = listOps().filter((o) => declaresSequenceId(o.name));
    expect(declared.length).toBeGreaterThan(10);
    for (const def of declared) {
      expect(injectSequenceId({ op: def.name, args: {} }, 'seq_short', doc.mainSequenceId).args, def.name).toEqual({ sequenceId: 'seq_short' });
      expect(injectSequenceId({ op: def.name, args: { sequenceId: 'seq_other', x: 1 } }, 'seq_short', doc.mainSequenceId).args, def.name).toEqual({ sequenceId: 'seq_other', x: 1 });
    }
  });
  it('an op without sequenceId in its schema is left alone, and nothing is injected while the main sequence is active', () => {
    const undeclared = listOps().filter((o) => !declaresSequenceId(o.name));
    expect(undeclared.length).toBeGreaterThan(10);
    for (const def of undeclared) { const call = { op: def.name, args: { a: 1 } }; expect(injectSequenceId(call, 'seq_short', doc.mainSequenceId)).toBe(call); }
    const call = { op: 'add_track', args: { kind: 'video' } };
    expect(injectSequenceId(call, doc.mainSequenceId, doc.mainSequenceId)).toBe(call);
    expect(getOp('add_track')).toBeDefined();
  });
  it('a track added while the short is active lands in the short and leaves the main sequence as it was', () => {
    const call = injectSequenceId({ op: 'add_track', args: { kind: 'text' } }, 'seq_short', doc.mainSequenceId);
    const r = tx(doc, [call]);
    expect(r.doc.sequences.seq_short!.tracks).toHaveLength(2);
    expect(r.doc.sequences[doc.mainSequenceId]).toEqual(doc.sequences[doc.mainSequenceId]);
  });
});

describe('the projection the editor works on', () => {
  const raw = withShort();
  it('state.doc is the same object for a single-sequence project', () => {
    const single = createProject({ id: 'prj_single', name: 'S' });
    expect(projectSequence(single, single.mainSequenceId)).toBe(single);
  });
  it('with a short active, the document is the short made main, at the short format', () => {
    const p = projectSequence(raw, 'seq_short');
    expect(p.mainSequenceId).toBe('seq_short');
    expect(Object.keys(p.sequences)).toEqual(['seq_short']);
    expect(p.settings.width).toBe(FORMAT.width);
    expect(p.settings.height).toBe(FORMAT.height);
    expect(validateProject(p)).toEqual([]);
  });
});

describe('the Editor store', () => {
  let Editor: typeof import('./store.ts').Editor;
  const store = new Map<string, string>();
  beforeAll(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    ({ Editor } = await import('./store.ts'));
  });
  const serve = (doc: ProjectDocument, revision = 1) => {
    (globalThis as { fetch?: unknown }).fetch = async () => new Response(JSON.stringify({ project: doc, revision }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  it('state.doc === rawDoc for a single-sequence project, and the active sequence is the main one', async () => {
    const single = createProject({ id: 'prj_single', name: 'S' });
    serve(single);
    const e = new Editor();
    await e.load(single.id);
    expect(e.getState().doc).toBe(e.getState().rawDoc);
    expect(e.getState().activeSequenceId).toBe(single.mainSequenceId);
  });
  it('a short active: state.doc.mainSequenceId is the short and its size is the short format; viewDoc follows', async () => {
    const raw = withShort();
    serve(raw);
    const e = new Editor();
    await e.load(raw.id);
    e.setActiveSequence('seq_short');
    const s = e.getState();
    expect(s.rawDoc).toEqual(raw);
    expect(s.doc!.mainSequenceId).toBe('seq_short');
    expect(s.doc!.settings.width).toBe(FORMAT.width);
    expect(s.doc!.settings.height).toBe(FORMAT.height);
    expect(e.viewDoc).toBe(s.doc);
  });
  it('the active sequence resets to the main one after its sequence is removed', async () => {
    const raw = withShort();
    serve(raw);
    const e = new Editor();
    await e.load(raw.id);
    e.setActiveSequence('seq_short');
    const gone = structuredClone(raw);
    delete gone.sequences.seq_short;
    serve(gone, 2);
    await e.load(raw.id);
    expect(e.getState().activeSequenceId).toBe(raw.mainSequenceId);
    expect(e.getState().doc).toBe(e.getState().rawDoc);
  });
  it('startExport sends the active short as sequenceId; the main edit sends none; an explicit id is kept', async () => {
    const raw = withShort();
    const bodies: unknown[] = [];
    (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/exports')) { bodies.push(init?.body ? JSON.parse(init.body) : null); return new Response(JSON.stringify({ jobId: 'job_1' }), { status: 200, headers: { 'content-type': 'application/json' } }); }
      return new Response(JSON.stringify({ project: raw, revision: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const e = new Editor();
    await e.load(raw.id);
    await e.startExport({});
    e.setActiveSequence('seq_short');
    await e.startExport({});
    await e.startExport({ format: 'mp4' });
    await e.startExport({ sequenceId: 'seq_other' });
    expect(bodies[0]).toBeNull();
    expect(bodies[1]).toEqual({ sequenceId: 'seq_short' });
    expect(bodies[2]).toEqual({ format: 'mp4', sequenceId: 'seq_short' });
    expect(bodies[3]).toEqual({ sequenceId: 'seq_other' });
  });
});

describe('guards of the project-level writers while a short is active', () => {
  const raw = withShort();
  it('the master-format apply commits update_sequence for the short, never set_project_format', () => {
    const ops = frameOps(raw, 'seq_short', { width: 540, height: 960, fit: 'contain' });
    expect(ops.map((o) => o.op)).toEqual(['update_sequence']);
    const args = ops[0]!.args as { sequenceId: string; format: SequenceFormat };
    expect(args.sequenceId).toBe('seq_short');
    expect(args.format).toMatchObject({ width: 540, height: 960, fit: 'contain', profileId: 'vertical-9x16' });
    expect(SequenceFormatSchema.safeParse(args.format).success).toBe(true);
    expect(frameOps(raw, raw.mainSequenceId, { width: 1280 }).map((o) => o.op)).toEqual(['set_project_format']);
  });
  it('the loudness control commits update_sequence format.loudness, never set_loudness_target', () => {
    expect(loudnessOps(raw, 'seq_short', -16).map((o) => o.op)).toEqual(['update_sequence']);
    expect((loudnessOps(raw, 'seq_short', -16)[0]!.args as { format: SequenceFormat }).format.loudness).toEqual({ target: -16, truePeak: -1 });
    expect((loudnessOps(raw, 'seq_short', null)[0]!.args as { format: SequenceFormat }).format.loudness).toBeNull();
    expect(loudnessOps(raw, raw.mainSequenceId, -14)).toEqual([{ op: 'set_loudness_target', args: { target: -14 } }]);
  });
  it('add_variant is disabled with its reason while a short is active, enabled on the main edit', () => {
    expect(isShortActive(raw, 'seq_short')).toBe(true);
    expect(addVariantGuard(raw, 'seq_short', 'he')).toEqual({ disabled: true, reason: 'פורמטים מקושרים חלים על כל הפרויקט' });
    expect(addVariantGuard(raw, 'seq_short', 'en').reason).toBe('Linked formats apply to the whole project');
    expect(addVariantGuard(raw, raw.mainSequenceId, 'he')).toEqual({ disabled: false, reason: null });
  });
});
