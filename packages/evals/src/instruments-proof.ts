/**
 * pnpm proof:instruments — «כלים מוקלטים», recorded instruments for the built-in music (wave 7 instruments track;
 * .artifacts/wave7/instruments-decisions.md §4.10). LEAD: the entry point and the list of checks. The checks are built in three parts,
 * each owned by one builder: instruments-proof.sampler.ts (W1: I1–I6, I3b, I8, I9, I14), instruments-proof.loader.ts (W2: I10–I13,
 * I15, I16 server, I18, I19, L-D1–L-D3), instruments-proof.ui.ts (W3: I16 page, I17). Integration imports the three parts here.
 * States, each counted on its own: pass; partial (a part could not be measured here: never a pass); blocked (could not run here, with
 * the reason); fail; pending (not built yet). Exit 0 only when every check passes, 1 on any failure, 2 otherwise.
 * Fixtures are SYNTHETIC only, written by code (packages/fixtures/src/instruments.ts, labelled SYNTHETIC TEST KIT): sine and marker
 * zones at 44.1 and 48 kHz, 16 and 24 bit, mono and stereo, a looped zone, a .sfz, a temporary library folder with a ledger the proof
 * writes (CC0, CC-BY, CC-BY-NC, CC-BY-SA rows of synthetic sources). Never a real sample set; nothing downloaded. Nobody here can
 * listen: every check is a measurement (levels, lengths, frequencies, hashes, the absence of clipping), none says how anything sounds.
 * Timing figures (I13) are one sample each. Writes docs/evidence/instruments-proof.json once built.
 */
export const INSTRUMENTS_PROOF_BUILT = false;
export const INSTRUMENTS_CHECKS: Readonly<Record<string, string>> = {
  I1: 'renderSampled at r = 1 with amp_veltrack 0 and 0 dB equals the source zone sample for sample from sample 32 to the start of release',
  I2: 'a 440 Hz zone recorded at 44.1 kHz sounds at 440 Hz ± 0.05 cent at its root key and within ± 0.1 cent of equal temperament at ±1 and ±3 semitones',
  I3: 'a 1 kHz sine played one semitone up: everything but the fundamental is below −60 dB',
  I3b: 'a 15 kHz sine at 44.1 kHz played +7 semitones: the largest alias below 20 kHz is below −40 dB (printed as one sample, "8-tap kernel aliasing, measured")',
  I4: 'velocity 0.3 plays the soft layer and 0.9 the loud one (the marker harmonic absent, then present); the amp_veltrack gain matches its formula within 0.01 dB',
  I5: 'after the gate the level falls 60 dB within the release time ± 2 ms; the note\'s last sample and the track\'s first and last frames are 0',
  I6: 'a 0.25 s looped zone held 3 s: the RMS of the last 0.5 s is within 0.5 dB of the first; no step at a loop seam is larger than the largest step inside the source',
  I8: 'the synthetic test kit renders twice with equal bytes, equal to instruments.golden.json',
  I9: 'music.golden.json still matches: a request without instruments gives the bytes, name and params it gave before this track',
  I10: 'with no library folder set a recorded request answers 409 instruments_library_not_set and stores nothing; the same request without instruments gives the golden bytes and MUSIC_GENERATOR',
  I11: 'one kit file removed, one changed by a single byte, the ledger at another commit: 409 instruments_file_missing, instruments_file_changed, instruments_item_version; nothing stored',
  I12: 'a truncated WAV, a FLAC, sample=../../x, ..\\..\\x and a link out of the folder each give their named refusal, and an fs spy shows no file outside the item was opened; a backslash path that resolves inside the item works',
  I13: '128 s of the style with a 55 MB synthetic kit (page-cache warm, parser cold): at least 5× real time, event-loop delay below 100 ms, heapUsed + arrayBuffers growth below 160 MB (one sample)',
  I14: 'M1, M6, M7 and M8 of music.test.ts hold for recorded renders of the synthetic test kit',
  I15: 'an added recorded track carries MUSIC_RECORDED_GENERATOR and provenance.instruments with the bank, in one commit undone by one undo; no synth track carries either',
  I16: 'match=1: scale × RMS of both versions equal within 0.1 dB and the bytes equal the un-matched preview; the heard route answers 403 to agent, observer and phone credentials and keeps the owner\'s mark',
  I17: 'in the editor «צליל» works by keyboard with its state in words, the blind pair plays and reveals, «שמעתי» shows the owner\'s mark, in Hebrew and English, right to left at 1280 and 1440 px',
  I18: 'MCP add_builtin_music with instruments recorded reports the kit and the label; no answer of any route or tool holds an absolute path; every header value is ASCII',
  I19: '5,000 mutated .sfz texts and 5,000 mutated WAV byte strings throw only InstrumentError, read nothing out of bounds, and take less than 60 s',
  'L-D1': 'a synthetic CC-BY source in the kit: the made track\'s credit line is in the description text, verbatim',
  'L-D2': 'a synthetic CC-BY-NC source: the made track is non-commercial, the export warns «לשימוש לא מסחרי בלבד», and the shared archive omits its bytes',
  'L-D3': 'a synthetic CC-BY-SA, CC-BY-ND or unknown-licence source: 409 instruments_licence, nothing made',
};

export type InstrumentsStatus = 'pass' | 'partial' | 'blocked' | 'fail' | 'pending';
export interface InstrumentsRow { id: string; part: 'sampler' | 'loader' | 'ui'; status: InstrumentsStatus; measured?: unknown; reason?: string }
const PART: Readonly<Record<string, InstrumentsRow['part']>> = {
  I1: 'sampler', I2: 'sampler', I3: 'sampler', I3b: 'sampler', I4: 'sampler', I5: 'sampler', I6: 'sampler', I8: 'sampler', I9: 'sampler', I14: 'sampler',
  I10: 'loader', I11: 'loader', I12: 'loader', I13: 'loader', I15: 'loader', I16: 'loader', I18: 'loader', I19: 'loader', 'L-D1': 'loader', 'L-D2': 'loader', 'L-D3': 'loader',
  I17: 'ui',
};

function main(): void {
  const rows: InstrumentsRow[] = Object.keys(INSTRUMENTS_CHECKS).map((id) => ({ id, part: PART[id]!, status: 'pending', reason: 'not built yet (wave 7 instruments pre-pass)' }));
  for (const r of rows) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id.padEnd(5)} [${r.part}] ${INSTRUMENTS_CHECKS[r.id]}`);
  console.log(`\n${rows.length} checks pending; nothing built yet. Exit 2.`);
  process.exitCode = 2;
}
main();
