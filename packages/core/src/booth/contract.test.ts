/**
 * The booth contract (wave 8 booth pre-pass). Builder W1's rows (report.ts, scrub.ts) are real tests in report.test.ts and
 * scrub.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  BOOTH_CHECKS, BOOTH_FIRST_MUSIC, BOOTH_FIRST_ORDER, BOOTH_FIRST_SITTING_CARDS, BOOTH_FIRST_TRANSITIONS, BOOTH_PROBLEM_IDS, BoothAnswerBodySchema,
  BoothCheckRowSchema, BoothNotBuiltError, boothFirstOrder, BoothItemSchema, GPU_TRANSITION_IDS, MUSIC_STYLES, parseBoothBlock, scrubNote,
} from '../index.ts';

const sha = `sha256:${'a'.repeat(64)}`;

describe('the first sitting', () => {
  it('is 14 cards: the 7 new GPU transitions, the 6 music styles, the microphone', () => {
    expect(BOOTH_FIRST_TRANSITIONS.length + BOOTH_FIRST_MUSIC.length + 1).toBe(BOOTH_FIRST_SITTING_CARDS);
    expect(BOOTH_FIRST_SITTING_CARDS).toBe(14);
    for (const id of BOOTH_FIRST_TRANSITIONS) expect(GPU_TRANSITION_IDS).toContain(id);
    expect([...BOOTH_FIRST_MUSIC]).toEqual(MUSIC_STYLES.filter((s) => s.review !== 'rejected').map((s) => s.id));
  });
  it('L1: transitions first only on a discrete adapter that answered ok; otherwise music, mic, the Windows step, transitions', () => {
    expect(boothFirstOrder({ state: 'ok', data: { discrete: true } })).toEqual(BOOTH_FIRST_ORDER.discrete);
    expect(boothFirstOrder({ state: 'ok', data: { discrete: false, vendor: 'intel' } })).toEqual(BOOTH_FIRST_ORDER.other);
    expect(boothFirstOrder({ state: 'setup', data: { discrete: true } })).toEqual(BOOTH_FIRST_ORDER.other);
    expect(boothFirstOrder(null)).toEqual(BOOTH_FIRST_ORDER.other);
    expect(BOOTH_FIRST_ORDER.other).toEqual(['music', 'mic', 'windows-gpu-setting', 'transitions']);
  });
});

describe('the self-check rows', () => {
  it('13 rows in a fixed order; export-gpu, speech and search are heavy; no music-bytes row', () => {
    expect(BOOTH_CHECKS.map((c) => c.id)).toEqual(['browser-gpu', 'browser-codecs', 'export-gpu', 'ffmpeg', 'svg', 'mic', 'library', 'kit', 'speech', 'assistant', 'search', 'disk', 'drop']);
    expect(BOOTH_CHECKS.filter((c) => c.heavy).map((c) => c.id)).toEqual(['export-gpu', 'speech', 'search']);
    expect(BOOTH_CHECKS.find((c) => c.id === 'export-gpu')!.timeoutMs).toBe(160_000);
  });
  it('row data takes scalars only: a path, an e-mail, a nested object or free text with a slash is refused', () => {
    const ok = { id: 'ffmpeg', state: 'ok', code: null, data: { version: 'ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024', h264_nvenc: false, encoders: 8 } };
    expect(BoothCheckRowSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['C:\\Users\\x\\python.exe', 'C:/Users/x', '/home/x/.data', 'x@y.z', 'spawn ENOENT: no such file']) {
      expect({ bad, ok: BoothCheckRowSchema.safeParse({ ...ok, data: { version: bad } }).success }).toEqual({ bad, ok: false });
    }
    expect(BoothCheckRowSchema.safeParse({ ...ok, data: { detail: { message: 'x' } } }).success).toBe(false);
    expect(BoothCheckRowSchema.safeParse({ ...ok, detail: 'x' }).success).toBe(false);
  });
});

describe('items and answers', () => {
  it('an answer has no heard verdict and no unknown field; adapters are ASCII', () => {
    expect(BoothAnswerBodySchema.safeParse({ verdict: 'ok', recipe: sha }).success).toBe(true);
    expect(BoothAnswerBodySchema.safeParse({ verdict: 'heard', recipe: sha }).success).toBe(false);
    expect(BoothAnswerBodySchema.safeParse({ verdict: 'ok', recipe: sha, extra: 1 }).success).toBe(false);
    expect(BoothAnswerBodySchema.safeParse({ verdict: 'ok', recipe: sha, browserAdapter: 'intel|gen-12lp|\u200f' }).success).toBe(false);
    expect(BoothAnswerBodySchema.safeParse({ verdict: 'bad', recipe: sha, problems: ['flicker'], note: 'x'.repeat(281) }).success).toBe(false);
  });
  it('an item id is source:catalogueId and the schema is strict', () => {
    const item = { id: 'gpu-transition:film-burn', source: 'gpu-transition', group: 'first.gpu-new', kind: 'picture', title: { he: 'צריבת פילם', en: 'Film burn' }, what: { he: 'מעבר', en: 'A transition' },
      recipe: sha, make: { route: 'scene', scene: 'transition', id: 'film-burn' }, changesLight: true, exportStrip: true, usedBy: [], minutes: 0.5, problems: ['broken', 'flicker', 'other'] };
    expect(BoothItemSchema.safeParse(item).success).toBe(true);
    expect(BoothItemSchema.safeParse({ ...item, id: 'Film Burn' }).success).toBe(false);
    expect(BoothItemSchema.safeParse({ ...item, problems: ['unnatural'] }).success).toBe(false);
    expect(BOOTH_PROBLEM_IDS).not.toContain('unnatural');
  });
  it('the builder functions are built (W1): they answer instead of the typed not-built', () => {
    expect(new BoothNotBuiltError('x').code).toBe('booth_not_built');
    expect(parseBoothBlock('')).toEqual({ ok: false, code: 'no_block' });
    expect(scrubNote('', { literals: [] })).toBe('');
  });
});

// The 'report and scrub (builder W1)' rows moved to report.test.ts and scrub.test.ts as real tests.
