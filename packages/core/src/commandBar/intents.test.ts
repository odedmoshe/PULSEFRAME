/**
 * Intents of the command bar (ADR-0027, plan §4.4, §8 W1 "Intents" and "Resolve"): every example phrasing of the table
 * (Hebrew and English) gives its expected kind and the golden canonical ops; «בטל השתקה» is unmute; «סנכרן לקצב» and
 * «ב־3 שניות» with a title ask; 30 ambiguous or unknown requests never plan or act; the target words resolve as the plan
 * says (selection, playhead, locked tracks, music tracks).
 *
 * BAR_UPDATE_GOLDEN=1 rewrites golden/intents.golden.json (read the diff before committing it).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { canonical, deleteOps, INTENT_IDS, rippleDeleteOn, type BarContext, type BarResult, type IntentId } from '../index.ts';
import { interpret } from './index.ts';
import { INTENT_EXAMPLES } from './lexicon.ts';
import { context, ctxFor, fixture, R30, tx, variants } from './fixture.testFixture.ts';

const fx = fixture();
const ACTIONS: ReadonlySet<IntentId> = new Set(['undo', 'redo', 'workspace', 'export_to', 'seek', 'play', 'pause', 'select_all', 'deselect', 'zoom_in', 'zoom_out', 'language', 'open']);
const expectedKind = (i: IntentId) => (i === 'sync_beat' ? 'ambiguous' : ACTIONS.has(i) ? 'action' : 'plan');

/** What the golden file keeps of a result: its kind and intent, and the canonical ops or the action. */
export function goldenOf(r: BarResult): unknown {
  if (r.kind === 'plan') return { kind: r.kind, intent: r.intent, ops: JSON.parse(canonical(r.ops)), notes: r.notes.map((n) => n.code) };
  if (r.kind === 'action') return { kind: r.kind, intent: r.intent, action: r.action };
  if (r.kind === 'ambiguous') return { kind: r.kind, intent: r.intent, choices: r.choices.map((c) => ({ en: c.en, ...(goldenOf(c.result) as object) })) };
  if (r.kind === 'refused') return { kind: r.kind, intent: r.intent, code: r.code };
  if (r.kind === 'incomplete') return { kind: r.kind, intent: r.intent, missing: r.missing };
  return { kind: r.kind, partial: r.partial };
}

const GOLDEN_URL = new URL('./golden/intents.golden.json', import.meta.url);
const examples = INTENT_IDS.flatMap((intent) => [...INTENT_EXAMPLES[intent].he, ...INTENT_EXAMPLES[intent].en].map((text) => ({ intent, text })));
const actual: Record<string, unknown> = Object.fromEntries(examples.map(({ intent, text }) => [`${intent} · ${text}`, goldenOf(interpret(text, ctxFor(intent)))]));
if (process.env.BAR_UPDATE_GOLDEN === '1') writeFileSync(GOLDEN_URL, `${JSON.stringify(actual, null, 1)}\n`);
const golden = JSON.parse(readFileSync(GOLDEN_URL, 'utf8')) as Record<string, unknown>;

describe('every example of the table', () => {
  it('every intent has Hebrew and English phrasings', () => {
    for (const id of INTENT_IDS) { expect(INTENT_EXAMPLES[id].he.length, id).toBeGreaterThan(0); expect(INTENT_EXAMPLES[id].en.length, id).toBeGreaterThan(0); }
  });
  for (const { intent, text } of examples) {
    it(`${intent}: «${text}» → ${expectedKind(intent)}, as the golden file`, () => {
      const r = interpret(text, ctxFor(intent));
      expect(r.kind, JSON.stringify(goldenOf(r))).toBe(expectedKind(intent));
      if (r.kind === 'plan' || r.kind === 'action') expect(r.intent).toBe(intent);
      expect(goldenOf(r)).toEqual(golden[`${intent} · ${text}`]);
    });
  }
  it('the golden file holds exactly these examples', () => expect(Object.keys(golden).sort()).toEqual(Object.keys(actual).sort()));
});

describe('the rules the plan names', () => {
  const ctx = ctxFor('split_here');
  it('«בטל השתקה» is unmute, never undo (the longest phrase wins)', () => {
    for (const t of ['בטל השתקה', 'בטל השתקה למוזיקה', 'בטלי את ההשתקה של המוזיקה']) {
      const r = interpret(t, context(variants.mutedMusic(fx), { selection: [fx.c2] }));
      expect(r.kind === 'unknown' ? null : r.intent, t).toBe('unmute');
    }
    expect(interpret('בטל השתקה למוזיקה', context(variants.mutedMusic(fx))).kind).toBe('plan');
    expect(interpret('בטל', ctx)).toMatchObject({ kind: 'action', intent: 'undo' });
    expect(interpret('בטל בחירה', ctx)).toMatchObject({ kind: 'action', intent: 'deselect' });
  });
  it('«חתוך כאן» splits, and names the trim readings beside it', () => {
    const r = interpret('חתוך כאן', ctx);
    expect(r).toMatchObject({ kind: 'plan', intent: 'split_here' });
    expect((r as Extract<BarResult, { kind: 'plan' }>).notes).toContainEqual({ code: 'alternative_reading', data: { intents: ['trim_start_here', 'trim_end_here'] } });
    expect(interpret('חתוך את ההתחלה עד כאן', ctx)).toMatchObject({ kind: 'plan', intent: 'trim_start_here' });
  });
  it('«סנכרן לקצב» always asks, with or without a chosen cut and a beat analysis', () => {
    for (const c of [ctx, ctxFor('sync_beat'), context(fixture(undefined, { music: false }).doc)]) {
      const r = interpret('סנכרן לקצב', c);
      expect(r.kind).toBe('ambiguous');
      expect((r as Extract<BarResult, { kind: 'ambiguous' }>).choices.length).toBeGreaterThan(0);
    }
    const noBeats = interpret('סנכרן לקצב', context(fixture(undefined, { music: false }).doc)) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(noBeats.question.he).toContain('אין ניתוח פעימות');
  });
  it('«ב־3 שניות» with a title asks: a position or a length', () => {
    const r = interpret('הוסף כותרת "מזל טוב" ב־3 שניות', ctx) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(r.kind).toBe('ambiguous');
    const plans = r.choices.map((c) => c.result as Extract<BarResult, { kind: 'plan' }>);
    expect(plans.map((p) => (p.ops[0]!.args as { start: unknown }).start)).toEqual([{ value: '3', timescale: 1 }, { value: '4', timescale: 1 }]);
    expect(plans.map((p) => (p.ops[0]!.args as { duration: unknown }).duration)).toEqual([{ value: '2', timescale: 1 }, { value: '3', timescale: 1 }]);
    // the same words with a verb that takes only a position are a position
    expect(interpret('פצל ב־3 שניות', ctx)).toMatchObject({ kind: 'plan', intent: 'split_at' });
  });
  it('«בשנייה 3» = 0:03 and «בשנייה השלישית» asks (lead decision 2); «דקה ועשר» = 1:10 (decision 3)', () => {
    const p = interpret('הוסף כותרת "x" בשנייה 3', ctx) as Extract<BarResult, { kind: 'plan' }>;
    expect((p.ops[0]!.args as { start: unknown }).start).toEqual({ value: '3', timescale: 1 });
    expect(interpret('הוסף כותרת "x" בשנייה השלישית', ctx).kind).toBe('ambiguous');
    expect(interpret('עבור לדקה ועשר', ctx)).toMatchObject({ kind: 'action', action: { kind: 'seek', frame: 70 * 30 } });
  });
  it('a title without a length takes the editor\'s own default (DEFAULT_TITLE_SECONDS) and says so', () => {
    const p = interpret('הוסף כותרת "x" כאן', ctx) as Extract<BarResult, { kind: 'plan' }>;
    expect((p.ops[0]!.args as { duration: unknown }).duration).toEqual({ value: '2', timescale: 1 });
    expect(p.notes).toContainEqual({ code: 'default_used', data: { field: 'duration', seconds: 2, frames: 60 } });
  });
  it('switching the workspace is refused while a take is recorded', () => {
    expect(interpret('עבור למצב הופעה', context(fx.doc, { performRecording: true }))).toMatchObject({ kind: 'refused', code: 'recording' });
  });
  it('undo and redo name the exact transaction, or say there is none', () => {
    expect(interpret('בטל', context(fx.doc))).toMatchObject({ action: { kind: 'undo', transactionId: 'tx_last', ops: ['split_clip'] } });
    expect(interpret('בטל', context(fx.doc, { undoTarget: null }))).toMatchObject({ kind: 'refused', code: 'nothing_to_undo' });
    expect(interpret('בצע שוב', context(fx.doc))).toMatchObject({ kind: 'refused', code: 'nothing_to_redo' });
  });
  it('export by voice only opens the sheet with the destination chosen', () => {
    for (const [t, d] of [['ייצא לוואטסאפ', 'whatsapp'], ['ייצא לווטסאפ', 'whatsapp'], ['ייצא לואטסאפ', 'whatsapp'], ['שלח בווצאפ', 'whatsapp'], ['ייצא ליוטיוב', 'youtube'], ['שמור למחשב', 'computer'], ['ייצוא לרילס', 'reels']] as const)
      expect(interpret(t, ctx), t).toMatchObject({ kind: 'action', action: { kind: 'export_sheet', destination: d } });
  });
  it('an unknown catalogue name is refused with its own words, never guessed', () => {
    expect(interpret('הוסף אפקט קסם', ctx)).toMatchObject({ kind: 'refused', intent: 'effect', code: 'unknown_name' });
    expect(interpret('החל מראה סגול זוהר', ctx)).toMatchObject({ kind: 'refused', intent: 'look', code: 'unknown_name' });
  });
  it('half a frame is refused', () => expect(interpret('הוסף כותרת "x" למשך חצי פריים', ctx)).toMatchObject({ kind: 'refused', code: 'half_frame' }));
  it('an unclosed quote asks for the text', () => expect(interpret('הוסף כותרת "מזל טוב', ctx)).toMatchObject({ kind: 'incomplete', intent: 'add_title', missing: ['text'] }));
});

describe('never guessed: 30 ambiguous or unknown requests plan nothing and run nothing', () => {
  const ctx = ctxFor('split_here');
  const none = context(fx.doc, { selection: [] });
  const REQUESTS: [string, BarContext][] = [
    ['חתוך', ctx], ['ב־3 שניות', ctx], ['הגבר ב־3', ctx], ['הקול', ctx], ['1,5 שניות', ctx], ['סנכרן לקצב', ctx], ['תעשה שמח', ctx], ['מחק', none],
    ['הוסף', ctx], ['הוסף כותרת', ctx], ['הגבר את הקול ב־3 דציבל', ctx], ['פצל כאן ואז מחק', ctx], ['הקליפ הבא', ctx], ['עבור', ctx], ['ייצא', ctx],
    ['מהירות', ctx], ['עמעום', ctx], ['השתק', ctx], ['הוסף כותרת "abc', ctx], ['הוסף אפקט קסם', ctx], ['הוסף כותרת "x" בשנייה השלישית', ctx],
    ['הוסף כותרת "x" ב־3 שניות', ctx], ['הוסף כותרת "x" ב־1,5 שניות', ctx], ['hello world', ctx], ['שלום', ctx], ['חתוך את הסוף', ctx], ['הקפא', ctx],
    ['מחק את הקליפ', context(fx.doc, { selection: [fx.c1, fx.c2] })], ['פצל כאן', context(fx.doc, { selection: [] })], ['הגבר את המוזיקה ב־3 דציבל', context(variants.twoMusic(fx))],
    ['zoom', ctx], ['דקה ועשר', ctx], ['הוסף כותרת "x" למשך חצי פריים', ctx],
  ];
  it('has at least 30 requests', () => expect(REQUESTS.length).toBeGreaterThanOrEqual(30));
  for (const [text, c] of REQUESTS) {
    it(`«${text}»`, () => {
      const r = interpret(text, c);
      expect(r.kind === 'plan' || r.kind === 'action', `${text}: ${JSON.stringify(goldenOf(r))}`).toBe(false);
      // it says what it read, and offers something: choices, an example, its reason, or what it did not read
      expect(r.tokens.length).toBeGreaterThan(0);
      if (r.kind === 'ambiguous') expect(r.choices.length).toBeGreaterThan(0);
      if (r.kind === 'unknown') expect(r.unread.length).toBeGreaterThan(0);
    });
  }
});

describe('resolve: the target words', () => {
  const plan = (r: BarResult) => r as Extract<BarResult, { kind: 'plan' }>;
  it('«הקליפ» with nothing selected is refused nothing_selected, offering the clip at the playhead', () => {
    const r = interpret('מחק את הקליפ', context(fx.doc, { selection: [] }));
    expect(r).toMatchObject({ kind: 'refused', code: 'nothing_selected' });
    expect((r as Extract<BarResult, { kind: 'refused' }>).choices!.map((c) => (c.result as Extract<BarResult, { kind: 'plan' }>).intent)).toContain('delete_clip');
  });
  it('one selected clip is the target', () => expect(plan(interpret('החל מראה חם', context(fx.doc, { selection: [fx.c1] }))).ops).toEqual([{ op: 'apply_look', args: { clipId: fx.c1, lookId: 'warm-sun' } }]));
  it('several selected: «הקליפ» asks «לכולם?», «הקליפים» takes them all', () => {
    const c = context(fx.doc, { selection: [fx.c1, fx.c3] });
    const r = interpret('החל מראה חם על הקליפ', c);
    expect(r.kind).toBe('ambiguous');
    const a = r as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(a.question.he).toBe('נבחרו 2 קליפים — לכולם?');
    expect(plan(a.choices[0]!.result).ops.length).toBe(2);
    expect(plan(interpret('החל מראה חם על הקליפים', c)).ops.length).toBe(2);
  });
  it('the clip under the playhead: none → no_clip_here; one → it; several → choices plus «כל הקליפים בסמן»', () => {
    expect(interpret('פצל כאן', context(fx.doc, { playheadFrame: 2000 }))).toMatchObject({ kind: 'refused', code: 'no_clip_here' });
    const locked = context(variants.lockedTrack(fx.doc, fx.musicTrack), { playheadFrame: 120 });
    const one = plan(interpret('פצל כאן', locked));
    expect(one.ops).toEqual([{ op: 'split_clip', args: { clipId: fx.c2, at: { value: '4', timescale: 1 } } }]);
    expect(one.notes.find((n) => n.code === 'skipped_locked')).toBeTruthy();
    const several = interpret('פצל כאן', context(fx.doc, { playheadFrame: 120 })) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(several.kind).toBe('ambiguous');
    expect(several.choices.at(-1)!.he).toBe('כל הקליפים בסמן');
    expect(plan(several.choices.at(-1)!.result).ops.map((o) => (o.args as { clipId: string }).clipId)).toEqual([fx.c2, fx.song]);
  });
  it('locked tracks are never targets', () => {
    const doc = variants.lockedTrack(fx.doc, fx.videoTrack);
    expect(interpret('מחק את הקליפ', context(doc, { selection: [fx.c2] }))).toMatchObject({ kind: 'refused', code: 'locked' });
    const t = plan(interpret('הוסף מעבר בין כל הקליפים', context(doc)));
    expect(t.kind).toBe('refused');
  });
  it('«המוזיקה»: none → refused no_music_track with the audio tracks as choices; two → ambiguous', () => {
    const none = interpret('הגבר את המוזיקה ב־3 דציבל', context(fixture(undefined, { music: false }).doc));
    expect(none).toMatchObject({ kind: 'refused', code: 'no_music_track' });
    expect((none as Extract<BarResult, { kind: 'refused' }>).choices!.length).toBeGreaterThan(0);
    const two = interpret('הגבר את המוזיקה ב־3 דציבל', context(variants.twoMusic(fx))) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(two.kind).toBe('ambiguous');
    expect(two.choices.length).toBe(2);
  });
  it('«הקול» alone is always asked: every unlocked audio track (the music first) or the clip', () => {
    const r = interpret('הגבר את הקול ב־3 דציבל', ctxFor('gain_change')) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(r.kind).toBe('ambiguous');
    const audio = fx.doc.sequences.seq_main!.tracks.filter((t) => t.kind === 'audio');
    expect(audio.length).toBe(2);
    const ops = r.choices.map((c) => plan(c.result).ops[0]!);
    expect(ops.map((o) => o.op)).toEqual(['set_track_audio', 'set_track_audio', 'set_clip_gain']);
    expect(ops.slice(0, 2).map((o) => (o.args as { trackId: string }).trackId)).toEqual([fx.musicTrack, ...audio.map((t) => t.id).filter((id) => id !== fx.musicTrack)]);
    expect(r.choices[0]!.he).toBe('רצועת המוזיקה');
    // lead decision: no master choice (no registered op changes a master gain in dB); the question says so in both languages
    expect(ops.every((o) => ['set_track_audio', 'set_clip_gain'].includes(o.op))).toBe(true);
    expect(r.choices.some((c) => /master|כללי|ראשי/i.test(c.he + c.en))).toBe(false);
    expect(r.question.he).toMatch(/רצועה או של הקליפ/);
    expect(r.question.he).toMatch(/עוצמה כללית/);
    expect(r.question.en).toMatch(/overall volume/);
    // a locked audio track is not offered
    const locked = interpret('הגבר את הקול ב־3 דציבל', context(variants.lockedTrack(fx.doc, fx.musicTrack), { selection: [fx.c2] })) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(locked.choices.map((c) => (plan(c.result).ops[0]!.args as { trackId?: string }).trackId)).not.toContain(fx.musicTrack);
  });
});

describe('resolve: a picture\'s sound on a locked track', () => {
  it('is refused as locked (the bar\'s own reason and hint), not as the op\'s refusal', () => {
    const audioTrack = fx.doc.sequences.seq_main!.tracks.find((t) => t.clips.some((c) => c.id === fx.c2a))!.id;
    const c = context(variants.lockedTrack(fx.doc, audioTrack), { selection: [fx.c2] });
    for (const t of ['הגבר את הקליפ ב־3 דציבל', 'עמעום בהתחלה של חצי שנייה', 'turn the clip up 3 dB']) {
      const r = interpret(t, c);
      expect(r, t).toMatchObject({ kind: 'refused', code: 'locked' });
      expect((r as Extract<BarResult, { kind: 'refused' }>).opError, t).toBeUndefined();
    }
  });
});

describe('resolve: «הכותרת» (plan §4.4 target words): the selected text clip, or the only text clip', () => {
  const plan = (r: BarResult) => r as Extract<BarResult, { kind: 'plan' }>;
  const ids = (r: BarResult) => plan(r).ops.map((o) => (o.args as { clipId?: string; clipIds?: string[] }).clipId ?? (o.args as { clipIds: string[] }).clipIds);
  /** A second title on the text track, at 300–360. */
  const twoTitles = () => tx(fx.doc, [{ op: 'add_text', args: { text: 'סוף', start: T.frameTime(300, R30), duration: T.frameTime(60, R30), trackId: fx.textTrack } }], 'tt_');
  const noTitle = () => tx(fx.doc, deleteOps(fx.doc, [fx.title], false)!.ops, 'nt_').doc;
  it('the only title is the target of delete, effect, look and trim, in Hebrew and English', () => {
    const c = context(fx.doc, { selection: [fx.c2] });
    for (const t of ['מחק את הכותרת', 'מחקי את הכותרת', 'delete the title']) {
      const r = interpret(t, c);
      expect(r.kind, t).toBe('plan');
      expect(plan(r).ops).toEqual(deleteOps(fx.doc, [fx.title], rippleDeleteOn(fx.doc))!.ops);
    }
    expect(plan(interpret('הוסף אפקט שחור לבן לכותרת', c)).ops).toEqual([{ op: 'add_effect', args: { clipId: fx.title, type: 'color.grayscale' } }]);
    expect(plan(interpret('החל מראה חם על הכותרת', c)).ops).toEqual([{ op: 'apply_look', args: { clipId: fx.title, lookId: 'warm-sun' } }]);
    expect(plan(interpret('מחק את הכותרת הזאת', c)).ops).toEqual(deleteOps(fx.doc, [fx.title], rippleDeleteOn(fx.doc))!.ops);
    expect(ids(interpret('קצץ את הסוף של הכותרת מכאן', context(fx.doc, { selection: [fx.c2], playheadFrame: 30 })))).toEqual([fx.title]);
  });
  it('split: the title when the playhead is inside it; else no_clip_here (never another clip)', () => {
    expect(plan(interpret('פצל את הכותרת כאן', context(fx.doc, { selection: [fx.c2], playheadFrame: 30 }))).ops).toEqual([{ op: 'split_clip', args: { clipId: fx.title, at: T.frameTime(30, R30) } }]);
    expect(interpret('פצל את הכותרת כאן', context(fx.doc, { selection: [fx.c2], playheadFrame: 120 }))).toMatchObject({ kind: 'refused', code: 'no_clip_here' });
  });
  it('two titles: the selected one; none selected → asked, each title a choice', () => {
    const doc = twoTitles().doc;
    const second = twoTitles().results[0]!.output!.clipId as string;
    expect(ids(interpret('מחק את הכותרת', context(doc, { selection: [second, fx.c2] })))).toEqual([second]);
    const r = interpret('מחק את הכותרת', context(doc, { selection: [fx.c2] })) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(r.kind).toBe('ambiguous');
    expect(r.question.he).toBe('יש 2 כותרות — איזו?');
    expect(r.choices.map((c) => ids(c.result))).toEqual([[fx.title], [second]]);
  });
  it('no title → refused no_title; a title only on a locked track → refused locked', () => {
    expect(interpret('מחק את הכותרת', context(noTitle(), { selection: [fx.c2] }))).toMatchObject({ kind: 'refused', code: 'no_title' });
    expect(interpret('delete the title', context(variants.lockedTrack(fx.doc, fx.textTrack), { selection: [fx.c2] }))).toMatchObject({ kind: 'refused', code: 'locked' });
  });
  it('«הוסף כותרת» still adds a title (the target word does not take the head)', () => {
    expect(interpret('הוסף כותרת "x" כאן', context(fx.doc))).toMatchObject({ kind: 'plan', intent: 'add_title' });
    expect(interpret('הוסף את הכותרת "x" כאן', context(fx.doc))).toMatchObject({ kind: 'plan', intent: 'add_title' });
  });
});
