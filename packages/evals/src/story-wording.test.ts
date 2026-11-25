/**
 * Keeps the Hebrew wording of the story refusals (packages/i18n/src/story.ts HE_STORY) in step with the fixed English of core
 * storyContract.ts (STORY_REFUSALS, STORY_BLOCKING_TEXT) and apps/server/src/story.ts (STORY_API_ERRORS): every sentence is worded
 * in Hebrew with a next step, no pattern is unused, the shared strings exist in both languages and say nothing forbidden.
 * The server's propose, ages and not-built refusals are provoked for real in apps/server/src/storyContracts.test.ts. The planner's
 * own refusals come from the table until W1's planStory exists; W1 then provokes each through planStory (it.todo below; W1 may
 * edit only those todo lines of this file).
 */
import { describe, expect, it } from 'vitest';
import { STORY_BLOCKING_TEXT, STORY_DRAFT_LABEL, STORY_FORBIDDEN_WORDS, STORY_FORBIDDEN_WORDS_HE, STORY_REFUSALS, VOICE_LABEL } from '@pulseframe/core';
import { STORY_API_ERRORS } from '../../../apps/server/src/story.ts';
import { dictionaries, STORY_EN, STORY_HE, STORY_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const core = [
  STORY_REFUSALS.narrationMissing.message(), STORY_REFUSALS.narrationNotSound.message(), STORY_REFUSALS.narrationTooLong.message(),
  STORY_REFUSALS.nothingToShow.message(), STORY_REFUSALS.badParams.message('assetIds: Too small'), STORY_REFUSALS.notBuilt.message(),
  ...Object.values(STORY_BLOCKING_TEXT),
];
const E = STORY_API_ERRORS;
const server = [E.notBuilt(), E.propose(), E.ages(), E.blocked(STORY_BLOCKING_TEXT.narration_removed, []), E.runNotFound('run_x'), E.badParams(), E.keyClash('m000000000000'), E.retap()];
const all = [...core, ...server.map((e) => e.message)];

describe('story refusals in Hebrew', () => {
  it('every sentence is worded, in Hebrew, with a next step, and none falls back to the generic words', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, fallback: /לא עבר בדיקה/.test(he!) }).toEqual({ en, fallback: false });
      expect({ en, nextStep: /[.:;—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of HE_STORY is used by some sentence, and each sentence is answered by the story table (not an earlier one)', () => {
    expect(STORY_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en))).map(String)).toEqual([]);
    for (const en of all) expect({ en, ours: STORY_REFUSAL_PATTERNS.some((re) => re.test(en)) }).toEqual({ en, ours: true });
  });
  it('the error codes and shared strings exist in both languages and say nothing forbidden', () => {
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      const missing = ['story.name', 'cmd.openStory', ...server.map((e) => `error.code.${e.code}`).filter((c) => !['error.code.insufficient_scope', 'error.code.people_scope_required', 'error.code.not_found'].includes(c))].filter((k) => !d[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
    expect(Object.keys(STORY_EN).sort()).toEqual(Object.keys(STORY_HE).sort());
    for (const s of [...Object.values(STORY_HE), ...Object.values(STORY_EN), STORY_DRAFT_LABEL.he, STORY_DRAFT_LABEL.en, VOICE_LABEL.he, VOICE_LABEL.en, ...all.map((en) => translateRefusal('he', en)!)]) {
      expect({ s, en: STORY_FORBIDDEN_WORDS.test(s) }).toEqual({ s, en: false });
      expect({ s, he: STORY_FORBIDDEN_WORDS_HE.test(s) }).toEqual({ s, he: false });
    }
  });
  it.todo('W1: narrationMissing, narrationNotSound, narrationTooLong, nothingToShow and badParams are provoked through planStory and equal the table');
  it.todo('W1: narration_removed and kept_narration_not_followable are provoked through a regeneration and equal STORY_BLOCKING_TEXT');
});
