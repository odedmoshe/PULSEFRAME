/**
 * The LOCAL assistant's adapter (wave 7; assistant-decisions.md §4). BUILDER B: the body. LEAD pre-pass: the signature and the rules.
 *
 * - Talks only to localModelUrl(port, path) (providers localChat.ts): http://127.0.0.1:<port>, three paths, over node:http (no proxy
 *   from the environment, no redirect followed). On the socket's 'connect' it checks isLoopbackRemote(socket.remoteAddress) and, if
 *   false, destroys the request BEFORE writing a byte (LocalModelError 'not_loopback', sent false).
 * - Sends llamaChatBody(req) with Content-Type application/json and NOTHING else of note: no Authorization header, no cookie, no key.
 * - Reads at most 64 KiB; parseLlamaReply; ECONNREFUSED → not_running (sent false); 503 → loading; the owner's time limit → timeout;
 *   other status or shape → server_error ('HTTP <status>' or a code word only, never the body); the signal → canceled.
 * - Logs nothing of the request or the reply (no console line holds the owner's words).
 * - check(): GET /health (200 running, 503 loading, refused stopped, anything else not_llama) then GET /v1/models for the name
 *   (localModelName of data[0].id).
 */
import type { LocalModelAdapter } from '@pulseframe/providers';

export const LLAMA_ADAPTER_ID = 'local-llama-server';
/** True once builder B's body is in. */
export const LLAMA_ADAPTER_BUILT = false;

export function createLlamaAdapter(): LocalModelAdapter {
  const notBuilt = () => Promise.reject(new Error('the local llama.cpp adapter is not built yet (builder B, wave 7 assistant)'));
  return { id: LLAMA_ADAPTER_ID, check: notBuilt, complete: notBuilt };
}
