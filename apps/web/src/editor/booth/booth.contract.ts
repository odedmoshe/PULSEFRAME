/**
 * The interface contract between the booth's builders (wave 8 booth pre-pass; frozen). W3 owns the dialog and mounts W2's components
 * through exactly these props; W2 owns the browser checks, the picture card and the mic card. Wire types are core's
 * (@pulseframe/core booth/contract.ts): nothing here is a second definition of them.
 */
import type { BoothAnswerBody, BoothBrowserCheckId, BoothCheckRow, BoothItemView } from '@pulseframe/core';
import type { FlashGuard } from '@pulseframe/engine';
import type { Lang } from '@pulseframe/i18n';

/** W2 (check/browserChecks.ts): one browser row. Never throws; a timeout is state 'unknown'. No timing sample (verify C3 row 1). */
export type BrowserCheckRunner = (id: BoothBrowserCheckId, signal: AbortSignal) => Promise<BoothCheckRow>;

/** What a card hands back to the dialog with an answer: the adapter facts of a picture, the played hash of a sound. */
export type BoothAnswerExtras = Pick<BoothAnswerBody, 'played' | 'browserAdapter' | 'browserSoftware' | 'exportAdapter' | 'exportSoftware' | 'mic'>;


/** W2 (BoothPicture.tsx): the editor-tab drawing of a picture item on the two test pictures. */
export interface BoothPictureProps {
  lang: Lang; view: BoothItemView;
  /** the row browser-gpu as it answered (adapter string in data.adapter, data.software) */ browserGpu: BoothCheckRow | null;
  /** ONE engine FlashGuard per dialog (EffectGallery.tsx precedent): every animated frame passes guard.paint */ guard: FlashGuard; reducedMotion: boolean;
  /** called once the card knows its adapter facts (the dialog adds them to the answer) */ onExtras: (x: BoothAnswerExtras) => void;
  /** (integration) the drawing itself found no graphics card: the card then offers only «דלגו» */ onNeedsGpu?: (needs: boolean) => void;
}
/** W2 (BoothExportStrip.tsx): the 7 export stills beside the editor drawing; runs only from its own button (heavy). */
export interface BoothExportStripProps { lang: Lang; views: readonly BoothItemView[]; exportGpu: BoothCheckRow | null; onExtras: (itemId: string, x: BoothAnswerExtras) => void }
/** W2 (MicCard.tsx): 5 s through the story recorder's own path, measured, played back from memory, dropped on close. */
export interface BoothMicProps { lang: Lang; view: BoothItemView; onMeasured: (m: { peakDbfs: number | null; clipped: number }) => void }
