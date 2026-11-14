# ADR-0001: Primary deployment profile is "lightweight local"

Status: accepted (Phase 0, 2026-11-14)

## Decision
Build the **lightweight local** profile first: one Node process, transactional SQLite (better-sqlite3, WAL, `synchronous=FULL`),
content-addressed files on local disk, durable in-process jobs. Hosted/team (PostgreSQL, object storage, distributed workers) comes later
behind the same `Store` interface and project archive format.

## Why
- SPEC §4 requires choosing one primary profile before building several storage backends.
- It is the only profile this environment can run and verify end to end (no managed database, queue or GPU here).
- SQLite gives real ACID commits, so the op log, materialized document and outbox are written in one transaction now, not simulated.

## Consequences
- Commits are serialized by the single process. Multi-process writers are out of scope until the hosted profile.
- Jobs run in-process, one export at a time. A crash re-queues `running` jobs on startup; they restart from their immutable snapshot.
  There are no checkpoints yet.
- Redis/BullMQ is not adopted. Revisit for the hosted profile.
- The server refuses to bind to non-loopback addresses in this profile (`config.ts`).
