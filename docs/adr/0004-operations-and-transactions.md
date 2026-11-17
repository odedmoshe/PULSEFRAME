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

## Lookups by id (added 2026-11-17)
- The document's records (`assets`, `sequences`, `transcripts`, `analyses`, `variants`, `recipeRuns`, `markers`, a variant's `overrides`, an effect's
  `keyframes`) are plain objects. `record[key]` therefore also finds what every object inherits: `"__proto__"` answers `Object.prototype` itself,
  `"constructor"` and `"toString"` answer functions. Before this rule `rename_asset` with `assetId: "__proto__"` renamed `Object.prototype` for the whole
  process, including from a dry run or a proposal.
- **Rule 1.** A key that did not come out of the validated document (an op argument, a route parameter, a tool input, a stored job input) is looked up with
  `own(record, key)` (`packages/core/src/own.ts`), never with `record[key]`. Anything the record does not itself hold is "not found", with the error codes the
  callers already had.
- **Rule 2.** No entity may carry an id that names an inherited member: `validateProject` reports `reserved_id` for it. This is what makes ids the document
  itself holds (a clip's `assetId`, a clip id used as an override key) safe as keys everywhere, the engine and the editor included. Ids made by ops
  (`prefix_seed…`) never collide with it; a restored archive that carries such an id is refused.
- **Writes.** An entry is written under a generated id or under the id of an entity that was just found. `apply_recipe` with a `runId` therefore requires that
  run to exist (`not_found` otherwise); `restore_entities` refuses a reserved id instead of assigning under it.
- `packages/core/src/own.test.ts` applies every registered op with such a name in each string argument and fails on anything but a typed refusal or an ordinary
  result. A new op is covered by it without being listed.

## Still deferred
Proposals/branches and checkpoints (Phase 5/§23), per-op authorization metadata, dependency-aware visual diffs, property-level merge.
