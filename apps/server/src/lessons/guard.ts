/**
 * «למדו אותי פעם אחת» — the governance rule of version 1 (wave 8 teach; teach-verify C12, decisions.md Batch C): an agent's
 * apply_lesson is REFUSED, 403 lesson_owner_only, before any operation runs — for a commit, a dry run, a proposal, an MCP op tool and
 * inside nested operation lists (apply_transaction's ops). It sits beside the two op-name refusals of Governance.commitAs
 * (assertOwnerTagsPeople, assertMayWritePeople) and is keyed on the credential's KIND: every agent grant, whatever its mode, scopes
 * or people access. No silent conversion into a proposal (C12): a new kind of rule nobody reviewed. An agent can still send the
 * separate edits as ordinary operations under its own grant, which is the honest path. COMPLETE in the pre-pass; frozen.
 */
import { LESSON_API_REFUSALS, LESSON_OP } from '@pulseframe/core';
import type { Principal } from '../governance.ts';
import { ApiError } from '../store.ts';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
/** True when `ops` (an op list, at any depth) holds a call of apply_lesson. */
export function holdsLessonCall(ops: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 64 || seen.has(v)) return false;
    if (Array.isArray(v)) { seen.add(v); return v.some((x) => walk(x, depth + 1)); }
    if (!isObj(v)) return false;
    seen.add(v);
    if (v.op === LESSON_OP) return true;
    return Object.values(v).some((x) => walk(x, depth + 1));
  };
  return walk(ops, 0);
}
export const lessonAgentRefusal = () => { const r = LESSON_API_REFUSALS.agentRefused; return new ApiError(r.status, r.code, r.message(), { op: LESSON_OP }, r.hint); };
/** Governance.commitAs and Governance.propose call this first for every agent principal. */
export function assertOwnerAppliesLessons(p: Principal, ops: unknown): void {
  if (p.kind === 'user') return;
  if (holdsLessonCall(ops)) throw lessonAgentRefusal();
}
