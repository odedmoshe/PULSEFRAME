/**
 * Accessibility audit of the editor (SPEC §3, Appendix C3): an automated HEURISTIC pass in Hebrew (RTL) and English (LTR).
 * It checks things a script can decide: every control has an accessible name, text contrast, visible keyboard focus,
 * document language/direction, tab semantics. It is not a WCAG conformance statement and does not replace testing with a
 * screen reader or with users. Findings are written to docs/evidence/a11y-audit.json. The transient states include the
 * effect gallery dialog and the look panel with the visual wave's controls (beat fieldset, date stamp, time separator), and the
 * AI-model wave's surfaces (ADR-0017): the AI tools panel with a run sheet open, the before/after compare slider after a run of the
 * ffmpeg-only classic vocal remover, and the translation review (a typed translation fixture; no model runs).
 * motion tracking UI (ADR-0015): the tracking panel, follow and privacy-region controls with their warning, and the track picker.
 * Templates and adjustment layers (ADR-0016): an adjustment clip's inspector, the Templates drawer (its first card at the inline
 * start), the template dialog (first step and plan step) and the post-apply bar.
 * The trend pack's panels (ADR-0012): the title effects panel with all six look fields on, and the transition options of a light
 * transition (beat lock, velocity, colour, seed, light status).
 * The life line (ADR-0021) and the content-pack mounts: the media drawer by date and by event (with the sunset choice), the
 * field menu of a title (a menu), the live line with its anchored error and fix, the people sheet (a modal dialog opened from
 * the field menu), the Hanukkah pack page, the built-in music tab of the audio drawer and the text drawer with its fonts.
 * Keyframe curves and motion paths (ADR-0019): the keyframe strip of a selected title with the motion path on the stage
 * (vertices and bend grips), and the curve picker (a modal dialog opened from a strip key with Enter).
 * Perform mode (ADR-0025): the perform view at rest, a take under review (ghost banner and chips), the tap calibration dialog
 * (modal) and the camera overlay on a selected clip.
 * The Hebrew command bar (ADR-0027): a plan's preview, a question's choices, and Settings «עוזר השפה».
 * The light theme: the resting editor, a media card under the pointer and its ⋯ menu, the export sheet, Settings, perform mode, an
 * asset whose stored file is missing on disk (library card and timeline clip), and the start hub, in both languages.
 * In both themes: a toast shown while a modal dialog is open (the people sheet's undo toast): inside the modal, not inert, in the
 * accessibility tree as a status, and reachable from the keyboard inside the modal's focus trap.
 * In both themes, the wave 6 notes: the transcript panel's note that names a clip showing an untimed copy the cut left alone, the
 * pacing panel's note that names the same clip as left out of its word counts, the
 * archive import's toast about cleared review marks (closed with its ×), and the Templates bar's «החזרת החלקים שנמחקו» after a hand
 * delete (undone again). The untimed copy and the reviewed translation are typed fixtures: no provider and no model ran.
 *   pnpm build && pnpm audit:a11y
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { sha256Hex } from '@pulseframe/core';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { withExif } from '../../../apps/server/src/captureMeta.fixtures.ts';
import { chooseFormat, formatOptions, openCardMenu } from './editor-ui.ts';
import { makeRenderCacheCtx, renderCacheA11yScenarios } from './a11y-render-cache.ts';
import { craftA11yScenarios } from './a11y-craft.ts';
import { stabiliseA11yScenarios } from './a11y-stabilise.ts';
import { musicfitA11yScenarios } from './a11y-musicfit.ts';
import { instrumentsA11yScenarios } from './a11y-instruments.ts';
import { assistantLocalA11yScenarios } from './assistant-local-proof.ui.ts';
import { pearlsA11yScenarios } from './a11y-pearls.ts';
import { storyA11yScenarios } from './a11y-story.ts';
import { growingA11yScenarios } from './a11y-growing.ts';
import { searchA11yScenarios } from './a11y-search.ts';
import { makeApi, ownerApi } from './incremental-fixtures.ts';
import { KF_TESTIDS } from '../../../apps/web/src/editor/keyframes.testids.ts';
import { auditInPage, focusAudit, toastAfterModal, toastInOpenModal } from './a11y-lib.ts';
import { dictionaries } from '../../i18n/src/index.ts';
import { TEMPLATE_STRINGS } from '../../../apps/web/src/editor/templates.strings.ts';
import { pacingStrings } from '../../../apps/web/src/editor/pacing.strings.ts';
import { IMPORTED_REVIEW_CLEARED } from '../../../apps/server/src/archive.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/a11y');
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });


/**
 * Clicks a timeline clip of the top lane. The marker card now floats under the ruler at the marker while the playhead rests on
 * it and covers the start of the top lane (reported as a product fault in the proof-migration report): the playhead is first
 * moved off the marker with a click on the ruler above the clip's end, as a user would, so the card goes away.
 */
async function clickClipEnd(page: Page, clipId: string) {
  const el = page.locator(`.clip[data-clip-id="${clipId}"]`);
  const b = (await el.boundingBox())!;
  if (await page.getByTestId('marker-bar').count()) {
    const r = (await page.getByTestId('ruler').boundingBox())!;
    await page.mouse.click(b.x + b.width - 8, r.y + r.height / 2);
    await page.getByTestId('marker-bar').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
  await el.click({ position: { x: Math.max(2, b.width - 8), y: b.height / 2 } });
}

/**
 * A toast that appears while a modal dialog is open: the people sheet (opened from the palette), a person added and removed in it,
 * so the removal's undo toast shows while the sheet stays open. The page behind a modal is inert; the toast must be inside the
 * modal (data-host=modal), not inert, in the accessibility tree as a status (an inert subtree is pruned from it: the page behind
 * is the control), and reachable from the keyboard inside the modal's focus trap. Leaves the sheet open with the toast focused;
 * the caller audits the state, then closes the sheet. `shown` is false (a finding) if any part fails.
 */
async function toastInModal(page: Page, lang: 'he' | 'en'): Promise<Record<string, unknown>> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByTestId('open-palette').click();
  await page.getByTestId('palette-input').fill(lang === 'he' ? 'אנשים' : 'People');
  await page.locator('[data-testid=palette-option][data-command-id="life.people"]').click({ timeout: 8000 });
  await page.getByTestId('life-people').waitFor({ timeout: 8000 });
  const name = lang === 'he' ? 'אורח בדיקת נגישות' : 'Accessibility test guest';
  await page.getByTestId('life-person-add').click();
  await page.getByTestId('life-person-new-name').fill(name);
  await page.getByTestId('life-person-new-save').click();
  const personId = await page.waitForFunction((n) => [...document.querySelectorAll<HTMLElement>('[data-person-id]')].find((r) => r.querySelector<HTMLInputElement>('input[type=text]')?.value === n)?.dataset.personId ?? null, name, { timeout: 10000 }).then((x) => x.jsonValue() as Promise<string>);
  await page.getByTestId(`life-person-remove-${personId}`).click();
  await page.locator('[data-testid=life-people] [data-testid=toasts] [role=status]').first().waitFor({ timeout: 8000 }).catch(() => {});
  // the keyboard: Shift+Tab from where the removal left the focus walks back to the toast's button, never leaving the sheet
  let left = 0, reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Shift+Tab');
    const at = await page.evaluate(() => ({ inSheet: !!document.querySelector('[data-testid=life-people]')?.contains(document.activeElement), onToast: !!document.activeElement?.closest('[data-testid=toasts] [role=status]') && document.activeElement?.tagName === 'BUTTON' && !document.activeElement.classList.contains('pf-toast-x') }));
    if (!at.inSheet) left++;
    reached = at.onToast;
  }
  const where = await page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[data-testid=toasts]');
    const t = region?.querySelector<HTMLElement>('[role=status]');
    return { inModal: !!t && !!document.querySelector('[data-testid=life-people]')?.contains(t), host: region?.dataset.host ?? null, inert: !t || !!t.closest('[inert]'), regionName: region?.getAttribute('aria-label') ?? null };
  });
  const cdp = await page.context().newCDPSession(page);
  const axIgnored = async (selector: string) => {
    const { root: d } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: d.nodeId, selector });
    if (!nodeId) return null;
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const n = nodes[0] as { ignored?: boolean; role?: { value?: string } } | undefined;
    return n ? { ignored: !!n.ignored, role: n.role?.value ?? null } : null;
  };
  const axToast = await axIgnored('[data-testid=life-people] [data-testid=toasts] [role=status]');
  const axBehind = await axIgnored('[data-testid=open-palette]');
  await cdp.detach().catch(() => {});
  const announced = axToast?.ignored === false && axToast.role === 'status';
  return { shown: where.inModal && where.host === 'modal' && !where.inert && announced && axBehind?.ignored === true && reached && left === 0, ...where, announced, pageBehindPruned: axBehind?.ignored === true, toastReachedByKeyboard: reached, tabStepsThatLeftTheDialog: left };
}

/**
 * The transcript panel's note after a cut by the transcript that left a clip alone: the open project has a recording and a clip that
 * shows a reversed copy of it (no time mapping). One word is deleted in the panel; the note names the copy's file. The cut changes
 * the project, so each run gets its own (the caller makes it). `shown` is false (a finding) unless the one note is a visible status
 * with the dictionary's wording.
 */
async function skippedNoteState(page: Page, lang: 'he' | 'en'): Promise<Record<string, unknown>> {
  await page.locator('[data-testid=transcript-panel][data-state=ready]').waitFor({ timeout: 15000 }).catch(() => {});
  await page.getByTestId('transcript-word').nth(1).click({ timeout: 8000 }).catch(() => {});
  await page.getByTestId('transcript-delete').click({ timeout: 8000 }).catch(() => {});
  const note = page.getByTestId('transcript-skipped-note');
  await note.first().waitFor({ timeout: 10000 }).catch(() => {});
  await note.first().scrollIntoViewIfNeeded().catch(() => {});
  const text = await note.first().textContent().catch(() => null);
  const want = dictionaries[lang]['transcript.untimedSkipped'].replace('{name}', 'reversed.mp4');
  return { shown: (await note.count()) === 1 && text === want && (await note.first().getAttribute('role').catch(() => null)) === 'status' && (await note.first().isVisible().catch(() => false)), text };
}

/**
 * The pacing panel's note in the same project (after the transcript panel's): the pacing report leaves the clip of the reversed copy
 * out of its word counts and names its file. `shown` is false (a finding) unless the one note is a visible status with the panel's
 * wording. The panel sits on the inspector's Deliver page: when the open mode has no such tab the all-tools view is opened for the
 * audit, and `back` leaves it again so the states that follow see the inspector as before.
 */
async function pacingNoteState(page: Page, lang: 'he' | 'en'): Promise<{ extra: Record<string, unknown>; back: () => Promise<void> }> {
  const note = page.getByTestId('pacing-skipped-note');
  const seen = () => note.first().isVisible().catch(() => false);
  const was = await page.locator('.inspector-tabs button[role=tab][aria-selected=true]').first().getAttribute('data-testid', { timeout: 2000 }).catch(() => null);
  let opened: 'tab' | 'all' | null = null;
  if (!(await seen()) && (await page.locator('button[role=tab][data-testid="inspector-tab-deliver"]').count())) { await page.getByTestId('inspector-tab-deliver').click({ timeout: 3000 }).catch(() => {}); opened = 'tab'; }
  if (!(await seen()) && (await page.locator('aside.inspector[data-view=all]').count()) === 0) { await page.getByTestId('inspector-tab-all').first().click({ timeout: 3000 }).catch(() => {}); opened = 'all'; }
  await note.first().waitFor({ timeout: 10000 }).catch(() => {});
  await note.first().scrollIntoViewIfNeeded().catch(() => {});
  const text = await note.first().textContent().catch(() => null);
  const want = pacingStrings[lang].untimedSkipped.replace('{name}', 'reversed.mp4');
  const extra = { shown: (await note.count()) === 1 && text === want && (await note.first().getAttribute('role').catch(() => null)) === 'status' && (await seen()), text };
  const back = async () => {
    if (opened === 'all') await page.getByTestId('inspector-tabs-back').click({ timeout: 3000 }).catch(() => {});
    if (opened && was && was !== 'inspector-tab-all') await page.locator(`.inspector-tabs button[role=tab][data-testid="${was}"]`).click({ timeout: 3000 }).catch(() => {});
  };
  return { extra, back };
}

/**
 * The archive import's note: an archive whose translation was marked reviewed is imported in the Deliver panel; the editor opens the
 * new project with one toast that says the mark was cleared (kept until closed: no timer). Leaves the toast open for the audit;
 * `close` presses its × and reports whether it went away.
 */
async function importNoteState(page: Page, lang: 'he' | 'en', archive: Buffer): Promise<{ extra: Record<string, unknown>; close: () => Promise<Record<string, unknown>> }> {
  const from = new URL(page.url()).searchParams.get('project');
  await page.getByTestId('archive-import').setInputFiles({ name: 'a11y-review.pulseframe.tar', mimeType: 'application/x-tar', buffer: archive });
  await page.waitForFunction((old) => { const now = new URLSearchParams(location.search).get('project'); return !!now && now !== old; }, from, { timeout: 30000 }).catch(() => {});
  await page.getByTestId('timecode').waitFor({ timeout: 15000 }).catch(() => {});
  const toast = page.locator('[data-testid=toasts] [role=status]');
  await toast.first().waitFor({ timeout: 10000 }).catch(() => {});
  const plain = (x: string | null) => (x ?? '').replace(/[⁦-⁩‎‏]/g, '');
  const title = plain(await toast.first().locator('b').textContent().catch(() => null)), body = plain(await toast.first().locator('p').textContent().catch(() => null));
  const closeName = await toast.first().locator('.pf-toast-x').getAttribute('aria-label').catch(() => null);
  const shown = (await toast.count()) === 1 && title === (lang === 'he' ? 'הארכיון יובא' : 'The archive was imported') && body === IMPORTED_REVIEW_CLEARED[lang](['«English»']) && body.includes(lang === 'he' ? 'התרגום «English» מסומן שוב' : 'The translation «English» needs review again') && (await toast.first().locator('.pf-toast-timer').count()) === 0 && !!closeName
    && new URL(page.url()).searchParams.get('project') !== from && (await toast.first().isVisible().catch(() => false));
  return { extra: { shown, title, body, closeName }, close: async () => { await toast.first().locator('.pf-toast-x').click({ timeout: 5000 }).catch(() => {}); await toast.first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); return { closed: (await toast.count()) === 0 }; } };
}

/**
 * The Templates bar after a hand delete: with a template just applied (the bar is showing), a picture the template placed is deleted
 * in the timeline with the Delete key; the bar then offers «החזרת החלקים שנמחקו» / "Bring back the deleted parts". Leaves the button
 * showing for the audit; `undo` takes the delete back (the button goes away) so the caller's own undo of the template still fits.
 */
async function restoreRemovedState(page: Page, lang: 'he' | 'en'): Promise<{ extra: Record<string, unknown>; undo: () => Promise<Record<string, unknown>> }> {
  const btn = page.getByTestId('template-restore-removed');
  const runId = await page.getByTestId('template-applied').getAttribute('data-run-id').catch(() => null);
  const before = await btn.count();
  const slotClips = await page.evaluate(async (run) => {
    const id = new URLSearchParams(location.search).get('project');
    const doc = (await (await fetch(`/api/v1/projects/${id}`)).json()).project;
    return ((run && doc.recipeRuns?.[run]?.slots) || []).map((x: { clipId: string }) => x.clipId) as string[];
  }, runId).catch(() => [] as string[]);
  let victim: string | null = null;
  for (const id of slotClips) if (await page.locator(`.track.video .clip[data-clip-id="${id}"]`).count()) { victim = id; break; }
  if (victim) {
    await page.locator(`.track.video .clip[data-clip-id="${victim}"]`).click({ timeout: 8000 }).catch(() => {});
    await page.keyboard.press('Delete');
  }
  await btn.waitFor({ timeout: 8000 }).catch(() => {});
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  // the bar itself, for the eye (the state's own screenshot is taken after the focus walk, which scrolls the drawer)
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
  await page.getByTestId('template-applied').screenshot({ path: path.join(art, `bar-template-restore-removed-${lang}-${theme}.png`) }).catch(() => {});
  const text = await btn.textContent().catch(() => null);
  const shown = before === 0 && !!victim && (await btn.count()) === 1 && text === TEMPLATE_STRINGS[lang].restoreRemoved && (await btn.isVisible().catch(() => false)) && (await btn.isEnabled().catch(() => false));
  return { extra: { shown, text, slots: slotClips.length }, undo: async () => { if (await btn.count()) { await page.getByTestId('undo').click({ timeout: 5000 }).catch(() => {}); await btn.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); } await page.waitForTimeout(300); return { closed: (await btn.count()) === 0 }; } };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4'), frames: 120 });
  // the phone drop's dialog is audited with a live code: the door may bind loopback for this audit only (startServer's override)
  const s = await startServer({ port: Number(process.env.PF_A11Y_PORT ?? 8803), dataDir: path.join(art, 'data'), dropPort: Number(process.env.PF_A11Y_DROP_PORT ?? 8804), dropAdmitAddresses: ['127.0.0.1'] });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const post = async (p: string, body: unknown) => (await fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
  const browser = await chromium.launch();
  const report: any = { ranAt: new Date().toISOString(), machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, browser: browser.version() }, scope: 'Automated heuristic audit of the editor with all Inspector panels shown and one clip selected, in the dark theme (every state) and the light theme (the main states), in Hebrew and English. Not a WCAG conformance claim; no screen-reader or user testing.', runs: [] };
  try {
    const pid = (await post('/projects', { name: 'a11y', width: 640, height: 360 })).project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const tx = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }, { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60) } }, { op: 'add_caption_track', args: { mode: 'manual' } }, { op: 'add_variant', args: { profileId: 'vertical-9x16' } }, { op: 'add_marker', args: { time: f(0), label: 'סמן פתיחה' } }] });
    const clipId = tx.results[0].output.clipId;
    const titleClipId = tx.results[1].output.clipId as string;
    // ADR-0017: a stereo sound (two different channels, so the classic vocal remover accepts it) on its own clip, with a typed Hebrew
    // transcript and an English translation fixture (stored by the op the translation tool commits; no model runs here).
    const mix = path.join(art, 'mix.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc=exprs='0.3*sin(2*PI*440*t)+0.3*sin(2*PI*660*t)|0.3*sin(2*PI*440*t)':s=48000:d=2", '-c:a', 'pcm_s16le', mix]);
    const upMix: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'mix.wav' }, body: fs.readFileSync(mix) })).json();
    const mixClip = (await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: upMix.assetId, start: f(0) } }] })).results[0].output.clipId as string;
    s.store.commit({ projectId: pid, actor: 'fixture', ops: [{ op: 'set_transcript', args: { assetId: upMix.assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(1, 1), text: 'שלום לכולם' }] } }] });
    const seg = s.store.getProject(pid).doc.transcripts[upMix.assetId]!.segments[0]!.id;
    s.store.commit({ projectId: pid, actor: 'fixture', allowInternal: true, ops: [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: { from: 'he', to: 'en', engine: 'typed fixture (no model ran)', model: 'none', createdAt: new Date().toISOString(), createdBy: 'fixture', sources: { [seg]: sha256Hex('שלום לכולם') } }, phraseText: { [seg]: 'Hello everyone' }, cueText: {} } }] });
    // templates and adjustment layers (ADR-0016): a project of four still pictures with an adjustment layer over the edit
    const tplPid = (await post('/projects', { name: 'a11y-templates', width: 640, height: 360 })).project.id as string;
    // an empty project: the start hub covers the stage, the inspector and the timeline (UX_REDESIGN §4.14)
    const emptyPid = (await post('/projects', { name: 'a11y-empty', width: 1920, height: 1080 })).project.id as string;
    // keyframe curves (ADR-0019): a title with x keyed at 0, 15, 30 and y at 0, 30 (a strip, a path with vertices and bend grips)
    const kfPid = (await post('/projects', { name: 'a11y-keyframes', width: 640, height: 360 })).project.id as string;
    const kfClip = (await post(`/projects/${kfPid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'מסלול', start: f(0), duration: f(60) } }] })).results[0].output.clipId as string;
    await post(`/projects/${kfPid}/transactions`, { ops: [[0, -0.3], [15, 0.1], [30, 0.3]].map(([k, v]) => ({ op: 'set_keyframe', args: { clipId: kfClip, property: 'x', time: f(k!), value: v, easing: 'linear' } })).concat([[0, -0.2], [30, 0.2]].map(([k, v]) => ({ op: 'set_keyframe', args: { clipId: kfClip, property: 'y', time: f(k!), value: v, easing: 'linear' } }))) });
    // multicam (ADR-0020): two barcode videos grouped by hand (the second synced by a hand offset, so no sound match is needed),
    // the program placed on new tracks; the panel and the sync dialog are audited, and a keyboard-only path from the library
    // selection to a placed program (state multicam-keyboard-path) on a second, still ungrouped project
    const mcB = await generateBarcodeFixture({ out: path.join(art, 'fixture-b.mp4'), frames: 121 });
    const mcMake = async (name: string, place: boolean) => {
      const id = (await post('/projects', { name, width: 640, height: 360 })).project.id as string;
      const ids: string[] = [];
      for (const [file, label] of [[fixture.file, 'a.mp4'], [mcB.file, 'b.mp4']] as const) {
        const r: any = await (await fetch(`${s.url}/api/v1/projects/${id}/assets`, { method: 'POST', headers: { ...h, 'x-filename': label }, body: fs.readFileSync(file) })).json();
        ids.push(r.assetId as string);
      }
      if (!place) return { id, ids, trackId: null as string | null };
      const made = await post(`/projects/${id}/transactions`, { ops: [{ op: 'create_multicam', args: { name: 'a11y', angles: ids.map((assetId) => ({ assetIds: [assetId] })) } }] });
      const out = made.results?.[0]?.output as { groupId: string; angleIds: string[] } | undefined;
      if (!out) return { id, ids, trackId: null as string | null, error: JSON.stringify(made).slice(0, 200) };
      await post(`/projects/${id}/transactions`, { ops: [{ op: 'set_multicam_sync', args: { groupId: out.groupId, angleId: out.angleIds[1], pieceIndex: 0, offset: { value: '0', timescale: 1 } } }] });
      const placed = await post(`/projects/${id}/transactions`, { ops: [{ op: 'place_multicam', args: { groupId: out.groupId, at: { value: '0', timescale: 1 }, angleId: out.angleIds[0] } }] });
      return { id, ids, trackId: (placed.results?.[0]?.output?.videoTrackId ?? null) as string | null, error: placed.results?.[0]?.output ? undefined : JSON.stringify(placed).slice(0, 200) };
    };
    const mc = await mcMake('a11y-multicam', true);
    const mcLib = await mcMake('a11y-multicam-library', false);
    for (const [i, c] of ['0x4a6f8c', '0x8c5a4a', '0x5a8c6a', '0x7a5a8c'].entries()) {
      const file = path.join(art, `still-${i}.png`);
      execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${c}:s=640x360,drawbox=x=${60 + i * 100}:y=90:w=120:h=180:color=0xc0b07a:t=fill`, '-frames:v', '1', file]);
      await fetch(`${s.url}/api/v1/projects/${tplPid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) });
    }
    const tplAssets = Object.keys(((await (await fetch(`${s.url}/api/v1/projects/${tplPid}`, { headers: h })).json()) as any).project.assets);
    await post(`/projects/${tplPid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: tplAssets[0], start: f(0), duration: f(60) } }] });
    const adjClip = (await post(`/projects/${tplPid}/transactions`, { ops: [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grayscale' }] } }] })).results?.[0]?.output?.clipId as string | undefined;
    // the life line (ADR-0021): pictures with capture dates (two of one Hanukkah evening, one of 2023, one without a date),
    // arranged by events; a person (added through a grant with people:'full': the agent token writes names only); and a title
    // with a live {year} field over the evening picture
    const lifePid = (await post('/projects', { name: 'a11y-life', width: 640, height: 360 })).project.id as string;
    const lifeBase = path.join(art, 'life-base.jpg');
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', '-q:v', '3', lifeBase]);
    const lifePhoto = async (name: string, date: string | null, n: number) => {
      const bytes = Buffer.concat([withExif(fs.readFileSync(lifeBase), date === null ? { date: null } : { date, offset: '+02:00' }), Buffer.from(`\n${n}`)]);
      const r: any = await (await fetch(`${s.url}/api/v1/projects/${lifePid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': name }, body: new Uint8Array(bytes) })).json();
      if (!r.assetId) throw new Error(`life fixture ${name}: ${JSON.stringify(r).slice(0, 200)}`);
      return r.assetId as string;
    };
    const lifeEvening = await lifePhoto('evening.jpg', '2024:12:25 18:00:00', 1);
    await lifePhoto('evening-early.jpg', '2024:12:25 17:30:00', 2);
    await lifePhoto('spring.jpg', '2023:03:10 12:00:00', 3);
    const lifeUndated = await lifePhoto('nodate.jpg', null, 4);
    const lifeTx = async (ops: unknown[]) => { const r = await post(`/projects/${lifePid}/transactions`, { ops }); if (!r.results) throw new Error(`life fixture transaction: ${JSON.stringify(r).slice(0, 300)}`); return r; };
    let lifePicture = (await lifeTx([{ op: 'add_clip', args: { assetId: lifeEvening, start: f(0), duration: f(60) } }])).results[0].output.clipId as string;
    const lifeTitle = (await lifeTx([{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60) } }])).results[0].output.clipId as string;
    await lifeTx([{ op: 'update_text', args: { clipId: lifeTitle, text: 'שלום {year}' } }, { op: 'set_text_fields', args: { clipId: lifeTitle, enabled: true } }]);
    await lifeTx([{ op: 'cluster_events', args: {} }]);
    {
      const full = s.governance.createGrant({ name: 'a11y-people', mode: 'edit', people: 'full' }, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }).token;
      const r = await fetch(`${s.url}/api/v1/projects/${lifePid}/transactions`, { method: 'POST', headers: { authorization: `Bearer ${full}`, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ ops: [{ op: 'add_person', args: { name: 'נועה', birthDate: '2023-03-10', form: 'f' } }] }) });
      if (r.status !== 200) throw new Error(`the people fixture was refused: ${r.status} ${(await r.text()).slice(0, 300)}`);
    }
    const tplList = (((await (await fetch(`${s.url}/api/v1/templates`, { headers: h })).json()) as any).templates ?? []) as any[];
    const tplPick = tplList.find((t) => t.available && t.needs.music !== 'beats' && t.slots.every((x: any) => x.accept !== 'video')) ?? tplList.find((t) => t.available);
    // wave 6 notes. (1) A recording and a reversed copy of it: the copy is a real file made here by ffmpeg, stored through a side
    // project (one blob store) and attached by hand as a derived asset with no time mapping, as a provider's reversed rendition
    // would be (a typed fixture: no provider ran). One project per run: the cut that shows the note changes it.
    const revFile = path.join(art, 'reversed.mp4');
    const talkFile = path.join(art, 'recording.mp4'); // a transcript belongs to a file with sound
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-t', '4', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '4', '-i', 'sine=frequency=330:sample_rate=48000', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-shortest', talkFile]);
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', talkFile, '-vf', 'reverse', '-af', 'areverse', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', revFile]);
    const revSide = (await post('/projects', { name: 'a11y-untimed (blob side project)', width: 640, height: 360 })).project.id as string;
    const revUp: any = await (await fetch(`${s.url}/api/v1/projects/${revSide}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'reversed.mp4' }, body: fs.readFileSync(revFile) })).json();
    const { id: _revSideId, ...revAsset } = s.store.getProject(revSide).doc.assets[revUp.assetId]!;
    const untimedProject = async (name: string) => {
      const id = (await post('/projects', { name, width: 640, height: 360 })).project.id as string;
      const rec: any = await (await fetch(`${s.url}/api/v1/projects/${id}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'recording.mp4' }, body: fs.readFileSync(talkFile) })).json();
      const rev = s.store.commit({ projectId: id, actor: 'fixture', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { ...revAsset, name: 'reversed.mp4', provenance: { origin: 'derived', importedAt: new Date().toISOString(), importedBy: 'fixture', derived: { jobId: 'job_fixture', capabilityId: 'comfy.video.reverse', capabilityVersion: '0.1.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [rec.assetId], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' } } } } } }] }).results[0]!.output!.assetId as string;
      const spoken = ['שלום', 'אממ', 'עולם', 'טוב'];
      const made = await post(`/projects/${id}/transactions`, { ops: [
        { op: 'set_transcript', args: { assetId: rec.assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(2, 1), text: spoken.join(' '), words: spoken.map((text, k) => ({ text, start: T.rt(k, 2), duration: T.rt(1, 2) })) }] } },
        { op: 'add_clip', args: { assetId: rec.assetId, start: f(0), duration: f(60), withLinkedAudio: false } },
        { op: 'add_clip', args: { assetId: rev, start: f(60), duration: f(30), withLinkedAudio: false } },
      ] });
      if (!made.results) throw new Error(`untimed-copy fixture: ${JSON.stringify(made).slice(0, 300)}`);
      return id;
    };
    // (2) An archive of a project whose English translation (the typed fixture, as above) carries the owner's "reviewed" mark.
    const revPid = (await post('/projects', { name: 'a11y-review', width: 640, height: 360 })).project.id as string;
    const revMix: any = await (await fetch(`${s.url}/api/v1/projects/${revPid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'mix.wav' }, body: fs.readFileSync(mix) })).json();
    await post(`/projects/${revPid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: revMix.assetId, start: f(0) } }] });
    s.store.commit({ projectId: revPid, actor: 'fixture', ops: [{ op: 'set_transcript', args: { assetId: revMix.assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(1, 1), text: 'שלום לכולם' }] } }] });
    const revSeg = s.store.getProject(revPid).doc.transcripts[revMix.assetId]!.segments[0]!.id;
    const revVariant = s.store.commit({ projectId: revPid, actor: 'fixture', allowInternal: true, ops: [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: { from: 'he', to: 'en', engine: 'typed fixture (no model ran)', model: 'none', createdAt: new Date().toISOString(), createdBy: 'fixture', sources: { [revSeg]: sha256Hex('שלום לכולם') } }, phraseText: { [revSeg]: 'Hello everyone' }, cueText: {} } }] }).results[0]!.output!.variantId as string;
    s.store.commit({ projectId: revPid, actor: 'user:local', allowInternal: true, ops: [{ op: 'review_translation', args: { variantId: revVariant, review: 'reviewed', at: new Date().toISOString() } }] });
    const revArchiveRes = await fetch(`${s.url}/api/v1/projects/${revPid}/archive`, { headers: h });
    if (!revArchiveRes.ok) throw new Error(`the review-marks archive was refused: ${revArchiveRes.status} ${(await revArchiveRes.text()).slice(0, 200)}`);
    const revArchive = Buffer.from(await revArchiveRes.arrayBuffer());
    for (const lang of ['he', 'en'] as const) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      await page.addInitScript((l) => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem('pf.lang', l); } catch { /* storage unavailable */ } }, lang);
      await page.addInitScript('globalThis.__name = (f) => f'); // tsx/esbuild helper referenced by functions passed to page.evaluate
      await page.addInitScript(() => { (globalThis as { __pfPerformProof?: boolean }).__pfPerformProof = true; (globalThis as { __pfToastProof?: boolean }).__pfToastProof = true; }); // perform mode's test hook (injectTaps), as proof:perform sets it; the toast hook (window.__pfToast)
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor();
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.waitForTimeout(300);
      // Sensitivity check: plant three known defects and require the audit to report each, then remove them.
      await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'pf-a11y-planted';
        host.innerHTML = '<button id="planted-unnamed"></button><p id="planted-contrast">low contrast text</p><button id="planted-nofocus">no focus ring</button>';
        document.body.prepend(host);
        // The shell is a fixed grid that covers the window (ds/shell.css): the planted controls are lifted above it, so the
        // click at the corner that starts the focus walk lands on them, as it did while the shell was in the page flow.
        host.style.position = 'relative'; host.style.zIndex = '1000';
        // Styles are set through the DOM API: the page's content security policy blocks inline style attributes in markup.
        const low = host.querySelector<HTMLElement>('#planted-contrast')!, nf = host.querySelector<HTMLElement>('#planted-nofocus')!;
        low.style.color = '#3a3f47'; low.style.background = '#30343b';
        nf.style.outline = 'none'; nf.style.boxShadow = 'none';
      });
      const planted = await page.evaluate(auditInPage);
      const plantedFocus = await focusAudit(page, 4);
      const sensitivity = { unnamed: planted.unnamed.some((x: string) => x.includes('planted-unnamed')), contrast: planted.lowContrast.some((x: { el: string }) => x.el.includes('planted-contrast')), focus: plantedFocus.missing.some((x: string) => x.startsWith('button')) };
      await page.evaluate(() => document.getElementById('pf-a11y-planted')?.remove());
      if (!sensitivity.unnamed || !sensitivity.contrast || !sensitivity.focus) throw new Error(`the audit failed to detect planted defects: ${JSON.stringify(sensitivity)}`);
      const found = await page.evaluate(auditInPage);
      const focus = await focusAudit(page, 60);
      await page.screenshot({ path: path.join(art, `editor-${lang}.png`), fullPage: false });
      // --- transient states: each is audited like the resting page, and dialogs are also checked for keyboard behaviour
      const states: any[] = [];
      const auditState = async (name: string, extra: Record<string, unknown> = {}, modal = false) => {
        const r = await page.evaluate(auditInPage);
        const fr = await focusAudit(page, 14, !modal);
        states.push({ state: name, controls: r.controls, unnamed: r.unnamed, lowContrast: r.lowContrast, tabIssues: r.tabIssues, noFocusRing: fr.missing, ...extra });
        await page.screenshot({ path: path.join(art, `state-${name}-${lang}.png`) });
      };
      /** A modal dialog: focus starts inside, Tab never leaves it, Escape closes it, and focus goes back to what opened it. */
      const dialogBehaviour = async (dialogTestId: string, opener: () => Promise<void>, openerSelector: string) => {
        await opener();
        await page.getByTestId(dialogTestId).waitFor({ timeout: 8000 });
        await page.waitForTimeout(150);
        const inside = () => page.evaluate((id) => !!document.activeElement && !!document.querySelector(`[data-testid=${id}]`)?.contains(document.activeElement), dialogTestId);
        const startsInside = await inside();
        let escaped = 0;
        for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); if (!(await inside())) escaped++; }
        for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Tab'); if (!(await inside())) escaped++; }
        return { startsInside, tabStepsThatLeftTheDialog: escaped, close: async () => { const stillOpen = (await page.getByTestId(dialogTestId).count()) === 1; await page.keyboard.press('Escape'); await page.getByTestId(dialogTestId).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); await page.waitForTimeout(150); const where = await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName.toLowerCase()}${el.dataset?.testid ? `[data-testid=${el.dataset.testid}]` : ''}` : 'none'; }); return { openUntilEscape: stillOpen, closed: (await page.getByTestId(dialogTestId).count()) === 0, focusAfterClose: where, focusReturned: await page.evaluate((sel) => !!document.activeElement && document.activeElement.matches(sel), openerSelector) }; } };
      };
      /**
       * A toast raised while one of the editor's own modals is open (its own focus trap, not the design system's Dialog): audited as a
       * state of its own, with the modal's close (Escape typed on the toast's ×) assigned to both states, then the region back on the page.
       */
      const toastState = async (name: string, dialogTestId: string, d: { close: () => Promise<Record<string, unknown>> }, alsoOnPrevious = true) => {
        const prev = alsoOnPrevious ? states.at(-1) : null;
        await auditState(name, await toastInOpenModal(page, lang, dialogTestId), true);
        const mine = states.at(-1);
        const closed = await d.close();
        if (prev) Object.assign(prev, closed);
        Object.assign(mine, closed, await toastAfterModal(page));
        if (mine.toastBackOnPage === false) mine.shown = false;
      };
      // marker bar (a marker sits on frame 0, where the playhead is)
      await page.locator('[data-testid=marker-bar]').waitFor({ timeout: 5000 }).catch(() => {});
      await auditState('marker-bar', { shown: (await page.getByTestId('marker-bar').count()) === 1 });
      // a linked format selected: format badge, safe-area guide, "edited for this format only" notes
      // the format chooser is the stage header's FormatPrism radiogroup (UX_REDESIGN §8): one chip per linked format, '' the master
      const variantId = (await formatOptions(page))[0] ?? '';
      if (variantId) { await chooseFormat(page, variantId); await page.getByTestId('format-badge').waitFor({ timeout: 5000 }).catch(() => {}); }
      await auditState('format-view', { formatSelected: !!variantId, scopeNotes: await page.locator('[data-testid=transform-scope][data-scope=format], [data-testid=caption-scope]').count() });
      if (variantId) await chooseFormat(page, '');
      // project manager dialog
      const pd = await dialogBehaviour('projects-dialog', async () => { await page.getByTestId('projects-open').click(); }, '[data-testid=projects-open]');
      await auditState('projects-dialog', { startsInside: pd.startsInside, tabStepsThatLeftTheDialog: pd.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await pd.close());
      // project manager with the delete confirmation form open (a transient form inside the dialog)
      await page.getByTestId('projects-open').click();
      await page.getByTestId('projects-dialog').waitFor();
      await page.getByTestId('project-delete').first().click();
      await page.getByTestId('project-delete-confirm').waitFor({ timeout: 5000 }).catch(() => {});
      await auditState('project-delete-confirmation', { formShown: (await page.getByTestId('project-delete-confirm').count()) === 1, applyDisabledUntilTyped: await page.getByTestId('project-delete-apply').isDisabled().catch(() => null) }, true);
      await page.keyboard.press('Escape');
      await page.getByTestId('projects-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      // an error shown to the user: an edit the server refuses (a clip on a locked track, changed behind the editor's back)
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'update_track', args: { trackId: (await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json() as any).project.sequences.seq_main.tracks.find((t: any) => t.clips.some((c: any) => c.id === clipId)).id, locked: true } }] });
      await page.locator('[data-locked=true]').first().waitFor({ timeout: 8000 }).catch(() => {});
      await auditState('locked-track', { lockedTracksShown: await page.locator('.track[data-locked=true]').count(), pressedLockButtons: await page.locator('[data-testid=track-lock][aria-pressed=true]').count() });
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'update_track', args: { trackId: (await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json() as any).project.sequences.seq_main.tracks.find((t: any) => t.locked).id, locked: false } }] });
      await page.waitForFunction(() => !document.querySelector('.track[data-locked=true]'), undefined, { timeout: 8000 }).catch(() => {});
      // an upload in progress (ADR-0023: media goes through the import queue; the picker is never disabled, the upload is a card
      // «בהעלאה» with its cancel button), then the failed import card: a file that is not media is sent, the request is held
      // while the busy state is audited, then the server stores it and the import fails as unsupported
      let release: () => void = () => {};
      const held = new Promise<void>((r) => { release = r; });
      const hold = async (route: any) => { if (route.request().method() === 'POST') await held; await route.continue(); };
      await page.route('**/api/v1/projects/*/imports', hold);
      await page.getByTestId('file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a media file') });
      await page.locator('[data-testid^=import-local-]').first().waitFor({ timeout: 5000 }).catch(() => {});
      await auditState('upload-busy', { shown: (await page.locator('[data-testid^=import-local-] [data-testid=import-cancel]').count()) === 1 && !(await page.getByTestId('file-input').isDisabled()) });
      release();
      const failedCard = page.locator('[data-testid^=import-card-][data-state=attention]').first();
      await failedCard.waitFor({ timeout: 30000 }).catch(() => {});
      await page.unroute('**/api/v1/projects/*/imports', hold);
      await auditState('import-card-failed', { shown: (await failedCard.count()) === 1 && (await failedCard.getByTestId('import-dismiss').count()) === 1 && (await page.getByTestId('imports-summary').count()) === 1 });
      if (await failedCard.count()) await failedCard.getByTestId('import-dismiss').click();
      await page.locator('[data-testid^=import-card-]').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
      // the error bar: a colour table (.cube) keeps the synchronous upload, and one that is not a colour table is refused there
      await page.getByTestId('file-input').setInputFiles({ name: 'broken.cube', mimeType: 'text/plain', buffer: Buffer.from('this is not a colour table') });
      await page.locator('.error[role=alert]').waitFor({ timeout: 10000 }).catch(() => {});
      const errShown = (await page.locator('.error[role=alert]').count()) === 1;
      await auditState('error-bar', { shown: errShown, text: errShown ? ((await page.locator('.error[role=alert]').textContent()) ?? '').slice(0, 120) : '' });
      if (errShown) await page.locator('.error[role=alert] button').click();
      Object.assign(states.at(-1), { closed: (await page.locator('.error[role=alert]').count()) === 0 });
      // the export sheet (owner decision 2026-11-17: Export always opens it): a modal dialog, audited on its settings step with
      // the dialog checks, then an export in progress: the sheet shows a progressbar and a cancel button, the top bar's ring
      // chip says it runs (Export itself starts nothing, so it is not disabled any more); the export is then cancelled
      const xs = await dialogBehaviour('export-sheet', async () => { await page.getByTestId('export').click(); }, '[data-testid=export]');
      await auditState('export-sheet', { startsInside: xs.startsInside, tabStepsThatLeftTheDialog: xs.tabStepsThatLeftTheDialog, shown: (await page.getByTestId('export-start').count()) === 1 }, true);
      await page.getByTestId('export-start').click();
      await page.getByTestId('export-cancel').waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('export-busy', { shown: (await page.getByTestId('export-cancel').count()) === 1 && (await page.locator('[data-testid=export-progress] [role=progressbar]').count()) >= 1 && (await page.locator('[data-testid=export-ring][data-status=running]').count()) === 1 }, true);
      if (await page.getByTestId('export-cancel').count()) await page.getByTestId('export-cancel').click();
      await page.getByTestId('export-cancel').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
      Object.assign(states.at(-1), { closed: (await page.getByTestId('export-cancel').count()) === 0, canceledShown: (await page.getByTestId('export-canceled').count()) === 1 });
      Object.assign(states.at(-2), await xs.close());
      if (await page.locator('.error[role=alert] button').count()) await page.locator('.error[role=alert] button').click(); // a cancelled export is not reported as an error; close one if it is
      // source viewer dialog
      // the media card's "view" is an item of its ⋯ menu (UX_REDESIGN §8); the menu closes as the viewer opens, so the focus goes back to the ⋯ button
      const sv = await dialogBehaviour('source-viewer', async () => { await openCardMenu(page, up.assetId); await page.getByTestId(`view-${up.assetId}`).click(); }, `[data-testid="view-${up.assetId}"], [data-testid="more-${up.assetId}"]`);
      await auditState('source-viewer', { startsInside: sv.startsInside, tabStepsThatLeftTheDialog: sv.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await sv.close());
      // full history dialog
      const ad = await dialogBehaviour('activity-dialog', async () => { await page.getByTestId('activity-open').click(); }, '[data-testid=activity-open]');
      await auditState('activity-dialog', { startsInside: ad.startsInside, tabStepsThatLeftTheDialog: ad.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await ad.close());
      // the phone drop dialog (ADR-0023) with a live code: QR, typed address and PIN, status; Esc hides it and leaves the chip
      if (!/\bis-on\b/.test((await page.getByTestId('rail-media').getAttribute('class')) ?? '')) { await page.getByTestId('rail-media').click(); await page.waitForTimeout(300); }
      const pdd = await dialogBehaviour('phone-drop-dialog', async () => { await page.getByTestId('import-more').click(); await page.getByTestId('phone-drop-open').click(); await page.getByTestId('phone-drop-dialog').waitFor({ timeout: 8000 }); await page.getByTestId('phone-drop-address').waitFor({ timeout: 8000 }).catch(() => {}); if (await page.getByTestId('phone-drop-start').count()) await page.getByTestId('phone-drop-start').click(); await page.getByTestId('phone-drop-qr').waitFor({ timeout: 8000 }).catch(() => {}); }, '[data-testid=import-more]');
      await auditState('phone-drop-dialog', { startsInside: pdd.startsInside, tabStepsThatLeftTheDialog: pdd.tabStepsThatLeftTheDialog, shown: (await page.getByTestId('phone-drop-qr').count()) === 1 && (await page.getByTestId('phone-drop-pin').count()) === 1 }, true);
      Object.assign(states.at(-1), await pdd.close());
      await page.getByTestId('phone-drop-chip').waitFor({ timeout: 5000 }).catch(() => {});
      await auditState('phone-drop-chip', { shown: (await page.getByTestId('phone-drop-chip').count()) === 1 && (await page.getByTestId('phone-drop-chip-close').count()) === 1 });
      if (await page.getByTestId('phone-drop-chip-close').count()) await page.getByTestId('phone-drop-chip-close').click();
      await page.getByTestId('phone-drop-chip').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      // command palette
      const cp = await dialogBehaviour('palette-dialog', async () => { await page.getByTestId('projects-open').focus(); await page.keyboard.press('Control+k'); }, '[data-testid=projects-open]');
      await auditState('command-palette', { startsInside: cp.startsInside, tabStepsThatLeftTheDialog: cp.tabStepsThatLeftTheDialog }, true);
      await toastState('toast-in-palette', 'palette-dialog', cp);
      // the Hebrew command bar (ADR-0027): a plan's preview (the bar's row first and active, its steps, the live region and the
      // preview outside the listbox), a question's choices with the first choice active, and Settings «עוזר השפה» (owner only)
      {
        const openBar = async (text: string) => {
          await page.getByTestId('open-palette').focus();
          await page.keyboard.press('Control+k');
          await page.getByTestId('palette-input').waitFor({ timeout: 8000 });
          await page.keyboard.type(text);
          await page.waitForFunction((q) => document.querySelector<HTMLInputElement>('[data-testid=palette-input]')?.value === q && !!document.querySelector<HTMLElement>('[data-testid=bar-result]')?.dataset.kind, text, { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(700); // the live region speaks after 500 ms of quiet
        };
        const outside = () => page.evaluate(() => [...document.querySelectorAll('[role=listbox] [role]')].every((e) => ['option', 'group'].includes(e.getAttribute('role') ?? '')) && !document.querySelector('[role=listbox] #pf-bar-preview, [role=listbox] [data-testid=bar-live]'));
        const rowSeen = () => page.evaluate(() => { const el = document.querySelector('[data-testid=bar-result]'); if (!el) return false; const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.height >= 30 && !!hit?.closest('[data-testid=bar-result]'); });
        const activeId = () => page.evaluate(() => document.querySelector('[data-testid=palette-input]')?.getAttribute('aria-activedescendant'));
        await openBar(lang === 'he' ? 'הוסף כותרת "בדיקה" כאן' : 'add title "test" here');
        await auditState('command-bar-preview', { shown: (await page.locator('[data-testid=bar-result][data-kind=plan]').count()) === 1 && (await page.getByTestId('bar-step').count()) === 1 && (await activeId()) === 'pf-palette-opt-bar' && (await outside()) && (await rowSeen()) }, true);
        await page.keyboard.press('Escape');
        await page.getByTestId('palette-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        // a question with two or more choices in this project (its two audio tracks and the clip; «סנכרן לקצב» has one choice
        // here because no music of this project has a beat analysis)
        await openBar(lang === 'he' ? 'הגבר את הקול ב־3 דציבל' : 'turn the sound up 3 dB');
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        await auditState('command-bar-choices', { shown: (await page.locator('[data-testid=bar-result][data-kind=ambiguous]').count()) === 1 && (await page.getByTestId('bar-choice').count()) >= 2 && (await activeId()) === 'pf-palette-opt-bar-choice-0' && (await outside()) }, true);
        await page.keyboard.press('Escape');
        await page.getByTestId('palette-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        await page.getByTestId('rail-settings').click();
        await page.getByTestId('assistant-settings').waitFor({ timeout: 8000 }).catch(() => {});
        await page.getByTestId('assistant-setup').waitFor({ timeout: 8000 }).catch(() => {});
        await page.getByTestId('assistant-settings').scrollIntoViewIfNeeded().catch(() => {});
        await auditState('assistant-settings', { shown: (await page.getByTestId('assistant-settings').count()) === 1 && (await page.getByTestId('assistant-setup').getAttribute('data-setup').catch(() => null)) === 'provider_not_configured' && (await page.getByTestId('assistant-key').getAttribute('type').catch(() => null)) === 'password' }, true);
        await page.keyboard.press('Escape');
        await page.getByTestId('settings-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      }
      // the redesign's menus (UX_REDESIGN §4.2, §4.4): the agent avatar's menu and a media card's ⋯ menu. Focus starts on the
      // first item, Escape closes the menu and gives the focus back to its button. Audited before the focus walk (Tab closes a menu).
      const menuBehaviour = async (name: string, button: string) => {
        await page.locator(button).click();
        await page.locator('[role=menu]').first().waitFor({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(150);
        const startsInside = await page.evaluate(() => !!document.activeElement?.closest('[role=menu]'));
        const items = await page.locator('[role=menu] [role^=menuitem]').count();
        await auditState(name, { startsInside, shown: items > 0 }, true);
        if (await page.locator('[role=menu]').count()) { await page.locator(button).focus().catch(() => {}); await page.locator(button).click(); }
        await page.locator(button).click(); await page.locator('[role=menu]').first().waitFor({ timeout: 5000 }).catch(() => {});
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        Object.assign(states.at(-1), { closed: (await page.locator('[role=menu]').count()) === 0, focusReturned: await page.evaluate((sel) => !!document.activeElement?.matches(sel), button) });
      };
      await menuBehaviour('agent-menu', '[data-testid=agent-menu]');
      await menuBehaviour('media-card-menu', `[data-testid="more-${up.assetId}"]`);
      // the settings dialog (the rail's settings button)
      const sd = await dialogBehaviour('settings-dialog', async () => { await page.getByTestId('rail-settings').click(); }, '[data-testid=rail-settings]');
      await auditState('settings-dialog', { startsInside: sd.startsInside, tabStepsThatLeftTheDialog: sd.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await sd.close());
      // the effect gallery (ADR-0011: its time and overlay tiles animate on hover, through a FlashGuard); opened from the look panel of the selected clip
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.getByTestId('gallery-open').waitFor({ timeout: 8000 });
      const gd = await dialogBehaviour('effect-gallery', async () => { await page.getByTestId('gallery-open').click(); }, '[data-testid=gallery-open]');
      await auditState('effect-gallery', { startsInside: gd.startsInside, tabStepsThatLeftTheDialog: gd.tabStepsThatLeftTheDialog }, true);
      await toastState('toast-in-effect-gallery', 'effect-gallery', gd);
      // the look panel with the visual wave's controls (ADR-0011): a blur whose radius follows the beat (its fieldset open), a
      // date stamp (its text field and hint) and an echo (first, with the separator that names the rule); no music here, so the
      // ♪ toggles are off with their note. The focus walk starts in the fieldset. The effects are removed again afterwards.
      const added = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian', params: { radius: 0.01 } } }, { op: 'add_effect', args: { clipId, type: 'stylize.date-stamp' } }, { op: 'add_effect', args: { clipId, type: 'time.echo' } }] });
      const waveFx: string[] = (added.results ?? []).map((r: any) => r.output.effectId as string);
      if (waveFx.length !== 3) throw new Error(`adding the visual-wave effects failed: ${JSON.stringify(added).slice(0, 300)}`);
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'set_effect_modulator', args: { clipId, effectId: waveFx[0], param: 'radius', modulator: { depth: 0.02 } } }] });
      await page.getByTestId('beat-fieldset').waitFor({ timeout: 8000 }).catch(() => {});
      await page.getByTestId('beat-fieldset').scrollIntoViewIfNeeded().catch(() => {});
      await page.getByTestId('beat-every').focus().catch(() => {});
      const lookShown = { fieldset: await page.getByTestId('beat-fieldset').count(), separator: await page.getByTestId('time-separator').count(), stampField: await page.getByTestId('effect-stamp').count(), beatToggles: await page.getByTestId('beat-toggle').count() };
      await auditState('look-visual-wave', { shown: lookShown.fieldset === 1 && lookShown.separator === 1 && lookShown.stampField === 1 && lookShown.beatToggles >= 1, ...lookShown }, true);
      await post(`/projects/${pid}/transactions`, { ops: waveFx.map((effectId) => ({ op: 'remove_effect', args: { clipId, effectId } })) });
      await page.getByTestId('beat-fieldset').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
      // ---- AI-model wave (ADR-0017) ----
      // the AI tools panel, sound tab, with the classic vocal remover's run sheet open on the selected stereo clip
      await page.locator(`.clip[data-clip-id="${mixClip}"]`).click();
      await page.getByTestId('rail-ai').click(); // the AI tools are the rail's AI category (UX_REDESIGN §4.11)
      const soundTab = page.locator('[data-testid=ai-tab][data-tab=sound]');
      if (await soundTab.count()) await soundTab.click();
      const vocals = page.locator('[data-testid=ai-tool][data-id="local.audio.vocals-classic"]');
      const vocalsShown = (await vocals.count()) === 1;
      if (vocalsShown) { await vocals.getByTestId('ai-open-run').click(); await vocals.getByTestId('ai-run-sheet').waitFor({ timeout: 8000 }).catch(() => {}); await vocals.getByTestId('ai-open-run').focus(); }
      await auditState('ai-tools-run-sheet', { shown: vocalsShown && (await vocals.getByTestId('ai-run-sheet').count()) === 1, tabs: await page.locator('[data-testid=ai-tab]').count() }, true);
      // a run in place of the clip's file, then the before/after compare slider (focused; the focus walk starts there)
      let compareShown = false;
      if (vocalsShown) {
        await vocals.getByTestId('ai-apply-replace-clip').check().catch(() => {});
        await vocals.getByTestId('ai-run').click().catch(() => {});
        await vocals.getByTestId('ai-compare-slider').waitFor({ timeout: 60000 }).catch(() => {});
        compareShown = (await vocals.getByTestId('ai-compare-slider').count()) === 1;
        if (compareShown) await vocals.getByTestId('ai-compare-slider').focus();
      }
      await auditState('ai-result-compare', { shown: compareShown, progressbar: await vocals.locator('[role=progressbar]').count() }, true);
      if (compareShown) { await vocals.getByTestId('ai-undo').click().catch(() => {}); await page.waitForTimeout(500); }
      // the translation review in the transcript panel (all Inspector panels are shown; the rail back on media gives the inspector back its panels)
      await page.getByTestId('rail-media').click();
      const review = page.getByTestId('translation-review');
      await review.waitFor({ timeout: 8000 }).catch(() => {});
      const reviewShown = (await review.count()) === 1;
      if (reviewShown) { await review.scrollIntoViewIfNeeded().catch(() => {}); await review.getByTestId('translation-limit').focus().catch(() => {}); }
      await auditState('translation-review', { shown: reviewShown && (await review.getByTestId('translation-row').count()) === 1 }, true);

      // motion tracking (ADR-0015): a track of the clip's file, a privacy region that follows it and the title following it.
      // States: the video clip (tracking panel, follow controls, privacy regions with the standing warning), the title (its
      // follow controls), and the track picker on the monitor (focus on the picture; Escape closes it and gives the focus back).
      const mt = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'create_motion_track', args: { assetId: up.assetId, name: 'נקודה', kind: 'point', frame: 0, x: 5000, y: 6000 } }] });
      const mtk = mt.results?.[0]?.output?.motionTrackId as string | undefined;
      if (!mtk) throw new Error(`creating a motion track failed: ${JSON.stringify(mt).slice(0, 300)}`);
      const projectNow: any = (await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json()).project;
      const videoTrackId = projectNow.sequences.seq_main.tracks.find((t: any) => t.clips.some((c: any) => c.id === clipId)).id as string;
      const titleId = tx.results[1].output.clipId as string;
      const bound = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'set_redact_region', args: { clipId, region: { motionTrackId: mtk } } }, { op: 'set_clip_follow', args: { clipId: titleId, follow: { motionTrackId: mtk, targetTrackId: videoTrackId, scale: false, smooth: 0 }, offset: { x: 0, y: 0 } } }] });
      if (!bound.results) throw new Error(`binding the motion track failed: ${JSON.stringify(bound).slice(0, 300)}`);
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.getByTestId('redact-warning').waitFor({ timeout: 8000 }).catch(() => {});
      await page.getByTestId('tracking-panel').scrollIntoViewIfNeeded().catch(() => {});
      const trackingShown = { panel: await page.getByTestId('tracking-panel').count(), items: await page.getByTestId('mtrack-item').count(), follow: await page.getByTestId('follow-controls').count(), redact: await page.getByTestId('redact-controls').count(), warning: await page.getByTestId('redact-warning').count(), warningRole: await page.getByTestId('redact-warning').getAttribute('role').catch(() => null) };
      await auditState('tracking-video-clip', { shown: trackingShown.panel === 1 && trackingShown.items === 1 && trackingShown.follow === 1 && trackingShown.redact === 1 && trackingShown.warning === 1 && trackingShown.warningRole === 'status', ...trackingShown });
      await clickClipEnd(page, titleId);
      await page.getByTestId('follow-detach').waitFor({ timeout: 8000 }).catch(() => {});
      await page.getByTestId('follow-controls').scrollIntoViewIfNeeded().catch(() => {});
      const followShown = { detach: await page.getByTestId('follow-detach').count(), scale: await page.getByTestId('follow-scale').count(), smooth: await page.getByTestId('follow-smooth').count(), state: await page.getByTestId('follow-state').count() };
      await auditState('tracking-follower', { shown: followShown.detach === 1 && followShown.scale === 1 && followShown.smooth === 1 && followShown.state === 1, ...followShown });
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.getByTestId('mtrack-new-point').click();
      await page.getByTestId('track-picker').waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(150);
      const pickerFocused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'track-picker');
      await auditState('track-picker', { shown: (await page.getByTestId('track-picker').count()) === 1 && (await page.getByTestId('track-picker-confirm').count()) === 1, pickerFocused }, true);
      await page.getByTestId('track-picker').focus().catch(() => {});
      await page.keyboard.press('Escape');
      await page.getByTestId('track-picker').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(150);
      Object.assign(states.at(-1), { closed: (await page.getByTestId('track-picker').count()) === 0, focusReturned: await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'mtrack-new-point'), startsInside: pickerFocused });
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'remove_motion_track', args: { motionTrackId: mtk, unbind: true } }] });
      await page.getByTestId('mtrack-item').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});

      // the title effects panel (ADR-0012): the title selected and all six look fields on, so every control shows; the focus walk starts in the panel
      const textClipId = tx.results[1].output.clipId as string;
      const looks = { gradient: { colors: ['#FFD166', '#3A5BFF', '#8A2BE2'], angle: 90 }, tracking: 0.1, stroke2: { color: '#111111', widthFrac: 0.06 }, glow: { color: '#FF2BD6', radiusFrac: 0.5, intensity: 0.8 }, extrude: { color: '#1D3557', depthFrac: 0.15, angle: 45, shade: 0.5 }, longShadow: { color: '#0000004D', lengthFrac: 1.5, angle: 45 } };
      const fxOn = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'update_text', args: { clipId: textClipId, style: looks } }] });
      if (!fxOn.results) throw new Error(`turning the title looks on failed: ${JSON.stringify(fxOn).slice(0, 300)}`);
      await clickClipEnd(page, textClipId);
      await page.getByTestId('text-effects').waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=text-effects] input[type=checkbox]:checked').length >= 7, undefined, { timeout: 8000 }).catch(() => {});
      await page.getByTestId('text-effects').scrollIntoViewIfNeeded().catch(() => {});
      await page.getByTestId('text-fx-gradient').focus().catch(() => {});
      const fxShown = { panel: await page.getByTestId('text-effects').count(), checked: await page.locator('[data-testid=text-effects] input[type=checkbox]:checked').count(), status: await page.getByTestId('text-fx-status').count(), removeAll: await page.getByTestId('text-fx-remove-all').count(), colourFields: await page.locator('[data-testid=text-effects] input[type=color]').count() };
      await auditState('text-effects', { shown: fxShown.panel === 1 && fxShown.checked >= 6 && fxShown.status === 1 && fxShown.removeAll === 1 && fxShown.colourFields >= 7, ...fxShown }, true);
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'update_text', args: { clipId: textClipId, style: Object.fromEntries(Object.keys(looks).map((k) => [k, null])) } }] });
      // the transition options (ADR-0012) of a light transition between two short clips of the fixture (film-burn declares colour,
      // seed and light, so every control of the panel shows); the clips are removed again afterwards
      const pair = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(200), duration: f(40), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: up.assetId, start: f(240), duration: f(40), withLinkedAudio: false } }] });
      const [pairA, pairB] = (pair.results ?? []).map((r: any) => r.output.clipId as string);
      const trSet = pairB ? await post(`/projects/${pid}/transactions`, { ops: [{ op: 'set_transition', args: { clipId: pairB, type: 'film-burn', frames: 10 } }] }) : null;
      if (pairB && trSet?.results) {
        await page.locator(`.clip[data-clip-id="${pairB}"]`).click();
        await page.getByTestId('transition-options').waitFor({ timeout: 8000 }).catch(() => {});
        await page.getByTestId('transition-options').scrollIntoViewIfNeeded().catch(() => {});
        await page.getByTestId('transition-sync').focus().catch(() => {});
      }
      const trShown = { options: await page.getByTestId('transition-options').count(), sync: await page.getByTestId('transition-sync').count(), velocity: await page.getByTestId('transition-velocity').count(), colour: await page.getByTestId('transition-color').count(), seed: await page.getByTestId('transition-seed').count(), lightStatus: await page.getByTestId('transition-light-status').count(), transitionSet: !!trSet?.results };
      await auditState('transition-options', { shown: trShown.transitionSet && trShown.options === 1 && trShown.sync === 1 && trShown.velocity === 1 && trShown.colour >= 1 && trShown.seed >= 1 && trShown.lightStatus === 1, ...trShown }, true);
      if (pairA || pairB) await post(`/projects/${pid}/transactions`, { ops: [pairA, pairB].filter(Boolean).map((id) => ({ op: 'delete_clip', args: { clipId: id } })) });

      // ---- templates and adjustment layers (ADR-0016), in their own project ----
      await page.goto(`${s.ownerUrl}&project=${tplPid}`);
      await page.getByTestId('timecode').waitFor();
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      // an adjustment clip's inspector: opacity only, its note, mask and blend, "apply to" absent (it is the adjustment)
      if (adjClip) await page.locator(`.clip[data-clip-id="${adjClip}"]`).click();
      await page.getByTestId('adjust-opacity').waitFor({ timeout: 8000 }).catch(() => {});
      await auditState('adjustment-inspector', { shown: (await page.getByTestId('adjust-opacity').count()) === 1 && (await page.getByTestId('adjust-note').count()) === 1 });
      // the Look panel of a picture clip with "apply to: the whole edit" chosen
      await page.locator('.track.video .clip').first().click();
      await page.getByTestId('apply-to-edit').check().catch(() => {});
      await auditState('apply-to-whole-edit', { shown: (await page.getByTestId('apply-to-edit').isChecked().catch(() => false)) === true });
      // the Templates drawer (the rail's Templates category): its first card sits at the inline start (the right edge in Hebrew)
      await page.getByTestId('rail-templates').click();
      if ((await page.getByTestId('templates-toggle').getAttribute('aria-expanded')) !== 'true') await page.getByTestId('templates-toggle').click();
      await page.locator('[data-testid=template-card]').first().waitFor({ timeout: 10000 }).catch(() => {});
      const cards = await page.locator('[data-testid=template-card]').count();
      const edge = await page.evaluate((rtl) => {
        const list = document.querySelector('[data-testid=templates-drawer] .pf-tpl-cards'), first = document.querySelector('[data-testid=template-card]');
        if (!list || !first) return null;
        const a = list.getBoundingClientRect(), b = first.getBoundingClientRect();
        return { gapAtInlineStart: Number((rtl ? a.right - b.right : b.left - a.left).toFixed(2)), cardWidth: Math.round(b.width), listWidth: Math.round(a.width) };
      }, lang === 'he');
      await auditState('templates-drawer', { shown: cards > 0, cards, firstCardAtInlineStart: !!edge && Math.abs(edge.gapAtInlineStart) <= 1, edge });
      // the template dialog: its first step, then the plan step (a polite live region); Escape gives the focus back to the card
      const tplCard = `[data-testid=template-card][data-template-id="${tplPick?.id ?? ''}"]`;
      const td = await dialogBehaviour('template-dialog', async () => { await page.locator(tplCard).click(); }, tplCard);
      await auditState('template-dialog', { startsInside: td.startsInside, tabStepsThatLeftTheDialog: td.tabStepsThatLeftTheDialog }, true);
      const dialogState = states.at(-1);
      await page.locator('[data-testid=template-step][data-step=plan]').click();
      await page.waitForFunction(() => !!document.querySelector('[data-testid=template-plan-summary]') || !!document.querySelector('[data-testid=template-error]'), undefined, { timeout: 30000 }).catch(() => {});
      await auditState('template-dialog-plan', { shown: (await page.getByTestId('template-plan-summary').count()) === 1, live: await page.getByTestId('template-plan').getAttribute('aria-live').catch(() => null) }, true);
      Object.assign(dialogState, await td.close());
      // a toast while the template dialog is open: the dialog is opened again from its card, audited with the toast, and closed with Escape
      await toastState('toast-in-template-dialog', 'template-dialog', await dialogBehaviour('template-dialog', async () => { await page.locator(tplCard).click(); }, tplCard), false);
      // the post-apply bar: the template is applied from the dialog, audited, and undone
      await page.locator(tplCard).click();
      await page.getByTestId('template-dialog').waitFor({ timeout: 8000 }).catch(() => {});
      await page.locator('[data-testid=template-step][data-step=plan]').click().catch(() => {});
      await page.waitForFunction(() => !!document.querySelector('[data-testid=template-plan-summary]') || !!document.querySelector('[data-testid=template-error]'), undefined, { timeout: 30000 }).catch(() => {});
      await page.getByTestId('template-use').click({ timeout: 5000 }).catch(() => {});
      await page.getByTestId('template-applied').waitFor({ timeout: 30000 }).catch(() => {});
      if (await page.getByTestId('template-dialog').count()) await page.keyboard.press('Escape');
      await auditState('template-applied', { shown: (await page.getByTestId('template-applied').count()) === 1, template: tplPick?.id ?? null });
      // a picture the template placed, deleted by hand: the bar offers «החזרת החלקים שנמחקו»; the delete is undone after the audit
      {
        const rr = await restoreRemovedState(page, lang);
        await auditState('template-restore-removed', rr.extra);
        Object.assign(states.at(-1), await rr.undo());
      }
      if (await page.getByTestId('template-undo').count()) { await page.getByTestId('template-undo').click(); await page.getByTestId('template-applied').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500); }
      // the life line and the pack mounts, in the life project (the picture under the title is restored for the second language)
      await page.goto(`${s.ownerUrl}&project=${lifePid}`);
      await page.getByTestId('timecode').waitFor();
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      /** Opens a rail category (a click on the category already open would close its drawer). */
      const railOn = async (c: string) => { if (!/\bis-on\b/.test((await page.getByTestId(`rail-${c}`).getAttribute('class')) ?? '')) await page.getByTestId(`rail-${c}`).click(); await page.waitForTimeout(300); };
      await railOn('media');
      await page.getByTestId('life-view-date').click();
      await page.getByTestId('life-year-2024').waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('life-library-dates', { shown: (await page.getByTestId('life-year-2024').count()) === 1 && (await page.getByTestId('life-year-2023').count()) === 1 && (await page.getByTestId('life-undated').count()) === 1 && (await page.getByTestId(`life-date-${lifeEvening}`).count()) === 1 });
      await page.getByTestId('life-view-events').click();
      await page.locator('[data-testid^="life-event-"][data-event-id]').first().waitFor({ timeout: 10000 }).catch(() => {});
      const lifeEvents = { events: await page.locator('[data-testid^="life-event-"][data-event-id]').count(), sunsetRadios: await page.locator('[data-testid^="life-sunset-"] input[type=radio]').count() };
      await auditState('life-library-events', { shown: lifeEvents.events >= 2 && lifeEvents.sunsetRadios === 2, ...lifeEvents });
      // the family film (ADR-0026) from the event card: the dialog's three steps (a modal: focus inside, Escape, focus back to the
      // card's «סרט מהאירוע»), then the film made, its bar with the «why» list, and the inspector's reasons of a film clip; undone after
      {
        const opener = '[data-testid=film-open][data-variant=event-card]';
        await page.locator(opener).first().waitFor({ timeout: 8000 }).catch(() => {});
        const hasOpener = (await page.locator(opener).count()) >= 1;
        await auditState('film-entry-event-card', { shown: hasOpener });
        if (hasOpener) {
          const fd = await dialogBehaviour('film-dialog', async () => { await page.locator(opener).first().click(); }, opener);
          await auditState('film-dialog-what', { startsInside: fd.startsInside, tabStepsThatLeftTheDialog: fd.tabStepsThatLeftTheDialog, shown: (await page.getByTestId('film-step-what').count()) === 1 }, true);
          await page.getByTestId('film-next').click();
          await page.getByTestId('film-step-length').waitFor({ timeout: 8000 }).catch(() => {});
          await auditState('film-dialog-length', { shown: (await page.getByTestId('film-step-length').count()) === 1 }, true);
          await page.getByTestId('film-next').click();
          await page.locator('[data-testid=film-plan-row]').first().waitFor({ timeout: 60000 }).catch(() => {});
          await auditState('film-dialog-plan', { shown: (await page.locator('[data-testid=film-plan-row]').count()) >= 1 && (await page.locator('[data-testid=film-reason]').count()) >= 1 }, true);
          Object.assign(states.at(-1), await fd.close());
          // make the film (the same three steps, then «יצירת הסרט»)
          await page.locator(opener).first().click();
          await page.getByTestId('film-dialog').waitFor({ timeout: 8000 }).catch(() => {});
          await page.getByTestId('film-next').click(); await page.getByTestId('film-next').click();
          await page.locator('[data-testid=film-plan-row]').first().waitFor({ timeout: 60000 }).catch(() => {});
          await page.getByTestId('film-apply').click();
          await page.getByTestId('film-bar').waitFor({ timeout: 30000 }).catch(() => {});
          await auditState('film-bar', { shown: (await page.getByTestId('film-bar').count()) === 1 });
          await page.getByTestId('film-bar-why').click().catch(() => {});
          await page.getByTestId('film-bar-why-list').waitFor({ timeout: 5000 }).catch(() => {});
          await auditState('film-bar-why', { shown: (await page.getByTestId('film-bar-why-list').count()) === 1 });
          const lifeDoc: any = (await (await fetch(`${s.url}/api/v1/projects/${lifePid}`, { headers: h })).json()).project;
          const filmRun: any = Object.values(lifeDoc.recipeRuns ?? {}).find((r: any) => r.recipeId === 'template:tpl.family-film');
          const filmClip = filmRun?.slots?.find((x: any) => x.kind === 'picture')?.clipId as string | undefined;
          if (filmClip) {
            await page.locator(`.clip[data-clip-id="${filmClip}"]`).click().catch(() => {});
            await page.getByTestId('film-why').waitFor({ timeout: 8000 }).catch(() => {});
          }
          await auditState('film-why', { shown: (await page.getByTestId('film-why').count()) === 1 && (await page.getByTestId('film-why-reason').count()) === 1 });
          if (await page.getByTestId('film-bar-undo').count()) { await page.getByTestId('film-bar-undo').click(); await page.getByTestId('film-bar').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {}); }
          await railOn('media');
        }
      }
      await page.getByTestId('life-view-all').click();
      // the title with a live field: its field menu (a menu), then the people sheet opened from it (a modal dialog)
      await page.locator(`.clip[data-clip-id="${lifeTitle}"]`).click();
      await page.getByTestId('field-add').waitFor({ timeout: 8000 }).catch(() => {});
      await menuBehaviour('field-menu', '[data-testid=field-add]');
      const ps = await dialogBehaviour('life-people', async () => { await page.getByTestId('field-add').click(); await page.getByTestId('field-item-add-person').click(); }, '[data-testid=field-add]');
      await auditState('people-sheet', { startsInside: ps.startsInside, tabStepsThatLeftTheDialog: ps.tabStepsThatLeftTheDialog, shown: (await page.locator('[data-testid^="life-person-"][data-person-id]').count()) >= 1 && (await page.getByTestId('life-people-privacy').count()) === 1 }, true);
      Object.assign(states.at(-1), await ps.close());
      // a toast while a modal is open (the people sheet): inside it, announced, reachable from the keyboard; Escape closes the sheet
      await auditState('toast-in-modal', await toastInModal(page, lang), true);
      await page.keyboard.press('Escape');
      await page.getByTestId('life-people').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      Object.assign(states.at(-1), { closed: (await page.getByTestId('life-people').count()) === 0, toastBackOnPage: await page.evaluate(() => { const r = document.querySelector<HTMLElement>('[data-testid=toasts]'); return r?.dataset.host === 'page' && r.parentElement === document.body && !document.querySelector('[inert]'); }) });
      if (states.at(-1).toastBackOnPage === false) states.at(-1).shown = false;
      // the live line with an anchored error and its fix: the picture under the title is replaced by the one without a date
      const lifeUnder = (await lifeTx([{ op: 'delete_clip', args: { clipId: lifePicture } }, { op: 'add_clip', args: { assetId: lifeUndated, start: f(0), duration: f(60) } }])).results[1].output.clipId as string;
      await page.locator('[data-testid=field-live] .pf-anchored').first().waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('field-live-error', { shown: (await page.locator('[data-testid=field-live] .pf-anchored').count()) >= 1 && (await page.locator('[data-testid=field-live] .pf-anchored button').count()) >= 1 });
      lifePicture = (await lifeTx([{ op: 'delete_clip', args: { clipId: lifeUnder } }, { op: 'add_clip', args: { assetId: lifeEvening, start: f(0), duration: f(60) } }])).results[1].output.clipId as string;
      // the content packs: the Hanukkah pack page (from the shelf of the Templates drawer), the built-in music tab, the text drawer's fonts
      await railOn('templates');
      await page.locator('[data-pack-id="pack.hanukkah"] [data-testid=pack-card]').first().click({ timeout: 10000 }).catch(() => {});
      await page.getByTestId('pack-page').waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('pack-page', { shown: (await page.getByTestId('pack-page').getAttribute('data-pack-id').catch(() => null)) === 'pack.hanukkah' && (await page.locator('[data-testid^="pack-tab-"]').count()) >= 2 });
      if (await page.getByTestId('pack-back').count()) await page.getByTestId('pack-back').click();
      await railOn('audio');
      await page.getByTestId('music-tab').click({ timeout: 8000 }).catch(() => {});
      await page.locator('[data-testid=music-row]').first().waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('music-browser', { shown: (await page.locator('[data-testid=music-row]').count()) >= 1 });
      // the content library (wave 7): the sound drawer's «מהספרייה» tab and the elements drawer's two tabs, each in the state the server
      // answers (not built / not set up / ready); the audit looks at the panel as it is, never at a fixture shown in its place
      await page.getByTestId('audio-tab-library').click({ timeout: 8000 }).catch(() => {});
      await page.getByTestId('audio-panel-library').waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => !!document.querySelector('[data-testid=library-empty],[data-testid=library-not-configured],[data-testid=library-indexing],[data-testid=library-list]'), undefined, { timeout: 8000 }).catch(() => {});
      await auditState('library-audio-tab', { shown: (await page.getByTestId('audio-panel-library').count()) === 1 && (await page.locator('[data-testid=library-empty],[data-testid=library-not-configured],[data-testid=library-indexing],[data-testid=library-list]').count()) >= 1 });
      await railOn('elements');
      await page.getByTestId('elements-tab-library').click({ timeout: 8000 }).catch(() => {});
      await page.getByTestId('elements-panel-library').waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => !!document.querySelector('[data-testid=library-empty],[data-testid=library-not-configured],[data-testid=library-indexing],[data-testid=library-list]'), undefined, { timeout: 8000 }).catch(() => {});
      await auditState('library-elements-tab', { shown: (await page.getByTestId('elements-panel-library').count()) === 1 && (await page.locator('[data-testid=library-empty],[data-testid=library-not-configured],[data-testid=library-indexing],[data-testid=library-list]').count()) >= 1 });
      await page.getByTestId('elements-tab-builtin').click({ timeout: 8000 }).catch(() => {});
      // Settings → «הספרייה שלי» (the owner's session): the folder field, save, scan again and the state line
      const lsd = await dialogBehaviour('settings-dialog', async () => { await page.getByTestId('rail-settings').click(); }, '[data-testid=rail-settings]');
      await page.getByTestId('settings-library').scrollIntoViewIfNeeded().catch(() => {});
      await auditState('settings-library', { shown: (await page.getByTestId('settings-library').count()) === 1 && (await page.getByTestId('settings-library-state').count()) >= 1, startsInside: lsd.startsInside, tabStepsThatLeftTheDialog: lsd.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await lsd.close());
      await railOn('text');
      await page.locator('[data-testid=font-option]').first().waitFor({ timeout: 8000 }).catch(() => {});
      await auditState('text-drawer-fonts', { shown: (await page.locator('[data-testid=font-option]').count()) >= 1 });
      // the fast export and the render cache (ADR-0024): the sheet line in its states and the timeline lane with its popover, on
      // the project the scenarios export and edit (the life-line states above left the page on another project)
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor();
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      await page.waitForFunction(() => (document.querySelector('[data-testid=file-input]') as HTMLInputElement | null)?.disabled === false, undefined, { timeout: 30000 }).catch(() => {});
      await railOn('media');
      const rcCtx = makeRenderCacheCtx({ page, lang, api: makeApi(s.url, s.auth.tokens.agent), owner: await ownerApi(s.url, s.auth.tokens.owner), pid, titleClipId });
      for (const sc of renderCacheA11yScenarios) {
        const r = await sc.prepare(rcCtx);
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, sc.id.startsWith('cache-sheet'));
        await sc.leave?.(rcCtx);
      }
      // editing craft (wave 7): the time field, the paste dialog, the find panel with matches, the versions compare (a11y-craft.ts, W3)
      for (const sc of craftA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // stabilisation (wave 7): the block's states in the inspector (a11y-stabilise.ts, W3)
      for (const sc of stabiliseA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // marked ranges «פנינים» (wave 7): the list, the pearl form, «מי בקליפ?» and the screen-time table (a11y-pearls.ts, builder C)
      for (const sc of pearlsA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // «ספרו מה היה» (wave 7 story): the dialog, the recorder recording and refused, the «סיפור» tab and the story bar (a11y-story.ts, integration)
      for (const sc of storyA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // «גדלים מול העיניים» (wave 8 growing): the dialog's three steps and the bar (a11y-growing.ts, integration)
      for (const sc of growingA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // «חיפוש בצילומים» (wave 7 search): results, «לא נמצא דבר», the picture status line, the forget confirmation (a11y-search.ts, builder C)
      for (const sc of searchA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // music that fits the film «מוזיקה שמתאימה לסרט» (wave 7 musicfit): the fit block, the swap dialog, the impact controls (a11y-musicfit.ts)
      for (const sc of musicfitA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // the local language assistant (wave 7 assistant): its Settings fields in three states of the check, and the row from «לשאול…» to «הכנס לשורה» (assistant-local-proof.ui.ts; contract-shaped fixtures)
      for (const sc of assistantLocalA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // «כלים מוקלטים» (wave 7 instruments): the «צליל» radiogroup not set, not calibrated, ready with its duties, the blind pair, a refused add (a11y-instruments.ts)
      for (const sc of instrumentsA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      if (await page.getByTestId('cache-fast-switch').count() === 0) { await page.getByTestId('export').click(); await page.getByTestId('cache-fast-switch').waitFor({ timeout: 8000 }).catch(() => {}); }
      if ((await page.getByTestId('cache-fast-switch').getAttribute('aria-checked').catch(() => null)) === 'true') await page.getByTestId('cache-fast-switch').click();
      if (await page.getByTestId('export-sheet').count()) { await page.keyboard.press('Escape'); await page.getByTestId('export-sheet').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); }
      // the render cache's row in the status centre: its size and «ניקוי מטמון הרינדור» (the owner's own session)
      await page.getByTestId('status-pips').click();
      await page.getByTestId('cache-storage-row').waitFor({ timeout: 8000 }).catch(() => {});
      await auditState('cache-storage-row', { shown: (await page.getByTestId('cache-storage-row').count()) === 1 && (await page.getByTestId('cache-clear').count()) === 1 }, true);
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      // shorts (ADR-0018): the Shorts panel (its four steps) and the sequence switcher with a short present, with the delete
      // confirmation. The short is added through the public add_sequence operation and removed again, so every language starts alike.
      {
        const shApi = makeApi(s.url, s.auth.tokens.agent);
        await page.goto(`${s.ownerUrl}&project=${pid}`);
        await page.getByTestId('timecode').waitFor();
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
        await page.getByTestId('workspace-shorts').click({ timeout: 8000 }).catch(() => {});
        await page.getByTestId('shorts-panel').waitFor({ timeout: 8000 }).catch(() => {});
        await auditState('shorts-panel', { shown: (await page.getByTestId('shorts-panel').count()) === 1 && (await page.locator('[data-testid=shorts-step]').count()) === 4 });
        const made = await shApi.tx(pid, [{ op: 'add_sequence', args: { name: lang === 'he' ? 'קטע בדיקה' : 'Test short', format: { width: 720, height: 1280, fit: 'cover', profileId: 'vertical-9x16', safeArea: null } } }]).catch(() => null);
        const shortId = made?.results?.[0]?.output?.sequenceId as string | undefined;
        if (shortId) {
          await page.getByTestId('sequence-switcher').waitFor({ timeout: 8000 }).catch(() => {});
          await auditState('shorts-switcher', { shown: (await page.getByTestId('sequence-switcher').count()) === 1 && (await page.locator('[data-testid=sequence-switcher] [role=tab]').count()) === 2 });
          await page.locator(`[data-testid=sequence-tab][data-sequence-id="${shortId}"]`).click();
          await page.getByTestId('sequence-tab-delete').waitFor({ timeout: 5000 }).catch(() => {});
          const sd = await dialogBehaviour('sequence-delete-dialog', async () => { await page.getByTestId('sequence-tab-delete').click(); }, '[data-testid=sequence-tab-delete]');
          await auditState('shorts-delete-dialog', { startsInside: sd.startsInside, tabStepsThatLeftTheDialog: sd.tabStepsThatLeftTheDialog }, true);
          Object.assign(states.at(-1), await sd.close());
          await shApi.tx(pid, [{ op: 'remove_sequence', args: { sequenceId: shortId, withContents: true } }]).catch(() => null);
        }
        await page.getByTestId('workspace-pro').click().catch(() => {});
      }
      // keyframe curves and motion paths (ADR-0019): the strip and the path of a selected title, then the curve picker opened with
      // Enter on a strip key (focus inside, Tab kept inside, Escape closes and gives focus back to the key)
      {
        await page.goto(`${s.ownerUrl}&project=${kfPid}`);
        await page.getByTestId('timecode').waitFor();
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
        await page.locator(`.clip[data-clip-id="${kfClip}"]`).click({ position: { x: 4, y: 4 } });
        await page.getByTestId(KF_TESTIDS.strip).waitFor({ timeout: 8000 }).catch(() => {});
        await page.getByTestId(KF_TESTIDS.path).waitFor({ timeout: 8000 }).catch(() => {});
        await auditState('keyframe-strip-and-path', { shown: (await page.getByTestId(KF_TESTIDS.strip).count()) === 1 && (await page.getByTestId(KF_TESTIDS.key).count()) === 3 && (await page.getByTestId(KF_TESTIDS.path).count()) === 1 && (await page.getByTestId(KF_TESTIDS.pathPoint).count()) === 3 && (await page.getByTestId(KF_TESTIDS.bend).count()) >= 1 });
        const keyAt15 = `[data-testid=${KF_TESTIDS.key}][data-frame="15"]`;
        const cp = await dialogBehaviour(KF_TESTIDS.picker, async () => { await page.locator(keyAt15).focus(); await page.keyboard.press('Enter'); }, keyAt15);
        await auditState('curve-picker', { startsInside: cp.startsInside, tabStepsThatLeftTheDialog: cp.tabStepsThatLeftTheDialog, shown: (await page.locator(`[data-testid^="curve-tile-"]`).count()) >= 12 }, true);
        await toastState('toast-in-curve-picker', KF_TESTIDS.picker, cp);
      }
      // multicam (ADR-0020): the docked panel, the sync dialog (modal), and a keyboard-only path from the library selection to a placed program
      if (mc.trackId) {
        await page.evaluate(([id, track]) => { try { localStorage.setItem(`pf.targets.v1.${id}`, JSON.stringify({ video: track, audio: null })); } catch { /* storage unavailable */ } }, [mc.id, mc.trackId]);
        await page.goto(`${s.ownerUrl}&project=${mc.id}`);
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
        await page.getByTestId('multicam-panel').waitFor({ timeout: 10000 }).catch(() => {});
        await auditState('multicam-panel', { shown: (await page.getByTestId('multicam-panel').count()) === 1, tiles: await page.locator('[data-testid=multicam-tile]').count(), tileOrder: await page.locator('[data-testid=multicam-tile]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tile)), dir: await page.evaluate(() => document.documentElement.dir) });
        const md = await dialogBehaviour('multicam-sync-dialog', async () => { await page.getByTestId('multicam-sync-open').click(); }, '[data-testid=multicam-sync-open]');
        await auditState('multicam-sync-dialog', { startsInside: md.startsInside, tabStepsThatLeftTheDialog: md.tabStepsThatLeftTheDialog, rows: await page.locator('[data-testid=multicam-sync-row]').count() }, true);
        Object.assign(states.at(-1), await md.close());
      }
      {
        await page.goto(`${s.ownerUrl}&project=${mcLib.id}`);
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
        const boxes = page.locator('[data-testid^=pick-]');
        await boxes.first().waitFor({ timeout: 10000 }).catch(() => {});
        // keyboard only: focus each checkbox and press Space, then the «סנכרון וחיתוך» button with Enter
        let keyboardOk = false;
        if ((await boxes.count()) >= 2) {
          for (let i = 0; i < 2; i++) { await boxes.nth(i).focus(); await page.keyboard.press('Space'); }
          await page.getByTestId('multicam-sync-and-cut').focus();
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => !!document.querySelector('[data-testid=multicam-review-stop]') || document.querySelector('[data-testid=multicam-entry] [data-state=done]') || document.querySelector('[data-testid=multicam-entry] [data-state=failed]'), undefined, { timeout: 60000 }).catch(() => {});
          const review = page.getByTestId('multicam-review-stop');
          if (await review.count()) { await review.getByRole('button').nth(1).focus(); await page.keyboard.press('Enter'); await page.waitForSelector('[data-testid=multicam-entry] [data-state=done], [data-testid=multicam-entry] [data-state=failed]', { timeout: 60000 }).catch(() => {}); }
          keyboardOk = (await page.locator('[data-testid=multicam-entry] [data-state=done]').count()) === 1;
        }
        await auditState('multicam-keyboard-path', { keyboardOk });
      }
      // perform mode (ADR-0025): the view at rest, a take under review (taps injected through the view's test hook, the real
      // planner), the tap calibration dialog (modal), and the camera overlay on a selected clip; then back to the edit mode
      {
        await page.goto(`${s.ownerUrl}&project=${pid}`);
        await page.getByTestId('timecode').waitFor();
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Shift+Digit7');
        await page.getByTestId('perform-view').waitFor({ timeout: 10000 }).catch(() => {});
        await page.waitForFunction(() => !!(window as any).__pfPerform, undefined, { timeout: 10000 }).catch(() => {});
        await auditState('perform-view', { shown: (await page.getByTestId('perform-view').count()) === 1 && (await page.getByTestId('perform-pad').count()) === 8 });
        await page.evaluate(() => (window as any).__pfPerform?.injectTaps([{ pad: 0, down: 0.5, up: 0.7 }, { pad: 1, down: 1, up: 1.3 }, { pad: 4, down: 1.05, up: 1.3 }]));
        await page.getByTestId('perform-chip').first().waitFor({ timeout: 10000 }).catch(() => {});
        await auditState('perform-take-review', { shown: (await page.getByTestId('perform-ghost-banner').count()) === 1 && (await page.getByTestId('perform-chip').count()) === 3 });
        await page.getByTestId('perform-discard').click().catch(() => {});
        const cd = await dialogBehaviour('perform-calibrate-dialog', async () => { await page.getByTestId('perform-calibrate').click(); }, '[data-testid=perform-calibrate]');
        await auditState('perform-calibration-dialog', { startsInside: cd.startsInside, tabStepsThatLeftTheDialog: cd.tabStepsThatLeftTheDialog }, true);
        Object.assign(states.at(-1), await cd.close());
        await page.locator(`.clip[data-clip-id="${clipId}"]`).click({ position: { x: 4, y: 4 } });
        await page.getByTestId('perform-camera').click();
        await page.getByTestId('perform-camera-crop').waitFor({ timeout: 10000 }).catch(() => {});
        await auditState('perform-camera-overlay', { shown: (await page.getByTestId('perform-camera-overlay').count()) === 1 && (await page.getByTestId('perform-camera-crop').count()) === 1 });
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Shift+Digit1');
        await page.waitForFunction(() => !document.querySelector('[data-testid=perform-view]'), undefined, { timeout: 10000 }).catch(() => {});
      }
      // wave 6 notes: the transcript panel's skipped-clip note (its own project), then the archive import's note in the project the import makes
      await page.goto(`${s.ownerUrl}&project=${await untimedProject(`a11y-untimed-dark-${lang}`)}`);
      await page.getByTestId('timecode').waitFor({ timeout: 15000 }).catch(() => {});
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      await auditState('transcript-skipped-note', await skippedNoteState(page, lang));
      { const pacing = await pacingNoteState(page, lang); await auditState('pacing-skipped-note', pacing.extra); await pacing.back(); }
      {
        const note = await importNoteState(page, lang, revArchive);
        await auditState('archive-import-note', note.extra);
        Object.assign(states.at(-1), await note.close());
      }
      // «שליחה ושמירה» (wave 7 send): the tile with its size choices, the fitted size and the refusal in the sheet; the file card with the
      // fit line and the findings (one export of a film with a one-second gap, fitted to 16 MB); the sound panel with the limiter on and
      // the clip loudness match planned and then done. Every state is audited like the resting page; the dialog checks hold for the sheet.
      {
        const ff = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
        const upl = async (id: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${id}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
        const talk = path.join(art, `send-talk-${lang}.mp4`);
        ff(['-f', 'lavfi', '-t', '3', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '3', '-i', 'sine=frequency=330:sample_rate=48000', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-shortest', talk]);
        const gapPid = (await post('/projects', { name: `a11y-send-gap-${lang}`, width: 640, height: 360 })).project.id as string;
        const gapUp = await upl(gapPid, talk);
        await post(`/projects/${gapPid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: gapUp.assetId, start: f(0), duration: f(45) } }] });
        await post(`/projects/${gapPid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: gapUp.assetId, start: f(75), duration: f(45) } }] });
        await page.goto(`${s.ownerUrl}&project=${gapPid}`);
        await page.getByTestId('timecode').waitFor({ timeout: 15000 });
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
        const ss = await dialogBehaviour('export-sheet', async () => { await page.getByTestId('export').click(); }, '[data-testid=export]');
        await page.locator('[data-testid=export-dest][data-id=whatsapp]').click();
        await page.getByTestId('send-size').waitFor({ timeout: 8000 }).catch(() => {});
        await auditState('send-tile', { startsInside: ss.startsInside, tabStepsThatLeftTheDialog: ss.tabStepsThatLeftTheDialog, shown: (await page.getByTestId('send-size').count()) === 1 && (await page.getByTestId('send-size-choice').count()) >= 3 && (await page.locator('[data-testid=send-size-choice][aria-checked=true]').count()) === 0 && (await page.getByTestId('export-start').getAttribute('aria-disabled')) === 'true' }, true);
        await page.getByTestId('send-size-input').fill('0.5');
        await page.getByTestId('send-size-refusal').waitFor({ timeout: 5000 }).catch(() => {});
        await auditState('send-size-refusal', { shown: (await page.getByTestId('send-size-refusal').count()) === 1 && (await page.getByTestId('export-start').getAttribute('aria-disabled')) === 'true' }, true);
        await page.locator('[data-testid=send-size-choice][data-mb="16"]').click();
        await page.getByTestId('send-size-fitted').waitFor({ timeout: 15000 }).catch(() => {});
        await auditState('send-size-fitted', { shown: (await page.getByTestId('send-size-fitted').count()) === 1 && (await page.getByTestId('send-size-refusal').count()) === 0 }, true);
        await page.getByTestId('export-start').click();
        await page.getByTestId('export-done').waitFor({ timeout: 180000 }).catch(() => {});
        await page.getByTestId('export-checks').waitFor({ timeout: 10000 }).catch(() => {});
        await auditState('send-file-card', { shown: (await page.getByTestId('export-fit-line').count()) === 1 && (await page.getByTestId('export-checks').count()) === 1 && (await page.locator('[data-testid=export-check-item]').count()) >= 1 && (await page.locator('[data-testid=export-check-jump]').count()) >= 1 }, true);
        Object.assign(states.at(-4), await ss.close());
        const soundPid = (await post('/projects', { name: `a11y-send-sound-${lang}`, width: 640, height: 360 })).project.id as string;
        const wq = path.join(art, `send-quiet-${lang}.wav`), wl = path.join(art, `send-loud-${lang}.wav`);
        ff(['-f', 'lavfi', '-t', '6', '-i', 'sine=frequency=220:sample_rate=48000', '-af', 'volume=0.05', '-ac', '2', '-c:a', 'pcm_s16le', wq]);
        ff(['-f', 'lavfi', '-t', '6', '-i', 'sine=frequency=330:sample_rate=48000', '-af', 'volume=0.4', '-ac', '2', '-c:a', 'pcm_s16le', wl]);
        const aq = await upl(soundPid, wq), al = await upl(soundPid, wl);
        const r1 = (await post(`/projects/${soundPid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: aq.assetId, start: f(0) } }] })).results[0].output;
        const r2 = (await post(`/projects/${soundPid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: al.assetId, start: f(200) } }] })).results[0].output;
        const c1 = (r1.audioClipId ?? r1.clipId) as string, c2 = (r2.audioClipId ?? r2.clipId) as string;
        await page.goto(`${s.ownerUrl}&project=${soundPid}`);
        await page.getByTestId('timecode').waitFor({ timeout: 15000 });
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
        await page.getByTestId('master-limiter-switch').waitFor({ timeout: 15000 }).catch(() => {});
        await page.getByTestId('master-limiter-switch').focus();
        await page.keyboard.press('Enter'); // outside a dialog the editor's Space plays and pauses, even on a focused button
        await page.getByTestId('master-limiter-ceiling').waitFor({ timeout: 8000 }).catch(() => {});
        await auditState('limiter-on', { shown: (await page.getByTestId('master-limiter-ceiling').count()) === 1 && (await page.getByTestId('meter-reduction').count()) === 1 });
        await page.locator(`.clip[data-clip-id="${c1}"]`).first().click();
        await page.locator(`.clip[data-clip-id="${c2}"]`).first().click({ modifiers: ['Shift'] });
        await page.getByTestId('loudness-match-run').focus();
        await page.keyboard.press('Enter');
        await page.getByTestId('loudness-match-plan').waitFor({ timeout: 60000 }).catch(() => {});
        await auditState('loudness-match-plan', { shown: (await page.locator('[data-testid=loudness-match-preview] li').count()) === 2 });
        await page.getByTestId('loudness-match-apply').click();
        await page.getByTestId('loudness-match-result').waitFor({ timeout: 15000 }).catch(() => {});
        await auditState('loudness-match-result', { shown: (await page.locator('[data-testid=loudness-match-result] li').count()) === 2 && (await page.getByTestId('loudness-match-undo').count()) === 1 });
      }
      // the start hub of an empty project
      await page.goto(`${s.ownerUrl}&project=${emptyPid}`);
      await page.getByTestId('welcome').waitFor({ timeout: 10000 }).catch(() => {});
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      await auditState('start-hub', { shown: (await page.getByTestId('welcome').count()) === 1 && (await page.getByTestId('welcome-import').count()) === 1 });
      for (const st of states) console.log(`[${lang}] state ${st.state}: controls=${st.controls} unnamed=${st.unnamed.length} lowContrast=${st.lowContrast.length} tabIssues=${st.tabIssues.length} noFocusRing=${st.noFocusRing.length}${st.startsInside !== undefined ? ` startsInside=${st.startsInside} leftDialog=${st.tabStepsThatLeftTheDialog} openUntilEscape=${st.openUntilEscape} closed=${st.closed} focusReturned=${st.focusReturned} (focus after close: ${st.focusAfterClose})` : ''}${st.shown !== undefined ? ` shown=${st.shown}` : ''}${st.formatSelected !== undefined ? ` formatSelected=${st.formatSelected} scopeNotes=${st.scopeNotes}` : ''}`);
      report.runs.push({ ...found, uiLanguage: lang, theme: 'dark', focus, plantedDefectsDetected: sensitivity, states });
      console.log(`[${lang}] lang=${found.lang} dir=${found.dir} controls=${found.controls} unnamed=${found.unnamed.length} lowContrast=${found.lowContrast.length} tabIssues=${found.tabIssues.length} focusReached=${focus.reached} noFocusRing=${focus.missing.length}`);
      await page.close();
    }
    // ---- the light theme (Settings «ערכת צבעים: בהיר» / "Theme: Light"), both languages: the main editor states again. Contrast in the
    // light theme does not follow from the dark pass: until 2026-11-19 the media card painted a dark-only surface under the light
    // theme's dark text (asset names at 1.0, the rename pencil at 3.18). Also audited here: an asset whose stored file is missing on disk
    // (its own project and picture, so removing the file touches nothing else), which the library card and the timeline say plainly.
    const missPng = path.join(art, 'missing.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2a6f97:s=160x90', '-frames:v', '1', missPng]);
    const missPid = (await post('/projects', { name: 'a11y-missing', width: 640, height: 360 })).project.id as string;
    const missUp: any = await (await fetch(`${s.url}/api/v1/projects/${missPid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'missing.png' }, body: fs.readFileSync(missPng) })).json();
    await post(`/projects/${missPid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: missUp.assetId, start: f(0), duration: f(30) } }] });
    const missHash = ((await (await fetch(`${s.url}/api/v1/projects/${missPid}`, { headers: h })).json()) as any).project.assets[missUp.assetId].contentHash as string;
    fs.rmSync(path.join(art, 'data', 'blobs', missHash.replace(/^sha256:/, '')));
    for (const lang of ['he', 'en'] as const) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      await page.addInitScript((l) => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem('pf.lang', l); localStorage.setItem('pf.theme', 'light'); } catch { /* storage unavailable */ } }, lang);
      await page.addInitScript('globalThis.__name = (f) => f');
      await page.addInitScript(() => { (globalThis as { __pfPerformProof?: boolean }).__pfPerformProof = true; (globalThis as { __pfToastProof?: boolean }).__pfToastProof = true; });
      const open = async (projectId: string, ready = 'timecode') => {
        await page.goto(`${s.ownerUrl}&project=${projectId}`);
        await page.getByTestId(ready).waitFor({ timeout: 15000 });
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      };
      await open(pid);
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      if (theme !== 'light') throw new Error(`the light pass did not get the light theme (data-theme=${theme})`);
      await clickClipEnd(page, clipId);
      await page.waitForTimeout(300);
      const found = await page.evaluate(auditInPage);
      const focus = await focusAudit(page, 60);
      await page.screenshot({ path: path.join(art, `editor-${lang}-light.png`) });
      const states: any[] = [];
      const auditState = async (name: string, extra: Record<string, unknown> = {}, modal = false) => {
        const r = await page.evaluate(auditInPage);
        const fr = await focusAudit(page, 14, !modal);
        states.push({ state: name, controls: r.controls, unnamed: r.unnamed, lowContrast: r.lowContrast, tabIssues: r.tabIssues, noFocusRing: fr.missing, ...extra });
        await page.screenshot({ path: path.join(art, `state-${name}-${lang}-light.png`) });
      };
      const closeWith = async (testId: string) => { await page.keyboard.press('Escape'); await page.getByTestId(testId).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); await page.waitForTimeout(150); };
      // the media library: a card under the pointer (its add and ⋯ buttons and the rename pencil show), then its ⋯ menu
      await page.getByTestId(`asset-${up.assetId}`).hover();
      await page.waitForTimeout(200);
      const pencil = await page.getByTestId(`rename-${up.assetId}`).evaluate((el) => getComputedStyle(el).opacity).catch(() => '0');
      await auditState('media-card-hover', { shown: (await page.getByTestId(`asset-${up.assetId}`).count()) === 1 && Number(pencil) > 0 });
      await openCardMenu(page, up.assetId);
      await page.locator('[role=menu]').first().waitFor({ timeout: 5000 }).catch(() => {});
      await auditState('media-card-menu', { shown: (await page.locator('[role=menu] [role^=menuitem]').count()) > 0 }, true);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      // the export sheet and the settings dialog
      await page.getByTestId('export').click();
      await page.getByTestId('export-sheet').waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      await auditState('export-sheet', { shown: (await page.getByTestId('export-start').count()) === 1 }, true);
      await closeWith('export-sheet');
      await page.getByTestId('rail-settings').click();
      await page.getByTestId('settings-dialog').waitFor({ timeout: 8000 }).catch(() => {});
      await auditState('settings-dialog', { shown: (await page.getByTestId('settings-dialog').count()) === 1 }, true);
      await closeWith('settings-dialog');
      // a toast while a modal is open (the people sheet), in the light theme
      await auditState('toast-in-modal', await toastInModal(page, lang), true);
      await closeWith('life-people');
      // a toast while each of the editor's own modals is open, in the light theme: the command palette, the effect gallery (of the
      // selected clip), the curve picker (of a title's key) and the template dialog; Escape is typed on the toast's × and closes the modal
      const lightToast = async (name: string, dialogTestId: string, opener: () => Promise<void>) => {
        await opener();
        await page.getByTestId(dialogTestId).waitFor({ timeout: 8000 });
        await page.waitForTimeout(200);
        await auditState(name, await toastInOpenModal(page, lang, dialogTestId), true);
        const mine = states.at(-1);
        await closeWith(dialogTestId);
        Object.assign(mine, { closed: (await page.getByTestId(dialogTestId).count()) === 0 }, await toastAfterModal(page));
        if (mine.toastBackOnPage === false) mine.shown = false;
      };
      await lightToast('toast-in-palette', 'palette-dialog', async () => { await page.getByTestId('open-palette').click(); });
      await clickClipEnd(page, clipId);
      await page.getByTestId('gallery-open').waitFor({ timeout: 8000 });
      await lightToast('toast-in-effect-gallery', 'effect-gallery', async () => { await page.getByTestId('gallery-open').click(); });
      const lightProjectUrl = page.url();
      await open(kfPid);
      await page.locator(`.clip[data-clip-id="${kfClip}"]`).click({ position: { x: 4, y: 4 } });
      await page.getByTestId(KF_TESTIDS.strip).waitFor({ timeout: 8000 }).catch(() => {});
      await lightToast('toast-in-curve-picker', KF_TESTIDS.picker, async () => { await page.locator(`[data-testid=${KF_TESTIDS.key}][data-frame="15"]`).focus(); await page.keyboard.press('Enter'); });
      await page.goto(lightProjectUrl);
      await page.getByTestId('timecode').waitFor({ timeout: 15000 });
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      // perform mode at rest
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Shift+Digit7');
      await page.getByTestId('perform-view').waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('perform-view', { shown: (await page.getByTestId('perform-view').count()) === 1 && (await page.getByTestId('perform-pad').count()) === 8 });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Shift+Digit1');
      await page.waitForFunction(() => !document.querySelector('[data-testid=perform-view]'), undefined, { timeout: 10000 }).catch(() => {});
      // an asset whose stored file is missing: the card and the timeline clip say so, the preview is not an error
      await open(missPid);
      await page.getByTestId(`missing-${missUp.assetId}`).waitFor({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      {
        // the three conditions in the state's detail, so a failure says which one (the card once, the clip's look, no error alert)
        const cards = await page.getByTestId(`missing-${missUp.assetId}`).count(), clipsMissing = await page.locator('.clip.missing').count();
        const alerts = await page.locator('.error[role=alert]').allTextContents();
        await auditState('missing-media', { shown: cards === 1 && clipsMissing >= 1 && alerts.length === 0, cards, clipsMissing, alerts });
      }
      // wave 6 notes in the light theme: the skipped-clip note, the archive import's note, and the Templates bar after a hand delete
      await open(await untimedProject(`a11y-untimed-light-${lang}`));
      await auditState('transcript-skipped-note', await skippedNoteState(page, lang));
      { const pacing = await pacingNoteState(page, lang); await auditState('pacing-skipped-note', pacing.extra); await pacing.back(); }
      {
        const note = await importNoteState(page, lang, revArchive);
        await auditState('archive-import-note', note.extra);
        Object.assign(states.at(-1), await note.close());
      }
      await open(tplPid);
      await page.getByTestId('rail-templates').click();
      if ((await page.getByTestId('templates-toggle').getAttribute('aria-expanded')) !== 'true') await page.getByTestId('templates-toggle').click();
      await lightToast('toast-in-template-dialog', 'template-dialog', async () => { await page.locator(`[data-testid=template-card][data-template-id="${tplPick?.id ?? ''}"]`).click({ timeout: 10000 }); });
      await page.locator(`[data-testid=template-card][data-template-id="${tplPick?.id ?? ''}"]`).click({ timeout: 10000 }).catch(() => {});
      await page.getByTestId('template-dialog').waitFor({ timeout: 8000 }).catch(() => {});
      await page.locator('[data-testid=template-step][data-step=plan]').click().catch(() => {});
      await page.waitForFunction(() => !!document.querySelector('[data-testid=template-plan-summary]') || !!document.querySelector('[data-testid=template-error]'), undefined, { timeout: 30000 }).catch(() => {});
      await page.getByTestId('template-use').click({ timeout: 5000 }).catch(() => {});
      await page.getByTestId('template-applied').waitFor({ timeout: 30000 }).catch(() => {});
      if (await page.getByTestId('template-dialog').count()) await page.keyboard.press('Escape');
      {
        const rr = await restoreRemovedState(page, lang);
        await auditState('template-restore-removed', rr.extra);
        Object.assign(states.at(-1), await rr.undo());
      }
      if (await page.getByTestId('template-undo').count()) { await page.getByTestId('template-undo').click(); await page.getByTestId('template-applied').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500); }
      // stabilisation (wave 7) in the light theme: the same five scenarios as the dark pass (each sets up its own start state; it opens its own project)
      for (const sc of stabiliseA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // «ספרו מה היה» in the light theme too: the dialog, the recorder recording and refused, the «סיפור» tab, the bar (a11y-story.ts, integration)
      for (const sc of storyA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid: emptyPid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid: emptyPid });
      }
      // «גדלים מול העיניים» in the light theme too (a11y-growing.ts, integration)
      for (const sc of growingA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid: emptyPid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid: emptyPid });
      }
      // the start hub of an empty project
      await open(emptyPid, 'welcome');
      await auditState('start-hub', { shown: (await page.getByTestId('welcome').count()) === 1 });
      // music that fits the film (wave 7 musicfit) in the light theme: the same six scenarios as the dark pass (a11y-musicfit.ts)
      for (const sc of musicfitA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // «חיפוש בצילומים» (wave 7 search) in the light theme: the same scenarios as the dark pass, each on its own scratch project (a11y-search.ts)
      for (const sc of searchA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // the local language assistant (wave 7 assistant) in the light theme: the same nine scenarios as the dark pass (assistant-local-proof.ui.ts; contract-shaped fixtures)
      for (const sc of assistantLocalA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      // «כלים מוקלטים» (wave 7 instruments) in the light theme: the same five scenarios as the dark pass; the «צליל» radiogroup not set, not calibrated, ready with its duties, the blind pair, a refused add (a11y-instruments.ts)
      for (const sc of instrumentsA11yScenarios) {
        const r = await sc.prepare({ page, lang, pid });
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, r.modal);
        await sc.leave?.({ page, lang, pid });
      }
      for (const st of states) console.log(`[${lang} light] state ${st.state}: controls=${st.controls} unnamed=${st.unnamed.length} lowContrast=${st.lowContrast.length} tabIssues=${st.tabIssues.length} noFocusRing=${st.noFocusRing.length}${st.shown !== undefined ? ` shown=${st.shown}` : ''}`);
      report.runs.push({ ...found, uiLanguage: lang, theme: 'light', focus, states });
      console.log(`[${lang} light] controls=${found.controls} unnamed=${found.unnamed.length} lowContrast=${found.lowContrast.length} tabIssues=${found.tabIssues.length} focusReached=${focus.reached} noFocusRing=${focus.missing.length}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await s.close();
  }
  const stateFindings = (st: any) => st.unnamed.length + st.lowContrast.length + st.tabIssues.length + st.noFocusRing.length
    + (st.keyboardOk === false ? 1 : 0) + (st.startsInside === false ? 1 : 0) + (st.tabStepsThatLeftTheDialog ? 1 : 0) + (st.openUntilEscape === false ? 1 : 0) + (st.closed === false ? 1 : 0) + (st.focusReturned === false ? 1 : 0) + (st.shown === false ? 1 : 0) + (st.formatSelected === false ? 1 : 0) + (st.firstCardAtInlineStart === false ? 1 : 0);
  const total = report.runs.reduce((n: number, r: any) => n + r.unnamed.length + r.lowContrast.length + r.tabIssues.length + r.focus.missing.length + (r.states ?? []).reduce((m: number, st: any) => m + stateFindings(st), 0), 0);
  report.findings = total;
  const runFindings = (r: any) => r.unnamed.length + r.lowContrast.length + r.tabIssues.length + r.focus.missing.length + (r.states ?? []).reduce((m: number, st: any) => m + stateFindings(st), 0);
  report.findingsByRun = report.runs.map((r: any) => ({ theme: r.theme, uiLanguage: r.uiLanguage, states: (r.states ?? []).length, findings: runFindings(r) }));
  for (const r of report.findingsByRun) console.log(`  ${r.theme} ${r.uiLanguage}: ${r.findings} finding(s) over the resting page and ${r.states} states`);
  report.result = total === 0 ? 'NO FINDINGS (heuristic)' : 'FINDINGS';
  fs.writeFileSync(path.join(root, 'docs/evidence/a11y-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`a11y audit: ${report.result}, ${total} finding(s). Evidence: docs/evidence/a11y-audit.json`);
  for (const r of report.runs) for (const st of r.states ?? []) if (stateFindings(st)) console.log(`  [${r.uiLanguage} ${r.theme}] state ${st.state}:`, JSON.stringify({ unnamed: st.unnamed.slice(0, 6), lowContrast: st.lowContrast.slice(0, 6), tabIssues: st.tabIssues.slice(0, 6), noFocusRing: st.noFocusRing.slice(0, 6), startsInside: st.startsInside, leftDialog: st.tabStepsThatLeftTheDialog, closed: st.closed, focusReturned: st.focusReturned, shown: st.shown, formatSelected: st.formatSelected }));
  for (const r of report.runs) { console.log(`  [${r.uiLanguage} ${r.theme}] unnamed:`, r.unnamed.slice(0, 12)); console.log(`  [${r.uiLanguage} ${r.theme}] low contrast:`, r.lowContrast.slice(0, 12)); console.log(`  [${r.uiLanguage} ${r.theme}] no focus ring:`, r.focus.missing.slice(0, 12)); }
  if (process.env.PF_A11Y_STRICT === '1' && total > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
