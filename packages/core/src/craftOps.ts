/**
 * The craft ops (wave 7 craft track; craft-decisions.md §4). Registered on import of this module (index.ts exports it). The lead's
 * pre-pass fixes names, versions, argument schemas and outputs (craftContract.ts). The apply bodies are W1's: until then each
 * REFUSES with CRAFT_REFUSALS.notBuilt and changes nothing; CRAFT_OPS_BUILT turns the fuzz rows on.
 *
 * RULES OF THE BODIES (craft-plan.md "Corrected" C1, C3, C4)
 * - ripple_trim: by = new length − old length of the named clip. by > 0 (end edge, longer): shiftClips first, then trim_clip
 *   through the registry; by < 0: trim_clip, then shiftClips; by = 0: rippleNoChange. Start edge only later than the clip's start
 *   (rippleStartLonger); the trimmed clip is in the moving set. Closing track = the named clip's track only; linked clips follow
 *   their partner (shiftClips). Words: RIPPLE_TRIM_WORDS. Output RippleTrimOutput.
 * - paste_attributes: per (target, group) the existing ops through the registry; a refused pair is put back exactly (the target
 *   and its linked clips copied before each attempt) and listed in skipped with the op's code; source_empty never clears;
 *   transform onto keyed x/y/scale/rotation/opacity without 'animation' → target_animated; effects of a group replaced in source
 *   order at the first removed one's place (effectSlot keeps a time effect first); keys past the target's end left out and
 *   counted; always the master document. Nothing applied anywhere → pasteNothing; source among targets → pasteSourceIsTarget.
 * - replace_text: each edit's place must hold exactly `was` (replaceChanged) and be named once (replaceTwice); limits by
 *   carrierLimit (replaceTooLong); empty → replaceEmpty; a title's {…} field tokens unchanged (replaceFields). title → update_text;
 *   cue → its own body (same word count: words renamed in place; else words dropped and listed); phrase → correct_transcript;
 *   override → set_variant_override; variantPhrase → set_variant_phrase_text (a reviewed translation is listed in reviewAgain).
 */
import { defineOp } from './ops.ts';
import { craftRefusal, PasteAttributesArgsSchema, ReplaceTextArgsSchema, RippleTrimArgsSchema } from './craftContract.ts';

const notBuilt = (op: string) => () => { throw craftRefusal('notBuilt', { op }, op); };

defineOp({
  name: 'ripple_trim',
  version: 1,
  description: 'Trim one edge of a clip to a frame-aligned time and close up its track (ripple trim; the editor sends it for Q and W). The start edge may only move later (the head of the clip goes and everything after it moves earlier by that much); the end edge may move either way (later clips move by the change). Only the clip\'s own track closes up; a clip linked to one that moves moves with it. Titles, music, captions and markers on other tracks stay where they are. Refused, changing nothing, as trim_clip refuses, and when linked clips would move by different amounts, a linked clip would move before 0, or a moved clip would land on one that stays. trim_clip trims without closing up.',
  args: RippleTrimArgsSchema,
  apply: notBuilt('ripple_trim'),
});
defineOp({
  name: 'paste_attributes',
  version: 1,
  description: 'Copy groups of attributes of one clip onto other clips: colour (colour effects), effects (the other effects, blend mode, mask), transform (position, scale, rotation, opacity), animation (transform keys, a title\'s letter animation), sound (gain, fades, volume keys, sound effects), titleStyle (a title\'s style). Each group REPLACES the target\'s, never merges; a group the source has nothing in changes nothing. A pair the target cannot take is left out and listed in output.skipped with the reason; the rest is applied in one step. Refused when nothing could be applied anywhere.',
  args: PasteAttributesArgsSchema,
  apply: notBuilt('paste_attributes'),
});
defineOp({
  name: 'replace_text',
  version: 1,
  description: 'Replace the whole text of named places (title, caption cue, transcript phrase, a format\'s wording) in one step, as find_text planned them. Each place must still hold `was`, else nothing is written. A caption keeps its word timing when its word count is unchanged; a phrase whose word count changes gets estimated word times; a reviewed translation that is reworded needs review again (all listed in the output).',
  args: ReplaceTextArgsSchema,
  apply: notBuilt('replace_text'),
});
