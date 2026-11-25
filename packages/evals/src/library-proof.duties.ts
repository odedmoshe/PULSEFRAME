/**
 * pnpm proof:library, part duties (worker B): checks 12–15 of library-proof.ts, against the real server (startServer, one data
 * directory per check, loopback only). Fixtures are SYNTHETIC: tones and a test picture made by ffmpeg, uploaded through the real
 * import route, then given their library record by use_library_item committed as the server's library route commits it (the
 * route itself is worker A's; until it lands the record is attached in-process with the same internal operation). No downloaded
 * file is used.
 *
 * Check 13 has two halves: the core half (licence table, the operation's refusal) and the catalogue half (an Iconify-shaped CC BY
 * set's credit names its author; a CC BY row without credit is listed credit_missing and use answers 409), the latter over the
 * SYNTHETIC LIBRARY of library-fixtures.ts set as the folder by the owner's session.
 *
 * Run alone: `tsx packages/evals/src/library-proof.duties.ts` (exit 0 pass, 1 fail, 2 blocked). Needs `pnpm build` (the still).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as T from '@pulseframe/time';
import { applyTransaction, collectCredits, createProject, licenceDuties, LIBRARY_REFUSALS, OpError, type LibraryRecord } from '@pulseframe/core';
import { startServer } from '@pulseframe/server';
import { backupDataDir } from '../../../apps/server/src/backup.ts';
import { LIBRARY_CONFIG_FILE, LIBRARY_INDEX_FILE } from '../../../apps/server/src/library/contract.ts';
import type { LibraryProofPart } from './library-proof.ts';
import { FIX_ICON_AUTHOR, FIX_KEYS, makeLibraryFixture } from './library-fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Server = Awaited<ReturnType<typeof startServer>>;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let port = 18930;

/** A fresh server in its own temp data directory, with REST helpers as the agent (bearer) and as the owner (session cookie). */
async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-libproof-b-'));
  const s = await startServer({ port: port++, dataDir: path.join(dir, 'data'), libraryDir: null });
  const cookie = s.auth.issueSession(new Request(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner } })).split(';')[0]!;
  const who = { agent: { authorization: `Bearer ${s.auth.tokens.agent}` }, owner: { cookie, origin: s.url } } as const;
  const call = async (p: string, body?: unknown, as: keyof typeof who = 'agent', method?: string) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...who[as], connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = r.headers.get('content-type') ?? '';
    return { status: r.status, type, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; type: string; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction refused: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const upload = async (pid: string, file: string) => {
    const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...who.agent, connection: 'close', 'x-filename': path.basename(file) }, body: fs.readFileSync(file) });
    const b = (await r.json()) as any;
    if (!b.assetId) throw new Error(`upload failed: ${JSON.stringify(b).slice(0, 300)}`);
    return b.assetId as string;
  };
  /** The library record onto an uploaded file, as the library route commits it (use_library_item, internal). */
  const attach = (pid: string, assetId: string, record: LibraryRecord) => {
    const a = s.store.getProject(pid).doc.assets[assetId]!;
    const { id: _id, ...rest } = a;
    const { upload: _u, ...provenance } = rest.provenance;
    const r = s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'use_library_item', args: { asset: { ...rest, provenance: { ...provenance, library: record } } } }] });
    return r.results[0]!.output as { assetId: string; deduplicated: boolean; recordAttached: boolean };
  };
  const docHash = async (pid: string) => sha(JSON.stringify((await call(`/projects/${pid}`)).body.project));
  return { s, dir, call, tx, upload, attach, docHash, close: async () => { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
type World = Awaited<ReturnType<typeof world>>;

const record = (over: Partial<LibraryRecord>): LibraryRecord => ({ itemId: 'synthetic/x', sourceId: 'synthetic', kind: 'music', title: 'X', sourceSha256: '0'.repeat(64), ledger: { item: 'synthetic' }, licence: { id: 'CC0-1.0' }, flags: {}, ...over });
const SONG_CREDIT = 'Song Synthetic Composer (example.invalid)\nLicensed under Creative Commons: By Attribution 4.0';

/**
 * The synthetic project of checks 12 and 14: a CC0 tone, a CC BY tone whose credit must be on screen (its record as a ledger entry
 * with `creditOnScreen: true` would make it; the fetch tool writes no such entry today), a CC BY-NC sound and a CC BY picture
 * (their credits go in the description: `creditInExport` means "due with every export", lead decision 2026-11-25).
 */
async function libraryProject(w: World) {
  const art = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-libproof-b-media-'));
  const tone = (name: string, hz: number) => { const p = path.join(art, name); ff(['-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=3`, '-c:a', 'pcm_s16le', p]); return p; };
  const pic = path.join(art, 'star.png');
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x180', '-frames:v', '1', pic]);
  const pid = (await w.call('/projects', { name: 'library duties', width: 640, height: 360, frameRate: R })).body.project.id as string;
  const files = { zero: tone('zero.wav', 330), song: tone('song.wav', 440), bird: tone('bird.wav', 880), star: pic };
  const up: Record<string, string> = {};
  for (const [k, file] of Object.entries(files)) up[k] = await w.upload(pid, file);
  const sh = (file: string) => sha(fs.readFileSync(file));
  const recs: Record<string, LibraryRecord> = {
    zero: record({ itemId: 'synthetic/zero.wav', title: 'Zero', sourceSha256: sh(files.zero) }),
    song: record({ itemId: 'synthetic/song.wav', title: 'Song', sourceSha256: sh(files.song), licence: { id: 'CC-BY-4.0' }, credit: { text: SONG_CREDIT, placement: 'on_screen' } }),
    bird: record({ itemId: 'synthetic/bird.wav', kind: 'sound', title: 'Bird', sourceSha256: sh(files.bird), licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'Bird by Synthetic Recordist (CC BY-NC 4.0)', placement: 'description' }, flags: { nonCommercial: true, diskOnly: true } }),
    star: record({ itemId: 'synthetic/star.png', kind: 'sticker', title: 'Star', sourceSha256: sh(files.star), licence: { id: 'CC-BY-4.0' }, credit: { text: 'Star set by Synthetic Designer — CC BY 4.0 (https://example.invalid)', placement: 'description' } }),
  };
  const attached: Record<string, { assetId: string; recordAttached: boolean }> = {};
  for (const k of Object.keys(files)) attached[k] = w.attach(pid, up[k]!, recs[k]!);
  const placed = await w.tx(pid, [
    { op: 'add_clip', args: { assetId: attached.star!.assetId, start: f(0), duration: f(60) } },
    { op: 'add_clip', args: { assetId: attached.zero!.assetId, start: f(0), duration: f(60) } },
    { op: 'add_clip', args: { assetId: attached.song!.assetId, start: f(15), duration: f(45) } },
    { op: 'add_clip', args: { assetId: attached.bird!.assetId, start: f(30), duration: f(30) } },
  ]);
  fs.rmSync(art, { recursive: true, force: true });
  const clipOf = (i: number) => placed.results[i].output.clipId as string;
  return { pid, attached, recs, starClip: clipOf(0) };
}
const fail = (why: string, detail?: unknown) => `${why}${detail === undefined ? '' : `: ${JSON.stringify(detail).slice(0, 500)}`}`;
const countOnce = (hay: string, needle: string) => hay.split(needle).length - 1 === 1;

async function check12(): Promise<true | string> {
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) return 'BLOCKED: web bundle missing (run `pnpm build`), the still of the card cannot be drawn';
  const w = await world();
  try {
    const { pid, attached, recs, starClip } = await libraryProject(w);
    if (!Object.values(attached).every((a) => a.recordAttached)) return fail('an uploaded file did not take its library record', attached);
    const credits = async (lang = 'he') => (await w.call(`/projects/${pid}/credits?lang=${lang}`)).body;
    const c0 = await credits();
    const required = [recs.song!, recs.bird!, recs.star!].map((r) => r.credit!.text);
    if (JSON.stringify(c0.lines.map((l: any) => l.text)) !== JSON.stringify(required)) return fail('the credit lines are not the required ones in music, sound, picture order', c0.lines);
    if (!required.every((t) => countOnce(c0.descriptionText, t))) return fail('a required line is not exactly once in the description text', c0.descriptionText);
    if (c0.descriptionText.includes('Zero')) return fail('the CC0 file appears in the credits');
    if (!c0.descriptionText.includes('לשימוש לא מסחרי בלבד: Bird')) return fail('the non-commercial line is missing', c0.descriptionText);
    // removing the picture's clip removes its line; undo brings it back
    await w.tx(pid, [{ op: 'delete_clip', args: { clipId: starClip } }]);
    if ((await credits()).descriptionText.includes(recs.star!.credit!.text)) return fail('the removed clip\'s credit is still listed');
    await w.call(`/projects/${pid}/undo`, {});
    if (!(await credits()).descriptionText.includes(recs.star!.credit!.text)) return fail('undo did not bring the credit back');
    // preflight: the on-screen credit is missing; its fix is the credits card, which clears it
    const pf = (await w.call(`/projects/${pid}/preflight`)).body.issues as any[];
    const miss = pf.find((i) => i.code === 'credit_not_on_screen');
    if (!miss?.fix || miss.fix.ops[0]?.op !== 'add_credits_card') return fail('preflight does not list credit_not_on_screen with the credits card as its fix', pf.map((i) => i.code));
    if (!pf.some((i) => i.code === 'non_commercial_content' && i.severity === 'warning')) return fail('preflight does not warn about non-commercial material');
    const desc = pf.find((i) => i.code === 'credits_for_description');
    if (desc?.severity !== 'note' || desc.fix) return fail('the description credits are not a note without a required fix', desc);
    if (JSON.stringify(desc.ids.slice().sort()) !== JSON.stringify([attached.bird!.assetId, attached.star!.assetId].sort())) return fail('the description reminder does not name exactly the description credits', desc.ids);
    if (pf.some((i) => i.ids?.includes(attached.zero!.assetId))) return fail('the CC0 file raised an issue');
    if (JSON.stringify(miss.ids) !== JSON.stringify([attached.song!.assetId])) return fail('credit_not_on_screen names more than the on-screen credit', miss.ids);
    const before = await w.docHash(pid);
    const card = await w.tx(pid, miss.fix.ops);
    const pf2 = (await w.call(`/projects/${pid}/preflight`)).body.issues as any[];
    if (pf2.some((i) => i.code === 'credit_not_on_screen')) return fail('the credits card did not clear credit_not_on_screen');
    // a still of the card has ink: frames 70 (inside the card, which starts at 60) differ from the background
    const png = await w.call(`/projects/${pid}/frame?index=70`);
    if (png.status !== 200) return fail('the still of the card was not drawn', png.status);
    const stillFile = path.join(w.dir, 'card.png');
    fs.writeFileSync(stillFile, png.body);
    const rgb = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', stillFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
    let ink = 0;
    for (let i = 0; i < rgb.length; i += 3) if (rgb[i]! + rgb[i + 1]! + rgb[i + 2]! > 300) ink++;
    if (ink < 200) return fail('the still of the credits card shows no text', { ink });
    // undo restores the document hash; redo puts the card back
    await w.call(`/projects/${pid}/undo`, {});
    if ((await w.docHash(pid)) !== before) return fail('undo of the credits card does not restore the document');
    await w.call(`/projects/${pid}/redo`, {});
    if (!card.results[0].output.clipIds?.length) return fail('the credits card made no clips', card.results[0].output);
    // export: not blocked; the job output's description text = the sidecar = core collectCredits over the exported document
    const exp = await w.call(`/projects/${pid}/exports`, { format: 'wav' });
    if (exp.status !== 202 && exp.status !== 200) return fail('the export was refused', exp.body);
    let job: any;
    for (let i = 0; i < 600; i++) { job = (await w.call(`/jobs/${exp.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(200); }
    if (job.status !== 'succeeded') return fail('the export did not succeed', job.error);
    const lic = job.output?.licence;
    const sidecar = lic?.credits?.file ? fs.readFileSync(path.join(w.s.store.outDir, lic.credits.file), 'utf8') : null;
    const core = collectCredits(w.s.store.getProject(pid).doc).descriptionText('he');
    if (!lic || lic.credits.descriptionText !== core || sidecar !== core || (await credits()).descriptionText !== core) return fail('job output, sidecar and core credits differ', { output: lic?.credits, sidecar });
    return true;
  } finally { await w.close(); }
}

async function check13(): Promise<true | string> {
  // core half: a CC BY licence demands a credit; a CC BY record without one is refused as credit_missing
  const duties = licenceDuties('synthetic', { spdx: 'CC-BY-4.0' }, { diskOnly: false, creditInExport: false, shareAlike: false, people: false, aiGenerated: false, repoAllowed: true });
  if (!duties.credit || duties.use !== 'ok') return fail('CC BY 4.0 does not demand a credit', duties);
  const doc = createProject({ id: 'prj_p13', name: 'p13', width: 640, height: 360 });
  const asset = { kind: 'audio' as const, name: 'x.wav', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(1, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'upload' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof', library: record({ licence: { id: 'CC-BY-4.0' } }) } };
  let refused: string | null = null;
  try { applyTransaction(doc, [{ op: 'use_library_item', args: { asset } }], { idSeed: 'p13_', actor: 'proof', allowInternal: true }); } catch (e) { if (e instanceof OpError) refused = e.message; else throw e; }
  if (refused !== LIBRARY_REFUSALS.creditMissing.message()) return fail('a CC BY record without credit was not refused as credit_missing', refused);
  // catalogue half: worker A's readers and routes over the SYNTHETIC LIBRARY (library-fixtures.ts), the folder set by the owner
  const w = await world();
  try {
    const fx = await makeLibraryFixture(path.join(w.dir, 'fixture'));
    const set = await w.call('/library/root', { root: fx.root }, 'owner', 'PUT');
    if (set.status !== 200) return fail('the owner could not set the synthetic library folder', set.body);
    let st: any;
    for (let i = 0; i < 300; i++) { st = (await w.call('/library/status')).body; if (st?.state === 'ready') break; await sleep(100); }
    if (st?.state !== 'ready') return fail('the synthetic library did not become ready', st);
    const item = async (key: string) => w.call(`/library/items/${encodeURIComponent(key)}`);
    const cc = await item(FIX_KEYS.ccbyIcon);
    if (cc.status !== 200) return fail('the CC BY icon row is not listed', cc.body);
    if (cc.body.licenceId !== 'CC-BY-4.0' || !cc.body.duties?.credit || !cc.body.credit?.text?.includes(FIX_ICON_AUTHOR)) return fail('the CC BY icon set\'s credit does not name its author', { licenceId: cc.body.licenceId, credit: cc.body.credit, duties: cc.body.duties });
    const na = await item(FIX_KEYS.ccbyNoAuthor);
    if (na.status !== 200 || na.body.unusable !== 'credit_missing') return fail('a CC BY row without credit is not listed as credit_missing', { status: na.status, unusable: na.body?.unusable, credit: na.body?.credit });
    const pid = (await w.call('/projects', { name: 'p13 catalogue', width: 640, height: 360, frameRate: R })).body.project.id as string;
    const assetsBefore = Object.keys(w.s.store.getProject(pid).doc.assets).length;
    const use = await w.call(`/projects/${pid}/library/use`, { key: FIX_KEYS.ccbyNoAuthor, start: f(0) });
    if (use.status !== 409 || use.body?.error?.code !== 'library_item_unusable' || use.body.error.details?.reason !== 'credit_missing') return fail('using the CC BY row without credit was not refused 409 library_item_unusable (credit_missing)', { status: use.status, error: use.body?.error });
    if (Object.keys(w.s.store.getProject(pid).doc.assets).length !== assetsBefore) return fail('a refused use stored a file');
    return true;
  } finally { await w.close(); }
}

async function check14(): Promise<true | string> {
  const w = await world(), w2 = await world();
  try {
    const { pid, attached } = await libraryProject(w);
    const doc = w.s.store.getProject(pid).doc;
    const nc = doc.assets[attached.bird!.assetId]!.contentHash;
    const ncBytes = fs.readFileSync(w.s.store.blobPath(nc));
    const none = await w.call(`/projects/${pid}/archive`);
    if (none.status !== 409 || none.body?.error?.code !== 'archive_needs_library_choice') return fail('an archive without a choice was not refused', none.status);
    const omitFamily = await w.call(`/projects/${pid}/archive?family=omit`);
    if (omitFamily.status !== 409) return fail('the archive without family data and without a library choice was not refused', omitFamily.status);
    const strip = await w.call(`/projects/${pid}/archive?library=strip`);
    if (strip.status !== 200) return fail('library=strip was refused', strip.body);
    const tar = strip.body as Buffer;
    const all = new Set(Object.values(doc.assets).map((a) => a.contentHash));
    const inTar = [...all].filter((h) => tar.includes(Buffer.from(`blobs/${h.slice(7)}`)));
    if (JSON.stringify(inTar.sort()) !== JSON.stringify([...all].filter((h) => h !== nc).sort())) return fail('strip did not omit exactly the restricted blob', { inTar, nc });
    if (tar.includes(ncBytes)) return fail('the restricted file\'s bytes are inside the shared archive');
    const manifest = JSON.parse(tar.subarray(512, 512 + parseInt(tar.subarray(124, 136).toString('ascii'), 8)).toString('utf8'));
    if (manifest.library?.mode !== 'strip' || manifest.library.omitted.length !== 1 || manifest.library.omitted[0].hash !== nc) return fail('the manifest does not list the omitted file', manifest.library);
    // import elsewhere: opens with the file in missing media and the note in he and en
    const imp = await fetch(`${w2.s.url}/api/v1/projects/import`, { method: 'POST', headers: { authorization: `Bearer ${w2.s.auth.tokens.agent}`, connection: 'close', 'content-type': 'application/x-tar' }, body: new Uint8Array(tar) });
    const ib = (await imp.json()) as any;
    if (imp.status !== 201) return fail('the shared archive did not import', ib);
    const note = (ib.notes as any[]).find((n) => n.code === 'library_files_omitted');
    if (!note || !/[֐-׿]/.test(note.he) || !/left out of the archive/.test(note.en)) return fail('the import has no note in Hebrew and English', ib.notes);
    const missing = (await w2.call(`/projects/${ib.project.id}/missing-media`)).body.missing as any[];
    if (!JSON.stringify(missing).includes(attached.bird!.assetId)) return fail('the omitted file is not in missing media', missing);
    // keep: refused to an agent, everything for the owner's own session
    const keepAgent = await w.call(`/projects/${pid}/archive?library=keep`);
    if (keepAgent.status !== 403) return fail('library=keep was not refused to an agent', keepAgent.status);
    const keep = await w.call(`/projects/${pid}/archive?library=keep`, undefined, 'owner');
    if (keep.status !== 200 || !(keep.body as Buffer).includes(ncBytes)) return fail('library=keep for the owner does not hold every file', keep.status);
    // a project without library content: the same bytes with library=strip as without the parameter
    const plain = (await w.call('/projects', { name: 'plain', width: 640, height: 360, frameRate: R })).body.project.id as string;
    await w.tx(plain, [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } }]);
    const a = (await w.call(`/projects/${plain}/archive`)).body as Buffer, b = (await w.call(`/projects/${plain}/archive?library=strip`)).body as Buffer;
    if (!a.equals(b)) return fail('library=strip changes the archive of a project without library content');
    return true;
  } finally { await w.close(); await w2.close(); }
}

async function check15(): Promise<true | string> {
  const w = await world();
  try {
    const data = w.s.cfg.dataDir;
    fs.writeFileSync(path.join(data, LIBRARY_CONFIG_FILE), JSON.stringify({ root: '/nowhere' }), { mode: 0o600 });
    fs.writeFileSync(path.join(data, LIBRARY_INDEX_FILE), 'not an index');
    const dest = path.join(w.dir, 'backup');
    await backupDataDir(data, dest);
    const held = [LIBRARY_CONFIG_FILE, LIBRARY_INDEX_FILE].filter((n) => fs.existsSync(path.join(dest, n)));
    if (held.length) return fail('the backup holds the library\'s own files', held);
    if (!fs.readdirSync(dest).length) return fail('the backup is empty (nothing was proved)');
    return true;
  } finally { await w.close(); }
}

export const LIBRARY_PROOF_DUTIES: LibraryProofPart = { built: true, checks: { 12: check12, 13: check13, 14: check14, 15: check15 } };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failed = 0, blocked = 0;
  for (const [n, run] of Object.entries(LIBRARY_PROOF_DUTIES.checks)) {
    const t0 = Date.now();
    let r: true | string;
    try { r = await run(); } catch (e) { r = `threw: ${String((e as Error)?.stack ?? e).slice(0, 600)}`; }
    const state = r === true ? 'PASS' : r.startsWith('BLOCKED') ? 'BLOCKED' : 'FAIL';
    if (state === 'FAIL') failed++; else if (state === 'BLOCKED') blocked++;
    console.log(`${state} ${n} (duties, ${((Date.now() - t0) / 1000).toFixed(1)} s)${r === true ? '' : `: ${r}`}`);
  }
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
