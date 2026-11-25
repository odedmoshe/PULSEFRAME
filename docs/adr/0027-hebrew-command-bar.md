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
already tells it. Covered by `apps/server/src/assistant/mcpCancel.test.ts`. The editor has no control that cancels a
request yet (the wording «ביטול הבקשה» exists, unused): the owner cancels through their session's REST or MCP.

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
