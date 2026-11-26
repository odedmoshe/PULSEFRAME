/**
 * proof:send — the checks that another proof makes (wave 7, track send, integration). The editor rows of S13 and K6 run in
 * editor-interactions-proof.ts, and the Phase 0 preview-audio checks of L7d in phase0-proof.ts; running those browsers a second
 * time here would double the longest proofs of the repository. Instead the send proof READS their evidence files and judges the
 * named rows itself:
 *   - every row whose name matches is there and passed (none at all is a failure: the rows were renamed or removed);
 *   - the evidence was recorded after the web bundle that is built now (apps/web/dist/index.html): rows proven on an older bundle
 *     prove nothing about this one, so the check is BLOCKED with the command that makes them current.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

export interface EvidenceRows { state: 'pass' | 'fail' | 'blocked'; reason: string; rows: { name: string; ok: boolean }[]; ranAt: string | null; builtAt: string | null }

/** Rows of `docs/evidence/<file>` whose name matches `pattern`, judged as above. `command` is how to record them again. */
export function evidenceRows(file: string, pattern: RegExp, command: string): EvidenceRows {
  const ev = path.join(root, 'docs/evidence', file), dist = path.join(root, 'apps/web/dist/index.html');
  const builtAt = fs.existsSync(dist) ? fs.statSync(dist).mtime.toISOString() : null;
  if (!fs.existsSync(ev)) return { state: 'blocked', reason: `docs/evidence/${file} is missing: run ${command}`, rows: [], ranAt: null, builtAt };
  const report = JSON.parse(fs.readFileSync(ev, 'utf8')) as { ranAt?: string; checks?: { name?: string; ok?: boolean }[] };
  const rows = (report.checks ?? []).filter((c) => typeof c.name === 'string' && pattern.test(c.name)).map((c) => ({ name: c.name!, ok: c.ok === true }));
  const ranAt = report.ranAt ?? null;
  if (!builtAt) return { state: 'blocked', reason: 'the web bundle is not built here (run pnpm build)', rows, ranAt, builtAt };
  if (!rows.length) return { state: 'fail', reason: `no row of docs/evidence/${file} matches ${pattern}: the rows were renamed or removed`, rows, ranAt, builtAt };
  if (!ranAt || Date.parse(ranAt) < Date.parse(builtAt)) return { state: 'blocked', reason: `docs/evidence/${file} was recorded at ${ranAt ?? 'an unknown time'}, before the web bundle built at ${builtAt}: run ${command} on this build, then this proof`, rows, ranAt, builtAt };
  const failed = rows.filter((r) => !r.ok);
  return failed.length ? { state: 'fail', reason: `${failed.length} of ${rows.length} rows failed in docs/evidence/${file}`, rows, ranAt, builtAt } : { state: 'pass', reason: `${rows.length} of ${rows.length} rows passed in docs/evidence/${file}, recorded on this build`, rows, ranAt, builtAt };
}
