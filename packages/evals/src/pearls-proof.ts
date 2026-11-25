/**
 * pnpm proof:pearls — marked source ranges «פנינים» (wave 7 pearls track; .artifacts/wave7/pearls-decisions.md §4). LEAD: the entry
 * point and the list of checks. The checks are built in three parts, each owned by one builder: pearls-proof.core.ts (A: P1, P6,
 * P8 numbers, P14–P16), pearls-proof.server.ts (B: P2, P7–P9 route and tool, P10–P12), pearls-proof.ui.ts (C: P3–P5, P7 and P9 in the
 * editor, P13, P15 browser side). This entry point runs every part of every check in number order, and adds the two halves only the
 * integration run can do: P6 with the barcodes read off a real EXPORT of the P6 film (p6Compare), and P15 with the digest
 * `window.__pfPearlsHash` returns in headless Chromium for pearlsDeterminismDocs() against core pearlsDigest in Node.
 * Exit 0 every check passes, 1 a failure, 2 only blocked ones besides passes ("cannot run here", never a pass).
 * Fixtures are SYNTHETIC only, made by the proof: barcode videos at 30 and 30000/1001 fps (packages/fixtures generateBarcodeFixture),
 * a tone and a still by FFmpeg, a time-preserving copy and an untimed (reversed) copy made by FFmpeg with lineage provenance, a typed
 * 12-word transcript, invented people «אלף», «בית», "Gimel", "gimel". No owner clip is ever used. Writes
 * docs/evidence/pearls-proof.json when built. One timing sample is one sample.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { evaluate } from '@pulseframe/engine';
import { pearlsDigest, validateProject, type Asset, type ProjectDocument } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import { readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { PEARLS_PROOF_CORE, p6Compare, p6Film, pearlsDeterminismDocs } from './pearls-proof.core.ts';
import { closePearlsProofServer, PEARLS_PROOF_SERVER } from './pearls-proof.server.ts';
import { closePearlsProofUi, PEARLS_PROOF_UI } from './pearls-proof.ui.ts';

export const PEARLS_PROOF_BUILT = true;

export const PEARLS_CHECKS: Readonly<Record<string, string>> = {
  P1: 'a new project\'s JSON has no sourceRanges key; stored fixtures and op logs replay; add-then-undo returns the stored JSON, also for a document imported with sourceRanges: {}; frame keys of 10 frames are equal before and after a pearl and a presence tag',
  P2: 'the three ops give equal revisions and events through REST, MCP and the editor; every refusal is worded in Hebrew and English',
  P3: 'viewer by keyboard: I at 30, O at 74, P, a name, Enter → one commit whose span is exactly [30/30, 75/30) s; Escape in the form closes the form only, the viewer stays open, focus is on «שמור כפנינה», nothing is committed',
  P4: 'transcript words 3–6 → the span is exactly first-word start to last-word end; verbatim is true; one letter changed → false',
  P5: '«הכנס במקום הסמן» is one transaction; stills at the clip\'s first and last frame read barcodes 30 and 74; one undo restores the hash; a word-aligned pearl is placed snapped outward',
  P6: 'usage equals the picture: the frames rangeUsage reports equal the frames whose barcode, read from each rendered frame, lies in [kLo, kHi) — forward, reversed, 2×, ramped and freeze clips, a span marked on 30 fps frames over the 29.97 file, and a word-edge span',
  P7: 'a trim changes the coverage to the exact new numbers; the other file\'s pearl is «לא בשימוש» in the list, the route and the tool',
  P8: 'the time-preserving copy counts as use of the original\'s pearl at the right offset; the untimed copy does not count and is named',
  P9: 'screen time on a built timeline (two tagged files, one untagged, a hidden track, two overlapping layers) equals hand-computed frames in the editor table, the route and the tool; the label is present in Hebrew and English',
  P10: 'privacy: a names agent reads names, no birth date, label "" and labelsHidden; a people "full" grant reads labels; people from any agent is 403 human_tag_required in a commit, a dry run, nested in apply_transaction and in propose_transaction; an agent\'s update or remove of a tagged range and remove_person of a tagged person are refused; a label from a names agent is 403 people_scope_required; the same add without people and label succeeds; assistantOps() holds none of the three ops; no run record holds a planted label after a film with pearls; the assistant summary (labelled MOCK adapter) holds no planted label',
  P11: 'a normal archive round-trips the ranges; «בלי פרטי משפחה» has no sourceRanges key and validates',
  P12: 'film: without picks.pearls the plan deep-equals the plan with every range removed; with prefer each file\'s first pearl is a pick whose first rendered frame is the barcode at sourceFrameOfTime(span.start); the file\'s second pearl is in pearl_left_out (one_per_file); a pearl longer than the longest span warns pearl_cut_short; apply is one undo; a pearl pick deleted by hand stays out on regenerate while its file stays in, and restoreRemoved returns it',
  P13: '«שורט מהפנינה»: without a transcript the short\'s first frame is the pearl\'s first source frame; with one the plan warns snapped_to_words and the excerpt contains the pearl; a 2-second pearl has the action disabled with its reason',
  P14: 'remove_asset takes its ranges and undo returns them; the owner\'s remove_person drops the tags, says the count, and undo returns them',
  P15: 'a hash of rangeUsage + screenTime over 20 fuzzed documents (Hebrew, Latin, names differing only in case) is equal in Node and in headless Chromium (window.__pfPearlsHash)',
  P16: 'recorded, not gated (one sample each): usage + screen time on 700 clips and 300 ranges; commit time with 2000 ranges',
};


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WEB = path.join(ROOT, 'apps/web/dist');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const integration: Record<string, unknown> = {};

/** P6 (export): the P6 film imported into a real server with its real files, exported, and every exported frame's barcode read. */
async function p6Export(): Promise<true | string> {
  if (!fs.existsSync(path.join(WEB, 'render.html'))) return 'BLOCKED: the web bundle is missing (`pnpm build`), so the P6 film could not be exported';
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pearls-p6x-'));
  const s = await startServer({ port: 18400 + Math.floor(Math.random() * 90), dataDir: path.join(base, 'data'), webDist: WEB, speechPython: null, voicePython: null, backupDir: null });
  try {
    const { film, files } = await p6Film(path.join(base, 'media'));
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
    const call = async (p: string, body?: unknown) => {
      const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
    };
    // the real files go into the server's blob store through an upload; the film's assets take the probed facts of those files
    const side = (await call('/projects', { name: 'P6 blobs', width: 320, height: 180 })).body.project.id as string;
    const facts: Record<string, Asset> = {};
    for (const [k, file] of Object.entries(files)) {
      const up = (await (await fetch(`${s.url}/api/v1/projects/${side}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: new Uint8Array(fs.readFileSync(file)) })).json()) as { assetId?: string };
      if (!up.assetId) return `upload of ${k} failed: ${JSON.stringify(up).slice(0, 200)}`;
      facts[k] = s.store.wholeProject(side).doc.assets[up.assetId]!;
    }
    const doc = structuredClone(film.doc) as ProjectDocument;
    for (const [k, id] of Object.entries(film.assets)) {
      const { id: _i, name: _n, provenance: _p, ...probed } = facts[k]!;
      doc.assets[id] = { ...doc.assets[id]!, ...probed } as Asset;
    }
    const issues = validateProject(doc);
    if (issues.length) return `the P6 film with the probed files is invalid: ${JSON.stringify(issues.slice(0, 3))}`;
    const pid = s.store.importProject({ ...doc, id: 'prj_pearls_p6x' }).doc.id;
    const job0 = (await call(`/projects/${pid}/exports`, {})).body;
    if (!job0?.jobId) return `the export did not start: ${JSON.stringify(job0).slice(0, 300)}`;
    let job: any;
    for (;;) { job = (await call(`/jobs/${job0.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(250); }
    if (job.status !== 'succeeded') return `the export ${job.status}: ${JSON.stringify(job.error).slice(0, 300)}`;
    const out = path.join(base, 'p6.mp4');
    fs.writeFileSync(out, (await call(`/jobs/${job.id}/output`)).body);
    const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
    const W = doc.settings.width, H = doc.settings.height, fb = W * H * 3;
    const read = Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H }));
    // which file each frame shows is the timeline's (the clip on V1 at that frame); the NUMBER is read off the exported picture
    const rate = doc.settings.frameRate;
    const shown = read.map((barcode, i) => {
      const layer = evaluate(doc, T.frameTime(i, rate)).layers.find((l) => l.kind === 'video') as { assetId: string; clipId: string } | undefined;
      return layer ? { assetId: layer.assetId, clipId: layer.clipId, barcode } : null;
    });
    const cmp = p6Compare({ ...film, doc }, shown);
    integration.P6export = { exportedFrames: read.length, ranges: cmp.rows, untimed: cmp.untimed };
    const bad = Object.entries(cmp.rows).filter(([, r]) => !r.equal || r.expected === 0);
    return bad.length ? `usage differs from the barcodes read off the export: ${JSON.stringify(bad).slice(0, 600)}` : true;
  } finally {
    await s.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/** P15 (Chromium against Node): window.__pfPearlsHash in the selftest page against core pearlsDigest, over pearlsDeterminismDocs(). */
async function p15Browser(): Promise<true | string> {
  if (!fs.existsSync(path.join(WEB, 'selftest.html'))) return 'BLOCKED: the web bundle is missing (`pnpm build`)';
  const docs = pearlsDeterminismDocs();
  const node = pearlsDigest(docs);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pearls-p15-'));
  const s = await startServer({ port: 18500 + Math.floor(Math.random() * 90), dataDir: path.join(base, 'data'), webDist: WEB, speechPython: null, voicePython: null, backupDir: null });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${s.url}/selftest.html`);
    await page.waitForFunction(() => typeof (window as unknown as { __pfPearlsHash?: unknown }).__pfPearlsHash === 'function', undefined, { timeout: 60000 });
    const got = await page.evaluate((d) => (window as unknown as { __pfPearlsHash: (x: unknown) => { core: string } }).__pfPearlsHash(d).core, docs);
    integration.P15browser = { documents: docs.length, node, chromium: got };
    return got === node ? true : `the digests differ: Node ${node}, Chromium ${got}`;
  } finally {
    await browser.close();
    await s.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parts: Record<string, { built: boolean; checks: Record<string, () => Promise<true | string>> }> = {
    core: PEARLS_PROOF_CORE, server: PEARLS_PROOF_SERVER, ui: PEARLS_PROOF_UI, integration: { built: true, checks: { P6: p6Export, P15: p15Browser } },
  };
  const pending = Object.entries(parts).filter(([, p]) => !p.built).map(([k]) => k);
  if (pending.length) {
    console.error(`pearls-proof: not built yet (parts pending: ${pending.join(', ')}); nothing was measured`);
    process.exit(2);
  }
  const results: { check: string; part: string; verdict: 'PASS' | 'BLOCKED' | 'FAIL'; seconds: number; reason?: string }[] = [];
  try {
    for (const id of Object.keys(PEARLS_CHECKS)) {
      for (const [name, part] of Object.entries(parts)) {
        const run = part.checks[id];
        if (!run) continue;
        const t0 = Date.now();
        let r: true | string;
        try { r = await run(); } catch (e) { r = `threw: ${String((e as Error)?.stack ?? e).slice(0, 600)}`; }
        const verdict = r === true ? 'PASS' : r.startsWith('BLOCKED') ? 'BLOCKED' : 'FAIL';
        const seconds = Math.round((Date.now() - t0) / 100) / 10;
        console.log(`${verdict} ${id} (${name}, ${seconds} s)${r === true ? '' : `: ${r}`}`);
        results.push({ check: id, part: name, verdict, seconds, ...(r === true ? {} : { reason: r.slice(0, 2000) }) });
      }
      if (!results.some((x) => x.check === id)) results.push({ check: id, part: 'none', verdict: 'FAIL', seconds: 0, reason: 'no part runs this check' });
    }
  } finally {
    await closePearlsProofServer();
    await closePearlsProofUi();
  }
  const count = (v: string) => results.filter((x) => x.verdict === v).length;
  const code = count('FAIL') ? 1 : count('BLOCKED') ? 2 : 0;
  const byCheck = Object.keys(PEARLS_CHECKS).map((id) => { const rs = results.filter((x) => x.check === id); return rs.some((x) => x.verdict === 'FAIL') ? 'FAIL' : rs.some((x) => x.verdict === 'BLOCKED') ? 'BLOCKED' : 'PASS'; });
  const checksPassed = byCheck.filter((v) => v === 'PASS').length;
  console.log(`pearls-proof: ${checksPassed}/${byCheck.length} checks pass (${count('PASS')} pass, ${count('BLOCKED')} blocked, ${count('FAIL')} fail of ${results.length} parts; exit ${code})`);
  const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'evidence', f), 'utf8')); } catch { return null; } };
  fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'pearls-proof.json'), JSON.stringify({
    when: new Date().toISOString(), exit: code, checksPassed, checks: byCheck.length, results,
    evidence: { core: PEARLS_PROOF_CORE.evidence, server: read('pearls-proof.server.json')?.evidence ?? null, ui: read('pearls-proof.ui.json')?.evidence ?? null, integration },
    note: 'SYNTHETIC fixtures only (made by the proof); timings are one sample each on a shared machine',
  }, null, 1) + '\n');
  process.exit(code);
}
