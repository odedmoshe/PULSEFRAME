/**
 * «קליפ מקוד» entry in the Text pane (wave 8 motioncode). Library.tsx mounts it only once MADE_UI_BUILT, so no dead button is shown.
 * W3 builds MadeEntry (the secondary button MADE_TESTIDS.entry opening MadeClipDialog), MadeClipDialog, MadeResult and the Inspector
 * line in this folder, against madeApi.ts, made.testids.ts and the `made.*` strings (packages/i18n/src/made.ts). Rules: the result never
 * autoplays (stills first, a press to play; paused under prefers-reduced-motion); the dialog keeps focus as the template dialog does and
 * moves no focus in a later task (deferredFocus.test.ts); text inputs dir="auto"; numbers in <bdi dir="ltr">.
 */
export const MADE_UI_BUILT = false;

export function MadeEntry(): null {
  return null;
}
