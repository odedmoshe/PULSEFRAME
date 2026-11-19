/**
 * The name of an asset as the owner reads it. Built-in music is stored with an English name ("Festive · 8 bars.wav", made by the
 * server); in the Hebrew interface it shows the style's Hebrew name and «8 תיבות». Stored data is never renamed; a track the owner
 * renamed (name no longer the generated one) shows as typed.
 */
import { findMusicStyle, isBuiltinMusic, type Asset } from '@pulseframe/core';

const bars = (lang: 'he' | 'en', n: number) => (lang === 'he' ? (n === 1 ? 'תיבה אחת' : n === 2 ? '2 תיבות' : `${n} תיבות`) : `${n} ${n === 1 ? 'bar' : 'bars'}`);

export function assetDisplayName(asset: Pick<Asset, 'name' | 'provenance'> | undefined, lang: 'he' | 'en'): string | undefined {
  if (!asset) return undefined;
  if (lang !== 'he' || !isBuiltinMusic(asset)) return asset.name;
  const p = asset.provenance.procedural;
  const style = p ? findMusicStyle(p.id) : undefined;
  const n = Number((p?.params as Record<string, unknown> | undefined)?.bars);
  if (!style || !Number.isInteger(n) || asset.name !== `${style.name.en} · ${n} bars.wav`) return asset.name;
  return `${style.name.he} · ${bars(lang, n)}`;
}
