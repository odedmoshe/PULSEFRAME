/**
 * The LOCAL language assistant's model path (wave 7 track `assistant`; .artifacts/wave7/assistant-decisions.md §4). LEAD pre-pass:
 * built and tested here — the loopback rule, the wire body, the reply reader, the descriptor, the setup blockers and the prompt pin.
 * Builder B writes the adapter (apps/server/src/assistant/local/llamaAdapter.ts) against these and edits nothing here.
 *
 * NOTHING LEAVES THE MACHINE. The owner starts a llama.cpp server on this computer; the editor reaches it only at
 * http://127.0.0.1:<port>, the port being the owner's setting. No host is ever a setting, so no typed value can point the editor at
 * another machine. The adapter (node:http: no proxy, no redirect) checks the socket's remote address when it connects and aborts
 * BEFORE writing a byte unless isLoopbackRemote() says it is this machine (code not_loopback). A request carries no credential
 * (no key, no Authorization header, no cookie: LocalChatRequest has no field for one) and no project data (only the owner's
 * request text and the reviewed prompt; the visibility rules of ADR-0027 have nothing new to gate).
 *
 * This is NOT a ChatModelAdapter and the descriptor is NOT a ChatCapabilityDescriptor (verifier finding 5): the cloud path's types,
 * descriptor and pinned prompt digest (chat.ts ASSISTANT_PROMPT_DIGEST) stay byte-for-byte as they were.
 */
import { z } from 'zod';
import type { ChatBlocker, JsonSchema } from './chat.ts';
import { QualificationSchema } from './descriptor.ts';

/** The only host the local assistant is ever reached at. */
export const LOCAL_MODEL_HOST = '127.0.0.1';
/** The only paths the adapter calls: never /slots or /props (they can hold the cached prompt, i.e. the owner's words). */
export const LOCAL_MODEL_PATHS = ['/health', '/v1/models', '/v1/chat/completions'] as const;
export type LocalModelPath = (typeof LOCAL_MODEL_PATHS)[number];
/** The URL of one call: http://127.0.0.1:<port><path>. Throws on a port outside 1024–65535 or a path not in LOCAL_MODEL_PATHS. */
export function localModelUrl(port: number, path: LocalModelPath): string {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RangeError(`the local assistant's port is a whole number from 1024 to 65535 (got ${String(port)})`);
  if (!(LOCAL_MODEL_PATHS as readonly string[]).includes(path)) throw new RangeError('the local assistant is called on /health, /v1/models and /v1/chat/completions only');
  return `http://${LOCAL_MODEL_HOST}:${port}${path}`;
}
/**
 * Whether a connected socket's remote address is this machine's IPv4 loopback as the adapter dials it: exactly '127.0.0.1', or the
 * same address in IPv4-mapped IPv6 form. Anything else (another 127.x address, '::1', a LAN or public address, a proxy, undefined)
 * is false, and the adapter writes nothing.
 */
export function isLoopbackRemote(address: string | null | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

/**
 * What the adapter throws. `sent`: whether the request body had been written (only for the record; no money is involved, so a
 * local failure after the send is a plain failure, never submission-unknown).
 *  - not_running: nothing listens on the port (connection refused) — the honest setup state «העוזר המקומי לא פועל כרגע»;
 *  - loading: the server answered 503 (its model is still loading);
 *  - timeout: no whole answer within the owner's time limit;
 *  - not_loopback: the socket's remote address was not 127.0.0.1 (nothing was written);
 *  - server_error: any other HTTP status, or a reply that is not llama.cpp's shape;
 *  - canceled: the owner canceled the request.
 * `detail` is built by the adapter from a status code or a code word only: never from the reply's body or the request.
 */
export const LOCAL_ERROR_CODES = ['not_running', 'loading', 'timeout', 'not_loopback', 'server_error', 'canceled'] as const;
export type LocalErrorCode = (typeof LOCAL_ERROR_CODES)[number];
export class LocalModelError extends Error {
  constructor(public readonly code: LocalErrorCode, public readonly sent: boolean, detail: string) {
    super(detail);
    this.name = 'LocalModelError';
  }
}

/** One request: the reviewed system text, the user turn ('REQUEST (data):\n' + the owner's text), the answer schema, the token cap. No key, no project. */
export interface LocalChatRequest { system: string; user: string; schema: JsonSchema; maxTokens: number }
export type LocalFinish = 'stop' | 'length' | 'other';
/** What came back: the message text (the JSON answer, unchecked), why it ended, the model name the server reported (basename). */
export interface LocalChatResponse { text: string | null; finish: LocalFinish; model: string | null }
/** What the check found on the port (core LOCAL_RUNTIME_STATES). */
export interface LocalModelCheck { state: 'running' | 'loading' | 'stopped' | 'not_llama'; model: string | null }
/** The local model adapter (builder B: llamaAdapter.ts; tests: a labelled MOCK whose id says MOCK). */
export interface LocalModelAdapter {
  readonly id: string;
  /** GET /health then GET /v1/models on 127.0.0.1:<port>; never throws for a stopped server (state 'stopped'). */
  check(port: number, signal: AbortSignal): Promise<LocalModelCheck>;
  /** POST /v1/chat/completions with llamaChatBody(req); throws LocalModelError. */
  complete(req: LocalChatRequest, port: number, timeoutMs: number, signal: AbortSignal): Promise<LocalChatResponse>;
}

/**
 * The exact JSON body sent to llama.cpp's server (OpenAI-compatible chat completions with a JSON-schema response format). Builder B
 * checks every field against the pinned build's server README and `--help` before relying on it (several are newer than our
 * training data) and records what it found; the stand-in (local/standIn.ts) refuses a body that differs from this shape.
 */
export function llamaChatBody(req: LocalChatRequest): Record<string, unknown> {
  return {
    model: 'local',
    messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
    temperature: 0, top_k: 1, max_tokens: req.maxTokens, stream: false,
    // a cached prompt can change the logits between the first and later requests (verifier P13); nothing is claimed about a seed
    cache_prompt: false,
    response_format: { type: 'json_schema', json_schema: { name: 'command', schema: req.schema } },
    // DictaLM 3.0 is a reasoning model: no thinking block; the schema constrains the answer from its first token anyway
    chat_template_kwargs: { enable_thinking: false },
  };
}

/** The model name as shown to the owner: the last path segment, without control or format characters, at most 128 characters; null when empty. */
export function localModelName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 128);
  return clean || null;
}

const LlamaReply = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().nullable().optional() }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();
/** Reads a 200 reply of /v1/chat/completions; null when it is not that shape (the adapter then throws server_error). */
export function parseLlamaReply(body: unknown): LocalChatResponse | null {
  const p = LlamaReply.safeParse(body);
  if (!p.success) return null;
  const c = p.data.choices[0]!;
  const finish: LocalFinish = c.finish_reason === 'stop' ? 'stop' : c.finish_reason === 'length' ? 'length' : 'other';
  return { text: c.message.content ?? null, finish, model: localModelName(p.data.model) };
}

const Bilingual = z.object({ he: z.string(), en: z.string() }).strict();
/** The local assistant's capability: a bar phrase from the owner's request, on this machine. Not a DescriptorSchema member, not a chat descriptor. */
export const LocalCapabilityDescriptorSchema = z.object({
  id: z.literal('assistant.local-command'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  state: z.enum(['draft', 'published']),
  provider: z.literal('local-chat'),
  title: Bilingual,
  description: Bilingual,
  /** sha256 of canonical({ system, schema }) of the reviewed local prompt (apps/server/src/assistant/localPrompt.ts). */
  promptDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  egress: z.object({ kind: z.literal('loopback'), host: z.literal(LOCAL_MODEL_HOST) }).strict(),
  /** Exactly what the request holds besides the reviewed prompt. */
  dataSent: z.array(z.enum(['request_text', 'ui_language'])).min(1),
  cost: z.object({ basis: z.literal('local compute, no money') }).strict(),
  languages: z.array(z.enum(['he', 'en'])),
  qualification: QualificationSchema,
}).strict();
export type LocalCapabilityDescriptor = z.infer<typeof LocalCapabilityDescriptorSchema>;

/**
 * sha256 of canonical({ system, schema }) of the reviewed LOCAL prompt (apps/server/src/assistant/localPrompt.ts). Pinned separately
 * from the cloud pin: when the local prompt changes, the local setup becomes prompt_digest_mismatch until it is reviewed and this pin is
 * updated (localPrompt.test.ts prints the new digest). The cloud ASSISTANT_PROMPT_DIGEST is not touched by any of this.
 */
export const ASSISTANT_LOCAL_PROMPT_DIGEST = 'sha256:6d81c9da2547918c5fa53d8437bd40eaef6bfe31c935b29eccb03373d2c2f50b';
export const ASSISTANT_LOCAL_DATA_SENT = ['request_text', 'ui_language'] as const;
/** The local capability of wave 7: a DRAFT; never executed here (no model runs on this machine), nothing about its quality claimed. */
export const ASSISTANT_LOCAL_CAPABILITY: LocalCapabilityDescriptor = LocalCapabilityDescriptorSchema.parse({
  id: 'assistant.local-command',
  version: '0.1.0',
  state: 'draft',
  provider: 'local-chat',
  title: { he: 'עוזר שפה מקומי: פקודה לשורה', en: 'Local language assistant: a command for the bar' },
  description: {
    he: 'מודל שפה שרץ על המחשב הזה הופך בקשה חופשית לפקודה אחת של שורת הפקודות. שום דבר לא יוצא מהמחשב, ושום דבר לא משתנה עד שלוחצים Enter.',
    en: 'A language model running on this computer turns a free request into one command of the command bar. Nothing leaves the computer, and nothing changes until you press Enter.',
  },
  promptDigest: ASSISTANT_LOCAL_PROMPT_DIGEST,
  egress: { kind: 'loopback', host: LOCAL_MODEL_HOST },
  dataSent: [...ASSISTANT_LOCAL_DATA_SENT],
  cost: { basis: 'local compute, no money' },
  languages: ['he', 'en'],
  qualification: {
    schemaValid: { status: 'pass', evidence: 'LocalCapabilityDescriptorSchema parses it (packages/providers/src/localChat.test.ts)' },
    dependencyReady: { status: 'not_assessed', evidence: 'the owner starts the local server; nothing runs one on this machine' },
    licenseReviewed: { status: 'not_assessed', evidence: 'the model row is in tools/library/manifests/models-01.json; the runtime row is pending' },
    executed: { status: 'not_assessed', evidence: 'never run against a real model here; pnpm proof:assistant-local-model runs on the owner\'s laptop' },
    qualityReviewed: { status: 'not_assessed' },
    hebrewQualified: { status: 'not_assessed' },
    hardwareQualified: { status: 'not_assessed' },
  },
});

/** What localBlockers reads: the chosen adapter, the installed local adapter id (null = none), the local settings and the digest this server would send. */
export interface LocalSetupInput { adapter: string | null; installed: string | null; local: { port: number; timeoutSeconds: number } | null | undefined; promptDigest: string }
/**
 * Why the local assistant may not run, in the order the owner fixes them; empty = ready. Only codes of CHAT_BLOCKER_CODES (so core's
 * setup codes need nothing new): provider_not_configured (the local adapter is not chosen, not installed in this build, or no
 * port is saved), prompt_digest_mismatch (the local prompt is not the reviewed one). A server that is not running is not a setup
 * problem: it is found at the request (local_not_running) or by the check route.
 */
export function localBlockers(d: LocalCapabilityDescriptor, cfg: LocalSetupInput): ChatBlocker[] {
  const out: ChatBlocker[] = [];
  const missing: string[] = [];
  if (!cfg.adapter) missing.push('no adapter is chosen');
  else if (cfg.installed === null || cfg.adapter !== cfg.installed) missing.push(cfg.installed === null ? 'this build has no local adapter installed' : `the adapter "${cfg.adapter}" is not the local adapter`);
  if (!cfg.local) missing.push('no port is saved for the local assistant');
  if (missing.length) out.push({ code: 'provider_not_configured', message: `the local language assistant is not set up: ${missing.join('; ')}` });
  if (cfg.promptDigest !== d.promptDigest) out.push({ code: 'prompt_digest_mismatch', message: `the local prompt this server would send (${cfg.promptDigest}) is not the reviewed one (${d.promptDigest})` });
  return out;
}
