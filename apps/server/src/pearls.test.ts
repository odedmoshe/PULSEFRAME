/**
 * The read view of marked ranges «פנינים» (wave 7; pearls.ts) and the walk that proves a range's label (a family note, read like
 * a birth date) reaches no credential without the people scope: not through the view, an error, a summary, a proposal, a film
 * run record, an archive or any other route or tool.
 *
 * TEST DOUBLES (labelled): builder A builds core rangeUsage, screenTime, searchRanges and filmWindowOfRange in another worktree.
 * Until that is merged they throw SourceRangesNotBuilt; the mock below then answers with `doubles`, a plain per-frame scan of the
 * contract's rule for picture clips on video tracks (the only kind these fixtures place). Once A's bodies are in, the real
 * functions answer and the doubles are never called: every number below is computed by hand, so the same expectations then check
 * A's functions through the route and the tool (decisions P7, P9 route and tool).
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, describeOps, SCREEN_TIME_LABEL, USAGE_LIMITS, type OpCall, type ProjectDocument, type SourceRange } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Grant, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { PEARLS_SERVER_BUILT, pearlsView } from './pearls.ts';
import { PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { ApiError, Store } from './store.ts';
import { stopTrackingJobs } from './tracking.ts';

const doubles = vi.hoisted(() => ({ used: new Set<string>() }));
vi.mock('../../../packages/core/src/sourceRanges.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../packages/core/src/sourceRanges.ts')>();
  const S = await import('../../../packages/core/src/speed.ts');
  const Tm = await import('@pulseframe/time');
  type Doc = import('../../../packages/core/src/schema.ts').ProjectDocument;
  type Range = import('../../../packages/core/src/schema.ts').SourceRange;
  type Asset = import('../../../packages/core/src/schema.ts').Asset;
  const span = (x: [number, number][]) => x.reduce((n, [a, b]) => n + b - a, 0);
  const union = (xs: [number, number][]) => { const s = [...xs].sort((a, b) => a[0] - b[0]); const out: [number, number][] = []; for (const [a, b] of s) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); } return out; };
  const order = (doc: Doc) => Object.values(doc.sourceRanges ?? {}).sort((x, y) => (x.assetId < y.assetId ? -1 : x.assetId > y.assetId ? 1 : 0) || (x.span && y.span ? Tm.cmp(x.span.start, y.span.start) : 0) || (x.id < y.id ? -1 : 1)).map((r) => r.id);
  const windowOf = (a: Pick<Asset, 'kind' | 'video' | 'duration'>, r: Range) => {
    if (a.kind === 'image' || !a.video || r.span === null) return null;
    const from = S.sourceFrameOfTime(a, r.span.start);
    let to = S.sourceFrameOfTime(a, r.span.end);
    if (Tm.lt(S.sourceTimeOfFrame(a, to), r.span.end)) to++;
    return { fromFrame: from, toFrame: Math.max(from + 1, to) };
  };
  /** Per-frame scan of picture clips on video tracks (the contract's rule, C6), one run per clip. */
  const usage = (doc: Doc) => {
    const rate = doc.settings.frameRate, out: Record<string, any> = {};
    for (const id of order(doc)) {
      const r = doc.sourceRanges![id]!, a = doc.assets[r.assetId]!, w = windowOf(a, r), uses: any[] = [];
      for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) {
        if (t.kind !== 'video') continue;
        for (const c of t.clips) {
          if (c.type !== 'media' || c.assetId !== r.assetId) continue;
          const s0 = Tm.nearestFrameIndex(c.start, rate), n = Tm.frameIndexAt(c.duration, rate);
          let i0 = -1, i1 = -1, k0 = 0, k1 = 0;
          for (let i = 0; i < n; i++) {
            const k = a.video ? S.sourceFrameIndexAt(a as any, c, Tm.add(c.start, Tm.frameTime(i, rate)), rate) : 0;
            if (w && (k < w.fromFrame || k >= w.toFrame)) continue;
            if (i0 < 0) { i0 = i; k0 = k; }
            i1 = i; k1 = k;
          }
          if (i0 < 0) continue;
          const src = r.span && a.video ? { start: Tm.max(r.span.start, S.sourceTimeOfFrame(a, k0)), end: Tm.min(r.span.end, S.sourceTimeOfFrame(a, k1 + 1)) } : { start: Tm.ZERO, end: a.duration };
          uses.push({ sequenceId: seq.id, trackId: t.id, clipId: c.id, medium: 'picture', hidden: t.hidden, fromFrame: s0 + i0, toFrame: s0 + i1 + 1, source: src });
        }
      }
      out[id] = { rangeId: id, uses, usedSource: uses.map((u) => u.source), untimedCopies: [] };
    }
    return { ranges: out, unused: order(doc).filter((id) => out[id].uses.length === 0), limits: ['transition_handles', 'time_effect_taps'] };
  };
  const screen = (doc: Doc, sequenceId?: string) => {
    const seq = doc.sequences[sequenceId ?? doc.mainSequenceId]!, rate = doc.settings.frameRate;
    const picture = union(seq.tracks.filter((t) => t.kind === 'video' && !t.hidden).flatMap((t) => t.clips.filter((c) => c.type === 'media').map((c) => { const s = Tm.nearestFrameIndex(c.start, rate); return [s, s + Tm.frameIndexAt(c.duration, rate)] as [number, number]; })));
    const u = usage(doc), per = new Map<string, { runs: [number, number][]; clips: Set<string> }>();
    for (const id of order(doc)) for (const p of doc.sourceRanges![id]!.people ?? []) for (const x of u.ranges[id].uses) {
      if (x.sequenceId !== seq.id || x.hidden) continue;
      const e = per.get(p) ?? { runs: [], clips: new Set<string>() };
      e.runs.push([x.fromFrame, x.toFrame]); e.clips.add(x.clipId); per.set(p, e);
    }
    const key = (pid: string) => (doc.people?.[pid]?.name ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
    const people = [...per].map(([personId, e]) => ({ personId, frames: span(union(e.runs)), clips: [...e.clips].sort() })).sort((a, b) => (key(a.personId) < key(b.personId) ? -1 : key(a.personId) > key(b.personId) ? 1 : a.personId < b.personId ? -1 : 1));
    const tagged = union([...per.values()].flatMap((e) => e.runs));
    return { sequenceId: seq.id, rate, pictureFrames: span(picture), untaggedFrames: span(picture) - span(tagged), people };
  };
  const orReal = <A extends unknown[], R>(name: string, fn: (...a: A) => R, double: (...a: A) => R) => (...a: A): R => {
    try { return fn(...a); } catch (e) { if (!(e instanceof real.SourceRangesNotBuilt)) throw e; doubles.used.add(name); return double(...a); }
  };
  return {
    ...real,
    rangeUsage: orReal('rangeUsage', real.rangeUsage, usage as any),
    screenTime: orReal('screenTime', real.screenTime, screen as any),
    searchRanges: orReal('searchRanges', real.searchRanges, ((doc: Doc, q: string) => (q === '' ? order(doc) : [])) as any),
    filmWindowOfRange: orReal('filmWindowOfRange', real.filmWindowOfRange, windowOf as any),
  };
});

// ---------- the plant ----------
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
/** A pearl named with the words spoken in it (verbatim: the transcript, readable by every credential, holds them too). */
const LABEL = 'אני רוצה ריבה של דינוזאורים';
/** A child's words as a pearl's name that nothing else holds: the walk looks for it (Hebrew and a Latin word). */
const SECRET = 'הסוד של פרפרזונה Zorglewump';
const NEEDLES = [/פרפרזונה/, /Zorglewump/i];
const labelLeak = (v: unknown): string | null => { const s = typeof v === 'string' ? v : JSON.stringify(v) ?? ''; const re = NEEDLES.find((x) => x.test(s)); return re ? `${re} in ${s.slice(Math.max(0, s.search(re) - 80), s.search(re) + 40)}` : null; };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const videoAsset = (name: string, contentHash: string) => ({ kind: 'video' as const, name, contentHash, byteSize: 64, container: 'mp4', mimeType: 'video/mp4', duration: f(300), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pv${n++}_`, actor: 'user:local', allowInternal });

/**
 * Three files A, B, C (10 s, 30 fps). V1: A at frames 0–90 (source 0–90), C at 90–150. V2 (a layer over V1): B at 60–120 (source
 * 0–60). V3, hidden: A at 200–260. People: נועה tagged on A by a «מי בקליפ?» presence tag (the whole file), איתי on B's pearl
 * [0, 2) s. A's pearl [30/30, 75/30) s carries LABEL and is shown by the V1 clip (frames 30–75) and the hidden one (230–260,
 * the hidden clip shows source 0–60, so frames 230–260). C's pearl [8, 9) s is shown nowhere.
 */
function plantedDocument(hashes: [string, string, string]): ProjectDocument {
  const imp = tx(createProject({ id: 'prj_pearls', name: 'פנינים', width: 640, height: 360, frameRate: R }), hashes.map((h, i) => ({ op: 'import_asset', args: { asset: videoAsset(`${'abc'[i]}.mp4`, h) } })), true);
  const [A, B, C] = imp.results.map((r) => r.output!.assetId as string) as [string, string, string];
  const v1 = imp.doc.sequences[imp.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
  const t1 = tx(imp.doc, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'video' } }]);
  const [v2, v3] = t1.results.map((r) => r.output!.trackId as string) as [string, string];
  const placed = tx(t1.doc, [
    { op: 'add_clip', args: { assetId: A, trackId: v1, start: f(0), duration: f(90), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: C, trackId: v1, start: f(90), duration: f(60), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: B, trackId: v2, start: f(60), duration: f(60), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: A, trackId: v3, start: f(200), duration: f(60), withLinkedAudio: false } },
    { op: 'update_track', args: { trackId: v3, hidden: true } },
  ]);
  const people = tx(placed.doc, [{ op: 'add_person', args: { name: 'נועה', birthDate: '2020-02-29' } }, { op: 'add_person', args: { name: 'איתי' } }]);
  const [noa, itai] = people.results.map((r) => r.output!.personId as string) as [string, string];
  const ranges: Record<string, SourceRange> = {
    rng_pearl: { id: 'rng_pearl', assetId: A, kind: 'pearl', span: { start: f(30), end: f(75) }, label: LABEL, createdBy: 'user:local' },
    rng_who: { id: 'rng_who', assetId: A, kind: 'presence', span: null, label: '', people: [noa], createdBy: 'user:local' },
    rng_b: { id: 'rng_b', assetId: B, kind: 'pearl', span: { start: f(0), end: f(60) }, label: '', people: [itai], createdBy: 'agent:helper' },
    rng_c: { id: 'rng_c', assetId: C, kind: 'pearl', span: { start: f(240), end: f(270) }, label: SECRET, createdBy: 'user:local' },
  };
  // a transcript of A whose words inside the pearl are LABEL (verbatim)
  const words = LABEL.split(' ').map((w, i) => ({ id: `w${i}`, text: w, start: f(31 + 5 * i), duration: f(4), confidence: null }));
  const transcripts = { [A]: { assetId: A, language: 'he', origin: { kind: 'manual' as const, provider: null, model: null, createdAt: '2026-11-25T00:00:00Z', createdBy: 'user:local' }, segments: [{ id: 'seg1', start: f(31), duration: f(40), text: LABEL, original: null, speaker: null, timing: 'word' as const, words }] } };
  return { ...people.doc, transcripts: { ...people.doc.transcripts, ...transcripts }, sourceRanges: ranges };
}

const grantOf = (people: 'names' | 'full'): Grant => ({ id: 'grt_1', name: 'g', mode: 'edit', projectIds: null, trackIds: null, range: null, budgetCents: 0, requestsPerMinute: null, exportsPerDay: null, people, expiresAt: null, revokedAt: null, createdAt: '2026-11-25T00:00:00Z', createdBy: 'user:local' });
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const NAMES_AGENT: Principal = { actor: 'agent:a', kind: 'agent', scopes: ['observe', 'edit'] };
const FULL_AGENT: Principal = { actor: 'agent:g', kind: 'agent', scopes: ['observe', 'edit'], grant: grantOf('full') };
const refusal = (fn: () => unknown) => { try { fn(); return null; } catch (e) { if (e instanceof ApiError) return { status: e.status, code: e.code, message: e.message }; throw e; } };
const HASHES: [string, string, string] = [`sha256:${'1'.repeat(64)}`, `sha256:${'2'.repeat(64)}`, `sha256:${'3'.repeat(64)}`];

describe('pearlsView (pure)', () => {
  const doc = plantedDocument(HASHES);
  const ids = Object.keys(doc.assets);
  it('is built; an unknown sequence is 404 with the id only', () => {
    expect(PEARLS_SERVER_BUILT).toBe(true);
    expect(refusal(() => pearlsView(doc, 3, OWNER, 'seq_none'))).toEqual({ status: 404, code: 'not_found', message: 'sequence seq_none not found' });
  });
  it('the owner reads labels and verbatim; usage is exact to the frame, the hidden clip listed as hidden; the unused pearl is named', () => {
    const v = pearlsView(doc, 3, OWNER);
    expect(v.labelsHidden).toBe(false);
    expect(v.ranges.map((r) => r.id).sort()).toEqual(['rng_b', 'rng_c', 'rng_pearl', 'rng_who']);
    const p = v.ranges.find((r) => r.id === 'rng_pearl')!;
    expect(p).toMatchObject({ label: LABEL, verbatim: true, kind: 'pearl', assetName: 'a.mp4', startSeconds: 1, endSeconds: 2.5, people: [], byAgent: false });
    expect(p.usage.uses.map((u) => [u.fromFrame, u.toFrame, u.hidden])).toEqual([[30, 75, false], [230, 260, true]]);
    expect(v.ranges.find((r) => r.id === 'rng_c')!.verbatim).toBe(false);
    expect(v.ranges.find((r) => r.id === 'rng_b')).toMatchObject({ byAgent: true, people: [{ id: expect.any(String), name: 'איתי' }] });
    expect(v.unused).toEqual(['rng_c']);
    expect(v.limits).toEqual([...USAGE_LIMITS]);
    expect(v.screenTimeLabel).toEqual(SCREEN_TIME_LABEL);
    expect(v.screenTimeLabel.he.length).toBeGreaterThan(0);
    expect(v.screenTimeLabel.en.length).toBeGreaterThan(0);
  });
  it('screen time by hand: picture 150 frames (V1 0–150 with the V2 layer 60–120); איתי 60, נועה 90 (the hidden track not counted); untagged 30', () => {
    const v = pearlsView(doc, 3, NAMES_AGENT);
    const name = (id: string) => doc.people![id]!.name;
    expect(v.sequenceId).toBe(doc.mainSequenceId);
    expect({ picture: v.screenTime.pictureFrames, untagged: v.screenTime.untaggedFrames, people: v.screenTime.people.map((p) => [name(p.personId), p.frames, p.clips.length]) })
      .toEqual({ picture: 150, untagged: 30, people: [['איתי', 60, 1], ['נועה', 90, 1]] });
    expect(v.screenTime.rate).toEqual(R);
    void ids;
  });
  it('a names credential reads every label as "" with labelsHidden, names only, no birth date; a people "full" grant reads labels', () => {
    const v = pearlsView(doc, 3, NAMES_AGENT);
    expect(v.labelsHidden).toBe(true);
    expect(v.ranges.every((r) => r.label === '' && r.verbatim === false)).toBe(true);
    expect(labelLeak(v)).toBeNull();
    expect(JSON.stringify(v)).not.toContain(LABEL);
    expect(JSON.stringify(v)).not.toMatch(/2020|birthDate/);
    expect(JSON.stringify(v)).toContain('נועה');
    const full = pearlsView(doc, 3, FULL_AGENT);
    expect(full.labelsHidden).toBe(false);
    expect(full.ranges.find((r) => r.id === 'rng_pearl')!.label).toBe(LABEL);
    // the same numbers whoever reads them
    expect(full.screenTime).toEqual(v.screenTime);
    expect(full.ranges.map((r) => r.usage)).toEqual(v.ranges.map((r) => r.usage));
  });
  it('a trim changes the coverage to the exact new numbers (P7)', () => {
    const clipA = doc.sequences[doc.mainSequenceId]!.tracks[0]!.clips.find((c) => c.type === 'media' && c.assetId === doc.sourceRanges!.rng_pearl!.assetId)!;
    const trimmed = tx(doc, [{ op: 'trim_clip', args: { clipId: clipA.id, edge: 'end', to: f(50) } }]).doc;
    const p = pearlsView(trimmed, 4, OWNER).ranges.find((r) => r.id === 'rng_pearl')!;
    expect(p.usage.uses.filter((u) => !u.hidden).map((u) => [u.fromFrame, u.toFrame])).toEqual([[30, 50]]);
    expect(pearlsView(trimmed, 4, OWNER).screenTime).toMatchObject({ pictureFrames: 140, untaggedFrames: 30 });
  });
});

// ---------- the server ----------
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, exporter: Exporter;
let capabilities: Capabilities, derivatives: Derivatives, speech: Speech, presence: Presence;
let pid = '', assetId = '', ownerCookie = '', namesGrant = '', fullGrant = '', proposalId = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = { name: string; headers: () => Record<string, string> };
const bearer = (name: string, token: () => string): Who => ({ name, headers: () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' }) });
const AGENT = bearer('agent token', () => auth.tokens.agent), OBSERVER = bearer('observer token', () => auth.tokens.observer), NAMES = bearer('grant with people left at its default', () => namesGrant);
const FULL = bearer('grant with people full', () => fullGrant);
const OWNER_WHO: Who = { name: 'owner session', headers: () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' }) };
async function rest(who: Who, method: string, url: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const r = await app.fetch(new Request(`${base()}${url}`, { method, headers: who.headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = Buffer.from(await r.arrayBuffer()).toString('utf8');
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}
let rpcId = 0;
async function rpc(who: Who, method: string, params: unknown): Promise<any> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who.headers(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  return msg.error ? { protocolError: msg.error } : msg.result;
}
const toolJson = (res: any) => JSON.parse(res.content[0].text);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pearls-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  // the media files (64 random bytes each), so that an archive can be written
  const hashes = [0, 1, 2].map(() => {
    const bytes = randomBytes(64), hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const tmp = path.join(store.tmpDir, `pearls_${randomBytes(4).toString('hex')}`);
    fs.writeFileSync(tmp, bytes);
    store.putBlob(hash, tmp, bytes.length, 'video/mp4');
    return hash;
  }) as [string, string, string];
  pid = store.importProject(plantedDocument(hashes)).doc.id;
  assetId = store.wholeProject(pid).doc.sourceRanges!.rng_pearl!.assetId;
  namesGrant = gov.createGrant({ name: 'names', mode: 'edit' }, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }).token;
  fullGrant = gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }).token;
  // a proposal that a people-'full' credential made: its operation arguments and entity states hold the label
  proposalId = `prp_pearls${randomBytes(3).toString('hex')}`;
  const ops = [{ op: 'update_source_range', args: { rangeId: 'rng_c', label: `${SECRET} 2` } }];
  const changes = [{ id: 'rng_c', before: null, after: { kind: 'sourceRange', range: { ...store.wholeProject(pid).doc.sourceRanges!.rng_c, label: `${SECRET} 2` } } }];
  store.db.prepare('INSERT INTO proposals (id, project_id, actor, grant_id, base_revision, label, ops, changes, summary, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(proposalId, pid, 'agent:full', null, 0, 'rename', JSON.stringify(ops), JSON.stringify(changes), 'Changed a marked range in "c.mp4"', 'open', new Date().toISOString());
  // the owner makes a family film that prefers pearls: its run record holds range ids and seconds, never a label
  const film = await rest(OWNER_WHO, 'POST', `/api/v1/projects/${pid}/recipes/family-film/apply`, { params: { assetIds: Object.keys(store.wholeProject(pid).doc.assets), targetSeconds: 30, picks: { pearls: 'prefer' } } });
  if (film.status !== 200) throw new Error(`film: ${film.status} ${film.text}`);
});
afterAll(async () => {
  // a tool the walk called may have started a measurement job: let it finish before the store closes
  for (let i = 0; i < 100 && (store.db.prepare("SELECT count(*) AS n FROM jobs WHERE status IN ('queued', 'running')").get() as { n: number }).n > 0; i++) await new Promise((r) => setTimeout(r, 100));
  await stopTrackingJobs(store);
  (app as any).browserExport?.stop();
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the route and the tool', () => {
  it('GET …/pearls and get_pearls give the same answer; the owner and a people "full" grant read the label, a names grant and the agent token read ""', async () => {
    const url = `/api/v1/projects/${pid}/pearls`;
    for (const [who, hidden] of [[OWNER_WHO, false], [FULL, false], [NAMES, true], [AGENT, true], [OBSERVER, true]] as const) {
      const r = await rest(who, 'GET', url);
      expect(r.status, who.name).toBe(200);
      expect(r.json.labelsHidden, who.name).toBe(hidden);
      expect(r.json.ranges.find((x: any) => x.id === 'rng_pearl').label, who.name).toBe(hidden ? '' : LABEL);
      const t = await rpc(who, 'tools/call', { name: 'get_pearls', arguments: { projectId: pid } });
      expect(t.isError ?? false, who.name).toBe(false);
      expect(toolJson(t), who.name).toEqual(r.json);
    }
    const seq = await rest(NAMES, 'GET', `${url}?sequenceId=seq_nowhere`);
    expect([seq.status, seq.json.error?.code ?? seq.json.code]).toEqual([404, 'not_found']);
  });
  it('the film made with picks.pearls prefer holds range ids and seconds in its run record, and no label (read as the owner)', async () => {
    const runs = JSON.stringify((await rest(OWNER_WHO, 'GET', `/api/v1/projects/${pid}`)).json.project.recipeRuns);
    expect(runs).toContain('"rangeId":"rng_pearl"');
    expect(runs).toContain('"rangeId":"rng_c"');
    expect(labelLeak(runs)).toBeNull();
    expect(runs).not.toContain(LABEL);
  });
  it('through the routes, an agent may not tag or give a label: commit, dry run, nested apply_transaction and propose are refused with fixed words', async () => {
    const tag: OpCall = { op: 'add_source_range', args: { assetId, people: ['per_x'] } };
    const label: OpCall = { op: 'update_source_range', args: { rangeId: 'rng_c', label: SECRET } };
    const tries = [
      ['POST', `/api/v1/projects/${pid}/transactions`, { ops: [tag] }, 'human_tag_required'],
      ['POST', `/api/v1/projects/${pid}/operations/validate`, { ops: [tag] }, 'human_tag_required'],
      ['POST', `/api/v1/projects/${pid}/transactions`, { ops: [{ op: 'apply_transaction', args: { ops: [tag] } }] }, 'human_tag_required'],
      ['POST', `/api/v1/projects/${pid}/proposals`, { ops: [tag] }, 'human_tag_required'],
      ['POST', `/api/v1/projects/${pid}/transactions`, { ops: [label] }, 'people_scope_required'],
      ['POST', `/api/v1/projects/${pid}/proposals`, { ops: [label] }, 'people_scope_required'],
    ] as const;
    for (const [method, url, body, code] of tries) {
      const r = await rest(NAMES, method, url, body);
      expect([r.status, r.json?.error?.code ?? r.json?.code], `${url} ${JSON.stringify(body).slice(0, 60)}`).toEqual([403, code]);
      expect(labelLeak(r.text), url).toBeNull();
    }
    for (const who of [FULL]) {
      const r = await rest(who, 'POST', `/api/v1/projects/${pid}/transactions`, { ops: [tag] });
      expect([r.status, r.json?.error?.code ?? r.json?.code]).toEqual([403, 'human_tag_required']);
    }
    const t = await rpc(NAMES, 'tools/call', { name: 'propose_transaction', arguments: { projectId: pid, ops: [tag] } });
    expect(t.isError).toBe(true);
    expect(toolJson(t).error?.code ?? toolJson(t).code).toBe('human_tag_required');
  });
});

// ---------- the walk ----------
const PARAMS: Record<string, () => string> = {
  id: () => pid, jobId: () => 'job_none', proposalId: () => proposalId, assetId: () => assetId, token: () => 'rnd_none', kind: () => 'thumb', motionTrackId: () => 'mtk_none',
  capabilityId: () => 'none.cap', recipeId: () => 'family-film', runId: () => 'run_none', templateId: () => 'none', variantId: () => 'var_none', approvalId: () => 'apr_none', grantId: () => 'grt_none',
  sfxId: () => 'none', modelId: () => 'none', index: () => '0', styleId: () => 'none', sequenceId: () => 'seq_main', groupId: () => 'mcg_none',
  key: () => encodeURIComponent('none/none'), versionId: () => 'ver_none', clipId: () => 'clp_none',
};
const QUERY: Record<string, string> = { 'GET /api/v1/projects/:id/frame': '?index=40', 'GET /api/v1/projects/:id/proposals/:proposalId/frame': '?index=40', 'GET /api/v1/on-this-day': '?date=2024-11-04' };
const LABEL_OP = (): OpCall => ({ op: 'update_source_range', args: { rangeId: 'rng_c', label: SECRET } });
const BODIES: Record<string, unknown> = {
  'POST /api/v1/projects/:id/transactions': { ops: [LABEL_OP()] }, 'POST /api/v1/projects/:id/operations': { ops: [LABEL_OP()] },
  'POST /api/v1/projects/:id/operations/validate': { ops: [LABEL_OP()] }, 'POST /api/v1/projects/:id/proposals': { ops: [LABEL_OP()] },
  'POST /api/v1/projects/:id/exports/plan': {}, 'POST /api/v1/projects/:id/recipes/:recipeId/plan': { params: { assetIds: [], picks: { pearls: 'prefer' } } },
  'POST /api/v1/projects/:id/undo': {}, 'POST /api/v1/projects/:id/redo': {},
};
describe('the walk: no label reaches a credential without the people scope', () => {
  it('control: the owner reads the planted label on the view, the project and the proposal', async () => {
    expect(labelLeak((await rest(OWNER_WHO, 'GET', `/api/v1/projects/${pid}/pearls`)).json)).not.toBeNull();
    expect(labelLeak((await rest(OWNER_WHO, 'GET', `/api/v1/projects/${pid}`)).json)).not.toBeNull();
    expect(labelLeak((await rest(OWNER_WHO, 'GET', `/api/v1/projects/${pid}/proposals/${proposalId}`)).json)).not.toBeNull();
  });
  it('every REST route and every MCP tool, called by a names grant, the agent token and the observer token, answers no label text', async () => {
    const leaks: string[] = [];
    let answered = 0;
    for (const who of [NAMES, AGENT, OBSERVER]) {
      for (const key of Object.keys(PEOPLE_REST_SURFACES)) {
        // the renderer's own session routes, the MCP entry (walked below), the event stream (event-scrubbed, peopleSurfaces.test.ts)
        // and requests that would start a job or change the project for the next credential are left out
        if (PEOPLE_REST_SURFACES[key]!.includes('renderer-only') || key === 'ALL /mcp' || key.endsWith('/events')) continue;
        const [method, route] = key.split(' ') as [string, string];
        if (method !== 'GET' && !Object.hasOwn(BODIES, key)) continue;
        const url = route.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(PARAMS[k]!())) + (QUERY[key] ?? '');
        const r = await rest(who, method, url, method === 'GET' ? undefined : BODIES[key]);
        if (r.status < 300) answered++;
        const leak = labelLeak(r.text);
        if (leak) leaks.push(`${who.name} ${key} → ${r.status}: ${leak}`);
      }
      const tools: string[] = (await rpc(who, 'tools/list', {})).tools.map((t: { name: string }) => t.name);
      const ops = new Set(describeOps().map((o) => o.name));
      for (const name of tools) {
        // operation tools would change the walked project (an edit-mode grant); the two that give a label are called
        if (ops.has(name) && name !== 'add_source_range' && name !== 'update_source_range') continue;
        if (/^(export_|render_|transcribe|analyze|measure|start_|retry_|cancel_|import_|generate|stabilise|track_|add_builtin)/.test(name)) continue; // jobs: no document text in their answers
        const args: Record<string, unknown> = { projectId: pid, assetId, rangeId: 'rng_c', frameIndex: 40, ...(name === 'apply_transaction' || name === 'propose_transaction' ? { ops: [LABEL_OP()] } : {}), ...(name === 'update_source_range' ? { label: SECRET } : {}) };
        const res = await rpc(who, 'tools/call', { name, arguments: args });
        const leak = labelLeak(res);
        if (leak) leaks.push(`${who.name} tool ${name}: ${leak}`);
      }
    }
    expect(answered, 'routes that answered with content').toBeGreaterThan(40);
    expect(leaks).toEqual([]);
    // what a 'names' credential reads is the reader document: the label is blank there; on the merged tree core's real functions
    // answered every call (the doubles above were never used), so this walk ran on the real usage, screen time and film code
    expect([...doubles.used]).toEqual([]);
  }, 120_000);
});

// ---------- integration (wave 7, merged tree): the live paths the walk leaves out ----------
describe('integration: the three operations and remove_asset, live', () => {
  it('a names grant, the agent token and the observer token read no label in the revision events, the history summaries and operation names, or the reader document; the owner does (control)', async () => {
    const src = store.wholeProject(pid).doc;
    const ip = store.importProject({ ...structuredClone(src), id: 'prj_pearls_live', recipeRuns: {} }).doc.id;
    const C = src.sourceRanges!.rng_c!.assetId;
    const noa = Object.values(src.people!).find((p) => p.name === 'נועה')!.id;
    // the clips that show C go first (linked clips go together), so that remove_asset may take the file and its ranges
    for (let i = 0; i < 20; i++) {
      const user = Object.values(store.wholeProject(ip).doc.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips)).find((c) => c.type === 'media' && c.assetId === C);
      if (!user) break;
      store.commit({ projectId: ip, actor: 'user:local', ops: [{ op: 'delete_clip', args: { clipId: user.id } }] });
    }
    const open = async (who: Who) => {
      const r = await app.fetch(new Request(`${base()}/api/v1/projects/${ip}/events`, { headers: who.headers() }));
      expect(r.status, who.name).toBe(200);
      const reader = r.body!.getReader();
      const box = { text: '' };
      const read = async (until: (t: string) => boolean) => { const end = Date.now() + 8000; while (!until(box.text) && Date.now() < end) { const c = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), 200))]); if (c && !c.done) box.text += Buffer.from(c.value).toString('utf8'); } };
      await read((t) => t.includes('event: hello'));
      return { who, box, read, reader };
    };
    const streams = await Promise.all([OWNER_WHO, NAMES, AGENT, OBSERVER].map(open));
    const before = store.getProject(ip).revision;
    const commit = async (ops: OpCall[]) => { const r = await rest(OWNER_WHO, 'POST', `/api/v1/projects/${ip}/transactions`, { ops }); expect(r.status, r.text.slice(0, 200)).toBe(200); return r.json; };
    const added = await commit([{ op: 'add_source_range', args: { assetId: C, start: f(10), end: f(20), label: `${SECRET} new`, people: [noa] } }]);
    const rangeId = added.results[0].output.rangeId as string;
    await commit([{ op: 'update_source_range', args: { rangeId, label: `${SECRET} changed`, start: f(11), end: f(21) } }]);
    await commit([{ op: 'remove_source_range', args: { rangeId } }]);
    const gone = await commit([{ op: 'remove_asset', args: { assetId: C } }]);
    expect(gone.summary ?? JSON.stringify(gone)).toMatch(/marked range\(s\) went with it/);
    for (const s2 of streams) await s2.read((t) => (t.match(/event: revision/g) ?? []).length >= 4);
    for (const s2 of streams) await s2.reader.cancel();
    const [owner, ...others] = streams;
    // control: the owner's session receives the entity states, label included
    expect(labelLeak(owner!.box.text), 'owner control').not.toBeNull();
    for (const s2 of others) {
      expect((s2.box.text.match(/event: revision/g) ?? []).length, s2.who.name).toBeGreaterThanOrEqual(4);
      expect(labelLeak(s2.box.text), `${s2.who.name} events`).toBeNull();
      const hist = await rest(s2.who, 'GET', `/api/v1/projects/${ip}/history?since=${before}`);
      expect(hist.status, s2.who.name).toBe(200);
      const ops = hist.json.events.flatMap((e: { ops?: string[] }) => e.ops ?? []);
      expect(ops, s2.who.name).toEqual(expect.arrayContaining(['add_source_range', 'update_source_range', 'remove_source_range', 'remove_asset']));
      expect(labelLeak(hist.text), `${s2.who.name} history`).toBeNull();
      expect(labelLeak((await rest(s2.who, 'GET', `/api/v1/projects/${ip}`)).text), `${s2.who.name} project`).toBeNull();
    }
    // the summaries name the file, never the label, for the owner too
    const ownerHist = (await rest(OWNER_WHO, 'GET', `/api/v1/projects/${ip}/history?since=${before}`)).json.events.map((e: { summary: string }) => e.summary);
    expect(ownerHist).toHaveLength(4);
    expect(labelLeak(ownerHist)).toBeNull();
  }, 60_000);

  it('tagging, changing or removing a tagged range and removing a tagged person: 403 human_tag_required for a names grant, a people "full" grant, the agent token and the observer token (REST and MCP); nothing is committed', async () => {
    const doc = store.wholeProject(pid).doc;
    const noa = Object.values(doc.people!).find((p) => p.name === 'נועה')!.id;
    const calls: [string, OpCall][] = [
      ['tag', { op: 'add_source_range', args: { assetId, kind: 'presence', people: [noa] } }],
      ['change a tagged range', { op: 'update_source_range', args: { rangeId: 'rng_who', people: [] } }],
      ['remove a tagged range', { op: 'remove_source_range', args: { rangeId: 'rng_who' } }],
      ['remove a tagged person', { op: 'remove_person', args: { personId: noa } }],
    ];
    const rev = store.getProject(pid).revision;
    for (const who of [NAMES, FULL, AGENT, OBSERVER]) {
      for (const [what, call] of calls) {
        const r = await rest(who, 'POST', `/api/v1/projects/${pid}/transactions`, { ops: [call] });
        expect([r.status, r.json?.error?.code ?? r.json?.code], `${who.name} ${what}`).toEqual([403, 'human_tag_required']);
        const t = await rpc(who, 'tools/call', { name: 'apply_transaction', arguments: { projectId: pid, ops: [call] } });
        expect(t.isError, `${who.name} MCP ${what}`).toBe(true);
        expect(toolJson(t).error?.code ?? toolJson(t).code, `${who.name} MCP ${what}`).toBe('human_tag_required');
      }
    }
    expect(store.getProject(pid).revision).toBe(rev);
  });
});
