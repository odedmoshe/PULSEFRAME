# ADR-0004: Operations, transactions and the commit path

Status: accepted (Phase 0); extended in Phase 1 (see "Phase 1 additions")

## Decision
- One registry (`packages/core/src/ops.ts`). Each op has a stable name, version, description, zod argument schema and a pure `apply`.
- `applyTransaction` deep-copies the document, applies ops in order, then runs semantic validation. Any failure rejects the whole batch.
- New ids come from a per-transaction seed that is stored in the op log, so replay is deterministic.
- `Store.commit` writes the materialized document, the op-log row and an outbox row in **one** SQLite transaction, then drains the outbox to subscribers.
  On startup the outbox is drained again, so a crash between commit and publish does not lose the event.
- UI, REST and MCP all call `Store.commit`. MCP tool schemas and `GET /api/v1/ops` are generated from the registry (zod → JSON Schema).
- Idempotency: `(project, actor, idempotencyKey)` is unique. A repeat with the same ops returns the original result; with different ops it is a 409.
- Concurrency (Phase 0 rule): if `expectedRevision` is supplied it must equal the current revision, otherwise `stale_revision`. No rebasing.
- Clients converge by refetching the document when a revision event arrives; SSE replays missed revisions via `?since=`.

## Phase 1 additions
- **Entity diff per commit.** Entities are the project header, assets, tracks (without clips) and clips. `diffEntities(before, after)` is stored with each transaction
  and drives `entity_versions(project, entity) → last revision, deleted, actor`. Versions live in the store, not in the creative document.
- **Semantic rebase.** `baseRevision` (what the caller last saw) may be stale. The commit is accepted only if no entity that the ops *reference* (ids found in
  arguments, plus `dependsOn`) or *change* (the diff) was modified after `baseRevision`; otherwise `409 conflict` listing entity, revision and actor.
  Structural rules (overlap, bounds) are still enforced by applying to the current document. `expectedRevision` remains the strict mode.
- **Undo/redo = compensating transaction.** Per-actor stack. Undo restores the *before* states of the target's diff through the internal, replayable op
  `restore_entities`, but only if each entity still equals the target's *after* state; otherwise `undo_conflict` and nothing changes. A new edit by the actor
  abandons their redo branch. Track order index is excluded from equality so unrelated track insertions do not block undo.
- **Idempotency** compares canonical ops.
- Known limits: no "restore as branch" alternative when undo is refused; no drag-gesture coalescing; versions are per entity, not per property, so two actors
  changing different properties of one clip conflict (safe, sometimes stricter than necessary).

## Still deferred
Proposals/branches and checkpoints (Phase 5/§23), per-op authorization metadata, dependency-aware visual diffs, property-level merge.
