/**
 * Phase 5 gate (SPEC Appendix D): ten scripted editing goals through MCP/REST, UI parity for
 * human control, and authorization boundaries verified server-side.
 * The "agent" here is a deterministic script using the official MCP client, not a language model.
 *   pnpm build && pnpm proof:phase5
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phase5');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4') });
  const s = await startServer({ port: 8792, dataDir: path.join(art, 'data') });
  const origin = s.url;
  // The owner's own session (as the editor obtains it) and a REST helper for any credential.
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const owner = { cookie, origin };
  const rest = async (p: string, body?: unknown, cred: Record<string, string> = owner, method?: string) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...cred, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const mcpFor = async (token: string) => {
    const c = new Client({ name: 'phase5-script', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: bearer(token) } }));
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await c.callTool({ name, arguments: args });
      const text = (r.content as any[]).find((x) => x.type === 'text')?.text;
      return { isError: !!r.isError, data: text ? JSON.parse(text) : undefined, images: (r.content as any[]).filter((x) => x.type === 'image') };
    };
    return { c, call };
  };
  const pngPixels = (b64: string, w: number, h: number) => { const file = path.join(art, 'tmp.png'); fs.writeFileSync(file, Buffer.from(b64, 'base64')); return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }); };
  try {
    const pid = (await rest('/projects', { name: 'phase5', width: 640, height: 360 })).body.project.id;
    const other = (await rest('/projects', { name: 'other', width: 640, height: 360 })).body.project.id;
    const up: any = await (await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...owner, 'x-filename': 'fixture.mp4', connection: 'close' }, body: fs.readFileSync(fixture.file) })).json();
    const assetId = up.assetId;
    const grant = async (input: Record<string, unknown>) => (await rest('/grants', input)).body as { grant: any; token: string };
    const editor = await grant({ name: 'editor', mode: 'edit' });
    const A = await mcpFor(editor.token);
    const doc = async () => (await rest(`/projects/${pid}`)).body as { project: ProjectDocument; revision: number };
    const video = async () => (await doc()).project.sequences.seq_main!.tracks.find((t) => t.kind === 'video')!.clips;
    const moment = async (frame: number) => (await A.call('describe_moment', { projectId: pid, frameIndex: frame })).data;
    const srcAt = async (frame: number) => (await moment(frame)).layers.find((l: any) => l.kind === 'video')?.sourceFrameIndex;

    console.log('\n# ten scripted editing goals through MCP');
    const tools = (await A.c.listTools()).tools.map((t) => t.name);
    check('discovery: editing, senses, proposals, jobs and control tools are all listed from one registry', ['apply_transaction', 'set_keyframe', 'describe_moment', 'render_contact_sheet', 'render_frame', 'propose_transaction', 'list_proposals', 'export_project', 'plan_export', 'get_job', 'cancel_job', 'retry_job', 'undo', 'redo', 'get_controls', 'set_view', 'describe_ops'].every((t) => tools.includes(t)), { tools: tools.length });

    // 1. Rough cut: the source twice, back to back.
    const g1 = await A.call('apply_transaction', { projectId: pid, label: 'Rough cut', ops: [{ op: 'add_clip', args: { assetId, start: f(0) } }, { op: 'add_clip', args: { assetId, start: f(120) } }] });
    check('goal 1 — rough cut of two clips in one transaction; describe_moment confirms the source frame at the join', !g1.isError && (await srcAt(119)) === 119 && (await srcAt(120)) === 0, { revision: g1.data.revision });
    // 2. Tighten: trim 15 frames off the first clip and close the gap.
    let [c1, c2] = await video();
    const g2 = await A.call('apply_transaction', { projectId: pid, label: 'Tighten', ops: [{ op: 'trim_clip', args: { clipId: c1!.id, edge: 'end', to: f(105) } }, { op: 'move_clip', args: { clipId: c2!.id, start: f(105) } }] });
    const audio = (await doc()).project.sequences.seq_main!.tracks.find((t) => t.kind === 'audio')!.clips;
    check('goal 2 — tighten: trim and close the gap; linked audio follows; total is 225 frames', !g2.isError && (await srcAt(104)) === 104 && (await srcAt(105)) === 0 && audio.every((a, i) => T.eq(a.start, (i === 0 ? f(0) : f(105)))) && (await A.call('get_summary', { projectId: pid })).data.frameCount === 225);
    // 3. Hebrew title that fades in.
    const g3 = await A.call('add_text', { projectId: pid, text: 'פתיחה', start: f(0), duration: f(60), style: { sizeFrac: 0.16 }, transform: { y: 0.25 } });
    const titleId = g3.data.results[0].output.clipId;
    await A.call('apply_transaction', { projectId: pid, label: 'Fade in', ops: [{ op: 'set_keyframe', args: { clipId: titleId, property: 'opacity', time: f(0), value: 0 } }, { op: 'set_keyframe', args: { clipId: titleId, property: 'opacity', time: f(12), value: 1, easing: 'ease-out' } }] });
    const sheet = await A.call('render_contact_sheet', { projectId: pid, frames: [0, 6, 12] });
    // Brightness of the title area (lower middle) must rise across the fade: measured from the returned stills.
    // Mean of the darkest channel in the title area: rises as white text fades in over the coloured picture (the fade is linear: 0, 50%, 100%).
    const lum = sheet.images.map((im) => { const px = pngPixels(im.data, 160, 90); let sum = 0; let n = 0; for (let y = 52; y < 80; y++) for (let x = 40; x < 120; x++) { const o = (y * 160 + x) * 3; sum += Math.min(px[o]!, px[o + 1]!, px[o + 2]!); n++; } return sum / n; });
    check('goal 3 — Hebrew title with a keyframed fade-in, verified from the contact-sheet stills (title area brightens 0 → 6 → 12)', sheet.images.length === 3 && lum[1]! > lum[0]! + 1 && lum[2]! > lum[1]! + 1, { meanDarkestChannel: lum.map((v) => +v.toFixed(1)) });
    // 4. Reorder: swap the two clips.
    [c1, c2] = await video();
    const g4 = await A.call('apply_transaction', { projectId: pid, label: 'Swap clips', ops: [{ op: 'move_clip', args: { clipId: c1!.id, start: f(300) } }, { op: 'move_clip', args: { clipId: c2!.id, start: f(0) } }, { op: 'move_clip', args: { clipId: c1!.id, start: f(120) } }] });
    check('goal 4 — reorder: clips swapped atomically (second clip now first, full 120 frames then the trimmed 105)', !g4.isError && (await srcAt(0)) === 0 && (await srcAt(119)) === 119 && (await srcAt(120)) === 0 && (await srcAt(224)) === 104);
    // 5. Cut out one second from the middle of the first clip and close up.
    const first = (await video())[0]!;
    const sp1 = await A.call('split_clip', { projectId: pid, clipId: first.id, at: f(45) });
    const midId = sp1.data.results[0].output.rightClipId;
    const sp2 = await A.call('split_clip', { projectId: pid, clipId: midId, at: f(75) });
    const tailId = sp2.data.results[0].output.rightClipId;
    const lastId = (await video()).at(-1)!.id;
    const g5 = await A.call('apply_transaction', { projectId: pid, label: 'Remove one second', ops: [{ op: 'delete_clip', args: { clipId: midId } }, { op: 'move_clip', args: { clipId: tailId, start: f(45) } }, { op: 'move_clip', args: { clipId: lastId, start: f(90) } }] });
    check('goal 5 — remove frames 45..74 and close the gaps: source jumps 44 → 75 at the cut and the tail follows', !g5.isError && (await srcAt(44)) === 44 && (await srcAt(45)) === 75 && (await srcAt(89)) === 119 && (await srcAt(90)) === 0 && (await A.call('get_summary', { projectId: pid })).data.frameCount === 195);
    // 6. Inspect and correct: the title sits low; look at a real frame, move it, look again.
    const before6 = await A.call('render_frame', { projectId: pid, frameIndex: 20 });
    await A.call('set_clip_transform', { projectId: pid, clipId: titleId, transform: { y: -0.25 } });
    const after6 = await A.call('render_frame', { projectId: pid, frameIndex: 20 });
    const whiteRows = (im: any) => { const px = pngPixels(im.data, 160, 90); const top = [0, 0]; for (let y = 0; y < 90; y++) for (let x = 30; x < 130; x++) { const o = (y * 160 + x) * 3; if (px[o]! > 230 && px[o + 1]! > 230 && px[o + 2]! > 230) top[y < 45 ? 0 : 1]!++; } return top; };
    const wb = whiteRows(before6.images[0]);
    const wa = whiteRows(after6.images[0]);
    check('goal 6 — inspect, correct, re-inspect: rendered frames show the title moved from the lower half to the upper half', wb[1]! > wb[0]! && wa[0]! > wa[1]! && after6.data.revision === before6.data.revision + 1, { before: wb, after: wa });
    // 7. A propose-mode agent suggests an alternative opening; the owner reviews and accepts in the editor.
    const proposer = await grant({ name: 'ideas', mode: 'propose' });
    const P = await mcpFor(proposer.token);
    const revBefore = (await doc()).revision;
    const pr = await P.call('update_text', { projectId: pid, clipId: titleId, text: 'פתיחה חלופית', label: 'Alternative opening' });
    check('goal 7a — Propose mode: an ordinary editing tool returns a proposal and commits nothing', !pr.isError && pr.data.proposed === true && pr.data.committed === false && (await doc()).revision === revBefore, pr.data);
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.locator(`[data-proposal-id="${pr.data.proposalId}"]`).waitFor();
    // The before/after stills load lazily, so bring the proposal into view first (the Inspector has grown since this proof was written).
    await page.locator(`[data-proposal-id="${pr.data.proposalId}"]`).scrollIntoViewIfNeeded();
    const imgs = await page.locator(`[data-proposal-id="${pr.data.proposalId}"] img`).evaluateAll((els) => Promise.all(els.map(async (el) => { const i = el as HTMLImageElement; if (!i.complete) await new Promise((r) => { i.onload = r; i.onerror = r; }); return i.naturalWidth; })));
    await page.screenshot({ path: path.join(root, 'docs/evidence/phase5-proposal-review-he.png') });
    await page.getByTestId('proposal-accept').click();
    await page.waitForFunction((r) => Number(document.querySelector('[data-testid=revision]')?.textContent?.replace(/\D+/g, '')) > r, revBefore);
    const accepted = (await rest(`/projects/${pid}/proposals/${pr.data.proposalId}`)).body.proposal;
    const hist = (await rest(`/projects/${pid}/history?since=${revBefore}`)).body.events;
    check('goal 7b — the owner sees the proposal with before/after stills in the editor and accepts it; it is committed under the owner', imgs.length === 2 && imgs.every((w) => w > 0) && accepted.status === 'accepted' && hist[0].actor === 'user:local' && ((await doc()).project.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips[0] as any).text === 'פתיחה חלופית');
    await page.keyboard.press('Control+KeyZ');
    await page.waitForFunction((r) => Number(document.querySelector('[data-testid=revision]')?.textContent?.replace(/\D+/g, '')) > r, revBefore + 1);
    check('goal 7c — the owner undoes the accepted proposal with Ctrl+Z; independent agent edits remain', ((await doc()).project.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips[0] as any).text === 'פתיחה' && (await srcAt(45)) === 75);
    // 8. Export a range and verify it.
    const ex = await A.call('export_project', { projectId: pid, range: { startFrame: 30, endFrame: 60 }, quality: 'standard' });
    let job: any;
    for (;;) { job = (await A.call('get_job', { jobId: ex.data.jobId })).data; if (['succeeded', 'failed'].includes(job.status)) break; await sleep(200); }
    const mp4 = path.join(art, 'range.mp4');
    fs.writeFileSync(mp4, (await rest(`/jobs/${ex.data.jobId}/output`)).body);
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
    const codes = Array.from({ length: 30 }, (_, k) => readBarcode(raw.subarray(k * 691200, (k + 1) * 691200), 640, 3, { x: 0, y: 0, w: 640, h: 360 }));
    check('goal 8 — export frames [30,60) through MCP; the file shows source frames 30..44 then 75..89 (the cut is inside the range)', job.status === 'succeeded' && codes.slice(0, 15).every((c, k) => c === 30 + k) && codes.slice(15).every((c, k) => c === 75 + k), { first: codes[0], atCut: [codes[14], codes[15]], last: codes[29] });
    // 9. The agent undoes its own last edit; the owner's work is untouched.
    await rest(`/projects/${pid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'של הבעלים', start: f(100), duration: f(30) } }] });
    const moved = await A.call('set_clip_transform', { projectId: pid, clipId: titleId, transform: { x: 0.2 } });
    const un = await A.call('undo', { projectId: pid });
    const texts = (await doc()).project.sequences.seq_main!.tracks.filter((t) => t.kind === 'text').flatMap((t) => t.clips) as any[];
    check('goal 9 — agent undo reverses only its own last edit; the owner\'s later clip is kept', !moved.isError && !un.isError && un.data.kind === 'undo' && texts.find((c) => c.id === titleId).transform.x === 0 && texts.some((c) => c.text === 'של הבעלים'));
    // 10. A captions-only agent: limited to the text track and to this project.
    const scoped = await grant({ name: 'captions', mode: 'edit', projectIds: [pid], trackIds: ['trk_text'] });
    const S = await mcpFor(scoped.token);
    const okText = await S.call('update_text', { projectId: pid, clipId: titleId, text: 'כתובית' });
    const noVideo = await S.call('delete_clip', { projectId: pid, clipId: (await video())[0]!.id });
    const noMix = await S.call('apply_transaction', { projectId: pid, ops: [{ op: 'update_text', args: { clipId: titleId, text: 'x' } }, { op: 'rename_project', args: { name: 'hijacked' } }] });
    const noOther = await S.call('get_timeline', { projectId: other });
    const ctrl = await S.call('get_controls', { projectId: pid });
    check('goal 10 — scoped agent: may edit the text track; video, mixed transactions and other projects are refused with typed errors, and nothing partial is applied', !okText.isError && noVideo.isError && noVideo.data.error.code === 'out_of_scope' && noMix.isError && noMix.data.error.code === 'out_of_scope' && noOther.isError && noOther.data.error.code === 'out_of_scope' && (await doc()).project.name === 'phase5' && ctrl.data.limits.trackIds[0] === 'trk_text', noVideo.data.error.details?.violations?.[0]);

    console.log('\n# findings of the independent security review (each was reproducible before the fix)');
    {
      const noKey = await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close' } });
      const withAgent = await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', ...bearer(editor.token) } });
      check('an agent (or any local program) cannot mint an owner session: without the launch secret the session route answers 401 and sets no cookie', noKey.status === 401 && withAgent.status === 401 && !noKey.headers.get('set-cookie') && !withAgent.headers.get('set-cookie'), { noKey: noKey.status, agent: withAgent.status });
      const up2 = await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...bearer(scoped.token), 'x-filename': 'x.mp4', connection: 'close' }, body: fs.readFileSync(fixture.file) });
      const an2 = await rest(`/projects/${pid}/assets/${assetId}/analyze`, { kind: 'scenes' }, bearer(scoped.token));
      const sfx2 = await rest(`/projects/${pid}/sfx`, { sfxId: 'sfx.click' }, bearer(scoped.token));
      check('a grant limited to certain tracks cannot change things outside clips through side doors: upload, analysis data and sound-effect import are refused as out of scope', up2.status === 403 && an2.status === 403 && sfx2.status === 403 && an2.body.error.code === 'out_of_scope', { upload: up2.status, analyze: an2.body.error?.code, sfx: sfx2.status });
      const ownerTx = await rest(`/projects/${pid}/transactions`, { ops: [{ op: 'rename_project', args: { name: 'phase5 renamed by owner' } }] });
      const hist = (await rest(`/projects/${pid}/history?since=0`)).body.events as any[];
      const ownerTxId = hist.find((e) => e.revision === ownerTx.body.revision)?.transactionId;
      const agentUndo = await A.call('undo', { projectId: pid, transactionId: ownerTxId });
      const stillRenamed = (await doc()).project.name === 'phase5 renamed by owner';
      const ownerUndo = await rest(`/projects/${pid}/undo`, { transactionId: ownerTxId });
      check('an agent cannot reverse the owner\'s transaction by naming its id; the owner can', !!ownerTxId && agentUndo.isError && stillRenamed && ownerUndo.status === 200 && (await doc()).project.name !== 'phase5 renamed by owner', { agent: agentUndo.data?.error?.code });
      const limited = await grant({ name: 'one-project', mode: 'edit', projectIds: [pid] });
      const L = await mcpFor(limited.token);
      const view = await L.call('set_view', { projectId: other, frame: 3 });
      const ctl = await L.call('get_controls', { projectId: other });
      check('a grant limited to one project cannot show presence in, or read controls of, another project through MCP', view.isError && ctl.isError, { set_view: view.data?.error?.code, get_controls: ctl.data?.error?.code });
      await L.c.close();
      const ownerJob = (await rest(`/projects/${pid}/exports`, { quality: 'draft', scale: 0.25 })).body.jobId;
      const cancelByAgent = await A.call('cancel_job', { jobId: ownerJob });
      const cancelByOwner = await rest(`/jobs/${ownerJob}/cancel`, {});
      check('an agent cannot cancel a job the owner started; the owner can cancel it', cancelByAgent.isError && cancelByAgent.data?.error?.code === 'not_your_job' && cancelByOwner.status === 200, { agent: cancelByAgent.data?.error?.code });
      const playlist = Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4.0,\n/etc/hostname\n#EXT-X-ENDLIST\n');
      const pl = await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...owner, 'x-filename': 'list.m3u8', connection: 'close' }, body: playlist });
      check('a playlist file (which could point at other files or URLs) is not accepted as media', pl.status === 415, { status: pl.status });
    }

    console.log('\n# human control and authorization boundaries');
    // Pause Agent from the editor.
    await page.getByTestId('pause-agent').click();
    await page.getByTestId('agents-paused').waitFor();
    const revP = (await doc()).revision;
    const blocked = await A.call('set_clip_transform', { projectId: pid, clipId: titleId, transform: { x: 0.1 } });
    const blockedJob = await A.call('export_project', { projectId: pid });
    const blockedProposal = await P.call('update_text', { projectId: pid, clipId: titleId, text: 'while paused' });
    const stillReads = await A.call('get_timeline', { projectId: pid });
    const ownerEdit = await rest(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_transform', args: { clipId: titleId, transform: { x: 0.05 } } }] });
    check('Pause Agent (clicked in the editor): agent edits, jobs and proposals are refused server-side with agent_paused; reading and the owner\'s own edits continue', blocked.isError && blocked.data.error.code === 'agent_paused' && blockedJob.isError && blockedJob.data.error.code === 'agent_paused' && blockedProposal.isError && blockedProposal.data.error.code === 'agent_paused' && !stillReads.isError && ownerEdit.body.committed === true && (await doc()).revision === revP + 1 && (await A.call('get_summary', { projectId: pid })).data.agentsPaused === true);
    const pausedRetry = await rest(`/jobs/${ex.data.jobId}/retry`, {}, bearer(editor.token));
    const pausedBrowser = await rest(`/projects/${pid}/exports/browser`, { sessionId: 's1' }, bearer(editor.token));
    const pausedAsk = await rest(`/projects/${pid}/capabilities/comfy.image.remove-background/models/request`, {}, bearer(editor.token));
    check('while paused, every job-starting or requesting route refuses agents too (retry, browser export, model request)', [pausedRetry, pausedBrowser, pausedAsk].every((r) => r.status === 423 && r.body.error.code === 'agent_paused'), [pausedRetry.status, pausedBrowser.status, pausedAsk.status]);
    check('an agent cannot resume itself, create grants, or decide proposals and approvals', (await rest(`/projects/${pid}/agents/resume`, {}, bearer(editor.token))).status === 403 && (await rest('/grants', { name: 'x', mode: 'autopilot' }, bearer(editor.token))).status === 403 && (await rest('/grants', undefined, bearer(editor.token))).status === 403);
    await page.getByTestId('pause-agent').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=agents-paused]'));
    check('Resume is a deliberate owner action; afterwards the agent can edit again', !(await A.call('set_clip_transform', { projectId: pid, clipId: titleId, transform: { x: 0 } })).isError);
    // Stale proposal is not applied over newer work.
    const stale = await P.call('update_text', { projectId: pid, clipId: titleId, text: 'נוסח הסוכן' });
    await rest(`/projects/${pid}/transactions`, { ops: [{ op: 'update_text', args: { clipId: titleId, text: 'נוסח הבעלים' } }] });
    const acc = await rest(`/projects/${pid}/proposals/${stale.data.proposalId}/accept`, {});
    check('a proposal written against older text goes stale instead of overwriting the owner\'s newer wording', acc.status === 409 && acc.body.error.code === 'proposal_stale' && ((await doc()).project.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips.find((c) => c.id === titleId) as any).text === 'נוסח הבעלים' && (await rest(`/projects/${pid}/proposals/${stale.data.proposalId}`)).body.proposal.status === 'stale');
    const agentAccept = await rest(`/projects/${pid}/proposals/${stale.data.proposalId}/accept`, {}, bearer(editor.token));
    check('agents cannot accept proposals (their own or anyone\'s)', agentAccept.status === 403 && agentAccept.body.error.code === 'owner_required');
    // Approvals: an agent may ask; only the owner decides; the request is bound to the exact bytes.
    const ask = await rest(`/projects/${pid}/capabilities/comfy.image.remove-background/models/request`, {}, bearer(editor.token));
    const selfApprove = await rest(`/projects/${pid}/approvals/${ask.body.approval?.id}/approve`, {}, bearer(editor.token));
    const rejected = await rest(`/projects/${pid}/approvals/${ask.body.approval?.id}/reject`, {});
    const reApprove = await rest(`/projects/${pid}/approvals/${ask.body.approval?.id}/approve`, {});
    const direct = await rest(`/projects/${pid}/capabilities/comfy.image.remove-background/models/download`, { confirmBytes: 444473596 }, bearer(editor.token));
    check('approvals: an agent can request a model download but cannot approve it or start it; a rejected request cannot be reused', ask.status === 201 && ask.body.approval.status === 'pending' && ask.body.approval.action.bytes === 444473596 && selfApprove.status === 403 && rejected.body.approval.status === 'rejected' && reApprove.status === 409 && direct.status === 403, { action: ask.body.approval?.action?.bytes });
    // Project-limited grants and jobs addressed by id.
    const upOther: any = await (await fetch(`${origin}/api/v1/projects/${other}/assets`, { method: 'POST', headers: { ...owner, 'x-filename': 'fixture.mp4', connection: 'close' }, body: fs.readFileSync(fixture.file) })).json();
    await rest(`/projects/${other}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: upOther.assetId, start: f(0) } }] });
    const otherJob = (await rest(`/projects/${other}/exports`, { format: 'wav' })).body;
    const sj = await rest(`/jobs/${ex.data.jobId}`, undefined, bearer(scoped.token));
    const oj = await rest(`/jobs/${otherJob.jobId ?? 'none'}`, undefined, bearer(scoped.token));
    const listScoped = await rest('/projects', undefined, bearer(scoped.token));
    const createScoped = await rest('/projects', { name: 'new' }, bearer(scoped.token));
    const mcpList = await S.call('list_projects', {});
    check('a project-limited grant sees only its project (REST and MCP lists), cannot create projects, and cannot read another project\'s job by id', sj.status === 200 && !!otherJob.jobId && oj.status === 403 && oj.body.error.code === 'out_of_scope' && listScoped.body.projects.length === 1 && listScoped.body.projects[0].id === pid && createScoped.status === 403 && mcpList.data.projects.length === 1, { otherJobStatus: oj.status });
    // Revocation.
    await rest(`/grants/${scoped.grant.id}/revoke`, {});
    const revoked = await fetch(`${origin}/api/v1/projects/${pid}/timeline`, { headers: { ...bearer(scoped.token), connection: 'close' } });
    check('a revoked grant stops working immediately (401 grant_revoked)', revoked.status === 401 && (await revoked.json()).error.code === 'grant_revoked');
    const listed = (await rest('/grants')).body.grants;
    check('grant tokens are never returned again after creation', listed.length === 4 && !JSON.stringify(listed).includes(editor.token.slice(4)) && listed.every((g: any) => !('token' in g)));
    check('no uncaught errors in the editor page', pageErrors.length === 0, pageErrors.slice(0, 3));
    await browser.close();
    await Promise.all([A.c.close(), P.c.close(), S.c.close()]);
  } catch (e) {
    // A crash must never look like a pass: record it as a failed check so the report says FAILED.
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await s.close();
    const failed = checks.filter((c) => !c.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, agent: 'deterministic script over the official MCP client (protocol 2026-07-28); not a language model', notDone: ['MCP Tasks extension (jobs are polled by jobId)', 'MCP resources/prompts/playbooks', 'OAuth for remote MCP', 'third-party MCP hosts', 'paid-provider budget flow end to end (ledger is unit-tested; no paid provider exists)', 'range-limited grant in this proof (unit-tested)', 'transcript and audio-analysis senses', 'preview-clip sense'], checks };
    fs.writeFileSync(path.join(root, 'docs/evidence/phase5-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${report.result}: ${checks.length - failed.length}/${checks.length} checks. Evidence: docs/evidence/phase5-proof.json`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
