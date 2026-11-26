/**
 * Soak and recovery test (SPEC Appendix C3): a long editing session against the real server and SQLite store.
 * 3,000 mixed transactions (add, move, trim, split, keyframes, effects, captions, undo/redo) by two actors, then:
 * latency at the start vs the end, database size, server memory, full op-log replay equal to the live document,
 * restart and reopen equal to before, and document validity throughout.
 * One run on one machine: the numbers are a sample, not a performance claim.   pnpm soak
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { validateProject } from '@pulseframe/core';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/soak');
const N = Number(process.env.PF_SOAK_N ?? 3000);
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return Number(s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2)); };
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = <X>(a: X[]) => a[Math.floor(rnd() * a.length)]!;

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4'), frames: 240 });
  const dataDir = path.join(art, 'data');
  let s = await startServer({ port: 0, dataDir });
  const boundPort = Number(new URL(s.url).port); // the restart below must come back on this port: the cookie and its origin were issued for it
  const cookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const creds = [{ authorization: `Bearer ${s.auth.tokens.agent}` }, { cookie, origin: s.url }] as Record<string, string>[];
  const call = async (p: string, body?: unknown, cred = creds[0]!) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { connection: 'close', ...cred, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null } as { status: number; body: any };
  };
  const measurements: Record<string, unknown> = {};
  try {
    const pid = (await call('/projects', { name: 'soak', width: 640, height: 360 })).body.project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...creds[0]!, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const assetId = up.assetId;
    const lat: number[] = [];
    let ok = 0, refused = 0, serverErrors = 0, invalid = 0;
    const rss0 = process.memoryUsage().rss;
    const t0 = Date.now();
    let doc = (await call(`/projects/${pid}`)).body.project;
    for (let i = 0; i < N; i++) {
      const clips = doc.sequences.seq_main.tracks.flatMap((t: any) => t.clips.map((c: any) => ({ ...c, kind: t.kind })));
      const vis = clips.filter((c: any) => c.kind === 'video' || c.kind === 'text');
      const c = vis.length ? pick(vis) as any : null;
      const start = T.frameIndexAt(c?.start ?? f(0), R), dur = T.frameIndexAt(c?.duration ?? f(0), R);
      const choices: (() => { path: string; body: unknown })[] = [
        () => ({ path: 'transactions', body: { ops: [{ op: 'add_clip', args: { assetId, start: f(Math.floor(rnd() * 3000) * 2), duration: f(10 + Math.floor(rnd() * 50)), sourceIn: f(Math.floor(rnd() * 100)) } }] } }),
        () => ({ path: 'transactions', body: { ops: [{ op: 'add_text', args: { text: `כותרת ${i}`, start: f(Math.floor(rnd() * 6000)), duration: f(15 + Math.floor(rnd() * 60)) } }] } }),
        ...(c ? [
          () => ({ path: 'transactions', body: { ops: [{ op: 'move_clip', args: { clipId: c.id, start: f(Math.floor(rnd() * 6000)) } }] } }),
          () => ({ path: 'transactions', body: { ops: [{ op: 'trim_clip', args: { clipId: c.id, edge: 'end', to: f(start + Math.max(2, Math.floor(dur * (0.4 + rnd() * 0.5)))) } }] } }),
          () => ({ path: 'transactions', body: { ops: [{ op: 'split_clip', args: { clipId: c.id, at: f(start + Math.max(1, Math.floor(dur / 2))) } }] } }),
          () => ({ path: 'transactions', body: { ops: [{ op: 'set_keyframe', args: { clipId: c.id, property: pick(['x', 'y', 'opacity']), time: f(Math.floor(rnd() * Math.max(1, dur))), value: Number((rnd() * 0.8).toFixed(3)) } }] } }),
          () => ({ path: 'transactions', body: { ops: [{ op: 'add_effect', args: { clipId: c.id, type: pick(['color.adjust', 'blur.gaussian', 'light.vignette']) } }] } }),
          () => ({ path: 'transactions', body: { ops: [{ op: 'set_clip_transform', args: { clipId: c.id, transform: { x: Number((rnd() - 0.5).toFixed(3)), scale: Number((0.5 + rnd()).toFixed(3)) } } }] } }),
          () => ({ path: 'transactions', body: { ops: [{ op: 'delete_clip', args: { clipId: c.id } }] } }),
        ] : []),
        () => ({ path: 'undo', body: {} }),
        () => ({ path: 'redo', body: {} }),
      ];
      const req = pick(choices)();
      const cred = creds[i % 7 === 0 ? 1 : 0]!; // the owner makes every seventh edit
      const t = performance.now();
      const r = await call(`/projects/${pid}/${req.path}`, req.body, cred);
      lat.push(performance.now() - t);
      if (r.status === 200) ok++; else if (r.status >= 500) serverErrors++; else refused++;
      if (i % 100 === 99) {
        doc = (await call(`/projects/${pid}`)).body.project;
        if (validateProject(doc).length) invalid++;
      } else if (r.status === 200) doc = (await call(`/projects/${pid}`)).body.project;
    }
    const wall = (Date.now() - t0) / 1000;
    const live = (await call(`/projects/${pid}`)).body;
    const first = lat.slice(0, 300), last = lat.slice(-300);
    measurements.session = { transactionsAttempted: N, committed: ok, refusedAsInvalidOrConflict: refused, serverErrors, wallSeconds: Number(wall.toFixed(1)), finalRevision: live.revision, clips: live.project.sequences.seq_main.tracks.reduce((n: number, t: any) => n + t.clips.length, 0) };
    measurements.commitLatencyMs = { first300: { median: pct(first, 0.5), p95: pct(first, 0.95) }, last300: { median: pct(last, 0.5), p95: pct(last, 0.95) }, note: 'includes HTTP round trip on loopback; each commit is followed by a full project read in this harness' };
    measurements.storage = { sqliteBytes: fs.statSync(path.join(dataDir, 'pulseframe.sqlite')).size, bytesPerCommit: Math.round(fs.statSync(path.join(dataDir, 'pulseframe.sqlite')).size / Math.max(1, ok)) };
    measurements.memory = { harnessAndServerRssGrowthMb: Math.round((process.memoryUsage().rss - rss0) / 1e6) };
    check(`${N} mixed transactions by two actors: no server error, the document was valid at all ${Math.floor(N / 100)} checkpoints`, serverErrors === 0 && invalid === 0 && ok > N * 0.5, measurements.session);
    // Is the slowdown caused by the length of history or by the size of the document? Edit a NEW small project in the same
    // database (which now holds the whole history above) and compare with the first commits of the session.
    const small = (await call('/projects', { name: 'small', width: 640, height: 360 })).body.project.id;
    const smallLat: number[] = [];
    for (let i = 0; i < 150; i++) { const t = performance.now(); await call(`/projects/${small}/transactions`, { ops: [{ op: 'add_text', args: { text: `t${i}`, start: f(i * 40), duration: f(30) } }] }); smallLat.push(performance.now() - t); await call(`/projects/${small}`); }
    const clipsNow = (measurements.session as any).clips as number;
    (measurements.commitLatencyMs as any).smallProjectAfterLongHistory = { median: pct(smallLat, 0.5), p95: pct(smallLat, 0.95) };
    (measurements.commitLatencyMs as any).scaling = { clipsAtEnd: clipsNow, msPerHundredClips: Number((((pct(last, 0.5) - pct(first, 0.5)) / clipsNow) * 100).toFixed(2)), explanation: 'every commit copies, validates, diffs and stores the whole document, so cost grows with project size' };
    check('history length does not slow edits: a small project in the same database, after thousands of revisions elsewhere, commits as fast as at the start of the session', pct(smallLat, 0.5) <= Math.max(2 * pct(first, 0.5), 8), (measurements.commitLatencyMs as any).smallProjectAfterLongHistory);
    check(`project size does slow edits (measured, a known limit of whole-document commits): median ${pct(last, 0.5)} ms with ${clipsNow} clips; regression guard: under 50 ms at this size`, pct(last, 0.5) < 50, measurements.commitLatencyMs);
    const t1 = performance.now();
    const replayed = (await call(`/projects/${pid}?revision=${live.revision}`)).body;
    const replayMs = performance.now() - t1;
    const half = (await call(`/projects/${pid}?revision=${Math.floor(live.revision / 2)}`)).body;
    measurements.replay = { opsReplayed: live.revision, ms: Math.round(replayMs) };
    check('replaying the whole operation log from an empty project reproduces the live document exactly; an earlier revision can be reconstructed and is valid', JSON.stringify(replayed.project) === JSON.stringify(live.project) && half.revision === Math.floor(live.revision / 2) && validateProject(half.project).length === 0, measurements.replay);
    await s.close();
    const t2 = performance.now();
    s = await startServer({ port: boundPort, dataDir });
    const reopened = (await call(`/projects/${pid}`)).body;
    measurements.restart = { reopenMs: Math.round(performance.now() - t2) };
    const afterRestart = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'rename_project', args: { name: 'after restart' } }] });
    const undoAfter = await call(`/projects/${pid}/undo`, {});
    check('after a server restart the project reopens identical, accepts new edits, and undo history still works', JSON.stringify(reopened.project) === JSON.stringify(live.project) && reopened.revision === live.revision && afterRestart.status === 200 && undoAfter.status === 200, measurements.restart);
    // Move the project to another machine: download its archive over HTTP and import it into a second server with an empty data directory.
    const t3 = performance.now();
    const arc = Buffer.from(await (await fetch(`${s.url}/api/v1/projects/${pid}/archive`, { headers: { connection: 'close', ...creds[0]! } })).arrayBuffer());
    const s2 = await startServer({ port: 0, dataDir: path.join(art, 'data-restored') });
    try {
      const h2 = { authorization: `Bearer ${s2.auth.tokens.agent}`, connection: 'close' };
      const imp = await fetch(`${s2.url}/api/v1/projects/import`, { method: 'POST', headers: { ...h2, 'content-type': 'application/x-tar' }, body: arc });
      const impBody: any = await imp.json();
      const restored: any = await (await fetch(`${s2.url}/api/v1/projects/${impBody.project?.id}`, { headers: h2 })).json();
      const frameOf = async (base: string, id: string, hd: Record<string, string>) => Buffer.from(await (await fetch(`${base}/api/v1/projects/${id}/frame?index=3`, { headers: hd })).arrayBuffer());
      const a1 = await frameOf(s.url, pid, { connection: 'close', ...creds[0]! }), a2 = await frameOf(s2.url, impBody.project?.id, h2);
      measurements.archive = { bytes: arc.length, exportImportMs: Math.round(performance.now() - t3) };
      check('the project archive restores on a second server with an empty data directory: same document (new id), media present, and a rendered frame is byte-identical to the original', imp.status === 201 && JSON.stringify({ ...restored.project, id: reopened.project.id }) === JSON.stringify(reopened.project) && a1.length > 500 && a1.equals(a2), { ...(measurements.archive as object), blobsAdded: impBody.blobsAdded });
    } finally { await s2.close(); }
    const integrity = (s.store as any).db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    check('SQLite integrity check passes', integrity.integrity_check === 'ok', integrity);
  } catch (e) {
    console.error(e);
    check('soak ran to completion', false, String(e).slice(0, 400));
  } finally {
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length }, scope: 'Editing-session soak over REST with a fixed pseudo-random script. Does not cover playback, export or the browser; one run.', measurements, passed: checks.length - failed.length, total: checks.length, checks };
    fs.writeFileSync(path.join(root, 'docs/evidence/soak.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nSoak ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
