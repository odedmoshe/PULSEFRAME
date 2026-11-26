/**
 * The export half of the credits GOLDEN (wave 8 `sources`, verify C3; the core half and the fixture documents are
 * packages/core/src/credits.golden.{test,fixtures}.ts). Recorded in the pre-pass BEFORE libraryCredits.ts and the export lines were
 * touched: exportLicence (the export job's output.licence, Hebrew description text) and libraryExportWarnings (codes, messages, ids,
 * hints) of the library-only documents must stay byte-identical when W1 adds source records and neutral wording for NEW cases.
 * Re-record ONLY with a lead decision: PF_RECORD_GOLDEN=1 pnpm vitest run apps/server/src/library/credits.golden.test.ts
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportLicence, libraryExportWarnings } from '../export.ts';
import { GOLD_DOCS } from '../../../../packages/core/src/credits.golden.fixtures.ts';

const FILE = new URL('./credits.golden.json', import.meta.url);

describe('export credits golden (library-only documents answer byte-identically)', () => {
  const now = Object.fromEntries(GOLD_DOCS.map(([name, make]) => { const doc = make(); return [name, { licence: exportLicence(doc), warnings: libraryExportWarnings(doc) }]; }));
  if (process.env.PF_RECORD_GOLDEN) fs.writeFileSync(FILE, `${JSON.stringify(now, null, 1)}\n`);
  const golden = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, unknown>;
  it.each(GOLD_DOCS.map(([name]) => name))('%s', (name) => {
    expect(JSON.stringify(now[name])).toBe(JSON.stringify(golden[name]));
  });
});
