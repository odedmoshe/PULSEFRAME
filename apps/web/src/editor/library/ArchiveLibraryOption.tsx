/**
 * Deliver → archive: «ארכיון לשיתוף» (library=strip) / «ארכיון לעצמי» (library=keep, the owner's own session) when the project
 * holds library files that may not be passed on (wave 7 library track). It reports the choice; DeliverPanel builds the link.
 * WORKER C builds it; until then it draws nothing and chooses nothing (the archive link is exactly as before).
 */
import type { ArchiveLibraryMode } from '@pulseframe/core';

export function ArchiveLibraryOption({ projectId, onMode }: { projectId: string; onMode: (mode: ArchiveLibraryMode | null) => void }) {
  void projectId; void onMode;
  return null;
}
