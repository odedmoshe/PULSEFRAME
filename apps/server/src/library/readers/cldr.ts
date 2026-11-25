/** cldr: no rows. Hebrew and English words (and the short name, type="tts") of each emoji, joined to emoji rows by code point. */
import { MAX_READ_BYTES } from '../contract.ts';
import { baseOf, cpKeyOfText, type CldrWords, type Reader } from './types.ts';

const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, x: string) => x === 'amp' ? '&' : x === 'lt' ? '<' : x === 'gt' ? '>' : x === 'quot' ? '"' : x === 'apos' ? "'" : String.fromCodePoint(x[1] === 'x' || x[1] === 'X' ? parseInt(x.slice(2), 16) : parseInt(x.slice(1), 10)));
export function parseAnnotations(xml: string, lang: 'he' | 'en', into: Map<string, CldrWords>): number {
  let n = 0;
  for (const m of xml.matchAll(/<annotation\s+cp="([^"]{1,40})"(\s+type="tts")?\s*>([^<]{0,2000})<\/annotation>/g)) {
    const key = cpKeyOfText(decode(m[1]!));
    if (!key) continue;
    const w = into.get(key) ?? { he: [], en: [] };
    const text = decode(m[3]!).trim();
    if (m[2]) { if (lang === 'he') w.ttsHe = text; else w.ttsEn = text; }
    for (const word of text.split('|').map((x) => x.trim()).filter(Boolean)) if (!w[lang].includes(word)) w[lang].push(word);
    into.set(key, w);
    n++;
  }
  return n;
}
export const cldr: Reader = {
  id: 'cldr',
  async collect(ctx) {
    const e = ctx.entry;
    if (e.kind !== 'file') return;
    const lang = /^(he|en)\.xml$/.exec(baseOf(e.path))?.[1] as 'he' | 'en' | undefined;
    if (!lang) return;
    const b = await ctx.read('', MAX_READ_BYTES);
    if (!b) return ctx.problem(`${e.item}: the annotations could not be read`);
    parseAnnotations(b.toString('utf8'), lang, ctx.shared.cldr);
  },
};
