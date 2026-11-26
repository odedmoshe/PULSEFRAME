/**
 * proof:understand — «מה יש בקליפ» end to end (wave 8 understand). PRE-PASS STUB: the checks are named here, in order, from
 * understand-plan.md §5 as corrected by understand-verify.md (C2 sourceTimeOfFrame, C3 the proxy's own start, C6 the import commit,
 * C7 one batched «אוטומטי» commit and undo by transaction id, C8 notes to agents in both modes, C9 «F1-210» and a year on screen,
 * C10 pages, C12 resume by key frames) and the lead's decisions (frames per span, minimum span, no auto re-describe). Split at
 * integration into understand-proof.core.ts (W1), understand-proof.server.ts (W2) and understand-proof.ui.ts (W3) behind this aggregator.
 * Fixtures made by ffmpeg at proof time (≈ 3 MB, deleted at the end): U1 30 fps 640×360 25 s with hard cuts at frames 150 and 270 and
 * the chroma barcode of packages/fixtures film.ts carrying clip<<12|frame; U2 the same with the picture 0.5 s late (-itsoffset); one PNG
 * photo; one sound-only file; a typed Hebrew transcript for U1. The describer is the LABELLED test double (TEST-DOUBLE-describer/1,
 * family mock-scripted, every caption starting «כפיל בדיקה» / "TEST DOUBLE") placed in an agent provider's slot through
 * startServer({ agent: { adapters } }) on port 0. Nothing is claimed about any real model. Laptop rows L1–L11 choose the default model.
 * Until UNDERSTAND_BUILT.job and .routes it prints every check as todo and exits 2 (blocked: not built).
 * Run through /home/user/PULSEFRAME/.artifacts/heavy. Evidence: docs/evidence/understand-proof.json.
 */
import { UNDERSTAND_BUILT } from '@pulseframe/core';

export const UNDERSTAND_PROOF_CHECKS = [
  '1 importing U1 with auto on: analyses.scenes has cuts at exactly frames 150 and 270, committed by server:understand in one commit for the pass; U2\'s cuts measured on the proxy with the proxy\'s own start land on its real cut frames (C3)',
  '1b the same file imported into a second project is measured from the import commit (no derivative event, C6); a start while the job runs joins it',
  '2 with describer none: get_shots lists 3 shots; understandSpans at density 10 and minSpan 2 gives [0,150) [150,270) [270,510) [510,750), keys at their middles; the state is shots_only with the honest setup line',
  '3 with the test double (3 frames per span, one request each): every stored span\'s barcode-read frames equal its keys in order, for U1 and U2 (the exact frames reached the describer)',
  '4 span times from describe_clip (rational) equal sourceTimeOfFrame(asset, start) exactly, for U2 including the picture\'s start (C2)',
  '5 the photo gets one span (decoded from the original); the sound-only file is skipped no_picture and gets no pointer',
  '6 one job attaches all pointers in ONE revision by server:understand, shown «אוטומטי»; «ביטול התיאורים» (undo by that transaction id) restores the analyses exactly; after a hand edit of that file\'s scenes the undo is refused undo_conflict (C7)',
  '7 the server killed after 3 spans and restarted resumes; the double\'s counter shows at most the span in flight described twice and that call\'s first ledger row is unknown (C12)',
  '8 a double reply with an extra key / no caption / a non-Hebrew captionHe / finish length: failed invalid_reply, the field dropped, failed reply_cut; the stored notes hold none of the planted strings',
  '9 search «כחול» finds exactly the blue span (sources [seen]); «F1-210» finds the span holding frame 210 (onscreen); «2025» written on screen is found though it parses as a year (C9); a word in no span finds nothing in the notes section',
  '10 an agent\'s find_in_footage gets the notes section, in open and in guarded mode (C8)',
  '11 describe_clip: pages of 20, ended early at 16 KB with next; one caption language per row; said only with withSaid; get_shots paged with each shot\'s first caption (C10)',
  '12 another model (a new producer) makes the state stale_model; old notes are still found, labelled with the old model; nothing re-describes by itself',
  '13 hand-edited scene cuts make the state shots_changed; the job never overwrites them',
  '14 an export started during the job finishes while the job waits (no describe call during it)',
  '15 cancel stops at a span boundary; nothing is attached; the scratch rows stay and the next run sends no call for those key frames',
  '16 the settings round-trip and are backed up; a provider not connected is describer_not_connected; a cloud row without vision is describer_no_vision; the describe request has no tools and no temperature, max tokens 800, one ledger row per call',
  '17 UI (headless Chromium): «מה יש בקליפ» renders the spans in order with «תיאור של … · לא נבדק»; keyboard path; RTL; the search section «לפי מה שתואר»; Settings block; the activity row says «אוטומטי»',
] as const;

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = UNDERSTAND_BUILT.job && UNDERSTAND_BUILT.routes;
  for (const c of UNDERSTAND_PROOF_CHECKS) console.log(`${built ? 'TODO-WRITE' : 'todo'} ${c}`);
  if (!built) { console.log(`\nproof:understand — blocked: the describe job and the routes are not built in this build (${UNDERSTAND_PROOF_CHECKS.length} checks named)`); process.exit(2); }
  console.error('proof:understand: the checks are named but not written yet (W1/W2/W3)'); process.exit(1);
}
