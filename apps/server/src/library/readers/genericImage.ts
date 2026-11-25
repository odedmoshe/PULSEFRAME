/** generic-image: pictures (png, jpg, webp, svg; gif and animated png listed as animated) and video files of an item; title from the file name. */
import type { LibraryKind } from '@pulseframe/core';
import { baseOf, extOf, gifAnimated, pngInfo, titleFromName, walk, type Reader, type ReaderCtx } from './types.ts';

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif']);
export const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv']);
function pictureKind(p: string): LibraryKind {
  const s = p.toLowerCase();
  if (/(^|\/)textures?(\/|$)/.test(s)) return 'texture';
  if (/(^|\/)(backdrops?|backgrounds?|hdris?)(\/|$)/.test(s)) return 'backdrop';
  return 'illustration';
}
async function one(ctx: ReaderCtx, rel: string, name: string, emit: Parameters<NonNullable<Reader['rows']>>[1], fileItem: boolean) {
  const ext = extOf(name);
  if (!IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) return;
  const st = fileItem ? { size: ctx.entry.bytes, mtimeMs: null } : await ctx.stat(rel);
  if (!st) return;
  let animated = false, width: number | undefined, height: number | undefined;
  if (ext === 'png' || ext === 'gif') {
    const head = await ctx.head(rel, 64 * 1024);
    if (head && ext === 'png') { const i = pngInfo(head); if (i) { animated = i.animated; width = i.width; height = i.height; } }
    if (head && ext === 'gif') animated = gifAnimated(head);
  }
  const video = VIDEO_EXTS.has(ext);
  await emit({
    rel, kind: video ? 'video' : pictureKind(`${ctx.entry.path}/${rel}`), title: titleFromName(name),
    meta: { genre: [], mood: [], instruments: [], tags: [], ...(width ? { width, height } : {}), ...(animated ? { animated: true } : {}) },
    words: [], bytes: st.size, mtimeMs: st.mtimeMs, format: ext, ...(animated ? { animated: true as const } : {}),
  });
}
export const genericImage: Reader = {
  id: 'generic-image',
  async rows(ctx, emit) {
    if (ctx.entry.kind === 'file') return one(ctx, '', baseOf(ctx.entry.path), emit, true);
    await walk(ctx, '', (rel, name) => one(ctx, rel, name, emit, false));
  },
};
