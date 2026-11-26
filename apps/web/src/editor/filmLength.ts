import * as T from '@pulseframe/time';
import { sequenceDuration, type ProjectDocument } from '@pulseframe/core';

/**
 * The film's length as the top bar and the status bar print it (m:ss). One figure: the project's length, the same one the transport
 * and the project panel show, which counts sound that runs past the last picture (design review 2026-11-26, D7).
 */
export function filmClock(doc: ProjectDocument | null | undefined): string {
  const seconds = doc ? T.toSeconds(sequenceDuration(doc)) : 0;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
