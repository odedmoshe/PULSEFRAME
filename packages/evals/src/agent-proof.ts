/**
 * pnpm proof:agent — the in-editor agent «סוכן» (wave 8 autonomy Part 2; autonomy-plan.md §2.8 as corrected by autonomy-verify.md
 * C6–C9, C11, C16 and the lead's decisions; skills are Part 3, so the plan's checks 11–12 are cut here and check 12 keeps only the
 * outside client starting and undoing a run). LEAD: the entry point and the list of checks.
 * Built in parts by W1 (agent-proof.server.ts: 1–10, 12) and W2 (agent-proof.adapters.ts: 11, 13); W3's browser rows go into
 * proof:editor-interactions and audit:a11y; the integration step imports them here and sets AGENT_PROOF_BUILT. Until then it runs
 * nothing and exits 2 (blocked), never a pass.
 * EVERY model here is the LABELLED test double `MOCK-scripted-model` (packages/providers agentScripted.ts), placed once in each
 * family's slot; nothing is claimed about a real model. What only real keys on the owner's laptop can show is listed in
 * .artifacts/wave8/agent-integration.md. Fixture made by ffmpeg in the proof: 20 s 640×360 testsrc2 with a 1 kHz tone holding two
 * 3 s silences, plus a typed Hebrew transcript set as data (no speech engine).
 */
export const AGENT_PROOF_BUILT = false;
export const AGENT_CHECKS: Readonly<Record<string, string>> = {
  1: 'the walk «תחתכו את השקטים, תוסיפו כתוביות בעברית, תעשו גרסה 9:16 ותייצאו» with the scripted model (get_summary, get_timeline, find_silences → apply_transaction, add_caption_track mode transcript, add_variant profileId vertical-9x16, preflight, export_project + wait_for_job, finish) reaches succeeded; the plan (update_plan) is readable over REST and the job event before the first acting step',
  2: 'every step passes queued → running → done/failed with its tool name, arguments, result summary, transaction and job ids; started_at is committed before the call (C8.2)',
  3: 'every edit is a transaction by agent:run_<id> committed through serveAs → Governance.commitAs → Store.commit; a grep finds no .commit( and no UPDATE projects in apps/server/src/agent/',
  4: 'measured on the result: the timeline lost both silences (duration −6 s ± 1 frame, rational), a caption track exists, a 9:16 variant exists, the export file exists with the variant\'s size and frame count',
  5: '«ביטול הכול» brings the entity digest back to the start revision\'s in ONE new revision; C6 interleaved case: run edits X (r10), owner edits X (r11), run edits X (r12) → 409 undo_conflict listing X with by=user:local and nothing applied; partial undoes the rest and X keeps the owner\'s r11 state; a redo of the composite restores the run\'s states and clears every undone_by mark',
  6: 'C8: the server is killed after step 4\'s row is written and before its answer; restarted, the run resumes and finishes with no duplicate transaction and no second export job (keys <runId>.<n>.<k>); a model call in flight is recorded as unknown money',
  7: 'step limit 3 stops at step 3 as stopped_at_limit with the reason on the same line; continue (+100) finishes it',
  8: 'money (C8/C9): one ledger row per model call (<jobId>:<n>) settled explicitly; scripted usage × the table\'s prices over a 1-cent spend limit stops with budget_reached and the plain sentence; no limit runs',
  9: 'a tool error (a scripted wrong clip id) returns to the model as an error result and the next scripted turn recovers; a turn with an unparseable call twice stops model_no_tools, not counted as a step',
  10: 'C16 failure rows with the scripted double: unauthorized, no_credit, rate_limited (waiting with retry-after, no step burned), overloaded, local_server_down, context_too_long (images then old results trimmed, a note step), 423 paused (waiting), unknown_after_send (never re-sent); each worded in Hebrew with its next step',
  11: 'both families\' converters (W2) on the research\'s quoted examples: anthropic-messages (input object, tool_result first with is_error, anthropic-version 2026-10-21, no temperature, tool_choice auto, images inside tool_result) and openai-chat (arguments a JSON string, role tool, stills in a following user message, no tool_choice for Ollama, parallel off for local)',
  12: 'an outside MCP client (the official SDK client, as in proof:phase5) starts a run with start_agent_run, reads it with get_agent_run and undoes it with undo_actor_since; undo-all after an export lists notUndone (1 export file, money, data sent) (C7)',
  13: 'keys: the key file is mode 0600 (on Linux), absent from a backup (agent/ removed recursively), and appears in no route answer, step, SSE event or log line; GET providers says keySet only; a LAN http base URL is stored and flagged unencrypted',
  14: 'mode (with Part 1): in guarded mode the same run\'s people-reading step gets names only and an export with an {age} title is a failed step, not a crash; switching to guarded stops an open run as stopped_mode_changed and continue resumes it (C4)',
};

if (!AGENT_PROOF_BUILT) {
  console.error(`agent-proof: not built yet; ${Object.keys(AGENT_CHECKS).length} checks pending (${Object.keys(AGENT_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
