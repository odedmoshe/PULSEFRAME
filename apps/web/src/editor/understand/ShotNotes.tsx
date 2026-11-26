/**
 * «מה יש בקליפ» — the shots and notes of the file in the source viewer, and Settings › «מה יש בקליפ», and the notes section of
 * «חיפוש בצילומים» (wave 8 understand). SourceViewer.tsx, SettingsDialog.tsx and search/FootageResults.tsx mount these only once
 * UNDERSTAND_UI_BUILT, so no dead button is shown. W3 (sonnet) builds, in this folder, against understandApi.ts, understand.testids.ts
 * and the `understand.*` strings (packages/i18n/src/understand.ts), plan §3.7 as corrected by verify C7, C13:
 * - ShotNotes: the state line (aria-live, the only one) with «תארו את הצילומים» / «עצרו» / «תארו שוב» / «ביטול התיאורים» (api.undo with
 *   the pointer's transaction id; an undo_conflict says understand.undoConflict); the list grouped by shot: a row = the sprite tile
 *   (a photo: the image itself), the time in <bdi dir="ltr">, the caption in the UI language with the other as fallback and the
 *   «באנגלית» chip, on-screen text in quotes (dir="auto"), the shot size, the model chip «תיאור של {model} · לא נבדק», a failed span
 *   «לא תואר: {why}»; keyboard as FootageResults (ArrowUp/Down, Home/End, Enter = seek the viewer, Shift+Enter = insert through
 *   placementOps); without a describer the shots with the honest setup line and the next step. No drawer card line (cut, decision 7).
 * - UnderstandSettings: auto, density 10 / 30, the describing model (connected agent providers with vision rows, a local preset with
 *   «המודל המקומי הזה מקבל תמונות», none), frames per span, the line of what a cloud model receives and the cost line.
 * - NotesSection: «לפי מה שתואר» rows like the picture rows with the chips «לפי התיאור» / «בטקסט על המסך» and the model label.
 * Rules: logical CSS (RTL), no focus moved in a later task (deferredFocus.test.ts), plural Hebrew, nothing called checked or right.
 */
export const UNDERSTAND_UI_BUILT = false;

export function ShotNotes(_props: { assetId: string; onSeek: (frame: number) => void }): null {
  return null;
}
export function UnderstandSettings(): null {
  return null;
}
export function NotesSection(_props: { query: string; onView: (assetId: string) => void }): null {
  return null;
}
