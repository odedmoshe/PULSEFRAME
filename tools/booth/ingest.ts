/**
 * pnpm booth:ingest <file> [--out <dir>] — the lead's tool (wave 8 booth; verify C4). Reads a pasted report, parses the machine block with
 * core parseBoothBlock (refuses non-ASCII, a checksum mismatch or an invalid block, with the reason) and writes
 * docs/evidence/owner-review/<date>.json with NO notes (that folder is committed and pushed; the block has no notes and nothing of the
 * human part is read). An answer whose recipe differs from the recipe at the commit being ingested is marked `stale: true`.
 * Status word (defined once in docs/CAPABILITIES.md at integration): `owner-reviewed (their machine, <date>, adapter <x>, build <y>)` —
 * the owner's statement, never "verified", never "good".
 *
 * Sounds: an SFX recipe holds the first line of `ffmpeg -version` of the machine that made it. The block carries the owner's ffmpeg
 * line only as the ffmpeg row's version (allow-listed characters); the recipe is matched against that line and against this machine's,
 * and an SFX answer matching neither is stale with `why: 'recipe-or-ffmpeg'` (the two cannot be told apart from the block).
 * Exit codes: 0 written; 1 refused (with the reason); 2 usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBoothBlock, type BoothBlock, type BoothItem } from '../../packages/core/src/index.ts';
import { gitCommit, REPO_ROOT } from '../../apps/server/src/booth/build.ts';
import { boothItems, ffmpegFirstLine } from '../../apps/server/src/booth/registry.ts';
import { boothPictures } from '../../apps/server/src/booth/testPicture.ts';

export const OWNER_REVIEW_EVIDENCE_DIR = path.join('docs', 'evidence', 'owner-review');
export const INGEST_REFUSALS = {
  no_block: 'no machine block (-----BEGIN PF-BOOTH 1-----) was found in the file; paste the whole report, including the block',
  not_ascii: 'the machine block holds a character outside plain ASCII (a chat app may have added a direction mark); copy the report again with the booth\'s copy button',
  checksum: 'the machine block\'s sha256 line does not match its text: something changed after it was copied; copy the report again',
  invalid: 'the machine block is not in the shape this build reads (another version, or a damaged block)',
} as const;

export interface IngestedAnswer {
  id: string; verdict: string; problems?: string[]; date: string; state: 'answered' | 'changed';
  browserAdapter?: string; browserSoftware?: boolean; exportAdapter?: string; exportSoftware?: boolean;
  stale: boolean; why?: 'recipe' | 'recipe-or-ffmpeg' | 'unknown-item';
}
export interface IngestedReview {
  status: 'owner-reviewed'; statusWord: string; date: string; build: BoothBlock['build']; machine: BoothBlock['machine'];
  ingestedAt: { commit: string }; answers: IngestedAnswer[]; checks: BoothBlock['checks'];
}

/** The adapter the status word names: the editor tab's (row browser-gpu), else the export worker's (row export-gpu), else 'unknown'. */
function adapterOf(block: BoothBlock): string {
  for (const id of ['browser-gpu', 'export-gpu'] as const) {
    const d = block.checks.find((c) => c.id === id)?.data;
    const v = d && (typeof d.adapter === 'string' && d.adapter ? d.adapter : typeof d.vendor === 'string' && d.vendor ? d.vendor : '');
    if (v) return v;
  }
  return 'unknown';
}

/** Pure: the evidence JSON of a pasted report, against the recipes of the build being ingested (`itemsFor(ffmpegLine)`). */
export function ingestBoothReport(text: string, at: { commit: string; localFfmpegLine: string; itemsFor: (ffmpegLine: string) => readonly BoothItem[] }):
  { ok: true; review: IngestedReview } | { ok: false; code: keyof typeof INGEST_REFUSALS; message: string } {
  const p = parseBoothBlock(text);
  if (!p.ok) return { ok: false, code: p.code, message: INGEST_REFUSALS[p.code] };
  const b = p.block;
  const theirFfmpeg = b.checks.find((c) => c.id === 'ffmpeg')?.data.version;
  const lines = [...new Set([...(typeof theirFfmpeg === 'string' && theirFfmpeg ? [theirFfmpeg] : []), at.localFfmpegLine])];
  const recipes = lines.map((l) => new Map(at.itemsFor(l).map((i) => [i.id, i])));
  const answers = b.answers.map((a): IngestedAnswer => {
    const known = recipes.map((m) => m.get(a.id)).filter((i): i is BoothItem => !!i);
    const base: IngestedAnswer = {
      id: a.id, verdict: a.verdict, ...(a.problems ? { problems: [...a.problems] } : {}), date: a.date, state: a.state,
      ...(a.browserAdapter !== undefined ? { browserAdapter: a.browserAdapter } : {}), ...(a.browserSoftware !== undefined ? { browserSoftware: a.browserSoftware } : {}),
      ...(a.exportAdapter !== undefined ? { exportAdapter: a.exportAdapter } : {}), ...(a.exportSoftware !== undefined ? { exportSoftware: a.exportSoftware } : {}), stale: false,
    };
    if (!known.length) return { ...base, stale: true, why: 'unknown-item' };
    if (known.some((i) => i.recipe === a.recipe)) return base;
    return { ...base, stale: true, why: known[0]!.source === 'sfx' ? 'recipe-or-ffmpeg' : 'recipe' };
  });
  const adapter = adapterOf(b);
  return {
    ok: true,
    review: {
      status: 'owner-reviewed', statusWord: `owner-reviewed (their machine, ${b.date}, adapter ${adapter}, build ${b.build.commit})`,
      date: b.date, build: b.build, machine: b.machine, ingestedAt: { commit: at.commit }, answers, checks: b.checks,
    },
  };
}

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args.splice(outAt, 2)[1] : path.join(REPO_ROOT, OWNER_REVIEW_EVIDENCE_DIR);
  const file = args[0];
  if (!file || !out) { console.error('usage: pnpm booth:ingest <report file> [--out <dir>]'); return 2; }
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { console.error('booth:ingest: the report file could not be read'); return 2; }
  const picturesRgba = boothPictures().rgbaSha256;
  const r = ingestBoothReport(text, { commit: gitCommit(), localFfmpegLine: await ffmpegFirstLine(), itemsFor: (ffmpegLine) => boothItems({ ffmpegLine, picturesRgba }) });
  if (!r.ok) { console.error(`booth:ingest refused (${r.code}): ${r.message}`); return 1; }
  fs.mkdirSync(out, { recursive: true });
  const dest = path.join(out, `${r.review.date}.json`);
  fs.writeFileSync(dest, `${JSON.stringify(r.review, null, 1)}\n`);
  const stale = r.review.answers.filter((a) => a.stale).length;
  console.log(`booth:ingest wrote ${path.relative(REPO_ROOT, dest) || dest}: ${r.review.answers.length} answers (${stale} stale), ${r.review.checks.length} rows. ${r.review.statusWord}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
