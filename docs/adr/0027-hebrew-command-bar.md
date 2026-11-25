# ADR-0027: Hebrew command bar — a model-free grammar now, a language model that only proposes

Status: **Accepted — built and verified on the CPU profile (see PROGRESS); the language-model path is built
only to its honest setup state** (2026-11-19). It reopens B-9 per the owner's approval of 2026-11-17.

## Context
- The owner asked for an in-editor command bar in Hebrew (B-9, reopened 2026-11-17). Every edit stays a
  registered op applied through `Store.commit` (ADR-0004); pictures come from `evaluate` (ADR-0005).
- The plan (`.artifacts/command-bar-plan.md`) came back "needs changes"; its Verifier section wins over its
  body. Lead decisions: `.artifacts/wave5-decisions.md` ("Hebrew command bar", "Command bar — lead decisions
  after the contracts review"). Provisional answers are listed for the owner in `docs/OWNER_REVIEW.he.md`.

## Decision
1. **A model-free grammar** in `packages/core/src/commandBar/`: listed inflections, the longest phrase wins
   («בטל» against «בטל השתקה» and «בטל בחירה»), exact rational times. «חתוך כאן» is a split at the playhead,
   with the trim readings shown as alternatives in the same list. «דקה ועשר» is 70 s (a bare number after a
   unit is the next smaller unit). A copied hh:mm:ss:ff lands on its own frame.
2. **Ambiguous requests ask; nothing is guessed.** «בשנייה 3» is 0:03, «בשנייה השלישית» asks. «הקול» alone
   is asked about (tracks or the clip) and offers no master option, because no op exists for it.
3. **The preview equals the commit.** The bar commits with a strict `commitExact` at the shown revision: one
   transaction, one undo. A stale preview (409) asks the owner to check again; no rebase applies something
   unseen. Undo goes by explicit transaction id.
4. **The bar lives inside the palette** (a combobox and listbox). Export opens the sheet; it never starts an
   export.
5. **Every refusal pairs the reason with a Hebrew next step** (and an English one).
6. **The model path is provider-neutral** (`packages/providers/src/chat.ts`). `ChatCapabilityDescriptorSchema`
   stays outside `DescriptorSchema` until a real adapter exists. No provider is picked and no network adapter
   is built.
7. **Allowlist summary** (`apps/server/src/assistant/summary.ts`). Birth dates, capture dates, events, file
   names, transcripts and media are never sent. Title wording, marker names, track names and people's names go
   only behind two switches, both off by default (track names sit behind `titlesAndMarkers`; off, tracks are
   given by kind and index).
8. **Propose-only principal with no token.** `principalForToken` refuses a stored grant named 'assistant'
   and logs a setup warning naming the grant id, never a token. `ASSISTANT_EXCLUDED_OPS` includes `add_cue`,
   `update_cue`, `merge_cues`, `set_caption_style` and `set_variant_phrase_text`.
9. **Spending.** A monthly limit plus a per-request cap, with prices typed by the owner and required to be
   greater than 0. Nothing is sent until both are set. `reserveAssistant` uses the same `budget_ledger`.
10. **A durable job** `assistant.propose`: no automatic retry after an uncertain send. A job found queued or
    running at start-up becomes failed `submission_unknown`; its reservation is released if nothing was sent,
    kept and marked uncertain if the send had started. Job cancel reaches assistant jobs.
11. **The key** lives in a 0600 file in the data directory, is never returned by a route or logged, and is
    kept out of backups (re-entered after a restore).
12. **Only intent ids are kept, never the typed text.** The op label is `Command bar: <intent>`. Collecting
    phrasings would need the owner's explicit consent and is not built.
13. Optional schema use only; no version bump.

## Note 2026-11-24 — who may cancel an assistant job
Decision 10 says job cancel reaches assistant jobs. It reaches them from the owner's own session only, through
`POST /jobs/{jobId}/cancel` and MCP `cancel_job` alike (one handler, `AssistantJobs.cancel`; `cancel_job` had no
dispatch for these jobs before). An agent credential is refused on both surfaces with 403 `owner_required`, whatever
its grant: the request is the owner's (their typed text, decision 12; their money, decision 9), it runs as
agent:assistant, which no token can be (decision 8), and ADR-0002's "agents may only cancel their own jobs" has one
exception, the owner's in-tab export, which is not this. The refusal gives the reason, the next step and the job id it
was asked about, and nothing of the request or of the job's state; the checks before it (edit scope, project in scope,
agents not paused, a grant that runs jobs) answer as for any job, so a credential learns no more than `get_job`
already tells it. Covered by `apps/server/src/assistant/mcpCancel.test.ts`. (On this date the editor had no control that
cancels a request; the row has «ביטול הבקשה» since 2026-11-25, see the next note.)

## Note 2026-11-25 — who reads an assistant job and its proposal; the cancel button
**Found.** `GET /jobs/{jobId}`, MCP `get_job` and the project's event stream answered an assistant job to any credential
that may observe the project: its output (the model's explanation, the proposal id, the cost) and its error text (which
can quote the service or the model). The proposals routes (list, by id, frame), MCP `list_proposals` and the `proposal`
event did the same for the assistant's proposal, whose operations can repeat what the owner typed. A finished assistant
job asked for at `GET /jobs/{jobId}/output` answered 500.

**Decision.** A request to the assistant is the owner's own, and so are the job it runs and the proposal it leaves: they
are whole only for the owner's own session. Every other principal, whatever its grant (observe, propose, edit, autopilot,
people 'full'), reads of an assistant job its id, project, type, actor (always agent:assistant), status and times, and
nothing else; the assistant's proposals are not listed for it, answer 404 by id exactly as an id that does not exist, are
not rendered and are not announced in its event stream. Accepted, a proposal's operations become ordinary edits of the
project, read like any other. One module decides it for every surface (`apps/server/src/assistant/visibility.ts`);
`apps/server/src/assistant/jobPrivacy.test.ts` plants words in the typed text, the MOCK adapter's explanation, its
operations and two error texts and walks every REST route, the MCP tools that read or name a job or a proposal, every
resource and the event stream with seven kinds of credential. `GET /jobs/{jobId}/output` answers 404 for a job that has
no file.

**What a job row keeps of a request** (decision 12 holds: never the typed text). `input`: the kind, who asked, the
revision, the sequence, a SHA-256 and a character count of the typed text, a SHA-256, byte count and the two switches of
the summary, the prompt digest, adapter, host, model, token cap, the estimate and the reservation. `output` of a
successful job: the proposal id, the model's explanation (at most ASSISTANT_EXPLANATION_MAX characters, the key
redacted), the operation count and the cost. `error`: a code and a sentence; for a service error the sentence can quote
the service (key redacted), for an answer that is not valid it is fixed (see below). The proposal row holds the
operations. All of these are in the database while they last, so in a backup made then; a project archive holds no job and no proposal. The digest of a short typed request could be matched
by guessing; it is not returned by any route.

**The sentence at rest (built 2026-11-25, lead decision).** The model's explanation can repeat what the owner typed, so
it lives in the job row only while its proposal can still be decided. `Governance.decide` clears it in the same database
transaction as the decision (accepted, rejected, or stale when the accept finds the project changed); the job is found by
the proposal id its output carries. A cancelled request never stores an answer. Deleting a project removes its jobs and
proposals. In each case the bytes leave the files too (`Store.erasing`: SQLite secure_delete for that write, then the
write-ahead log folded into the database and cut), so no backup made afterwards holds them; what a filesystem or a disk
keeps of freed blocks is not promised. The owner's tab that already showed the sentence keeps showing it until the
decision; a tab that never polled shows the proposal's steps without a sentence (the row has no empty line for it).
An answer that is not valid is stored as a category (`validate.ts` INVALID_ANSWER_CATEGORIES) and a fixed sentence: no
operation name, key or value of the answer is kept, for the owner either. A service error text stays: the owner needs it
(a refused key, a rate limit) and it is the service's sentence, not the model's answer. The MOCK adapter echoes nothing
it is not scripted to; no network adapter exists in this build, so whether a real service quotes the request in an error
cannot be checked here. An adapter, when one is built, should pass on the service's status and code, not its body.

**Stated plainly: a backup made while a proposal is pending holds its sentence** (and the proposal's operations), because
the backup is a copy of the database as it is. To keep it out, decide the proposal (or cancel the request) before backing
up. Pending assistant output is NOT excluded from backups as the key file is: the copy is a verified snapshot of the
database, and a restored project would otherwise show an open proposal with nothing behind it.

**Still at rest.** A rejected or stale proposal's row keeps its operations, entity states and summary (so does every
agent's proposal); only the owner's session reads the assistant's. The digest of the typed text stays in the job's input.

**The cancel button.** The pending assistant row has «ביטול הבקשה» for the owner's session (POST /jobs/{jobId}/cancel),
reachable with Tab from the palette's input. The row then says what the cancel did, from the job's own attempt count:
canceled before anything was sent (nothing charged), or after the request had been handed to the service (it may have
been charged; its reservation stays counted). The agent's `owner_required` refusal now names the button.
`pnpm proof:command-bar` 11f drives it against the labelled MOCK adapter holding its answer back: contract-tested, never
a claim about a real provider.

## Consequences / what is not promised
- Without a provider the assistant row says it is not connected («עוזר השפה לא מחובר»). Nothing is fabricated.
- The lexicon covers listed phrasings only; there is no corpus of how the owner speaks.
- «סנכרן לקצב» always offers the choice in wave 1. Default title length is the editor's own constant.
- Hebrew wording is unreviewed by a speaker.

## Verified / not verified
- `pnpm proof:command-bar`: 23 pass, 5 contract-tested against a labelled MOCK adapter (credentials
  required), 0 fail (`docs/evidence/command-bar-proof.json`). Editor interactions 70/70. Accessibility audit
  0 findings in Hebrew and English (new states command-bar-preview, command-bar-choices,
  assistant-settings). Test-id inventory +24, none lost. 0 outbound connections in the whole proof.
- A planted test key appears in none of 508 responses and no log line; the key file is 0600; backups hold no
  assistant files.
- Faults found and fixed during integration: `deleteOps` dropped selected clips not on the main video track;
  the bar's rows were clipped by a design-system class name; the assistant row was a disabled option inside
  the listbox; the live region sat inside the listbox; the assistant row polled forever on
  submission-unknown; the "clips that will move" note read the wrong field; restart recovery's wording for a
  settled reservation was wrong; job cancel did not reach assistant jobs.
- Not verified: a real provider, a screen reader, the owner's own phrasing, Hebrew wording reviewed by a
  speaker.
