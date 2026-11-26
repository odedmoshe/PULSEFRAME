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
import { BOOTH_SCRUB_MARK, type BoothScrubContext } from './contract.ts';

const M = BOOTH_SCRUB_MARK;
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A letter or digit of any script: a whole word is not bounded by one. */
const WORDCH = '\\p{L}\\p{N}_';
/** File-name endings that make a token a file name (media, documents, the product's own imports). Case-insensitive. */
const FILE_ENDINGS = 'mp4|m4v|mov|avi|mkv|webm|mts|m2ts|3gp|wmv|jpe?g|png|heic|heif|gif|bmp|tiff?|webp|raw|dng|cr2|nef|arw|wav|mp3|m4a|aac|flac|ogg|opus|wma|pdf|docx?|xlsx?|pptx?|txt|rtf|zip|rar|7z|cube|srt|vtt|json|exe|cmd|bat|ps1|lnk';

/** Ordered patterns of step 2 (each match becomes the mark). Every one is tested in scrub.test.ts with realistic strings. */
const PATTERNS: readonly RegExp[] = [
  // URLs with a scheme (file:///C:/… too) and bare www. addresses
  /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>]*/giu,
  /\bwww\.[^\s"'<>]+/giu,
  // e-mail addresses (any script in the local part)
  /[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[^\s@"'<>()[\]]+/gu,
  // UNC \\host\share… and //host/share…, to the end of the line segment (folder names hold spaces)
  /(?:\\\\|\/\/)[^\s\\/"'<>|]+[\\/][^\r\n\t"<>|]*/gu,
  // Windows drive paths C:\… and C:/…, to the end of the line segment, spaces included (C:\Users\x\OneDrive - <family>\…)
  /(?<![\p{L}\p{N}])[A-Za-z]:[\\/][^\r\n\t"<>|]*/gu,
  // ~/… and ~\… (a home folder by its short name), and ~user
  /~[\\/][^\s"'<>|]*/gu,
  /(?<![\p{L}\p{N}_])~[A-Za-z0-9._-]+/gu,
  // POSIX absolute paths: a slash after a space, a bracket, a quote or the start, then at least one name
  /(?<=^|[\s("'=[,;])\/[^\s"'<>|]+/gu,
  // any token with a backslash (%USERPROFILE%\…, relative Windows paths, a path cut by a space)
  /[^\s"'<>|]*\\[^\s"'<>|]*/gu,
  // a token with a slash that ends like a file (Movies/a.mov), and any token that is a file name (נועה-גן-2026.mp4)
  new RegExp(`[^\\s"'<>|]*\\/[^\\s"'<>|]*\\.(?:${FILE_ENDINGS})(?![${WORDCH}])`, 'giu'),
  new RegExp(`[^\\s"'<>|/\\\\]+\\.(?:${FILE_ENDINGS})(?![${WORDCH}])`, 'giu'),
  // IPv6 (full, or with ::, optional zone) and IPv4
  /(?<![\p{L}\p{N}:])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){7}|(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?)(?:%[0-9a-z]+)?(?![\p{L}\p{N}:])/giu,
  /(?<![\p{N}.])\d{1,3}(?:\.\d{1,3}){3}(?![\p{N}]|\.\d)/gu,
];
/** Runs of 7 or more digits, also with spaces, dashes or dots between them (a phone or an id number), but not a YYYY-MM-DD date. */
const DIGITS = /\+?\d(?:[ .-]?\d){6,}/gu;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Literal context values (user name, home folder, host name) as the patterns that find them. */
function literalPatterns(literals: readonly string[]): RegExp[] {
  const out: RegExp[] = [];
  const seen = new Set<string>();
  const forms = (l: string) => [l, l.replaceAll('\\', '/'), l.replaceAll('/', '\\')];
  // longest first, so the home folder goes before the user name inside it
  for (const raw of [...literals].map((l) => l.trim()).filter((l) => l.length >= 2).sort((a, b) => b.length - a.length)) {
    for (const f of forms(raw)) {
      const key = f.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // a folder is replaced wherever it occurs; a name only as a whole word (a user name "ann" must not cut "annual")
      out.push(/[\\/]/.test(f) ? new RegExp(esc(f), 'giu') : new RegExp(`(?<![${WORDCH}])${esc(f)}(?![${WORDCH}])`, 'giu'));
    }
  }
  return out;
}

/** The note with every private-looking part replaced by «[הוסר]» (see the header for the order). Pure. */
export function scrubNote(text: string, ctx: BoothScrubContext): string {
  let s = text.normalize('NFC');
  for (const re of literalPatterns(ctx.literals)) s = s.replace(re, M);
  for (const re of PATTERNS) s = s.replace(re, M);
  s = s.replace(DIGITS, (m) => ((m.match(/\d/g) ?? []).length >= 7 && !DATE.test(m) ? M : m));
  return s;
}

/** Hebrew prefix letters that may stand before a Hebrew name: «ולנועה», «שנועה». */
const HE_PREFIX = '[ובהלמשכ]{0,2}';
/** The names (as given, each once) that occur in the note as whole words, case-insensitive. Nothing is kept about the match. */
export function namesInNote(note: string, names: readonly string[]): string[] {
  const text = note.normalize('NFC');
  const found: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.normalize('NFC').trim();
    if (name.length < 2 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const hebrew = /^[\u0590-\u05FF]/.test(name);
    const re = new RegExp(`(?<![${WORDCH}])${hebrew ? HE_PREFIX : ''}${esc(name)}(?![${WORDCH}])`, 'iu');
    if (re.test(text)) found.push(raw);
  }
  return found;
}
