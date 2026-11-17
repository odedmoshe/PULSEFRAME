import { describe, expect, it } from 'vitest';
import { createProject } from '@pulseframe/core';
import { destinationKey, DESTINATIONS, exportOptions, DEFAULT_CHOICES, exportTargets, fourKReachable, formatFileSize, alsoSuggestion, jobFraction, mergeJobViews, overallFraction, parseStage, scaledSize, shortSideLabel } from './exportSheet.logic.ts';

describe('export sheet logic', () => {
  it('reads the stage words and frame counts the server reports', () => {
    expect(parseStage('rendering 557/870')).toMatchObject({ id: 'rendering', done: 557, total: 870 });
    expect(parseStage('rendering audio')).toMatchObject({ id: 'rendering audio', done: null });
    expect(parseStage('encoding').index).toBeGreaterThan(parseStage('rendering 1/2').index);
    expect(parseStage(null).id).toBeNull();
    expect(parseStage('something new').id).toBeNull();
  });
  it('invents no progress while only preparing', () => {
    expect(jobFraction({ status: 'running', stage: 'preparing' })).toBeNull();
    expect(jobFraction({ status: 'running', stage: 'rendering 435/870' })).toBeCloseTo(0.46);
    expect(jobFraction({ status: 'succeeded', stage: null })).toBe(1);
    expect(overallFraction([{ status: 'queued', stage: null }])).toBeNull();
    expect(overallFraction([{ status: 'succeeded', stage: null }, { status: 'queued', stage: null }])).toBe(0.5);
  });
  it('sends only what differs from the defaults of the editor export', () => {
    expect(exportOptions({ ...DEFAULT_CHOICES, quality: 'high' }, null)).toEqual({});
    expect(exportOptions({ ...DEFAULT_CHOICES, quality: 'draft', scale: 0.5 }, 'var_1')).toEqual({ variantId: 'var_1', quality: 'draft', scale: 0.5 });
  });
  it('lists the master, linked formats and the profiles that could be linked; the master shape is not offered twice', () => {
    const doc = createProject({ id: 'p', name: 'x', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } });
    const t = exportTargets(doc);
    expect(t[0]!.kind).toBe('master');
    expect(t.some((x) => x.profileId === 'landscape-16x9')).toBe(false);
    expect(t.some((x) => x.profileId === 'vertical-9x16' && x.kind === 'profile')).toBe(true);
    const yt = DESTINATIONS.find((d) => d.id === 'youtube')!;
    expect(destinationKey(yt, t)).toBe('master');
    expect(destinationKey(DESTINATIONS.find((d) => d.id === 'reels')!, t)).toBe('profile:vertical-9x16');
    expect(destinationKey(DESTINATIONS.find((d) => d.id === 'custom')!, t)).toBeNull();
  });
  it('names sizes by the short side, even numbers, and offers 4K only when the source reaches it', () => {
    expect(scaledSize({ width: 1919, height: 1079 }, 0.5)).toEqual({ width: 960, height: 540 });
    expect(shortSideLabel({ width: 1080, height: 1920 }, 1)).toBe('1080p');
    expect(fourKReachable({ width: 1920, height: 1080 })).toBe(false);
    expect(fourKReachable({ width: 3840, height: 2160 })).toBe(true);
    expect(formatFileSize(37_600_000)).toBe('37.6 MB');
  });
});

describe('mergeJobViews (a poll that was in flight must not drop a file started meanwhile)', () => {
  const job = (id: string, status: string, stage: string | null = null) => ({ id, status, stage, output: null, error: null, label: id });
  it('keeps a job that is not in the answers', () => {
    // the poll asked about [a]; meanwhile b was appended; the answer must not replace the list with [a]
    const now = [job('a', 'running'), job('b', 'queued')];
    const out = mergeJobViews(now, [{ id: 'a', status: 'running', stage: 'rendering 9/540', output: null, error: null }]);
    expect(out.map((j) => j.id)).toEqual(['a', 'b']);
    expect(out[0]!.stage).toBe('rendering 9/540');
  });
  it('does not take a finished job back to running', () => {
    const out = mergeJobViews([job('a', 'succeeded')], [{ id: 'a', status: 'running', stage: 'encoding', output: null, error: null }]);
    expect(out[0]!.status).toBe('succeeded');
  });
});

describe('alsoSuggestion', () => {
  const t = (key: string, w: number, h: number, kind: 'master' | 'variant' | 'profile', variantId: string | null = null) => ({ key, kind, variantId, profileId: null, width: w, height: h, fit: 'cover' as const, name: { he: key, en: key } });
  it('offers the vertical shape after a wide export, a linked one first', () => {
    const targets = [t('master', 1920, 1080, 'master'), t('profile:r', 1080, 1920, 'profile'), t('variant:v', 1080, 1920, 'variant', 'v')];
    expect(alsoSuggestion(targets, new Set([null]))?.key).toBe('variant:v');
  });
  it('offers nothing when the other shape was exported, or the project is square', () => {
    const targets = [t('master', 1920, 1080, 'master'), t('variant:v', 1080, 1920, 'variant', 'v')];
    expect(alsoSuggestion(targets, new Set([null, 'v']))).toBeNull();
    expect(alsoSuggestion([t('master', 1080, 1080, 'master'), t('profile:r', 1080, 1920, 'profile')], new Set([null]))).toBeNull();
  });
  it('offers the wide shape after a vertical export', () => {
    expect(alsoSuggestion([t('master', 1080, 1920, 'master'), t('profile:y', 1920, 1080, 'profile')], new Set([null]))?.key).toBe('profile:y');
  });
});
