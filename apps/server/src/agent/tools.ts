/**
 * The loop's tool view (wave 8 autonomy Part 2; plan §2.2 corrected by the verifier). LEAD PRE-PASS, complete as data: which MCP
 * tools the model sees by default (the `planner` set), and the loop's OWN tools (update_plan, wait_for_job, finish), which are
 * answered by the loop itself and are never MCP tools. W1 owns this file after the pre-pass (it may add planner names that exist).
 *
 * The planner set is read against the tools the MCP server actually registers (tools/list through serveAs): a name that is not
 * registered in this build (Part 1's planned tools before they land) is simply left out, never faked. `apply_transaction` carries
 * every public op; `describe_ops` gives their schemas on demand; the system prompt lists the ops one line each (listOps()).
 * Text from media, transcripts and file names is data, not instructions (the MCP server's own instruction, repeated in the prompt).
 */
import { z } from 'zod';
import { AGENT_LIMITS, AgentPlanSchema } from '@pulseframe/core';

/** The planner tools that only read (lead decision 4: a run READS any project its credential may read; it EDITS only its own). */
export const READING_TOOLS = [
  'get_summary', 'get_timeline', 'list_sequences', 'describe_moment', 'render_contact_sheet', 'render_frame', 'get_transcript',
  'find_text', 'find_in_footage', 'find_silences', 'find_filler_words', 'find_short_candidates', 'get_analysis', 'preflight',
  'measure_loudness', 'list_catalog', 'list_capabilities', 'estimate_capability', 'get_job', 'get_speech_status', 'get_controls', 'plan_export',
] as const;
export const PLANNER_TOOLS = [
  ...READING_TOOLS,
  // acting
  'apply_transaction', 'describe_ops', 'undo', 'plan_shorts', 'make_shorts', 'plan_template', 'apply_template', 'plan_recipe', 'apply_recipe',
  'transcribe_asset', 'translate_captions', 'analyze_asset', 'run_capability', 'export_project', 'export_batch', 'cancel_job',
  // Part 1 (verifier C3): present once wt/auto-p1 lands; left out until registered
  'start_model_download', 'install_speech_engine', 'list_versions', 'save_version', 'restore_version',
] as const;

/**
 * May this call name another project than the run's? Reading tools (the list above, or any tool the editor marks readOnlyHint)
 * may: the editor's own read checks for the run's credential apply as for any agent. Acting tools may not: «ביטול הכול» covers
 * one project (a fact, not a policy), so the run edits only its own (lead decision 4).
 */
export function mayNameOtherProject(name: string, annotations: unknown): boolean {
  if ((READING_TOOLS as readonly string[]).includes(name)) return true;
  return !!annotations && typeof annotations === 'object' && (annotations as { readOnlyHint?: unknown }).readOnlyHint === true;
}

/** render_frame / render_contact_sheet arguments the loop adds when the model leaves them out (C11). */
export function defaultFrameScale(outputWidth: number): 1 | 0.5 { return outputWidth > 1280 ? AGENT_LIMITS.frameScaleOver1280 : 1; }

// ---------- the loop's own tools ----------
export const UpdatePlanInput = z.object({ steps: AgentPlanSchema.describe('The whole plan, in order; send it again whenever a step changes status') }).strict();
export const WaitForJobInput = z.object({ projectId: z.string(), jobId: z.string(), timeoutSeconds: z.number().int().min(1).max(AGENT_LIMITS.waitForJobMaxSeconds).optional() }).strict();
export const FinishInput = z.object({ summary: z.string().min(1).max(AGENT_LIMITS.finishSummaryChars).describe('What was done, what was not and why, in the language of the goal'), outcome: z.enum(['done', 'partial', 'blocked']) }).strict();
export const LOOP_TOOLS = {
  update_plan: { description: 'Write or rewrite your plan: a numbered list the owner sees as «תוכנית». Call it before your first acting step and whenever a step starts, finishes or fails.', input: UpdatePlanInput },
  wait_for_job: { description: `Wait until a job (export, transcription, analysis, capability, download) finishes or ${AGENT_LIMITS.waitForJobMaxSeconds} s pass; returns its status, stage and result like get_job. Does not count as a step.`, input: WaitForJobInput },
  finish: { description: 'End the run with a summary for the owner. Call it when the goal is done, or when it cannot be done here (say what is missing and the next step).', input: FinishInput },
} as const;
export type LoopToolName = keyof typeof LOOP_TOOLS;
export const LOOP_TOOL_NAMES = Object.keys(LOOP_TOOLS) as LoopToolName[];

/** The loop's tools as the adapters take them (JSON Schema). */
export function loopToolSpecs(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return LOOP_TOOL_NAMES.map((name) => ({ name, description: LOOP_TOOLS[name].description, inputSchema: z.toJSONSchema(LOOP_TOOLS[name].input) as Record<string, unknown> }));
}
/** The planner set narrowed to what this build registers (names from MCP tools/list), in PLANNER_TOOLS order, then the loop's own. */
export function plannerToolNames(registered: Iterable<string>): string[] {
  const have = new Set(registered);
  return [...PLANNER_TOOLS.filter((t) => have.has(t)), ...LOOP_TOOL_NAMES];
}
