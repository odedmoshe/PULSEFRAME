/** Moves the chosen cut (the inspector's roll buttons and the loupe's keys share it): two trims in one transaction, through the store. */
import { followedBeats } from '@pulseframe/core';
import type { Editor } from './store.ts';
import { cutBefore, framesToNearestBeat, rollCutOps } from './inspector.model.ts';

/** Rolls the cut at the start of `clipId` by `frames`. Resolves to the refusal (in the interface language), or null when it went through or there was nothing to do. */
export async function rollCut(editor: Editor, clipId: string, frames: number): Promise<string | null> {
  if (!frames) return null;
  let asked = false;
  const r = await editor.commit(() => {
    const now = editor.doc ? cutBefore(editor.doc, clipId) : null;
    const ops = now && editor.doc ? rollCutOps(editor.doc, now, frames) : null;
    asked = !!ops;
    return ops;
  }, 'Roll the cut');
  return r || !asked ? null : editor.getState().error;
}

/** Frames from the cut at the start of `clipId` to the nearest analysed beat of the music under it (0 = on the beat; null = no beat within two seconds). */
export function cutToBeat(editor: Editor, clipId: string): number | null {
  const doc = editor.doc;
  const cut = doc ? cutBefore(doc, clipId) : null;
  if (!doc || !cut) return null;
  const fps = editor.rate.num / editor.rate.den, at = cut.frame / fps;
  return framesToNearestBeat(cut.frame, followedBeats(doc, at - 2, at + 2).map((b) => b.t), fps);
}
