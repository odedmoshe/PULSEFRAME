// REFERENCE decoder of outline format 1 (test-only; written from the format text in packages/engine/src/map/outlines.ts and the
// script's encodeGroup, independently of the engine's decodeGroup, which must agree with it: packages/engine/src/map/paintMap.test.ts).
export function referenceDecode(b64: string): { xy: number[]; cut: boolean[] }[] {
  const b = Buffer.from(b64, 'base64');
  let i = 0;
  const v = () => { let x = 0, m = 1, c; do { if (i >= b.length) throw new Error('truncated varint'); c = b[i++]!; x += (c & 127) * m; m *= 128; } while (c & 128); return x; };
  const z = () => { const u = v(); return u % 2 ? -(u + 1) / 2 : u / 2; };
  const rings: { xy: number[]; cut: boolean[] }[] = [];
  const count = v();
  for (let r = 0; r < count; r++) {
    const n = v(); const xy = [z(), z()];
    for (let k = 1; k < n; k++) { const px = xy[xy.length - 2]!, py = xy[xy.length - 1]!; xy.push(px + z(), py + z()); }
    const cut = new Array<boolean>(n).fill(false);
    const runs = v(); let end = 0;
    for (let k = 0; k < runs; k++) { const s = end + v(), len = v(); for (let e = s; e < s + len; e++) { if (e >= n) throw new Error(`cut edge ${e} outside a ring of ${n}`); cut[e] = true; } end = s + len; }
    rings.push({ xy, cut });
  }
  if (i !== b.length) throw new Error('bytes after the last ring');
  return rings;
}
