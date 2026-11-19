/**
 * Split narration text into pieces a voice model can speak one at a time (SPEC §17: "regenerate one sentence").
 * Sentences end at . ! ? … or a line break; a very short piece joins the next one; a piece longer than `max` is broken at the
 * last comma, semicolon, colon or space before the limit. Nothing is dropped or reworded: the pieces joined by spaces are the text.
 */
export function splitSentences(text: string, max = 300, min = 12): string[] {
  const raw = text.replace(/\r/g, '').split(/(?<=[.!?…]["')\]״”]?)\s+|\n+/u).map((s) => s.trim()).filter(Boolean);
  const merged: string[] = [];
  for (const s of raw) {
    const last = merged.at(-1);
    if (last !== undefined && last.length < min && last.length + 1 + s.length <= max) merged[merged.length - 1] = `${last} ${s}`;
    else merged.push(s);
  }
  // a short tail joins the piece before it
  if (merged.length > 1 && merged.at(-1)!.length < min && merged.at(-2)!.length + 1 + merged.at(-1)!.length <= max) { const tail = merged.pop()!; merged[merged.length - 1] += ` ${tail}`; }
  const out: string[] = [];
  for (let s of merged) {
    while (s.length > max) {
      const head = s.slice(0, max + 1);
      let cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '), head.lastIndexOf('، '));
      if (cut < max / 3) cut = head.lastIndexOf(' ');
      if (cut < 1) cut = max - 1; // one unbroken run of characters: cut it
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  return out;
}
