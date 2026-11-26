/** Builder W3: the dialog's queue, progress, keyboard and report box (plan checks 12, 14; verify C5, C9). */
import { describe, it } from 'vitest';

describe('booth dialog logic (builder W3)', () => {
  it.todo('the first screen says «חלק ראשון: 0 מתוך 14» (BOOTH_FIRST_SITTING_CARDS), never a larger total; «עוד» opens the more.* groups only after the first part or on request');
  it.todo('queue order: boothFirstOrder(row browser-gpu) for the first sitting; inside a group unanswered and changed first, then skip (oldest first), answered last');
  it.todo('keys by e.code (Digit1 ok, Digit2 bad with focus to the first problem, Digit3 skip, KeyR again), inert while typing and outside the dialog; no keyboard focus moved in a later task (deferredFocus.test.ts rule)');
  it.todo('progress «נבדקו n מתוך m» counts answered and not changed; changed (recipe, played, adapter) counts as unanswered with its own words');
  it.todo('browser rows survive a closed Chrome in localStorage (try/catch, renders without it); the step says how to reopen the editor (booth.reopen)');
  it.todo('the report box shows exactly boothReport(...) and «העתקת הדוח» copies exactly that text; the notes warning and the name warning are shown');
  it.todo('the rail button and the palette command exist only for the owner\'s own session (isOwnerActor)');
});
