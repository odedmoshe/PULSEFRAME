/**
 * proof:agent — the adapters' part (builder W2, wave 8 autonomy Part 2): checks 11 and 13 of agent-proof.ts. Imported by the
 * lead's entry point at integration; run alone (`tsx packages/evals/src/agent-proof.adapters.ts`) it prints its rows and exits 0
 * only when every row passes (1 when one fails).
 *
 * In this process: the REST app through its fetch handler (no port of its own) and ONE labelled local test double of a provider
 * (`http.createServer` on port 0, loopback only, canned answers). No real provider is called; the key is a made-up TEST string.
 * Fixtures are a temporary data dir and a backup destination, both deleted at exit. Every check is an equality or a text search;
 * nothing is claimed about a real model or a real provider's current wire format (that is for the laptop with the owner's keys).
 * Check 13's "no step and no SSE event" half is the loop's (W1): here the adapters' error details (what a step stores) are searched;
 * the integrator re-runs the search over steps and the event stream once the loop is in.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AGENT_PROVIDER_PRESETS, fromAnthropicResponse, fromOpenAIChatResponse, toAnthropicRequest, toOpenAIChatRequest, type AgentTurnRequest } from '@pulseframe/providers';
import { createOpenAIChatAdapter } from '@pulseframe/providers/agentOpenAIChat.ts';
import { Auth } from '@pulseframe/server/auth.ts';
import { backupDataDir } from '@pulseframe/server/backup.ts';
import { Capabilities } from '@pulseframe/server/capabilities.ts';
import { loadConfig } from '@pulseframe/server/config.ts';
import { Derivatives } from '@pulseframe/server/derive.ts';
import { Exporter } from '@pulseframe/server/export.ts';
import { Governance } from '@pulseframe/server/governance.ts';
import { createApp } from '@pulseframe/server/http.ts';
import { createMcp } from '@pulseframe/server/mcp.ts';
import { Presence } from '@pulseframe/server/presence.ts';
import { Speech } from '@pulseframe/server/speech.ts';
import { Store } from '@pulseframe/server/store.ts';
import { redactingAdapter } from '@pulseframe/server/agent/providers.ts';

export type AgentAdapterProofStatus = 'pass' | 'fail';
export interface AgentAdapterProofRow { id: string; status: AgentAdapterProofStatus; sample: string }

const FAKE_KEY = 'TEST-ONLY-proof-key-5ad1e-not-real';
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Check 11: both families' converters on the research's quoted examples (R§1.2, R§2.3) and the C11 picture placement. */
function check11(): AgentAdapterProofRow {
  const fails: string[] = [];
  const tool = { name: 'get_weather', description: 'Get the current weather in a given location', inputSchema: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] } };
  const img = { mediaType: 'image/png' as const, base64: 'iVBORw0KGgo=', label: 'frame 30' };
  const history: AgentTurnRequest['messages'] = [
    { role: 'user', text: 'What\'s the weather in San Francisco?' },
    { role: 'assistant', text: null, toolCalls: [{ id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', input: { location: 'San Francisco, CA', unit: 'celsius' } }] },
    { role: 'tool', results: [{ callId: 'toolu_01A09q90qw90lq917835lq9', text: 'ConnectionError: the weather service API is not available (HTTP 500)', isError: true, images: [img] }] },
  ];
  const req: AgentTurnRequest = { system: 'sys', messages: history, tools: [tool], maxOutputTokens: 1024, cache: false, parallelToolCalls: true };
  // family A
  const a = toAnthropicRequest(req, 'claude-opus-5-5');
  const tr = (a.messages[2]!.content as any[])[0];
  if (!eq(a.tool_choice, { type: 'auto' })) fails.push('A tool_choice');
  if (['temperature', 'top_p', 'top_k'].some((k) => k in a)) fails.push('A sampling field sent');
  if (tr.type !== 'tool_result' || tr.is_error !== true || tr.content[1]?.type !== 'image') fails.push('A tool_result first with is_error and the image inside');
  const ar = fromAnthropicResponse({ id: 'msg_01Aq9w938a90dw8q', model: 'claude-opus-5-5', stop_reason: 'tool_use', role: 'assistant', content: [{ type: 'text', text: 'I\'ll check the current weather in San Francisco for you.' }, { type: 'tool_use', id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', input: { location: 'San Francisco, CA', unit: 'celsius' } }] });
  if (!eq(ar.toolCalls[0]?.input, { location: 'San Francisco, CA', unit: 'celsius' }) || ar.finish !== 'tool') fails.push('A answer: input object');
  // family C
  const oc = toOpenAIChatRequest(req, 'gpt-6.2-sol', AGENT_PROVIDER_PRESETS.find((p) => p.id === 'openai')!);
  const asst = oc.messages[2] as any, toolMsg = oc.messages[3] as any, after = oc.messages[4] as any;
  if (typeof asst.tool_calls?.[0]?.function?.arguments !== 'string') fails.push('C arguments a JSON string');
  if (toolMsg.role !== 'tool' || toolMsg.tool_call_id !== 'toolu_01A09q90qw90lq917835lq9' || typeof toolMsg.content !== 'string') fails.push('C role tool, text only');
  if (after?.role !== 'user' || after.content?.[1]?.type !== 'image_url') fails.push('C stills in a following user message');
  const ol = toOpenAIChatRequest(req, 'qwen', AGENT_PROVIDER_PRESETS.find((p) => p.id === 'ollama')!);
  if ('tool_choice' in ol || ol.parallel_tool_calls !== false) fails.push('Ollama: no tool_choice, parallel off');
  if (toOpenAIChatRequest(req, 'm', AGENT_PROVIDER_PRESETS.find((p) => p.id === 'llamacpp')!).parallel_tool_calls !== false) fails.push('llama.cpp: parallel off');
  const cr = fromOpenAIChatResponse({ choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc123', type: 'function', function: { name: 'get_current_weather', arguments: '{\n"location": "Boston, MA"\n}' } }] } }] });
  if (!eq(cr.toolCalls[0]?.input, { location: 'Boston, MA' })) fails.push('C answer: arguments parsed');
  return { id: '11', status: fails.length ? 'fail' : 'pass', sample: fails.length ? fails.join('; ') : `anthropic tool_result[0]=${JSON.stringify({ type: tr.type, is_error: tr.is_error, content: tr.content.map((c: any) => c.type) })}; openai messages=${oc.messages.map((m) => m.role).join(',')}; ollama keys=${Object.keys(ol).join(',')}` };
}

/** Check 13: the key on disk, in a backup, in answers, in logs, in adapter errors; GET keySet only; a LAN http URL flagged. */
async function check13(): Promise<AgentAdapterProofRow> {
  const fails: string[] = [];
  const logged: string[] = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-proof-w2-'));
  const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-proof-w2-bk-'));
  let dbl: http.Server | null = null;
  const answers: string[] = [];
  try {
    const cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
    const store = new Store(dir), auth = new Auth(cfg), gov = new Governance(store), speech = new Speech(store, cfg);
    const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
    const caps = new Capabilities(store, cfg), deriv = new Derivatives(store), presence = new Presence();
    auth.resolveGrant = (t) => gov.principalForToken(t);
    const mcp = createMcp(store, auth, exporter, caps, presence, gov, speech, deriv);
    const app = createApp(cfg, store, auth, exporter, caps, deriv, presence, mcp, gov, undefined, speech);
    const base = `http://127.0.0.1:${cfg.port}`;
    const cookie = auth.issueSession(new Request(`${base}/api/v1/session`, { headers: { origin: base, 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
    const owner = { host: `127.0.0.1:${cfg.port}`, origin: base, cookie, 'content-type': 'application/json' };
    const agent = { host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'content-type': 'application/json' };
    const call = async (method: string, p: string, h: Record<string, string>, body?: unknown) => {
      const r = await app.fetch(new Request(`${base}${p}`, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      const text = await r.text(); answers.push(text); return { status: r.status, text, body: text ? JSON.parse(text) : null };
    };
    // the LABELLED local double answers 401 and echoes the key, as some providers echo a key back
    dbl = http.createServer((rq, rs) => { rq.resume(); rq.on('end', () => { rs.writeHead(401, { 'content-type': 'application/json' }); rs.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${FAKE_KEY}`, type: 'invalid_request_error', code: 'invalid_api_key' } })); }); });
    await new Promise<void>((r) => dbl!.listen(0, '127.0.0.1', r));
    const dblBase = `http://127.0.0.1:${(dbl.address() as AddressInfo).port}/v1`;

    if ((await call('PUT', '/api/v1/agent/providers/openai/key', owner, { key: FAKE_KEY })).status !== 200) fails.push('owner key PUT');
    if ((await call('PUT', '/api/v1/agent/providers/openai/key', agent, { key: 'x' })).status !== 403) fails.push('agent key PUT not 403');
    await call('PUT', '/api/v1/agent/providers/openai', owner, { baseUrl: dblBase, model: 'gpt-6.2-sol' });
    const probe = await call('POST', '/api/v1/agent/providers/openai/probe', owner, {});
    if (!(eq({ ...probe.body, detail: undefined }, { ok: false, code: 'unauthorized', model: 'gpt-6.2-sol', detail: undefined }) && typeof probe.body?.detail === 'string' && probe.body.detail.includes('[redacted]'))) fails.push(`probe ${probe.text}`); // detail: the provider's words, key redacted (lead decision 7)
    const lan = await call('PUT', '/api/v1/agent/providers/llamacpp', owner, { baseUrl: 'http://192.168.1.20:9931/v1', model: 'local-gguf' });
    const lanRow = lan.body?.providers?.find((p: any) => p.id === 'llamacpp');
    if (!(lanRow?.baseUrl === 'http://192.168.1.20:9931/v1' && lanRow?.unencrypted === true)) fails.push('LAN http not stored or not flagged');
    const view = await call('GET', '/api/v1/agent/providers', agent);
    const oRow = view.body?.providers?.find((p: any) => p.id === 'openai');
    if (!(oRow?.keySet === true && Object.keys(oRow).every((k) => !/^key$|secret|token/i.test(k)))) fails.push('GET providers not keySet-only');
    // the key file
    const keyFile = path.join(dir, 'agent', 'keys', 'openai.key');
    const mode = (fs.statSync(keyFile).mode & 0o777).toString(8);
    if (process.platform !== 'win32' && mode !== '600') fails.push(`key file mode ${mode}`);
    // what a step would store: the adapter's error detail, through the server's wrapper
    const err = await redactingAdapter(createOpenAIChatAdapter()).turn({ system: '', messages: [{ role: 'user', text: 'hi' }], tools: [], maxOutputTokens: 1, cache: false, parallelToolCalls: true }, { providerId: 'openai', family: 'openai-chat', baseUrl: dblBase, model: 'gpt-6.2-sol' }, FAKE_KEY, new AbortController().signal).catch((e: Error) => e);
    if (!(err instanceof Error) || err.message.includes(FAKE_KEY) || (err as any).code !== 'unauthorized') fails.push('adapter error detail');
    // the backup
    const dest = path.join(destRoot, 'copy');
    await backupDataDir(dir, dest);
    const files = fs.readdirSync(dest, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dest, f)).isFile());
    if (fs.existsSync(path.join(dest, 'agent'))) fails.push('agent/ in the backup');
    if (files.some((f) => fs.readFileSync(path.join(dest, f)).includes(FAKE_KEY))) fails.push('key bytes in a backup file');
    if (answers.some((a) => a.includes(FAKE_KEY))) fails.push('key in a route answer');
    if (logged.some((l) => l.includes(FAKE_KEY))) fails.push('key in a log line');
    (app as any).browserExport?.stop(); await (mcp as any).close?.(); store.close();
    return { id: '13', status: fails.length ? 'fail' : 'pass', sample: fails.length ? fails.join('; ') : `key file mode ${mode}; backup files ${files.length}, agent/ absent; ${answers.length} answers and ${logged.length} log lines searched; probe ${probe.text}; llamacpp ${JSON.stringify({ baseUrl: lanRow.baseUrl, unencrypted: lanRow.unencrypted })}; steps/SSE: W1's loop (adapter error detail searched here)` };
  } finally {
    Object.assign(console, orig);
    if (dbl) { dbl.closeAllConnections(); await new Promise((r) => dbl!.close(r)); }
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true });
  }
}

export async function runAgentAdapterProof(): Promise<AgentAdapterProofRow[]> {
  return [check11(), await check13()];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const rows = await runAgentAdapterProof();
  for (const r of rows) console.log(`${r.status === 'pass' ? 'PASS' : 'FAIL'} check ${r.id}: ${r.sample}`);
  process.exit(rows.every((r) => r.status === 'pass') ? 0 : 1);
}
