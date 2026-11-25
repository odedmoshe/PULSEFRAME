/**
 * pnpm proof:musicfit — «מוזיקה שמתאימה לסרט», music that ends with the film (wave 7 musicfit track; .artifacts/wave7/musicfit-decisions.md
 * §4). LEAD: the entry point and the list of checks. The checks are built in three parts, each owned by one builder:
 * musicfit-proof.makers.ts (A: B1, B2, S1–S4, S7, L3, I1, I2), musicfit-proof.hosts.ts (B: B3, B4, S5, S6, L1, L2, W1–W3, W5, W6, I3;
 * run in the integration round, after A merged), musicfit-proof.ui.ts (C: U1). Integration (wave 7 batch B) imports the makers and hosts
 * parts here; the UI part has a marked place below and reports BLOCKED until builder C's file is merged and wired.
 * Five states, each counted on its own: pass; partial (a part of the check could not be measured here: never counted as a pass);
 * blocked (it could not run here, with the reason); fail. Exit 0 only when every check passes, 1 on any failure, 2 otherwise.
 * Fixtures are SYNTHETIC only, made by the proof: built-in tracks from the product; songs written by the proof's own code as WAV (an
 * A·B·A song at 120 BPM of sine chords and noise-burst drums with a 4-bar ending; a song whose two sides of the join are steady tones
 * of different pitch; a through-composed song; a song drifting 120→123 BPM); a time-preserving copy made by a local-tool job; barcode
 * clips at 320×180 with one white frame and a beep at a known source frame; a temporary library folder with a ledger the proof writes
 * (CC-BY-4.0 and CC-BY-NC-4.0 rows of the synthetic song). Never downloaded or copyrighted music; no owner clip. At most five exports;
 * films at most 20 s; not run beside music.test.ts M10. Writes docs/evidence/musicfit-proof.json; the whole proof's wall
 * time is recorded once, not gated. Nobody here can listen: every check is a measurement, none says how anything sounds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMusicfitMakers } from './musicfit-proof.makers.ts';
import { closeMusicfitProofHosts, MUSICFIT_HOST_COVERS, MUSICFIT_PROOF_HOSTS } from './musicfit-proof.hosts.ts';

export const MUSICFIT_PROOF_BUILT = true;
export const MUSICFIT_CHECKS: Readonly<Record<string, string>> = {
  B1: 'for three styles and lengths from each style\'s minimum to 40 s at 30 and 30000/1001 fps: the file has exactly sampleFramesFor(E − S) frames, its beats are k·spb < totalFrames, every ending note of the arranger starts at K·bar with gate endFrames and none starts later',
  B2: 'a request with the default ending (no endFrames, or one bar) gives the bytes, name and params of music.golden.json',
  B3: 'in the exported film the music clip\'s last frame is the film\'s last frame and the file is at most one sample longer; the file\'s trailing digital silence is at most 150 ms; the RMS of the 100 ms before the two-beat fade is at least −45 dBFS',
  B4: 'a template applied with builtinMusic.ending "exact" has no builtin_music_faded notice, no fade-out, and its music clip ends on the last picture frame',
  S1: 'on the A·B·A song the first candidate removes A→A (32 bars) with similarity ≥ 0.99 and the made file equals the expected concatenation within 1 LSB at every sample; on the two-tone song the crossfade samples equal the closed form of a linear equal-gain crossfade ending on the join within 1 LSB',
  S2: 'every beat of the made file\'s analysis equals the mapped source beat exactly; the product\'s tracker on the made file agrees on at least 95 % of beats with a median error of at most 12 ms, and on the four beats each side of the join within 24 ms',
  S3: 'the through-composed song gives join_weak; no string of the block, dialog or chip contains a praise word (MUSICFIT_FORBIDDEN_WORDS, he and en) before heard is set',
  S4: 'join.wav equals the same samples of the made file',
  S5: 'an agent credential gets 403 human_approval_required on the heard route and has no tool for it; the owner\'s mark commits mark_join_heard and changes the chip; one undo removes it',
  S6: 'the remainder the plan states (early or cut, in seconds) equals the one measured in the exported sound within one frame',
  S7: 'through a time-preserving copy made by a local-tool job the same removal is chosen, with the copy\'s offset applied',
  L1: 'a CC-BY-4.0 song of the proof\'s library: the made file carries the credit, the description text has the credit verbatim and «(קוצר בעורך: הוסרו תיבות מהאמצע)» after it',
  L2: 'a CC-BY-NC-4.0 song: the made file is non-commercial, the export warns «לשימוש לא מסחרי בלבד», and the shared archive omits its bytes',
  L3: 'a record the licence table refuses (and a file made from two library files) is refused by the plan and by add_fitted_music with its reason and next step; nothing is made',
  W1: 'film, built-in 120 → 80 BPM: every cut of an untouched pick is on a bar or half-bar frame of the new grid; a pick trimmed by hand has the same fingerprint and place; a pick moved by a gap-closing delete is laid out again (moved_back); a dragged pick stays; one Ctrl+Z restores the exact document hash; the made track is still in the library',
  W2: 'film, 72 → 128 BPM, exported at 30 fps and checked on the document at 24 and 60 fps: no cut this plan makes is closer than flashGapFrames to another; the plan\'s thinned equals the cuts actually missing; two kept cuts closer than the gap give kept_cuts_close, not a refusal',
  W3: 'a template with a slot edited by hand: the plan lists it under blocked with the Hebrew of template_blocked, apply refuses, and the document hash is unchanged',
  W5: 'a film whose music clip had a hand-set gain: the new music has that gain; the dropped volume keys are counted in the answer (music_keys_dropped)',
  W6: 'after tailoring a film\'s music, «אורך אחר» reports music_short and the film bar offers «התאמה לאורך» again',
  I1: 'after sync_impact the white frame is on the beat\'s frame in the server still and in the export; the clip\'s start and length are unchanged; the linked beep moved by the same amount; offsetBefore equals the frames counted from barcodes; no room → noRoom with both limits; a reversed clip lands on the beat too; undo is exact',
  I2: 'the same target through a music clip that shows the job-made copy: viaAssetId names the measured source',
  I3: 'after a swap the plan lists the marked clip with its new offset, and «ליישר שוב» puts the white frame on a beat frame in one transaction',
  U1: 'the three flows (fit, swap, impact) by keyboard only in Hebrew and in English (B, Alt+B, the dialog, the audition button with aria-pressed), RTL without overlap at 1280 and 1440 px; new states in audit:a11y; ids in audit:testids',
};


export type MusicfitStatus = 'pass' | 'partial' | 'blocked' | 'fail';
export interface MusicfitRow { id: string; part: 'makers' | 'hosts' | 'ui'; status: MusicfitStatus; measured?: unknown; missing?: string[]; reason?: string }

// ---------------------------------------------------------------- the UI part (builder C)
/**
 * UI PART — builder C's `musicfit-proof.ui.ts` (U1) is NOT merged in this build. When it lands, import its runner here and map its
 * results into rows (the file's own export decides the shape). Until then U1 is BLOCKED, never a pass.
 */
async function runUiPart(): Promise<MusicfitRow[]> {
  const ui = path.join(path.dirname(fileURLToPath(import.meta.url)), 'musicfit-proof.ui.ts');
  const reason = fs.existsSync(ui)
    ? 'BLOCKED: UI part present (musicfit-proof.ui.ts) but not wired into this entry yet'
    : 'BLOCKED: UI part not merged (musicfit-proof.ui.ts, builder C)';
  return [{ id: 'U1', part: 'ui', status: 'blocked', reason }];
}

async function main(): Promise<number> {
  const started = Date.now();
  const rows: MusicfitRow[] = [];
  for (const c of await runMusicfitMakers()) rows.push({ id: c.id, part: 'makers', status: c.status, measured: c.measured, ...(c.missing ? { missing: c.missing } : {}), ...(c.error ? { reason: c.error } : {}) });
  try {
    for (const [id, fn] of Object.entries(MUSICFIT_PROOF_HOSTS.checks)) {
      let r: true | string;
      try { r = await fn(); } catch (e) { r = `error: ${String((e as Error)?.stack ?? e).slice(0, 600)}`; }
      const status: MusicfitStatus = r === true ? 'pass' : r.startsWith('BLOCKED') ? 'blocked' : r.startsWith('PARTIAL') ? 'partial' : 'fail';
      console.log(`${status.toUpperCase().padEnd(8)} ${id} (hosts)${r === true ? '' : `  ${r.slice(0, 400)}`}`);
      const mk = rows.find((x) => x.id === id && x.part === 'makers');
      if (!mk) { rows.push({ id, part: 'hosts', status, measured: MUSICFIT_PROOF_HOSTS.evidence[id], ...(r === true ? {} : { reason: r }) }); continue; }
      // the same id in both parts (integration): the host check measures what the makers check left as `missing`
      const cover = MUSICFIT_HOST_COVERS[id] ?? { drop: [] };
      const hostRow = { status, measured: MUSICFIT_PROOF_HOSTS.evidence[id], ...(r === true ? {} : { reason: r }) };
      mk.measured = { makers: mk.measured, hosts: hostRow };
      if (status === 'fail') { mk.status = 'fail'; mk.reason = `hosts: ${r}`; continue; }
      if (status !== 'pass') { mk.reason = `hosts ${status}: ${r}`; continue; }
      const left = (mk.missing ?? []).filter((m) => !cover.drop.some((d) => m.includes(d)));
      const still = [...left, ...(cover.remaining ?? [])];
      if (still.length) mk.missing = still; else delete mk.missing;
      if (mk.status === 'partial' && !still.length) mk.status = 'pass';
    }
  } finally { await closeMusicfitProofHosts(); }
  rows.push(...(await runUiPart()));
  const order = Object.keys(MUSICFIT_CHECKS);
  rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const count = (s: MusicfitStatus) => rows.filter((r) => r.status === s).map((r) => r.id);
  const missingIds = order.filter((id) => !rows.some((r) => r.id === id));
  for (const id of missingIds) rows.push({ id, part: 'hosts', status: 'blocked', reason: 'BLOCKED: no part of this build runs this check' });
  const summary = { pass: count('pass'), partial: count('partial'), blocked: count('blocked'), fail: count('fail') };
  for (const r of rows.filter((x) => x.part === 'makers')) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id}${r.missing ? `  not measured: ${r.missing.join('; ')}` : ''}${r.reason ? `  ${r.reason.slice(0, 300)}` : ''}`);
  const wallSeconds = (Date.now() - started) / 1000;
  console.log(`musicfit proof: ${summary.pass.length} pass, ${summary.partial.length} partial (not a pass), ${summary.blocked.length} blocked, ${summary.fail.length} fail of ${rows.length}; ${wallSeconds.toFixed(1)} s wall (one sample)`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/evidence/musicfit-proof.json'), `${JSON.stringify({ at: new Date().toISOString(), wallSeconds, note: 'partial is its own state and is never counted as a pass; nobody here listened: every value is a measurement', summary, checks: rows }, null, 2)}\n`);
  return summary.fail.length ? 1 : summary.partial.length || summary.blocked.length ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
