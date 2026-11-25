/**
 * The search track's contract in core (wave 7; .artifacts/wave7/search-decisions.md §4): the wire shapes, the honest "not built"
 * state of the functions, and THE PRIVACY FILTER of an agent's answer (agentAnswerOf), complete here. The function bodies are tested
 * in footageSearch.test.ts and footageSearch.property.test.ts (builder A).
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_SOURCES, AgentFootageAnswerSchema, agentAnswerOf, FOOTAGE_FORBIDDEN_WORDS, FOOTAGE_LIMITS, FOOTAGE_NOTE, FOOTAGE_REFUSALS, FOOTAGE_SEARCH_BUILT, FootageAnswerSchema,
  FootageQuerySchema, FootageSearchNotBuilt, footageQueryForms, int8Dot, mergePictureHits, MOMENT_SOURCES, parseFootageQuery, quantiseInt8, sampleFrameTargets, searchFootage,
  StartScanBodySchema, createProject, type FootageAnswer,
} from './index.ts';

const t = (value: number, timescale = 30) => ({ value: String(value), timescale });

describe('wire shapes', () => {
  it('a query is 1–200 characters after trim, picture and limit optional, nothing else', () => {
    expect(FootageQuerySchema.parse({ query: '  נרות ' })).toEqual({ query: 'נרות' });
    expect(FootageQuerySchema.safeParse({ query: '   ' }).success).toBe(false);
    expect(FootageQuerySchema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
    expect(FootageQuerySchema.safeParse({ query: 'x', limit: 51 }).success).toBe(false);
    // no query by example: an image, a frame, an asset or a moment is not a field of the query
    for (const extra of [{ image: 'data:' }, { assetId: 'ast_1' }, { frame: 3 }, { like: { assetId: 'a', at: t(0) } }]) expect(FootageQuerySchema.safeParse({ query: 'x', ...extra }).success).toBe(false);
  });
  it('a scan names at most 2000 files and nothing else', () => {
    expect(StartScanBodySchema.safeParse({}).success).toBe(true);
    expect(StartScanBodySchema.safeParse({ assetIds: Array.from({ length: FOOTAGE_LIMITS.maxScanAssets + 1 }, (_, i) => `a${i}`) }).success).toBe(false);
    expect(StartScanBodySchema.safeParse({ assetIds: ['a'], auto: true }).success).toBe(false);
  });
  it('the sources hold no "similar" and no person-finding source', () => {
    expect([...MOMENT_SOURCES]).toEqual(['name', 'date', 'event', 'transcript', 'pearl', 'person', 'picture']);
    expect([...AGENT_SOURCES]).toEqual(['name', 'date', 'event', 'transcript']);
  });
  it('no refusal message holds a placeholder for the query, and none offers a query by example', () => {
    for (const [k, x] of Object.entries(FOOTAGE_REFUSALS)) {
      const msg = (x.message as (...a: string[]) => string)('engine_not_configured');
      expect(msg, k).not.toMatch(/query|"/);
      for (const w of FOOTAGE_FORBIDDEN_WORDS) { expect(msg.toLowerCase(), k).not.toContain(w); expect(x.hint.toLowerCase(), k).not.toContain(w); }
    }
    for (const w of FOOTAGE_FORBIDDEN_WORDS) { expect(FOOTAGE_NOTE.he).not.toContain(w); expect(FOOTAGE_NOTE.en.toLowerCase()).not.toContain(w); }
  });
});

describe('the privacy filter of an agent answer (agentAnswerOf)', () => {
  const owner: FootageAnswer = {
    exact: [
      { assetId: 'a1', start: t(30), end: t(75), sources: ['transcript', 'pearl'], snippet: 'תכבי את הנרות', frame: 31 },
      { assetId: 'a2', start: t(0), end: t(90), sources: ['pearl', 'person'], snippet: 'תוויתסוד' },
      { assetId: 'a3', start: null, end: null, sources: ['name', 'date'] },
    ],
    picture: [{ assetId: 'a4', start: t(60), end: t(180), sources: ['picture'], frame: 90 }],
    pictureState: 'ready', setup: { code: 'ready', detail: 'cuda', device: 'cuda', versions: { torch: '2.15.0' } }, scanned: { files: 3, of: 4 },
    embedder: 'siglip2-b16-256@3f9f96cb/fp16/pre1', heuristic: true, note: FOOTAGE_NOTE.en,
  };
  it('keeps only assetId, start, end and agent sources; drops moments found only by a pearl name or a tag; empties pictures', () => {
    const a = agentAnswerOf(owner);
    expect(AgentFootageAnswerSchema.parse(a)).toEqual(a);
    expect(a).toEqual({
      exact: [{ assetId: 'a1', start: t(30), end: t(75), sources: ['transcript'] }, { assetId: 'a3', start: null, end: null, sources: ['name', 'date'] }],
      picture: [], pictureState: 'owner_only', heuristic: true, note: FOOTAGE_NOTE.en,
    });
    const text = JSON.stringify(a);
    for (const leak of ['תוויתסוד', 'תכבי', 'snippet', 'frame', 'person', 'pearl', '["picture"', 'setup', 'cuda', 'siglip', 'scanned', 'a2', 'a4']) expect(text, leak).not.toContain(leak);
  });
  it('is a rebuild, not a spread: unknown keys planted on a moment never pass', () => {
    const planted = { ...owner, exact: [{ ...owner.exact[2]!, label: 'סוד', people: ['per_1'], score: 0.9 } as never] };
    expect(JSON.stringify(agentAnswerOf(planted))).not.toMatch(/סוד|per_1|score|0\.9/);
  });
  it('the owner answer schema allows the owner extras and nothing else', () => {
    expect(FootageAnswerSchema.safeParse(owner).success).toBe(true);
    expect(FootageAnswerSchema.safeParse({ ...owner, exact: [{ ...owner.exact[0]!, score: 0.5 }] }).success).toBe(false);
  });
});

describe('the functions answer "not built" until builder A builds them (never a made-up value)', () => {
  const doc = createProject({ id: 'prj_fs', name: 'P' });
  it.skipIf(FOOTAGE_SEARCH_BUILT)('each throws FootageSearchNotBuilt', () => {
    const calls: (() => unknown)[] = [
      () => footageQueryForms('בנרות'), () => parseFootageQuery('חנוכה 2024'), () => searchFootage(doc, 'נרות', { reader: 'owner' }), () => sampleFrameTargets({ num: 30, den: 1 }, 300),
      () => quantiseInt8(new Float32Array(768)), () => int8Dot(new Int8Array(2), new Int8Array(2)), () => mergePictureHits(doc, [], { num: 30, den: 1 }, 30),
    ];
    for (const c of calls) expect(c).toThrow(FootageSearchNotBuilt);
  });
  // builder A (footageSearch.test.ts holds the full tests; these rows name what the contract needs)
  it.todo('searchFootage(doc, q, { reader: "agent" }) never returns a pearl or person source and never matches a label or a person name, whatever the document holds');
  it.todo('searchFootage on the same document in shuffled asset order gives the same JSON');
  it.todo('sampleFrameTargets at 30000/1001 over 300 frames equals ceil(s·r) for every s with exact rationals, and never reaches frameCount');
  it.todo('quantiseInt8 rounds half away from zero; int8Dot equals the float dot of the dequantised vectors within 1/127² per dimension');
  it.todo('mergePictureHits gives spans inside the file, on project frame edges, outward; ties by (assetId, start)');
});
