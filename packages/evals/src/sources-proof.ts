/**
 * proof:sources — «מאגר» / «ייבוא מקישור» end to end (wave 8 sources, part A), against the real server (startServer, port 0) and the
 * LABELLED doubles of packages/evals/src/doubles/sources (`double: openverse`, `double: pixabay`, `double: wikimedia`,
 * `double: link-host`; 127.0.0.9 / 127.0.0.10, port 0; the address policy injected through SourcesDeps.test for the proof ONLY).
 * Nothing is claimed about the real services (their answers, fields and live limits are laptop rows S1–S7). Fixtures are synthetic,
 * made at proof time (ffmpeg colour PNGs and test-pattern MP4s, a sine-chord WAV song) and deleted at the end. Check 15 drives the
 * built editor in headless Chromium (needs `pnpm build`). The same harness as apps/server/src/sourcesContracts.test.ts.
 * Exit 0 only when every check passes; 1 on a failure; 2 when a check could not run here (blocked, with the reason).
 * Run through /home/user/PULSEFRAME/.artifacts/heavy. Evidence: docs/evidence/sources-proof.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '@pulseframe/time';
import { archiveLibraryPlan, collectCredits, SOURCE_TERMS, validateProject, type Asset, type ProjectDocument } from '@pulseframe/core';
import type { RunningServer } from '@pulseframe/server';
import { createSourcesRuntime } from '@pulseframe/server/sources/runtime.ts';
import { planArchive } from '@pulseframe/server/archive.ts';
import { exportLicence, libraryExportWarnings } from '@pulseframe/server/export.ts';
import { GOLD_DOCS } from '../../core/src/credits.golden.fixtures.ts';
import { DOUBLE_PRIVATE_HOST } from './doubles/sources/doubles.ts';
import { bootSources, client, CONTACT, filesContaining, freeSpace, makeFixtures, OV_BY, OV_NC, OV_ND, PX_KEY, sha, startDoubles, tmpFiles, until, type Doubles, type Fixtures } from './doubles/sources/harness.ts';
import { songWav } from './musicfit-proof.hosts.ts';

export const SOURCES_PROOF_CHECKS = [
  '1 Openverse search: rows carry licence id and name from the answer; the double saw exactly q, the filters and "User-Agent: PULSEFRAME-Studio", and no project or owner text',
  '1b Openverse anonymous: the remaining-searches number counts down from 5 an hour; before the double would answer 429 the answer says how many are left; a 429 maps to provider_rate_limited with retryAfterSeconds',
  '2 Pixabay without a key: provider_key_missing; with the key stored by the owner\'s session the double saw it; no answer, log line, job row or SSE event contains it; an agent storing a key gets 403 owner_required',
  '3 a second identical Pixabay search within 24 h is served from memory (the double counted one request); no query on disk (grep of the data directory)',
  '3b Wikimedia without a contact: provider_contact_missing; with one the double saw "PULSEFRAME-Studio (<contact>)"; Artist HTML is shown as text',
  '4 a preview handle streams the double\'s bytes with Range (206); an unknown handle is 404 preview_not_found; a URL in place of a handle is never fetched',
  '5 import of a CC BY item as an AGENT credential: one use_source_item commit and one add_clip at the playhead, both as that agent; provenance.source validates; sha256 = the original hash; the credit verbatim; fetchedAt set; undo removes it exactly',
  '6 the download breaks at 50%: the job resumes with Range + If-Range (the double saw bytes=n-); with a changed ETag, or a 200 to the Range, it restarts at 0; the final hash is equal',
  '7 server restart mid-download: recover continues the .part; after success, after cancel and after a failure no src_* .part, up_ file or .link sidecar is left',
  '8 limit 100 KB: a larger file with no Content-Length, and one whose Content-Length is above the limit, fail download_too_large naming the number, nothing stored; one whose Content-Length lies low is cut at the declared length by HTTP/1.1 and fails, nothing stored; a setting above the upload limit is capped at it',
  '9 links to 127.0.0.1, [::ffff:127.0.0.1], [::1], 169.254.169.254, 0.0.0.0, this machine\'s own interface address, a public link redirecting to loopback and the name localhost: link_address_refused; a home-network link (the double\'s private address) imports with link_private_network (a name answering a public AND a loopback address: apps/server connectors/fetch.test.ts, with an injected lookup)',
  '9b the DEFAULT address policy (nothing injected) refuses 127.0.0.1',
  '10 a link answering text/html: download_not_media; a Dropbox share link (dl=0) is fetched as dl=1 and its pageUrl keeps dl=0 out',
  '11 an NC item and an ND item: imported with warnings (no refusal); the export answers non_commercial_content and licence_no_derivatives naming the licences and quoting the ND deed sentence; the export succeeds; a shared archive leaves the NC and the Pixabay files out',
  '12 credits of the library-only golden documents are byte-identical to credits.golden.json; a project with only a CC BY source credit gets a credits card and an export reminder (C3)',
  '13 music fit of a CC BY-SA Openverse song: shortened with the share-alike warning quoting the deed; the copy carries the source record; its credit is listed with the shortened line (C4)',
  '14 the same idempotencyKey twice: one job, one download',
  '15 UI (headless Chromium): the «מאגר» tab reaches results, Space previews, Enter places at the playhead, the link box imports; Settings › «חיבורים» stores a key from the owner\'s session; RTL; the keyboard path without a mouse',
] as const;

type Outcome = true | string;
const results: { check: string; state: 'pass' | 'fail' | 'blocked'; detail?: string }[] = [];
const evidence: Record<string, unknown> = {};
const BLOCKED = (why: string) => `BLOCKED: ${why}`;

let root = '', ddir = '', fx: Fixtures, dbl: Doubles, s: RunningServer, rpid = '';
const c = client(() => s);
const docOf = (pid: string): ProjectDocument => s.store.wholeProject(pid).doc;
const assetOf = (pid: string, id: string): Asset => docOf(pid).assets[id]!;
const out = (j: { output: unknown }) => j.output as any;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const need = (ok: boolean, what: string, got?: unknown): void => { if (!ok) throw new Error(`${what}${got === undefined ? '' : `: ${JSON.stringify(got).slice(0, 400)}`}`); };
const ZERO = { value: '0', timescale: 1 };

const CHECKS: Record<string, () => Promise<Outcome>> = {
  '1': async () => {
    const r = await c.api('agent', 'GET', '/api/v1/sources/openverse/search?q=red%20cat&kind=photo');
    need(r.status === 200, 'status', r.body);
    const row = r.body.rows.find((x: any) => x.itemId === `image:${OV_BY}`);
    need(row?.licence?.id === 'CC-BY-4.0' && row.licence.name === 'CC BY 4.0' && row.licence.from === 'item', 'licence from the answer', row?.licence);
    const seen = dbl.ov.seen.at(-1)!;
    need(eq([seen.path, seen.query], ['/v1/images/', { q: 'red cat', page: '1', page_size: '20', category: 'photograph' }]), 'the double saw only q and the filters', [seen.path, seen.query]);
    need(seen.headers['user-agent'] === 'PULSEFRAME-Studio', 'User-Agent', seen.headers['user-agent']);
    need(!/Secret project|9z|user:local|agent:/.test(JSON.stringify(seen)), 'no project or owner text sent');
    evidence['1'] = { query: seen.query, userAgent: seen.headers['user-agent'], remaining: r.body.remaining };
    return true;
  },
  '1b': async () => {
    const left: number[] = [];
    for (const q of ['a', 'b', 'c', 'd']) left.push((await c.api('agent', 'GET', `/api/v1/sources/openverse/search?q=${q}`)).body.remaining.count);
    need(eq(left, [3, 2, 1, 0]), 'the remaining count after search 1 (4 left) counts down', left);
    const n = dbl.ov.seen.length;
    const r = await c.api('agent', 'GET', '/api/v1/sources/openverse/search?q=e');
    need(r.status === 429 && r.body.error.code === 'provider_rate_limited' && r.body.error.details.countedHere === true && r.body.error.details.retryAfterSeconds > 3000, 'the sixth search is refused here', r.body);
    need(dbl.ov.seen.length === n, 'nothing sent for the refused search');
    need((await c.api('owner', 'PUT', '/api/v1/sources/openverse/credentials', { clientId: dbl.ov.client.id, clientSecret: dbl.ov.client.secret })).body.mode === 'client', 'the owner connects a client');
    dbl.ov.limitAfter = 0;
    const t = await c.api('agent', 'GET', '/api/v1/sources/openverse/search?q=f');
    dbl.ov.limitAfter = null;
    need(t.status === 429 && t.body.error.code === 'provider_rate_limited' && t.body.error.details.retryAfterSeconds === 1800, 'the service\'s own 429 with its Retry-After', t.body);
    evidence['1b'] = { counted: left, refusedHere: r.body.error.details, serviceRetryAfter: t.body.error.details.retryAfterSeconds };
    return true;
  },
  '2': async () => {
    need((await c.api('agent', 'GET', '/api/v1/sources/pixabay/search?q=sunrise&kind=video')).body.error.code === 'provider_key_missing', 'no key: provider_key_missing');
    const ag = await c.api('agent', 'PUT', '/api/v1/sources/pixabay/credentials', { key: PX_KEY });
    need(ag.status === 403 && ag.body.error.code === 'owner_required', 'an agent storing a key', ag.body);
    const st = await c.api('owner', 'PUT', '/api/v1/sources/pixabay/credentials', { key: PX_KEY });
    need(st.body.state === 'ready' && !st.raw.toString().includes(PX_KEY), 'the owner stores it; the answer holds no key', st.body);
    const r = await c.api('agent', 'GET', '/api/v1/sources/pixabay/search?q=sunrise&kind=video');
    need(r.status === 200 && dbl.px.seen.at(-1)!.query.key === PX_KEY && !r.raw.toString().includes(PX_KEY), 'the double saw the key; the answer does not hold it');
    // an import job and its SSE events: listen to the project stream while a Pixabay video is imported
    const ac = new AbortController();
    const sse: string[] = [];
    void fetch(`${s.url}/api/v1/projects/${rpid}/events`, { headers: { authorization: `Bearer ${s.auth.tokens.agent}` }, signal: ac.signal }).then(async (res) => { for await (const ch of res.body as any) sse.push(Buffer.from(ch).toString()); }).catch(() => undefined);
    await new Promise((res) => setTimeout(res, 300));
    const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/import`, { provider: 'pixabay', itemId: 'video:4242' })).body.jobId);
    await new Promise((res) => setTimeout(res, 300));
    ac.abort();
    need(j.status === 'succeeded', 'the Pixabay import', j.error);
    const sseText = sse.join('');
    need(sseText.includes(j.id), 'the SSE stream carried the job', sseText.length);
    need(!sseText.includes(PX_KEY) && !JSON.stringify(j).includes(PX_KEY), 'no SSE event or job row holds the key');
    need(eq(filesContaining(ddir, PX_KEY), []), 'no file of the data folder (the key store excepted) holds the key', filesContaining(ddir, PX_KEY));
    evidence['2'] = { sseBytes: sseText.length, jobId: j.id, keyFoundIn: [] };
    return true;
  },
  '3': async () => {
    // a query word that no item carries (an imported item's own title may hold its tags; the query must never reach the disk)
    const first = await c.api('agent', 'GET', '/api/v1/sources/pixabay/search?q=sunrise%20quokka&kind=video');
    const n = dbl.px.seen.length;
    const a = await c.api('agent', 'GET', '/api/v1/sources/pixabay/search?q=sunrise%20quokka&kind=video');
    need(first.body.cached === false && a.body.cached === true && dbl.px.seen.length === n, 'answered from memory, no request', { cached: a.body.cached, requests: dbl.px.seen.length - n });
    need(eq(filesContaining(ddir, 'quokka'), []), 'no query word on disk', filesContaining(ddir, 'quokka'));
    evidence['3'] = { cached: true, requestsAdded: 0, rows: a.body.rows.length };
    return true;
  },
  '3b': async () => {
    const n = dbl.wm.seen.length;
    need((await c.api('agent', 'GET', '/api/v1/sources/wikimedia/search?q=green')).body.error.code === 'provider_contact_missing' && dbl.wm.seen.length === n, 'no contact: nothing sent');
    need((await c.api('owner', 'PUT', '/api/v1/sources/wikimedia/credentials', { contact: CONTACT })).body.state === 'ready', 'the owner types the contact line');
    const r = await c.api('agent', 'GET', '/api/v1/sources/wikimedia/search?q=green&kind=photo');
    need(r.body.rows[0]?.author === 'Ann', 'Artist HTML as text', r.body.rows[0]?.author);
    need(dbl.wm.seen.at(-1)!.headers['user-agent'] === `PULSEFRAME-Studio (${CONTACT})`, 'User-Agent with the contact', dbl.wm.seen.at(-1)!.headers['user-agent']);
    need(dbl.ov.seen.every((x) => !String(x.headers['user-agent']).includes(CONTACT)), 'the contact goes to Wikimedia only');
    evidence['3b'] = { userAgent: dbl.wm.seen.at(-1)!.headers['user-agent'], author: r.body.rows[0].author };
    return true;
  },
  '4': async () => {
    const row = (await c.api('agent', 'GET', '/api/v1/sources/openverse/search?q=red%20cat&kind=photo')).body.rows.find((x: any) => x.itemId === `image:${OV_BY}`);
    const h = await fetch(`${s.url}${row.preview}`, { headers: { authorization: `Bearer ${s.auth.tokens.observer}`, range: 'bytes=0-9' } });
    const bytes = Buffer.from(await h.arrayBuffer());
    need(h.status === 206 && h.headers.get('content-range') === `bytes 0-9/${fx['red.png'].length}` && bytes.equals(fx['red.png'].subarray(0, 10)), 'Range 206 with the double\'s bytes', h.status);
    need((await c.api('observer', 'GET', `/api/v1/source-previews/${'ab'.repeat(16)}`)).body.error.code === 'preview_not_found', 'unknown handle');
    const n = dbl.host.seen.length;
    need((await c.api('observer', 'GET', `/api/v1/source-previews/${encodeURIComponent(`${dbl.host.url}/ov/red.png`)}`)).status === 404 && dbl.host.seen.length === n, 'a URL is never fetched');
    evidence['4'] = { status: 206, contentRange: h.headers.get('content-range') };
    return true;
  },
  '5': async () => {
    const before = s.store.wholeProject(rpid).revision;
    const a = await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/import`, { provider: 'openverse', itemId: `image:${OV_BY}`, place: { start: ZERO } });
    const j = await c.finished(a.body.jobId);
    need(j.status === 'succeeded', 'job', j.error);
    const asset = assetOf(rpid, out(j).assetId);
    const src = asset.provenance.source!;
    need(src.sha256 === sha(fx['red.png']) && asset.contentHash === `sha256:${src.sha256}` && Date.parse(src.fetchedAt) > 0, 'hash and fetch time');
    need(src.credit?.text === '"Red cat" by Ann Author is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.', 'credit verbatim', src.credit);
    need(validateProject(docOf(rpid)).filter((i) => i.code === 'source_provenance').length === 0, 'the record validates');
    const txs = s.store.db.prepare('SELECT id, actor, ops FROM transactions WHERE project_id = ? AND revision > ? ORDER BY revision').all(rpid, before) as { id: string; actor: string; ops: string }[];
    need(eq(txs.map((t) => [t.actor, JSON.parse(t.ops).map((o: any) => o.op)]), [['agent:local', ['use_source_item']], ['agent:local', ['add_clip']]]), 'two commits as the agent', txs.map((t) => t.actor));
    const docBefore = JSON.stringify(s.store.replay(rpid, before).doc);
    for (const t of [...txs].reverse()) need((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/undo`, { transactionId: t.id })).status === 200, 'undo');
    need(JSON.stringify(docOf(rpid)) === docBefore, 'undo removes it exactly');
    evidence['5'] = { commits: txs.map((t) => JSON.parse(t.ops)[0].op), sha256: src.sha256, credit: src.credit?.text };
    return true;
  },
  '6': async () => {
    const big = fx['big.mp4'], half = Math.floor(big.length / 2);
    const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: dbl.host.put('/cut.mp4', { bytes: big, contentType: 'video/mp4', etag: '"v1"', cutAfterBytes: half }) })).body.jobId);
    const asks = dbl.host.seen.filter((x) => x.path === '/cut.mp4');
    need(j.status === 'succeeded' && asks.length === 2 && asks[1]!.headers.range === `bytes=${half}-` && asks[1]!.headers['if-range'] === '"v1"', 'resumed with Range + If-Range', asks.map((x) => x.headers.range));
    need(assetOf(rpid, out(j).assetId).provenance.source!.sha256 === sha(big), 'final hash');
    const big2 = fx['big2.mp4'];
    dbl.host.put('/changed.mp4', { bytes: big2, contentType: 'video/mp4', etag: '"v1"', cutAfterBytes: Math.floor(big2.length / 2), onAnswer: (n, f) => { if (n === 1) f.etag = '"v2"'; } });
    const j2 = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: `${dbl.host.url}/changed.mp4` })).body.jobId);
    need(j2.status === 'succeeded' && assetOf(rpid, out(j2).assetId).provenance.source!.sha256 === sha(big2), 'a changed ETag restarts at 0 and ends equal');
    const big3 = fx['big3.mp4'];
    dbl.host.put('/norange.mp4', { bytes: big3, contentType: 'video/mp4', cutAfterBytes: 1000, ignoreRange: true });
    const j3 = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: `${dbl.host.url}/norange.mp4` })).body.jobId);
    need(j3.status === 'succeeded' && assetOf(rpid, out(j3).assetId).provenance.source!.sha256 === sha(big3), 'a 200 to the Range restarts at 0 and ends equal');
    need(eq(tmpFiles(ddir), []), 'no temp files left', tmpFiles(ddir));
    evidence['6'] = { resumedFrom: half, range: asks[1]!.headers.range, ifRange: asks[1]!.headers['if-range'] };
    return true;
  },
  '7': async () => {
    const f = { bytes: fx['big.mp4'], contentType: 'video/mp4', etag: '"r1"', stallAfterBytes: 40_000 } as { bytes: Buffer; contentType: string; etag: string; stallAfterBytes?: number };
    const a = await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: dbl.host.put('/restart.mp4', f) });
    const part = path.join(ddir, 'tmp', `src_${a.body.jobId}.part`);
    await until(() => fs.existsSync(part) && fs.statSync(part).size >= 40_000);
    await s.close();
    need(fs.existsSync(part) && fs.existsSync(part.replace(/\.part$/, '.link')), 'the .part and the .link stay over the stop');
    delete f.stallAfterBytes;
    s = await bootSources(ddir, dbl);
    const j = await c.finished(a.body.jobId);
    need(j.status === 'succeeded' && dbl.host.seen.filter((x) => x.path === '/restart.mp4').at(-1)!.headers.range === 'bytes=40000-', 'recover continued the .part');
    need(eq(tmpFiles(ddir), []), 'nothing left after success', tmpFiles(ddir));
    const cx = await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: dbl.host.put('/stall2.mp4', { bytes: fx['big2.mp4'], contentType: 'video/mp4', stallAfterBytes: 10_000 }) });
    await until(() => tmpFiles(ddir).some((x) => x.startsWith(`src_${cx.body.jobId}.part`)));
    need((await c.api('agent', 'POST', `/api/v1/jobs/${cx.body.jobId}/cancel`)).status === 200 && (await c.finished(cx.body.jobId)).status === 'canceled', 'cancel');
    need(eq(tmpFiles(ddir), []), 'nothing left after cancel', tmpFiles(ddir));
    const fj = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: dbl.host.put('/fail.html', { bytes: Buffer.from('<!doctype html><p>x'), contentType: 'text/html' }) })).body.jobId);
    need(fj.status === 'failed' && eq(tmpFiles(ddir), []), 'nothing left after a failure', [fj.status, tmpFiles(ddir)]);
    evidence['7'] = { resumedRange: 'bytes=40000-', afterSuccessCancelFailure: [] };
    return true;
  },
  '8': async () => {
    need(eq((await c.api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: 100_000 })).body, { maxDownloadBytes: 100_000, maxUploadBytes: s.cfg.maxUploadBytes, effectiveMaxBytes: 100_000 }), 'the setting (guarded mode: the upload limit is set)');
    need((await c.api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: s.cfg.maxUploadBytes * 4 })).body.effectiveMaxBytes === s.cfg.maxUploadBytes, 'a setting above the upload limit is capped at it');
    await c.api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: 100_000 });
    const n = Object.keys(docOf(rpid).assets).length;
    const big = Buffer.concat([fx['big.mp4'], Buffer.from('never stored')]);
    const codes: unknown[] = [];
    // no Content-Length, and a Content-Length above the limit: download_too_large naming the setting's number
    for (const file of [{ bytes: big, contentType: 'video/mp4', noContentLength: true }, { bytes: big.subarray(0, 50_000), contentType: 'video/mp4', lieContentLength: 500_000 }]) {
      const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: dbl.host.put(`/large-${codes.length}.mp4`, file) })).body.jobId);
      codes.push([(j.error as any)?.code, (j.error as any)?.details?.maxBytes]);
      need((j.error as any)?.code === 'download_too_large' && (j.error as any).details.maxBytes === 100_000 && String((j.error as any).message).includes('100000 bytes'), 'download_too_large naming the number', j.error);
    }
    // a Content-Length that lies LOW: HTTP/1.1 ends the body at the declared length, so the client sees a cut file (never more
    // bytes than declared); the job fails and nothing is stored (the cut file is not media the importer can read)
    const low = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: dbl.host.put('/large-low.mp4', { bytes: big, contentType: 'video/mp4', lieContentLength: 50_000 }) })).body.jobId);
    need(low.status === 'failed', 'a low Content-Length: the job fails', low.status);
    codes.push(['lies low', (low.error as any)?.code]);
    need(Object.keys(docOf(rpid).assets).length === n && !fs.readdirSync(path.join(ddir, 'blobs')).includes(sha(big)) && eq(tmpFiles(ddir), []), 'nothing stored');
    await c.api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: null });
    evidence['8'] = { refused: codes, fileBytes: big.length };
    return true;
  },
  '9': async () => {
    const port = dbl.host.port;
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4')?.address;
    const refused: string[] = [];
    for (const h of ['127.0.0.1', '[::ffff:127.0.0.1]', '[::1]', '169.254.169.254', '0.0.0.0', ...(lan ? [lan] : [])]) {
      const r = await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: `http://${h}:${port}/ov/red.png` });
      need(r.status === 422 && r.body.error?.code === 'link_address_refused', `refused ${h}`, r.body);
      refused.push(h);
    }
    dbl.host.put('/to-loop', { bytes: Buffer.alloc(0), redirectTo: `http://127.0.0.1:${port}/ov/red.png` });
    for (const url of [`${dbl.host.url}/to-loop`, `http://localhost:${port}/ov/red.png`]) {
      const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url })).body.jobId);
      need(j.status === 'failed' && (j.error as any).code === 'link_address_refused', `refused ${url}`, j.error);
    }
    const a = await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: dbl.nas.put('/nas/clip.mp4', { bytes: fx['small.mp4'], contentType: 'video/mp4' }) });
    const j = await c.finished(a.body.jobId);
    need(j.status === 'succeeded' && out(j).warnings.some((w: any) => w.code === 'link_private_network'), 'a home-network address imports with link_private_network', out(j)?.warnings);
    evidence['9'] = { refused, redirectAndNameRefused: true, privateHost: DOUBLE_PRIVATE_HOST, machineAddressTested: !!lan, dualAnswerName: 'localhost (resolves to 127.0.0.1 and ::1 here; a name answering one public and one loopback address needs a DNS double: not built)' };
    return true;
  },
  '9b': async () => {
    const rt = createSourcesRuntime({ cfg: s.cfg, store: s.store, gov: s.governance, imports: s.imports });
    const owner = { actor: 'user:local', kind: 'user' as const, scopes: ['observe' as const, 'edit' as const] };
    const codes: unknown[] = [];
    for (const url of [`http://127.0.0.1:${dbl.host.port}/ov/red.png`, `${dbl.host.url}/ov/red.png`]) {
      try { await rt.importLink(owner, rpid, { url }); codes.push('accepted'); } catch (e: any) { codes.push(e.code); }
    }
    await rt.stop();
    need(eq(codes, ['link_address_refused', 'link_address_refused']), 'the default policy refuses loopback', codes);
    evidence['9b'] = { codes };
    return true;
  },
  '10': async () => {
    const fj = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: dbl.host.put('/page.html', { bytes: Buffer.from('<!doctype html><title>x</title>'), contentType: 'text/html; charset=utf-8' }) })).body.jobId);
    need((fj.error as any)?.code === 'download_not_media', 'text/html: download_not_media', fj.error);
    // a Dropbox share link: the downloader asks for dl=1; the record's page keeps no query (a double answers for the share path)
    const { canonicalLink } = await import('@pulseframe/providers');
    const link = canonicalLink('https://www.dropbox.com/s/abc123/clip.mp4?dl=0');
    need(link.requestUrl.includes('dl=1') && !link.requestUrl.includes('dl=0'), 'fetched as dl=1', link.requestUrl);
    const path10 = '/s/abc123/clip.mp4';
    dbl.host.put(path10, { bytes: fx['small.mp4'], contentType: 'video/mp4' });
    const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: `${dbl.host.url}${path10}?dl=0` })).body.jobId);
    const page = assetOf(rpid, out(j).assetId)?.provenance.source?.pageUrl ?? '';
    need(j.status === 'succeeded' && !page.includes('dl=0') && !page.includes('?'), 'the record\'s pageUrl keeps the query out', page);
    evidence['10'] = { notMedia: (fj.error as any).code, dropboxRequest: link.requestUrl.replace(/abc123/, '<id>'), pageUrl: page.replace(/:\d+/, ':<port>'), note: 'the Dropbox host itself is not contacted: canonicalLink is checked as a function, and the double serves the same path' };
    return true;
  },
  '11': async () => {
    const pid = (await c.api('owner', 'POST', '/api/v1/projects', { name: 'sources check 11', width: 320, height: 180 })).body.project.id as string;
    const ids: string[] = [];
    for (const [i, [provider, itemId]] of ([['openverse', `image:${OV_NC}`], ['openverse', `image:${OV_ND}`], ['pixabay', 'video:4242'], ['openverse', `image:${OV_BY}`]] as const).entries()) {
      const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${pid}/sources/import`, { provider, itemId, place: { start: { value: String(2 * i), timescale: 1 } } })).body.jobId);
      need(j.status === 'succeeded' && out(j).placed, `import ${itemId}`, j.error ?? out(j).placeRefusal);
      ids.push(out(j).assetId);
    }
    // image clips get a default length; make each 2 s so the film is short
    const ex = await c.api('agent', 'POST', `/api/v1/projects/${pid}/exports`, { format: 'mp4-h264-aac' });
    need(ex.status === 202, 'the export starts', ex.body);
    const ej = await c.finished(ex.body.jobId, 240_000);
    need(ej.status === 'succeeded', 'the export succeeds', ej.error);
    const lic = out(ej).licence;
    const w = (ej.output as any).warnings ?? [];
    const pf = (await c.api('agent', 'GET', `/api/v1/projects/${pid}/preflight`)).body.issues as { code: string; message: string; severity: string }[];
    const nc = pf.find((x) => x.code === 'non_commercial_content'), nd = pf.find((x) => x.code === 'licence_no_derivatives');
    need(!!nc && nc.message.includes('CC BY-NC 4.0'), 'non_commercial_content names the licence', nc);
    need(!!nd && nd.message.includes('CC BY-ND 4.0') && nd.message.includes(SOURCE_TERMS['cc.nd']!.quote), 'licence_no_derivatives quotes the deed', nd);
    need(pf.filter((x) => x.code.startsWith('licence_') || x.code === 'non_commercial_content' || x.code === 'source_terms').every((x) => x.severity !== 'blocker'), 'nothing blocks');
    need(lic?.licenceNotes?.some((n: any) => n.code === 'licence_no_derivatives') && lic.nonCommercial.some((n: any) => n.title === 'Yellow cat'), 'the export job\'s licence carries the notes and the NC file', lic);
    const left = new Set(archiveLibraryPlan(docOf(pid)).omitted.map((o) => o.assetId));
    need(left.has(ids[0]!) && left.has(ids[2]!) && !left.has(ids[3]!), 'a sharing archive leaves out the NC and the Pixabay files, keeps the CC BY one', [...left]);
    need(planArchive(s.store, pid, { family: 'keep', library: 'strip' }).library === 'strip', 'the sharing archive is made');
    need((await c.api('owner', 'GET', `/api/v1/projects/${pid}/archive`)).body?.error?.code === 'archive_needs_library_choice', 'without a choice the archive asks for one');
    evidence['11'] = { exportJob: ej.id, exportWarnings: Array.isArray(w) ? w.map((x: any) => x.code) : null, preflight: pf.map((x) => [x.code, x.severity]), archiveLeavesOut: [...left].length };
    return true;
  },
  '12': async () => {
    const golden = JSON.parse(fs.readFileSync(new URL('../../../apps/server/src/library/credits.golden.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    const coreGolden = JSON.parse(fs.readFileSync(new URL('../../core/src/credits.golden.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    for (const [name, make] of GOLD_DOCS) {
      const doc = make();
      need(JSON.stringify({ licence: exportLicence(doc), warnings: libraryExportWarnings(doc) }) === JSON.stringify(golden[name]), `server golden ${name}`);
      need(name in coreGolden, `core golden has ${name}`);
    }
    const pid = (await c.api('owner', 'POST', '/api/v1/projects', { name: 'sources check 12', width: 320, height: 180 })).body.project.id as string;
    const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${pid}/sources/import`, { provider: 'openverse', itemId: `image:${OV_BY}`, place: { start: ZERO } })).body.jobId);
    need(j.status === 'succeeded', 'import', j.error);
    const pf = (await c.api('agent', 'GET', `/api/v1/projects/${pid}/preflight`)).body.issues.map((x: any) => x.code);
    need(pf.includes('credits_for_description'), 'the export reminder', pf);
    const card = await c.api('agent', 'POST', `/api/v1/projects/${pid}/transactions`, { ops: [{ op: 'add_credits_card', args: {} }] });
    need(card.status === 200, 'a credits card', card.body);
    evidence['12'] = { goldenDocs: GOLD_DOCS.length, reminder: true, card: card.status };
    return true;
  },
  '13': async () => {
    await c.api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: null }); // the upload limit (an earlier check may have left a lower one)
    const pid = (await c.api('owner', 'POST', '/api/v1/projects', { name: 'sources check 13', width: 320, height: 180 })).body.project.id as string;
    const id = 'a1b2c3d4-0000-4000-8000-0000000000a5';
    dbl.ov.items.push({ id, media: 'audio', title: 'Proof song', creator: 'Dee', license: 'by-sa', license_version: '4.0', fileUrl: dbl.host.put('/ov/proof-song.wav', { bytes: songWav(60, 120, 1), contentType: 'audio/wav' }), filetype: 'wav', duration: 60_000, category: 'music' });
    const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${pid}/sources/import`, { provider: 'openverse', itemId: `audio:${id}` })).body.jobId);
    need(j.status === 'succeeded', 'import of the song', j.error);
    const song = out(j).assetId as string;
    const times = Array.from({ length: 119 }, (_, k) => T.rt(60 * k, 120));
    s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'attach_analysis', args: { assetId: song, kind: 'beats', method: 'sources proof fixture: the exact beats the proof wrote into its synthetic song (no tracker ran)', params: {}, createdAt: new Date().toISOString(), times, bpm: 120, confidence: 1, downbeats: times.filter((_, k) => k % 4 === 0), meter: 4 } }] });
    const pic = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${pid}/sources/import`, { provider: 'openverse', itemId: `image:${OV_BY}` })).body.jobId);
    const R = docOf(pid).settings.frameRate;
    const t = await c.api('owner', 'POST', `/api/v1/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: out(pic).assetId, start: T.ZERO, duration: T.frameTime(600, R) } }, { op: 'add_clip', args: { assetId: song, start: T.ZERO, duration: T.frameTime(600, R) } }] });
    need(t.status === 200, 'clips', t.body);
    const clipId = String(t.body.results[1].output.clipId);
    const body = { target: { clipId }, music: { keep: true }, tailor: true };
    const p = await c.api('owner', 'POST', `/api/v1/projects/${pid}/music-fit/plan`, body);
    need(p.status === 200, 'the plan', p.body);
    const sa = (p.body.warnings ?? []).find((n: any) => n.code === 'licence_share_alike');
    need(!!sa && sa.message.includes(SOURCE_TERMS['cc.sa']!.quote) && sa.message.includes('CC BY-SA 4.0'), 'the share-alike warning quotes the deed', p.body.warnings?.map((n: any) => n.code));
    const a = await c.api('owner', 'POST', `/api/v1/projects/${pid}/music-fit/apply`, { ...body, expectedRevision: s.store.wholeProject(pid).revision });
    need(a.status === 200 && a.body.madeAssetId, 'applied: shortened, not refused', a.body);
    const made = assetOf(pid, a.body.madeAssetId);
    need(made.provenance.source?.itemId === `audio:${id}` && made.provenance.source.licence.id === 'CC-BY-SA-4.0' && made.provenance.origin === 'derived', 'the copy carries the source record', made.provenance);
    const lines = collectCredits(docOf(pid)).lines.filter((l) => l.text.includes('Proof song'));
    need(lines.length >= 1, 'its credit is listed', collectCredits(docOf(pid)).lines.map((l) => l.text));
    evidence['13'] = { warnings: p.body.warnings.map((n: any) => n.code), madeRecord: made.provenance.source?.licence, credit: lines.map((l) => ({ text: l.text, modified: (l as any).modified ?? null })) };
    return true;
  },
  '14': async () => {
    const url = dbl.host.put('/once.png', { bytes: fx['blue.png'], contentType: 'image/png' });
    const a = await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url, idempotencyKey: 'k-once' });
    const b = await c.api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url, idempotencyKey: 'k-once' });
    need(a.body.jobId === b.body.jobId, 'one job', [a.body.jobId, b.body.jobId]);
    need((await c.finished(a.body.jobId)).status === 'succeeded' && dbl.host.seen.filter((x) => x.path === '/once.png').length === 1, 'one download');
    need(!JSON.stringify(s.store.getJob(a.body.jobId)).includes(url), 'the job row holds no link (C11)');
    evidence['14'] = { jobId: a.body.jobId, downloads: 1 };
    return true;
  },
  '15': async () => ui(),
};

/** Check 15: the built editor in headless Chromium, keyboard only for the «מאגר» path. */
async function ui(): Promise<Outcome> {
  const dist = fileURLToPath(new URL('../../../apps/web/dist/index.html', import.meta.url));
  if (!fs.existsSync(dist)) return BLOCKED('the web build is missing (run pnpm build first)');
  const { chromium } = await import('playwright');
  const pid = (await c.api('owner', 'POST', '/api/v1/projects', { name: 'מאגר', width: 320, height: 180 })).body.project.id as string;
  await c.api('owner', 'DELETE', '/api/v1/sources/pixabay/credentials');
  const browser = await chromium.launch();
  const errors: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('timecode').waitFor({ timeout: 30_000 });
    const rtl = await page.evaluate(() => document.documentElement.dir);
    const k = page.keyboard;
    // «מאגר» tab by keyboard
    await page.getByTestId('media-tab-sources').focus(); await k.press('Enter');
    await page.getByTestId('sources-panel').waitFor();
    await page.getByTestId('sources-search').focus();
    await k.type('red cat'); await k.press('Enter');
    const row = page.getByTestId(`sources-row-openverse-image:${OV_BY}`);
    await row.waitFor({ timeout: 15_000 });
    const badge = await page.getByTestId(`sources-badge-image:${OV_BY}`).getAttribute('aria-label').catch(() => null) ?? await page.getByTestId(`sources-badge-image:${OV_BY}`).textContent();
    await page.getByTestId('sources-results').focus();
    let idx = 0;
    for (; idx < 6 && !(await row.evaluate((el) => el.getAttribute('aria-selected') === 'true')); idx++) await k.press(rtl === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    await k.press(' ');
    const preview = await page.getByTestId('sources-preview').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    const autoplay = preview ? await page.getByTestId('sources-preview').evaluate((el) => (el.querySelector('video,audio') as HTMLMediaElement | null)?.autoplay ?? false) : null;
    const n0 = Object.keys(docOf(pid).assets).length;
    await k.press('Enter');
    let placed = false;
    for (let i = 0; i < 200 && !placed; i++) { await page.waitForTimeout(100); const d = docOf(pid); placed = Object.values(d.assets).some((a) => a.provenance.source?.itemId === `image:${OV_BY}` && d.sequences[d.mainSequenceId]!.tracks.some((tr) => tr.clips.some((cl) => cl.type === 'media' && cl.assetId === a.id))); }
    // the link box
    await page.getByTestId('sources-link-input').focus();
    await k.type(dbl.host.put('/ui/link.png', { bytes: fx['green.png'], contentType: 'image/png' }));
    await k.press('Enter');
    let linked = false;
    for (let i = 0; i < 200 && !linked; i++) { await page.waitForTimeout(100); linked = Object.values(docOf(pid).assets).some((a) => a.provenance.source?.provider === 'link'); }
    const answer = await page.getByTestId('sources-link-answer').textContent();
    // Settings › «חיבורים»: the owner's session stores the Pixabay key
    await page.getByTestId('rail-settings').focus(); await k.press('Enter');
    await page.getByTestId('settings-connections').waitFor();
    await page.getByTestId('connect-key-pixabay').focus(); await k.type(PX_KEY);
    await page.getByTestId('connect-save-pixabay').focus(); await k.press('Enter');
    let stored = false;
    for (let i = 0; i < 50 && !stored; i++) { await page.waitForTimeout(100); stored = (await c.api('observer', 'GET', '/api/v1/sources')).body.sources.find((x: any) => x.provider === 'pixabay')?.state === 'ready'; }
    const keyInPage = (await page.content()).includes(PX_KEY);
    evidence['15'] = { dir: rtl, badge, previewShown: preview, previewAutoplay: autoplay, arrowPresses: idx, placedAtPlayhead: placed, assetsAdded: Object.keys(docOf(pid).assets).length - n0, linkAnswer: answer?.slice(0, 120), keyStored: stored, keyLeftInPage: keyInPage, pageErrors: errors };
    need(rtl === 'rtl', 'the editor opens right-to-left (Hebrew)', rtl);
    need(!!badge && /CC BY 4\.0/.test(badge), 'the licence badge names the licence', badge);
    need(preview && autoplay === false, 'Space previews; nothing autoplays', { preview, autoplay });
    need(placed, 'Enter placed it on the timeline');
    need(linked, 'the link box imported', answer);
    need(stored && !keyInPage, 'the owner\'s session stored the key; the page does not show it', { stored, keyInPage });
    need(errors.length === 0, 'no page errors', errors);
    return true;
  } finally { await browser.close(); }
}

async function main(): Promise<number> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sources-proof-'));
  ddir = path.join(root, 'data');
  try {
    fx = makeFixtures(root);
    dbl = await startDoubles(fx);
    s = await bootSources(ddir, dbl);
    rpid = s.store.createProject({ name: 'Secret project name 9z' }).doc.id;
    freeSpace.bytes = 100 * 1024 ** 3;
    for (const name of SOURCES_PROOF_CHECKS) {
      const id = name.split(' ')[0]!;
      const t0 = Date.now();
      let r: Outcome;
      try { r = await CHECKS[id]!(); } catch (e) { r = `FAIL: ${e instanceof Error ? e.message : String(e)}`; }
      const state = r === true ? 'pass' : r.startsWith('BLOCKED') ? 'blocked' : 'fail';
      results.push({ check: name, state, ...(r === true ? {} : { detail: r }) });
      console.log(`${state === 'pass' ? '  ok   ' : state === 'blocked' ? ' BLOCK ' : ' FAIL  '} ${name.slice(0, 140)}${r === true ? '' : `\n         ${r}`}  (${Date.now() - t0} ms)`);
    }
  } finally {
    await s?.close().catch(() => undefined);
    await dbl?.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
  const code = results.some((r) => r.state === 'fail') ? 1 : results.some((r) => r.state === 'blocked') ? 2 : 0;
  const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
  fs.mkdirSync(path.join(rootDir, 'docs', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'docs', 'evidence', 'sources-proof.json'), `${JSON.stringify({ when: new Date().toISOString(), exit: code, results, evidence, note: 'LABELLED DOUBLES only (127.0.0.9/10, port 0); synthetic fixtures; no real service, media or key' }, null, 1)}\n`);
  console.log(`\nproof:sources — ${results.filter((r) => r.state === 'pass').length}/${results.length} pass, ${results.filter((r) => r.state === 'fail').length} fail, ${results.filter((r) => r.state === 'blocked').length} blocked`);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
