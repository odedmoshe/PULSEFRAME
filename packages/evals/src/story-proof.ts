/**
 * pnpm proof:story — «ספרו מה היה» (wave 7 story track; .artifacts/wave7/story-decisions.md §4). LEAD: the entry point and the list
 * of checks. Each builder owns one part file and builds its checks there:
 *   story-proof.server.ts (W2: S1–S20; S11's editor half after W3) · story-proof.ui.ts (W3: U1–U15).
 * Until every part is built it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC only (story-fixtures.ts: tones in bursts over seeded noise made by ffmpeg; stills and barcode videos from
 * packages/fixtures; a 3 kHz tone as music). Never a real voice and never family media. Writes docs/evidence/story-proof.json when built.
 *
 * Measurement and plan
 *  S1 narration.wav measures four ranges; each start lies 0–90 ms before its burst's start and each end 0–150 ms after its burst's
 *     end; no range edge lies inside a burst; the 0.3 s pause is inside the fourth range. S1b gated.wav gives the same four ranges.
 *  S2 flat.wav is flat with no ranges; the plan warns voice_flat with both levels; every automatic cut is `even`.
 *  S2b a file whose waveform is held back answers within 6 s with voice_pending.
 *  S3 five taps and six pictures at 25, 29.97 and 30 fps: each picture starts on the frame computed independently from its tap; the
 *     first at the narration's start; the last ends with it; the lengths add up exactly.
 *  S4 apply moves the revision by one; one undo returns the exact hash; redo returns the applied hash; the recording is still in the library.
 *  S5 six pictures, no taps: the cuts near 4.5, 8.2 and 15.0 s are `pause`, those near 12 and 20 s `even`.
 *  S6 taps closer than the flash gap, more taps than pictures and a tap after the end are held with their reasons; no two cuts in the
 *     result are closer than flashGapFrames.
 *  S7 a 3 s video in a 6 s slot plays whole, the next picture starts at its end, the note gives the seconds, three rendered frames
 *     across that cut show the expected pictures; a video shorter than the gap is left out too_short.
 * Export and sound
 *  S8 in the server export the first burst starts within 2 ms of its planned time; frames c−1 and c of every cut show the pictures
 *     before and after.
 *  S9 in the export the 3 kHz level inside a burst and in the 2.0 s pause is 12 ± 1 dB below the same mix with ducking off.
 *  S13 after set_transcript on the narration the duck curve follows the typed phrases.
 * Regeneration
 *  S11 bare ops AND through the editor on a new project (magnet and ripple on): trim picture 3, replace 4, Delete 2, «בנייה מחדש»
 *     with other music: 3 and 4 byte-equal; 2 left out by name; later pictures back on their recorded cuts (moved_back); no frame
 *     without a picture between the first cut and the narration's end; restoreRemoved brings 2 back at its cut.
 *  S12 the narration dragged 2 s later, rebuild: every cut exactly 2 s later; reversed → kept_narration_not_followable; deleted →
 *     narration_removed.
 *  S19 a regeneration with other cutsMs answers 409 story_retap_not_built; the hash is unchanged.
 *  S20 the recipe regenerate route with a stale expectedRevision answers 409 for a film run and a story run.
 * Access and doors
 *  S14 observe plans; apply is refused for propose mode, a track-limited grant, an agent without the people scope asking {age:…}, and
 *     without a credential. S15 plan_recipe / apply_recipe over the MCP client give the same run record as REST.
 *  S16 narration.m4a sent through the drop door as a phone becomes a sound file with via 'phone' and a story applies on it.
 * Interface (W3)
 *  U1 no microphone permission → «אין הרשאה למיקרופון», no import. U2 recording mic.wav: mono 16-bit, header rate = context rate,
 *     length within 0.25 s, three bursts in order with gaps within 30 ms. U3 quiet.wav «שקט מדי» with its number; hot.wav the
 *     clipped count (U1, U2, U3 quiet, U3 hot are four Chromium launches). U4 «הקלטה מחדש» before saving leaves no job and no file.
 *  U5 the limit lowered to 3 s by a test hook: the recorder stops by sample count and says so.
 *  U6 the whole flow by keyboard only in Hebrew and in English, dir checked on the dialog and the strip.
 *  U7 five taps (three through window.__pfStory, two real key events) give cuts within one frame of the player's time for each.
 *  U8 while tapping the revision does not move and the sound session is not restarted. U9 «אישור» moves the revision once; Ctrl+Z
 *     returns the earlier hash; the recording stays in the library. U10 held taps show their Hebrew reasons, «לא כויל» is visible,
 *     no screen holds a banned word. U12 every microphone track reads readyState 'ended' after stop, record-again, closing the
 *     dialog, unmount and the page hidden. U13 a key hammered at 10/s: no two cuts shown closer than the gap. U14 the ghost's cut
 *     frames equal the server's after apply. U15 narration-alac.m4a shows «הקובץ לא מתנגן בעורך» and both build buttons are disabled.
 * Integration (in story-proof.ui.ts): S11e, S11's editor half (ripple trim W, «החלפת מדיה», Delete, «בנייה מחדש» from the bar, one
 *     undo, «החזרת החלקים שנמחקו»); U2 also checks that the take leaves the page only as one POST to the authenticated import queue;
 *     U12 also covers «מהטלפון» (the dialog unmounts for the phone dialog and comes back with the picture order kept).
 * Must stay green: typecheck, test, audit:testids, audit:a11y, proof:editor-interactions, proof:perform, proof:family-film,
 * proof:templates, proof:phone-drop, proof:lifeline-ui, proof:music, proof:phase8, conformance:parity, conformance:inputs, conformance:images.
 * Not provable here (the owner's laptop): a real microphone and Windows' permission settings, tap latency with real sound, how the
 * music under the voice sounds, the pause thresholds on a real voice with children in the room, real phone memos (AMR), the Hebrew.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STORY_PROOF_SERVER, stopStoryProofServer } from './story-proof.server.ts';
import { STORY_PROOF_UI } from './story-proof.ui.ts';

/** One part of the proof: built or not, and its checks (id → run). Each run returns true (pass) or a failure sentence. */
export interface StoryProofPart { built: boolean; checks: Record<string, () => Promise<true | string>> }
const parts = { server: STORY_PROOF_SERVER, ui: STORY_PROOF_UI };
const pending = Object.entries(parts).filter(([, p]) => !p.built).map(([k]) => k);
if (pending.length) {
  console.error(`story-proof: not built yet (parts pending: ${pending.join(', ')}); nothing was measured`);
  process.exit(2);
}
let failed = 0;
const results: { id: string; part: string; ok: boolean; seconds: number; why?: string }[] = [];
for (const [name, part] of Object.entries(parts)) {
  for (const [id, check] of Object.entries(part.checks)) {
    const t0 = Date.now();
    const r = await check();
    console.log(`${r === true ? 'PASS' : 'FAIL'} ${id} (${name})${r === true ? '' : `: ${r}`}`);
    results.push({ id, part: name, ok: r === true, seconds: Math.round((Date.now() - t0) / 100) / 10, ...(r === true ? {} : { why: r.slice(0, 600) }) });
    if (r !== true) failed++;
  }
  // the server part's server (and the jobs it still runs) stops before the browser part starts: on this shared machine its
  // leftover work made the first browser checks wait past their timeouts (integration, first full run)
  if (name === 'server') await stopStoryProofServer();
}
const root = path.resolve(import.meta.dirname, '../../..');
fs.writeFileSync(path.join(root, 'docs/evidence/story-proof.json'), JSON.stringify({ ranAt: new Date().toISOString(), result: failed ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, logicalCpus: os.cpus().length, loadAverage: os.loadavg().map((x) => Math.round(x * 10) / 10) }, scope: 'Synthetic fixtures only (tones over seeded noise, solid-colour pictures); headless Chromium with a fake microphone fed from a file. Nobody listened; no real microphone or voice.', passed: results.length - failed, total: results.length, checks: results }, null, 2) + '\n');
console.log(`\nstory proof ${failed ? 'FAILED' : 'PASSED'}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
