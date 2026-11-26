# Execution policy (cost-aware multi-agent development)

Adopted 2026-11-14 at the owner's request. Goal: lowest total cost and time per **accepted** milestone, with every acceptance gate kept.

1. **One lead** owns architecture, shared contracts (`packages/time`, `packages/core` schema/ops, `apps/server/src/store.ts`, job contract, lockfile, `docs/PROGRESS.md`), integration and acceptance.
2. **Group size:** lead + up to two workers; a third only for clearly independent work. Tiny deterministic actions are done directly with tools.
3. **Routing by consequence**
   - Economical (`haiku`): file/symbol inventories, structured extraction, log summaries, licence *evidence* collection. Read-only unless it owns a named output file.
   - Balanced (`sonnet`): scoped implementation against a settled contract, UI components, single adapters, fixtures, long mechanical documents.
   - Strong (lead, or `opus`): time math, ripple/undo semantics, render/export parity, audio clock, Hebrew shaping, job idempotency, authorization, ambiguous paid submissions, GPU ownership, licence *qualification*, critical review.
4. **Task contract for every worker:** objective and artifact · files/spec sections to read · invariants · exact edit scope · acceptance checks · model. Hand-back ≤ ~120 words: result, files changed, checks actually run, open issues.
5. **Write isolation:** non-overlapping file ownership, or a worktree. Workers do not run `pnpm install`, the proofs, or commits unless told to. The lead reviews the real diff and runs the combined checks.
6. **Escalate, don't loop:** after two materially different failed attempts, hand a compact evidence packet to a stronger tier.
7. **Checks:** targeted tests during work; `pnpm check` (+ `pnpm proof:g0` when provider code changed) at milestone boundaries only.
8. **Compute and spend:** one heavy render/proof at a time; no model downloads, GPU wake-ups or paid calls without existing authorization; never retry an ambiguous paid request.
9. **Record** in `docs/PROGRESS.md` at each milestone: requested model per worker, resolved model only when observable, token figures only when the harness reports them.

Reusable agent definitions: `.claude/agents/pf-scout.md` (economical, read-only) and `.claude/agents/pf-implementer.md` (balanced, scoped writes).

## Owner instruction, 2026-11-17
Work in parallel with several agents under the lead's full management, and route work by cost: tasks that do not need the strongest model go to cheaper ones (inventories, licence evidence, mechanical edits and string work to the economical tier; scoped implementation against a settled contract and UI components to the balanced tier), as long as the result's quality does not suffer. Architecture, time and undo semantics, render parity, safety, authorization, licence qualification and adversarial review stay on the strong tier. Each milestone in PROGRESS records the requested model per worker.


## Owner instruction, 2026-11-25 (cost) — the lead's routing rule from here on
The owner saw the token burn of the session model rise sharply. Findings by the lead: since the owner switched the session to its present model, most workers inherited it — both design workflows (designers and verifiers), the three web-research agents, the regression agent and most builders — and only three tasks were sent to `sonnet`. That was more expensive than the policy above allows. From now on a worker NEVER inherits the session model by default; every launch names its model:
- `haiku`: inventories, extraction, log and evidence summaries (`pf-scout`).
- `sonnet`: web research and licence evidence, manifests, UI against settled contracts, documents and ADR text, running proofs and regressions and recording evidence, mechanical refactors, measurement scripts against a settled harness.
- `opus`: design plans and their verification, review, and the building of core, server and engine features.
- the session model (strongest tier): the lead only, and a worker only when the task is one where a subtle error is expensive and hard to see — authorization and privacy boundaries, exact-time and compositor arithmetic, concurrency and durability — and then for the narrowest slice.
A resumed agent keeps the model it was started with, so follow-up work that is cheaper in kind goes to a NEW agent on the cheaper tier with the earlier agent's commits as its contract. The lead also spends: every wake re-reads its whole context, so the lead batches reports (workflows that return one result, fewer single-agent wakes), keeps replies short, and asks the owner to compact the conversation when the context is large.
