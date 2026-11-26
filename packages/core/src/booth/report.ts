/**
 * The booth report «העתקת הדוח» (wave 8 booth track; verify C4). BUILDER W1 writes the bodies; the signatures and the format are the
 * lead's (booth/contract.ts BOOTH_BLOCK_BEGIN/END, BoothBlockSchema) and do not change.
 *
 * FORMAT (plain text, one language for the human part, then the machine block):
 *   PULSEFRAME — <booth.report.title> · <date> · build <commit>
 *   <booth.report.counts: answered of the first sitting / of everything shown, ok, bad, skipped, changed since>
 *   <booth.report.bad>: one line per 'bad' answer: id «title» — problems — "note" (the note as stored, already scrubbed on the server)
 *   <booth.report.checks>: one line per self-check row: title — state words (no data values but versions and adapter vendor)
 *   -----BEGIN PF-BOOTH 1-----
 *   <BoothBlock JSON, ASCII only, cut into lines of at most 64 characters>
 *   sha256:<hex of those lines joined without line breaks>
 *   -----END PF-BOOTH 1-----
 * Never in it: paths, the data or library folder, user, host, project, asset, file or people names, birth dates, IP addresses, the
 * drop's address, tokens. Notes go only into the human part (scrubbed), never into the block.
 */
import { BoothNotBuiltError, type BoothBlock, type BoothBlockParse, type BoothReportInput, type BoothSay } from './contract.ts';

/** The whole report text (human part + machine block). Pure; same in Node and Chromium. */
export function boothReport(input: BoothReportInput, say: BoothSay): string {
  void input; void say;
  throw new BoothNotBuiltError('boothReport');
}
/** The machine data of a report (no notes): what boothReport puts in the block. */
export function boothBlockOf(input: BoothReportInput): BoothBlock {
  void input;
  throw new BoothNotBuiltError('boothBlockOf');
}
/** The framed block text: BEGIN, the JSON in lines of ≤ 64, `sha256:` line, END. */
export function boothBlockText(block: BoothBlock): string {
  void block;
  throw new BoothNotBuiltError('boothBlockText');
}
/** Finds the first block in a pasted text; refuses non-ASCII inside the frame, a checksum mismatch, or a block that fails BoothBlockSchema. */
export function parseBoothBlock(text: string): BoothBlockParse {
  void text;
  throw new BoothNotBuiltError('parseBoothBlock');
}
