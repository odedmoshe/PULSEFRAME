/**
 * `pnpm proof:packs` — the end-to-end proof of the content packs (ADR-0022; plan §10 with the verifier's corrections), through
 * the real server on a CPU, with no model. Evidence: docs/evidence/packs-proof.json. Needs `pnpm build` (the render worker).
 *
 * What each check can fail for:
 * - P0: `git diff --stat <contracts commit>..<worker branch head> -- packages/engine` is empty for each of the three pack
 *   workers, read from the merge commits that brought them in (sibling tracks may touch the engine; they are not this track);
 * - P1: each of the eight pack templates (the seven new ones and tpl.birthday): plan → apply is ONE transaction; undo gives the
 *   pre-apply document back (hash), redo the applied one; with built-in music and every pack field given. Then a matrix: media
 *   counts 1, 3, 8, 12 × tempo normal, half, double × 24, 25, 30 frames a second: each plan either names what blocks it or
 *   applies, an apply after a clean plan never fails, and each undo is exact;
 * - P2: every pack element rasterises through the server at 1024 px with alpha, covering 2–90 % of its box, each picture its own;
 * - P3: each pack look at its defaults over a bright and a dark still for 10 s each, exported: the flash analyser of the
 *   engine reports no range;
 * - P5: one pack project (a Hanukkah template with its music): the server still and the exported H.264 frame agree at 5 sampled
 *   frames within the parity suite's export bound (PSNR ≥ 36 dB against the still as 4:2:0 can hold it). The editor's preview
 *   canvas is NOT measured here (the same evaluate is measured against stills by proof:lifeline check 5); the evidence says so;
 * - P10: check:notices passes and lists the six title families; the size of their font files in the bundle is recorded;
 * - P11: GET /packs/suggest: 2026-11-17 → Hanukkah first, 17 days to the evening of 4 December; 2027-01-05 → none;
 * - P12: an element and a sound added from a pack, placed: one undo removes the clip, and the file stays in the library;
 * - P13: no two titles of a pack template overlap on screen at its defaults, with the stills' fields and with none (the fallback
 *   words), at 1080 x 1920 (what packs:sheet draws) and in the shape it is designed for. Measured from the pixels of the still
 *   route: a title's box is what changes when that title alone is hidden (titleBoxes.ts), at the middle of each title, with the
 *   titles at rest (motion none). Control: the same measurement on tpl.birthday-invite with its name title moved onto the
 *   invitation title must find the overlap;
 * - P14: in every applied pack template (P1), no graphic element and no title lies under a look (track order: every adjustment
 *   track is drawn over the tracks below it).
 * Expected strings and ids are typed in this file, never computed by the code under test.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { FlashAnalyser, flashCells } from '@pulseframe/engine';
import { startServer } from '@pulseframe/server';
import { diffBox, overlappingPairs, type Box } from './titleBoxes.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/packs-proof');
const evidence = path.join(root, 'docs/evidence/packs-proof.json');
const PORT = 8891;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const measurements: Record<string, unknown> = {};
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 600)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');

// ---------- typed expectations ----------
const CONTRACTS_COMMIT = '4407d31';
const WORKER_MERGES = ['3af402d', 'c777108', '5861d23']; // Merge branch 'wt/pk1' / 'wt/pk2' / 'wt/pk3'
const TEMPLATE_IDS = ['tpl.hanukkah-candles', 'tpl.hanukkah-eight-nights', 'tpl.hanukkah-party', 'tpl.hanukkah-greeting', 'tpl.birthday-age', 'tpl.birthday-cake', 'tpl.birthday-invite', 'tpl.birthday'];
const MUSIC_OF: Record<string, string> = { 'tpl.birthday': 'music.birthday' }; // the others name their own (catalog → templates); tpl.birthday has none of its own
const FIELDS = { name: 'נועה', name2: 'דניאל', age: '7', night: '3', place: 'הגינה של סבא', when: 'שישי בארבע', date: '2026-12-06' };
const PACK_IDS = ['pack.hanukkah', 'pack.birthday'];
const ELEMENT_COUNT = 50;
const LOOK_COUNT = 6;
const TITLE_FAMILIES = ['Suez One', 'David Libre', 'Karantina', 'Amatic SC', 'Fredoka', 'Gveret Levin'];
const FONT_FILE_PREFIXES = ['suez-one', 'david-libre', 'karantina', 'amatic-sc', 'fredoka', 'gveret-levin'];
const HANUKKAH_REASON_HE = 'חנוכה מתחיל בערב 4 בדצמבר · בעוד 17 ימים';
const PARITY_PSNR = 36; // packages/evals/src/parity-suite.ts TH.psnr (export against the still)

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  const t0 = Date.now();
  const lap = (what: string) => console.log(`  … ${what} (${Math.round((Date.now() - t0) / 1000)} s)`);

  // ---------------------------------------------------------------- P0
  console.log('\n# P0 the pack workers did not touch the engine');
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  // What each worker merge brought in: the merge against its first parent (the branch before it). A diff from the contracts
  // commit to the worker's head would also count sibling tracks merged into the base the worker started from.
  const p0 = WORKER_MERGES.map((m) => ({ merge: m, workerHead: git(['rev-parse', `${m}^2`]).slice(0, 12), workerCommits: Number(git(['rev-list', '--count', `${m}^1..${m}^2`])), contractsIsAncestor: (() => { try { git(['merge-base', '--is-ancestor', CONTRACTS_COMMIT, `${m}^2`]); return true; } catch { return false; } })(), engineDiff: git(['diff', '--stat', `${m}^1`, m, '--', 'packages/engine']) }));
  check('P0 each pack worker merge (worker branch built on the contracts) brought no change under packages/engine', p0.every((x) => x.contractsIsAncestor && x.workerCommits > 0 && x.engineDiff === ''), p0);

  // ---------------------------------------------------------------- fixtures
  const still = (name: string, src: string, s = '1080x1920') => { const f = path.join(art, name); ff(['-f', 'lavfi', '-i', `${src}=s=${s}`, '-frames:v', '1', f]); return f; };
  const video = (name: string, src: string) => { const f = path.join(art, name); ff(['-f', 'lavfi', '-t', '8', '-i', `${src}=s=540x960:r=30`, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', f]); return f; };
  const stills = [still('s0.png', 'testsrc2'), still('s1.png', 'smptebars'), still('s2.png', 'rgbtestsrc'), still('s3.png', 'mandelbrot')];
  const videos = [video('v0.mp4', 'mandelbrot'), video('v1.mp4', 'testsrc2')];

  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => { const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) }); const b = (await r.json()) as any; if (!b.assetId) throw new Error(`upload failed: ${JSON.stringify(b).slice(0, 300)}`); return b.assetId as string; };
  const getDoc = async (pid: string) => (await call(`/projects/${pid}`)).body as { project: any; revision: number };
  const hashOf = async (pid: string) => sha(JSON.stringify((await getDoc(pid)).project));
  const newProject = async (name: string, rate: { num: number; den: number }, w = 540, hh = 960) => (await call('/projects', { name, width: w, height: hh, frameRate: rate })).body.project.id as string;
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(250); } };
  const exportMp4 = async (pid: string, name: string) => {
    const started = await call(`/projects/${pid}/exports`, {});
    if (started.status !== 202 && started.status !== 200) throw new Error(`export refused: ${JSON.stringify(started.body).slice(0, 400)}`);
    const job = await waitJob(started.body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    return file;
  };
  const undo = (pid: string) => call(`/projects/${pid}/undo`, {});
  const redo = (pid: string) => call(`/projects/${pid}/redo`, {});

  try {
    const catalog = (await call('/catalog')).body;
    const tplRows = new Map<string, any>((catalog.templates as any[]).map((t) => [t.id, t]));
    const packs = (await call('/packs')).body.packs as any[];
    check('GET /packs lists the two packs; together they name the eight templates', JSON.stringify(packs.map((p) => p.id)) === JSON.stringify(PACK_IDS) && JSON.stringify(packs.flatMap((p) => p.templateIds).sort()) === JSON.stringify([...TEMPLATE_IDS].sort()), { packs: packs.map((p) => [p.id, p.templateIds]) });

    // ---------------------------------------------------------------- P1
    console.log('\n# P1 each pack template: one transaction, exact undo and redo, with built-in music and every field');
    const fixtures: Record<number, { pid: string; media: string[] }> = {};
    for (const rate of [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30, den: 1 }]) {
      const pid = await newProject(`packs-${rate.num}`, rate);
      const media: string[] = [];
      for (const f of [...stills, ...videos]) media.push(await upload(pid, f));
      fixtures[rate.num] = { pid, media };
    }
    const mediaOf = (m: string[], n: number) => Array.from({ length: n }, (_, i) => m[i % m.length]!);
    const p1: Record<string, unknown> = {};
    /** P14: the graphic elements (pictures made from an element) and titles of the main sequence that lie under an adjustment track. */
    const underLook: Record<string, string[]> = {};
    const coveredByLook = (doc: any): string[] => {
      const tracks = doc.sequences[doc.mainSequenceId].tracks as any[];
      const top = tracks.reduce((m: number, t: any, i: number) => (t.kind === 'adjustment' && t.clips.length ? i : m), -1);
      return tracks.flatMap((t: any, i: number) => (i >= top ? [] : t.clips.filter((c: any) => c.type === 'text' || (c.type === 'media' && String(doc.assets[c.assetId]?.provenance?.procedural?.id ?? '').startsWith('element.'))).map((c: any) => `${c.type} ${c.id} (track ${i}, look on track ${top})`)));
    };
    let musicPid = '', musicTemplate = '';
    for (const id of TEMPLATE_IDS) {
      const { pid, media } = fixtures[30]!;
      const style = tplRows.get(id)?.builtinMusic ?? MUSIC_OF[id] ?? null;
      const params = { media: mediaOf(media, 6), musicAssetId: null, builtinMusic: { styleId: style, seed: 2 }, fields: FIELDS, lang: 'he' };
      const plan = await call(`/projects/${pid}/templates/${id}/plan`, { params });
      const before = await hashOf(pid), rev0 = (await getDoc(pid)).revision;
      const applied = await call(`/projects/${pid}/templates/${id}/apply`, { params, expectedRevision: plan.body.revision });
      const after = await getDoc(pid);
      const appliedHash = sha(JSON.stringify(after.project));
      const music = Object.values(after.project.assets).find((a: any) => a.provenance?.procedural?.id === style) as any;
      const u = await undo(pid);
      const undone = await hashOf(pid);
      const r = await redo(pid);
      const redone = await hashOf(pid);
      const row = { style, plan: plan.status, blocking: plan.body.blocking?.length ?? null, apply: applied.status, oneTransaction: after.revision === rev0 + 1, music: !!music, undo: u.status, undoExact: undone === before, redo: r.status, redoExact: redone === appliedHash };
      p1[id] = row;
      underLook[id] = coveredByLook(after.project);
      check(`P1 ${id}: plan clean, apply is one transaction with its built-in music (${style}), undo gives the previous document, redo the applied one`, !!style && plan.status === 200 && row.blocking === 0 && applied.status === 200 && row.oneTransaction && row.music && u.status === 200 && row.undoExact && r.status === 200 && row.redoExact, row);
      if (id === 'tpl.hanukkah-candles' && applied.status === 200) { musicPid = pid; musicTemplate = id; }
      if (r.status === 200) await undo(pid); // leave the fixture project as it was for the next template
    }
    measurements.p1 = p1;
    measurements.underLook = underLook;
    check('P14 in every applied pack template no graphic element and no title lies under a look', TEMPLATE_IDS.every((id) => Array.isArray(underLook[id]) && underLook[id]!.length === 0), underLook);
    lap('P1 templates');

    console.log('\n# P1 matrix: media 1, 3, 8, 12 × tempo × 24, 25, 30 fps');
    const matrix: { rate: number; id: string; n: number; tempo: string; outcome: string }[] = [];
    for (const rate of [24, 25, 30]) for (const id of TEMPLATE_IDS) for (const n of [1, 3, 8, 12]) for (const tempo of ['normal', 'half', 'double']) {
      const { pid, media } = fixtures[rate]!;
      const params = { media: mediaOf(media, n), musicAssetId: null, fields: FIELDS, tempo, lang: 'he' };
      const plan = await call(`/projects/${pid}/templates/${id}/plan`, { params });
      if (plan.status !== 200) { matrix.push({ rate, id, n, tempo, outcome: `plan refused ${plan.status} ${plan.body?.error?.code}` }); continue; }
      if (plan.body.blocking?.length) { matrix.push({ rate, id, n, tempo, outcome: `blocked: ${plan.body.blocking.map((b: any) => b.code).join(',')}` }); continue; }
      const before = await hashOf(pid);
      const a = await call(`/projects/${pid}/templates/${id}/apply`, { params, expectedRevision: plan.body.revision });
      if (a.status !== 200) { matrix.push({ rate, id, n, tempo, outcome: `APPLY FAILED ${a.status} ${a.body?.error?.code}: ${String(a.body?.error?.message).slice(0, 120)}` }); continue; }
      const u = await undo(pid);
      matrix.push({ rate, id, n, tempo, outcome: u.status === 200 && (await hashOf(pid)) === before ? 'applied, undo exact' : `UNDO NOT EXACT ${u.status}` });
    }
    const bad = matrix.filter((m) => /FAILED|NOT EXACT|plan refused/.test(m.outcome));
    measurements.matrix = { runs: matrix.length, applied: matrix.filter((m) => m.outcome.startsWith('applied')).length, blocked: matrix.filter((m) => m.outcome.startsWith('blocked')).length, failures: bad };
    check(`P1 matrix (${matrix.length} runs): every plan answers, every apply after a clean plan works, every undo is exact`, matrix.length === 288 && bad.length === 0, measurements.matrix);
    lap('P1 matrix');

    // ---------------------------------------------------------------- P2
    console.log('\n# P2 every pack element rasterises');
    const elementIds = [...new Set(packs.flatMap((p) => p.elementIds as string[]))];
    const epid = await newProject('packs-elements', { num: 30, den: 1 });
    const els: { id: string; w: number; hh: number; coverage: number; hash: string; ok: boolean }[] = [];
    for (const id of elementIds) {
      const r = await call(`/projects/${epid}/elements`, { elementId: id });
      if (r.status !== 201) { els.push({ id, w: 0, hh: 0, coverage: 0, hash: `refused ${r.status} ${r.body?.error?.code}`, ok: false }); continue; }
      const asset = (await getDoc(epid)).project.assets[r.body.assetId];
      const png = (await call(`/projects/${epid}/assets/${r.body.assetId}/content`)).body as Buffer;
      const rgba = ff(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], png);
      const w = asset.image.width, hh = asset.image.height;
      let covered = 0;
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! > 8) covered++; // visible: alpha above 8 of 255, as packs:sheet counts
      const coverage = covered / (w * hh);
      els.push({ id, w, hh, coverage: Number(coverage.toFixed(4)), hash: sha(rgba), ok: Math.max(w, hh) === 1024 && asset.image.hasAlpha === true && coverage >= 0.02 && coverage <= 0.9 });
    }
    const dup = els.filter((e, i) => els.findIndex((x) => x.hash === e.hash) !== i).map((e) => e.id);
    measurements.elements = els;
    check(`P2 all ${ELEMENT_COUNT} pack elements rasterise at 1024 px with alpha, cover 2–90 % of their box, each its own picture`, els.length === ELEMENT_COUNT && els.every((e) => e.ok) && dup.length === 0, { count: els.length, failing: els.filter((e) => !e.ok), duplicates: dup });
    lap('P2 elements');

    // ---------------------------------------------------------------- P3
    console.log('\n# P3 each pack look over a bright and a dark still, 10 s each: no flashing');
    const LW = 270, LH = 480, LR = { num: 30, den: 1 };
    const bright = still('bright.png', 'testsrc2', '540x960'), dark = path.join(art, 'dark.png');
    ff(['-f', 'lavfi', '-i', 'mandelbrot=s=540x960', '-frames:v', '1', '-vf', 'eq=brightness=-0.3', dark]);
    const looks = packs.flatMap((p) => p.looks as any[]);
    const p3: Record<string, unknown> = {};
    for (const look of looks) {
      const pid = await newProject(`look-${look.id}`, LR, LW, LH);
      const [b, d] = [await upload(pid, bright), await upload(pid, dark)];
      await txs(pid, [{ op: 'add_clip', args: { assetId: b, start: T.ZERO, duration: T.rt(10, 1) } }, { op: 'add_clip', args: { assetId: d, start: T.rt(10, 1), duration: T.rt(10, 1) } }]);
      await txs(pid, [{ op: 'add_adjustment', args: { span: 'edit', effects: look.effects.map((e: any) => ({ type: e.type, ...(e.params ? { params: e.params } : {}) })), label: look.name.he } }]);
      const file = await exportMp4(pid, `look-${look.id}.mp4`);
      const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
      const fb = LW * LH * 4, frames = raw.length / fb;
      const a = new FlashAnalyser(30);
      for (let i = 0; i < frames; i++) a.push(flashCells(raw.subarray(i * fb, (i + 1) * fb), LW, LH));
      const rep = a.report();
      p3[look.id] = { frames, verdict: rep.verdict, ranges: rep.ranges.length, peak: a.peak() };
      check(`P3 ${look.id} (${look.name.he}): ${frames} frames over a bright and a dark still, the flash analyser reports no range`, frames === 600 && rep.ranges.length === 0, p3[look.id]);
    }
    check(`P3 the packs hold ${LOOK_COUNT} looks and each was measured`, looks.length === LOOK_COUNT, { looks: looks.map((l) => l.id) });
    measurements.looks = p3;
    lap('P3 looks');

    // ---------------------------------------------------------------- P5
    console.log('\n# P5 a pack project: the server still and the exported frame agree');
    const W = 540, H = 960;
    let p5: unknown = null;
    if (musicPid) {
      const { media } = fixtures[30]!;
      const pid = await newProject('packs-parity', { num: 30, den: 1 });
      const own: string[] = [];
      for (const f of [...stills, ...videos]) own.push(await upload(pid, f));
      const params = { media: mediaOf(own, 6), musicAssetId: null, builtinMusic: { styleId: tplRows.get(musicTemplate)?.builtinMusic, seed: 2 }, fields: FIELDS, lang: 'he' };
      const ap = await call(`/projects/${pid}/templates/${musicTemplate}/apply`, { params });
      void media;
      if (ap.status === 200) {
        const file = await exportMp4(pid, 'parity.mp4');
        const raw = ff(['-i', file, '-vf', 'scale=in_color_matrix=bt709:in_range=limited:out_range=full', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        const total = raw.length / (W * H * 3);
        const picks = [0, Math.floor(total * 0.25), Math.floor(total * 0.5), Math.floor(total * 0.75), total - 1];
        const rows: { frame: number; psnr: number }[] = [];
        for (const n of picks) {
          const png = (await call(`/projects/${pid}/frame?index=${n}`)).body as Buffer;
          const ref = ff(['-i', 'pipe:0', '-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuv420p,scale=in_color_matrix=bt709:in_range=limited:out_range=full', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], png);
          const test = raw.subarray(n * W * H * 3, (n + 1) * W * H * 3);
          let se = 0;
          for (let i = 0, j = 0; i < ref.length; i += 4, j += 3) for (let c = 0; c < 3; c++) { const dd = ref[i + c]! - test[j + c]!; se += dd * dd; }
          const mse = se / (W * H * 3);
          rows.push({ frame: n, psnr: Number((mse === 0 ? 99 : Math.min(99, 10 * Math.log10((255 * 255) / mse))).toFixed(2)) });
        }
        p5 = { template: musicTemplate, frames: total, rows, previewCanvas: 'not measured here (the same evaluate against stills: proof:lifeline check 5)' };
        check(`P5 ${musicTemplate}: at 5 sampled frames the exported H.264 frame is within ${PARITY_PSNR} dB PSNR of the server still (as 4:2:0 holds it)`, rows.length === 5 && rows.every((x) => x.psnr >= PARITY_PSNR), p5);
      } else check(`P5 ${musicTemplate} applies for the parity project`, false, ap.body);
    } else check('P5 a Hanukkah template with its music applied in P1, for the parity project', false);
    measurements.parity = p5;
    lap('P5 parity');

    // ---------------------------------------------------------------- P13
    console.log('\n# P13 no two titles of a pack template overlap at its defaults');
    {
      const rgba = (png: Buffer) => new Uint8Array(ff(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], png));
      const grey = path.join(art, 'grey.png');
      ff(['-f', 'lavfi', '-i', 'color=c=0x5a5a5a:s=1080x1920', '-frames:v', '1', grey]);
      const frame = async (pid: string, n: number) => { const r = await call(`/projects/${pid}/frame?index=${n}`); if (r.status !== 200) throw new Error(`still refused ${r.status}`); return rgba(r.body as Buffer); };
      /** The title boxes at the middle of each title, and the pairs that overlap. */
      const measure = async (pid: string, w: number, hh: number, textIds: Map<string, string>) => {
        const doc = (await getDoc(pid)).project;
        const clips = new Map<string, any>(Object.values(doc.sequences).flatMap((q: any) => q.tracks.flatMap((t: any) => t.clips)).map((c: any) => [c.id, c]));
        const fr = (t: any) => Math.round((Number(t.value) / t.timescale) * 30);
        const span = (id: string) => { const c = clips.get(id); return [fr(c.start), fr(c.start) + fr(c.duration)] as const; };
        const moments: { at: number; boxes: { key: string; box: Box }[]; overlaps: [string, string, Box][] }[] = [];
        const keys = [...textIds.keys()];
        for (const key of keys) {
          const [a, b] = span(textIds.get(key)!);
          const at = Math.floor((a + b) / 2);
          const visible = keys.filter((k) => { const [x, y] = span(textIds.get(k)!); return x <= at && at < y; });
          if (visible.length < 2 || moments.some((m) => m.boxes.length === visible.length && visible.every((v) => m.boxes.some((x) => x.key === v)))) continue;
          const all = await frame(pid, at);
          const boxes: { key: string; box: Box }[] = [];
          for (const v of visible) {
            await txs(pid, [{ op: 'set_clip_transform', args: { clipId: textIds.get(v), transform: { opacity: 0 } } }]);
            const without = await frame(pid, at);
            await undo(pid);
            const box = diffBox(all, without, w, hh);
            if (box) boxes.push({ key: v, box });
          }
          moments.push({ at, boxes, overlaps: overlappingPairs(boxes) });
        }
        return moments;
      };
      const SHAPES: Record<string, [number, number]> = { tall: [1080, 1920], square: [1080, 1080], wide: [1920, 1080] };
      const rows: { id: string; shape: string; fields: string; moments: number; overlaps: unknown[] }[] = [];
      for (const id of TEMPLATE_IDS) {
        const def = tplRows.get(id);
        const shapes = [...new Set(['tall', def?.designedFor ?? 'tall'])];
        for (const shape of shapes) for (const [fname, fields] of [['stills', FIELDS], ['none', undefined]] as const) {
          const [w, hh] = SHAPES[shape]!;
          const pid = await newProject(`p13-${id}-${shape}-${fname}`, { num: 30, den: 1 }, w, hh);
          const g = await upload(pid, grey);
          const ap = await call(`/projects/${pid}/templates/${id}/apply`, { params: { media: Array.from({ length: 8 }, () => g), musicAssetId: null, lang: 'he', motion: 'none', ...(fields ? { fields } : {}) } });
          if (ap.status !== 200) { rows.push({ id, shape, fields: fname, moments: 0, overlaps: [`apply ${ap.status} ${ap.body?.error?.code}`] }); continue; }
          const textIds = new Map<string, string>((ap.body.slots as any[]).filter((x) => x.kind === 'text').map((x) => [x.key, x.clipId]));
          const moments = await measure(pid, w, hh, textIds);
          rows.push({ id, shape, fields: fname, moments: moments.length, overlaps: moments.flatMap((m) => m.overlaps.map(([a, b, box]) => ({ at: m.at, a, b, box }))) });
          if (id === 'tpl.birthday-invite' && shape === 'tall' && fname === 'stills') {
            // control: the name title moved onto the invitation title must be found
            const inv = (await getDoc(pid)).project;
            const clipOf = (k: string) => Object.values(inv.sequences).flatMap((q: any) => q.tracks.flatMap((t: any) => t.clips)).find((c: any) => c.id === textIds.get(k)) as any;
            await txs(pid, [{ op: 'set_clip_transform', args: { clipId: textIds.get('name'), transform: { x: clipOf('invite').transform.x, y: clipOf('invite').transform.y } } }]);
            const moved = await measure(pid, w, hh, textIds);
            const found = moved.flatMap((m) => m.overlaps).some(([a, b]) => [a, b].includes('name') && [a, b].includes('invite'));
            measurements.titleOverlapControl = { moved: 'name onto invite', found, moments: moved.map((m) => ({ at: m.at, overlaps: m.overlaps })) };
            check('P13 control: tpl.birthday-invite with its name title moved onto the invitation title: the measurement finds the overlap', found, measurements.titleOverlapControl);
          }
        }
      }
      measurements.titleOverlap = rows;
      check(`P13 no two titles overlap on screen in any pack template at its defaults (${rows.length} cases: 1080 x 1920 and the designed shape, the stills' fields and none)`, rows.length > 0 && rows.every((r) => r.overlaps.length === 0) && rows.some((r) => r.moments > 0), rows.filter((r) => r.overlaps.length));
      lap('P13 title boxes');
    }

    // ---------------------------------------------------------------- P10
    console.log('\n# P10 notices and the bundle');
    let notices = '', noticesOk = false;
    try { notices = execFileSync('pnpm', ['-s', 'check:notices'], { cwd: root, encoding: 'utf8' }); noticesOk = true; } catch (e: any) { notices = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
    // check:notices prints a summary; what it checked is the notices file of the bundle: each title family's package with its licence text
    const noticeFile = path.join(root, 'apps/web/dist/THIRD_PARTY_NOTICES.txt');
    const noticeText = fs.existsSync(noticeFile) ? fs.readFileSync(noticeFile, 'utf8') : '';
    const listed = TITLE_FAMILIES.filter((_, i) => new RegExp(`^@fontsource/${FONT_FILE_PREFIXES[i]} 5\\.3\\.0$`, 'm').test(noticeText));
    const assets = path.join(root, 'apps/web/dist/assets');
    const files = fs.readdirSync(assets).filter((f) => FONT_FILE_PREFIXES.some((p) => f.startsWith(`${p}-`)) && /\.woff2?$/.test(f));
    const bytes = (ext: string) => files.filter((f) => f.endsWith(ext)).reduce((n, f) => n + fs.statSync(path.join(assets, f)).size, 0);
    measurements.notices = { ok: noticesOk, familiesListed: listed, oflTexts: (noticeText.match(/SIL OPEN FONT LICENSE/g) ?? []).length, bundle: { files: files.length, woff2Bytes: bytes('.woff2'), woffBytes: bytes('.woff'), totalBytes: bytes('.woff2') + bytes('.woff') }, output: notices.slice(-1500) };
    check('P10 check:notices passes, and the bundle\'s THIRD_PARTY_NOTICES.txt holds each title family\'s @fontsource package (5.3.0) with its licence', noticesOk && listed.length === TITLE_FAMILIES.length, { ok: noticesOk, listed, missing: TITLE_FAMILIES.filter((f) => !listed.includes(f)) });

    // ---------------------------------------------------------------- P11
    console.log('\n# P11 suggestions by the day');
    const a = await call('/packs/suggest?date=2026-11-17'), b = await call('/packs/suggest?date=2027-01-05');
    const first = a.body.suggestions?.[0];
    check('P11 on 2026-11-17 Hanukkah is suggested first, 17 days to the evening of 4 December', a.status === 200 && first?.packId === 'pack.hanukkah' && first?.daysAway === 17 && first?.reason?.he === HANUKKAH_REASON_HE && first?.firstDay?.y === 2026 && first?.firstDay?.m === 12 && first?.firstDay?.d === 5, first);
    check('P11 on 2027-01-05 nothing is suggested', b.status === 200 && Array.isArray(b.body.suggestions) && b.body.suggestions.length === 0, b.body);

    // ---------------------------------------------------------------- P12
    console.log('\n# P12 an element and a sound from a pack: one undo removes the clip, the file stays');
    const pid12 = await newProject('packs-add', { num: 30, den: 1 });
    const hanukkah = packs.find((p) => p.id === 'pack.hanukkah');
    const rows12: Record<string, unknown> = {};
    for (const [what, route, body] of [['element', 'elements', { elementId: hanukkah.elementIds[0], start: T.ZERO }], ['sound', 'sfx', { sfxId: hanukkah.sfxIds[0], start: T.ZERO }]] as const) {
      const r = await call(`/projects/${pid12}/${route}`, body);
      const placed = (await getDoc(pid12)).project;
      const clipsOf = (d: any) => Object.values(d.sequences).flatMap((q: any) => q.tracks.flatMap((t: any) => t.clips)).filter((c: any) => c.assetId === r.body.assetId);
      const u = await undo(pid12);
      const after = (await getDoc(pid12)).project;
      rows12[what] = { status: r.status, clipsBefore: clipsOf(placed).length, undo: u.status, clipsAfter: clipsOf(after).length, assetStays: !!after.assets[r.body.assetId] };
      check(`P12 a ${what} from the Hanukkah pack, placed: one undo removes its clip and the file stays in the library`, r.status === 201 && clipsOf(placed).length === 1 && u.status === 200 && clipsOf(after).length === 0 && !!after.assets[r.body.assetId], rows12[what]);
    }
    measurements.addFromPack = rows12;
  } finally {
    await s.close?.();
  }

  const ok = checks.every((c) => c.ok);
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, JSON.stringify({ proof: 'packs', when: new Date().toISOString(), node: process.version, platform: `${process.platform} ${process.arch}`, ok, checks, measurements }, null, 1) + '\n');
  console.log(`\nproof:packs ${ok ? 'passed' : 'FAILED'}: ${checks.filter((c) => c.ok).length}/${checks.length} checks; evidence ${path.relative(root, evidence)}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
