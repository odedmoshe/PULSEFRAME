/**
 * B1's tests of the qc rules (qcChecks.ts; .artifacts/wave8/qc-b1.md). Named after the plan's checks and the verifier's corrections;
 * every one fails before its rule exists. Times compared exactly (BigInt / T.cmp), never as float seconds.
 */
import { describe, it } from 'vitest';

describe('documentChecks — flash_clip (C10)', () => {
  it.todo('Q1: a 2-frame clip between two longer clips at 30 fps is one warning with measured {frames: 2, minFrames: 3}, its range and no fix');
  it.todo('Q2: a 3-frame and a 4-frame clip are not flagged; at 60 fps a 5-frame clip is (minFrames 6)');
  it.todo('a short clip fully under a covering clip, or inside a transition overlap, is not flagged');
  it.todo('the generators never trip it: perform take, family film, growing-up holds, beat montage, and every built-in template\'s apply_template result');
});
describe('documentChecks — held_past_picture (C1)', () => {
  it.todo('Q3: an asset whose duration is its sound (frameCount + startFrames < duration·fps) held for 2.5 s gives one note with heldFrames 75 and the first held frame pinned exactly');
  it.todo('the first held frame is pinned for forward, reversed and 2× clips with exact BigInt comparisons, in the FILE\'s frame rate (not the project\'s)');
  it.todo('a late picture start (video.startTime > 0) holds the first picture: a note with atStart 1 and no fix');
  it.todo('the forward fix trims the picture alone (includeLinked: false); applying it removes the issue; one undo restores the document hash');
  it.todo('a ramped clip (speedEnd) is skipped and named, not flagged');
});
describe('documentChecks — title_hidden (C3)', () => {
  it.todo('Q4: a title under an opaque full-frame video for its whole length is one warning with ids [title, coverer]; moved above it, none');
  it.todo('a coverer with key.chroma, motion.shake/sway/spin or distort.* does not cover; one with only color.* / blur.gaussian / stylize.grain does');
  it.todo('frames inside an incoming transition span of the coverer are never covered, so a title shown through the transition is not hidden');
  it.todo('a partly covered title is not flagged (whole length only)');
});
describe('documentChecks — ends_mid_word / cut_mid_word (C5)', () => {
  it.todo('Q10: the film ending ≥ 1 frame inside a word is one ends_mid_word warning; a cut on a word edge mid-film gives no cut_mid_word; 2 frames inside gives one note');
  it.todo('a sound clip ending with fadeOut, or a volume key near 0 at that edge, is excused');
  it.todo('a razor split (same asset, sourceIn = previous sourceEnd, same speed, back to back) is not a cut');
  it.todo('timing "segment" is skipped and named (segment_timing); approximate word times give a note only, with approximate: 1');
  it.todo('a derived copy with sourceRangeStart maps word times through lineage (transcriptFor); an untimed copy is skipped and named (untimed_copy)');
  it.todo('no issue message quotes a transcript word (C5)');
  it.todo('more than 20 cut_mid_word issues are listed as 20 rows plus one summary row');
});
describe('documentChecks — properties', () => {
  it.todo('random documents from the ops-fuzz generator never throw; every range lies inside the film; built is true');
  it.todo('Q11: the clean control document has no qc issue; Q14: on a variant and on a short each range is in that output\'s own frames');
  it.todo('Q17: one timing sample on a synthetic 10-minute, 600-clip document is recorded (not gated)');
});
describe('explainFindings (C6, C9, C14)', () => {
  it.todo('Q6: a black run wholly inside a dip-black transition span is dip_transition');
  it.todo('Q5: a black run at the end within the frames where the fading clip\'s opacity is < 1 plus at most 0.5 s is fade_edge; a 20 s black clip after the fade is not (C9)');
  it.todo('a title\'s own entrance or exit animation at the edge counts for fade_edge; a gap at the very start is not explained (it is empty_picture)');
  it.todo('Q7: a silence wholly inside a freeze clip\'s span is freeze_hold');
  it.todo('a frozen run inside a held_past_picture run is picture_ends; one where a source frame lasts ≥ 2 s (1/(file fps·speed)) is slow_speed; one on a derived asset whose source is an image is still_source');
  it.todo('it never removes, reorders or changes the measured numbers of a finding, and only uses a reason for the kind EXPLAINED_FOR names');
  it.todo('the same input gives the same output on the export, the fast export and the loudness route (Q13, K4)');
});
