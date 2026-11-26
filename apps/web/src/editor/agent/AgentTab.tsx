/**
 * The «סוכן» tab of the Copilot (wave 8 autonomy Part 2). LEAD PRE-PASS: the mount point only. BUILDER W3 (sonnet) owns
 * apps/web/src/editor/agent/ after the pre-pass: the connect card «חיבור מודל» (presets from GET /api/v1/agent/providers, the key
 * field, «בדיקה», the one line on what is sent, «החיבור לא מוצפן», the compatible-endpoint line), the goal box, the live run (the
 * plan, every step with its call, «צעד N מתוך M · עלות», WHY a run stopped on the same line, «להמשיך עוד 100 צעדים»), «ביטול הכול»
 * with its conflicts and «לא בוטל: …», and the list of runs. Strings: packages/i18n/src/agent.ts; test ids: agent.testids.ts;
 * calls: api.startAgentRun … api.agentModels (apps/web/src/api.ts). Live progress: the job event of the run's job (type agent.run,
 * stage step:<n>:<status>) on the existing event stream, then GET the run.
 *
 * Copilot.tsx shows this panel instead of its honest «not connected» chat panel only once AGENT_TAB_BUILT is true (W3 flips it with
 * the UI proof rows green). Until then nothing here renders: no dead button.
 */
export const AGENT_TAB_BUILT: boolean = false;

export function AgentTab() {
  if (!AGENT_TAB_BUILT) return null;
  return null;
}
