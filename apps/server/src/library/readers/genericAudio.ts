/** generic-audio: one row per audio file (a file item, or every audio file of a tree); title from the file name; the source's licence. */
import type { LibraryKind } from '@pulseframe/core';
import { baseOf, extOf, titleFromName, walk, type Reader, type ReaderCtx, type ReaderRow } from './types.ts';

/** Listed audio types; m4a is listed but has no audition (contract AUDITION_TYPES). */
export const AUDIO_EXTS = new Set(['flac', 'wav', 'mp3', 'ogg', 'm4a']);
export function audioKind(entryPath: string): LibraryKind {
  if (entryPath.startsWith('sounds/loops')) return 'loop';
  return entryPath.startsWith('sounds/') ? 'sound' : 'music';
}
export function audioRow(ctx: ReaderCtx, rel: string, name: string, bytes: number, mtimeMs: number | null): ReaderRow {
  return { rel, kind: audioKind(ctx.entry.path), title: titleFromName(name), meta: { genre: [], mood: [], instruments: [], tags: [] }, words: [], bytes, mtimeMs, format: extOf(name) };
}
export const genericAudio: Reader = {
  id: 'generic-audio',
  async rows(ctx, emit) {
    const e = ctx.entry;
    if (e.kind === 'file') {
      if (AUDIO_EXTS.has(extOf(e.path))) await emit(audioRow(ctx, '', baseOf(e.path), e.bytes, null));
      return;
    }
    await walk(ctx, '', async (rel, name) => {
      if (!AUDIO_EXTS.has(extOf(name))) return;
      const st = await ctx.stat(rel);
      if (st) await emit(audioRow(ctx, rel, name, st.size, st.mtimeMs));
    });
  },
};
