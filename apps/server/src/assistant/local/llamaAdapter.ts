/**
 * The LOCAL assistant's adapter (wave 7; assistant-decisions.md §4). BUILDER B: the body. LEAD pre-pass: the signature and the rules.
 *
 * - Talks only to localModelUrl(port, path) (providers localChat.ts): http://127.0.0.1:<port>, three paths, over node:http with NO
 *   agent at all (the request's own createConnection dials the URL's host and port), so no proxy from the environment can be
 *   applied and nothing is pooled; node:http never follows a redirect (a 3xx is server_error 'HTTP 3xx').
 * - Nothing is written before the socket is checked: the request is created without a body and is ended only once the socket has
 *   connected and isLoopbackRemote(socket.remoteAddress) is true; otherwise the request is destroyed (LocalModelError 'not_loopback',
 *   sent false) and not a byte (not even the request line or a header) has been written.
 * - Sends llamaChatBody(req) with Content-Type and Accept application/json, its length and node's own Host and Connection headers,
 *   and nothing else: no Authorization header, no cookie, no key (LocalChatRequest has no field for one).
 * - Reads at most 64 KiB; parseLlamaReply; ECONNREFUSED → not_running (sent false); 503 → loading; the owner's time limit → timeout;
 *   other status or shape → server_error ('HTTP <status>' or a code word only, never the body); the signal → canceled.
 * - Logs nothing of the request or the reply (no console line at all).
 * - check(): GET /health (200 then /v1/models, 503 loading, refused stopped, anything else not_llama); running needs /v1/models to
 *   answer llama.cpp's shape ({ data: [{ id }] }), whose first id is the model name (localModelName: basename only).
 */
import http from 'node:http';
import net from 'node:net';
import {
  isLoopbackRemote, llamaChatBody, localModelName, LocalModelError, localModelUrl, parseLlamaReply,
  type LocalChatResponse, type LocalModelAdapter, type LocalModelCheck, type LocalModelPath,
} from '@pulseframe/providers';

export const LLAMA_ADAPTER_ID = 'local-llama-server';
/** True once builder B's body is in. */
export const LLAMA_ADAPTER_BUILT = true;
/** The largest reply read (a { intent, slots } answer is far smaller; /v1/models of one model too). */
export const LOCAL_REPLY_MAX_BYTES = 64 * 1024;

/**
 * TEST and PROOF seams only (never set by index.ts): `connect` makes the socket for a dial (default net.connect to the URL's host and
 * port), so a test can hand the adapter a socket whose remote address is not this machine; `onDial` observes every URL dialled.
 */
export interface LlamaAdapterOptions {
  connect?: (host: string, port: number) => net.Socket;
  onDial?: (url: string) => void;
}

interface Exchange { status: number; body: Buffer }

export function createLlamaAdapter(opts: LlamaAdapterOptions = {}): LocalModelAdapter {
  const connect = opts.connect ?? ((host: string, port: number) => net.connect({ host, port }));

  /**
   * One HTTP exchange with http://127.0.0.1:<port><path>. Rejects with LocalModelError only. `sent` is true once the request was
   * ended (its bytes handed to the socket).
   */
  function exchange(port: number, path: LocalModelPath, method: 'GET' | 'POST', body: Buffer | null, timeoutMs: number, signal: AbortSignal): Promise<Exchange> {
    const url = localModelUrl(port, path); // throws RangeError on a bad port or path: nothing is dialled
    const u = new URL(url);
    opts.onDial?.(url);
    return new Promise<Exchange>((resolve, reject) => {
      let sent = false, settled = false;
      const headers: Record<string, string> = { accept: 'application/json' };
      if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = String(body.length); }
      const req = http.request(url, {
        method, headers, agent: undefined, setHost: true,
        // no agent: the request dials through this function only (no global agent, no environment proxy, no pooling)
        createConnection: () => connect(u.hostname, Number(u.port)),
      });
      const finish = (err: LocalModelError | null, value?: Exchange) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (err) { req.destroy(); reject(err); } else resolve(value!);
      };
      const onAbort = () => finish(new LocalModelError('canceled', sent, 'canceled'));
      const timer = setTimeout(() => finish(new LocalModelError('timeout', sent, 'timeout')), timeoutMs);
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });

      // THE LOOPBACK CHECK: nothing has been written yet (no write, no end, no flushHeaders before this point)
      const verify = (socket: net.Socket) => {
        if (settled) return;
        if (!isLoopbackRemote(socket.remoteAddress)) { finish(new LocalModelError('not_loopback', false, 'not loopback')); socket.destroy(); return; }
        sent = true;
        if (body) req.end(body); else req.end();
      };
      req.on('socket', (socket: net.Socket) => {
        if (socket.connecting) socket.once('connect', () => verify(socket));
        else verify(socket);
      });
      req.on('error', (e: NodeJS.ErrnoException) => {
        if (settled) return;
        if (e.code === 'ECONNREFUSED') finish(new LocalModelError('not_running', false, 'connection refused'));
        else finish(new LocalModelError('server_error', sent, typeof e.code === 'string' ? e.code : 'connection error'));
      });
      req.on('response', (res) => {
        const parts: Buffer[] = [];
        let size = 0;
        res.on('data', (d: Buffer) => {
          size += d.length;
          if (size > LOCAL_REPLY_MAX_BYTES) { finish(new LocalModelError('server_error', true, 'reply too large')); res.destroy(); return; }
          parts.push(d);
        });
        res.on('end', () => finish(null, { status: res.statusCode ?? 0, body: Buffer.concat(parts) }));
        res.on('error', () => finish(new LocalModelError('server_error', true, 'reply cut off')));
      });
    });
  }

  const json = (b: Buffer): unknown => { try { return JSON.parse(b.toString('utf8')); } catch { return undefined; } };

  return {
    id: LLAMA_ADAPTER_ID,
    async check(port: number, signal: AbortSignal): Promise<LocalModelCheck> {
      const limitMs = 10_000;
      let health: Exchange;
      try { health = await exchange(port, '/health', 'GET', null, limitMs, signal); }
      catch (e) {
        if (e instanceof LocalModelError && e.code === 'canceled') throw e;
        return { state: e instanceof LocalModelError && e.code === 'not_running' ? 'stopped' : 'not_llama', model: null };
      }
      if (health.status === 503) return { state: 'loading', model: null };
      if (health.status !== 200) return { state: 'not_llama', model: null };
      let models: Exchange;
      try { models = await exchange(port, '/v1/models', 'GET', null, limitMs, signal); }
      catch (e) {
        if (e instanceof LocalModelError && e.code === 'canceled') throw e;
        return { state: 'not_llama', model: null };
      }
      if (models.status === 503) return { state: 'loading', model: null };
      const m = json(models.body) as { data?: unknown } | undefined;
      if (models.status !== 200 || !m || !Array.isArray(m.data)) return { state: 'not_llama', model: null };
      const first = m.data[0] as { id?: unknown } | undefined;
      return { state: 'running', model: localModelName(first?.id) };
    },
    async complete(req, port, timeoutMs, signal): Promise<LocalChatResponse> {
      const body = Buffer.from(JSON.stringify(llamaChatBody(req)), 'utf8');
      const r = await exchange(port, '/v1/chat/completions', 'POST', body, timeoutMs, signal);
      if (r.status === 503) throw new LocalModelError('loading', true, 'HTTP 503');
      if (r.status !== 200) throw new LocalModelError('server_error', true, `HTTP ${r.status}`);
      const parsed = parseLlamaReply(json(r.body));
      if (!parsed) throw new LocalModelError('server_error', true, 'not a llama.cpp reply');
      return parsed;
    },
  };
}
