/**
 * pnpm proof:pearls, part server (builder B): checks P2, P7–P12 of pearls-proof.ts (route and tool parts of P7–P9), over the real
 * server (startServer on 127.0.0.1) and SYNTHETIC fixtures made here by FFmpeg: barcode videos at 30 and 30000/1001 fps
 * (packages/fixtures generateBarcodeFixture), a time-preserving copy (trimmed from 1 s) and an untimed (reversed) copy, attached as
 * derived assets with the provenance the lineage tests use (a typed fixture: no provider ran), and invented people «נועה», «איתי».
 * No owner clip is used. Expected numbers are computed here by hand from the fixture, never by calling core's usage functions.
 *
 * Each check returns true or a sentence. A sentence that begins with "BLOCKED" means the check could not run here: builder A's
 * bodies (the three operations, rangeUsage, screenTime, searchRanges, filmWindowOfRange) are not merged yet, or the web bundle the
 * renderer needs is missing (`pnpm build`). Anything else is a failure. Run alone: `tsx packages/evals/src/pearls-proof.server.ts`
 * (exit 0 all pass, 1 a failure, 2 only blocked ones besides passes). Writes docs/evidence/pearls-proof.server.json.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '@pulseframe/time';
import {
  assistantOps, canonical, filmWindowOfRange, rangeUsage, SCREEN_TIME_LABEL, SOURCE_RANGE_OPS, SOURCE_RANGE_REFUSALS, SourceRangesNotBuilt, sourceFrameOfTime, validateProject,
  type ProjectDocument, type SourceRange,
} from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { readBarcode, generateBarcodeFixture } from '@pulseframe/fixtures';
import { HE_PEARLS } from '../../i18n/src/pearls.ts';
import { HUMAN_TAG_REFUSALS } from '../../../apps/server/src/peoplePrivacy.ts';
import { PEARLS_SERVER_REFUSALS } from '../../../apps/server/src/pearls.ts';
import { assistantSummary } from '../../../apps/server/src/assistant/summary.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const evidence: Record<string, unknown> = {};
/** A child's words as a pearl's name, planted to be looked for. */
const SECRET = 'הסוד של פרפרזונה Zorglewump';
const leak = (v: unknown) => /פרפרזונה|Zorglewump/i.test(typeof v === 'string' ? v : JSON.stringify(v) ?? '');
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { input, maxBuffer: 1 << 28 });

/** True once builder A's bodies are merged: core's functions answer instead of throwing SourceRangesNotBuilt. */
function aBuilt(): boolean {
  try { filmWindowOfRange({ kind: 'image', duration: T.ZERO }, { id: 'r', assetId: 'a', kind: 'pearl', span: null, label: '', createdBy: 'x' }); rangeUsage({ sequences: {}, assets: {}, sourceRanges: {} } as unknown as ProjectDocument); return true; } catch (e) { if (e instanceof SourceRangesNotBuilt) return false; return true; }
}
const WAIT_A = 'BLOCKED: builder A\'s core bodies (the three operations, rangeUsage, screenTime, searchRanges, filmWindowOfRange) are not merged in this build';

// ---------- the world ----------
type Who = Record<string, string>;
interface World {
  s: RunningServer; base: string; web: boolean;
  owner: Who; agent: Who; names: Who; full: Who; tokens: { agent: string; names: string; full: string };
  files: { a: string; b: string; c: string; copy: string; rev: string };
}
let worldP: Promise<World> | null = null;
const world = () => (worldP ??= makeWorld());
async function makeWorld(): Promise<World> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pearls-proof-'));
  const fx = path.join(base, 'fx');
  const a = (await generateBarcodeFixture({ out: path.join(fx, 'a30.mp4'), frames: 300, fps: { num: 30, den: 1 } })).file;
  const b = (await generateBarcodeFixture({ out: path.join(fx, 'b2997.mp4'), frames: 300, fps: { num: 30000, den: 1001 } })).file;
  // c differs from a (290 frames, so not the same bytes: an upload of the same bytes is the same file)
  const c = (await generateBarcodeFixture({ out: path.join(fx, 'c30.mp4'), frames: 290, fps: { num: 30, den: 1 } })).file;
  // the time-preserving copy: a's picture from 1 s on (its frame 0 is a's frame 30); the untimed copy: a reversed
  const copy = path.join(fx, 'a-from-1s.mp4'), rev = path.join(fx, 'a-reversed.mp4');
  ff(['-i', a, '-vf', 'trim=start_frame=30:end_frame=210,setpts=PTS-STARTPTS', '-af', 'atrim=start=1:end=7,asetpts=PTS-STARTPTS', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', copy]);
  ff(['-i', a, '-vf', 'reverse', '-af', 'areverse', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', rev]);
  const webDist = path.join(ROOT, 'apps/web/dist');
  const web = fs.existsSync(path.join(webDist, 'render.html'));
  const s = await startServer({ port: 0, dataDir: path.join(base, 'data'), ...(web ? { webDist } : {}), speechPython: null, voicePython: null, backupDir: null });
  const origin = s.url;
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const owner: Who = { origin, cookie, connection: 'close' };
  const grant = async (name: string, people?: 'full') => { const r = await fetch(`${origin}/api/v1/grants`, { method: 'POST', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ name, mode: 'edit', ...(people ? { people } : {}) }) }); return ((await r.json()) as { token: string }).token; };
  const tokens = { agent: s.auth.tokens.agent, names: await grant('names'), full: await grant('full', 'full') };
  const bearer = (t: string): Who => ({ authorization: `Bearer ${t}`, connection: 'close' });
  return { s, base, web, owner, agent: bearer(tokens.agent), names: bearer(tokens.names), full: bearer(tokens.full), tokens, files: { a, b, c, copy, rev } };
}
async function as(who: Who, method: string, p: string, body?: unknown): Promise<{ status: number; body: any; raw: Buffer }> {
  const w = await world();
  const r = await fetch(`${w.s.url}/api/v1${p}`, { method, headers: { ...who, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = Buffer.from(await r.arrayBuffer());
  let parsed: any = raw;
  if ((r.headers.get('content-type') ?? '').includes('json')) parsed = JSON.parse(raw.toString('utf8'));
  return { status: r.status, body: parsed, raw };
}
const codeOf = (b: any) => b?.error?.code ?? b?.code;
async function must(who: Who, method: string, p: string, body?: unknown, want = [200, 201]) {
  const r = await as(who, method, p, body);
  if (!want.includes(r.status)) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`);
  return r.body;
}
async function mcp(token: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; body: any }> {
  const w = await world();
  const r = await fetch(`${w.s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP ${name}: ${JSON.stringify(msg.error)}`);
  const first = msg.result.content?.[0];
  let body: any = null;
  try { body = first?.type === 'text' ? JSON.parse(first.text) : null; } catch { body = first?.text ?? null; }
  return { isError: msg.result.isError === true, body };
}
const ownerTx = async (pid: string, ops: unknown[]) => (await must((await world()).owner, 'POST', `/projects/${pid}/transactions`, { ops })) as { revision: number; results: { output?: Record<string, any> }[] };
const newProject = async (name: string) => (await must((await world()).owner, 'POST', '/projects', { name, width: 640, height: 360, frameRate: R })).project.id as string;
async function upload(pid: string, file: string): Promise<string> {
  const w = await world();
  const r = await fetch(`${w.s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...w.owner, 'x-filename': encodeURIComponent(path.basename(file)) }, body: new Uint8Array(fs.readFileSync(file)) });
  const b = (await r.json()) as any;
  if (!b.assetId) throw new Error(`upload of ${file} failed: ${JSON.stringify(b).slice(0, 300)}`);
  return b.assetId as string;
}
const wholeDoc = async (pid: string) => (await world()).s.store.wholeProject(pid).doc;
/** A document planted straight into the store (ranges and people put in, as an archive would hold them; the ops are A's). */
async function plant(from: ProjectDocument, id: string, over: Partial<ProjectDocument>): Promise<string> {
  return (await world()).s.store.importProject({ ...structuredClone(from), id, ...over }).doc.id;
}
/** The barcode the still at `frame` shows (640×360, the fixture's strip at the top). */
async function barcodeAt(pid: string, frame: number): Promise<number> {
  const png = (await must((await world()).owner, 'GET', `/projects/${pid}/frame?index=${frame}`)) as Buffer;
  const rgb = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
  return readBarcode(new Uint8Array(rgb), 640, 3, { x: 0, y: 0, w: 640, h: 360 });
}
const pearl = (id: string, assetId: string, start: T.RationalTime, end: T.RationalTime, over: Partial<SourceRange> = {}): SourceRange => ({ id, assetId, kind: 'pearl', span: { start, end }, label: '', createdBy: 'user:local', ...over });

/** The base project: files a (30 fps), b (29.97 fps), c (30 fps), uploaded by the owner. */
let baseP: Promise<{ pid: string; a: string; b: string; c: string }> | null = null;
const baseProject = () => (baseP ??= (async () => {
  const w = await world();
  const pid = await newProject('pearls base');
  return { pid, a: await upload(pid, w.files.a), b: await upload(pid, w.files.b), c: await upload(pid, w.files.c) };
})());

// ---------- the checks ----------
const checks: Record<string, () => Promise<true | string>> = {
  /** P2: the three ops through REST, MCP and the editor give equal revisions and history; every refusal is worded in Hebrew. */
  P2: async () => {
    const w = await world();
    // wording first (it needs no body): every core refusal and every server refusal of the track is recognised by HE_PEARLS
    const he = (msg: string) => HE_PEARLS.some(([re]) => re.test(msg));
    const sample: Record<string, unknown[]> = { notBuilt: ['add_source_range'], assetNotFound: ['ast_x'], rangeBounds: ['10.0'], rangePersonNotFound: ['per_x'], rangeNotFound: ['rng_x'] };
    const missing = Object.entries(SOURCE_RANGE_REFUSALS).map(([k, r]) => (r.message as (...a: unknown[]) => string)(...(sample[k] ?? []))).filter((m) => !he(m));
    for (const m of [...Object.values(HUMAN_TAG_REFUSALS), PEARLS_SERVER_REFUSALS.notBuilt.message]) if (!he(m)) missing.push(m);
    evidence.P2 = { refusalsWithoutHebrew: missing };
    if (missing.length) return `refusals with no Hebrew wording: ${missing.join(' | ')}`;
    if (!aBuilt()) return WAIT_A;
    const seq = { start: T.rt(1, 1), end: T.rt(5, 2) }, moved = { start: T.rt(2, 1), end: T.rt(3, 1) };
    const run = async (via: 'rest' | 'mcp' | 'editor') => {
      const pid = await newProject(`P2 ${via}`);
      const asset = await upload(pid, w.files.a);
      const call = async (op: string, args: Record<string, unknown>) => {
        if (via === 'mcp') { const r = await mcp(w.tokens.agent, op, { projectId: pid, ...args }); if (r.isError) throw new Error(`${op}: ${JSON.stringify(r.body)}`); return r.body; }
        return must(via === 'rest' ? w.agent : w.owner, 'POST', `/projects/${pid}/transactions`, { ops: [{ op, args }] });
      };
      const add = await call('add_source_range', { assetId: asset, ...seq });
      const rangeId = (add.results?.[0]?.output ?? add.output ?? add.results?.[0])?.rangeId ?? Object.keys((await wholeDoc(pid)).sourceRanges ?? {})[0];
      await call('update_source_range', { rangeId, ...moved });
      await call('remove_source_range', { rangeId });
      const hist = (await must(w.owner, 'GET', `/projects/${pid}/history`)).events as { revision: number; summary?: string; ops?: unknown }[];
      return { revisions: hist.map((e) => e.revision), summaries: hist.map((e) => e.summary ?? null), doc: canonical({ ...(await wholeDoc(pid)), id: 'x', name: 'x', assets: {} }) };
    };
    const [rest, tool, editor] = [await run('rest'), await run('mcp'), await run('editor')];
    evidence.P2 = { ...(evidence.P2 as object), rest: { revisions: rest.revisions, summaries: rest.summaries } };
    if (canonical({ r: rest.revisions, s: rest.summaries }) !== canonical({ r: tool.revisions, s: tool.summaries }) || canonical({ r: rest.revisions, s: rest.summaries }) !== canonical({ r: editor.revisions, s: editor.summaries })) return `revisions or history differ: ${JSON.stringify({ rest, tool, editor }).slice(0, 600)}`;
    return true;
  },

  /** P7 (route and tool): a trim changes the coverage to the exact new numbers; the other file's pearl is unused. */
  P7: async () => {
    if (!aBuilt()) return WAIT_A;
    const w = await world(), b = await baseProject();
    const pid = await plant(await wholeDoc(b.pid), 'prj_p7', { sourceRanges: { rng_a: pearl('rng_a', b.a, f(30), f(75)), rng_c: pearl('rng_c', b.c, f(30), f(60)) } });
    const clipId = (await ownerTx(pid, [{ op: 'add_clip', args: { assetId: b.a, start: f(0), duration: f(90), withLinkedAudio: false } }])).results[0]!.output!.clipId as string;
    const read = async () => {
      const route = (await must(w.agent, 'GET', `/projects/${pid}/pearls`));
      const tool = (await mcp(w.tokens.agent, 'get_pearls', { projectId: pid })).body;
      return { route, tool, uses: route.ranges.find((r: any) => r.id === 'rng_a').usage.uses.map((u: any) => [u.fromFrame, u.toFrame]), unused: route.unused };
    };
    const before = await read();
    await ownerTx(pid, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(50) } }]);
    const after = await read();
    evidence.P7 = { before: { uses: before.uses, unused: before.unused }, after: { uses: after.uses, unused: after.unused } };
    if (canonical(before.route) !== canonical(before.tool) || canonical(after.route) !== canonical(after.tool)) return 'the route and the tool answer differently';
    if (canonical(before.uses) !== canonical([[30, 75]]) || canonical(after.uses) !== canonical([[30, 50]])) return `coverage ${JSON.stringify(before.uses)} → ${JSON.stringify(after.uses)}, expected [[30,75]] → [[30,50]]`;
    if (!before.unused.includes('rng_c') || !after.unused.includes('rng_c') || before.unused.includes('rng_a')) return `unused: ${JSON.stringify(before.unused)}`;
    return true;
  },

  /** P8 (route and tool): the time-preserving copy counts at the right offset; the untimed copy does not count and is named. */
  P8: async () => {
    if (!aBuilt()) return WAIT_A;
    const w = await world(), b = await baseProject();
    // the copies are real files made above by FFmpeg, stored through a side project (one blob store), attached here by hand as derived assets
    const side = await newProject('P8 blobs');
    const sideDoc = async () => wholeDoc(side);
    const cu = await upload(side, w.files.copy), ru = await upload(side, w.files.rev);
    const derived = (sourceRangeStart?: T.RationalTime) => ({ origin: 'derived', importedAt: new Date().toISOString(), importedBy: 'fixture', derived: { jobId: 'job_fixture', capabilityId: 'comfy.video.enhance', capabilityVersion: '0.1.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [b.a], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, ...(sourceRangeStart ? { sourceRangeStart } : {}) } });
    const pid = await plant(await wholeDoc(b.pid), 'prj_p8', { sourceRanges: { rng_a: pearl('rng_a', b.a, f(30), f(75)) } });
    const sd = await sideDoc();
    const imp = (assetId: string, name: string, prov: unknown) => { const { id: _i, ...asset } = sd.assets[assetId]!; return { op: 'import_asset', args: { asset: { ...asset, name, provenance: prov } } }; };
    const r = w.s.store.commit({ projectId: pid, actor: 'fixture', allowInternal: true, ops: [imp(cu, 'copy.mp4', derived(T.rt(1, 1))), imp(ru, 'reversed.mp4', derived())] } as never) as { results: { output?: Record<string, any> }[] };
    const copyId = r.results[0]!.output!.assetId as string, revId = r.results[1]!.output!.assetId as string;
    await ownerTx(pid, [{ op: 'add_clip', args: { assetId: copyId, start: f(0), duration: f(60), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: revId, start: f(60), duration: f(30), withLinkedAudio: false } }]);
    const route = await must(w.agent, 'GET', `/projects/${pid}/pearls`);
    const tool = (await mcp(w.tokens.agent, 'get_pearls', { projectId: pid })).body;
    const u = route.ranges.find((x: any) => x.id === 'rng_a').usage;
    evidence.P8 = { uses: u.uses.map((x: any) => [x.fromFrame, x.toFrame, x.source]), untimedCopies: u.untimedCopies };
    if (canonical(route) !== canonical(tool)) return 'the route and the tool answer differently';
    // the copy's frame 0 is a's frame 30: the pearl [30, 75) of a is the copy's [0, 45), source [1, 2.5) s in a's time
    const want = [[0, 45]];
    if (canonical(u.uses.map((x: any) => [x.fromFrame, x.toFrame])) !== canonical(want)) return `copy coverage ${JSON.stringify(u.uses)} ≠ ${JSON.stringify(want)}`;
    if (T.toSeconds(u.uses[0].source.start) !== 1 || T.toSeconds(u.uses[0].source.end) !== 2.5) return `source ${JSON.stringify(u.uses[0].source)} ≠ [1, 2.5) s`;
    if (!u.untimedCopies.includes(revId) || u.uses.some((x: any) => x.clipId && x.fromFrame >= 60)) return `untimed copy: ${JSON.stringify(u.untimedCopies)}`;
    return true;
  },

  /** P9 (route and tool): screen time on a built timeline equals hand-computed frames; the label travels in Hebrew and English. */
  P9: async () => {
    if (!aBuilt()) return WAIT_A;
    const w = await world(), b = await baseProject();
    // V1: a 0–90, c 90–150; V2 (a layer over V1): b 60–120 from its start; V3 hidden: a 200–260. נועה on a («מי בקליפ?», the whole
    // file), איתי on b's pearl [0, 2) s = b's frames 0–59 (29.97 fps) shown on project frames 60–120. Picture 150 (V1 0–150 with V2
    // inside), נועה 90 (the hidden track not counted), איתי 60, tagged 0–120, untagged 30.
    const doc0 = await wholeDoc(b.pid);
    const pid = await plant(doc0, 'prj_p9', { people: { per_noa: { id: 'per_noa', name: 'נועה', birthDate: '2020-02-29' }, per_itai: { id: 'per_itai', name: 'איתי', birthDate: null } }, sourceRanges: {
      rng_who: { id: 'rng_who', assetId: b.a, kind: 'presence', span: null, label: '', people: ['per_noa'], createdBy: 'user:local' },
      rng_b: pearl('rng_b', b.b, T.ZERO, T.rt(2, 1), { people: ['per_itai'] }),
    } });
    const v1 = (await wholeDoc(pid)).sequences.seq_main!.tracks.find((t) => t.kind === 'video')!.id;
    const t = await ownerTx(pid, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'video' } }]);
    const [v2, v3] = t.results.map((x) => x.output!.trackId as string);
    await ownerTx(pid, [
      { op: 'add_clip', args: { assetId: b.a, trackId: v1, start: f(0), duration: f(90), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: b.c, trackId: v1, start: f(90), duration: f(60), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: b.b, trackId: v2, start: f(60), duration: f(60), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: b.a, trackId: v3, start: f(200), duration: f(60), withLinkedAudio: false } },
      { op: 'update_track', args: { trackId: v3, hidden: true } },
    ]);
    const route = await must(w.agent, 'GET', `/projects/${pid}/pearls`);
    const tool = (await mcp(w.tokens.agent, 'get_pearls', { projectId: pid })).body;
    const st = route.screenTime;
    const got = { picture: st.pictureFrames, untagged: st.untaggedFrames, people: st.people.map((p: any) => [p.personId, p.frames]) };
    evidence.P9 = got;
    if (canonical(route) !== canonical(tool)) return 'the route and the tool answer differently';
    if (canonical(got) !== canonical({ picture: 150, untagged: 30, people: [['per_itai', 60], ['per_noa', 90]] })) return `screen time ${JSON.stringify(got)} ≠ picture 150, untagged 30, איתי 60, נועה 90`;
    if (canonical(route.screenTimeLabel) !== canonical(SCREEN_TIME_LABEL) || !route.screenTimeLabel.he || !route.screenTimeLabel.en) return 'the screen time label is not with the numbers in both languages';
    if (JSON.stringify(route).includes('2020')) return 'a birth date reached the agent';
    return true;
  },

  /** P10: privacy through the real routes and tools. */
  P10: async () => {
    const w = await world(), b = await baseProject();
    const pid = await plant(await wholeDoc(b.pid), 'prj_p10', {
      people: { per_noa: { id: 'per_noa', name: 'נועה', birthDate: '2020-02-29' } },
      sourceRanges: { rng_tag: pearl('rng_tag', b.a, f(30), f(75), { label: SECRET, people: ['per_noa'] }), rng_free: pearl('rng_free', b.c, f(30), f(60), { label: `${SECRET} 2` }) },
    });
    const fails: string[] = [], waits: string[] = [];
    const want = async (who: Who, name: string, p: string, body: unknown, code: string) => {
      const r = await as(who, 'POST', p, body);
      if (r.status !== 403 || codeOf(r.body) !== code) fails.push(`${name}: ${r.status} ${codeOf(r.body)} (expected 403 ${code})`);
      if (leak(r.raw.toString('utf8'))) fails.push(`${name}: the answer holds the label`);
    };
    const tag = { op: 'add_source_range', args: { assetId: b.a, people: ['per_noa'] } };
    for (const [who, n] of [[w.names, 'names grant'], [w.full, 'people "full" grant'], [w.agent, 'agent token']] as const) {
      await want(who, `${n} commit`, `/projects/${pid}/transactions`, { ops: [tag] }, 'human_tag_required');
      await want(who, `${n} dry run`, `/projects/${pid}/operations/validate`, { ops: [tag] }, 'human_tag_required');
      await want(who, `${n} nested`, `/projects/${pid}/transactions`, { ops: [{ op: 'apply_transaction', args: { ops: [tag] } }] }, 'human_tag_required');
      await want(who, `${n} proposal`, `/projects/${pid}/proposals`, { ops: [tag] }, 'human_tag_required');
      await want(who, `${n} update of a tagged range`, `/projects/${pid}/transactions`, { ops: [{ op: 'update_source_range', args: { rangeId: 'rng_tag', start: f(0), end: f(10) } }] }, 'human_tag_required');
      await want(who, `${n} remove of a tagged range`, `/projects/${pid}/transactions`, { ops: [{ op: 'remove_source_range', args: { rangeId: 'rng_tag' } }] }, 'human_tag_required');
      await want(who, `${n} remove_person of a tagged person`, `/projects/${pid}/transactions`, { ops: [{ op: 'remove_person', args: { personId: 'per_noa' } }] }, 'human_tag_required');
    }
    for (const tool of ['apply_transaction', 'propose_transaction']) {
      const r = await mcp(w.tokens.names, tool, { projectId: pid, ops: [tag] });
      if (!r.isError || codeOf(r.body) !== 'human_tag_required') fails.push(`MCP ${tool}: ${JSON.stringify(r.body).slice(0, 120)}`);
    }
    await want(w.names, 'a label from a names grant', `/projects/${pid}/transactions`, { ops: [{ op: 'update_source_range', args: { rangeId: 'rng_free', label: SECRET } }] }, 'people_scope_required');
    await want(w.agent, 'a label from the agent token', `/projects/${pid}/transactions`, { ops: [{ op: 'add_source_range', args: { assetId: b.c, label: SECRET } }] }, 'people_scope_required');
    const excluded = assistantOps().filter((o) => (SOURCE_RANGE_OPS as readonly string[]).includes(o));
    if (excluded.length) fails.push(`assistantOps() holds ${excluded.join(', ')}`);
    // the summary the language assistant would send (the labelled MOCK adapter receives exactly this), with every toggle on
    if (leak(assistantSummary(await wholeDoc(pid), { playheadFrame: 0, selection: [] }, { titlesAndMarkers: true, peopleNames: true }))) fails.push('the assistant summary holds the label');
    // the read view and what needs A's bodies
    if (!aBuilt()) waits.push('the read view, the add without people and label, the film run record');
    else {
      const names = await must(w.names, 'GET', `/projects/${pid}/pearls`);
      if (names.labelsHidden !== true || names.ranges.some((r: any) => r.label !== '') || leak(names) || JSON.stringify(names).includes('2020') || !JSON.stringify(names).includes('נועה')) fails.push('a names grant reads a label, a birth date or no name');
      const full = await must(w.full, 'GET', `/projects/${pid}/pearls`);
      if (full.labelsHidden !== false || full.ranges.find((r: any) => r.id === 'rng_tag')?.label !== SECRET) fails.push('a people "full" grant does not read the label');
      const ok = await as(w.names, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_source_range', args: { assetId: b.c, start: f(90), end: f(120) } }] });
      if (ok.status !== 200) fails.push(`the add without people and label: ${ok.status} ${codeOf(ok.body)}`);
      const film = await as(w.owner, 'POST', `/projects/${pid}/recipes/family-film/apply`, { params: { assetIds: [b.a, b.b, b.c], targetSeconds: 30, picks: { pearls: 'prefer' } } });
      if (film.status !== 200) fails.push(`the film with pearls: ${film.status} ${JSON.stringify(film.body?.error ?? '').slice(0, 200)}`);
      const runs = JSON.stringify((await wholeDoc(pid)).recipeRuns);
      if (!runs.includes('"rangeId":"rng_tag"') || leak(runs)) fails.push('the film run record holds no pearl, or holds the label');
    }
    evidence.P10 = { fails, waits };
    if (fails.length) return fails.join('; ');
    return waits.length ? `${WAIT_A} (${waits.join(', ')}); every refusal passed` : true;
  },

  /** P11: a normal archive round-trips the ranges; «בלי פרטי משפחה» has no sourceRanges key and validates. */
  P11: async () => {
    const w = await world(), b = await baseProject();
    const ranges = { rng_a: pearl('rng_a', b.a, f(30), f(75), { label: SECRET }), rng_c: pearl('rng_c', b.c, T.rt(1, 3), T.rt(7, 5)) };
    const pid = await plant(await wholeDoc(b.pid), 'prj_p11', { people: { per_noa: { id: 'per_noa', name: 'נועה', birthDate: '2020-02-29' } }, sourceRanges: { ...ranges, rng_who: { id: 'rng_who', assetId: b.b, kind: 'presence', span: null, label: '', people: ['per_noa'], createdBy: 'user:local' } } });
    const projectJson = (tar: Buffer) => {
      for (let at = 0; at + 512 <= tar.length;) {
        const h = tar.subarray(at, at + 512);
        if (h.every((x) => x === 0)) break;
        const size = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim() || '0', 8), name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
        if (name === 'project.json') return JSON.parse(tar.subarray(at + 512, at + 512 + size).toString('utf8')) as ProjectDocument;
        at += 512 + Math.ceil(size / 512) * 512;
      }
      throw new Error('no project.json in the archive');
    };
    const keep = (await as(w.owner, 'GET', `/projects/${pid}/archive`)).raw;
    const r = await fetch(`${w.s.url}/api/v1/projects/import`, { method: 'POST', headers: { ...w.owner, 'content-type': 'application/x-tar' }, body: new Uint8Array(keep) });
    const imported = (await r.json()) as any;
    if (r.status !== 201) return `import: ${r.status} ${JSON.stringify(imported).slice(0, 200)}`;
    const back = (await wholeDoc(imported.project.id)).sourceRanges;
    const omit = projectJson((await as(w.owner, 'GET', `/projects/${pid}/archive?family=omit`)).raw);
    const issues = validateProject(omit);
    evidence.P11 = { roundTrip: canonical(back) === canonical((await wholeDoc(pid)).sourceRanges), omitHasKey: Object.hasOwn(omit, 'sourceRanges'), omitIssues: issues.length };
    if (canonical(back) !== canonical((await wholeDoc(pid)).sourceRanges)) return 'the normal archive does not give the ranges back exactly';
    if (Object.hasOwn(omit, 'sourceRanges') || leak(omit)) return '«בלי פרטי משפחה» holds ranges or a label';
    if (issues.length) return `«בלי פרטי משפחה» does not validate: ${JSON.stringify(issues).slice(0, 200)}`;
    return true;
  },

  /** P12: the family film with and without picks.pearls. */
  P12: async () => {
    const w = await world(), b = await baseProject();
    const doc0 = await wholeDoc(b.pid);
    const ranges: Record<string, SourceRange> = {
      rng_a1: pearl('rng_a1', b.a, T.rt(2, 1), T.rt(3, 1)), rng_a2: pearl('rng_a2', b.a, T.rt(6, 1), T.rt(7, 1)),
      rng_b: pearl('rng_b', b.b, T.rt(3, 2), T.rt(11, 5)),
      rng_c: pearl('rng_c', b.c, T.rt(1, 2), T.rt(19, 2)), // 9 s: longer than the longest slot
    };
    const withR = await plant(doc0, 'prj_p12', { sourceRanges: ranges });
    const without = await plant(doc0, 'prj_p12_plain', {});
    const params = { assetIds: [b.a, b.b, b.c], targetSeconds: 30, order: 'given' };
    const planOf = async (pid: string, p: unknown) => { const v = await must(w.owner, 'POST', `/projects/${pid}/recipes/family-film/plan`, { params: p }); const { revision: _r, ...rest } = v.plan ?? v; return rest; };
    const plainA = await planOf(withR, params), plainB = await planOf(without, params);
    if (canonical(plainA) !== canonical(plainB)) return 'without picks.pearls the plan differs from the plan of the same document with no ranges';
    if (!aBuilt()) return `${WAIT_A}; without picks.pearls the plan equals the plan with no ranges (checked)`;
    const prefer = { ...params, picks: { pearls: 'prefer' } };
    const before = canonical((await wholeDoc(withR)));
    const applied = await must(w.owner, 'POST', `/projects/${withR}/recipes/family-film/apply`, { params: prefer });
    const picks = applied.picks as { key: string; assetId: string; kind: string; rangeId?: string; startFrame: number; sourceInFrame: number }[];
    const warnings = applied.warnings as { code: string; details: any }[];
    const fails: string[] = [];
    const assets = (await wholeDoc(withR)).assets;
    for (const [rid, aid] of [['rng_a1', b.a], ['rng_b', b.b], ['rng_c', b.c]] as const) {
      const k = picks.find((x) => x.rangeId === rid);
      const want = sourceFrameOfTime(assets[aid]!, ranges[rid]!.span!.start);
      if (!k || k.kind !== 'pearl' || k.sourceInFrame !== want) { fails.push(`${rid}: pick ${JSON.stringify(k)} (expected a pearl pick from source frame ${want})`); continue; }
      if (w.web) { const code = await barcodeAt(withR, k.startFrame); if (code !== want) fails.push(`${rid}: the first rendered frame shows ${code}, expected ${want}`); }
    }
    const out = warnings.find((x) => x.code === 'pearl_left_out')?.details.items ?? [];
    if (!out.some((x: any) => x.rangeId === 'rng_a2' && x.why === 'one_per_file')) fails.push(`pearl_left_out: ${JSON.stringify(out)}`);
    if (!warnings.some((x) => x.code === 'pearl_cut_short' && x.details.rangeId === 'rng_c')) fails.push('no pearl_cut_short for the 9-second pearl');
    // apply is one undo
    await must(w.owner, 'POST', `/projects/${withR}/undo`, {});
    if (canonical(await wholeDoc(withR)) !== before) fails.push('one undo does not give the document back');
    // a pearl pick deleted by hand stays out on regenerate while its file stays in; restoreRemoved returns it
    const again = await must(w.owner, 'POST', `/projects/${withR}/recipes/family-film/apply`, { params: prefer });
    const run = (await wholeDoc(withR)).recipeRuns[again.runId]!;
    const key = (again.picks as typeof picks).find((x) => x.rangeId === 'rng_a1')!.key;
    await ownerTx(withR, [{ op: 'delete_clip', args: { clipId: run.slots!.find((s) => s.key === key)!.clipId } }]);
    const regen = await must(w.owner, 'POST', `/projects/${withR}/recipe-runs/${again.runId}/regenerate`, {});
    const rp = regen.picks as typeof picks;
    if (rp.some((x) => x.rangeId === 'rng_a1') || !rp.some((x) => x.assetId === b.a)) fails.push(`regenerate: ${JSON.stringify(rp.map((x) => [x.assetId, x.rangeId]))}`);
    const back = await must(w.owner, 'POST', `/projects/${withR}/recipe-runs/${again.runId}/regenerate`, { restoreRemoved: true });
    if (!(back.picks as typeof picks).some((x) => x.rangeId === 'rng_a1')) fails.push('restoreRemoved does not bring the pearl back');
    evidence.P12 = { picks: picks.map((x) => [x.assetId, x.kind, x.rangeId ?? null, x.sourceInFrame]), leftOut: out, rendered: w.web, fails };
    if (fails.length) return fails.join('; ');
    return w.web ? true : 'BLOCKED: the web bundle is missing (`pnpm build`), so the first rendered frame of each pearl pick was not read; every other part passed';
  },
};

export const PEARLS_PROOF_SERVER = { built: true, checks } as const;

/** Stops the server and removes the temp folders (the runner calls it; the stand-alone run does). */
export async function closePearlsProofServer(): Promise<void> {
  if (!worldP) return;
  const w = await worldP;
  await w.s.close();
  fs.rmSync(w.base, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'pearls-proof.server.json'), JSON.stringify({ when: new Date().toISOString(), aBuilt: aBuilt(), web: w.web, evidence }, null, 1) + '\n');
  } catch { /* evidence is best effort */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failed = 0, blocked = 0;
  try {
    for (const [n, check] of Object.entries(checks)) {
      let r: true | string;
      try { r = await check(); } catch (e) { r = `threw: ${(e as Error).stack?.slice(0, 600) ?? e}`; }
      const b = r !== true && r.startsWith('BLOCKED');
      console.log(`${r === true ? 'PASS' : b ? 'BLOCKED' : 'FAIL'} ${n} (server)${r === true ? '' : `: ${r}`}`);
      if (r !== true) { if (b) blocked++; else failed++; }
    }
  } finally {
    await closePearlsProofServer();
  }
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
