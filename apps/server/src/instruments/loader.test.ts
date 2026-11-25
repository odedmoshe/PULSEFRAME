/**
 * The loader of recorded instruments (wave 7 instruments track; builder W2 owns this file): WAV and SFZ parsers, the kit check and the
 * bank loader. The lead's rows hold the stubs' honest state; the it.todo rows name what W2 must make pass on the labelled synthetic test
 * kit written by packages/fixtures/src/instruments.ts (never a real sample set).
 */
import { describe, expect, it } from 'vitest';
import { InstrumentError } from './contract.ts';
import { readWavInfo } from './wav.ts';

describe('instruments loader (lead rows)', () => {
  it('until W2 builds it, the WAV reader throws only InstrumentError', () => {
    expect(() => readWavInfo(new Uint8Array(44))).toThrow(InstrumentError);
  });
  it.todo('W2: readWavInfo/decodePcm read PCM 16/24/32, float 32 and EXTENSIBLE, mono and stereo, smpl loops; anything else is InstrumentError(format|unreadable)');
  it.todo('W2: parseSfz applies the opcodes of plan §4.2, counts the rest, skips release/legato regions, normalises \\ to /, octave_offset and note_offset');
  it.todo('W2: checkKit reads the ledger through LibraryService.ledgerEntries, opens files only through openInside, and gives each state of KIT_STATES with its refusal');
  it.todo('W2: the file-hash cache is keyed by absolute path, size and mtimeMs; a changed mtime rehashes; a file changed between check and load refuses');
  it.todo('W2: loadBank decodes only the frames planZones asks for and refuses above INSTRUMENTS_LIMITS.maxDecodedBytes');
  it.todo('W2: a kit whose source is CC-BY-SA, CC-BY-ND or unknown is refused (instruments_licence); a CC-BY-NC source is carried (records flags)');
});
