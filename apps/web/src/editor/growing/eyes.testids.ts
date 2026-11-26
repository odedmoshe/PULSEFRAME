/**
 * Fixed data-testids of «הציעו עיניים» in the marking view of «גדלים מול העיניים» (wave 8 picmodels; W3 mounts them after the growing
 * integration is merged). Lead contract: W3 puts exactly these on the elements named here and does not rename or remove one (it may add
 * ids at the end). Kept apart from growing.testids.ts so the two tracks never edit the same file (verify C13).
 */
export const EYES_TESTIDS = {
  // the button «הציעו עיניים» (disabled with the setup words when not ready; data-code = the setup code) and «עצרו» while it runs
  suggest: 'eyes-suggest', stop: 'eyes-stop',
  // the setup line beside the button (data-code = not_built | engine_not_configured | … | ready)
  state: 'eyes-state',
  // the proposal overlay (data-outcome = faces | none | too_many), a proposed ring (data-face = 0.., data-state = first | second;
  // data-chosen = true | false), the face letter (א/ב…, for this session only), «אשרו את ההצעה»
  proposal: 'eyes-proposal', ring: 'eyes-ring', face: 'eyes-face', accept: 'eyes-accept',
  // the line that says what to do (one, many, none, too many, closer, failed), and the privacy sentence (verify C11)
  note: 'eyes-note', privacy: 'eyes-privacy',
} as const;
export type EyesTestId = (typeof EYES_TESTIDS)[keyof typeof EYES_TESTIDS];
