# ADR-0004: Operations, transactions and the commit path

Status: accepted (Phase 0); undo and rebasing deferred to Phase 1

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

## Deferred
Undo/redo as compensating transactions, semantic preconditions/entity versions for safe rebasing, proposals/branches, dependency-aware diffs,
per-op authorization metadata, drag gestures as one undo step.
