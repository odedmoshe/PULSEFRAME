/**
 * What a model answer must be before it becomes a proposal (ADR-0027, plan §7.4 step 4). The answer is the tool input
 * `{ ops, explanation? }`, or (when the model answered in text) a JSON text of exactly that shape. Refused, each with the
 * FIRST reason, as invalid_model_output: a finish other than 'tool' or 'stop' ('length' = cut off, 'filtered', 'other'), an
 * empty answer, text that is not JSON, a shape outside ModelProposalSchema (0 or more than MAX_ASSISTANT_OPS ops, an
 * explanation over ASSISTANT_EXPLANATION_MAX characters), an op outside the allowlist (unknown, internal, a PERSON_OPS op,
 * any ASSISTANT_EXCLUDED_OPS op), a private people argument, or arguments the op's own schema refuses. Nothing here is
 * stored or applied: the job hands the ops to Governance.propose (which validates them again on the document) as the
 * in-memory assistantPrincipal.
 */
import { ASSISTANT_EXPLANATION_MAX, assistantOps, getOp, MAX_ASSISTANT_OPS, PERSON_OPS, PERSON_PRIVATE_ARGS, type OpCall } from '@pulseframe/core';
import type { ChatResponse } from '@pulseframe/providers';
import { z } from 'zod';

export const ModelProposalSchema = z.object({
  ops: z.array(z.object({ op: z.string().min(1).max(64), args: z.record(z.string(), z.unknown()) }).strict()).min(1).max(MAX_ASSISTANT_OPS),
  explanation: z.string().max(ASSISTANT_EXPLANATION_MAX).optional(),
}).strict();
export type ModelProposal = z.infer<typeof ModelProposalSchema>;

/**
 * Why an answer was refused, as the job row keeps it (ADR-0027, note of 2026-11-25): the category and a FIXED sentence. Nothing
 * of the answer itself is quoted (not an operation's name, not a key, not a value): the answer can repeat what the owner typed.
 * What varies in a sentence is only an operation's index, the adapter's finish word, or a schema issue code of this build.
 */
export const INVALID_ANSWER_CATEGORIES = ['cut_off', 'ended', 'empty', 'not_json', 'empty_tool_input', 'wrong_shape', 'unknown_op', 'internal_op', 'people_op', 'op_not_allowed', 'private_people_arg', 'invalid_args', 'refused_by_project'] as const;
export type InvalidAnswerCategory = (typeof INVALID_ANSWER_CATEGORIES)[number];
export type ProposalCheck = { ok: true; ops: OpCall[]; explanation: string | null } | { ok: false; category: InvalidAnswerCategory; reason: string };
const no = (category: InvalidAnswerCategory, reason: string): ProposalCheck => ({ ok: false, category, reason });

let allowed: Set<string> | null = null;
const allowlist = () => (allowed ??= new Set(assistantOps()));

/** True when some key at any depth of `v` is a private people argument (birthDate, form). */
function holdsPrivatePeopleArg(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(holdsPrivatePeopleArg);
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => (PERSON_PRIVATE_ARGS as readonly string[]).includes(k) || holdsPrivatePeopleArg(x));
  return false;
}

export function checkModelAnswer(r: ChatResponse): ProposalCheck {
  if (r.finish !== 'tool' && r.finish !== 'stop') return r.finish === 'length' ? no('cut_off', 'the answer was cut off at the output token cap (finish: length)') : no('ended', `the answer ended with finish: ${r.finish === 'filtered' ? 'filtered' : 'other'}`);
  let raw: unknown = r.toolInput;
  if (raw === null || raw === undefined) {
    const text = r.text?.trim() ?? '';
    if (!text) return no('empty', 'the answer is empty: no tool call and no text');
    try { raw = JSON.parse(text); } catch { return no('not_json', 'the answer is text that is not a JSON proposal'); }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) return no('empty_tool_input', 'the tool input is empty');
  const p = ModelProposalSchema.safeParse(raw);
  if (!p.success) {
    // the issue's code is a word of the schema library (too_big, unrecognized_keys…); its message and path can quote the answer
    return no('wrong_shape', `the proposal does not have the tool's shape (${p.error.issues[0]!.code})`);
  }
  const ops: OpCall[] = [];
  for (const [i, call] of p.data.ops.entries()) {
    const def = getOp(call.op);
    if (!def) return no('unknown_op', `op ${i} is not an operation of this build`);
    if (def.internal) return no('internal_op', `op ${i} is internal and cannot be proposed`);
    if ((PERSON_OPS as readonly string[]).includes(call.op)) return no('people_op', `op ${i} changes people, which the assistant may not do`);
    if (!allowlist().has(call.op)) return no('op_not_allowed', `op ${i} is not one the assistant may propose`);
    if (holdsPrivatePeopleArg(call.args)) return no('private_people_arg', `op ${i} carries a birth date or a word choice`);
    const a = def.args.safeParse(call.args);
    if (!a.success) return no('invalid_args', `op ${i} has invalid arguments (${a.error.issues[0]!.code})`);
    ops.push({ op: call.op, args: call.args });
  }
  return { ok: true, ops, explanation: p.data.explanation ?? null };
}
