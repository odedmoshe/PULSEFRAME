/**
 * A labelled STAND-IN for the owner's llama.cpp server (wave 7; assistant-decisions.md §4), for tests and pnpm proof:assistant-local
 * ONLY: never imported by production code (a test checks index.ts and main.ts do not import it). BUILDER B: the body.
 *
 * A node:http server bound to 127.0.0.1 on an ephemeral port (it refuses any other host). /health answers 503 for a scripted time,
 * then 200; /v1/models answers { data: [{ id: 'STAND-IN.gguf' }] }; /v1/chat/completions refuses a body that is not llamaChatBody's
 * shape, or whose response_format schema holds "pattern", "format", "$ref" or "\p{", and otherwise answers from a script keyed by the
 * user turn (llama.cpp's field names: choices[0].message.content, finish_reason, model). It records every request's headers and
 * body for the checks (no Authorization, no cookie, no project data) and can be scripted to refuse, delay, answer 503 or garbage.
 * Every answer and log line says STAND-IN.
 */
export interface StandInScript { answers: Record<string, string>; loadingMs?: number; delayMs?: number; status?: number }
export interface StandIn { port: number; requests: { path: string; headers: Record<string, string | string[] | undefined>; body: string }[]; close(): Promise<void> }

export async function startStandIn(script: StandInScript): Promise<StandIn> {
  void script;
  throw new Error('the local model STAND-IN is not built yet (builder B, wave 7 assistant)');
}
