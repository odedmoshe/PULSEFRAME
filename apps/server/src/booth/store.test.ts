/**
 * owner-review.json (wave 8 booth; plan checks 7 and 9): one row per id, 0600, atomic, missing or unreadable = no answers; item state.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BoothAnswer, BoothItem } from '@pulseframe/core';
import { OWNER_REVIEW_FILE } from './contract.ts';
import { deleteAnswer, itemViews, ownerReviewPath, putAnswer, readOwnerReview, viewOf, writeOwnerReview } from './store.ts';

const sha = (c: string) => `sha256:${c.repeat(64)}`;
const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-store-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const ans = (id: string, extra: Partial<BoothAnswer> = {}): BoothAnswer => ({ id, verdict: 'ok', recipe: sha('1'), at: '2026-11-27T10:00:00.000Z', build: 'unknown', ...extra });
const item = (id: string, kind: BoothItem['kind'], extra: Partial<BoothItem> = {}): BoothItem => ({
  id, source: kind === 'audio' ? 'music' : 'gpu-transition', group: 'first.music', kind, title: { he: 'x', en: 'x' }, what: { he: 'x', en: 'x' }, recipe: sha('1'),
  make: kind === 'audio' ? { route: 'music', styleId: 'music.calm', bars: 8, seed: 1 } : { route: 'scene', scene: 'transition', id: 'film-burn' },
  changesLight: false, exportStrip: false, usedBy: [], minutes: 1, problems: ['other'], ...extra,
});

describe('the answers file', () => {
  it('missing, unreadable or invalid is no answers', () => {
    const d = tmp();
    expect(readOwnerReview(d)).toEqual({ version: 1, answers: [] });
    fs.writeFileSync(ownerReviewPath(d), '{not json');
    expect(readOwnerReview(d).answers).toEqual([]);
    fs.writeFileSync(ownerReviewPath(d), JSON.stringify({ version: 1, answers: [{ id: 'x' }] }));
    expect(readOwnerReview(d).answers).toEqual([]);
  });
  it('one row per id (the latest), mode 0600 where the OS has modes; DELETE clears', () => {
    const d = tmp();
    putAnswer(d, ans('music:music.calm'));
    putAnswer(d, ans('music:music.pop', { verdict: 'bad' }));
    putAnswer(d, ans('music:music.calm', { verdict: 'skip' }));
    expect(readOwnerReview(d).answers.map((a) => [a.id, a.verdict])).toEqual([['music:music.pop', 'bad'], ['music:music.calm', 'skip']]);
    expect(path.basename(ownerReviewPath(d))).toBe(OWNER_REVIEW_FILE);
    if (process.platform !== 'win32') expect(fs.statSync(ownerReviewPath(d)).mode & 0o777).toBe(0o600);
    expect(deleteAnswer(d, 'music:music.calm')).toBe(true);
    expect(deleteAnswer(d, 'music:music.calm')).toBe(false);
    expect(readOwnerReview(d).answers.map((a) => a.id)).toEqual(['music:music.pop']);
  });
  it('is written atomically: a kill between the write and the rename leaves the old file whole', () => {
    const d = tmp();
    putAnswer(d, ans('music:music.calm'));
    const before = fs.readFileSync(ownerReviewPath(d), 'utf8');
    expect(() => writeOwnerReview(d, { version: 1, answers: [ans('music:music.calm'), ans('music:music.pop')] }, () => { throw new Error('killed'); })).toThrow('killed');
    expect(fs.readFileSync(ownerReviewPath(d), 'utf8')).toBe(before);
    expect(readOwnerReview(d).answers.length).toBe(1);
  });
});

describe('item state', () => {
  it('unanswered, answered, changed on another recipe (every kind)', () => {
    const it1 = item('music:music.calm', 'audio');
    expect(viewOf(it1, null).state).toBe('unanswered');
    expect(viewOf(it1, ans(it1.id)).state).toBe('answered');
    expect(viewOf(it1, ans(it1.id, { recipe: sha('9') }))).toMatchObject({ state: 'changed', changedWhy: 'recipe' });
  });
  it('audio: changed when the bytes served now (or the pinned music bytes) differ from the row\'s played', () => {
    const music = item('music:music.calm', 'audio', { expected: sha('e') });
    expect(viewOf(music, ans(music.id, { played: sha('e') })).state).toBe('answered');
    expect(viewOf(music, ans(music.id, { played: sha('f') }))).toMatchObject({ state: 'changed', changedWhy: 'played' });
    const sfx = item('sfx:sfx.pop', 'audio');
    expect(viewOf(sfx, ans(sfx.id, { played: sha('2') })).state).toBe('answered'); // nothing served yet: no claim
    expect(viewOf(sfx, ans(sfx.id, { played: sha('2') }), { played: () => sha('3') })).toMatchObject({ state: 'changed', changedWhy: 'played' });
    // an adapter never changes an audio item
    expect(viewOf(sfx, ans(sfx.id, { browserAdapter: 'a' }), { browserAdapter: 'b' }).state).toBe('answered');
  });
  it('picture only: changed (adapter) when the editor tab\'s or the export worker\'s adapter differs from the row\'s', () => {
    const pic = item('gpu-transition:film-burn', 'picture');
    const row = ans(pic.id, { browserAdapter: 'intel|gen-12lp||', exportAdapter: 'nvidia|ampere||' });
    expect(viewOf(pic, row, { browserAdapter: 'intel|gen-12lp||' }).state).toBe('answered');
    expect(viewOf(pic, row, {}).state).toBe('answered');
    expect(viewOf(pic, row, { browserAdapter: 'nvidia|ampere||' })).toMatchObject({ state: 'changed', changedWhy: 'adapter' });
    expect(viewOf(pic, row, { exportAdapter: 'google|swiftshader||' })).toMatchObject({ state: 'changed', changedWhy: 'adapter' });
    expect(itemViews([pic, item('music:music.pop', 'audio')], { version: 1, answers: [row] }).map((v) => v.state)).toEqual(['answered', 'unanswered']);
  });
});
