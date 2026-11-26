/**
 * pnpm proof:ai-ui (ADR-0017): the AI tools panel, run sheet, compare slider and translation review in the built editor, in Hebrew.
 * It needs no model and no ComfyUI: the run uses the ffmpeg-only tool «הסרת שירה (קלאסי, לא בינה מלאכותית)»
 * (local.audio.vocals-classic) on a synthetic stereo sound made here (a centred 440 Hz tone and a hard-left 660 Hz tone).
 * The translation is a typed fixture standing in for the translation tool's output (labelled: no model ran); it is stored by the
 * same internal op the tool commits (attach_translation).
 * Checks:
 *  - a sound clip selected, the tool run with apply replace-clip through the run sheet;
 *  - the progress is a role=progressbar with aria-valuenow and aria-valuemax (measured), and the end is announced;
 *  - the before/after compare is operated with the keyboard (arrows, Shift, Home/End);
 *  - the clip's file is replaced by a copy derived from it, and the ordinary undo brings the original back;
 *  - with PF_DENOISE_BIN unset, the AI voice-cleanup card shows engine_not_configured with its steps;
 *  - the typed translation shows side by side, each side in its own direction, with «תרגום מכונה · לא נבדק»;
 *  - an agent credential is refused when it tries to mark the translation reviewed (and no MCP tool offers it).
 * Exits 0 when every check passes, 1 when one fails, 2 (blocked) without ffmpeg, the built editor or the merged local tools.
 *   pnpm build && pnpm proof:ai-ui
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { sha256Hex } from '@pulseframe/core';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/ai-ui');
const VOCALS = 'local.audio.vocals-classic', VOICE = 'local.voice.clean';
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const blocked = (why: string): never => { console.error(`BLOCKED: ${why}`); process.exit(2); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });

async function main() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { blocked('ffmpeg is not on PATH; the classic vocal remover needs it'); }
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  // The voice-cleanup engine stays unset on purpose: its card must say so. Nothing needs the tools environment either.
  delete process.env.PF_DENOISE_BIN;
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data'), denoiseBin: null, toolsPython: null, comfyuiUrl: null });
  try {
    if (!fs.existsSync(path.join(s.cfg.webDist, 'index.html'))) blocked(`the editor is not built (${s.cfg.webDist}); run pnpm build`);
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
    const call = async (p: string, body?: unknown) => {
      const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: (r.headers.get('content-type')?.includes('json') ? await r.json() : null) as any };
    };
    const caps = (await call('/capabilities')).body.capabilities as { id: string; setup?: { code: string } }[];
    if (!caps.some((c) => c.id === VOCALS) || !caps.some((c) => c.id === VOICE)) blocked(`the local tools are not in this build's registry (${VOCALS}, ${VOICE}); merge the AI-wave local tools first`);

    // a stereo sound whose two channels differ (a centred tone and a tone on the left only): not mono-like, so the tool accepts it
    const wav = path.join(art, 'mix.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc=exprs='0.3*sin(2*PI*440*t)+0.3*sin(2*PI*660*t)|0.3*sin(2*PI*440*t)':s=48000:d=3", '-c:a', 'pcm_s16le', wav]);
    const pid = (await call('/projects', { name: 'ai-ui', width: 640, height: 360 })).body.project.id as string;
    const up = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'mix.wav' }, body: fs.readFileSync(wav) })).json() as any;
    const original = up.assetId as string;
    const placed = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: original, start: f(0) } }] });
    const clipId = placed.body.results[0].output.clipId as string;
    // the typed translation (fixture): a Hebrew transcript and its English language format, review 'needed'
    s.store.commit({ projectId: pid, actor: 'fixture', ops: [{ op: 'set_transcript', args: { assetId: original, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(1, 1), text: 'שלום לכולם' }, { start: T.rt(1, 1), duration: T.rt(2, 1), text: 'ברוכים הבאים' }] } }] });
    const segs = s.store.getProject(pid).doc.transcripts[original]!.segments.map((x) => x.id);
    const tr = s.store.commit({ projectId: pid, actor: 'fixture', allowInternal: true, ops: [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: { from: 'he', to: 'en', engine: 'typed fixture (no model ran)', model: 'none', createdAt: new Date().toISOString(), createdBy: 'fixture', sources: { [segs[0]!]: sha256Hex('שלום לכולם'), [segs[1]!]: sha256Hex('ברוכים הבאים') } }, phraseText: { [segs[0]!]: 'Hello everyone', [segs[1]!]: 'Welcome' }, cueText: {} } }] });
    const variantId = tr.results[0]!.output!.variantId as string;

    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.ai.tab.v1', 'sound'); } catch { /* storage unavailable */ } });
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor();
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.getByTestId('rail-ai').click(); // the AI tools are the rail's AI category since the redesign (UX_REDESIGN §4.11)
      await page.locator('[data-testid=ai-tab][data-tab=sound]').click();

      // the AI voice cleanup, its engine not set up: an honest setup state with its steps
      const voice = page.locator(`[data-testid=ai-tool][data-id="${VOICE}"]`);
      await voice.waitFor({ timeout: 15000 });
      const voiceState = await voice.locator('[data-testid=ai-state]').getAttribute('data-code');
      // the steps sit in the card's "how to set up" disclosure and are in the owner's language: since the redesign no variable
      // name appears anywhere on the card, the installer's technical detail included (owner rule, AiTools.tsx installerDetail)
      await voice.getByTestId('ai-setup-how').locator('summary').first().click();
      const voiceSteps = await voice.locator('[data-testid=ai-setup-steps] li').allTextContents();
      const techSummary = voice.locator('[data-testid=ai-setup-how] .pf-hub-tech > summary');
      if (await techSummary.count()) await techSummary.first().click();
      const voiceTech = (await voice.getByTestId('ai-state-detail').textContent().catch(() => null)) ?? '';
      const cardText = (await voice.textContent()) ?? '';
      check('with PF_DENOISE_BIN unset the AI voice-cleanup card says engine_not_configured; its setup steps (shown on request) are at least two, in Hebrew owner language, and no environment variable is named anywhere on the card (technical detail included)', voiceState === 'engine_not_configured' && voiceSteps.length >= 2 && voiceSteps.every((x) => /[\u0590-\u05FF]/.test(x)) && !/\bPF_[A-Z0-9_]+/.test(cardText) && !/\bPF_[A-Z0-9_]+/.test(voiceTech), { voiceTech, voiceState, voiceSteps });
      check('its run button is not offered while the engine is not set up', await voice.getByTestId('ai-open-run').isDisabled());

      // the classic vocal remover on the selected sound clip, in place of its file
      const card = page.locator(`[data-testid=ai-tool][data-id="${VOCALS}"]`);
      check('the classic vocal remover is ready (ffmpeg only)', (await card.locator('[data-testid=ai-state]').getAttribute('data-code')) === 'ready');
      await card.getByTestId('ai-open-run').click();
      const sheet = card.getByTestId('ai-run-sheet');
      await sheet.waitFor();
      check('the run sheet reads the selected clip', await sheet.getByTestId('ai-source-clip').isChecked());
      await sheet.getByTestId('ai-apply-replace-clip').check();
      await sheet.getByTestId('ai-est-time').waitFor();
      const timeText = (await sheet.getByTestId('ai-est-time').textContent()) ?? '';
      check('the estimate states its basis: no time is guessed before a measurement', /לא נמדד עדיין|נמדד במחשב הזה/.test(timeText), timeText);
      await sheet.getByTestId('ai-run').click();
      const result = card.locator('[data-testid=ai-result]');
      await result.waitFor({ timeout: 120000 });
      const status = await card.getByTestId('ai-job').getAttribute('data-status');
      const attachment = await result.getAttribute('data-attachment');
      check('the run succeeded and its result was placed in the clip', status === 'succeeded' && attachment === 'attached', { status, attachment, text: await result.textContent() });
      const bar = card.getByTestId('ai-progress');
      const pb = { role: await bar.getAttribute('role'), now: await bar.getAttribute('aria-valuenow'), max: await bar.getAttribute('aria-valuemax'), text: await bar.getAttribute('aria-valuetext') };
      check('the progress is a role=progressbar with aria-valuenow and aria-valuemax (measured, complete)', pb.role === 'progressbar' && Number(pb.max) > 0 && pb.now === pb.max && /נמדד/.test(pb.text ?? ''), pb);
      await page.waitForFunction((sel) => /הסתיימה/.test(document.querySelector(sel)?.textContent ?? ''), `[data-testid=ai-tool][data-id="${VOCALS}"] [data-testid=ai-announce]`, { timeout: 5000 }).catch(() => {});
      check('the end of the run was announced (aria-live)', /הסתיימה/.test((await card.getByTestId('ai-announce').textContent()) ?? ''));

      // the clip shows a copy derived from its own file
      const doc1 = (await call(`/projects/${pid}`)).body.project;
      const clip1 = Object.values<any>(doc1.sequences).flatMap((q: any) => q.tracks).flatMap((t: any) => t.clips).find((c: any) => c.id === clipId);
      const res = doc1.assets[clip1.assetId];
      check('the clip\'s file was replaced by a copy made from it (derived provenance)', clip1.assetId !== original && res?.provenance?.derived?.sourceAssetIds?.[0] === original && res.provenance.derived.capabilityId === VOCALS, { assetId: clip1.assetId });

      // the compare slider, with the keyboard only
      const slider = card.getByTestId('ai-compare-slider');
      await slider.focus();
      const value = async () => Number(await card.getByTestId('ai-compare').getAttribute('data-value'));
      const v0 = await value();
      await page.keyboard.press('ArrowUp'); const v1 = await value();
      await page.keyboard.press('Shift+ArrowUp'); const v2 = await value();
      await page.keyboard.press('End'); const v3 = await value();
      await page.keyboard.press('Home'); const v4 = await value();
      check('the before/after compare is a native range input operated by the keyboard (arrow 1 %, Shift+arrow 10 %, End, Home)', (await slider.getAttribute('type')) === 'range' && v0 === 50 && v1 === 51 && v2 === 61 && v3 === 100 && v4 === 0, { v0, v1, v2, v3, v4 });

      // the ordinary undo brings the original back
      await card.getByTestId('ai-undo').click();
      let back = '';
      for (let i = 0; i < 50; i++) {
        const d = (await call(`/projects/${pid}`)).body.project;
        back = Object.values<any>(d.sequences).flatMap((q: any) => q.tracks).flatMap((t: any) => t.clips).find((c: any) => c.id === clipId)?.assetId;
        if (back === original) break;
        await sleep(100);
      }
      check('undo restores the clip\'s original file', back === original, { back });

      // the typed translation, side by side (in the inspector, which holds the Copilot while the rail is on AI)
      await page.getByTestId('rail-media').click();
      const review = page.getByTestId('translation-review');
      await review.waitFor({ timeout: 10000 });
      const badge = (await review.getByTestId('translation-unreviewed').textContent()) ?? '';
      const masterDir = await review.getByTestId('translation-master').first().getAttribute('dir');
      const transDir = await review.getByTestId('translation-text').first().evaluate((el) => el.closest('td')?.getAttribute('dir'));
      const rows = await review.getByTestId('translation-row').count();
      check('the translation shows side by side, each side in its own direction, marked «תרגום מכונה · לא נבדק»', badge.includes('תרגום מכונה · לא נבדק') && masterDir === 'rtl' && transDir === 'ltr' && rows === 2, { badge, masterDir, transDir, rows });
      check('the owner\'s session is offered «סמן כנבדק»', ((await review.getByTestId('translation-mark').textContent()) ?? '').includes('סמן כנבדק'));
      await page.screenshot({ path: path.join(art, 'ai-ui-he.png') });
    } finally { await browser.close(); }

    // an agent may not mark it reviewed
    const agent = await call(`/projects/${pid}/variants/${variantId}/translation/review`, { review: 'reviewed' });
    check('an agent credential trying to mark the translation reviewed is refused (403 human_approval_required)', agent.status === 403 && agent.body.error.code === 'human_approval_required', agent.body.error);
    check('the translation still needs review', s.store.getProject(pid).doc.variants[variantId]!.translation!.review === 'needed');
  } finally { await s.close(); }

  const failed = checks.filter((c) => !c.ok);
  const report = { proof: 'ai-ui', adr: 'ADR-0017', ranAt: new Date().toISOString(), machine: `${os.type()} ${os.release()} ${os.arch()}`, note: 'The run used the ffmpeg-only classic vocal remover; the translation is a typed fixture (no model ran). Functional evidence only, CPU profile.', checks, result: failed.length ? 'FAIL' : 'PASS' };
  fs.writeFileSync(path.join(root, 'docs/evidence/ai-ui-proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${report.result}: ${checks.length - failed.length}/${checks.length} checks. Evidence: docs/evidence/ai-ui-proof.json`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
