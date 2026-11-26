/**
 * pnpm proof:craft, part versions (W2): checks V1–V7, V9–V11 of craft-proof.ts over the REAL server (startServer on 127.0.0.1,
 * its own data directory) through REST, with the owner's session, the built-in agent and observer tokens and grants made for the
 * proof. Fixtures are SYNTHETIC: barcode clips made by packages/fixtures (ffmpeg), typed Hebrew titles, a typed person.
 * Each check returns true, or a sentence; a sentence that begins with "BLOCKED" means it could not run here (the still needs the
 * built web app, `pnpm build`), never a pass.
 * Run alone: `tsx packages/evals/src/craft-proof.versions.ts` (exit 0 all pass, 1 a failure, 2 only blocked ones besides passes).
 *
 * What is NOT checked here: V3's sentences in Hebrew and English are the editor's (W3, craft.strings.ts); this part checks the
 * counts and the names they are made from. V10's "render cache empty": no export runs here, so the check is that the commit path's
 * privacy purge ran for the restore's revision and the cache index holds no segment of the project.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '@pulseframe/time';
import { canonical, CRAFT_LIMITS, entityMap, findClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer, type RunningServer } from '@pulseframe/server';
import { backupDataDir } from '../../../apps/server/src/backup.ts';
import { CRAFT_SERVER_REFUSALS, VERSIONS_TABLE } from '../../../apps/server/src/craft/contract.ts';
import { deleteProject } from '../../../apps/server/src/storage.ts';
import type { CraftProofPart } from './craft-proof.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const BIRTH = '2014-11-04';
const OWNER = { actor: 'user:local', kind: 'user' as const, scopes: ['observe' as const, 'edit' as const] };
const region = { shape: 'rect', x: 0, y: 0, width: 0.3, height: 0.3, pad: 0, feather: 0, style: 'blur', strength: 1, color: '#000000', onLoss: 'frame', motionTrackId: null };
const EDIT = new Set(['sequence', 'track', 'trackOrder', 'clip', 'marker', 'variant', 'recipeRun']);
const editOf = (doc: ProjectDocument) => canonical([doc.settings, [...entityMap(doc)].filter(([, s]) => EDIT.has(s.kind)).sort(([a], [b]) => (a < b ? -1 : 1))]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

interface Ctx {
  s: RunningServer; art: string; pid: string; clipA: string; clipB: string; title: string; seaHash: string;
  who: { owner: Record<string, string>; agent: Record<string, string>; observer: Record<string, string>; limited: Record<string, string> };
  call(who: Record<string, string>, method: string, p: string, body?: unknown): Promise<{ status: number; body: any; text: string; bytes: Buffer }>;
  tx(pid: string, ops: OpCall[]): Promise<any>;
  upload(pid: string, file: string): Promise<string>;
  whole(pid?: string): { doc: ProjectDocument; revision: number };
  purges: { projectId: string; revision: number }[];
}
let ctx: Promise<Ctx> | null = null;
/** One server and one project for every check, made once; closed when the last check has run. */
function setup(): Promise<Ctx> {
  ctx ??= (async () => {
    const art = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-craft-versions-'));
    const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
    // observe (not replace) the commit path's privacy purge, for V10
    const purges: Ctx['purges'] = [];
    const purge = s.store.onPrivacyChange;
    s.store.onPrivacyChange = (projectId, revision) => { purges.push({ projectId, revision }); purge?.(projectId, revision); };
    const cookie = s.auth.issueSession(new Request(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner } })).split(';')[0]!;
    const host = new URL(s.url).host;
    const limitedToken = s.governance.createGrant({ name: 'one track', mode: 'edit', trackIds: ['trk_none'] }, OWNER).token;
    const who = {
      owner: { host, origin: s.url, cookie, connection: 'close' },
      agent: { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' },
      observer: { authorization: `Bearer ${s.auth.tokens.observer}`, connection: 'close' },
      limited: { authorization: `Bearer ${limitedToken}`, connection: 'close' },
    };
    const call: Ctx['call'] = async (h, method, p, body) => {
      const r = await fetch(`${s.url}/api/v1${p}`, { method, headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const bytes = Buffer.from(await r.arrayBuffer());
      const json = (r.headers.get('content-type') ?? '').includes('json');
      return { status: r.status, body: json ? JSON.parse(bytes.toString('utf8')) : null, text: json ? bytes.toString('utf8') : '', bytes };
    };
    const tx: Ctx['tx'] = async (pid, ops) => { const r = await call(who.owner, 'POST', `/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${r.text.slice(0, 300)}`); return r.body; };
    const upload: Ctx['upload'] = async (pid, file) => {
      const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...who.owner, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) });
      const b = (await r.json()) as any;
      if (!b.assetId) throw new Error(`upload failed: ${JSON.stringify(b).slice(0, 300)}`);
      return b.assetId as string;
    };
    await generateBarcodeFixture({ out: path.join(art, 'sea.mp4'), width: 320, height: 180, frames: 90 });
    await generateBarcodeFixture({ out: path.join(art, 'new.mp4'), width: 320, height: 180, frames: 60 });
    await generateBarcodeFixture({ out: path.join(art, 'beach.mp4'), width: 320, height: 180, frames: 45 });
    const pid = (await call(who.owner, 'POST', '/projects', { name: 'גרסאות', width: 320, height: 180, frameRate: R })).body.project.id as string;
    const sea = await upload(pid, path.join(art, 'sea.mp4'));
    const clipA = (await tx(pid, [{ op: 'add_clip', args: { assetId: sea, start: f(0), duration: f(40), withLinkedAudio: false } }])).results[0].output.clipId as string;
    const trackId = findClip(s.store.wholeProject(pid).doc, clipA)!.track.id;
    const clipB = (await tx(pid, [{ op: 'add_clip', args: { assetId: sea, trackId, start: f(40), sourceIn: f(40), duration: f(20), withLinkedAudio: false } }])).results[0].output.clipId as string;
    const title = (await tx(pid, [{ op: 'add_text', args: { text: 'שלום נעה', start: f(0), duration: f(60) } }])).results[0].output.clipId as string;
    await tx(pid, [{ op: 'add_person', args: { name: 'נועה', birthDate: BIRTH, form: 'f' } }]);
    const seaHash = s.store.wholeProject(pid).doc.assets[sea]!.contentHash;
    return { s, art, pid, clipA, clipB, title, seaHash, who, call, tx, upload, whole: (p = pid) => s.store.wholeProject(p), purges };
  })();
  return ctx;
}
const canStill = () => fs.existsSync(path.join(ROOT, 'apps', 'web', 'dist', 'render.html'));
const refusedAs = (r: { status: number; body: any }, key: keyof typeof CRAFT_SERVER_REFUSALS) => r.status === CRAFT_SERVER_REFUSALS[key].status && r.body?.error?.code === CRAFT_SERVER_REFUSALS[key].code;
const save = async (c: Ctx, name: string, who = c.who.owner, pid = c.pid) => c.call(who, 'POST', `/projects/${pid}/versions`, { name });

// Shared between the checks, in order: the version saved before the edits, and the still taken then.
let vA = '', stillA: Buffer | null = null, revA = 0, docA: ProjectDocument | null = null;

async function V1(): Promise<true | string> {
  const c = await setup();
  const before = c.whole();
  if (canStill()) { const r = await c.call(c.who.owner, 'GET', `/projects/${c.pid}/frame?index=20`); if (r.status !== 200) return `the still before the edits answered ${r.status}`; stillA = r.bytes; }
  const r = await save(c, 'לפני הקיצור');
  if (r.status !== 201) return `save answered ${r.status} ${r.text.slice(0, 200)}`;
  vA = r.body.version.id; revA = before.revision; docA = before.doc;
  const row = c.s.store.db.prepare(`SELECT doc, revision FROM ${VERSIONS_TABLE} WHERE id = ?`).get(vA) as { doc: string; revision: number };
  const copy = canonical(JSON.parse(row.doc));
  if (row.revision !== before.revision) return `the version points at revision ${row.revision}, the project was at ${before.revision}`;
  if (copy !== canonical(c.s.store.replay(c.pid, row.revision).doc)) return 'the copy differs from replay(revision)';
  if (copy !== canonical(before.doc)) return 'the copy differs from the current document';
  if (c.whole().revision !== before.revision) return 'saving a version changed the project';
  return true;
}

/** The known edits after version A: clip A 12 frames shorter, clip B deleted, the title reworded, an effect added to clip A. */
let edited = false;
async function knownEdits(c: Ctx) {
  if (edited) return;
  edited = true;
  await c.tx(c.pid, [{ op: 'trim_clip', args: { clipId: c.clipA, edge: 'end', to: f(28) } }, { op: 'delete_clip', args: { clipId: c.clipB } }, { op: 'update_text', args: { clipId: c.title, text: 'שלום נועה' } }, { op: 'add_effect', args: { clipId: c.clipA, type: 'blur.gaussian' } }]);
}

async function V2(): Promise<true | string> {
  const c = await setup();
  await knownEdits(c);
  const out = await c.call(c.who.owner, 'GET', `/projects/${c.pid}/versions/${vA}/frame?index=60`);
  if (!refusedAs(out, 'frameOutOfRange')) return `frame 60 of a 60-frame version answered ${out.status} ${out.body?.error?.code}`;
  if (!canStill() || !stillA) return 'BLOCKED: the still needs the built web app (pnpm build); version_frame_out_of_range was checked';
  const a = await c.call(c.who.observer, 'GET', `/projects/${c.pid}/versions/${vA}/frame?index=20`);
  if (a.status !== 200) return `version A's still answered ${a.status} ${a.text.slice(0, 200)}`;
  if (!a.bytes.equals(stillA)) return 'frame 20 of version A differs from the still taken before the later edits';
  const vB = (await save(c, 'אחרי')).body.version.id as string;
  const b = await c.call(c.who.observer, 'GET', `/projects/${c.pid}/versions/${vB}/frame?index=20`);
  const now = await c.call(c.who.observer, 'GET', `/projects/${c.pid}/frame?index=20`);
  if (b.status !== 200 || now.status !== 200 || !b.bytes.equals(now.bytes)) return 'frame 20 of version B differs from the current still';
  if (a.bytes.equals(b.bytes)) return 'the two versions gave the same still although clip A was blurred since';
  return true;
}

async function V3(): Promise<true | string> {
  const c = await setup();
  await knownEdits(c);
  const d = await c.call(c.who.observer, 'GET', `/projects/${c.pid}/versions/${vA}/diff?against=current`);
  if (d.status !== 200) return `diff answered ${d.status}`;
  const got = { counts: d.body.diff.counts, rows: d.body.diff.rows.map((r: any) => `${r.entity} ${r.change} ${r.name} ${r.restores}`).sort() };
  const want = { counts: { added: 0, removed: 1, changed: 2 }, rows: ['clip changed sea.mp4 true', 'clip removed sea.mp4 true', 'clip changed שלום נועה true'].sort() };
  return canonical(got) === canonical(want) ? true : `diff said ${JSON.stringify(got)}`;
}

async function V4(): Promise<true | string> {
  const c = await setup();
  await knownEdits(c);
  const later = await c.upload(c.pid, path.join(c.art, 'new.mp4'));
  const before = c.whole();
  const r = await c.call(c.who.owner, 'POST', `/projects/${c.pid}/versions/${vA}/restore`, { expectRevision: before.revision });
  if (r.status !== 200) return `restore answered ${r.status} ${r.text.slice(0, 200)}`;
  const after = c.whole();
  if (after.revision !== before.revision + 1) return `restore took ${after.revision - before.revision} transactions`;
  const ops = JSON.parse((c.s.store.db.prepare('SELECT ops FROM transactions WHERE project_id = ? AND revision = ?').get(c.pid, after.revision) as { ops: string }).ops) as OpCall[];
  if (ops.length !== 1 || ops[0]!.op !== 'restore_entities') return `the restore committed ${ops.map((o) => o.op).join(', ')}`;
  if (editOf(after.doc) !== editOf(docA!)) return 'the edit entities differ from the version\'s';
  if (!after.doc.assets[later]) return 'a file imported after the version left the library';
  const undo = await c.call(c.who.owner, 'POST', `/projects/${c.pid}/undo`, {});
  if (undo.status !== 200) return `Ctrl+Z answered ${undo.status}`;
  if (canonical(c.whole().doc) !== canonical(before.doc)) return 'Ctrl+Z did not give back the document from before the restore';
  return true;
}

async function V5(): Promise<true | string> {
  const c = await setup();
  const pid = (await c.call(c.who.owner, 'POST', '/projects', { name: 'חוף', width: 320, height: 180, frameRate: R })).body.project.id as string;
  const beach = await c.upload(pid, path.join(c.art, 'beach.mp4'));
  const hash = c.whole(pid).doc.assets[beach]!.contentHash;
  const blob = c.s.store.blobPath(hash);
  const bytes = sha(fs.readFileSync(blob));
  const clip = (await c.tx(pid, [{ op: 'add_clip', args: { assetId: beach, start: f(0), duration: f(30) } }])).results[0].output.clipId as string;
  const v = (await save(c, 'עם החוף', c.who.owner, pid)).body.version.id as string;
  await c.tx(pid, [{ op: 'delete_clip', args: { clipId: clip } }]);
  await c.tx(pid, [{ op: 'remove_asset', args: { assetId: beach } }]);
  const gc = await c.call(c.who.owner, 'POST', '/storage/gc', { apply: true });
  if (gc.status !== 200) return `storage clean-up answered ${gc.status}`;
  const r = await c.call(c.who.owner, 'POST', `/projects/${pid}/versions/${v}/restore`, {});
  if (r.status !== 200) return `restore answered ${r.status} ${r.text.slice(0, 200)}`;
  if (c.whole(pid).doc.assets[beach]?.contentHash !== hash) return 'the removed file did not come back to the library';
  if (!fs.existsSync(blob) || sha(fs.readFileSync(blob)) !== bytes) return 'the file\'s bytes are no longer stored';
  return true;
}

async function V6(): Promise<true | string> {
  const c = await setup();
  const list = await c.call(c.who.observer, 'GET', `/projects/${c.pid}/versions`);
  const diff = await c.call(c.who.observer, 'GET', `/projects/${c.pid}/versions/${vA}/diff`);
  if (list.status !== 200 || diff.status !== 200) return `an observer was refused the list (${list.status}) or the diff (${diff.status})`;
  const s1 = await save(c, 'x', c.who.observer), s2 = await c.call(c.who.observer, 'POST', `/projects/${c.pid}/versions/${vA}/restore`, {});
  if (s1.status !== 403 || s2.status !== 403) return `an observer could save (${s1.status}) or restore (${s2.status})`;
  const lim = await c.call(c.who.limited, 'POST', `/projects/${c.pid}/versions/${vA}/restore`, {});
  if (lim.status !== 403 || lim.body?.error?.code !== 'out_of_scope') return `a clip-limited grant's restore answered ${lim.status} ${lim.body?.error?.code}`;
  const answers = [list, diff, await c.call(c.who.agent, 'GET', `/projects/${c.pid}/versions`), await c.call(c.who.agent, 'GET', `/projects/${c.pid}/versions/${vA}/diff`),
    await save(c, 'סוכן', c.who.agent), await c.call(c.who.agent, 'POST', `/projects/${c.pid}/text/find`, { text: 'נועה', wholeWord: false, ignoreMarks: true, finalsEqual: true, ignoreCase: false })];
  for (const a of answers) if (a.text.includes(BIRTH) || a.text.includes('2014')) return 'a versions answer to a credential without the people scope holds the planted birth date';
  const control = c.s.store.db.prepare(`SELECT doc FROM ${VERSIONS_TABLE} WHERE id = ?`).get(vA) as { doc: string };
  if (!control.doc.includes(BIRTH)) return 'the plant is not in the stored copy (the check would prove nothing)';
  return true;
}

async function V7(): Promise<true | string> {
  const c = await setup();
  const pid = (await c.call(c.who.owner, 'POST', '/projects', { name: 'למחיקה' })).body.project.id as string;
  await save(c, 'אחת', c.who.owner, pid);
  await save(c, 'שתיים', c.who.owner, pid);
  deleteProject(c.s.store, OWNER, pid, 'למחיקה');
  const n = (c.s.store.db.prepare(`SELECT COUNT(*) AS n FROM ${VERSIONS_TABLE} WHERE project_id = ?`).get(pid) as { n: number }).n;
  return n === 0 ? true : `${n} rows of the deleted project are left`;
}

async function V9(): Promise<true | string> {
  const c = await setup();
  const dest = path.join(c.art, 'backup');
  await backupDataDir(c.s.cfg.dataDir, dest);
  const b = await startServer({ port: 0, dataDir: dest });
  try {
    const cookie = b.auth.issueSession(new Request(`${b.url}/api/v1/session`, { headers: { origin: b.url, 'x-pf-owner-key': b.auth.tokens.owner } })).split(';')[0]!;
    const r = await fetch(`${b.url}/api/v1/projects/${c.pid}/versions`, { headers: { host: new URL(b.url).host, origin: b.url, cookie, connection: 'close' } });
    const names = ((await r.json()) as any).versions?.map((v: any) => v.name) ?? [];
    return names.includes('לפני הקיצור') ? true : `the served backup lists ${JSON.stringify(names)}`;
  } finally { await b.close(); }
}

async function V10(): Promise<true | string> {
  const c = await setup();
  const v = (await save(c, 'לפני הטשטוש')).body.version.id as string;
  await c.tx(c.pid, [{ op: 'set_redact_region', args: { clipId: c.clipA, region } }]);
  const still = await c.call(c.who.observer, 'GET', `/projects/${c.pid}/versions/${v}/frame?index=0`);
  if (!refusedAs(still, 'privacyChanged')) return `an observer's still of the earlier version answered ${still.status} ${still.body?.error?.code}`;
  const agentRestore = await c.call(c.who.agent, 'POST', `/projects/${c.pid}/versions/${v}/restore`, { confirmPrivacy: true });
  if (!refusedAs(agentRestore, 'privacyChanged')) return `an agent's restore of the earlier version answered ${agentRestore.status}`;
  const ask = await c.call(c.who.owner, 'POST', `/projects/${c.pid}/versions/${v}/restore`, {});
  if (!refusedAs(ask, 'needsConfirmation') || ask.body.error.message !== CRAFT_SERVER_REFUSALS.needsConfirmation.message(1) || ask.body.error.details?.privacy?.removed !== 1) return `the owner's restore without confirmation answered ${ask.status} ${ask.text.slice(0, 200)}`;
  const ok = await c.call(c.who.owner, 'POST', `/projects/${c.pid}/versions/${v}/restore`, { confirmPrivacy: true });
  if (ok.status !== 200) return `the confirmed restore answered ${ok.status}`;
  if (!c.purges.some((p) => p.projectId === c.pid && p.revision === ok.body.revision)) return 'the privacy purge did not run for the restore';
  const cached = (c.s.renderCache.store as unknown as { db: { prepare(s: string): { get(...a: unknown[]): unknown } } }).db.prepare('SELECT COUNT(*) AS n FROM render_segment_projects WHERE project_id = ?').get(c.pid) as { n: number };
  if (cached.n !== 0) return `${cached.n} cached segments of the project are left`;
  return true;
}

async function V11(): Promise<true | string> {
  const c = await setup();
  const pid = (await c.call(c.who.owner, 'POST', '/projects', { name: 'מלא' })).body.project.id as string;
  for (let i = 0; i < CRAFT_LIMITS.agentVersions; i++) if ((await save(c, `a${i}`, c.who.agent, pid)).status !== 201) return `agent save ${i + 1} was refused`;
  const a = await save(c, 'one more', c.who.agent, pid);
  if (!refusedAs(a, 'agentVersionLimit')) return `an agent's ${CRAFT_LIMITS.agentVersions + 1}th save answered ${a.status} ${a.body?.error?.code}`;
  for (let i = CRAFT_LIMITS.agentVersions; i < CRAFT_LIMITS.versions; i++) if ((await save(c, `o${i}`, c.who.owner, pid)).status !== 201) return `save ${i + 1} was refused`;
  const full = await save(c, 'one more', c.who.owner, pid);
  if (!refusedAs(full, 'versionLimit')) return `the ${CRAFT_LIMITS.versions + 1}st save answered ${full.status} ${full.body?.error?.code}`;
  const one = (await c.call(c.who.owner, 'GET', `/projects/${pid}/versions`)).body.versions[0].id;
  await c.call(c.who.owner, 'DELETE', `/projects/${pid}/versions/${one}`);
  const was = c.s.store.maxStorageBytes;
  c.s.store.maxStorageBytes = 1;
  try {
    const disk = await save(c, 'no room', c.who.owner, pid);
    if (disk.status !== 507) return `a full disk answered ${disk.status}`;
  } finally { c.s.store.maxStorageBytes = was; }
  return true;
}

type Check = () => Promise<true | string>;
/** A check that throws answers its error as a failure sentence (the runner does not catch). */
const safe = (fn: Check): Check => async () => { try { return await fn(); } catch (e) { return `threw: ${String((e as Error)?.message ?? e).slice(0, 400)}`; } };
/** Closes the server after the last check (the runner runs the checks in this order). */
const last = (fn: Check): Check => async () => {
  try { return await fn(); } finally { const c = await ctx?.catch(() => null); if (c) { await c.s.close(); fs.rmSync(c.art, { recursive: true, force: true }); } ctx = null; }
};
export const CRAFT_PROOF_VERSIONS: CraftProofPart = {
  built: true,
  checks: { V1: safe(V1), V2: safe(V2), V3: safe(V3), V4: safe(V4), V5: safe(V5), V6: safe(V6), V7: safe(V7), V9: safe(V9), V10: safe(V10), V11: last(safe(V11)) },
};

// Run alone
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failed = 0, blocked = 0;
  for (const [id, check] of Object.entries(CRAFT_PROOF_VERSIONS.checks)) {
    const r = await check();
    const tag = r === true ? 'PASS' : r.startsWith('BLOCKED') ? 'BLOCKED' : 'FAIL';
    if (tag === 'FAIL') failed++;
    if (tag === 'BLOCKED') blocked++;
    console.log(`${tag} ${id}${r === true ? '' : `: ${r}`}`);
  }
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
