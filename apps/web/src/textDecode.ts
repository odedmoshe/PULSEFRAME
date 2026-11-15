/**
 * Decode a text file whose encoding is not declared (subtitle and transcript files).
 * Order: a byte-order mark decides; otherwise strict UTF-8; otherwise a legacy single-byte encoding, chosen by which
 * reading looks like text: Windows-1255 (Hebrew) when it yields Hebrew letters, else Windows-1252 (Western European).
 * The result says which encoding was used, so the interface can tell the user when it had to guess.
 */
export interface DecodedText { text: string; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1255' | 'windows-1252'; /** true when no byte-order mark or valid UTF-8 settled it */ guessed: boolean }

export function decodeTextFile(bytes: Uint8Array): DecodedText {
  const dec = (label: string, fatal = false) => new TextDecoder(label, { fatal }).decode(bytes);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: dec('utf-8'), encoding: 'utf-8', guessed: false };
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { text: dec('utf-16le'), encoding: 'utf-16le', guessed: false };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { text: dec('utf-16be'), encoding: 'utf-16be', guessed: false };
  // UTF-16 without a mark: in mostly-Latin text every other byte is zero. Checked before UTF-8, because such bytes are
  // also valid UTF-8 (as text full of NUL characters).
  let evenZero = 0, oddZero = 0;
  const n = Math.min(bytes.length & ~1, 4096);
  for (let i = 0; i < n; i += 2) { if (bytes[i] === 0) evenZero++; if (bytes[i + 1] === 0) oddZero++; }
  if (n >= 8 && oddZero > n / 4 && evenZero < n / 40) return { text: dec('utf-16le'), encoding: 'utf-16le', guessed: true };
  if (n >= 8 && evenZero > n / 4 && oddZero < n / 40) return { text: dec('utf-16be'), encoding: 'utf-16be', guessed: true };
  try { return { text: dec('utf-8', true), encoding: 'utf-8', guessed: false }; } catch { /* not UTF-8 */ }
  // A legacy single-byte encoding. Hebrew letters are bytes 0xE0–0xFA in Windows-1255; the same bytes are accented Latin
  // letters in Windows-1252. Hebrew text has them in runs between spaces and punctuation; accented Latin has them inside
  // words, next to plain Latin letters.
  const isLatin = (b: number | undefined) => b !== undefined && ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a));
  let high = 0, hebrewRange = 0, insideLatinWord = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b < 0x80) continue;
    high++;
    if (b >= 0xe0 && b <= 0xfa) { hebrewRange++; if (isLatin(bytes[i - 1]) || isLatin(bytes[i + 1])) insideLatinWord++; }
  }
  if (high > 0 && hebrewRange / high > 0.6 && insideLatinWord / hebrewRange < 0.3) return { text: dec('windows-1255'), encoding: 'windows-1255', guessed: true };
  return { text: dec('windows-1252'), encoding: 'windows-1252', guessed: true };
}
