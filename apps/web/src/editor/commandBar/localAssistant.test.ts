/**
 * The local language assistant in the editor (wave 7; .artifacts/wave7/assistant-decisions.md §5 builder C): the rows builder C makes pass.
 */
import { describe, expect, it } from 'vitest';
import { COMMAND_BAR_TESTIDS as TID } from './commandBar.testids.ts';
import { BAR_EN, BAR_HE } from './commandBar.strings.ts';
import { LOCAL_UI_BUILT } from './localAssistant.logic.ts';

describe('the local assistant\'s contract in the editor', () => {
  it('has its test ids and its Settings words in both languages', () => {
    for (const k of ['assistantLocalSettings', 'assistantLocalPort', 'assistantLocalCheck', 'assistantLocalAsk', 'assistantLocalInsert', 'assistantLocalBadge'] as const) expect(TID[k]).toBeTruthy();
    for (const k of Object.keys(BAR_HE).filter((k) => k.startsWith('set.local.') || k.startsWith('row.local.'))) expect((BAR_EN as Record<string, string>)[k], k).toBeTruthy();
    expect(BAR_HE['set.local.check']).toBe('בדיקת חיבור');
  });
  it('is not built yet', () => { expect(LOCAL_UI_BUILT).toBe(false); });
  it.todo('Settings: choosing «מודל מקומי על המחשב הזה» hides host, model, key, prices, limits and the data switches, shows port (default 8791), time limit (default 60), «בדיקת חיבור» with its state in words, the reported model name, the «לא נמדדו» note and the guide link; invalid numbers show set.local.invalid and nothing is saved');
  it.todo('the row offers «לשאול את העוזר המקומי» only under an unknown result, and only when the owner\'s status is ready with the local adapter');
  it.todo('stages in words (waiting-for-compute, awaiting-local-model), never a percentage; «ביטול הבקשה» as today; local failures show the Hebrew sentence and no money words and no «שחרור הסכום השמור»');
  it.todo('«הכנס לשורה» sets the input to the phrase with the caret at the end, shows the badge until the first edit, calls taken once; «התעלם» calls taken; the phrase is one dir=auto span');
  it.todo('the inserted phrase runs through the bar\'s own interpret and preview; Enter commits through commitExact only; intent none shows assistant.local.none and no button; a dropped slot shows assistant.local.dropped');
});
