/**
 * A labelled STAND-IN for the owner's llama.cpp server (wave 7; assistant-decisions.md §4), for tests and pnpm proof:assistant-local
 * ONLY: never imported by production code (a test checks index.ts and main.ts do not import it). It is NOT llama.cpp and proves
 * nothing about it: it answers the shape our adapter reads (field names as the decisions assume them; unchecked against a build).
 *
 * A node:http server bound to 127.0.0.1 on an ephemeral port (listen on 0; it binds no other host). /health answers 503 for a scripted
 * time, then 200; /v1/models answers { data: [{ id: 'STAND-IN.gguf' }] }; /v1/chat/completions refuses (400) a body that is not
 * llamaChatBody's shape, or whose response_format schema holds "pattern", "format", "$ref" or "\p{", and otherwise answers from a
 * script keyed by the owner's text (the user turn without its 'REQUEST (data):\n' mark, or the whole user turn), in llama.cpp's field
 * names (choices[0].message.content, finish_reason, model). A text the script does not know is answered {"intent":"none","slots":{}}.
 * It records every request's raw bytes, headers and body for the checks (no Authorization, no cookie, no project data) and can be
 * scripted to delay, answer a status (503 = still loading), answer a reply that is not llama.cpp's shape, or stop finishing ('length').
 * Every answer says STAND-IN; it logs nothing.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StandInScript {
  answers: Record<string, string>;
  /** /health (and the chat route) answer 503 for this long after start (or after `script()` sets it). */
  loadingMs?: number;
  /** The chat route waits this long before it answers (a cancel or a time limit lands meanwhile). */
  delayMs?: number;
  /** The chat route answers this HTTP status with a short STAND-IN body instead of an answer. */
  status?: number;
  /** 'garbage': a 200 whose body is not llama.cpp's shape. */
  shape?: 'llama' | 'garbage';
  /** finish_reason of every answer (default 'stop'). */
  finish?: 'stop' | 'length';
}
export interface StandInRequest { method: string; path: string; headers: Record<string, string | string[] | undefined>; rawHeaders: string[]; body: string }
export interface StandIn {
  port: number;
  readonly label: 'STAND-IN';
  requests: StandInRequest[];
  /** Raw bytes received on every connection, in order of arrival (a dial that wrote nothing adds an empty entry). */
  connections: Buffer[];
  /** Replace the script (loadingMs counts from now). */
  script(next: StandInScript): void;
  close(): Promise<void>;
}

const BODY_KEYS = ['cache_prompt', 'chat_template_kwargs', 'max_tokens', 'messages', 'model', 'response_format', 'stream', 'temperature', 'top_k'];
const FORBIDDEN_IN_SCHEMA = ['"pattern"', '"format"', '"$ref"', '\\p{'];

/** Why a chat body is not llamaChatBody's shape, or null. */
export function standInBodyProblem(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'not an object';
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b).sort();
  if (keys.join(',') !== BODY_KEYS.join(',')) return `keys ${keys.join(',')}`;
  if (b.model !== 'local' || b.temperature !== 0 || b.top_k !== 1 || b.stream !== false || b.cache_prompt !== false || typeof b.max_tokens !== 'number') return 'fixed fields';
  const m = b.messages as { role?: unknown; content?: unknown }[];
  if (!Array.isArray(m) || m.length !== 2 || m[0]?.role !== 'system' || m[1]?.role !== 'user' || typeof m[0]?.content !== 'string' || typeof m[1]?.content !== 'string') return 'messages';
  const rf = b.response_format as { type?: unknown; json_schema?: { name?: unknown; schema?: unknown } } | undefined;
  if (!rf || rf.type !== 'json_schema' || rf.json_schema?.name !== 'command' || typeof rf.json_schema.schema !== 'object') return 'response_format';
  const schemaText = JSON.stringify(rf.json_schema.schema);
  for (const f of FORBIDDEN_IN_SCHEMA) if (schemaText.includes(f)) return `schema holds ${f}`;
  const k = b.chat_template_kwargs as { enable_thinking?: unknown } | undefined;
  if (!k || Object.keys(k).join(',') !== 'enable_thinking' || k.enable_thinking !== false) return 'chat_template_kwargs';
  return null;
}

const USER_MARK = 'REQUEST (data):\n';

export async function startStandIn(initial: StandInScript): Promise<StandIn> {
  let script = initial, since = Date.now();
  const requests: StandInRequest[] = [];
  const connections: Buffer[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const timers = new Set<NodeJS.Timeout>();
  const loading = () => Date.now() - since < (script.loadingMs ?? 0);
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    if (res.destroyed) return;
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (d: Buffer) => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts).toString('utf8');
      const path = (req.url ?? '').split('?')[0]!;
      requests.push({ method: req.method ?? '', path, headers: { ...req.headers }, rawHeaders: [...req.rawHeaders], body });
      if (path === '/health') return loading() ? send(res, 503, { error: { code: 503, message: 'STAND-IN: loading model' } }) : send(res, 200, { status: 'ok', note: 'STAND-IN' });
      if (path === '/v1/models') return send(res, 200, { object: 'list', data: [{ id: 'STAND-IN.gguf', object: 'model', owned_by: 'STAND-IN' }] });
      if (path !== '/v1/chat/completions' || req.method !== 'POST') return send(res, 404, { error: 'STAND-IN: not found' });
      if (loading()) return send(res, 503, { error: { code: 503, message: 'STAND-IN: loading model' } });
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return send(res, 400, { error: 'STAND-IN: not JSON' }); }
      const problem = standInBodyProblem(parsed);
      if (problem) return send(res, 400, { error: `STAND-IN: refused body (${problem})` });
      const answer = () => {
        if (script.status !== undefined) return send(res, script.status, { error: `STAND-IN: scripted status ${script.status}` });
        if (script.shape === 'garbage') return send(res, 200, { STAND_IN: 'not a llama.cpp reply' });
        const user = String((parsed as { messages: { content: string }[] }).messages[1]!.content);
        const text = user.startsWith(USER_MARK) ? user.slice(USER_MARK.length) : user;
        const content = script.answers[text] ?? script.answers[user] ?? '{"intent":"none","slots":{}}';
        send(res, 200, { id: 'STAND-IN', object: 'chat.completion', model: 'STAND-IN.gguf', choices: [{ index: 0, finish_reason: script.finish ?? 'stop', message: { role: 'assistant', content } }] });
      };
      if (script.delayMs) { const t = setTimeout(() => { timers.delete(t); answer(); }, script.delayMs); timers.add(t); } else answer();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    const i = connections.push(Buffer.alloc(0)) - 1;
    socket.on('data', (d: Buffer) => { connections[i] = Buffer.concat([connections[i]!, d]); });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const port = (server.address() as AddressInfo).port;
  return {
    port, label: 'STAND-IN', requests, connections,
    script(next) { script = next; since = Date.now(); },
    close: () => new Promise<void>((resolve) => {
      for (const t of timers) clearTimeout(t);
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}
