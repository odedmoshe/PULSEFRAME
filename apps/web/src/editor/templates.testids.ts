/**
 * Fixed data-testids of the templates and adjustment layers UI (ADR-0016), shared by the editor components and the proofs
 * (editor-interactions-proof.ts, a11y-audit.ts). Lead contracts commit: the templates track (W2) puts exactly these on the
 * elements named here; a list item repeats its id and carries a data-* attribute (data-template-id, data-genre, data-key …).
 */
export const TEMPLATE_TESTIDS = {
  // adjustment layers
  /** Timeline add-track button for an adjustment track (the existing pattern `add-track-${kind}`). */
  addTrackAdjustment: 'add-track-adjustment',
  /** Clip inspector of an adjustment clip: its opacity control, and "cover the whole edit" (trim_clip). */
  adjustOpacity: 'adjust-opacity',
  adjustCoverEdit: 'adjust-cover-edit',
  /** LookPanel and EffectGallery: the "apply to" radio group and its two radios (this clip / the whole edit). */
  applyTo: 'apply-to',
  applyToClip: 'apply-to-clip',
  applyToEdit: 'apply-to-edit',
  /** Clip inspector of a media clip: "Replace media…" and each candidate asset (data-asset-id). */
  replaceMedia: 'replace-media',
  replaceMediaOption: 'replace-media-option',
  // templates
  /** Library drawer, its genre chips (data-genre, aria-pressed) and its cards (data-template-id, data-available). */
  drawer: 'templates-drawer',
  genreChip: 'template-genre',
  card: 'template-card',
  /** The reason shown on an unavailable card. */
  cardReason: 'template-unavailable-reason',
  /** The dialog, its step headers (data-step = media | music | texts | plan, aria-current) and its close button. */
  dialog: 'template-dialog',
  step: 'template-step',
  close: 'template-close',
  /** Step 1: the ordered media list (items data-asset-id) and the move buttons of an item. */
  media: 'template-media',
  mediaEarlier: 'template-media-earlier',
  mediaLater: 'template-media-later',
  /** Step 2: the music choice (items data-asset-id; "none" has data-asset-id="") and "measure the beat (no AI)". */
  music: 'template-music',
  measureBeats: 'template-measure-beats',
  /** Step 3: a text field (data-key) and its character counter. */
  text: 'template-text',
  textCount: 'template-text-count',
  /** Step 4: the plan region (aria-live=polite), its blocking list, an alternative radio (data-index), reduced motion, and "Use". */
  plan: 'template-plan',
  blocking: 'template-blocking',
  alternative: 'template-alternative',
  motionNone: 'template-motion-none',
  use: 'template-use',
  /** After apply: the non-modal bar, shuffle and another tempo. */
  applied: 'template-applied',
  shuffle: 'template-shuffle',
  otherTempo: 'template-other-tempo',
  /** Welcome: the "start from a template" step card. */
  welcomeTemplate: 'welcome-template',
} as const;
export type TemplateTestId = (typeof TEMPLATE_TESTIDS)[keyof typeof TEMPLATE_TESTIDS];
