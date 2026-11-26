/**
 * Autonomy Part 1 proof (`pnpm build && pnpm proof:autonomy`; ADR draft .artifacts/wave8/autonomy-adr-draft.md).
 * With the server in OPEN mode, an outside agent holding a key the owner made in Settings › Access (a grant token, the way a
 * real agent gets one) does a whole job by itself: makes a project, imports a synthetic clip, edits, reads the full document
 * (a birth date it wrote), looks at a frame, exports and waits for the file, saves a full-size still, downloads nothing it
 * was not asked to and never creates an approval or a proposal. Then the owner switches the SAME server to GUARDED and the
 * same calls answer as they do today. The floor holds in both: no grant minted by an agent, no mode switch by an agent, a
 * foreign Host or Origin refused, no path accepted where an asset id is expected, and the source walk of the floor sites.
 * The "agent" is a deterministic script over the official MCP client and REST, not a language model.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { FLOOR_SITES } from '@pulseframe/server/autonomy.ts';
import * as T from '@pulseframe/time';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/autonomy');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4') });
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data'), mode: 'open', modeFromEnv: true, backupDir: null, libraryDir: null });
  const PORT = Number(new URL(s.url).port);
  const origin = s.url;
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const owner = { cookie, origin };
  const rest = async (p: string, body?: unknown, cred: Record<string, string> = owner, method?: string) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...cred, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const buf = Buffer.from(await r.arrayBuffer());
    let json: any = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* bytes */ }
    return { status: r.status, body: json, bytes: buf, code: json?.error?.code as string | undefined };
  };
  const hostRefused = () => new Promise<number>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/v1/projects', headers: { host: `evil.example:${PORT}`, authorization: `Bearer ${agentToken}` } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject); req.end();
  });
  let agentToken = '';
  try {
    // ---- the key, as the owner makes it in Settings › Access (the default mode of the form is the owner's choice; here edit)
    const made = await rest('/grants', { name: 'outside-agent', mode: 'edit' });
    agentToken = made.body.token;
    check('the owner made an agent key in Access (a pfg_ grant token, shown once)', made.status === 201 && /^pfg_/.test(agentToken));
    const agent = { authorization: `Bearer ${agentToken}` };
    const mcp = new Client({ name: 'autonomy-proof', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: agent } }));
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await mcp.callTool({ name, arguments: args });
      const text = (r.content as any[]).find((x) => x.type === 'text')?.text;
      let data: any; try { data = text ? JSON.parse(text) : undefined; } catch { data = { error: { code: 'text', message: text } }; }
      return { isError: !!r.isError, data, code: data?.error?.code as string | undefined, images: (r.content as any[]).filter((x) => x.type === 'image') };
    };
    const waitJob = async (jobId: string) => { const t0 = Date.now(); for (;;) { const j = (await call('get_job', { jobId })).data; if (['succeeded', 'failed', 'canceled'].includes(j?.status) || Date.now() - t0 > 5 * 60_000) return j; await sleep(250); } };

    // ================= OPEN =================
    console.log('\n# open mode: the agent does the whole job by itself');
    const mode0 = await rest('/autonomy', undefined, agent);
    check('GET /autonomy tells the agent: open, in Hebrew and English', mode0.body?.mode === 'open' && mode0.body?.words?.he?.name === 'מצב פתוח', { mode: mode0.body?.mode, he: mode0.body?.words?.he?.line });
    const pr = await rest('/projects', { name: 'autonomy', width: 640, height: 360 }, agent);
    const pid = pr.body?.project?.id as string;
    const up = await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...agent, 'x-filename': 'fixture.mp4', connection: 'close' }, body: fs.readFileSync(fixture.file) });
    const upBody: any = await up.json();
    let assetId: string | undefined = upBody.assetId;
    if (!assetId && upBody.jobId) { const j = await waitJob(upBody.jobId); assetId = j?.output?.assetId; }
    check('the agent made a project and imported a synthetic clip (REST upload, its own credential)', pr.status === 201 && !!assetId, { status: up.status, assetId });
    const ed = await call('apply_transaction', { projectId: pid, label: 'agent cut', ops: [{ op: 'add_clip', args: { assetId, start: T.frameTime(0, R) } }, { op: 'add_person', args: { name: 'Noa', birthDate: '2019-03-04' } }] });
    check('the agent edits (add_clip) and writes a person with a birth date, as registered ops through Store.commit', !ed.isError, ed.isError ? ed.data : { revision: ed.data?.revision });
    const full = await rest(`/projects/${pid}`, undefined, agent);
    check('the agent reads the full document (the birth date is there)', JSON.stringify(full.body).includes('2019-03-04'));
    const fr = await call('render_frame', { projectId: pid, frameIndex: 10 });
    check('the agent looks at a frame (render_frame, the export compositor)', !fr.isError && fr.images.length === 1 && fr.images[0].data.length > 1000, { bytesB64: fr.images[0]?.data?.length });
    const ex = await call('export_project', { projectId: pid, range: { startFrame: 0, endFrame: 30 }, quality: 'standard' });
    const exJob = ex.isError ? ex.data : await waitJob(ex.data.jobId);
    const file = !ex.isError ? await rest(`/jobs/${ex.data.jobId}/output`, undefined, agent) : null;
    check('the agent starts an export and waits for it; the file is there', !ex.isError && exJob?.status === 'succeeded' && (file?.bytes.length ?? 0) > 1000, { status: exJob?.status ?? exJob, bytes: file?.bytes.length });
    const st = await call('export_project', { projectId: pid, format: 'png', still: { assetId, sourceFrame: 0 } });
    const stJob = st.isError ? st.data : await waitJob(st.data.jobId);
    check('the agent saves a full-size still (was owner-only, A12)', !st.isError && stJob?.status === 'succeeded', { status: stJob?.status ?? stJob });
    const ver = await call('save_version', { projectId: pid, name: 'agent' });
    const ren = !ver.isError ? await call('rename_version', { projectId: pid, versionId: ver.data.version.id, name: 'agent, renamed' }) : ver;
    check('the agent saves and renames a version over MCP (rename was owner-only, A14)', !ren.isError, ren.isError ? ren.data : undefined);
    const approvals = await rest(`/projects/${pid}/approvals`);
    const proposals = await rest(`/projects/${pid}/proposals`);
    check('nothing asked the owner: no approval and no proposal was created', approvals.body?.approvals?.length === 0 && proposals.body?.proposals?.length === 0, { approvals: approvals.body?.approvals?.length, proposals: proposals.body?.proposals?.length });

    // ---- the floor, open
    console.log('\n# the floor, open mode');
    const floor = async (label: string) => {
      const g = await rest('/grants', { name: 'self', mode: 'autopilot' }, agent);
      const m = await rest('/autonomy', { mode: 'guarded' }, agent, 'PUT');
      const foreign = await fetch(`${origin}/api/v1/grants`, { headers: { cookie, origin: 'https://evil.example', connection: 'close' } });
      const host = await hostRefused();
      const pathRun = await call('run_capability', { projectId: pid, capabilityId: 'image.upscale', params: {}, source: { path: '/etc/passwd' } });
      const idRun = await call('run_capability', { projectId: pid, capabilityId: 'image.upscale', params: {}, source: { assetId: '../../tokens.json' } });
      check(`${label}: an agent cannot mint itself a key (403 owner_required)`, g.status === 403 && g.code === 'owner_required');
      check(`${label}: an agent cannot switch the mode (403 owner_required)`, m.status === 403 && m.code === 'owner_required');
      check(`${label}: the owner's cookie from a foreign Origin is refused (403)`, foreign.status === 403, { status: foreign.status });
      check(`${label}: a foreign Host is refused (403), even with the agent key`, host === 403, { status: host });
      check(`${label}: a path where an asset id goes is refused before anything runs`, pathRun.isError && idRun.isError, { path: pathRun.code, id: idRun.code });
    };
    await floor('open');

    // ================= GUARDED =================
    console.log('\n# the owner switches the same server to guarded');
    const sw = await rest('/autonomy', { mode: 'guarded' }, owner, 'PUT');
    check('the owner switched to guarded (stored); GET /autonomy says so', sw.status === 200 && (await rest('/autonomy', undefined, agent)).body?.mode === 'guarded');
    // the MCP client reconnects (its listen stream was closed by the switch); a fresh session is judged guarded
    await mcp.close().catch(() => {});
    const mcp2 = new Client({ name: 'autonomy-proof', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await mcp2.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: agent } }));
    const call2 = async (name: string, args: Record<string, unknown>) => { const r = await mcp2.callTool({ name, arguments: args }); const text = (r.content as any[]).find((x) => x.type === 'text')?.text; let data: any; try { data = JSON.parse(text); } catch { data = {}; } return { isError: !!r.isError, code: data?.error?.code as string | undefined, data }; };
    const read2 = await rest(`/projects/${pid}`, undefined, agent);
    check('guarded: the same read gives names only (no birth date), as today', read2.status === 200 && !JSON.stringify(read2.body).includes('2019-03-04') && JSON.stringify(read2.body).includes('Noa'));
    const write2 = await call2('apply_transaction', { projectId: pid, ops: [{ op: 'add_person', args: { name: 'Dan', birthDate: '2021-05-06' } }] });
    check('guarded: writing a birth date is refused, as today', write2.isError, { code: write2.code });
    const still2 = await call2('export_project', { projectId: pid, format: 'png', still: { assetId, sourceFrame: 0 } });
    check('guarded: the full-size still is refused (owner_required), as today', still2.isError && still2.code === 'owner_required', { code: still2.code });
    const ren2 = await call2('rename_version', { projectId: pid, versionId: ver.data?.version?.id ?? 'x', name: 'again' });
    check('guarded: renaming a version is refused (owner_required), as today', ren2.isError && ren2.code === 'owner_required', { code: ren2.code });
    const dl2 = await call2('start_model_download', { projectId: pid, kind: 'capability', id: 'image.upscale', confirmBytes: 1 });
    check('guarded: starting a model download is refused (human_approval_required), as today', dl2.isError && dl2.code === 'human_approval_required', { code: dl2.code });
    const ex2 = await call2('export_project', { projectId: pid, range: { startFrame: 0, endFrame: 15 }, quality: 'standard' });
    check('guarded: an ordinary export still starts, as today (the people refusal applies only to titles that show an age)', !ex2.isError, ex2.isError ? ex2.data : undefined);
    await mcp2.close().catch(() => {});
    console.log('\n# the floor, guarded mode');
    const mcpF = new Client({ name: 'autonomy-proof', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await mcpF.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: agent } }));
    const gG = await rest('/grants', { name: 'self2', mode: 'autopilot' }, agent);
    const mG = await rest('/autonomy', { mode: 'open' }, agent, 'PUT');
    const hostG = await hostRefused();
    const foreignG = await fetch(`${origin}/api/v1/grants`, { headers: { cookie, origin: 'https://evil.example', connection: 'close' } });
    const pathG = await mcpF.callTool({ name: 'run_capability', arguments: { projectId: pid, capabilityId: 'image.upscale', params: {}, source: { path: '/etc/passwd' } } });
    check('guarded: an agent cannot mint a key or switch the mode (403 owner_required)', gG.code === 'owner_required' && mG.code === 'owner_required');
    check('guarded: a foreign Host and a foreign Origin are refused (403)', hostG === 403 && foreignG.status === 403);
    check('guarded: a path where an asset id goes is refused', !!pathG.isError);
    await mcpF.close().catch(() => {});

    // ---- the source walk (C1): every floor site reads isOwnerFloor, none reads the policy predicate
    const src = path.join(root, 'apps/server/src');
    const bad = FLOOR_SITES.filter((f) => { const line = fs.readFileSync(path.join(src, f.file), 'utf8').split('\n').find((l) => l.includes(f.needle)); return !line || !line.includes('isOwnerFloor(') || /actsAsOwner|ownerKeeps/.test(line); });
    check(`source walk: the ${FLOOR_SITES.length} floor sites read isOwnerFloor and never actsAsOwner`, bad.length === 0, bad.length ? bad : undefined);
  } finally {
    await s.close();
    const failed = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    fs.writeFileSync(path.join(art, 'result.json'), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
