/**
 * The core contract of «מה יש בקליפ» (wave 8 understand; understandContract.ts, understandOps.ts): the op attach_footage_notes (lead-built,
 * complete) is one revision with exact generic undo and keeps the other analyses; the pointer is optional (documents without it read
 * unchanged); the notes file, producer, settings and query schemas hold the verifier's limits; the prompt keeps its rules; the
 * functions W1 and W2 own throw UnderstandNotBuilt until built.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, AnalysisSchema, createProject, DEFAULT_UNDERSTAND_SETTINGS, DESCRIBE_SYSTEM, describeUserText, diffEntities, FootageNotesDataSchema, NotesQuerySchema, OpError, producerCanonical,
  restoreEntities, creativeProjection, StartUnderstandBodySchema, UNDERSTAND_BUILT, UNDERSTAND_LIMITS, UnderstandNotBuilt, UnderstandSettingsBodySchema, UnderstandSettingsSchema, understandSpans, validateDescribeReply, validateProject, type ProjectDocument,
} from './index.ts';

const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(25, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 750 }, provenance: { origin: 'upload' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } };
const photo = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'3'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: { origin: 'upload' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } };
let n = 0;
const tx = (doc: ProjectDocument, ops: unknown[], internal = true) => applyTransaction(doc, ops as never, { idSeed: `uc${n++}_`, actor: 'server:understand', allowInternal: internal });
function project() {
  const r = tx(createProject({ id: 'p', name: 'p', frameRate: { num: 30, den: 1 } }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: photo } }]);
  const v = r.results[0]!.output!.assetId as string, ph = r.results[1]!.output!.assetId as string;
  const withScenes = tx(r.doc, [{ op: 'attach_analysis', args: { assetId: v, kind: 'scenes', method: 'm', params: {}, createdAt: 'x', times: [T.frameTime(150, { num: 30, den: 1 }), T.frameTime(270, { num: 30, den: 1 })] } }]).doc;
  return { doc: withScenes, v, ph };
}
const item = (assetId: string, over: Record<string, unknown> = {}) => ({ assetId, producer: '0123456789abcdef', model: 'TEST-DOUBLE-describer/1', data: `sha256:${'c'.repeat(64)}`, spans: 4, described: 3, failed: 1, ...over });
const attach = (doc: ProjectDocument, items: unknown[], internal = true) => tx(doc, [{ op: 'attach_footage_notes', args: { method: 'TEST-DOUBLE-describer test-double, pf-describe/1', createdAt: '2026-11-26T12:00:00Z', items } }], internal);

describe('attach_footage_notes (complete)', () => {
  it('points each asset at its notes in ONE op, keeps the scenes, validates, and undoes exactly through the entity diff', () => {
    const { doc, v, ph } = project();
    const r = attach(doc, [item(v), item(ph, { spans: 1, described: 1, failed: 0 })]);
    expect(r.results[0]!.output).toEqual({ assetIds: [v, ph] });
    expect(r.doc.analyses[v]!.notes).toEqual({ origin: { method: 'TEST-DOUBLE-describer test-double, pf-describe/1', params: { producer: '0123456789abcdef' }, createdAt: '2026-11-26T12:00:00Z', createdBy: 'server:understand', edited: false }, producer: '0123456789abcdef', model: 'TEST-DOUBLE-describer/1', data: `sha256:${'c'.repeat(64)}`, spans: 4, described: 3, failed: 1 });
    expect(r.doc.analyses[v]!.scenes).toEqual(doc.analyses[v]!.scenes);
    expect(validateProject(r.doc)).toEqual([]);
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(doc));
    // a second run replaces the pointer
    expect(attach(r.doc, [item(v, { model: 'other', spans: 2, described: 2, failed: 0 })]).doc.analyses[v]!.notes!.model).toBe('other');
  });
  it('refuses a missing asset, a file with no picture, an asset listed twice, counts that do not add up, a photo with two spans; agents cannot call it', () => {
    const { doc, v, ph } = project();
    const sound = tx(doc, [{ op: 'import_asset', args: { asset: { ...video, kind: 'audio', name: 'a.wav', contentHash: `sha256:${'2'.repeat(64)}`, video: undefined, audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' } } } }]);
    const a = sound.results[0]!.output!.assetId as string;
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as OpError).code; } return 'accepted'; };
    expect(code(() => attach(doc, [item('ast_none')]))).toBe('not_found');
    expect(code(() => attach(sound.doc, [item(a)]))).toBe('incompatible');
    expect(code(() => attach(doc, [item(v), item(v)]))).toBe('invalid_args');
    expect(code(() => attach(doc, [item(v, { failed: 3 })]))).toBe('out_of_bounds');
    expect(code(() => attach(doc, [item(ph, { spans: 2, described: 2, failed: 0 })]))).toBe('out_of_bounds');
    expect(code(() => attach(doc, [item(v)], false))).toBe('forbidden_op');
  });
  it('the pointer is optional: an analysis without it parses unchanged; a stored pointer whose counts do not add up fails validation', () => {
    expect(AnalysisSchema.safeParse({ assetId: 'a' }).success).toBe(true);
    const { doc, v } = project();
    const d = structuredClone(attach(doc, [item(v)]).doc);
    d.analyses[v]!.notes!.failed = 0;
    expect(validateProject(d).map((i) => i.code)).toContain('analysis_notes');
  });
});

describe('schemas and limits (verify C5, C10, C12; decisions 2, 4, 5, 7)', () => {
  it('a span holds 1–4 keys; captions ≤ 200; the density is 10 or 30 (3 s cut); pages of 20, at most 100, 16 KB; replies 800 tokens', () => {
    expect(UNDERSTAND_LIMITS).toMatchObject({ densitySeconds: [10, 30], minSpanSeconds: 2, captionChars: 200, pageSpans: 20, maxPageSpans: 100, pageBytes: 16384, replyMaxTokens: 800, shotsPage: 50, framesPerSpan: { min: 1, max: 4, local: 1, cloud: 3 } });
    const base = { format: 1, contentHash: `sha256:${'a'.repeat(64)}`, producer: { id: '0123456789abcdef', describer: 'openai-chat', providerId: 'llamacpp', model: 'm', modelFile: null, prompt: 'pf-describe/1', longSide: 768, density: 10, framesPerSpan: 1, minSpanSeconds: 2 }, rate: null, frameCount: 1, cuts: `sha256:${'b'.repeat(64)}` };
    const span = { i: 0, shots: [0, 0], start: 0, end: 1, keys: [0], state: 'described', caption: { en: 'x' } };
    expect(FootageNotesDataSchema.safeParse({ ...base, spans: [span] }).success).toBe(true);
    expect(FootageNotesDataSchema.safeParse({ ...base, spans: [{ ...span, keys: [0, 1, 2, 3, 4] }] }).success).toBe(false);
    expect(FootageNotesDataSchema.safeParse({ ...base, spans: [{ ...span, caption: { en: 'x'.repeat(201) } }] }).success).toBe(false);
    expect(FootageNotesDataSchema.safeParse({ ...base, producer: { ...base.producer, temperature: 0 }, spans: [] }).success).toBe(false);
    expect(UnderstandSettingsSchema.parse(DEFAULT_UNDERSTAND_SETTINGS)).toEqual({ version: 1, auto: true, density: 10, describer: null });
    expect(UnderstandSettingsBodySchema.safeParse({ density: 3 }).success).toBe(false);
    expect(UnderstandSettingsBodySchema.safeParse({ describer: { providerId: 'ollama', model: 'm', seeing: true, framesPerSpan: 4 } }).success).toBe(true);
    expect(StartUnderstandBodySchema.safeParse({ density: 10 }).success).toBe(false);
    expect(NotesQuerySchema.parse({ limit: '20', both: 'true', from: '0' })).toEqual({ limit: 20, both: true, from: 0 });
    expect(NotesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
  it('the producer canonical text is sorted JSON of exactly the producer fields (the id is its hash, on the server)', () => {
    const p = { describer: 'openai-chat' as const, providerId: 'llamacpp', model: 'm', modelFile: null, prompt: 'pf-describe/1' as const, longSide: 768, density: 10, framesPerSpan: 1, minSpanSeconds: 2 };
    expect(producerCanonical(p)).toBe('{"density":10,"describer":"openai-chat","framesPerSpan":1,"longSide":768,"minSpanSeconds":2,"model":"m","modelFile":null,"prompt":"pf-describe/1","providerId":"llamacpp"}');
    expect(producerCanonical({ ...p })).toBe(producerCanonical(Object.fromEntries(Object.entries(p).reverse()) as typeof p));
  });
  it('the prompt: only what is visible, one JSON object, on-screen text as written and numbers not turned into years, no identity or age, frames in time order', () => {
    expect(DESCRIBE_SYSTEM).toMatch(/only what is visible/);
    expect(DESCRIBE_SYSTEM).toMatch(/ONE JSON object/);
    expect(DESCRIBE_SYSTEM).toMatch(/do not turn them into dates or years/);
    expect(DESCRIBE_SYSTEM).toMatch(/Do not guess who a person is/);
    expect(describeUserText([{ label: '00:01.0' }, { label: '00:02.0' }, { label: '00:03.0' }])).toContain('Frame 3 of 3: 00:03.0');
  });
  it('until built, the builders\' functions throw UnderstandNotBuilt (never a made-up value)', () => {
    expect(UNDERSTAND_BUILT.op).toBe(true);
    if (!UNDERSTAND_BUILT.core) expect(() => understandSpans([150, 270], 750, { num: 30, den: 1 }, { densitySeconds: 10, minSpanSeconds: 2, framesPerSpan: 1 })).toThrow(UnderstandNotBuilt);
    if (!UNDERSTAND_BUILT.reply) expect(() => validateDescribeReply('{}', 'stop')).toThrow(UnderstandNotBuilt);
  });
  it.todo('W1: understandSpans — the plan\'s U1 numbers, joined short shots (C5), even keys for 3 frames, a photo, the cap with density doubling and truncated; Node and Chromium agree');
  it.todo('W1: cutsDigest stable; notesFor follows time-preserving copies; searchNotes tokens / AND / Hebrew forms / year token on screen (C9) / order; notesPage paging and byte cap (C10); understandStateOf for every state');
  it.todo('W2: validateDescribeReply — one fenced block unwrapped, unknown keys invalid_reply, no caption invalid_reply, non-Hebrew captionHe dropped, limits cut, length → reply_cut, refusal → refused');
});
