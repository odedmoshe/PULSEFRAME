/**
 * «הסרת שתיקות» on the timeline toolbar (wave 8D) opens the silence finder on the inspector's speech page and puts the focus in it.
 * The finder is drawn by a later render, so the toolbar records the intent here and the finder gives the focus in the layout effect
 * of the commit that draws it (ds/focus.ts: never a focus from a timer or a frame).
 */
let wanted = false;
export const askSilenceFocus = (): void => { wanted = true; };
export const dropSilenceFocus = (): void => { wanted = false; };
/** True once after askSilenceFocus(): the caller gives the focus now. */
export const takeSilenceFocus = (): boolean => { const w = wanted; wanted = false; return w; };
