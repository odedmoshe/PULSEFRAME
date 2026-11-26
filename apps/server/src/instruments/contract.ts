/**
 * The server side of recorded instruments «כלים מוקלטים» (wave 7 instruments track; .artifacts/wave7/instruments-decisions.md §4).
 * LEAD-OWNED: the route table, every refusal with its status, code, fixed English sentence and hint (the Hebrew is
 * packages/i18n/src/instruments.ts HE_INSTRUMENTS, kept in step by packages/evals/src/instruments-wording.test.ts), the build flag and
 * the heard file. Builder W2 builds wav.ts, sfz.ts, bank.ts, routes.ts and the recorded path of music.ts; W1 the sampler.
 *
 * RULES THE BUILDERS KEEP
 * - All-or-nothing: a recorded request makes every kit part recorded or is refused BEFORE anything is stored; never silently synthesised.
 * - Order (decisions §4.3): outside the queue turn resolve the kit, read the ledger through LibraryService.ledgerEntries (never a second
 *   ledger reader), take every source's duties from core licenceDuties, open every kit file through library/paths.ts openInside
 *   (realpath containment; nothing outside the item is opened), hash it (cache by absolute path + size + mtimeMs) and compare with the
 *   kit table; inside the turn re-stat each file (size, mtime) and decode only the frames planZones asks for.
 * - No answer and no header holds an absolute path; headers carry ASCII codes only (x-pf-instruments, x-pf-level-scale).
 * - The heard mark is the owner's own session only (isOwnerSession): agents, observers and the phone drop get 403 owner_required.
 */
import { ApiError } from '../store.ts';

/** True: the recorded path (loader + music.ts, builder W2) and the sampler (W1) are built and wired (flipped at integration). */
export const INSTRUMENTS_BUILT: boolean = true;
/** In the data directory (never in a project, archive or backup): the owner's «שמעתי» marks, 0600, written atomically. */
export const KITS_HEARD_FILE = 'music-kits-heard.json';
/** Every route of this track, as Hono registers it (peopleSurfaces.ts classifies each; openapi.ts documents each). */
export const INSTRUMENTS_ROUTES = ['GET /api/v1/music/kits', 'POST /api/v1/music/kits/:kitId/heard'] as const;

interface ServerRefusal<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint: string }
const r = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint: string): ServerRefusal<A> => ({ status, code, message, hint });
/** Every refusal of a recorded request and of the kit routes. The messages are fixed: HE_INSTRUMENTS recognises them by their shape. */
export const INSTRUMENTS_SERVER_REFUSALS = {
  notBuilt: r(501, 'instruments_not_built', () => 'recorded instruments are not built in this build yet', 'Choose the synthesised sounds (instruments: synth); the music is made as before.'),
  libraryNotSet: r(409, 'instruments_library_not_set', () => 'no library folder is set, so no recorded instrument can be used', 'The owner sets the library folder in Settings (or PF_LIBRARY_DIR); until then choose the synthesised sounds.'),
  noKit: r(404, 'instruments_no_kit', (styleId: string) => `the style ${styleId} has no recorded kit in this build`, 'Choose the synthesised sounds, or a style that has a kit (GET /api/v1/music/kits).'),
  kitNotReady: r(409, 'instruments_kit_not_ready', (kit: string) => `the recorded kit ${kit} has no checked list of sample files in this build yet`, 'Choose the synthesised sounds; the kit is offered once its files were checked on the owner\'s computer.'),
  itemMissing: r(409, 'instruments_item_missing', (item: string) => `the library has no download of ${item}, which this kit needs`, 'Fetch it with the download tool (the instruments of the audio list), then try again.'),
  itemVersion: r(409, 'instruments_item_version', (item: string) => `the library holds another version of ${item} than the one this kit was checked against`, 'Fetch the pinned version with the download tool, then try again.'),
  licence: r(409, 'instruments_licence', (item: string, why: string) => `the library's licence for ${item} does not allow it here: ${why}`, 'Choose the synthesised sounds.'),
  fileMissing: r(409, 'instruments_file_missing', (path: string) => `a sample file of this kit is missing: ${path}`, 'Verify the library with the download tool (--verify) and fetch again.'),
  fileChanged: r(409, 'instruments_file_changed', (path: string) => `a sample file differs from the one this kit was checked against: ${path}`, 'Verify the library with the download tool (--verify) and fetch again.'),
  pathEscape: r(409, 'instruments_path_escape', () => 'an instrument file points outside its own folder; nothing was read', 'Check the library folder with the download tool.'),
  unreadable: r(409, 'instruments_unreadable', (path: string, why: string) => `a sample file could not be read: ${path} (${why})`, 'Verify the library with the download tool (--verify) and fetch again.'),
  format: r(409, 'instruments_format', (path: string, format: string) => `a sample file is in a format this build does not read: ${path} (${format})`, 'Choose the synthesised sounds.'),
  range: r(409, 'instruments_range', (instrument: string) => `the instrument ${instrument} has no recording close enough to some notes of this piece`, 'Choose another length or version (seed), or the synthesised sounds.'),
  tooLarge: r(409, 'instruments_too_large', (mb: number) => `this piece needs more than ${mb} MB of recorded sound in memory at once`, 'Ask for fewer bars, or the synthesised sounds.'),
  notFittable: r(409, 'instruments_not_fittable', () => 'built-in music made with recorded instruments cannot be fitted to a length in this build yet', 'Add the recorded music again with the length you need, or use the synthesised sounds.'),
  ownerOnly: r(403, 'owner_required', () => 'only the owner, from their own session, can mark a recorded kit as heard', 'Listen in the editor and mark it there.'),
} as const;
export type InstrumentsRefusalKey = keyof typeof INSTRUMENTS_SERVER_REFUSALS;
export function instrumentsError<K extends InstrumentsRefusalKey>(key: K, details: Record<string, unknown>, ...args: Parameters<(typeof INSTRUMENTS_SERVER_REFUSALS)[K]['message']>): ApiError {
  const x = INSTRUMENTS_SERVER_REFUSALS[key] as ServerRefusal<unknown[]>;
  return new ApiError(x.status, x.code, x.message(...args), details, x.hint);
}

/** A typed failure of the parsers (wav.ts, sfz.ts): the only error they may throw (fuzz check I19). */
export class InstrumentError extends Error {
  constructor(public readonly code: 'unreadable' | 'format' | 'path_escape' | 'too_large', public readonly why: string) { super(`${code}: ${why}`); this.name = 'InstrumentError'; }
}
