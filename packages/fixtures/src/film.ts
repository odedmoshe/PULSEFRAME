/**
 * Fixtures of the family film proof and the moments job tests (ADR-0026): generateFilmFixtures({ outDir }) writes the clips, the
 * still and truth.json described in packages/evals/src/family-film-proof.ts (chroma-only barcode carrying (clip << 12 | frame),
 * read with readBarcodeChannel of index.ts; 6 s truth windows; decoy, dark, silent, static, 80 %-active and late-picture clips;
 * capture times out of name order). Tests import this file by relative path (apps/server has no @pulseframe/fixtures dependency).
 *
 * LEAD STUB, final signature. W2 owns the body and film.test.ts. Until then it refuses; nothing is written.
 */
export interface FilmFixtureTruth {
  clips: { name: string; clip: number; frames: number; rate: { num: number; den: number }; startOffsetFrames: number; sound: boolean;
    truth: { fromFrame: number; toFrame: number } | null; decoy: { fromFrame: number; toFrame: number } | null; dark: { fromFrame: number; toFrame: number } | null;
    activeShare: number; capture: string }[];
  still: { name: string; capture: string };
}
export async function generateFilmFixtures(opts: { outDir: string }): Promise<FilmFixtureTruth> {
  void opts;
  throw new Error('generateFilmFixtures: not built yet (family film W2)');
}
