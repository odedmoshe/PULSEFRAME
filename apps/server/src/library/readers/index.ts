/**
 * Which reader reads which ledger entry (wave 7 library track, worker A).
 * - By source id first (READER_BY_SOURCE: the sources of the real manifests).
 * - Then by folder, for a source this build has no reader of its own for (plan §3.1: "any audio source without a reader" is read
 *   by generic-audio, pictures by generic-image): music/ and sounds/ → generic-audio, visual/ → generic-image. The licence is still
 *   the core table's to judge, so a source read this way is listed only as far as its licence allows.
 * - Never: sources whose files each carry their own licence (PER_FILE_LICENCE_SOURCES: FSD50K, FSL10K; no reader this wave),
 *   and the folders whose kinds are counted, not listed (NOT_LISTED_DIRS). Both are counted in the status, by folder or source.
 */
import type { LedgerEntry } from '@pulseframe/core';
import { cldr } from './cldr.ts';
import { fluentEmoji } from './fluentEmoji.ts';
import { genericAudio } from './genericAudio.ts';
import { genericImage } from './genericImage.ts';
import { iconify } from './iconify.ts';
import { incompetech } from './incompetech.ts';
import { notoEmoji } from './notoEmoji.ts';
import type { Reader } from './types.ts';

export const READERS: readonly Reader[] = [genericAudio, incompetech, fluentEmoji, notoEmoji, iconify, cldr, genericImage];
export const READER_BY_SOURCE: Readonly<Record<string, Reader>> = {
  'musopen-flac': genericAudio, 'musopen-chopin': genericAudio, incompetech, 'fluent-emoji': fluentEmoji, 'noto-emoji': notoEmoji,
  'iconify-json': iconify, 'cldr-annotations': cldr,
};
export const PER_FILE_LICENCE_SOURCES: readonly string[] = ['fsd50k', 'fsl10k'];
/** Folders counted in the status, never listed (instruments, models, fonts, maps, transitions). */
export const NOT_LISTED_DIRS: readonly string[] = ['instruments', 'models', 'visual/fonts', 'visual/maps', 'visual/transitions'];

export type Choice = { reader: Reader } | { notListed: string };
export function readerFor(e: LedgerEntry): Choice {
  const dir = NOT_LISTED_DIRS.find((d) => e.path === d || e.path.startsWith(`${d}/`));
  if (dir) return { notListed: dir };
  if (PER_FILE_LICENCE_SOURCES.includes(e.source)) return { notListed: `source:${e.source}` };
  const own = Object.hasOwn(READER_BY_SOURCE, e.source) ? READER_BY_SOURCE[e.source] : undefined;
  if (own) return { reader: own };
  if (e.path.startsWith('music/') || e.path.startsWith('sounds/')) return { reader: genericAudio };
  if (e.path.startsWith('visual/')) return { reader: genericImage };
  return { notListed: `source:${e.source}` };
}
