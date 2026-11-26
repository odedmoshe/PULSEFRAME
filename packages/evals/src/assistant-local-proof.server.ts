/**
 * proof:assistant-local — the server part (builder B, wave 7 assistant track): L1–L12, L14 and L15 of assistant-local-proof.ts. L13 is
 * builder C's (assistant-local-proof.ui.ts). One server, started in this process on a free 127.0.0.1 port with its data in
 * .artifacts/assistant-local-proof-<pid> (deleted when the process exits), and one labelled STAND-IN of llama.cpp's server
 * (apps/server/src/assistant/local/standIn.ts) on an ephemeral 127.0.0.1 port. NO MODEL RUNS: every check is about the editor's own
 * behaviour (loopback only, grammar first, grounding, no money, privacy at rest, honest states), never about a model's quality.
 *
 * The server's local adapter is the production one (createLlamaAdapter) with two proof seams given through startServer's
 * deps.assistant.local: `onDial` records every URL it dials (L2), and `connect` can hand it a socket whose remote address says
 * 10.0.0.5 (L3). L14 hooks net.Socket.prototype.connect for the whole process (the server, the adapter, the stand-in and this proof's
 * own client) and records each socket's real peer address (the prototype's getter, so L3's lie does not hide it).
 * L2 and L14 speak of "the whole proof": they run every other check of this part first (each check runs once; its result is kept).
 * A check returns true or the sentence that says why it failed. Checks L5, L6, L8 (its last case) and L12 need builder A's core
 * groundLocalAnswer / localPhrase; until they are merged the server refuses every local request 501 not_built (nothing is sent), so
 * every check that asks (L3, L5–L12) fails honestly until then; L1, L2's refusals, L4, L14 and L15 do not depend on A.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { ASSISTANT_PUBLIC_STATUS_KEYS, barUnderstands, interpret, type BarContext } from '@pulseframe/core';
import { ASSISTANT_LOCAL_PROMPT_DIGEST, ASSISTANT_PROMPT_DIGEST } from '@pulseframe/providers';
import { startServer, type RunningServer } from '@pulseframe/server';
import { ASSISTANT_LOCAL_SENTENCES } from '@pulseframe/server/assistant/contract.ts';
import { createLlamaAdapter } from '@pulseframe/server/assistant/local/llamaAdapter.ts';
import { startStandIn, type StandIn } from '@pulseframe/server/assistant/local/standIn.ts';
import { localPrompt } from '@pulseframe/server/assistant/localPrompt.ts';
import { assistantPrompt } from '@pulseframe/server/assistant/prompt.ts';

/** One part of the proof: built or not, and its checks (id → run). Each run returns true (pass) or a failure sentence. */
export interface AssistantLocalProofPart { built: boolean; checks: Record<string, () => Promise<true | string>> }

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, `.artifacts/assistant-local-proof-${process.pid}`);
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });

// ---------- the owner's requests (none is read by the grammar itself; asserted in L4) and the stand-in's scripted answers ----------
const LOUD = 'המוזיקה חזקה מדי, תורידי אותה בשש דציבל';
const VAGUE = 'תורידי קצת את המוזיקה';
const NOISE = 'תעשה שזה יהיה מרגש';
const TITLE_MARK = 'זיקוקונית';
const TITLE_REQ = `שימי בפתיחה כיתוב ${TITLE_MARK} בבקשה`;
const GAIN6 = JSON.stringify({ intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' } });
const TITLE = JSON.stringify({ intent: 'add_title', slots: { text: TITLE_MARK, at: 'start' } });
const NONE = '{"intent":"none","slots":{}}';
const BASE_ANSWERS: Record<string, string> = { [LOUD]: GAIN6, [VAGUE]: GAIN6, [TITLE_REQ]: TITLE, [NOISE]: NONE };
/** Planted in the project: none may reach the stand-in (L7). */
const PLANT = { project: 'הסרט של נועה ותותונית', track: 'הרצועה של נועה וגזרונית', person: 'נועה שקדונית', title: 'מזל טוב פלפלונית' };
const MONEY = /חויב|שמור|charge|reserv/i;

// ---------- L14: every socket of this process, by its real peer address ----------
const sockets: string[] = [];
let hooked = false;
function hookSockets() {
  if (hooked) return;
  hooked = true;
  const peer = Object.getOwnPropertyDescriptor(net.Socket.prototype, 'remoteAddress')!.get!;
  const orig = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const a0 = args[0] as unknown;
    const ipc = typeof a0 === 'string' || (Array.isArray(a0) && typeof (a0[0] as { path?: unknown })?.path === 'string') || (!!a0 && typeof a0 === 'object' && typeof (a0 as { path?: unknown }).path === 'string');
    if (ipc) sockets.push('ipc');
    else this.once('connect', () => { sockets.push(String(peer.call(this))); });
    return (orig as (...x: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}

type Res = { status: number; body: any };
interface Env {
  s: RunningServer; port: number; stand: StandIn; pid: string; dials: string[]; mode: { lie: boolean };
  ownerCookie: string; others: { name: string; token: string }[]; stages: Map<string, string[]>;
  owner(method: string, p: string, body?: unknown): Promise<Res>;
  as(token: string, method: string, p: string, body?: unknown): Promise<Res>;
  putLocal(local: unknown): Promise<Res>;
  ask(text: string, project?: string): Promise<Res>;
  settled(jobId: string): Promise<any>;
  chats(): number;
  ledgerRows(): number;
}
let envPromise: Promise<Env> | null = null;
let server: RunningServer | null = null, stand: StandIn | null = null;
const env = () => (envPromise ??= makeEnv());

const freePort = async () => { const x = net.createServer(); await new Promise<void>((r) => x.listen(0, '127.0.0.1', r)); const p = (x.address() as net.AddressInfo).port; await new Promise((r) => x.close(r)); return p; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const j = (v: unknown) => String(JSON.stringify(v)).slice(0, 500);

async function makeEnv(): Promise<Env> {
  hookSockets();
  fs.mkdirSync(art, { recursive: true });
  stand = await startStandIn({ answers: { ...BASE_ANSWERS } });
  const dials: string[] = [];
  const mode = { lie: false };
  const local = createLlamaAdapter({
    onDial: (u) => dials.push(u),
    connect: (host, port) => {
      const sock = net.connect({ host, port });
      if (mode.lie) Object.defineProperty(sock, 'remoteAddress', { get: () => '10.0.0.5' });
      return sock;
    },
  });
  const s = await startServer({ port: 0, host: '127.0.0.1', dataDir: path.join(art, 'data'), backupDir: null }, { assistant: { adapters: new Map(), endpoint: () => null, local } });
  server = s;
  const port = Number(new URL(s.url).port); // the port the system gave the server
  const request = (method: string, p: string, headers: Record<string, string>, body?: unknown): Promise<Res> => new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path: `/api/v1${p}`, agent: false, headers: { host: `127.0.0.1:${port}`, connection: 'close', ...(data ? { 'content-type': 'application/json', 'content-length': String(data.length) } : {}), ...headers } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => { const t = Buffer.concat(parts).toString('utf8'); let b: any = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; } resolve({ status: res.statusCode ?? 0, body: b }); });
    });
    req.on('error', (x) => resolve({ status: 0, body: { error: String(x) } }));
    req.end(data ?? undefined);
  });
  const ownerCookie = await new Promise<string>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/session', agent: false, headers: { host: `127.0.0.1:${port}`, origin: s.url, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } }, (res) => { res.resume(); const c = res.headers['set-cookie']?.[0]; if (c) resolve(c.split(';')[0]!); else reject(new Error('no owner session')); });
    req.on('error', reject);
    req.end();
  });
  const owner: Env['owner'] = (method, p, body) => request(method, p, { origin: s.url, cookie: ownerCookie }, body);
  const as: Env['as'] = (token, method, p, body) => request(method, p, { authorization: `Bearer ${token}` }, body);

  // the project: a song on its own track (so «הנמך את המוזיקה» has music), a named track, a person and a title (L7 plants)
  const pid = s.store.createProject({ name: PLANT.project, width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const song = { kind: 'audio' as const, name: 'song.mp3', contentHash: `sha256:${'2'.padStart(64, '0')}`, byteSize: 500, container: 'mp3', mimeType: 'audio/mpeg', duration: T.rt(30, 1),
    audio: { sampleRate: 48000, channels: 2, codec: 'mp3' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof' } };
  const imp = s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: song } }] });
  const songId = imp.results[0]!.output!.assetId as string;
  s.store.commit({ projectId: pid, actor: 'user:local', ops: [
    { op: 'add_track', args: { kind: 'video', name: PLANT.track } },
    { op: 'add_person', args: { name: PLANT.person } },
    { op: 'add_clip', args: { assetId: songId, start: T.frameTime(0, { num: 30, den: 1 }) } },
    { op: 'add_text', args: { text: PLANT.title, start: T.frameTime(30, { num: 30, den: 1 }), duration: T.frameTime(60, { num: 30, den: 1 }) } },
  ] });
  const ownerP = { actor: 'user:local', kind: 'user' as const, scopes: ['observe', 'edit'] as ('observe' | 'edit')[] };
  const others = [{ name: 'observer token', token: s.auth.tokens.observer }, { name: 'agent token', token: s.auth.tokens.agent }];
  for (const [name, mode2, extra] of [['observe', 'observe', {}], ['propose', 'propose', {}], ['edit', 'edit', {}], ['autopilot', 'autopilot', { projectIds: [pid] }], ['full', 'edit', { people: 'full' }]] as const)
    others.push({ name: `${name} grant`, token: s.governance.createGrant({ name: `alp-${name}`, mode: mode2, ...extra } as never, ownerP).token });

  const stages = new Map<string, string[]>();
  s.store.events.on('job', (row: { id: string; stage: string | null }) => { if (!row.stage) return; const l = stages.get(row.id) ?? []; if (l.at(-1) !== row.stage) l.push(row.stage); stages.set(row.id, l); });
  const putLocal: Env['putLocal'] = (localCfg) => owner('PUT', '/assistant/config', { adapter: 'local-llama-server', host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { titlesAndMarkers: false, peopleNames: false }, local: localCfg });
  const e: Env = {
    s, port, stand, pid, dials, mode, ownerCookie, others, stages, owner, as, putLocal,
    ask: (text, project = pid) => owner('POST', `/projects/${project}/assistant/requests`, { text, selection: [], playheadFrame: 0, lang: 'he' }),
    settled: async (jobId) => { for (let i = 0; i < 2000; i++) { const row = s.store.getJob(jobId); if (['succeeded', 'failed', 'canceled', 'submission-unknown'].includes(row.status)) return row; await sleep(10); } return s.store.getJob(jobId); },
    chats: () => stand!.requests.filter((r) => r.path === '/v1/chat/completions').length,
    ledgerRows: () => (s.store.db.prepare('SELECT COUNT(*) AS n FROM budget_ledger').get() as { n: number }).n,
  };
  const put = await putLocal({ port: stand.port, timeoutSeconds: 60 });
  if (put.status !== 200) throw new Error(`the local config was refused: ${j(put.body)}`);
  return e;
}

/** Runs one local request to its end; the job row. */
async function asked(e: Env, text: string, project?: string): Promise<any> {
  const r = await e.ask(text, project);
  if (r.status !== 202) throw new Error(`the request was answered ${r.status}: ${j(r.body)}`);
  return e.settled(r.body.jobId as string);
}
const fails = (list: (string | false | null | undefined)[]): true | string => { const f = list.filter(Boolean) as string[]; return f.length ? f.join('; ') : true; };
const reset = (e: Env) => e.stand.script({ answers: { ...BASE_ANSWERS } });
const dbFiles = (e: Env) => [e.s.store.db.name, `${e.s.store.db.name}-wal`].filter((f) => fs.existsSync(f));
const filesHolding = (e: Env, word: string) => { try { e.s.store.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* a reader holds it */ } return dbFiles(e).filter((f) => fs.readFileSync(f).includes(Buffer.from(word, 'utf8'))).map((f) => path.basename(f)); };

const L: Record<string, (e: Env) => Promise<true | string>> = {
  async L1(e) {
    const out: (string | false)[] = [];
    await e.putLocal(null);
    const off = await e.owner('GET', '/assistant/status');
    out.push(off.body?.setup !== 'provider_not_configured' && `with no port the owner's setup is ${off.body?.setup} (want provider_not_configured)`);
    await e.putLocal({ port: e.stand.port, timeoutSeconds: 60 });
    await e.owner('POST', '/assistant/local/check', {});
    const on = await e.owner('GET', '/assistant/status');
    out.push(on.body?.setup !== 'ready' && `with a port the owner's setup is ${on.body?.setup} (want ready)`);
    out.push(on.body?.local?.lastCheck?.model !== 'STAND-IN.gguf' && `the owner's status does not hold the last check: ${j(on.body?.local)}`);
    for (const o of e.others) {
      const r = await e.as(o.token, 'GET', '/assistant/status');
      const keys = Object.keys(r.body ?? {}).sort().join(',');
      out.push(keys !== [...ASSISTANT_PUBLIC_STATUS_KEYS].sort().join(',') && `${o.name} reads ${keys}`);
      const text = JSON.stringify(r.body);
      out.push((text.includes(String(e.stand.port)) || text.includes('STAND-IN') || text.includes('lastCheck')) && `${o.name} reads the port, the model or the last check`);
    }
    return fails(out);
  },
  async L2(e) {
    await runOthers(['L2', 'L14']);
    const out: (string | false)[] = [];
    const before = (await e.owner('GET', '/assistant/status')).body?.local?.port;
    for (const bad of [{ port: e.stand.port, timeoutSeconds: 60, host: '10.0.0.5' }, { port: e.stand.port, timeoutSeconds: 60, url: 'http://10.0.0.5:8791' }, { port: e.stand.port, timeoutSeconds: 60, path: '/v1/x' }, 'http://10.0.0.5:8791', { port: '10.0.0.5:8791', timeoutSeconds: 60 }]) {
      const r = await e.putLocal(bad);
      out.push(r.status !== 400 && `PUT config with local ${j(bad)} answered ${r.status} (want 400)`);
    }
    const after = (await e.owner('GET', '/assistant/status')).body?.local?.port;
    out.push(after !== before && `a refused config changed the saved port (${before} → ${after})`);
    out.push(e.dials.length === 0 && 'the adapter dialled nothing during the proof');
    const off = e.dials.filter((u) => !u.startsWith('http://127.0.0.1:'));
    out.push(off.length > 0 && `dialled ${off.slice(0, 3).join(', ')}`);
    return fails(out);
  },
  async L3(e) {
    const chats = e.chats(), conns = e.stand.connections.length;
    e.mode.lie = true;
    let row: any;
    try { row = await asked(e, LOUD); } finally { e.mode.lie = false; }
    await sleep(150);
    const fresh = e.stand.connections.slice(conns);
    return fails([
      row.error?.code !== 'local_not_loopback' && `the job ended ${row.status} ${j(row.error)} (want failed local_not_loopback)`,
      row.error?.message !== ASSISTANT_LOCAL_SENTENCES.local_not_loopback.message && 'not the decided sentence',
      fresh.length === 0 && 'the lying socket never reached the stand-in (the check proves nothing)',
      fresh.some((b) => b.length > 0) && `the stand-in received ${fresh.map((b) => b.length).join(',')} bytes`,
      e.chats() !== chats && 'the stand-in received a request body',
    ]);
  },
  async L4(e) {
    const count = () => (e.s.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
    const jobs = count(), reqs = e.stand.requests.length;
    const r = await e.ask('חתוך כאן');
    return fails([
      !barUnderstands('חתוך כאן') && 'the grammar does not read «חתוך כאן»',
      [LOUD, VAGUE, NOISE, TITLE_REQ].some((t) => barUnderstands(t)) && 'one of the proof\'s model requests is read by the grammar itself',
      (r.status !== 409 || r.body?.error?.code !== 'grammar_understood') && `answered ${r.status} ${j(r.body)} (want 409 grammar_understood)`,
      count() !== jobs && 'a job row was created',
      e.stand.requests.length !== reqs && 'the stand-in received something',
    ]);
  },
  async L5(e) {
    reset(e);
    const row = await asked(e, LOUD);
    const st = e.stages.get(row.id) ?? [];
    const next = await asked(e, NOISE); // a held lane would show waiting-for-compute here
    return fails([
      row.status !== 'succeeded' && `the job ended ${row.status} ${j(row.error)}`,
      row.output?.phrase !== 'הנמך את המוזיקה ב־6 דציבל' && `the phrase is ${j(row.output?.phrase)} (want «הנמך את המוזיקה ב־6 דציבל»)`,
      st.join(' → ') !== 'sending → awaiting-local-model → checking' && `stages ${st.join(' → ')}`,
      e.ledgerRows() !== 0 && `${e.ledgerRows()} budget_ledger rows`,
      ((e.stages.get(next.id) ?? []).includes('waiting-for-compute') || next.status !== 'succeeded') && `the lane was not free afterwards: the next request ${next.status}, stages ${(e.stages.get(next.id) ?? []).join(' → ')}`,
    ]);
  },
  async L6(e) {
    reset(e);
    const row = await asked(e, VAGUE);
    const phrase = row.output?.phrase as string | undefined;
    const doc = e.s.store.getProject(e.pid).doc;
    const ctx: BarContext = { doc, rawDoc: doc, activeSequenceId: doc.mainSequenceId, revision: e.s.store.getProject(e.pid).revision, selection: [], playheadFrame: 0, cutClipId: null, workspace: 'pro', performRecording: false, viewVariantId: null, lang: 'he', undoTarget: null, redoTarget: null, inject: (c) => c };
    const r = phrase ? interpret(phrase, ctx) : null;
    return fails([
      row.status !== 'succeeded' && `the job ended ${row.status} ${j(row.error)}`,
      j(row.output?.dropped) !== j([{ slot: 'db', why: 'ungrounded' }]) && `dropped ${j(row.output?.dropped)}`,
      phrase !== 'הנמך את המוזיקה' && `the phrase is ${j(phrase)} (want «הנמך את המוזיקה»)`,
      (!r || r.kind !== 'incomplete' || !r.missing.includes('amount')) && `interpret(phrase) is ${r ? j({ kind: r.kind, missing: (r as { missing?: unknown }).missing }) : 'not run'} (want incomplete, missing amount)`,
    ]);
  },
  async L7(e) {
    reset(e);
    await asked(e, NOISE); // at least one body of this check's own
    const doc = e.s.store.getProject(e.pid).doc;
    const clipIds = Object.values(doc.sequences[doc.mainSequenceId]!.tracks).flatMap((t) => t.clips.map((c) => c.id));
    const raw = e.stand.connections.map((b) => b.toString('utf8')).join('\n') + JSON.stringify(e.stand.requests);
    const plain = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, x: string) => String.fromCharCode(parseInt(x, 16)));
    const secrets = [e.s.auth.tokens.owner, e.s.auth.tokens.agent, e.s.auth.tokens.observer, e.ownerCookie.split('=')[1]!, ...e.others.map((o) => o.token)];
    const words = [PLANT.project, PLANT.track, PLANT.person, PLANT.title, e.pid, ...clipIds];
    return fails([
      e.chats() === 0 && 'the stand-in received no body',
      e.stand.requests.some((r) => r.headers.authorization !== undefined || r.headers.cookie !== undefined || r.headers['proxy-authorization'] !== undefined) && 'a request carried an Authorization, Proxy-Authorization or Cookie header',
      secrets.some((t) => t && plain.includes(t)) && 'a token or the owner\'s session reached the stand-in',
      ...words.map((w) => plain.includes(w) && `«${w}» of the project reached the stand-in`),
    ]);
  },
  async L8(e) {
    const P = 'חציליונת';
    const cases: [string, string, string][] = [
      [`${NOISE} א`, `${P}!`, 'not_json'],
      [`${NOISE} ב`, JSON.stringify({ intent: 'gain_change', slots: {}, extra: P }), 'wrong_shape'],
      [`${NOISE} ג`, JSON.stringify({ intent: `delete_all_${P}`, slots: {} }), 'wrong_shape'],
      [`${NOISE} ד`, JSON.stringify({ intent: 'mute', slots: { target: 'clip' } }), 'not_a_command'],
    ];
    e.stand.script({ answers: { ...BASE_ANSWERS, ...Object.fromEntries(cases.map(([t, a]) => [t, a])) } });
    const out: (string | false)[] = [];
    for (const [text, , category] of cases) {
      if (barUnderstands(text)) { out.push(`«${text}» is read by the grammar`); continue; }
      const row = await asked(e, text);
      out.push((row.error?.code !== 'invalid_model_output' || row.error?.category !== category) && `«${text}» ended ${row.status} ${j(row.error)} (want invalid_model_output ${category})`);
      out.push(JSON.stringify(row).includes(P) && `the job row of «${text}» holds the answer's planted word`);
    }
    reset(e);
    out.push(filesHolding(e, P).length > 0 && 'the answer\'s planted word is in the database files');
    return fails(out);
  },
  async L9(e) {
    await e.putLocal({ port: await freePort(), timeoutSeconds: 60 });
    let row: any;
    try { row = await asked(e, LOUD); } finally { await e.putLocal({ port: e.stand.port, timeoutSeconds: 60 }); }
    const text = JSON.stringify(row);
    return fails([
      row.error?.code !== 'local_not_running' && `the job ended ${row.status} ${j(row.error)} (want local_not_running)`,
      row.error?.message !== ASSISTANT_LOCAL_SENTENCES.local_not_running.message && 'not the decided sentence',
      (text.includes('Error:') || text.includes('    at ')) && 'the row holds a stack line',
    ]);
  },
  async L10(e) {
    const out: (string | false)[] = [];
    e.stand.script({ answers: { ...BASE_ANSWERS }, status: 503 });
    const loading = await asked(e, LOUD);
    out.push(loading.error?.code !== 'local_loading' && `a 503 ended ${loading.status} ${j(loading.error)} (want local_loading)`);
    await e.putLocal({ port: e.stand.port, timeoutSeconds: 5 });
    e.stand.script({ answers: { ...BASE_ANSWERS }, delayMs: 7000 });
    const before = e.chats();
    try {
      const slow = await asked(e, LOUD);
      out.push(slow.error?.code !== 'local_timeout' && `a late answer ended ${slow.status} ${j(slow.error)} (want local_timeout)`);
      await sleep(200);
      out.push(e.chats() - before !== 1 && `the stand-in received ${e.chats() - before} requests (want 1: no retry)`);
    } finally { reset(e); await e.putLocal({ port: e.stand.port, timeoutSeconds: 60 }); }
    return fails(out);
  },
  async L11(e) {
    // the first request holds the lane while the stand-in delays its answer; the second waits for compute (queued, nothing sent)
    e.stand.script({ answers: { ...BASE_ANSWERS }, delayMs: 4000 });
    const out: (string | false)[] = [];
    try {
      const before = e.chats();
      const a = await e.ask(LOUD), b = await e.ask(VAGUE);
      const ja = a.body.jobId as string, jb = b.body.jobId as string;
      for (let i = 0; i < 300 && !(e.s.store.getJob(ja).stage === 'awaiting-local-model' && e.s.store.getJob(jb).stage === 'waiting-for-compute'); i++) await sleep(10);
      out.push(e.s.store.getJob(jb).stage !== 'waiting-for-compute' && `the second request is ${e.s.store.getJob(jb).status} ${e.s.store.getJob(jb).stage} (want queued, waiting-for-compute)`);
      const cb = await e.owner('POST', `/jobs/${jb}/cancel`, {});
      const rb = await e.settled(jb);
      out.push((rb.status !== 'canceled' || rb.attempt !== 0) && `the cancel before the send ended ${rb.status} with attempt ${rb.attempt} (want canceled, 0)`);
      out.push(rb.error?.message !== ASSISTANT_LOCAL_SENTENCES.canceled_unsent.message && `its sentence is ${j(rb.error?.message)}`);
      const t0 = Date.now();
      const ca = await e.owner('POST', `/jobs/${ja}/cancel`, {});
      const ra = await e.settled(ja);
      out.push(ra.status !== 'canceled' && `the cancel while it answered ended ${ra.status} ${j(ra.error)}`);
      out.push(ra.error?.message !== ASSISTANT_LOCAL_SENTENCES.canceled_sent.message && `its sentence is ${j(ra.error?.message)}`);
      out.push(Date.now() - t0 > 2000 && 'the cancel did not abort the request (it waited for the answer)');
      out.push(e.chats() - before !== 1 && `the stand-in received ${e.chats() - before} requests (want 1: the canceled second one never)`);
      out.push([cb.body, ca.body, rb.error, ra.error].some((x) => MONEY.test(JSON.stringify(x))) && 'a money word');
    } finally { reset(e); }
    return fails(out);
  },
  async L12(e) {
    reset(e);
    const out: (string | false)[] = [];
    const cleared = (row: any) => row.output?.cleared === true && row.output?.phrase === null && JSON.stringify(row.output?.slots) === '{}';
    const a = await asked(e, TITLE_REQ);
    out.push((a.status !== 'succeeded' || a.output?.slots?.text !== TITLE_MARK) && `the title request ended ${a.status} ${j(a.error ?? a.output)}`);
    out.push(filesHolding(e, TITLE_MARK).length === 0 && a.status === 'succeeded' && 'control: the phrase is not in the database before taken');
    const t = await e.owner('POST', `/assistant/jobs/${a.id}/taken`, {});
    out.push(t.status !== 204 && `taken answered ${t.status}`);
    out.push(!cleared(e.s.store.getJob(a.id)) && `after taken: ${j(e.s.store.getJob(a.id).output)}`);
    out.push(filesHolding(e, TITLE_MARK).length > 0 && `after taken the title is in ${filesHolding(e, TITLE_MARK).join(', ')}`);
    const b = await asked(e, TITLE_REQ);
    await asked(e, NOISE);
    out.push(!cleared(e.s.store.getJob(b.id)) && `after the next request: ${j(e.s.store.getJob(b.id).output)}`);
    out.push(filesHolding(e, TITLE_MARK).length > 0 && 'after the next request the title is in the database files');
    const other = e.s.store.createProject({ name: 'alp-other', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
    const c = await asked(e, TITLE_REQ, other);
    out.push(c.status !== 'succeeded' && `the request on the second project ended ${c.status}`);
    const del = await e.owner('POST', `/projects/${other}/delete`, { confirmName: 'alp-other' });
    out.push(del.status !== 200 && `project delete answered ${del.status} ${j(del.body)}`);
    out.push((e.s.store.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE project_id = ?').get(other) as { n: number }).n !== 0 && 'the deleted project\'s jobs are still there');
    out.push(filesHolding(e, TITLE_MARK).length > 0 && 'after project delete the title is in the database files');
    return fails(out);
  },
  async L14() {
    await runOthers(['L2', 'L14']);
    const off = sockets.filter((a) => a !== '127.0.0.1' && a !== '::ffff:127.0.0.1' && a !== 'ipc');
    return fails([
      sockets.length === 0 && 'no socket was seen (the hook proves nothing)',
      off.length > 0 && `sockets to ${[...new Set(off)].join(', ')}`,
    ]);
  },
  async L15() {
    return fails([
      ASSISTANT_PROMPT_DIGEST !== 'sha256:90a0e5b93c02fd3999c13bf5a9c5eca28d9985d66582baed37f7c4ee4551425c' && `ASSISTANT_PROMPT_DIGEST is ${ASSISTANT_PROMPT_DIGEST}`,
      assistantPrompt().digest !== ASSISTANT_PROMPT_DIGEST && `assistantPrompt().digest is ${assistantPrompt().digest}`,
      localPrompt().digest !== ASSISTANT_LOCAL_PROMPT_DIGEST && `localPrompt().digest is ${localPrompt().digest} (pinned ${ASSISTANT_LOCAL_PROMPT_DIGEST})`,
    ]);
  },
};

/** Each check runs once; its result is kept (L2 and L14 run the others first). Errors become the failure sentence, never a pass. */
const results = new Map<string, Promise<true | string>>();
function runOnce(id: string): Promise<true | string> {
  let p = results.get(id);
  if (!p) {
    p = env().then((e) => L[id]!(e)).catch((x: unknown) => `error: ${(x as Error)?.message ?? String(x)}`);
    results.set(id, p);
  }
  return p;
}
async function runOthers(skip: string[]) { for (const id of Object.keys(L)) if (!skip.includes(id)) await runOnce(id); }

export const ASSISTANT_LOCAL_PROOF_SERVER: AssistantLocalProofPart = {
  built: true,
  checks: Object.fromEntries(Object.keys(L).map((id) => [id, () => runOnce(id)])),
};
/** Stops the proof's server and the stand-in, and deletes the data folder (the entry exits the process; a runner that does not can call this). */
export async function stopAssistantLocalProofServer() {
  if (server) { const s = server; server = null; await s.close(); }
  if (stand) { const x = stand; stand = null; await x.close(); }
  try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ }
}
