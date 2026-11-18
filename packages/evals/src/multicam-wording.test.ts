/**
 * Keeps the Hebrew wording of the multicam refusals (packages/i18n/src/multicam.ts HE_MULTICAM) in step with their fixed English
 * sentences (core multicamRefusals.ts MULTICAM_REFUSALS; ADR-0020). The sentences are built from the table (the bodies that
 * raise most of them are W1's); the ones existing operations raise today (remove_asset, replace_clip_media) are also provoked
 * for real. Every pattern is used, and each sentence is worded by ITS row (no earlier table catches it first). Also: the shared
 * strings exist in both languages, every verdict, skip reason, dropped kind and warning has a label, the sync job's stages
 * are worded, the decided labels are exact, and the auto-switch never claims to identify who is speaking.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, DROPPED_KINDS, MULTICAM_AUTO_LABEL, MULTICAM_REFUSALS, MULTICAM_SYNC_STAGES, MULTICAM_WARNINGS, multicamSyncStage, OpError, SKIP_REASONS, SYNC_VERDICTS,
  type MulticamRefusalKey, type ProjectDocument,
} from '@pulseframe/core';
import { dictionaries, jobStageLabel, MULTICAM_REFUSAL_PATTERNS, SHORTS_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';
import { HE_MULTICAM, MULTICAM_EN, MULTICAM_HE } from '../../i18n/src/multicam.ts';

const M = MULTICAM_REFUSALS;
const SENTENCES: Record<MulticamRefusalKey, string> = {
  notBuilt: M.notBuilt.message('switch_angles'),
  groupNotFound: M.groupNotFound.message('mcg_x'),
  angleNotFound: M.angleNotFound.message('ang_x', 'mcg_x'),
  pieceNotFound: M.pieceNotFound.message('ang_x', 3),
  tooManyGroups: M.tooManyGroups.message(),
  angleKind: M.angleKind.message('ast_x', 'picture'),
  assetTwice: M.assetTwice.message('ast_x'),
  referenceFixed: M.referenceFixed.message(),
  syncForm: M.syncForm.message(),
  anchorsNotIncreasing: M.anchorsNotIncreasing.message(),
  anchorOffSample: M.anchorOffSample.message(48000),
  driftTooLarge: M.driftTooLarge.message(),
  tooManyAnchors: M.tooManyAnchors.message(),
  wouldDiscardManual: M.wouldDiscardManual.message('מצלמה 2'),
  notSynced: M.notSynced.message('Cam B'),
  notCovering: M.notCovering.message('מצלמה 3', 12.5, 40),
  tooManyChanges: M.tooManyChanges.message(4612),
  tooManyCuts: M.tooManyCuts.message(),
  ambiguousTrack: M.ambiguousTrack.message(2),
  noProgram: M.noProgram.message(),
  pointForm: M.pointForm.message(),
  trackNotEmpty: M.trackNotEmpty.message('trk_x'),
  trackKind: M.trackKind.message('trk_x', 'audio'),
  newSequenceAndTrack: M.newSequenceAndTrack.message(),
  taggedClip: M.taggedClip.message(),
  assetInGroup: M.assetInGroup.message(2),
  motionTrackInGroup: M.motionTrackInGroup.message(1),
  tagsExist: M.tagsExist.message(14),
  notTagged: M.notTagged.message('clp_x'),
  notThisAngle: M.notThisAngle.message('clp_x', 'מצלמה 1'),
  lookForm: M.lookForm.message(),
  soundAngleLook: M.soundAngleLook.message('מיקרופון 1'),
  nothingToUpdate: M.nothingToUpdate.message(),
  wideNotPicture: M.wideNotPicture.message('מיקרופון 1'),
  speakerMic: M.speakerMic.message('מארחת'),
};
/** Refusals worded by another track's table on purpose (the same words as there). */
const ELSEWHERE: Partial<Record<MulticamRefusalKey, readonly RegExp[]>> = { notBuilt: SHORTS_REFUSAL_PATTERNS };

describe('Hebrew wording of the multicam refusals (ADR-0020)', () => {
  it('every refusal is worded in Hebrew by exactly one multicam pattern (or, on purpose, by another table), with its numbers kept; no pattern is left without a refusal', () => {
    expect(Object.keys(SENTENCES).sort()).toEqual(Object.keys(MULTICAM_REFUSALS).sort());
    const matched = new Set<number>();
    for (const [key, message] of Object.entries(SENTENCES) as [MulticamRefusalKey, string][]) {
      const he = translateRefusal('he', message);
      expect(he, `${key}: ${message}`).toMatch(/[֐-׿]/);
      expect(translateRefusal('en', message), key).toBeUndefined();
      const hits = MULTICAM_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      const elsewhere = ELSEWHERE[key];
      if (elsewhere) { expect(hits, key).toEqual([]); expect(elsewhere.filter((re) => re.test(message)), key).toHaveLength(1); continue; }
      expect(hits.length, `${key} is recognised by exactly one multicam pattern`).toBe(1);
      // and no earlier table catches it first: the wording shown is this row's
      const [re, say] = HE_MULTICAM[hits[0]!]!;
      expect(he, key).toBe(say(re.exec(message)!));
      matched.add(hits[0]!);
      expect(M[key].code, key).toMatch(/^[a-z_]+$/);
    }
    expect(MULTICAM_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    expect(translateRefusal('he', SENTENCES.notCovering)).toMatch(/12\.500.*40\.000/);
    expect(translateRefusal('he', SENTENCES.tooManyChanges)).toMatch(/4612.*4500/);
    expect(translateRefusal('he', SENTENCES.tagsExist)).toContain('14');
    expect(translateRefusal('he', SENTENCES.notSynced)).toContain('Cam B');
  });
  it('the refusals existing edits raise today are the ones the table words', () => {
    const v = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 't' } };
    let r = applyTransaction(createProject({ id: 'prj_w', name: 'W', frameRate: { num: 30, den: 1 } }), [{ op: 'import_asset', args: { asset: v } }, { op: 'import_asset', args: { asset: { ...v, name: 'b.mp4', contentHash: `sha256:${'b'.repeat(64)}` } } }], { idSeed: 'w_', actor: 't', allowInternal: true });
    const [A, B] = r.results.map((x) => x.output!.assetId as string) as [string, string];
    r = applyTransaction(r.doc, [{ op: 'add_clip', args: { assetId: A, start: T.ZERO, duration: T.rt(1, 1) } }], { idSeed: 'w2_', actor: 't' });
    const clipId = r.results[0]!.output!.clipId as string;
    const quality = (verdict: 'reference' | 'unsynced') => ({ verdict, peakZ: null, peakRatio: null, anchorsUsed: 0, anchorsRejected: 0, residualSamples: null, driftPpm: null, overlapSeconds: null, candidates: [], chainDepth: 0, jobId: null });
    const doc: ProjectDocument = structuredClone(r.doc);
    doc.multicam = { mcg_1: { id: 'mcg_1', name: 'G', sampleRate: 48000, referenceAngleId: 'ang_a', wideAngleId: null, speakers: [], origin: { method: 't', params: {}, createdAt: 'x', createdBy: 't', edited: false },
      angles: [{ id: 'ang_a', label: 'A', kind: 'picture', pieces: [{ assetId: A, anchors: [{ group: T.ZERO, source: T.ZERO }], quality: quality('reference') }] }, { id: 'ang_b', label: 'B', kind: 'picture', pieces: [{ assetId: B, anchors: [], quality: quality('unsynced') }] }] } };
    for (const t of doc.sequences[doc.mainSequenceId]!.tracks) for (const c of t.clips) if (c.type === 'media') c.multicam = { groupId: 'mcg_1', angleId: 'ang_a' };
    for (const [call, sentence] of [[{ op: 'remove_asset', args: { assetId: B } }, M.assetInGroup.message(1)], [{ op: 'replace_clip_media', args: { clipId, assetId: B } }, M.taggedClip.message()]] as const) {
      try { applyTransaction(doc, [call], { idSeed: 'w3_', actor: 't' }); throw new Error('not refused'); } catch (e) {
        expect(e).toBeInstanceOf(OpError);
        expect((e as OpError).message).toBe(sentence);
        expect(translateRefusal('he', (e as OpError).message)).toMatch(/[֐-׿]/);
      }
    }
  });
});

describe('shared strings of multicam', () => {
  it('both languages hold every key, and the dictionaries have them; the decided labels are exact', () => {
    expect(Object.keys(MULTICAM_EN).sort()).toEqual(Object.keys(MULTICAM_HE).sort());
    for (const lang of ['he', 'en'] as const) for (const k of Object.keys(MULTICAM_HE)) expect((dictionaries[lang] as Record<string, string>)[k], `${lang} ${k}`).toBeTruthy();
    expect(MULTICAM_HE['multicam.syncAndCut']).toBe('סנכרון וחיתוך');
    expect(MULTICAM_HE['multicam.thumbnail']).toBe('תמונה ממוזערת, לא חי');
    expect(MULTICAM_HE['multicam.onAir']).toBe('בשידור');
    expect(MULTICAM_HE['multicam.applyLookToAngle']).toBe('החל מראה זה על כל הזווית');
  });
  it('every verdict, skip reason, dropped kind and warning has a label in both languages', () => {
    const keys = [...SYNC_VERDICTS.map((v) => `multicam.verdict.${v}`), ...SKIP_REASONS.map((r) => `multicam.skip.${r}`), ...DROPPED_KINDS.map((d) => `multicam.dropped.${d}`), ...MULTICAM_WARNINGS.map((w) => `multicam.warn.${w}`), 'error.code.range_not_covered', 'error.code.would_discard_edits', 'error.code.not_built'];
    for (const lang of ['he', 'en'] as const) expect(keys.filter((k) => !(dictionaries[lang] as Record<string, string>)[k]), lang).toEqual([]);
  });
  it('the sync job\'s stages are worded, counts kept', () => {
    for (const s of MULTICAM_SYNC_STAGES) expect(jobStageLabel(multicamSyncStage(s, 2, 5), 'he')).toMatch(/^[֐-׿].* 2\/5$/);
  });
  it('the auto-switch says it is a heuristic and never claims to identify who is speaking', () => {
    for (const s of [MULTICAM_AUTO_LABEL, MULTICAM_EN['multicam.auto.heuristic']]) expect(s).toMatch(/heuristic/i);
    expect(MULTICAM_HE['multicam.auto.heuristic']).toMatch(/היוריסטיקה/);
    expect(MULTICAM_AUTO_LABEL).toMatch(/not speaker identification/);
    expect(MULTICAM_EN['multicam.auto.heuristic']).toMatch(/does not identify who is speaking/);
  });
});
