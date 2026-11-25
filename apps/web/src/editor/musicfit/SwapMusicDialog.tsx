/**
 * «מוזיקה אחרת» (wave 7 musicfit track). BUILDER C builds it: a button (MUSICFIT_TESTIDS.swap, data-host) opening a dialog that lists
 * library songs with measured beats and the built-in styles, a tick «להתאים גם את האורך», and the "what changes" table from the plan
 * (cuts before → after, shortest gap in frames, cuts left out for the flash rule, clips kept by hand, clips laid out again, template
 * slots blocked by name, marked moments that move off the beat, volume keys dropped); «בצעו» applies. Reachable by Tab; Escape returns
 * focus to the button. Mounted in FilmBar.tsx (host film), TemplatesDrawer.tsx's applied bar (host template) and MusicFitBlock (host clip).
 */
export type SwapHost = { kind: 'clip'; clipId: string } | { kind: 'film'; runId: string } | { kind: 'template'; runId: string };

export function SwapMusicButton({ host }: { host: SwapHost }) {
  void host;
  return null;
}
