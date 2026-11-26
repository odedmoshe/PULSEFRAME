# ADR-0036: Autonomy first — one server mode, open by default

Status: **Accepted (lead, 2026-11-26); Part 1 built and merged (bfc8773).** `pnpm proof:autonomy` 26/26 in one run on the builder's branch; `proof:phase5` 34/34 in guarded mode. Supersedes, as policy, the earlier "agents see names only", "local models only" and "owner-only" rules wherever they were policy and not a security floor. Authority: the owner's decisions of 2026-11-26 (`docs/BLOCKERS.md`), `CLAUDE.md` "Product scope". Inventory of the gates: `docs/design/GATES_INVENTORY_2026-11-26.md`.

## Context
The owner wants agents to do everything the editor's own window does, with no approval steps unless the owner switches one on. About 80 policy gates (inventory `docs/design/GATES_INVENTORY_2026-11-26.md`) refused, narrowed or asked. Nine security floors must stay.

## Decision
1. One server mode, `open` (default) or `guarded` (the behaviour before this ADR, byte for byte for every real credential). Start-up: `PF_MODE` when set, else the owner's stored switch (`<dataDir>/autonomy.json`, 0600), else `open`. `GET /api/v1/autonomy` (any credential) says the mode and what it means in Hebrew and English (`packages/i18n/src/autonomy.ts`); `PUT /api/v1/autonomy` is the owner's own session only, in both modes.
2. The mode travels on the credential: `Auth.authenticate` stamps `open: true` on an agent credential that may already edit (the built-in agent token, which then acts in autopilot; a grant in mode edit/autopilot). The observer token, observe/propose grants and the in-memory command-bar assistant are never stamped. A switch reaches the next REST or MCP request; it ends every non-owner SSE stream (`event: mode`) and MCP listen handler, so clients reconnect under the new mode (C4).
3. ONE policy predicate, `actsAsOwner(p) = p.open === true || (p.kind === 'user' && p.actor === 'user:local')`. Every policy site reads it (table `OPEN_GATES` in `apps/server/src/autonomy.ts`). A SEPARATE floor predicate, `isOwnerFloor(p)`, never reads `open` and is read at exactly seven sites (`FLOOR_SITES`): grant creation and revocation (governance and the REST door), the mode switch, the language assistant's key and endpoint, the phone codes (drop door and import routes). Host/Origin/SameSite, the render worker's token and "asset ids only, never a path" read no owner predicate and are unchanged. `autonomy.test.ts` walks the source and fails if a floor site reads the policy predicate, if `isOwnerFloor` appears off the list, or if a raw owner check remains at a policy site.
4. Kept as the owner's in both modes (`ownerKeeps`): pause/resume agents (the brake; an open agent still gets 423 while paused), deciding proposals, deciding approvals. Grant limits (projects, tracks, range, exports/day, requests/minute) still apply to an open grant: they are switches the owner set.
5. Money: an open agent without a budget of its own reserves on the existing `budget_ledger` under `open-agents`, unlimited unless the owner sets `agentBudgetCents`; a grant with its own budget keeps it (C13).
6. Warn, not refuse, for open callers: the first-run frame cap and the long-run confirmation become `admissionWarnings` on the job; the agent AI caps (2 queued, 300 frames) do not apply; `admittedOpen` is recorded in the job input at admission (C2: not keyed on the actor prefix).
7. Every formerly owner-only action an agent needs has an MCP tool calling the REST route's own server function: `start_model_download`, `get_speech_engine`, `install_speech_engine`, `list/save/restore/rename/delete_version`, `get_storage`, `collect_storage`, `derive_lesson`; stills via `export_project` options.still; `get_controls` reports `serverMode`, `actsAsOwner`, `people: full`.
8. Unchanged: every edit is a registered op through `Store.commit` (undoable); results are validated; nothing is fabricated; pinned SHA-256 and disk margin on downloads; consent statement for a reference voice (now attested by the agent's actor when an agent gives it); the 9 floors.

## Consequences
- An agent may now: undo the owner's edits, cancel any job, delete a project and unreferenced media, rename/delete versions, read birth dates and write them, export films with ages and full-size stills, download models, install the speech engine, spend without a ceiling unless one is set. Deletions of versions, media and projects are not ops and cannot be undone.
- Existing suites run `guarded` (`vitest.config.ts` `PF_MODE=guarded`; every proof script loads `packages/evals/src/proof-mode.ts`). `PF_MODE=open` runs any proof open; `proof:autonomy` runs both modes itself. Test fixtures that named the owner `user:owner` were renamed `user:local` (splice, familyFilmContracts).
- Not yet opened (W rows reading the server mode at admission): D1 model hosts, D5 ComfyUI remote, D6 assistant host allow-list, D8 egress, H1/H2/H3/H6 licence refusals, E2/E3/E5 (cut for v1 by the verifier), I9 upload cap, I11 narration batching. Flash (G1) is its own track.
- Windows: `autonomy.json` is 0600 on POSIX; on Windows its protection is the data folder's ACL (as for the assistant key).

## After the merge (lead, 2026-11-26)
- Floor sites added when the in-editor agent's and the sources track's contracts met this ADR on the main branch: a model
  provider's key and base URL (`agent/routes.ts`, C9b) and a source connector's key or contact line (`sources/routes.ts`, C9c).
  The source-walk test (`apps/server/src/autonomy.test.ts`) lists every floor site by its exact text.
- The warn-instead-of-refuse rows are built and merged (D1 model hosts, D5 a ComfyUI on another computer, D6 the assistant's
  host, D8/H1 egress and licences, H2 the search model's licence, I9 the upload cap, I11 narration batches): one server-mode
  predicate, `warnsOpen`, read at admission at 14 sites listed in `OPEN_GATES` (pinned by the source walk). In open mode the
  action goes ahead and says so three ways (`openWarnings` on the job, `warnings` in the route's answer, `openWarnings` in
  `get_controls`); guarded mode refuses as before. Facts still refuse in both modes: https on every hop, pinned sizes and
  digests, a model with no source or no pinned digest, a changed code or graph digest, the disk reserve and the storage ceiling.
  A result made under a licence warning carries `derived.modelLicences` and its export shows the existing non-commercial warning.
  `pnpm proof:autonomy` 32/32 in one run on the builder's branch. Not built: the editor does not show `openWarnings` yet; no
  end-to-end test of a local tool's result carrying the licence mark.
- Licences: ONE rule is the aim (a licence finding is a warning quoting the licence's own deed; refusals only for data facts).
  The library's fail-closed refusal of share-alike, no-derivatives and unknown licences (ADR-0029 §6) and the archive's exclusion
  of such files are re-decided with those rows.
- **Part 2, the in-editor agent «סוכן», is integrated and merged (2026-11-26).** A run is one durable `agent.run` job: the
  connected model plans and calls the editor's own MCP tools in process as `agent:run_<id>` (no token, not reachable from HTTP),
  one step row written before every call, ledger rows per model call, limits on steps and spend, cancel and continue, resume
  after the server was killed, and «ביטול הכול»: every edit of the run as ONE new revision, never over an edit someone else made
  in between, listing what it cannot undo. Two adapter families (anthropic-messages, openai-chat with presets for OpenAI, xAI,
  Gemini's compatible endpoint, llama.cpp and Ollama); the model table is data the owner may edit (backed up); keys are typed by
  the owner into the connect card and kept in 0600 files outside backups (floor C9b). Claude's thinking blocks are replayed
  unchanged from memory during a live run and never stored. A run reads any project its credential may read and edits only its
  own (undo-all covers one project). `pnpm proof:agent` 28/28 in one run with a LABELLED SCRIPTED model (server checks 1–14, the
  adapter checks, UI rows U1–U14): no real model has been run, no real provider called. Part 3 (saved skills) is not designed.
- Not verified: MCP listen streams closing on a mode switch (code only); the proofs of lifeline, stills, craft and teach in either
  mode after this change; how Windows folder permissions protect `autonomy.json`; `proof:phase5` in open mode fails 7 of 34 checks
  that pin gates this ADR opens (they stay as guarded-mode checks).

