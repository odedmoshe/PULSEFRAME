/**
 * Owner-facing editor controls, driven in a real browser: agent access (create a grant, the token works with exactly the
 * granted mode, revoke), project manager (list, create, delete with typed confirmation, storage check), audio crossfade
 * control, loop playback.   pnpm build && pnpm proof:owner-ui
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/owner-ui');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const tone = path.join(art, 'tone.wav');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=8', '-ac', '2', '-c:a', 'pcm_s16le', tone]);
  const s = await startServer({ port: 8807, dataDir: path.join(art, 'data'), backupDir: path.join(art, 'backup'), backupEveryHours: 24, backupKeep: 3 });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown, headers: Record<string, string> = h) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { connection: 'close', ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const browser = await chromium.launch();
  try {
    const pid = (await call('/projects', { name: 'ראשי', width: 640, height: 360 })).body.project.id;
    const other = (await call('/projects', { name: 'למחיקה', width: 640, height: 360 })).body.project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'tone.wav' }, body: fs.readFileSync(tone) })).json();
    const c0 = (await txs(pid, [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0), duration: f(30) } }])).results[0].output;
    const left = c0.audioClipId ?? c0.clipId;
    const right = (await txs(pid, [{ op: 'split_clip', args: { clipId: left, at: f(15) } }])).results[0].output.rightClipId;
    const doc = async () => (await call(`/projects/${pid}`)).body.project;
    const clipOf = (d: any, id: string) => d.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    const until = async (pred: () => Promise<boolean>, ms = 10000) => { const t = Date.now(); for (;;) { if (await pred()) return true; if (Date.now() - t > ms) return false; await sleep(100); } };

    const page = await (await browser.newContext({ viewport: { width: 1500, height: 3400 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('access-panel').waitFor();

    console.log('\n# agent access');
    await page.getByTestId('grant-name').fill('עוזר עריכה');
    const modeDefault = await page.getByTestId('grant-mode').inputValue();
    await page.getByTestId('grant-create').click();
    await page.getByTestId('grant-token').waitFor();
    const token = await page.getByTestId('grant-token').inputValue();
    const endpoint = await page.getByTestId('grant-endpoint').textContent();
    const bearer = { authorization: `Bearer ${token}` };
    const seen = await call('/projects', undefined, bearer);
    const attempt = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'rename_project', args: { name: 'x' } }] }, bearer);
    const unchanged = (await doc()).name === 'ראשי';
    const outside = await call(`/projects/${other}`, undefined, bearer);
    check('creating a grant in the editor shows its token once with the MCP endpoint; the default mode is "propose"; the token sees only this project, cannot commit an edit directly, and cannot read another project', /^pfg_/.test(token) && modeDefault === 'propose' && /\/mcp/.test(endpoint ?? '') && seen.status === 200 && seen.body.projects.length === 1 && seen.body.projects[0].id === pid && unchanged && outside.status === 403, { mode: modeDefault, directCommit: attempt.status, committed: attempt.body?.committed ?? null, proposal: !!attempt.body?.proposal || !!attempt.body?.proposalId });
    await page.getByTestId('grant-token-dismiss').click();
    const tokenGone = (await page.getByTestId('grant-token').count()) === 0;
    await page.locator('[data-testid=grant-row]').first().getByTestId('grant-revoke').click();
    const revoked = await until(async () => (await call('/projects', undefined, bearer)).status === 401);
    check('after dismissing, the token is no longer shown; revoking the grant in the editor stops the token immediately', tokenGone && revoked);
    await page.getByTestId('grant-name').fill('limited');
    await page.getByTestId('grant-rpm').fill('12');
    await page.getByTestId('grant-epd').fill('3');
    await page.getByTestId('grant-create').click();
    await page.getByTestId('grant-token').waitFor();
    const slow = { authorization: `Bearer ${await page.getByTestId('grant-token').inputValue()}` };
    const rpmShown = await page.getByTestId('grant-rpm-shown').textContent();
    const epdShown = await page.getByTestId('grant-epd-shown').textContent();
    const burst = [(await call('/projects', undefined, slow)).status, (await call('/projects', undefined, slow)).status, (await call('/projects', undefined, slow)).status];
    await page.getByTestId('grant-token-dismiss').click();
    check('a grant created with "requests per minute" 12 and "exports per 24 hours" 3 shows both limits in the list, and its token is answered 429 on the third request in a row (two allowed at once)', rpmShown === '12' && epdShown === '3' && JSON.stringify(burst) === '[200,200,429]', { rpmShown, epdShown, burst });

    console.log('\n# crossfade control and loop playback');
    await page.locator(`.clip[data-clip-id="${right}"]`).click();
    await page.getByTestId('sound-crossfade').fill('0.2');
    await page.getByTestId('sound-crossfade-apply').click();
    const xf = await until(async () => { const d = await doc(); return !!clipOf(d, right).fadeIn && !!clipOf(d, left).fadeOut; });
    const d1 = await doc();
    check('the crossfade control fades the selected clip in from the clip before it (0.2 s = 6 frames on both sides, earlier clip extended)', xf && T.frameIndexAt(clipOf(d1, right).fadeIn, R) === 6 && T.frameIndexAt(clipOf(d1, left).fadeOut, R) === 6 && T.frameIndexAt(clipOf(d1, left).duration, R) === 21, { leftFrames: T.frameIndexAt(clipOf(d1, left).duration, R) });
    await page.getByTestId('loop').click();
    const pressed = await page.getByTestId('loop').getAttribute('aria-pressed');
    await page.getByTestId('play').click();
    await page.waitForFunction(() => (window as any).__pfSync?.().loops >= 2, undefined, { timeout: 30000 }).catch(async () => console.log('  loop wait timed out:', JSON.stringify(await page.evaluate(() => { const y = (window as any).__pfSync?.(); return { loops: y?.loops, framesPainted: y?.framesPainted, clock: y?.clock, playing: document.querySelector('[data-testid=play]')?.getAttribute('data-playing'), loopPressed: document.querySelector('[data-testid=loop]')?.getAttribute('aria-pressed'), timecode: document.querySelector('[data-testid=timecode]')?.textContent, active: (document.activeElement as HTMLElement)?.dataset?.testid }; }))));
    const stillPlaying = (await page.getByTestId('play').getAttribute('aria-label')) !== null && (await page.evaluate(() => (window as any).__pfSync().loops)) >= 2;
    await page.getByTestId('loop').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'false', undefined, { timeout: 20000 });
    check('loop playback: with loop on, a 1-second timeline wraps around at least twice and keeps playing; turning loop off lets it stop at the end', pressed === 'true' && stillPlaying, { loops: await page.evaluate(() => (window as any).__pfSync().loops) });

    console.log('\n# project manager');
    await page.getByTestId('projects-open').click();
    await page.getByTestId('projects-dialog').waitFor();
    const rows0 = await page.getByTestId('project-row').count();
    const row = page.locator(`[data-testid=project-row][data-project-id="${other}"]`);
    await row.getByTestId('project-delete').click();
    await page.getByTestId('project-delete-confirm').fill('למחיק');
    const blocked = await page.getByTestId('project-delete-apply').isDisabled();
    await page.getByTestId('project-delete-confirm').fill('למחיקה');
    await page.getByTestId('project-delete-apply').click();
    const gone = await until(async () => (await call(`/projects/${other}`)).status === 404);
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid=project-row]').length === n - 1, rows0);
    // automatic backup panel: the first scheduled run has happened (no snapshot existed), "Back up now" adds a second one
    await page.getByTestId('backup-snapshots').waitFor();
    const backupShown = await until(async () => fs.existsSync(path.join(art, 'backup', 'snapshots')) && fs.readdirSync(path.join(art, 'backup', 'snapshots')).length === 1, 5000); // the first scheduled run (the panel may have loaded before it finished)
    await sleep(1100); // snapshot names have one-second resolution
    await page.getByTestId('backup-now').click();
    const backupTwo = await until(async () => (await page.getByTestId('backup-snapshots').textContent())?.trim() === '2 / 3', 10000);
    const backupOnDisk = fs.readdirSync(path.join(art, 'backup', 'snapshots')).filter((n) => n.endsWith('.sqlite')).length === 2 && fs.existsSync(path.join(art, 'backup', 'pulseframe.sqlite'));
    const backupLast = (await page.getByTestId('backup-last').textContent()) ?? '';
    check('project manager: the automatic backup panel shows the schedule and the snapshots present; "Back up now" writes a new dated snapshot that is on disk', backupShown && backupTwo && backupOnDisk && backupLast.length > 4 && (await page.getByTestId('backup-last-error').count()) === 0, { backupShown, backupTwo, backupOnDisk, backupLast });
    await page.getByTestId('storage-gc-check').click();
    await page.getByTestId('storage-gc-dry').waitFor();
    await page.screenshot({ path: path.join(art, 'projects-dialog.png') });
    await page.keyboard.press('Escape');
    const closed = await until(async () => (await page.getByTestId('projects-dialog').count()) === 0, 3000);
    const focusBack = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid === 'projects-open');
    check('project manager: lists the projects; delete is disabled until the exact name is typed, then removes the project; storage check is a dry run; Escape closes the dialog and returns focus to the button that opened it', rows0 === 2 && blocked && gone && closed && focusBack, { rows0, blocked, gone, closed, focusBack });
    await page.getByTestId('projects-open').click();
    await page.getByTestId('project-new-name').fill('פרויקט חדש');
    await page.getByTestId('project-new').click();
    await page.waitForFunction((old) => { const id = new URLSearchParams(location.search).get('project'); return !!id && id !== old; }, pid, { timeout: 20000 });
    await page.getByTestId('timecode').waitFor();
    const newId = new URL(page.url()).searchParams.get('project')!;
    check('"new project" creates it and opens it in the editor', (await call(`/projects/${newId}`)).body.project.name === 'פרויקט חדש');
    check('no uncaught errors in the page', errors.length === 0, errors.slice(0, 4));
    await page.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: 'Owner-facing controls in headless Chromium.', passed: checks.length - failed.length, total: checks.length, checks };
    fs.writeFileSync(path.join(root, 'docs/evidence/owner-ui-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nOwner UI proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
