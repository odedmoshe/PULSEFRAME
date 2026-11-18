/**
 * pnpm proof:command-bar — the Hebrew command bar (ADR-0027; .artifacts/command-bar-plan.md §9 as corrected by its verifier and
 * the lead's decisions). LEAD: the entry point and the list of checks; the checks are built once W1 (core commandBar/), W2
 * (apps/server/src/assistant/) and W3 (apps/web/src/editor/commandBar/) are merged. Until then it runs nothing and exits 2
 * (blocked), the exit code the proofs use for "cannot run here", never a pass. Writes docs/evidence/command-bar-proof.json when built.
 *
 * The server runs in-process on a fixture project (three video clips with handles, one without, an image, a music track with a
 * beat analysis, one person with a birth date, an event); headless Chromium drives the editor for the UI checks.
 *  1 owner examples: «חתוך כאן», «מחק את הקליפ», «הוסף כותרת "יום הולדת 5" בשנייה 3», «הגבר את המוזיקה ב־3 דציבל»,
 *    «הוסף מעבר בין כל הקליפים» plan; «סנכרן לקצב» asks; «ייצא לוואטסאפ», «בטל», «עבור למצב הופעה» act; and their English
 *    twins; the plans' canonical ops equal the golden files.
 *  2 exact time: 60 phrases × 24, 25, 30000/1001, 30, 60 fps equal the integer oracle; «בשנייה 3» at 30000/1001 stores frameTime(90).
 *  3 what is shown is what runs: sha256 of the previewed ops (data-plan-hash, window.__pfBar.lastPlan) = the committed transaction's.
 *  4 one request = one transaction: revision +1, one history entry labelled «Command bar: <intent>» without the typed text.
 *  5 one undo: the document hash after Ctrl+Z equals the hash before (transitions on N clips, ripple delete included); redo
 *    equals after; Store.replay equals the stored document.
 *  6 never guessed: 30 ambiguous or unknown requests, 0 commits, each with «הבנתי», its unread words and a choice or nearest command.
 *  7 stale: plan at r, an agent edits, Enter gives 409 with nothing applied and a new preview; the second Enter commits on r+1.
 *  8 double Enter: one transaction, the second replayed.
 *  9 same path: the planned ops with the propose-mode token give a proposal, with the observer token 403.
 * 10 not connected, honestly: status provider_not_configured, the row «עוזר השפה לא מחובר», POST …/assistant/requests 409 with
 *    no job row, and 0 outbound connection attempts during the whole proof.
 * 11 the model path with the labelled MOCK adapter (contract-tested, credentials required — never reported as live): a valid
 *    answer gives an open proposal and accept/undo; 9 invalid answers give invalid_model_output and no proposal; 10¢ limit with
 *    a 12¢ estimate gives 402 with 0 adapter calls; unknown_after_send gives submission-unknown, ledger unknown, no second call;
 *    the bytes handed to the adapter hold none of the planted private strings.
 * 12 credential: no response or log line holds the planted test key; an agent PUT gives 403; the key file is 0600; a backup
 *    made during the proof has no assistant.key.
 * 13 accessibility and keyboard: the audit scenario keyboard-only through a11y-audit.ts; aria-activedescendant names the bar row;
 *    the live region holds «בוצע: …»; focus returns to open-palette.
 * 14 determinism: the same text and context give the same plan hash in Node and in the browser.
 * Not provable here: a real provider (no key exists), a screen reader, the owner's own phrasing.
 */
console.error('command-bar-proof: not built yet (ADR-0027); nothing was measured');
process.exit(2);
