/**
 * pnpm proof:command-bar — the Hebrew command bar end to end (ADR-0027; .artifacts/command-bar-plan.md §9 as corrected by its
 * verifier, and the lead's decisions in .artifacts/wave5-decisions.md). The servers run in this process (startServer), the
 * editor runs in headless Chromium after `pnpm build`. Writes docs/evidence/command-bar-proof.json and screenshots in
 * .artifacts/command-bar/proof. Both servers listen on a free port the system picks (port 0); the second one has
 * the labelled MOCK adapter installed.
 *
 * The fixture (server A): three video clips with handles, one without (its source ends where the clip ends), a still picture,
 * a music track whose beats were analysed, a person with a birth date and an event; one copy for the Hebrew run, one for the
 * English run, one at 30000/1001 fps.
 *  1 owner examples: the nine owner sentences, in Hebrew and in English, typed into the real editor: the five plans commit, «סנכרן
 *    לקצב» offers choices and commits nothing, «ייצא לוואטסאפ» opens the sheet with WhatsApp chosen, «בטל» undoes the owner's
 *    newest edit, «עבור למצב הופעה» enters perform mode; in Node the same sentences on the grammar's fixture equal the golden file.
 *  2 exact time: 60 phrases × 24, 25, 30000/1001, 30, 60 fps equal an integer oracle written here; in the editor «בשנייה 3» at
 *    30000/1001 stores frameTime(90) (3.003 s) and the rounding note is on screen before Enter.
 *  3 what is shown is what runs: the ops of the preview (window.__pfBar.lastPlan, data-plan-hash) hash to the committed row's ops.
 *  4 one request = one transaction: revision +1, one history entry labelled «Command bar: <intent>», no typed text, key 'bar:'+hash.
 *  5 one undo: Ctrl+Z gives the document hash of before (transitions on N clips and the ripple delete included); Ctrl+Shift+Z the
 *    hash of after; Store.replay of that revision equals the stored document.
 *  6 never guessed: 30 requests, 0 commits; each with what was read and a nearest command or a choice, and its unread words.
 *  7 stale: a preview at r, an agent's edit the page has not heard of, Enter → 409, nothing applied, a new preview with
 *    «הפרויקט השתנה — בדקו שוב»; the second Enter commits on r+1.
 *  8 double Enter: two Enters, one transaction; the same strict request again is replayed (replayed: true), revision unchanged.
 *  9 same path: the planned ops with a propose-mode grant give a proposal and no commit; with the observer token 403.
 * 10 not connected: the owner's status says provider_not_configured and an agent's only "not connected" (three fields, no amount,
 *    host or model), the row «עוזר השפה לא מחובר», POST …/assistant/requests 409 with no job row,
 *    and 0 outbound connection attempts in the whole proof (Node sockets to non-loopback hosts are counted by a hook; Chromium is
 *    sent through a counting listener on a local port by --proxy-server).
 * 11 the model path with the labelled MOCK adapter: CONTRACT-TESTED, CREDENTIALS REQUIRED — never a pass of a real provider.
 *    11f: the pending row's «ביטול הבקשה», from the keyboard, against a MOCK answer that is held back (the canceled state in words).
 *    11g: the canceled row's «שחרור הסכום השמור», from the keyboard: the confirmation (what a release is and is not, the way out
 *    focused first, Escape keeps the amount), the release, the row's sentence; an agent's release is refused and releases nothing.
 *    11h: the same control on the held amount Settings lists for the owner (the amount 11f left held), from the keyboard.
 * 12 credential: the planted test key (not a real key) is in no JSON response and no log line; an agent PUT gives 403; the key file
 *    is 0600; a backup made during the proof holds no assistant.key or assistant.json and not the key's bytes.
 * 13 accessibility and keyboard: the audit scenario keyboard only; the heuristic audit (a11y-lib.ts) of the open preview in Hebrew
 *    and English, dark and light, with 0 findings; aria-activedescendant names the bar row; «בוצע: …» is announced after commit;
 *    focus returns to open-palette.
 * 14 determinism: the plan hash in the browser equals the one Node computes from the same text and context.
 * Not provable here: a real provider (no key exists; B-9), a screen reader (none installed), the owner's own phrasing.
 * Exit codes: 0 every check passed or is contract-tested; 1 a check failed; 2 nothing failed but a part is blocked.
 *   pnpm build && pnpm proof:command-bar
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import {
  ASSISTANT_JOB_TYPE, ASSISTANT_MAX_OUTPUT_TOKENS, barPlanHash, canonical, COMMAND_BAR_GRAMMAR_BUILT, COMMAND_BAR_LABEL, interpret,
  type BarContext, type BarResult, type IntentId, type OpCall, type ProjectDocument,
} from '@pulseframe/core';
import { startServer } from '@pulseframe/server';
import { ChatProviderError } from '@pulseframe/providers';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { drumLoop } from '../../../apps/server/src/beats.fixtures.ts';
import { f as f30, PLANTED, PLANTED_PRIVATE, plantedProject } from '../../../apps/server/src/assistant/assistantFixture.ts';
import { estimateCents } from '../../../apps/server/src/assistant/job.ts';
import { assistantPrompt, buildChatRequest, requestBytes } from '../../../apps/server/src/assistant/prompt.ts';
import { assistantSummary } from '../../../apps/server/src/assistant/summary.ts';
import { invalidMockAnswers, mockToolAnswer, TestChatAdapter } from '../../../apps/server/src/assistant/testAdapter.ts';
import { ctxFor } from '../../core/src/commandBar/fixture.testFixture.ts';
import { tokenizeBar } from '../../core/src/commandBar/match.ts';
import { parseTime } from '../../core/src/commandBar/time.ts';
import { BAR_DOM_IDS, COMMAND_BAR_TESTIDS as TID } from '../../../apps/web/src/editor/commandBar/commandBar.testids.ts';
import { barText, ltr, plain } from '../../../apps/web/src/editor/commandBar/commandBar.strings.ts';
import { auditInPage, focusAudit } from './a11y-lib.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/command-bar/proof');
const OUT = path.join(root, 'docs/evidence/command-bar-proof.json');
const R = { num: 30, den: 1 };
const NTSC = { num: 30000, den: 1001 };
const f = (n: number) => T.frameTime(n, R);
const KEY = 'TEST-DOUBLE-NOT-A-KEY-cbproof-7f3a'; // a test double, never a real credential
const HOST = 'api.example.test';
type Status = 'pass' | 'fail' | 'blocked' | 'contract-tested';
const checks: { id: string; name: string; status: Status; detail?: unknown }[] = [];
const check = (id: string, name: string, ok: boolean | 'blocked', detail?: unknown, contract = false) => {
  const status: Status = ok === 'blocked' ? 'blocked' : !ok ? 'fail' : contract ? 'contract-tested' : 'pass';
  checks.push({ id, name, status, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${{ pass: '  ok  ', fail: ' FAIL ', blocked: ' BLKD ', 'contract-tested': ' CTRT ' }[status]} ${id} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
};
const measurements: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });

// ---------------------------------------------------------------- check 10 and 12: what leaves the machine, what is logged
const outbound: string[] = [];
{
  const loopback = (h: string) => /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost|0\.0\.0\.0)$/i.test(h);
  const orig = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: any[]) {
    const o = args[0];
    if (o && typeof o === 'object' && !('path' in o && o.path)) { const host = String(o.host ?? 'localhost'); if (!loopback(host)) outbound.push(`node → ${host}:${o.port}`); }
    else if (typeof o === 'number' || (typeof o === 'string' && /^\d+$/.test(o))) { const host = typeof args[1] === 'string' ? args[1] : 'localhost'; if (!loopback(host)) outbound.push(`node → ${host}:${o}`); }
    return (orig as any).apply(this, args);
  } as typeof orig;
}
const logged: string[] = [];
for (const stream of [process.stdout, process.stderr]) {
  const w = stream.write.bind(stream);
  (stream as any).write = (chunk: any, ...rest: any[]) => { logged.push(String(chunk)); return w(chunk, ...rest); };
}
const responses: string[] = []; // every JSON body the proof received, from either server, in Node or in a page

/** Node's REST helper with a bearer token; every JSON body is kept for check 12. */
function restOf(base: string, token: string) {
  return async (method: string, p: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const r = await fetch(`${base}/api/v1${p}`, { method, headers: { authorization: `Bearer ${token}`, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    const json = (r.headers.get('content-type') ?? '').includes('json');
    if (json) responses.push(text);
    return { status: r.status, body: json && text ? JSON.parse(text) : null };
  };
}
/** The owner's own session from inside the page (the cookie the owner link set). */
async function ownerFetch(page: Page, method: string, p: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await page.evaluate(async ([m, url, b]) => {
    const res = await fetch(`/api/v1${url}`, { method: m as string, credentials: 'same-origin', headers: b !== undefined ? { 'content-type': 'application/json' } : {}, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
    return { status: res.status, text: await res.text() };
  }, [method, p, body] as const);
  responses.push(r.text);
  return { status: r.status, body: r.text ? JSON.parse(r.text) : null };
}
const watchResponses = (page: Page) => page.on('response', async (res) => {
  if (!res.url().includes('/api/') || !(res.headers()['content-type'] ?? '').includes('json')) return;
  try { responses.push(await res.text()); } catch { /* the page went away first */ }
});

// ---------------------------------------------------------------- check 2: the time table and its oracle (written here)
/** [phrase, seconds num, seconds den, whole frames] */
const TIME_PHRASES: [string, bigint, bigint, bigint][] = [
  ['שנייה', 1n, 1n, 0n], ['דקה', 60n, 1n, 0n], ['שעה', 3600n, 1n, 0n], ['פריים', 0n, 1n, 1n], ['שנייה וחצי', 3n, 2n, 0n], ['דקה ורבע', 75n, 1n, 0n],
  ['שעה וחצי', 5400n, 1n, 0n], ['דקה ושליש', 80n, 1n, 0n], ['חצי שנייה', 1n, 2n, 0n], ['רבע שעה', 900n, 1n, 0n], ['שליש שנייה', 1n, 3n, 0n], ['3 שניות', 3n, 1n, 0n],
  ['שלוש שניות', 3n, 1n, 0n], ['שתי דקות', 120n, 1n, 0n], ['דקותיים', 120n, 1n, 0n], ['שעתיים', 7200n, 1n, 0n], ['עשר שניות', 10n, 1n, 0n], ['עשרים וחמש שניות', 25n, 1n, 0n],
  ['שמונה עשרה שניות', 18n, 1n, 0n], ['90 שניות', 90n, 1n, 0n], ['1.5 שניות', 3n, 2n, 0n], ['0.04 שניות', 1n, 25n, 0n], ['2.5s', 5n, 2n, 0n], ['3s', 3n, 1n, 0n],
  ['3 sec', 3n, 1n, 0n], ['3 min', 180n, 1n, 0n], ['2 שעות', 7200n, 1n, 0n], ['12 פריימים', 0n, 1n, 12n], ['12f', 0n, 1n, 12n], ['5 frames', 0n, 1n, 5n],
  ['מאה פריימים', 0n, 1n, 100n], ['דקה ו־10 שניות', 70n, 1n, 0n], ['דקה ועשר שניות', 70n, 1n, 0n], ['דקה ועשר', 70n, 1n, 0n], ['2 דקות ו־5 שניות', 125n, 1n, 0n], ['שנייה ו־12 פריימים', 1n, 1n, 12n],
  ['שבע שניות ו־3 פריימים', 7n, 1n, 3n], ['שעה ועשרים', 4800n, 1n, 0n], ['שעה ו־2 דקות ו־3 שניות', 3723n, 1n, 0n], ['ארבע דקות ושלושים שניות', 270n, 1n, 0n], ['שלוש וחצי שניות', 7n, 2n, 0n], ['חמש דקות וחצי', 330n, 1n, 0n],
  ['1:10', 70n, 1n, 0n], ['0:05', 5n, 1n, 0n], ['10:00', 600n, 1n, 0n], ['1:02:03', 3723n, 1n, 0n], ['0:59', 59n, 1n, 0n], ['1:00:00', 3600n, 1n, 0n],
  ['בשנייה 3', 3n, 1n, 0n], ['בדקה 2', 120n, 1n, 0n], ['בפריים 30', 0n, 1n, 30n], ['לשנייה וחצי', 3n, 2n, 0n], ['ב־1:10', 70n, 1n, 0n], ['one second', 1n, 1n, 0n],
  ['two seconds', 2n, 1n, 0n], ['half a second', 1n, 2n, 0n], ['one and a half seconds', 3n, 2n, 0n], ['ten minutes', 600n, 1n, 0n], ['1 minute and 10 seconds', 70n, 1n, 0n], ['שנייה אחת', 1n, 1n, 0n],
];
const RATES: T.Rate[] = [{ num: 24, den: 1 }, { num: 25, den: 1 }, NTSC, { num: 30, den: 1 }, { num: 60, den: 1 }];
/** Nearest frame of num/den seconds at the rate, ties up, by BigInt only; whole frames added after. */
const oracle = (num: bigint, den: bigint, frames: bigint, rate: T.Rate) => Number((2n * num * BigInt(rate.num) + den * BigInt(rate.den)) / (2n * den * BigInt(rate.den)) + frames);

// ---------------------------------------------------------------- check 1 (Node): the golden file
const goldenOf = (r: BarResult): unknown => {
  if (r.kind === 'plan') return { kind: r.kind, intent: r.intent, ops: JSON.parse(canonical(r.ops)), notes: r.notes.map((n) => n.code) };
  if (r.kind === 'action') return { kind: r.kind, intent: r.intent, action: r.action };
  if (r.kind === 'ambiguous') return { kind: r.kind, intent: r.intent, choices: r.choices.map((c) => ({ en: c.en, ...(goldenOf(c.result) as object) })) };
  if (r.kind === 'refused') return { kind: r.kind, intent: r.intent, code: r.code };
  if (r.kind === 'incomplete') return { kind: r.kind, intent: r.intent, missing: r.missing };
  return { kind: r.kind, partial: r.partial };
};

/** The nine owner sentences and their English twins, with what each must do (lead decisions; plan §9 check 1). */
const EXAMPLES: { intent: IntentId; he: string; en: string; kind: 'plan' | 'ambiguous' | 'action' }[] = [
  { intent: 'split_here', he: 'חתוך כאן', en: 'split here', kind: 'plan' },
  { intent: 'delete_clip', he: 'מחק את הקליפ', en: 'delete the clip', kind: 'plan' },
  { intent: 'add_title', he: 'הוסף כותרת "יום הולדת 5" בשנייה 3', en: 'add title "Happy birthday" at 3s', kind: 'plan' },
  { intent: 'gain_change', he: 'הגבר את המוזיקה ב־3 דציבל', en: 'turn the music up 3 dB', kind: 'plan' },
  { intent: 'transitions_all', he: 'הוסף מעבר בין כל הקליפים', en: 'add transitions between all clips', kind: 'plan' },
  { intent: 'sync_beat', he: 'סנכרן לקצב', en: 'sync to the beat', kind: 'ambiguous' },
  { intent: 'export_to', he: 'ייצא לוואטסאפ', en: 'export to whatsapp', kind: 'action' },
  { intent: 'undo', he: 'בטל', en: 'undo', kind: 'action' },
  { intent: 'workspace', he: 'עבור למצב הופעה', en: 'switch to perform mode', kind: 'action' },
];
/** 30 requests that must never plan or act (plan §9 check 6). The last one is typed with nothing selected. */
const NEVER: string[] = [
  'חתוך', 'ב־3 שניות', 'הגבר ב־3', 'הקול', '1,5 שניות', 'סנכרן לקצב', 'תעשה שמח', 'הוסף', 'הוסף כותרת', 'הגבר את הקול ב־3 דציבל',
  'פצל כאן ואז מחק', 'הקליפ הבא', 'עבור', 'ייצא', 'מהירות', 'עמעום', 'השתק', 'הוסף כותרת "abc', 'הוסף אפקט קסם', 'הוסף כותרת "x" בשנייה השלישית',
  'הוסף כותרת "x" ב־3 שניות', 'הוסף כותרת "x" ב־1,5 שניות', 'hello world', 'שלום', 'חתוך את הסוף', 'הקפא', 'zoom', 'דקה ועשר', 'הוסף כותרת "x" למשך חצי פריים', 'מחק',
];

const blockAll = (why: string): never => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), result: 'BLOCKED', why }, null, 2) + '\n');
  console.error(`command-bar-proof: blocked: ${why}`);
  process.exit(2);
};

async function main() {
  if (!COMMAND_BAR_GRAMMAR_BUILT) blockAll('the command bar grammar is not built in this checkout (core COMMAND_BAR_GRAMMAR_BUILT is false)');
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) blockAll('web bundle missing: run `pnpm build` first');
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });

  // ================================================================ check 1 (Node) and check 2 (Node): no server needed
  {
    const golden = JSON.parse(fs.readFileSync(path.join(root, 'packages/core/src/commandBar/golden/intents.golden.json'), 'utf8')) as Record<string, unknown>;
    const rows = EXAMPLES.flatMap((e) => [e.he, e.en].map((text) => {
      const got = goldenOf(interpret(text, ctxFor(e.intent)));
      const want = golden[`${e.intent} · ${text}`];
      return { text, kind: (got as { kind: string }).kind, inGolden: want !== undefined, equal: want !== undefined && canonical(got) === canonical(want) };
    }));
    check('1', 'owner examples (Node): the 18 sentences on the grammar\'s fixture give their kind, and equal the golden file (canonical ops, actions, choices)', rows.every((r) => r.inGolden && r.equal) && rows.every((r, i) => r.kind === EXAMPLES[Math.floor(i / 2)]!.kind), rows.filter((r) => !r.equal || !r.inGolden));
    let n = 0, bad: unknown[] = [];
    for (const [phrase, num, den, frames] of TIME_PHRASES) for (const rate of RATES) {
      n++;
      const r = parseTime(tokenizeBar(phrase).tokens, 0, rate);
      const got = r && 'time' in r ? r.time.frame : null;
      const want = oracle(num, den, frames, rate);
      if (got !== want) bad.push({ phrase, rate: `${rate.num}/${rate.den}`, got, want });
    }
    check('2', `exact time: ${TIME_PHRASES.length} phrases × 5 rates (${n} conversions) equal the BigInt oracle written in the proof`, TIME_PHRASES.length >= 60 && bad.length === 0, { phrases: TIME_PHRASES.length, conversions: n, mismatches: bad.slice(0, 8) });
  }

  // ================================================================ fixtures
  const picA = path.join(art, 'long.mp4'), picB = path.join(art, 'short.mp4'), still = path.join(art, 'still.png'), music = path.join(art, 'music.wav');
  ff(['-f', 'lavfi', '-t', '12', '-i', 'testsrc2=s=640x360:r=30', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', picA]);
  ff(['-f', 'lavfi', '-t', '3', '-i', 'smptebars=s=640x360:r=30', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', picB]);
  ff(['-f', 'lavfi', '-i', 'color=c=0x4a6f8c:s=640x360', '-frames:v', '1', still]);
  { const loop = drumLoop(() => 120, 16, 0.5, 9); const raw = path.join(art, 'm.f32'); fs.writeFileSync(raw, Buffer.from(loop.x.buffer, loop.x.byteOffset, loop.x.byteLength)); ff(['-f', 'f32le', '-ar', String(BEAT_SR), '-ac', '1', '-i', raw, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', music]); }

  // Chromium's own traffic goes to this listener (check 10): every connection it receives is counted and closed
  const proxyHits: string[] = [];
  const counter = net.createServer((sock) => { sock.once('data', (d) => { proxyHits.push(String(d).split('\r\n')[0]!.slice(0, 120)); sock.destroy(); }); setTimeout(() => sock.destroy(), 2000); });
  await new Promise<void>((r) => counter.listen(0, '127.0.0.1', () => r()));
  const proxyPort = (counter.address() as net.AddressInfo).port;

  const s = await startServer({ port: 0, dataDir: path.join(art, 'data-a') });
  const agent = restOf(s.url, s.auth.tokens.agent);
  const observer = restOf(s.url, s.auth.tokens.observer);
  const owner = { actor: 'user:local', kind: 'user' as const, scopes: ['observe', 'edit'] as ('observe' | 'edit')[] };
  const upload = async (pid: string, file: string) => { const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'x-filename': path.basename(file), connection: 'close' }, body: fs.readFileSync(file) }); const t = await r.text(); responses.push(t); return JSON.parse(t).assetId as string; };
  const txs = async (pid: string, ops: unknown[]) => { const r = await agent('POST', `/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`fixture tx ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const stored = (pid: string) => s.store.getProject(pid);
  const docHash = (pid: string) => sha(stored(pid).doc);
  const txRow = (pid: string, rev: number) => s.store.db.prepare('SELECT id, label, ops, idempotency_key AS key, actor, kind, undoes FROM transactions WHERE project_id = ? AND revision = ?').get(pid, rev) as { id: string; label: string; ops: string; key: string | null; actor: string; kind: string; undoes: string | null } | undefined;
  const waitRev = async (pid: string, n: number, ms = 20000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(60)) if (stored(pid).revision >= n) return stored(pid).revision === n; return false; };

  /** One fixture project (plan §9): c1–c3 with handles, c4 without (its whole source), a still, the analysed music, a person, an event. */
  async function makeProject(name: string, rate: T.Rate = R) {
    const pid = (await agent('POST', '/projects', { name, width: 640, height: 360, frameRate: rate })).body.project.id as string;
    const A = await upload(pid, picA), B = await upload(pid, picB), S = await upload(pid, still), M = await upload(pid, music);
    const fr = (k: number) => T.frameTime(k, rate);
    const r = await txs(pid, [
      { op: 'add_clip', args: { assetId: A, start: fr(0), sourceIn: fr(30), duration: fr(90), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: A, start: fr(90), sourceIn: fr(130), duration: fr(90), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: A, start: fr(180), sourceIn: fr(230), duration: fr(90), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: B, start: fr(270), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: S, start: fr(360), duration: fr(60) } },
    ]);
    const [c1, c2, c3, c4, img] = (r.results as { output: { clipId: string } }[]).map((x) => x.output.clipId) as [string, string, string, string, string];
    await txs(pid, [{ op: 'add_clip', args: { assetId: M, start: fr(0), duration: fr(420) } }]);
    const a = await agent('POST', `/projects/${pid}/assets/${M}/analyze`, { kind: 'beats' });
    if (a.status !== 200) throw new Error(`beat analysis ${a.status}`);
    // the person and the event go in as the owner would add them (in-process; an agent token writes names only)
    s.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_person', args: { name: 'נועה', birthDate: '2019-03-04', form: 'f' } }, { op: 'add_event', args: { name: 'יום הולדת 5 של נועה', assetIds: [S] } }] });
    return { pid, c1, c2, c3, c4, img, still: 'still.png', short: 'short.mp4' };
  }
  const he = await makeProject('command-bar-he');
  const en = await makeProject('command-bar-en');
  const ntsc = await makeProject('command-bar-ntsc', NTSC);

  const browser = await chromium.launch({ args: [`--proxy-server=http://127.0.0.1:${proxyPort}`] });
  const report: Record<string, unknown> = {};
  try {
    const newPage = async (lang: 'he' | 'en', pid: string, theme: 'dark' | 'light' = 'dark', opts: { blockEvents?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await ctx.addInitScript('globalThis.__name = (f) => f'); // tsx/esbuild helper referenced by functions passed to page.evaluate
      await ctx.addInitScript(([l, th]) => { (globalThis as any).__pfAudioTap = true; /* exposes window.__pfPlayer, as proof:perform does */ try { localStorage.setItem('pf.lang', l); localStorage.setItem('pf.theme', th); } catch { /* storage unavailable */ } }, [lang, theme] as const);
      if (opts.blockEvents) await ctx.route('**/api/v1/projects/*/events*', (route) => route.abort());
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { logged.push(`[page ${m.type()}] ${m.text()}`); });
      watchResponses(page);
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => !!(window as any).__pfPlayer, undefined, { timeout: 30000 });
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.getByTestId('lang-toggle').click();
      return { ctx, page, errors };
    };
    const seek = async (page: Page, k: number) => { await page.evaluate((x) => (window as any).__pfPlayer.seek(x), k); await sleep(80); };
    const selectClip = async (page: Page, id: string) => {
      await page.locator(`.clip[data-clip-id="${id}"]`).click({ position: { x: 6, y: 6 } });
      await page.waitForFunction((cid) => !!document.querySelector(`.clip[data-clip-id="${cid}"].selected, .clip[data-clip-id="${cid}"][aria-selected=true], .clip[data-clip-id="${cid}"][data-selected]`), id, { timeout: 3000 }).catch(() => {});
    };
    /** Open the palette from the header button with the keyboard and type the request; wait until the bar's preview is on screen. */
    const ask = async (page: Page, text: string) => {
      if (!(await page.getByTestId('palette-dialog').count())) {
        await page.getByTestId('open-palette').focus();
        await page.keyboard.press('Enter');
        await page.getByTestId('palette-input').waitFor({ timeout: 5000 });
      }
      await page.getByTestId('palette-input').press('Control+a');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(text);
      await page.waitForFunction((q) => { const i = document.querySelector<HTMLInputElement>('[data-testid=palette-input]'); const r = document.querySelector<HTMLElement>('[data-testid=bar-result]'); return i?.value === q && !!r?.dataset.kind; }, text, { timeout: 8000 });
      // a plan's preview is rendered when the hook holds the plan the row shows (the session's own mark, after paint)
      await page.waitForFunction(() => { const r = document.querySelector<HTMLElement>('[data-testid=bar-result]'); if (r?.dataset.kind !== 'plan') return true; return (window as any).__pfBar?.lastPlan?.planHash === r.dataset.planHash; }, undefined, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      return page.evaluate(() => {
        const r = document.querySelector<HTMLElement>('[data-testid=bar-result]')!;
        const hook = (window as any).__pfBar ?? {};
        return {
          kind: r.dataset.kind!, intent: r.dataset.intent ?? null, planHash: r.dataset.planHash ?? null, lastPlan: hook.lastPlan ?? null, context: hook.context ?? null,
          steps: [...document.querySelectorAll<HTMLElement>('[data-testid=bar-step]')].map((x) => ({ op: x.dataset.op, detail: x.dataset.detail, text: x.textContent })),
          notes: [...document.querySelectorAll<HTMLElement>('[data-testid=bar-note]')].map((x) => ({ code: x.dataset.code, text: x.textContent })),
          choices: document.querySelectorAll('[data-testid=bar-choice]').length, nearest: document.querySelectorAll('[data-testid=bar-nearest]').length,
          understood: [...document.querySelectorAll('[data-testid=bar-understood]')].map((x) => x.textContent ?? ''), unread: document.querySelector('[data-testid=bar-unread]')?.textContent ?? null,
          activedescendant: document.querySelector('[data-testid=palette-input]')?.getAttribute('aria-activedescendant') ?? null, describedby: document.querySelector('[data-testid=palette-input]')?.getAttribute('aria-describedby') ?? null,
          live: document.querySelector('[data-testid=bar-live]')?.textContent ?? '', stale: !!document.querySelector('[data-testid=bar-stale]'),
          dialog: document.querySelector('[data-testid=palette-dialog]')?.textContent ?? '',
          preview: document.querySelector(`#${'pf-bar-preview'}`)?.textContent ?? '', previewInListbox: !!document.querySelector('[role=listbox] #pf-bar-preview, [role=listbox] [data-testid=bar-live]'),
        };
      });
    };
    const closePalette = async (page: Page) => { if (await page.getByTestId('palette-dialog').count()) { await page.keyboard.press('Escape'); await page.getByTestId('palette-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); } };
    const focusIsOpener = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'open-palette');
    /** Rebuilds the plan's context in Node on the server's document and interprets the same text (check 14). */
    const nodePlan = (pid: string, text: string, context: any): BarResult => {
      const doc = stored(pid).doc as ProjectDocument;
      const ctx: BarContext = { doc, rawDoc: doc, ...context, inject: (c: OpCall) => c };
      return interpret(text, ctx);
    };

    // ================================================================ checks 1, 3, 4, 5, 13, 14 in the editor, Hebrew and English
    const runExamples = async (lang: 'he' | 'en', p: typeof he) => {
      const { ctx, page, errors } = await newPage(lang, p.pid);
      const rows: unknown[] = [];
      const det: unknown[] = [];
      let allOk = true;
      for (const e of EXAMPLES) {
        const text = e[lang];
        // the context each sentence needs: a selected clip with the playhead strictly inside it (split, delete), else c3 selected
        if (e.intent === 'split_here') { await selectClip(page, p.c2); await seek(page, 135); }
        if (e.intent === 'delete_clip') { await selectClip(page, p.c1); await seek(page, 30); }
        if (e.intent === 'add_title' || e.intent === 'gain_change' || e.intent === 'transitions_all') { await selectClip(page, p.c3); await seek(page, 200); }
        const rev0 = stored(p.pid).revision, h0 = docHash(p.pid), hist0 = s.store.eventsSince(p.pid, 0).length;
        const v = await ask(page, text);
        const row: Record<string, unknown> = { text, kind: v.kind, intent: v.intent };
        let ok = v.kind === e.kind && (v.intent === e.intent || e.kind === 'ambiguous');
        if (e.kind === 'plan' && ok) {
          // check 14 before the commit: the same text and context in Node
          const np = nodePlan(p.pid, text, v.context);
          det.push({ text, browser: v.planHash, node: np.kind === 'plan' ? np.planHash : np.kind, same: np.kind === 'plan' && np.planHash === v.planHash });
          const shownOps = v.lastPlan?.ops as OpCall[];
          const live = v.live;
          await page.keyboard.press('Enter');
          await page.getByTestId('palette-dialog').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
          const committed = await waitRev(p.pid, rev0 + 1);
          await sleep(300);
          const row1 = txRow(p.pid, rev0 + 1);
          const hist1 = s.store.eventsSince(p.pid, 0);
          const rowOps = row1 ? JSON.parse(row1.ops) as OpCall[] : [];
          const h1 = docHash(p.pid);
          const focusBack = await focusIsOpener(page);
          const toast = await page.locator('.pf-toast[role=status]').allTextContents();
          // check 3: shown = run; check 4: +1, one entry, the label, no typed text, the key
          const same = !!row1 && sha(rowOps) === sha(shownOps) && barPlanHash(e.intent, rowOps, rev0) === v.planHash && v.lastPlan?.planHash === v.planHash;
          const one = committed && stored(p.pid).revision === rev0 + 1 && hist1.length === hist0 + 1 && row1?.label === COMMAND_BAR_LABEL(e.intent) && !row1.label.includes(text) && !/[א-ת"]/.test(row1.label) && row1.key === `bar:${v.planHash}` && row1.actor === 'user:local';
          // check 5: Ctrl+Z restores, Ctrl+Shift+Z re-applies, the replay equals the store
          await page.keyboard.press('Control+z');
          const undone = await waitRev(p.pid, rev0 + 2);
          const hU = docHash(p.pid);
          await sleep(200);
          await page.keyboard.press('Control+Shift+z');
          const redone = await waitRev(p.pid, rev0 + 3);
          const hR = docHash(p.pid);
          const replay = await agent('GET', `/projects/${p.pid}?revision=${rev0 + 3}`);
          const current = await agent('GET', `/projects/${p.pid}`);
          const replayOk = replay.status === 200 && sha(replay.body.project) === sha(current.body.project);
          Object.assign(row, { ops: rowOps.length, steps: v.steps.length, notes: v.notes.map((n) => n.code), shownIsRun: same, oneTransaction: one, label: row1?.label, focusBack, liveBefore: live, announced: toast.find((t) => /בוצע|Done/.test(t)) ?? null, undo: undone && hU === h0, redo: redone && hR === h1, replayOk });
          ok &&= same && one && focusBack && undone && hU === h0 && redone && hR === h1 && replayOk && v.steps.length === rowOps.length && toast.some((t) => (lang === 'he' ? /^בוצע: /.test(t) : /^Done: /.test(t)));
          if (e.intent === 'transitions_all') {
            const skipped = v.notes.find((n) => n.code === 'skipped_no_handle');
            row.skipped = skipped?.text ?? null;
            ok &&= rowOps.length >= 2 && !!skipped && skipped.text!.includes(p.still); // the cut after the clip without material is left out and NAMED
          }
          if (e.intent === 'delete_clip') { row.rippleMovesNote = v.notes.find((n) => n.code === 'ripple_moves')?.text ?? null; ok &&= !!row.rippleMovesNote && !/ 0 /.test(String(row.rippleMovesNote)); }
          if (e.intent === 'add_title') ok &&= shownOps.length === 1 && T.eq((shownOps[0]!.args as { start: T.RationalTime }).start, f(90));
        } else if (e.kind === 'ambiguous') {
          await page.keyboard.press('Enter'); // the result row of a question runs nothing
          await sleep(500);
          row.choices = v.choices;
          ok &&= v.choices >= 2 && stored(p.pid).revision === rev0 && (await page.getByTestId('palette-dialog').count()) === 1;
          await closePalette(page);
        } else if (e.intent === 'export_to') {
          await page.keyboard.press('Enter');
          const sheet = await page.getByTestId('export-sheet').waitFor({ timeout: 8000 }).then(() => true, () => false);
          const chosen = await page.locator('[data-testid=export-dest][data-id=whatsapp][aria-checked=true]').count();
          row.sheet = sheet; row.whatsappChosen = chosen === 1;
          ok &&= sheet && chosen === 1 && stored(p.pid).revision === rev0;
          await page.keyboard.press('Escape');
          await page.getByTestId('export-sheet').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        } else if (e.intent === 'undo') {
          const target = s.store.eventsSince(p.pid, 0).filter((x) => x.actor === 'user:local' && (x.kind === 'edit' || x.kind === 'redo') && !x.undoneBy).at(-1);
          await page.keyboard.press('Enter');
          const did = await waitRev(p.pid, rev0 + 1);
          const r1 = txRow(p.pid, rev0 + 1);
          row.undid = r1?.undoes === target?.transactionId ? 'the owner\'s newest edit' : r1?.undoes;
          ok &&= did && r1?.kind === 'undo' && !!target && r1.undoes === target.transactionId;
        } else if (e.intent === 'workspace') {
          await page.keyboard.press('Enter');
          const perform = await page.getByTestId('perform-view').waitFor({ timeout: 10000 }).then(() => true, () => false);
          row.performView = perform;
          ok &&= perform && stored(p.pid).revision === rev0;
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await page.keyboard.press('Shift+Digit1');
          await page.waitForFunction(() => !document.querySelector('[data-testid=perform-view]'), undefined, { timeout: 10000 }).catch(() => {});
        }
        row.ok = ok;
        allOk &&= ok;
        rows.push(row);
        await page.screenshot({ path: path.join(art, `${lang}-${e.intent}.png`) }).catch(() => {});
      }
      check('1', `owner examples in the editor (${lang === 'he' ? 'Hebrew' : 'English'}): five plans commit, «${lang === 'he' ? 'סנכרן לקצב' : 'sync to the beat'}» offers choices and commits nothing, export opens the sheet with WhatsApp chosen, undo undoes the owner\'s newest edit, perform mode opens`, allOk && errors.length === 0, { rows, pageErrors: errors.slice(0, 3) });
      const plans = rows.filter((r: any) => r.kind === 'plan') as any[];
      check('3', `what is shown is what runs (${lang}): the preview's ops (window.__pfBar.lastPlan, data-plan-hash) hash to the committed row's ops, for each of the five plans`, plans.length === 5 && plans.every((r) => r.shownIsRun), plans.map((r) => ({ text: r.text, ops: r.ops, same: r.shownIsRun })));
      check('4', `one request = one transaction (${lang}): revision +1, one history entry labelled «Command bar: <intent>» without the typed text, key 'bar:'+planHash`, plans.length === 5 && plans.every((r) => r.oneTransaction), plans.map((r) => ({ label: r.label, ok: r.oneTransaction })));
      check('5', `one undo (${lang}): Ctrl+Z gives the hash of before (ripple delete and ${plans.find((r) => r.intent === 'transitions_all')?.ops ?? '?'} transitions included), Ctrl+Shift+Z the hash of after, Store.replay equals the store`, plans.length === 5 && plans.every((r) => r.undo && r.redo && r.replayOk), plans.map((r) => ({ intent: r.intent, undo: r.undo, redo: r.redo, replay: r.replayOk })));
      check('13', `keyboard (${lang}): after each commit focus is back on open-palette and «${lang === 'he' ? 'בוצע: …' : 'Done: …'}» is announced in a polite live region (the undo toast; the bar's own region closes with the dialog)`, plans.every((r) => r.focusBack && r.announced), plans.map((r) => ({ intent: r.intent, focusBack: r.focusBack, announced: r.announced })));
      check('14', `determinism (${lang}): each plan's hash in the browser equals the hash Node computes from the same text and context`, det.length === 5 && det.every((d: any) => d.same), det);
      await ctx.close();
      return rows;
    };
    report.hebrew = await runExamples('he', he);
    report.english = await runExamples('en', en);

    // ================================================================ check 2 (editor): «בשנייה 3» at 30000/1001
    {
      const { ctx, page } = await newPage('he', ntsc.pid);
      await selectClip(page, ntsc.c2);
      const rev0 = stored(ntsc.pid).revision;
      const v = await ask(page, 'הוסף כותרת "מזל טוב" בשנייה 3');
      const note = v.notes.find((n) => n.code === 'rounded_to_frame');
      await page.keyboard.press('Enter');
      const did = await waitRev(ntsc.pid, rev0 + 1);
      const ops = JSON.parse(txRow(ntsc.pid, rev0 + 1)?.ops ?? '[]') as OpCall[];
      const start = (ops[0]?.args as { start?: T.RationalTime } | undefined)?.start;
      const doc = stored(ntsc.pid).doc;
      const title = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'text' && c.text === 'מזל טוב');
      check('2', 'exact time in the editor: «בשנייה 3» at 30000/1001 stores add_text.start = frameTime(90) = 3.003 s exactly, and the rounding note was on screen before Enter', did && !!start && T.eq(start, T.frameTime(90, NTSC)) && !!title && T.eq(title.start, T.frameTime(90, NTSC)) && !!note, { start, seconds: start ? T.toSeconds(start) : null, note: note?.text ?? null });
      await ctx.close();
    }

    // ================================================================ checks 6, 7, 8, 9 on the Hebrew project
    {
      const { ctx, page } = await newPage('he', he.pid);
      // check 6: never guessed
      await selectClip(page, he.c3); await seek(page, 200);
      const rev0 = stored(he.pid).revision;
      const rows: unknown[] = [];
      let ok6 = true;
      for (const [i, text] of NEVER.entries()) {
        if (i === NEVER.length - 1) { await closePalette(page); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await page.keyboard.press('Escape'); await sleep(200); }
        const v = await ask(page, text);
        const np = nodePlan(he.pid, text, { revision: stored(he.pid).revision, activeSequenceId: stored(he.pid).doc.mainSequenceId, selection: i === NEVER.length - 1 ? [] : [he.c3], playheadFrame: 200, cutClipId: null, workspace: 'pro', performRecording: false, viewVariantId: null, lang: 'he', undoTarget: null, redoTarget: null });
        await page.keyboard.press('Enter');
        await sleep(250);
        const unreadSpans = np.kind === 'unknown' ? np.unread.map(([a, b]) => text.slice(a, b).trim()).filter(Boolean) : [];
        const readWords = np.readings.map((x) => text.slice(x.span[0], x.span[1]).trim()).filter(Boolean);
        const offers = v.choices + v.nearest;
        const unreadShown = unreadSpans.every((w) => (v.unread ?? '').includes(w));
        // what it read: every word the grammar read is on screen; an ambiguous answer shows its readings as two or more choices
        const readShown = v.kind === 'ambiguous' ? v.choices >= 2 : readWords.every((w) => v.dialog.includes(w));
        const r = { text, kind: v.kind, nodeKind: np.kind, readWords, choices: v.choices, nearest: v.nearest, unread: v.unread };
        const good = v.kind !== 'plan' && v.kind !== 'action' && v.kind === np.kind && readShown && offers >= 1 && unreadShown;
        ok6 &&= good;
        rows.push({ ...r, ok: good });
        if ((await page.getByTestId('palette-dialog').count()) === 0) break; // an Enter that ran something closes the palette: fail
      }
      await closePalette(page);
      const committedNothing = stored(he.pid).revision === rev0;
      check('6', `never guessed: ${NEVER.length} ambiguous, incomplete, refused or unknown requests (Enter pressed on each) commit nothing; each shows every word it read (an ambiguous one: its readings as choices), every word it did not read, and at least one choice, nearest command or example; the kind equals Node's`, NEVER.length >= 30 && ok6 && committedNothing && rows.length === NEVER.length, { revisionsMoved: stored(he.pid).revision - rev0, bad: rows.filter((r: any) => !r.ok) });
      measurements.neverGuessed = rows;

      // check 8: double Enter, then the same strict request again
      await selectClip(page, he.c3); await seek(page, 210);
      const r8 = stored(he.pid).revision;
      const v8 = await ask(page, 'הוסף סמן');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await waitRev(he.pid, r8 + 1);
      await sleep(1200);
      const afterTwo = stored(he.pid).revision;
      const again = await ownerFetch(page, 'POST', `/projects/${he.pid}/transactions`, { expectedRevision: v8.lastPlan?.basisRevision, idempotencyKey: `bar:${v8.planHash}`, label: v8.lastPlan?.label, ops: v8.lastPlan?.ops });
      check('8', 'double Enter: two Enters on one plan give ONE transaction; the same strict request sent again is replayed (replayed: true) and the revision does not move', v8.kind === 'plan' && afterTwo === r8 + 1 && again.status === 200 && again.body?.replayed === true && stored(he.pid).revision === r8 + 1, { revisionsMoved: afterTwo - r8, replayStatus: again.status, replayed: again.body?.replayed ?? null });

      // check 9: the same planned ops through the shared path with other credentials
      await page.waitForFunction(() => !document.querySelector('[data-testid=palette-dialog]'), undefined, { timeout: 5000 }).catch(() => {});
      await selectClip(page, he.c3); await seek(page, 220);
      const v9 = await ask(page, 'הוסף סמן "עוגה"');
      await closePalette(page);
      const r9 = stored(he.pid).revision;
      const grant = s.governance.createGrant({ name: 'cb-proof-propose', mode: 'propose' }, owner).token;
      const proposeRest = restOf(s.url, grant);
      const asProposer = await proposeRest('POST', `/projects/${he.pid}/transactions`, { ops: v9.lastPlan?.ops, label: v9.lastPlan?.label });
      const asObserver = await observer('POST', `/projects/${he.pid}/transactions`, { ops: v9.lastPlan?.ops, label: v9.lastPlan?.label });
      check('9', 'same path, same scopes: the planned ops with a propose-mode grant give a proposal and no commit; with the observer token 403', v9.kind === 'plan' && !!asProposer.body?.proposalId && stored(he.pid).revision === r9 && asObserver.status === 403, { proposer: { status: asProposer.status, proposalId: asProposer.body?.proposalId ?? null }, observer: asObserver.status, revisionsMoved: stored(he.pid).revision - r9 });
      await ctx.close();

      // check 7: stale (a page that has not heard of the agent's edit: its event stream is cut)
      const st = await newPage('he', he.pid, 'dark', { blockEvents: true });
      await selectClip(st.page, he.c3); await seek(st.page, 230);
      const r7 = stored(he.pid).revision;
      const v7 = await ask(st.page, 'הוסף סמן');
      await txs(he.pid, [{ op: 'add_marker', args: { time: f(10), label: 'agent' } }]); // an unrelated edit by an agent
      await st.page.keyboard.press('Enter');
      await st.page.getByTestId(TID.stale).waitFor({ timeout: 10000 }).catch(() => {});
      await st.page.waitForFunction((old) => { const r = document.querySelector<HTMLElement>('[data-testid=bar-result]'); return !!r?.dataset.planHash && r.dataset.planHash !== old && (window as any).__pfBar?.lastPlan?.planHash === r.dataset.planHash; }, v7.planHash, { timeout: 10000 }).catch(() => {});
      const v7b = await st.page.evaluate(() => ({ hash: document.querySelector<HTMLElement>('[data-testid=bar-result]')?.dataset.planHash ?? null, stale: document.querySelector('[data-testid=bar-stale]')?.textContent ?? null, open: !!document.querySelector('[data-testid=palette-dialog]'), basis: (window as any).__pfBar?.lastPlan?.basisRevision ?? null }));
      const afterAgent = stored(he.pid).revision;
      const nothingApplied = afterAgent === r7 + 1 && !txRow(he.pid, r7 + 1)?.label?.startsWith('Command bar');
      await st.page.keyboard.press('Enter');
      const second = await waitRev(he.pid, r7 + 2);
      const row7 = txRow(he.pid, r7 + 2);
      check('7', 'stale: a preview made at r, an agent edits, Enter gives 409 with nothing applied and a new preview (basis r+1) under «הפרויקט השתנה — בדקו שוב»; the second Enter commits on r+1', v7.kind === 'plan' && nothingApplied && v7b.open && v7b.stale === 'הפרויקט השתנה — בדקו שוב' && v7b.hash !== v7.planHash && v7b.basis === r7 + 1 && second && row7?.label === COMMAND_BAR_LABEL('add_marker') && row7.key === `bar:${v7b.hash}`, { first: v7.planHash?.slice(0, 12), second: v7b.hash?.slice(0, 12), basis: v7b.basis, stale: v7b.stale, committedOn: row7 ? r7 + 1 : null });
      await st.ctx.close();
    }

    // ================================================================ check 10: not connected, honestly (server A has no adapter)
    {
      const { ctx, page } = await newPage('he', he.pid);
      const status = await agent('GET', '/assistant/status');
      const ownerStatus = await ownerFetch(page, 'GET', '/assistant/status');
      await ask(page, 'תעשה סרט יפה');
      const row = await page.getByTestId(TID.assistantRow).textContent();
      const jobs0 = (s.store.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE type = ?').get(ASSISTANT_JOB_TYPE) as { n: number }).n;
      const req = await ownerFetch(page, 'POST', `/projects/${he.pid}/assistant/requests`, { text: 'תעשה סרט יפה', selection: [], playheadFrame: 0 });
      const jobs1 = (s.store.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE type = ?').get(ASSISTANT_JOB_TYPE) as { n: number }).n;
      // the owner's session reads why (provider_not_configured); an agent reads connected or not, in three fields, and nothing else
      const agentKeys = Object.keys(status.body ?? {}).sort().join();
      check('10', 'not connected: GET /assistant/status says provider_not_configured to the owner\'s session and only "not connected" to an agent (connected, setup, detail; no amount, host or model), the palette row reads «עוזר השפה לא מחובר», POST …/assistant/requests gives 409 assistant_not_connected and no job row', agentKeys === 'connected,detail,setup' && status.body?.connected === false && status.body?.setup === 'not_connected' && ownerStatus.body?.setup === 'provider_not_configured' && !!row?.includes('עוזר השפה לא מחובר') && req.status === 409 && req.body?.error?.code === 'assistant_not_connected' && jobs0 === 0 && jobs1 === 0, { ownerSetup: ownerStatus.body?.setup, agentReads: status.body, row, request: req.status, code: req.body?.error?.code, jobRows: jobs1 });
      await closePalette(page);
      await ctx.close();
    }

    // ================================================================ check 13: the audit scenario, keyboard only, and the heuristic audit
    {
      const a11y: unknown[] = [];
      let ok = true;
      const fresh = { he: await makeProject('command-bar-a11y-he'), en: await makeProject('command-bar-a11y-en') };
      for (const lang of ['he', 'en'] as const) for (const theme of ['dark', 'light'] as const) {
        const p = fresh[lang];
        const { ctx, page } = await newPage(lang, p.pid, theme);
        await selectClip(page, p.c3); await seek(page, 250);
        const rev0 = stored(p.pid).revision;
        // Ctrl+K from the header button (focused as the starting point), type, hear the status
        await page.getByTestId('open-palette').focus();
        await page.keyboard.press('Control+k');
        await page.getByTestId('palette-input').waitFor({ timeout: 5000 });
        await page.keyboard.type(lang === 'he' ? 'חתוך כאן' : 'split here');
        await page.waitForFunction(() => { const r = document.querySelector<HTMLElement>('[data-testid=bar-result]'); return r?.dataset.kind === 'plan' && (window as any).__pfBar?.lastPlan?.planHash === r.dataset.planHash; }, undefined, { timeout: 8000 }).catch(() => {});
        await sleep(700); // the live region speaks after 500 ms of quiet
        const state = await page.evaluate(() => ({ active: document.querySelector('[data-testid=palette-input]')?.getAttribute('aria-activedescendant'), described: document.querySelector('[data-testid=palette-input]')?.getAttribute('aria-describedby'), live: document.querySelector('[data-testid=bar-live]')?.textContent ?? '', liveInListbox: !!document.querySelector('[role=listbox] [data-testid=bar-live], [role=listbox] #pf-bar-preview'), listboxRoles: [...document.querySelectorAll('[role=listbox] [role]')].map((e) => e.getAttribute('role')).filter((r) => r !== 'option' && r !== 'group'), rowSeen: (() => { const r = document.querySelector('[data-testid=bar-result]')!.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.height >= 30 && !!hit?.closest('[data-testid=bar-result]'); })() }));
        // dark (the product's default theme, the one pnpm audit:a11y covers): the whole page with the palette open; light: the
        // palette dialog (plan §6: a contrast check on the preview panel in both themes)
        const audit = await page.evaluate(auditInPage, theme === 'dark' ? undefined : '[data-testid=palette-dialog]');
        const pageLight = theme === 'light' ? await page.evaluate(auditInPage) : null;
        const focus = await focusAudit(page, 12, false);
        await page.screenshot({ path: path.join(art, `a11y-preview-${lang}-${theme}.png`) });
        // back in the input, Enter, focus returns to the opener, Ctrl+Z
        await page.getByTestId('palette-input').focus();
        await page.keyboard.press('Enter');
        const did = await waitRev(p.pid, rev0 + 1);
        await page.getByTestId('palette-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        const back = await focusIsOpener(page);
        await page.keyboard.press('Control+z');
        const undone = await waitRev(p.pid, rev0 + 2);
        const findings = audit.unnamed.length + audit.lowContrast.length + audit.tabIssues.length + focus.missing.length;
        const good = state.rowSeen && state.active === BAR_DOM_IDS.result && state.described === BAR_DOM_IDS.preview && state.live.length > 0 && !state.liveInListbox && state.listboxRoles.length === 0 && findings === 0 && did && back && undone;
        ok &&= good;
        a11y.push({ lang, theme, rowSeenOnScreen: state.rowSeen, scope: theme === 'dark' ? 'whole page' : 'palette dialog', outsideTheDialogInLight: pageLight ? { lowContrast: pageLight.lowContrast.length - audit.lowContrast.length, unnamed: pageLight.unnamed.length - audit.unnamed.length, sample: pageLight.lowContrast.slice(0, 4) } : null, activedescendant: state.active, describedby: state.described, live: state.live, liveOutsideListbox: !state.liveInListbox, findings, unnamed: audit.unnamed, lowContrast: audit.lowContrast, tabIssues: audit.tabIssues, noFocusRing: focus.missing, committed: did, focusBack: back, undone });
        await ctx.close();
      }
      check('13', 'accessibility: Ctrl+K, «חתוך כאן» / "split here", the polite status speaks, Enter, focus back on open-palette, Ctrl+Z — keyboard only; the bar\'s row is on screen (not clipped: the element at its centre is the row); aria-activedescendant names the bar row, aria-describedby the preview; the live region and the preview are outside the listbox; heuristic audit of the open preview: 0 findings in Hebrew and English (dark: the whole page; light: the palette dialog)', ok, a11y);
      measurements.a11y = a11y;
    }
  } finally {
    await browser.close();
    await s.close();
  }

  // ================================================================ checks 11 and 12: server B with the labelled MOCK adapter
  const adapter = new TestChatAdapter(); // TEST DOUBLE — NOT A PROVIDER: it opens no connection and answers from a script
  const backupDir = path.join(art, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const s2 = await startServer({ port: 0, dataDir: path.join(art, 'data-b'), backupDir, assistantHosts: [HOST] }, { assistant: { adapters: new Map([[adapter.id, adapter]]), endpoint: () => null } });
  const browser2 = await chromium.launch({ args: [`--proxy-server=http://127.0.0.1:${proxyPort}`] });
  try {
    const agent2 = restOf(s2.url, s2.auth.tokens.agent);
    const fx = plantedProject(s2.store);
    const doc0 = s2.store.getProject(fx.pid).doc;
    const videoClip = doc0.sequences[doc0.mainSequenceId]!.tracks.find((t) => t.id === 'trk_video')!.clips[0]!.id;
    const ctx = await browser2.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await ctx.addInitScript('globalThis.__name = (f) => f');
    await ctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
    const page = await ctx.newPage();
    page.on('console', (m) => { logged.push(`[page ${m.type()}] ${m.text()}`); });
    watchResponses(page);
    await page.goto(`${s2.ownerUrl}&project=${fx.pid}`);
    await page.getByTestId('timecode').waitFor({ timeout: 30000 });
    const config = (over: Record<string, unknown> = {}) => ({ adapter: adapter.id, host: HOST, model: 'mock-model', pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: 100_000, perRequestCapCents: 10_000, toggles: { titlesAndMarkers: false, peopleNames: false }, ...over });
    // check 12 (part): an agent may not set it up
    const agentPut = await agent2('PUT', '/assistant/config', config());
    const agentKey = await agent2('PUT', '/assistant/key', { key: KEY });
    const put = await ownerFetch(page, 'PUT', '/assistant/config', config());
    const putKey = await ownerFetch(page, 'PUT', '/assistant/key', { key: KEY });
    const status = await ownerFetch(page, 'GET', '/assistant/status');
    const keyMode = fs.statSync(path.join(s2.cfg.dataDir, 'assistant.key')).mode & 0o777;
    const proposals = () => (s2.store.db.prepare('SELECT COUNT(*) AS n FROM proposals').get() as { n: number }).n;
    const waitJob = async (jobId: string) => { for (let i = 0; i < 400; i++) { const j = await ownerFetch(page, 'GET', `/jobs/${jobId}`); if (['succeeded', 'failed', 'canceled', 'submission-unknown'].includes(j.body?.status)) return j.body; await sleep(25); } return null; };
    const ask2 = (text: string) => ownerFetch(page, 'POST', `/projects/${fx.pid}/assistant/requests`, { text, selection: [videoClip], playheadFrame: 0 });

    // (a) a valid answer: an open proposal, the revision unchanged, the preview in the editor; accept +1; undo restores
    adapter.queue(mockToolAnswer([{ op: 'split_clip', args: { clipId: videoClip, at: f30(60) } }], 'MOCK proposal'));
    const revA = s2.store.getProject(fx.pid).revision, hA = sha(s2.store.getProject(fx.pid).doc), propA = proposals(), callsA = adapter.calls;
    await page.getByTestId('open-palette').focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('palette-input').waitFor({ timeout: 5000 });
    await page.keyboard.type('חתוך את הקליפ בשנייה 2 בבקשה ותעשה יפה');
    await page.locator(`[data-testid=${TID.assistantRow}][data-ready] .pf-bar-link`).first().click({ timeout: 10000 });
    const shown = await page.getByTestId(TID.assistantProposal).waitFor({ timeout: 20000 }).then(() => true, () => false);
    const steps = await page.locator(`[data-testid=${TID.assistantProposal}] li[data-op]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-op')));
    const revOpen = s2.store.getProject(fx.pid).revision;
    const open = s2.store.db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE status = 'open'").get() as { n: number };
    await page.getByTestId(TID.assistantAccept).click();
    const accepted = await (async () => { for (let i = 0; i < 200; i++) { if (s2.store.getProject(fx.pid).revision === revA + 1) return true; await sleep(50); } return false; })();
    const hAcc = sha(s2.store.getProject(fx.pid).doc);
    await page.getByTestId('palette-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+z');
    const undone = await (async () => { for (let i = 0; i < 200; i++) { if (s2.store.getProject(fx.pid).revision === revA + 2) return true; await sleep(50); } return false; })();
    const hUndo = sha(s2.store.getProject(fx.pid).doc);
    check('11a', 'MOCK adapter: a valid answer gives an open proposal with the revision unchanged and its steps rendered in the editor; the owner\'s accept gives +1, Ctrl+Z restores the document hash', shown && steps.join() === 'split_clip' && revOpen === revA && open.n === propA + 1 && accepted && hAcc !== hA && undone && hUndo === hA && adapter.calls === callsA + 1, { steps, revisionWhileOpen: revOpen - revA, accepted, undoRestores: hUndo === hA, calls: adapter.calls - callsA }, true);
    await page.screenshot({ path: path.join(art, 'assistant-mock.png') }).catch(() => {});

    let row11f = '';
    // (f) the pending row's «ביטול הבקשה»: the MOCK adapter holds its answer; the owner cancels from the keyboard; the row says what the
    // cancel did (the request had been handed over, so it may have been charged), in the job's own facts. MOCK only: no real provider.
    {
      adapter.queue({ wait: (signal) => new Promise((_res, rej) => { signal.addEventListener('abort', () => rej(new Error('MOCK: aborted'))); }) });
      const propF = proposals(), callsF = adapter.calls, revF = s2.store.getProject(fx.pid).revision;
      await page.getByTestId('open-palette').focus();
      await page.keyboard.press('Enter');
      await page.getByTestId('palette-input').waitFor({ timeout: 5000 });
      await page.keyboard.type('תסדר לי את הסרט בבקשה');
      await page.locator(`[data-testid=${TID.assistantRow}][data-ready] .pf-bar-link`).first().click({ timeout: 10000 });
      const offered = await page.getByTestId(TID.assistantCancel).waitFor({ timeout: 10000 }).then(() => true, () => false);
      const sentToMock = await (async () => { for (let i = 0; i < 200; i++) { if (adapter.calls === callsF + 1) return true; await sleep(25); } return false; })();
      // keyboard only from here: from the palette's input, Tab reaches the button; Enter presses it
      await page.getByTestId('palette-input').focus();
      let tabs = 0;
      const onCancel = () => page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, TID.assistantCancel);
      while (tabs < 12 && !(await onCancel())) { await page.keyboard.press('Tab'); tabs++; }
      const reached = await onCancel();
      const label = await page.getByTestId(TID.assistantCancel).textContent().catch(() => null);
      // the new elements under the same heuristic audit as check 13 (a11y-lib.ts): names, contrast, tab order, and a visible focus ring on the button
      const ring = await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; if (!el) return false; const c = getComputedStyle(el); return (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== 'none'; });
      const auditPending = await page.evaluate(auditInPage);
      await page.screenshot({ path: path.join(art, 'assistant-cancel-button.png') }).catch(() => {});
      if (reached) await page.keyboard.press('Enter');
      const said = page.getByTestId(TID.assistantCanceled);
      const ended = await said.waitFor({ timeout: 15000 }).then(() => true, () => false);
      const lang = (await page.evaluate(() => document.documentElement.lang)) === 'en' ? 'en' : 'he';
      const text = await said.textContent().catch(() => null), sent = await said.getAttribute('data-sent').catch(() => null), role = await said.getAttribute('role').catch(() => null);
      const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
      const buttonGone = (await page.getByTestId(TID.assistantCancel).count()) === 0;
      const auditCanceled = await page.evaluate(auditInPage);
      const a11yFindings = [auditPending, auditCanceled].reduce((n, a) => n + a.unnamed.length + a.lowContrast.length + a.tabIssues.length, 0) + (ring ? 0 : 1);
      const row = s2.store.db.prepare('SELECT id, status, attempt FROM jobs WHERE type = ? ORDER BY created_at DESC LIMIT 1').get('assistant.propose') as { id: string; status: string; attempt: number };
      const ledger = s2.governance.ledgerFor(row.id);
      row11f = row.id;
      await page.screenshot({ path: path.join(art, 'assistant-canceled.png') }).catch(() => {});
      await page.keyboard.press('Escape');
      await page.getByTestId('palette-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      check('11f', 'MOCK adapter: while a request is pending the row offers «ביטול הבקשה»; reached from the input with Tab and pressed with Enter it cancels the job (canceled after the send, its reservation still counted), no proposal and no change are made, the row says so in words as a status, and the keyboard is back in the input; the heuristic accessibility audit of both states has 0 findings',
        offered && sentToMock && reached && ended && text === barText(lang, 'assistant.row.canceledSent') && label === barText(lang, 'assistant.row.cancel') && sent === 'true' && role === 'status' && buttonGone && focusBack === 'palette-input' && a11yFindings === 0
        && row.status === 'canceled' && row.attempt === 1 && ledger?.state === 'unknown' && proposals() === propF && adapter.calls === callsF + 1 && s2.store.getProject(fx.pid).revision === revF,
        { offered, tabsToTheButton: tabs, reached, label, text, dataSent: sent, role, buttonGone, focusAfter: focusBack, a11y: { findings: a11yFindings, focusRing: ring, controlsWhilePending: auditPending.controls, controlsAfter: auditCanceled.controls, unnamed: [...auditPending.unnamed, ...auditCanceled.unnamed].slice(0, 4), lowContrast: [...auditPending.lowContrast, ...auditCanceled.lowContrast].slice(0, 4) }, job: { status: row.status, attempt: row.attempt }, ledger: ledger?.state ?? null, proposals: proposals() - propF, calls: adapter.calls - callsF, revision: s2.store.getProject(fx.pid).revision - revF }, true);
    }

    // (g) and (h) the owner's release of an amount left held after a cancel (ADR-0027, note of 2026-11-25 "the release control"),
    // keyboard only, with the heuristic audit of every new state. MOCK only: whether a real service charged cannot be known here,
    // which is exactly what the confirmation says. 11f left one amount held; (h) releases that one from Settings, (g) one of its own.
    {
      const lang = (await page.evaluate(() => document.documentElement.lang)) === 'en' ? 'en' : 'he';
      const findingsOf = (...audits: { unnamed: unknown[]; lowContrast: unknown[]; tabIssues: unknown[] }[]) => audits.reduce((n, a) => n + a.unnamed.length + a.lowContrast.length + a.tabIssues.length, 0);
      const samples = (...audits: { unnamed: unknown[]; lowContrast: unknown[] }[]) => ({ unnamed: audits.flatMap((a) => a.unnamed).slice(0, 4), lowContrast: audits.flatMap((a) => a.lowContrast).slice(0, 4) });
      const active = () => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; const c = el ? getComputedStyle(el) : null; return { id: el?.getAttribute('data-testid') ?? null, inDialog: el?.closest('[role=dialog]')?.getAttribute('data-testid') ?? null, ring: !!c && ((c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== 'none') }; });
      const tabTo = async (id: string, max = 12) => { let n = 0; while (n < max && (await active()).id !== id) { await page.keyboard.press('Tab'); n++; } return { tabs: n, ...(await active()) }; };
      const tidy = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim();
      const ownerStatus = async () => (await ownerFetch(page, 'GET', '/assistant/status')).body as { month: string; reservedCents: number; spentCents: number; held: { jobId: string; cents: number }[] };
      /** The confirmation's three sentences for an amount, as the strings give them (what it does, what it does not, that it is final). */
      const saidFor = (cents: number) => [barText(lang, 'release.body.what', { amount: ltr(`${cents}¢`) }), barText(lang, 'release.body.charge'), barText(lang, 'release.body.final')].map(plain).join(' ');
      /** The open confirmation: where the focus starts, its words, its names, the focus trap, and the heuristic audit of the dialog and of the page under it. */
      const confirmation = async (cents: number) => {
        const shown = await page.getByTestId(TID.releaseDialog).waitFor({ timeout: 5000 }).then(() => true, () => false);
        await page.waitForTimeout(150);
        const first = await active();
        const dialog = page.getByTestId(TID.releaseDialog);
        const role = await dialog.getAttribute('role').catch(() => null), modal = await dialog.getAttribute('aria-modal').catch(() => null);
        const title = await dialog.locator('h2').textContent().catch(() => null);
        const body = plain((await dialog.locator('.pf-dialog-body').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
        const paragraphs = await dialog.locator('.pf-dialog-body p').allTextContents().catch(() => []);
        const audit = await page.evaluate(auditInPage, `[data-testid=${TID.releaseDialog}]`), auditPage = await page.evaluate(auditInPage);
        // Tab stays inside: the way out, the release, the close button, and round again
        const walk: (string | null)[] = [];
        let rings = first.ring ? 0 : 1, stayed = first.inDialog === TID.releaseDialog;
        for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); const a = await active(); walk.push(a.id ?? 'close'); if (a.inDialog !== TID.releaseDialog) stayed = false; if (!a.ring) rings++; }
        return {
          ok: shown && first.id === TID.releaseKeep && role === 'dialog' && modal === 'true' && title === barText(lang, 'release.title') && paragraphs.map((x) => plain(x).replace(/\s+/g, ' ').trim()).join(' ') === saidFor(cents).replace(/\s+/g, ' ') && stayed && rings === 0
            && walk.join() === [TID.releaseConfirm, 'close', TID.releaseKeep, TID.releaseConfirm].join() && findingsOf(audit, auditPage) === 0,
          detail: { shown, firstFocus: first.id, role, modal, title, body, tabWalk: walk, staysInside: stayed, missingRings: rings, a11y: { findings: findingsOf(audit, auditPage), controls: audit.controls, ...samples(audit, auditPage) } },
        };
      };

      // ---- (g) the canceled row
      adapter.queue({ wait: (signal) => new Promise((_res, rej) => { signal.addEventListener('abort', () => rej(new Error('MOCK: aborted'))); }) });
      const propG = proposals(), callsG = adapter.calls, revG = s2.store.getProject(fx.pid).revision;
      await page.getByTestId('open-palette').focus();
      await page.keyboard.press('Enter');
      await page.getByTestId('palette-input').waitFor({ timeout: 5000 });
      await page.keyboard.type('תקצר את הסרט בבקשה');
      await page.locator(`[data-testid=${TID.assistantRow}][data-ready] .pf-bar-link`).first().click({ timeout: 10000 });
      await page.getByTestId(TID.assistantCancel).waitFor({ timeout: 10000 }).catch(() => {});
      for (let i = 0; i < 200 && adapter.calls !== callsG + 1; i++) await sleep(25);
      await page.getByTestId(TID.assistantCancel).click().catch(() => {});
      await page.getByTestId(TID.assistantCanceled).waitFor({ timeout: 15000 }).catch(() => {});
      const jobG = (s2.store.db.prepare('SELECT id FROM jobs WHERE type = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get('assistant.propose') as { id: string }).id;
      const heldG = s2.governance.ledgerFor(jobG);
      const centsG = heldG?.reservedCents ?? -1;
      const before = await ownerStatus();
      // an agent cannot release it (REST; no MCP tool does): refused with the next step, told nothing of the ledger, and nothing is released
      const agentRelease = await agent2('POST', `/jobs/${jobG}/budget/release`, {});
      const agentStatus = await agent2('GET', '/assistant/status');
      const afterAgent = s2.governance.ledgerFor(jobG)?.state;
      // the row now offers the release (the owner's status lists the amount as held); keyboard only from here
      const offeredG = await page.getByTestId(TID.assistantRow).getByTestId(TID.releaseHeld).waitFor({ timeout: 10000 }).then(() => true, () => false);
      await page.getByTestId('palette-input').focus();
      const reachG = await tabTo(TID.releaseHeld);
      const buttonG = { label: tidy(await page.getByTestId(TID.releaseHeld).first().textContent().catch(() => null)), name: await page.getByTestId(TID.releaseHeld).getAttribute('aria-label').catch(() => null), popup: await page.getByTestId(TID.releaseHeld).getAttribute('aria-haspopup').catch(() => null), job: await page.getByTestId(TID.releaseHeld).getAttribute('data-job').catch(() => null) };
      const auditOffer = await page.evaluate(auditInPage);
      await page.screenshot({ path: path.join(art, 'assistant-release-button.png') }).catch(() => {});
      await page.keyboard.press('Enter');
      const confG = await confirmation(centsG);
      await page.screenshot({ path: path.join(art, 'assistant-release-confirm.png') }).catch(() => {});
      // Escape is the way out: the amount stays counted, the palette stays open, and the keyboard is back on the button
      await page.keyboard.press('Escape');
      await page.getByTestId(TID.releaseDialog).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      const kept = { ledger: s2.governance.ledgerFor(jobG)?.state, focus: (await active()).id, palette: await page.getByTestId('palette-dialog').count() };
      // again, and this time the release: Enter opens, Tab moves from the way out to the release, Enter releases
      await page.keyboard.press('Enter');
      await page.getByTestId(TID.releaseDialog).waitFor({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(150);
      const toConfirm = await tabTo(TID.releaseConfirm, 3);
      await page.keyboard.press('Enter');
      const saidG = page.getByTestId(TID.assistantRow).getByTestId(TID.released);
      const doneG = await saidG.waitFor({ timeout: 10000 }).then(() => true, () => false);
      await page.waitForTimeout(150);
      const releasedText = plain((await saidG.textContent().catch(() => '')) ?? ''), releasedRole = await saidG.getAttribute('role').catch(() => null);
      const afterG = { ledger: s2.governance.ledgerFor(jobG), focus: (await active()).id, button: await page.getByTestId(TID.assistantRow).getByTestId(TID.releaseHeld).count(), dialog: await page.getByTestId(TID.releaseDialog).count(), palette: await page.getByTestId('palette-dialog').count() };
      const auditReleased = await page.evaluate(auditInPage);
      const after = await ownerStatus();
      await page.screenshot({ path: path.join(art, 'assistant-released.png') }).catch(() => {});
      await page.keyboard.press('Escape');
      await page.getByTestId('palette-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      const a11yG = findingsOf(auditOffer, auditReleased) + (reachG.ring ? 0 : 1) + (toConfirm.ring ? 0 : 1);
      check('11g', 'MOCK adapter: after a cancel that came after the send, the row offers «שחרור הסכום השמור» for the amount the owner\'s status lists as held; an agent\'s release is refused (403 owner_required with the next step) and releases nothing, and its status holds no amount; from the keyboard the button opens a confirmation that says a release only takes the amount off the editor\'s own monthly count and does not undo a charge, with the way out focused first and the focus kept inside; Escape keeps the amount and returns to the button; Tab and Enter release it: the ledger row is released, the month counts exactly that much less, what was spent does not move, the row says so as a status and the keyboard is back in the input; no proposal, no change, no second call; the heuristic accessibility audit of the four states has 0 findings',
        heldG?.state === 'unknown' && centsG > 0 && before.held.some((h) => h.jobId === jobG && h.cents === centsG)
        && agentRelease.status === 403 && agentRelease.body?.error?.code === 'owner_required' && !!agentRelease.body?.error?.hint && JSON.stringify(agentRelease.body?.error?.details) === JSON.stringify({ jobId: jobG }) && afterAgent === 'unknown' && Object.keys(agentStatus.body ?? {}).sort().join() === 'connected,detail,setup'
        && offeredG && reachG.id === TID.releaseHeld && buttonG.label === barText(lang, 'release.button') && buttonG.popup === 'dialog' && buttonG.job === jobG && !!buttonG.name?.includes(`${centsG}¢`)
        && confG.ok && kept.ledger === 'unknown' && kept.focus === TID.releaseHeld && kept.palette === 1
        && toConfirm.id === TID.releaseConfirm && doneG && releasedText === plain(barText(lang, 'release.done', { amount: ltr(`${centsG}¢`) })) && releasedRole === 'status'
        && afterG.ledger?.state === 'released' && afterG.focus === 'palette-input' && afterG.button === 0 && afterG.dialog === 0 && afterG.palette === 1
        && after.reservedCents === before.reservedCents - centsG && after.spentCents === before.spentCents && !after.held.some((h) => h.jobId === jobG)
        && a11yG === 0 && proposals() === propG && adapter.calls === callsG + 1 && s2.store.getProject(fx.pid).revision === revG,
        { heldCents: centsG, agent: { status: agentRelease.status, code: agentRelease.body?.error?.code, hint: agentRelease.body?.error?.hint, ledgerAfter: afterAgent, statusKeys: Object.keys(agentStatus.body ?? {}).sort() }, offered: offeredG, tabsToTheButton: reachG.tabs, button: buttonG, confirmation: confG.detail, escape: kept, tabsToRelease: toConfirm.tabs, released: { text: releasedText, role: releasedRole, ...afterG }, month: { reservedBefore: before.reservedCents, reservedAfter: after.reservedCents, spentBefore: before.spentCents, spentAfter: after.spentCents },
          a11y: { findings: a11yG, focusRingOnButton: reachG.ring, focusRingOnRelease: toConfirm.ring, controlsOffered: auditOffer.controls, controlsReleased: auditReleased.controls, ...samples(auditOffer, auditReleased) }, proposals: proposals() - propG, calls: adapter.calls - callsG, revision: s2.store.getProject(fx.pid).revision - revG }, true);

      // ---- (h) Settings: the amount 11f left held, listed for the owner with the same control
      const listed = await ownerStatus();
      const h = listed.held[0];
      await page.getByTestId('rail-settings').focus();
      await page.keyboard.press('Enter');
      const shownH = await page.getByTestId(TID.settingsHeld).waitFor({ timeout: 8000 }).then(() => true, () => false);
      await page.getByTestId(TID.settingsHeld).scrollIntoViewIfNeeded().catch(() => {});
      const rows = await page.getByTestId(TID.settingsHeldRow).evaluateAll((els) => els.map((e) => ({ job: e.getAttribute('data-job'), how: e.getAttribute('data-how'), text: (e.textContent ?? '').replace(/[⁦-⁩]/g, '') })));
      const heading = await page.locator(`[data-testid=${TID.settingsHeld}] h4`).textContent().catch(() => null), group = await page.getByTestId(TID.settingsHeld).getAttribute('role').catch(() => null);
      // keyboard: from the per-request cap, the next stop is the held amount's button
      await page.getByTestId(TID.settingsCap).focus();
      const reachH = await tabTo(TID.releaseHeld, 4);
      const auditList = await page.evaluate(auditInPage, '[data-testid=settings-dialog]'), auditListPage = await page.evaluate(auditInPage);
      await page.screenshot({ path: path.join(art, 'assistant-settings-held.png') }).catch(() => {});
      await page.keyboard.press('Enter');
      const confH = await confirmation(h?.cents ?? -1);
      await page.keyboard.press('Escape');
      await page.getByTestId(TID.releaseDialog).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      const keptH = { ledger: h ? s2.governance.ledgerFor(h.jobId)?.state : null, focus: (await active()).id, settings: await page.getByTestId('settings-dialog').count() };
      await page.keyboard.press('Enter');
      await page.getByTestId(TID.releaseDialog).waitFor({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(150);
      const toConfirmH = await tabTo(TID.releaseConfirm, 3);
      await page.keyboard.press('Enter');
      const saidH = page.getByTestId('settings-dialog').getByTestId(TID.released);
      const doneH = await saidH.waitFor({ timeout: 10000 }).then(() => true, () => false);
      await page.waitForTimeout(200);
      const releasedH = { text: plain((await saidH.textContent().catch(() => '')) ?? ''), role: await saidH.getAttribute('role').catch(() => null), focus: await active(), rows: await page.getByTestId(TID.settingsHeldRow).count(), dialog: await page.getByTestId(TID.releaseDialog).count(), spentLine: plain(tidy(await page.getByTestId(TID.settingsSpent).first().textContent().catch(() => null))) };
      const auditDone = await page.evaluate(auditInPage, '[data-testid=settings-dialog]');
      const end = await ownerStatus();
      await page.screenshot({ path: path.join(art, 'assistant-settings-released.png') }).catch(() => {});
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      const a11yH = findingsOf(auditList, auditListPage, auditDone) + (reachH.ring ? 0 : 1) + (toConfirmH.ring ? 0 : 1) + (releasedH.focus.ring ? 0 : 1);
      check('11h', 'MOCK adapter: Settings lists the amount still held for the owner (the request 11f canceled after the send) under «סכומים שמורים», with when it was asked and how it ended; its button is the next Tab stop after the per-request cap and opens the same confirmation; Escape keeps the amount; Tab and Enter release it: the row leaves the list, the month\'s line shows that much less reserved, the sentence that says what the release did is a status and holds the focus, and the ledger row is released; the heuristic accessibility audit of the list, the confirmation and the released state has 0 findings',
        !!h && h.jobId === row11f && shownH && rows.length === 1 && rows[0]?.job === h.jobId && rows[0]?.how === 'canceled' && !!rows[0]?.text.includes(`${h.cents}¢`) && !!rows[0]?.text.includes(barText(lang, 'set.held.how.canceled')) && heading === barText(lang, 'set.held.heading') && group === 'group'
        && reachH.id === TID.releaseHeld && reachH.tabs === 1 && confH.ok && keptH.ledger === 'unknown' && keptH.focus === TID.releaseHeld && keptH.settings === 1
        && toConfirmH.id === TID.releaseConfirm && doneH && releasedH.text === plain(barText(lang, 'release.done', { amount: ltr(`${h.cents}¢`) })) && releasedH.role === 'status' && releasedH.focus.id === TID.released && releasedH.rows === 0 && releasedH.dialog === 0
        && releasedH.spentLine === plain(barText(lang, 'set.spent', { month: end.month, spent: `${end.spentCents}¢`, reserved: `${end.reservedCents}¢` })) && s2.governance.ledgerFor(h.jobId)?.state === 'released' && end.reservedCents === listed.reservedCents - h.cents && end.spentCents === listed.spentCents && end.held.length === 0 && a11yH === 0,
        { held: h ?? null, listed: { shown: shownH, heading, group, rows }, tabsFromTheCap: reachH.tabs, confirmation: confH.detail, escape: keptH, tabsToRelease: toConfirmH.tabs, released: { ...releasedH, focus: releasedH.focus.id }, month: { reservedBefore: listed.reservedCents, reservedAfter: end.reservedCents, spent: end.spentCents },
          a11y: { findings: a11yH, focusRingOnButton: reachH.ring, focusRingOnRelease: toConfirmH.ring, focusRingOnSentence: releasedH.focus.ring, controlsInSettings: auditList.controls, ...samples(auditList, auditListPage, auditDone) } }, true);
    }

    // (b) nine invalid answers
    const bad: unknown[] = [];
    let okB = true;
    for (const c of invalidMockAnswers(videoClip)) {
      adapter.queue(c.step);
      const p0 = proposals();
      const r = await ask2('בקשה');
      const job = r.status === 202 ? await waitJob(r.body.jobId) : null;
      const good = job?.status === 'failed' && job.error?.code === 'invalid_model_output' && c.reason.test(job.error?.message ?? '') && proposals() === p0;
      okB &&= good;
      bad.push({ name: c.name, status: job?.status ?? r.status, code: job?.error?.code ?? null, ok: good });
    }
    check('11b', 'MOCK adapter: each of the 9 invalid answers gives invalid_model_output with its reason, and no proposal', bad.length === 9 && okB, bad, true);

    // (c) a limit of 10¢ and an estimate of 12¢: 402 before anything is sent
    {
      const doc = s2.store.getProject(fx.pid).doc;
      const text = 'בקשה שעולה 12 סנט';
      const summary = assistantSummary(doc, { playheadFrame: 0, selection: [videoClip] }, { titlesAndMarkers: false, peopleNames: false });
      const bound = requestBytes(buildChatRequest({ model: 'mock-model', summary, text, jobId: 'x'.repeat(64), maxOutputTokens: ASSISTANT_MAX_OUTPUT_TOKENS }));
      let pIn = 0;
      for (let p = 1; p <= 5000 && !pIn; p++) if (estimateCents(bound, ASSISTANT_MAX_OUTPUT_TOKENS, { input: p, output: 1 }) === 12) pIn = p;
      const set = await ownerFetch(page, 'PUT', '/assistant/config', config({ pricesCentsPerMTok: { input: pIn, output: 1 }, perRequestCapCents: 10 }));
      const calls0 = adapter.calls;
      const r = await ownerFetch(page, 'POST', `/projects/${fx.pid}/assistant/requests`, { text, selection: [videoClip], playheadFrame: 0 });
      await sleep(300);
      check('11c', 'MOCK adapter: per-request cap 10¢ and an estimate of 12¢ give 402 budget_exceeded before anything is sent; the adapter\'s call count does not move', !!pIn && set.status === 200 && r.status === 402 && r.body?.error?.code === 'budget_exceeded' && r.body?.error?.details?.requestedCents === 12 && adapter.calls === calls0, { requestBytes: bound, priceIn: pIn, status: r.status, requestedCents: r.body?.error?.details?.requestedCents ?? null, cap: 10, calls: adapter.calls - calls0 }, true);
      await ownerFetch(page, 'PUT', '/assistant/config', config());
    }

    // (d) unknown after send: submission-unknown, the ledger unknown, no second call
    {
      adapter.queue({ throw: new ChatProviderError('unknown_after_send', false, 'MOCK: the connection dropped after the request was written') });
      const calls0 = adapter.calls;
      const r = await ask2('בקשה שנקטעה');
      const job = r.status === 202 ? await waitJob(r.body.jobId) : null;
      await sleep(1500);
      const ledger = r.status === 202 ? s2.governance.ledgerFor(r.body.jobId) : null;
      check('11d', 'MOCK adapter: unknown_after_send gives submission-unknown, the ledger stays unknown (counted), and no second call is made', job?.status === 'submission-unknown' && ledger?.state === 'unknown' && adapter.calls === calls0 + 1, { status: job?.status ?? r.status, ledger: ledger?.state ?? null, calls: adapter.calls - calls0 }, true);
    }

    // (e) the exact bytes handed to the adapter. The planted strings are searched in every byte. The word choice is the
    // two-letter word «בת», which is also a part of ordinary Hebrew words of the fixed, reviewed prompt («כתובת»): it is searched
    // in every byte the project could reach (the messages: summary and request text), and the fixed part (system text and tool)
    // must be byte-identical to the reviewed prompt, which no project shapes.
    {
      const reqs = adapter.requests.map((x) => x.req);
      const fixed = assistantPrompt();
      const fixedSame = reqs.every((q) => q.system === fixed.system && canonical(q.tool) === canonical(fixed.tool));
      const all = JSON.stringify(reqs);
      const variable = JSON.stringify(reqs.map((q) => q.messages));
      const planted = [...PLANTED_PRIVATE.filter((v) => v !== PLANTED.formWord), PLANTED.personName, PLANTED.title, PLANTED.markerLabel, PLANTED.trackName];
      const found = planted.filter((v) => all.includes(v));
      const formInVariable = variable.includes(PLANTED.formWord);
      const formAsWord = new RegExp(`(^|[^\\u05D0-\\u05EA])${PLANTED.formWord}([^\\u05D0-\\u05EA]|$)`).test(all);
      check('11e', `MOCK adapter: the ${reqs.length} requests handed to the adapter (${all.length} bytes) hold none of the planted private strings (birth date, capture date, event, file name, transcript word, GPS-like path; with the switches off the name, title, marker and track name), nor the word choice «בת» in what the project shapes nor as a word anywhere, nor the key; the system text and tool are the reviewed prompt byte for byte`, reqs.length >= 11 && fixedSame && found.length === 0 && !formInVariable && !formAsWord && !all.includes(KEY), { requests: reqs.length, fixedSame, found, formInVariable, formAsWord }, true);
    }

    // check 12: credential
    const backup = await ownerFetch(page, 'POST', '/backup');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = fs.existsSync(backupDir) ? walk(backupDir) : [];
    const keyFiles = files.filter((x) => /assistant\.(key|json)$/.test(x));
    const keyBytes = files.filter((x) => fs.readFileSync(x).includes(Buffer.from(KEY)));
    report.credential = { agentPut: agentPut.status, agentKey: agentKey.status, ownerPut: put.status, ownerKey: putKey.status, setup: status.body?.setup, keyFileMode: keyMode.toString(8), backup: backup.status, backupFiles: files.length, assistantFilesInBackup: keyFiles, filesHoldingTheKey: keyBytes };
    const scanned = { responses: responses.length, logLines: logged.length };
    const inResponses = responses.filter((t) => t.includes(KEY) || t.includes('cbproof-7f3a')).length;
    const inLogs = logged.filter((t) => t.includes(KEY) || t.includes('cbproof-7f3a')).length;
    check('12', 'credential: the planted test key is in no JSON response and no log line of the proof; an agent PUT of config or key gives 403; the key file is 0600; a backup made now holds no assistant.key or assistant.json and not the key\'s bytes', agentPut.status === 403 && agentKey.status === 403 && put.status === 200 && putKey.status === 200 && status.body?.setup === 'ready' && keyMode === 0o600 && backup.status === 200 && files.length > 0 && keyFiles.length === 0 && keyBytes.length === 0 && inResponses === 0 && inLogs === 0, { ...(report.credential as object), scanned, inResponses, inLogs });
    await ctx.close();
  } finally {
    await browser2.close();
    await s2.close();
  }

  // check 10 (whole proof): nothing tried to leave the machine
  await new Promise<void>((r) => counter.close(() => r()));
  check('10', 'not connected: 0 outbound connection attempts during the whole proof (Node sockets to non-loopback hosts; Chromium through the counting listener)', outbound.length === 0 && proxyHits.length === 0, { node: outbound.slice(0, 10), chromium: proxyHits.slice(0, 10) });

  // ---------------------------------------------------------------- evidence
  const counts = { pass: 0, fail: 0, blocked: 0, 'contract-tested': 0 } as Record<Status, number>;
  for (const c of checks) counts[c.status]++;
  const result = counts.fail ? 'FAILED' : counts.blocked ? 'BLOCKED' : 'PASSED';
  const evidence = {
    ranAt: new Date().toISOString(), result, counts,
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' },
    scope: 'Headless Chromium on the built editor and in-process servers. The model path (11a–11h) ran against TEST-MOCK-chat, a labelled test double that opens no connection: contract-tested, credentials required — no real provider was called and no network adapter exists. Not provable here: a real provider (no key exists), a screen reader, the owner\'s own phrasing. Timings are one sample.',
    checks, measurements, report,
  };
  const text = JSON.stringify(evidence, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  if (text.includes(KEY)) throw new Error('the evidence would hold the planted key');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text + '\n');
  console.log(`\ncommand-bar proof ${result}: pass ${counts.pass}, contract-tested ${counts['contract-tested']}, fail ${counts.fail}, blocked ${counts.blocked}. Evidence: docs/evidence/command-bar-proof.json`);
  process.exitCode = counts.fail ? 1 : counts.blocked ? 2 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
