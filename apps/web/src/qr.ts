/**
 * A QR code encoder with no dependency (ADR-0023): the drop dialog draws the code's address with it, black on a white plate in
 * both themes. Byte mode (UTF-8), error correction level M, versions 1–10 (the drop URL is at most 52 bytes: version 4).
 *
 * LEAD STUB (wave 5 pre-pass): the signatures are the contract; W3 writes the encoder (plan §6: the block table, alignment
 * centres, all eight masks with the four penalty rules, BCH format and version words, and the test vectors computed there).
 * Until then it refuses: a QR that was not encoded must never be drawn.
 */
export interface QrMatrix {
  version: number;
  /** 17 + 4 × version */
  size: number;
  /** Row-major, 1 = dark, no quiet zone. */
  modules: Uint8Array;
  /** The mask pattern chosen (0–7): the one with the lowest penalty. */
  mask: number;
}
/** Largest text (in UTF-8 bytes) that fits: version 10 at level M. */
export const QR_MAX_BYTES = 213;
/** Byte mode (UTF-8), error correction level M, versions 1–10. Throws RangeError when the text is longer than QR_MAX_BYTES bytes. Deterministic. */
export function encodeQr(text: string): QrMatrix {
  throw new Error(`the QR encoder is not built yet (phone drop, ADR-0023, W3); nothing was encoded (${new TextEncoder().encode(text).length} bytes asked)`);
}
/** One SVG path of the dark modules, including a quiet zone of `quiet` modules (default 4). */
export function qrSvgPath(m: QrMatrix, quiet = 4): { d: string; viewBox: string } {
  throw new Error(`the QR drawing is not built yet (phone drop, ADR-0023, W3); version ${m.version}, quiet zone ${quiet}`);
}
