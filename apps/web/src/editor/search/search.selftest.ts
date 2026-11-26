/**
 * Footage search in this browser (wave 7 search track; proof check S3): window.__pfFootageSearch(doc, query) runs core searchFootage
 * with the owner reader and returns its JSON, which must equal the server's exact section byte for byte (the same function in Node).
 * Until core's function is built the hook throws FootageSearchNotBuilt, so the proof reports the check as blocked, never as passed.
 */
import { searchFootage, type ProjectDocument } from '@pulseframe/core';

export function footageSearchJson(doc: ProjectDocument, query: string): string {
  return JSON.stringify(searchFootage(doc, query, { reader: 'owner' }));
}
if (typeof window !== 'undefined') (window as unknown as { __pfFootageSearch: typeof footageSearchJson }).__pfFootageSearch = footageSearchJson;
