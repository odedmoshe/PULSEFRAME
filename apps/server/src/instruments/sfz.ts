/**
 * SFZ subset parser of recorded instruments (wave 7 instruments track; plan §4.2 with C10). Pure over text; `include` is a callback
 * (the loader resolves #include inside the instrument's folder, depth ≤ INSTRUMENTS_LIMITS.maxIncludeDepth). Throws only
 * InstrumentError. LEAD: signatures (final). BUILDER W2: bodies.
 * Headers <control> <global> <master> <group> <region> with inheritance; #define; default_path; octave_offset and note_offset; note
 * names (C4 = 60). Sample paths: '\' becomes '/', then the loader resolves them inside the item (a single case-insensitive match is
 * counted in warnings; two matches, '..' or an absolute path refuse). Opcodes outside the list of plan §4.2 are counted, never applied;
 * regions with trigger=release or legato are skipped and counted. Round-robin is cut (decisions §1 b).
 */
import type { Region } from '../music/sampler.ts';

export interface ParsedSfz {
  /** Regions with their sample path as written (after '\' → '/' and default_path), in file order. */
  regions: (Omit<Region, 'zone'> & { sample: string })[];
  /** Opcodes met and not applied, with counts (shown in L1's report). */
  ignored: Record<string, number>;
  warnings: string[];
}
export function parseSfz(_text: string, _include: (path: string) => string): ParsedSfz { throw new Error('the SFZ parser is not built in this build yet'); }
