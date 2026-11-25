/**
 * The local assistant's fixtures and scorer (wave 7; assistant-decisions.md §5 builder A). No model: the answers are the fixture
 * file's LABELLED STAND-IN answers (designer-written) and planted wrong ones.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { barUnderstands, groundLocalAnswer, interpret, LocalAnswerSchema, LOCAL_INTENT_SLOTS, type IntentId, type LocalAnswer } from '@pulseframe/core';
import { ctxFor } from '../../core/src/commandBar/fixture.testFixture.ts';
import { checkLocalFixtures, LOCAL_FIXTURE_COUNT, scoreLocalAnswer, summarizeLocalScores, type LocalFixture } from './assistant-local-score.ts';

const file = JSON.parse(readFileSync(new URL('../fixtures/assistant-local-fixtures.json', import.meta.url), 'utf8')) as { about: string; fixtures: LocalFixture[] };
const fixtures = file.fixtures;
const byId = (id: string) => fixtures.find((f) => f.id === id)!;
const sent = fixtures.filter((f) => f.expect !== 'GRAMMAR');
const standInRows = () => fixtures.map((f) => scoreLocalAnswer(f, f.standIn ? JSON.stringify(f.standIn) : null, 1));

describe('the fixtures', () => {
  it('are 51: A29 B7 C5 D5 E5, unique ids, labelled as designer text and a stand-in', () => {
    expect(fixtures).toHaveLength(LOCAL_FIXTURE_COUNT);
    expect(() => checkLocalFixtures(fixtures)).not.toThrow();
    expect(file.about).toMatch(/LABELLED STAND-IN/);
    expect(file.about).toMatch(/not produced by any model/);
    expect(fixtures.filter((f) => f.lang === 'en').length).toBeGreaterThanOrEqual(4);
  });
  it('GRAMMAR exactly where the model-free grammar reads the text itself (those are never sent)', () => {
    for (const f of fixtures) expect(f.expect === 'GRAMMAR', `${f.id} «${f.text}»`).toBe(barUnderstands(f.text));
    expect(byId('C01').expect).toBe('GRAMMAR');
  });
  it('every expected answer is already grounded (grounding it drops nothing) and only uses its intent\'s slots', () => {
    for (const f of sent) {
      const e = f.expect as { intent: LocalAnswer['intent']; slots: LocalAnswer['slots'] };
      expect(LocalAnswerSchema.safeParse(e).success, f.id).toBe(true);
      expect(groundLocalAnswer(f.text, e).dropped, f.id).toEqual([]);
      if (e.intent !== 'none') for (const s of Object.keys(e.slots)) expect(LOCAL_INTENT_SLOTS[e.intent], `${f.id}.${s}`).toContain(s);
    }
  });
  it('the stand-in answers, grounded as the server grounds them, are exactly the expected answers (the planted details are dropped)', () => {
    for (const f of sent) {
      expect(LocalAnswerSchema.safeParse(f.standIn).success, f.id).toBe(true);
      const g = groundLocalAnswer(f.text, f.standIn!);
      expect({ intent: g.intent, slots: g.slots }, f.id).toEqual(f.expect);
    }
    const planted = sent.filter((f) => JSON.stringify(f.standIn) !== JSON.stringify(f.expect)).map((f) => f.id);
    expect(planted.sort()).toEqual(['A23', 'C02', 'C03', 'C04', 'C05']);
  });
  it('the bar does what each group says with the phrase of the expected answer (group C asks, group D proposes nothing)', () => {
    const rows = standInRows();
    for (const r of rows) {
      const f = byId(r.id);
      if (f.expect === 'GRAMMAR') continue;
      const e = f.expect as { intent: LocalAnswer['intent'] };
      if (f.id.startsWith('D')) { expect(r.outcome, f.id).toBe('none'); continue; }
      if (f.id.startsWith('C') || f.id === 'A23') expect(r.outcome, f.id).toBe('asks');
      else expect(r.outcome, f.id).toBe('acts');
      // the phrase, read by the grammar in the intent's own test context
      const res = interpret(r.phrase!, ctxFor(e.intent as IntentId));
      // acts: a plan or an action of that intent, or the grammar's own question WHICH clip (never a missing value)
      if (r.outcome === 'asks') expect(res.kind, `${f.id} ${r.phrase}`).toBe('incomplete');
      else expect(res.kind === 'ambiguous' ? 'plan' : res.kind, `${f.id} ${r.phrase}`).toBe(f.id.startsWith('B') ? 'action' : 'plan');
      expect(res.kind === 'unknown' ? null : res.intent, `${f.id} ${r.phrase}`).toBe(e.intent);
    }
  });
  it('no person\'s name: titles and project names are ordinary words', () => {
    for (const f of sent) {
      const t = (f.expect as { slots: { text?: string } }).slots?.text;
      if (t) expect(['יום הולדת 5', 'מזל טוב', 'עוגה', 'גן רימון']).toContain(t);
    }
  });
});

describe('the scorer', () => {
  it('scores the stand-in answers: all valid, every intent and slot matched, nothing guessed, none handled, nothing that would change the project unexpectedly', () => {
    const rows = standInRows();
    const s = summarizeLocalScores(fixtures, rows);
    expect(s).toMatchObject({ fixtures: 51, grammar: 5, sent: 46, valid: 46, intentMatch: 46, slotsMatch: 46, guessed: 0, noneExpected: 5, noneHandled: 5, wouldChange: [], noPhrase: [] });
    expect(s.droppedUngrounded).toBe(5);
    for (const r of rows) expect(r.wallMs).toBe(1);
  });
  it('catches a planted guessed slot when the grounding is broken (the oracle is an independent grounding of the kept answer)', () => {
    const f = byId('C03');
    const identity = (_: string, a: LocalAnswer) => ({ intent: a.intent, slots: a.slots, dropped: [] });
    const row = scoreLocalAnswer(f, JSON.stringify(f.standIn), 5, { ground: identity });
    expect(row.guessed).toBe(1);
    expect(row.slotsMatch).toBe(false);
    expect(row.outcome).toBe('acts');
    expect(row.wouldChange).toBe(true); // «קצת» became 3 dB: an edit the owner did not say
    // with the server's grounding the same answer guesses nothing and the bar asks
    expect(scoreLocalAnswer(f, JSON.stringify(f.standIn), 5)).toMatchObject({ guessed: 0, slotsMatch: true, outcome: 'asks', wouldChange: false, droppedUngrounded: 1 });
  });
  it('puts three planted wrong answers in the right column', () => {
    // D03 «תמחק את כל הפרויקט» answered as delete_clip: an edit where nothing was to be proposed
    expect(scoreLocalAnswer(byId('D03'), JSON.stringify({ intent: 'delete_clip', slots: {} }), 1)).toMatchObject({ valid: true, intentMatch: false, wouldChange: true, noneHandled: false, outcome: 'acts' });
    // A12 answered with the wrong direction: intent matches, slots do not, and it would change the project
    expect(scoreLocalAnswer(byId('A12'), JSON.stringify({ intent: 'gain_change', slots: { target: 'music', dir: 'up', db: '6' } }), 1)).toMatchObject({ intentMatch: true, slotsMatch: false, wouldChange: true });
    // not JSON / the wrong shape / no answer: invalid
    for (const t of ['הנמך את המוזיקה', '{"intent":"gain_change"}', '{"intent":"delete_all","slots":{}}', null]) expect(scoreLocalAnswer(byId('A12'), t, null), String(t)).toMatchObject({ valid: false, outcome: 'invalid', wouldChange: false });
    // E02 answered 'none': none where an edit was expected
    expect(scoreLocalAnswer(byId('E02'), '{"intent":"none","slots":{}}', 1)).toMatchObject({ intentMatch: false, noneHandled: false, wouldChange: false, outcome: 'none' });
  });
  it('a view action is never counted as a change; a phrase no grammar sentence fits is listed', () => {
    expect(scoreLocalAnswer(byId('D01'), '{"intent":"play","slots":{}}', 1)).toMatchObject({ intentMatch: false, wouldChange: false, outcome: 'acts' });
    expect(scoreLocalAnswer(byId('A14'), '{"intent":"mute","slots":{"target":"clip"}}', 1)).toMatchObject({ outcome: 'no_phrase', phrase: null, slotsMatch: false });
  });
  it('compares numbers exactly: "6.0" is 6, "6.5" is not', () => {
    expect(scoreLocalAnswer(byId('A12'), '{"intent":"gain_change","slots":{"target":"music","dir":"down","db":"6.0"}}', 1)).toMatchObject({ slotsMatch: true, guessed: 0 });
    expect(scoreLocalAnswer(byId('A12'), '{"intent":"gain_change","slots":{"target":"music","dir":"down","db":"6.5"}}', 1)).toMatchObject({ slotsMatch: false, droppedUngrounded: 1, outcome: 'asks' });
  });
  it('the ASK and NONE forms of `expect` are understood too', () => {
    const ask: LocalFixture = { id: 'C99', text: 'תורידי קצת את המוזיקה', lang: 'he', expect: 'ASK' };
    expect(scoreLocalAnswer(ask, '{"intent":"gain_change","slots":{"target":"music","dir":"down","db":"3"}}', 1)).toMatchObject({ intentMatch: true, outcome: 'asks', wouldChange: false });
    const none: LocalFixture = { id: 'D99', text: 'מה השעה?', lang: 'he', expect: 'NONE' };
    expect(scoreLocalAnswer(none, '{"intent":"none","slots":{}}', 1)).toMatchObject({ intentMatch: true, slotsMatch: true, noneHandled: true });
  });
  it('a GRAMMAR fixture is never scored as an answer; one the grammar does not read is flagged', () => {
    expect(scoreLocalAnswer(byId('C01'), null, null)).toMatchObject({ outcome: 'grammar', valid: true, wouldChange: false });
    expect(scoreLocalAnswer({ id: 'A99', text: 'תעשה את זה יפה', lang: 'he', expect: 'GRAMMAR' }, null, null).valid).toBe(false);
  });
  it('the fixture-file check refuses a wrong count or group', () => {
    expect(() => checkLocalFixtures(fixtures.slice(1))).toThrow(/51/);
    expect(() => checkLocalFixtures([...fixtures.slice(1), { ...fixtures[1]!, id: 'B99' }])).toThrow(/group/);
  });
});
