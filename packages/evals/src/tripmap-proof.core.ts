/**
 * pnpm proof:tripmap, part core (W1): checks 1, 8, 12 and 14 of tripmap-proof.ts against the real ops and a real server
 * (startServer({ port: 0 }), REST and MCP clients as the other proofs use them). The integrator imports runTripmapCore().
 *
 * SYNTHETIC ONLY, made here and deleted at the end: an accented click loop at 120 bpm in 4/4 from ffmpeg sine bursts (30 ms of
 * 1 kHz on every beat, the first of every four at full level, the others at 0.35), analysed by the existing beat job (POST
 * …/analyze kind beats). The loop is 12 s rather than the plan's 6 s: the bar estimator needs at least 12 beats (beats.ts
 * estimateBars), and a 6-s loop gives 12 at most. Stops are typed as coordinates. Nobody here listens or looks: every check is a
 * measurement of numbers in the document and the answers.
 * Run alone: `tsx packages/evals/src/tripmap-proof.core.ts` (prints each check; exits 1 on a failure, 2 when ffmpeg is missing).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { MAP_REFUSALS, evenStopFrames, type ProjectDocument } from '@pulseframe/core';
import { startServer } from '@pulseframe/server';
import { translateRefusal } from '../../i18n/src/index.ts';

export interface TripmapCheck { ok: boolean; detail: unknown }
export type TripmapCoreResult = Record<'1' | '8' | '12' | '14', TripmapCheck> | { blocked: string };

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sha = (doc: unknown) => createHash('sha256').update(JSON.stringify(doc)).digest('hex');
const STOPS = [
  { name: 'תל אביב', lon: 34_768_066, lat: 32_081_937 },
  { name: 'ירושלים', lon: 35_206_626, lat: 31_778_408, via: 'road' },
  { name: 'לונדון', lon: -118_668, lat: 51_501_941, via: 'flight' },
];

function ffmpegOk(): boolean { try { execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' }); return true; } catch { return false; } }
/** The click loop: `seconds` long, 48 kHz stereo WAV. */
function clickLoop(file: string, seconds: number) {
  const expr = '0.9*lt(mod(t\\,0.5)\\,0.03)*if(lt(mod(t\\,2)\\,0.03)\\,1\\,0.35)*sin(2*PI*1000*t)';
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=${expr}:s=48000:d=${seconds}`, '-ac', '2', '-c:a', 'pcm_s16le', file]);
}

export async function runTripmapCore(): Promise<TripmapCoreResult> {
  if (!ffmpegOk()) return { blocked: 'ffmpeg is not installed: the click loop cannot be made' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tripmap-core-'));
  const s = await startServer({ port: 0, dataDir: path.join(dir, 'data') });
  const mcps: Client[] = [];
  try {
    const owner = { actor: 'user:local', kind: 'user' as const, scopes: ['observe', 'edit'] as ('observe' | 'edit')[] };
    const rest = (token: string) => async (method: string, p: string, body?: unknown): Promise<{ status: number; body: any }> => {
      const r = await fetch(`${s.url}/api/v1${p}`, { method, headers: { authorization: `Bearer ${token}`, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await r.text();
      return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') && text ? JSON.parse(text) : text };
    };
    const agent = rest(s.auth.tokens.agent);
    const stored = (pid: string) => s.store.getProject(pid).doc as ProjectDocument;
    const clipOf = (pid: string, id: string) => Object.values(stored(pid).sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips.map((c) => ({ c, t })))).find((x) => x.c.id === id);
    const newProject = async (name: string) => (await agent('POST', '/projects', { name, width: 1280, height: 720 })).body.project.id as string;
    const tx = (pid: string, ops: unknown[]) => agent('POST', `/projects/${pid}/transactions`, { ops });
    const mcpOf = async (token: string) => {
      const c = new Client({ name: 'tripmap-core-proof', version: '0' });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}`, connection: 'close' } } }));
      mcps.push(c);
      return async (name: string, args: Record<string, unknown>) => {
        const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
        const text = r.content?.[0]?.text ?? '';
        let data: any = text; try { data = JSON.parse(text); } catch { /* plain text */ }
        return { isError: !!r.isError, data };
      };
    };

    // ---------------- check 1: add, one clip of kind map on a titles track, 0.01°, even times; one undo restores the hash
    const c1 = await (async (): Promise<TripmapCheck> => {
      const pid = await newProject('tripmap-1');
      const before = sha(stored(pid));
      const r = await tx(pid, [{ op: 'add_trip_map', args: { start: f(30), duration: f(240), stops: STOPS } }]);
      const clipId = r.body?.results?.[0]?.output?.clipId as string | undefined;
      const found = clipId ? clipOf(pid, clipId) : undefined;
      const drawnClips = Object.values(stored(pid).sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips)).filter((c) => c.type === 'drawn');
      const payload = found?.c.type === 'drawn' ? (found.c.drawn as unknown as { kind: string; stops: { lon: number; lat: number; at: number }[]; timing: string }) : null;
      const coords = payload?.stops.map((x) => [x.lon, x.lat]) ?? null;
      const times = payload?.stops.map((x) => x.at) ?? null;
      const undo = await agent('POST', `/projects/${pid}/undo`, {});
      const after = sha(stored(pid));
      const wantCoords = [[34_770_000, 32_080_000], [35_210_000, 31_780_000], [-120_000, 51_500_000]], wantTimes = evenStopFrames(3, 240, R);
      const ok = r.status === 200 && drawnClips.length === 1 && payload?.kind === 'map' && ['text'].includes(found?.t.kind ?? '') && JSON.stringify(coords) === JSON.stringify(wantCoords)
        && JSON.stringify(times) === JSON.stringify(wantTimes) && payload?.timing === 'even' && undo.status === 200 && after === before;
      return { ok, detail: { status: r.status, drawnClips: drawnClips.length, kind: payload?.kind ?? null, track: found?.t.kind ?? null, coords, times, wantTimes, undo: undo.status, hashRestored: after === before } };
    })();

    // ---------------- check 8: bars on the analysed loop, nearest frame, |residual| ≤ half a frame; no music → map_no_music, Hebrew
    const c8 = await (async (): Promise<TripmapCheck> => {
      const pid = await newProject('tripmap-8');
      const file = path.join(dir, 'click-loop-120.wav');
      clickLoop(file, 12);
      const up = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'x-filename': 'click-loop-120.wav', connection: 'close' }, body: fs.readFileSync(file) });
      const assetId = ((await up.json()) as { assetId: string }).assetId;
      const an = await agent('POST', `/projects/${pid}/assets/${assetId}/analyze`, { kind: 'beats' });
      const placed = await tx(pid, [
        { op: 'add_clip', args: { assetId, start: f(0), withLinkedAudio: false } },
        { op: 'add_trip_map', args: { start: f(30), duration: f(300), stops: STOPS } },
      ]);
      const mapId = placed.body?.results?.[1]?.output?.clipId as string | undefined;
      const timed = mapId ? await tx(pid, [{ op: 'time_trip_map', args: { clipId: mapId, to: 'bars' } }]) : null;
      const found = mapId ? clipOf(pid, mapId) : undefined;
      const payload = found?.c.type === 'drawn' ? (found.c.drawn as unknown as { stops: { at: number }[]; timing: string; timedTo?: { barsPerLeg: number } }) : null;
      // the bar starts as the document holds them (source seconds of the file = timeline seconds: the clip starts at 0)
      const bars = ((stored(pid).analyses[assetId]?.beats as { downbeats?: T.RationalTime[] } | undefined)?.downbeats ?? []);
      const start = f(30), from = T.add(start, T.rt(1, 2));
      const inside = bars.filter((b) => T.lte(from, b));
      const per = payload?.timedTo?.barsPerLeg ?? 1;
      const rows = (payload?.stops ?? []).map((st, i) => {
        const bar = inside[i * per];
        if (!bar) return { at: st.at, bar: null, nearest: null, residualMs: null };
        const residual = T.toSeconds(T.sub(T.add(start, f(st.at)), bar)) * 1000;
        return { at: st.at, bar: T.toSeconds(bar), nearest: T.nearestFrameIndex(T.sub(bar, start), R), residualMs: Math.round(residual * 1000) / 1000 };
      });
      const barsOk = timed?.status === 200 && payload?.timing === 'bars' && rows.length === 3 && rows.every((x) => x.nearest === x.at && x.residualMs !== null && Math.abs(x.residualMs) <= 1000 / 30 / 2);
      // no music: a second map in another project
      const pid2 = await newProject('tripmap-8b');
      const m2 = await tx(pid2, [{ op: 'add_trip_map', args: { start: f(0), duration: f(240), stops: STOPS } }]);
      const id2 = m2.body?.results?.[0]?.output?.clipId as string;
      const none = await tx(pid2, [{ op: 'time_trip_map', args: { clipId: id2, to: 'bars' } }]);
      const he = none.body?.error?.message ? translateRefusal('he', none.body.error.message) : null;
      const noneOk = none.status >= 400 && none.body?.error?.details?.reason === MAP_REFUSALS.noMusic.reason && none.body?.error?.message === MAP_REFUSALS.noMusic.message() && !!he && /[א-ת]/.test(he);
      return { ok: an.status === 200 && barsOk && noneOk, detail: { analyse: an.status, barsFound: bars.length, meter: an.body?.beats?.meter ?? null, timed: timed?.status ?? null, barsPerLeg: per, rows, noMusic: { status: none.status, reason: none.body?.error?.details?.reason ?? null, he } } };
    })();

    // ---------------- check 12: refusals over REST with their reason and Hebrew; text ops on a map clip answer drawn_not_text
    const c12 = await (async (): Promise<TripmapCheck> => {
      const pid = await newProject('tripmap-12');
      const add = (stops: unknown[], duration = 240) => tx(pid, [{ op: 'add_trip_map', args: { start: f(0), duration: f(duration), stops } }]);
      const [A, B] = [STOPS[0]!, { ...STOPS[1]!, via: undefined }];
      const cases: [string, keyof typeof MAP_REFUSALS, Promise<{ status: number; body: any }>][] = [
        ['13 stops', 'stopCount', add(Array.from({ length: 13 }, (_, i) => ({ name: `עצירה ${i + 1}`, lon: i * 1_000_000, lat: 0 })))],
        ['a 41-letter name', 'stopName', add([A, { ...B, name: 'א'.repeat(41) }])],
        ['latitude 81°', 'stopPlace', add([A, { ...B, lat: 81_000_000 }])],
        ['two identical stops in a row', 'samePlace', add([A, { ...A, name: 'יפו' }])],
        ['legs under 1 s', 'tooShort', add([{ ...A, at: 0 }, { ...B, at: 20 }])],
        ['a travel mode on stop 0', 'firstVia', add([{ ...A, via: 'flight' }, B])],
      ];
      const rows: unknown[] = [];
      let ok = true;
      for (const [name, key, p] of cases) {
        const r = await p;
        const he = r.body?.error?.message ? translateRefusal('he', r.body.error.message) : null;
        const good = r.status === 422 && r.body?.error?.code === MAP_REFUSALS[key].code && r.body?.error?.details?.reason === MAP_REFUSALS[key].reason && !!r.body?.error?.hint && !!he && /[א-ת]/.test(he);
        ok &&= good;
        rows.push({ name, status: r.status, reason: r.body?.error?.details?.reason ?? null, he, good });
      }
      const m = await add(STOPS);
      const clipId = m.body?.results?.[0]?.output?.clipId as string;
      for (const [name, call] of [['update_text', { op: 'update_text', args: { clipId, text: 'x' } }], ['apply_text_preset', { op: 'apply_text_preset', args: { clipId, presetId: 'clean' } }]] as const) {
        const r = await tx(pid, [call]);
        const he = r.body?.error?.message ? translateRefusal('he', r.body.error.message) : null;
        const good = r.status === 422 && r.body?.error?.code === 'drawn_not_text' && !!he && /[א-ת]/.test(he);
        ok &&= good;
        rows.push({ name, status: r.status, code: r.body?.error?.code ?? null, he, good });
      }
      return { ok, detail: rows };
    })();

    // ---------------- check 14: the agent path over MCP; only the summary in get_timeline; propose mode proposes; no place route or tool
    const c14 = await (async (): Promise<TripmapCheck> => {
      const pid = await newProject('tripmap-14');
      const edit = await mcpOf(s.governance.createGrant({ name: 'tripmap-edit', mode: 'edit' }, owner).token);
      const added = await edit('add_trip_map', { projectId: pid, start: f(30), duration: f(240), stops: STOPS });
      const clipId = added.data?.results?.[0]?.output?.clipId as string | undefined;
      const tl = await edit('get_timeline', { projectId: pid });
      const clip = (tl.data?.tracks ?? []).flatMap((t: any) => t.clips ?? []).find((c: any) => c.id === clipId);
      const want = { kind: 'map', name: { he: 'מפת טיול', en: 'Trip map' }, stops: 3, modes: ['road', 'flight'], names: ['תל אביב', 'ירושלים', 'לונדון'], look: 'paper', timing: 'even' };
      const summaryOnly = !!clip && isDeepStrictEqual(clip.drawn, want) && !/"lon"|"lat"|34770000|"stops":\[/.test(JSON.stringify(clip));
      const rev = s.store.getProject(pid).revision;
      const propose = await mcpOf(s.governance.createGrant({ name: 'tripmap-propose', mode: 'propose' }, owner).token);
      const proposed = await propose('add_trip_map', { projectId: pid, start: f(300), duration: f(240), stops: STOPS });
      const proposalOk = !proposed.isError && proposed.data?.proposed === true && !!proposed.data?.proposalId && s.store.getProject(pid).revision === rev;
      const tools = (await mcps[0]!.listTools()).tools.map((t) => t.name);
      // a tool about places (find_place, search_places …); place_multicam and replace_text use «place» as a verb
      const placeTools = tools.filter((n) => /(^|_)places?$|find_place|places?_search|search_places?/.test(n));
      const route = await agent('GET', '/places?q=אילת');
      const ok = !added.isError && !!clipId && summaryOnly && proposalOk && placeTools.length === 0 && route.status === 404;
      return { ok, detail: { added: !added.isError, summary: clip?.drawn ?? null, summaryOnly, proposed: { isError: proposed.isError, proposed: proposed.data?.proposed ?? null, proposalId: proposed.data?.proposalId ?? null, revisionMoved: s.store.getProject(pid).revision - rev }, placeTools, placesRoute: route.status } };
    })();

    return { 1: c1, 8: c8, 12: c12, 14: c14 };
  } finally {
    for (const c of mcps) await c.close().catch(() => {});
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runTripmapCore();
  if ('blocked' in r) { console.error(`tripmap-proof.core: blocked: ${r.blocked}`); process.exit(2); }
  for (const [k, v] of Object.entries(r)) console.log(`${v.ok ? '  ok  ' : ' FAIL '} ${k}  ${JSON.stringify(v.detail)}`);
  process.exit(Object.values(r).every((v) => v.ok) ? 0 : 1);
}
