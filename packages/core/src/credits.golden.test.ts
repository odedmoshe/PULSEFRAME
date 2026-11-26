/**
 * The credits GOLDEN (wave 8 `sources`, verify C3 + "most likely to go wrong" 1; decisions «sources» A). Recorded in the pre-pass
 * from the library-only code, BEFORE libraryCredits.ts was touched. W1 moves the credit readers onto source records too
 * (licensedOrigins); for these documents — library, instruments, musicfit, derived/voice and plain — every answer below must stay
 * byte-identical: collectCredits (lines, description text in Hebrew and English, on-screen missing, non-commercial, people) for every
 * sequence, creditDue per line, shareable per asset, archiveLibraryPlan, the agent summary's library part, and add_credits_card's
 * heading and body text in both languages (or its refusal). The export answers (exportLicence, libraryExportWarnings) are
 * apps/server/src/library/credits.golden.test.ts.
 * Re-record ONLY with a lead decision: PF_RECORD_GOLDEN=1 pnpm vitest run packages/core/src/credits.golden.test.ts
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTransaction, archiveLibraryPlan, collectCredits, creditDue, OpError, shareable, summarize, validateProject, type ProjectDocument } from './index.ts';
import { GOLD_DOCS } from './credits.golden.fixtures.ts';

const FILE = new URL('./credits.golden.json', import.meta.url);

function answers(doc: ProjectDocument): unknown {
  const sequences = Object.keys(doc.sequences).sort().map((sequenceId) => {
    const r = collectCredits(doc, { sequenceId });
    const card = (lang: 'he' | 'en') => {
      try {
        const t = applyTransaction(doc, [{ op: 'add_credits_card', args: { sequenceId, lang } }], { idSeed: 'gold_', actor: 'test' });
        const texts = t.doc.sequences[sequenceId]!.tracks.flatMap((tr) => tr.clips).flatMap((c) => (c.type === 'text' && c.role === 'credits' ? [c.text] : []));
        return { texts, output: t.results[0]!.output };
      } catch (e) { if (e instanceof OpError) return { refused: e.message }; throw e; }
    };
    return {
      sequenceId, lines: r.lines, due: r.lines.map((l) => creditDue(doc, l)), he: r.descriptionText('he'), en: r.descriptionText('en'),
      onScreenMissing: r.onScreenMissing, nonCommercial: r.nonCommercial, people: r.people, card: { he: card('he'), en: card('en') },
    };
  });
  const assets = Object.values(doc.assets).sort((a, b) => (a.id < b.id ? -1 : 1));
  const summary = (summarize(doc).assets as { id: string; library?: unknown }[]).map((a) => ({ id: a.id, library: a.library ?? null }));
  return { sequences, shareable: assets.map((a) => [a.id, shareable(a)]), archive: archiveLibraryPlan(doc), summary };
}

describe('credits golden (library-only documents answer byte-identically)', () => {
  const now = Object.fromEntries(GOLD_DOCS.map(([name, make]) => [name, answers(make())]));
  if (process.env.PF_RECORD_GOLDEN) fs.writeFileSync(FILE, `${JSON.stringify(now, null, 1)}\n`);
  const golden = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, unknown>;
  it('the fixture documents are valid projects', () => {
    for (const [name, make] of GOLD_DOCS) expect([name, validateProject(make())]).toEqual([name, []]);
  });
  it.each(GOLD_DOCS.map(([name]) => name))('%s', (name) => {
    expect(JSON.stringify(now[name])).toBe(JSON.stringify(golden[name]));
  });
});
