/**
 * The library entry «סנכרון וחיתוך» (ADR-0020, W3): with 2–9 files chosen in the media library it chains create_multicam, the
 * sync job (polled), a review stop (MULTICAM_TESTIDS.reviewStop) whenever ANY file is not 'confident' (wave4-decisions.md),
 * then place_multicam, all client-side through the usual commit path. A family event filmed by several phones shows each
 * file's capture-time prior in the review (core multicamPrior.ts). The library has no multi-select yet: W3 adds it to
 * MediaLibrary.tsx MediaGrid (lead mount below the grid in Library.tsx).
 * LEAD PLACEHOLDER: renders nothing (there is no selection to act on yet).
 */
export interface MulticamLibraryEntryProps { lang: 'he' | 'en' }
export function MulticamLibraryEntry(_props: MulticamLibraryEntryProps) { return null; }
