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
