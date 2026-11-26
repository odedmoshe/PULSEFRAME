/**
 * Scrubbing a booth note (wave 8 booth track; verify C4b). BUILDER W1 writes the bodies; the signatures are the lead's.
 * Called on the SERVER at PUT /api/v1/booth/answers/:id, before the note is stored (the browser never decides what is private).
 *
 * scrubNote, in this order:
 *  1. each of ctx.literals (os.userInfo().username, os.homedir(), os.hostname()) replaced literally, case-insensitive, both slash
 *     directions for the home folder;
 *  2. Windows paths `[A-Za-z]:[\\/]` to the end of the line segment (spaces included: `C:\Users\x\OneDrive - <family>\…`), UNC
 *     `\\host\share…`, POSIX absolute paths, `~/…`, e-mail addresses, URLs, IPv4 and IPv6 addresses, runs of 7 or more digits;
 * each replaced by BOOTH_SCRUB_MARK «[הוסר]». The proof plants: the library root, a home path with a space, a forward-slash path,
 * a OneDrive-style folder, `C:\Users\x\a.mp4 x@y.z`, 127.0.0.1 and a LAN address.
 *
 * namesInNote (decisions L2: warn, never replace): the names of the people sheets that occur in the note as whole words
 * (case-insensitive; Hebrew prefixes ו/ה/ב/ל/מ/ש/כ allowed before a Hebrew name). Nothing about the match is stored.
 */
import { BoothNotBuiltError, type BoothScrubContext } from './contract.ts';

export function scrubNote(text: string, ctx: BoothScrubContext): string {
  void text; void ctx;
  throw new BoothNotBuiltError('scrubNote');
}
export function namesInNote(note: string, names: readonly string[]): string[] {
  void note; void names;
  throw new BoothNotBuiltError('namesInNote');
}
