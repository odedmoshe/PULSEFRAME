/**
 * Pure, table-driven mappings of the services' answers to the source record (wave 8 `sources`, plan §4). SIGNATURES (lead); W2
 * builds the bodies with unit tests over the research's example answers (sources-research.md A2), never a live call.
 *
 * - openverseLicence: Openverse `license` + `license_version` → an exact SPDX id (`by`→CC-BY-<v>, `by-nc-sa`→CC-BY-NC-SA-<v>,
 *   `cc0`→CC0-1.0, `pdm`→PDM-1.0); an unmapped value keeps the name verbatim with id 'unknown'.
 * - commonsLicence: Commons `extmetadata` (LicenseShortName, UsageTerms, Artist, AttributionRequired, Credit) → id, name, credit
 *   text (Artist is HTML in the API: stripped to text, never rendered), credit due when AttributionRequired is "true".
 * - creditText: Openverse's own `attribution` verbatim, cut to 500 characters keeping title, author and licence (tested); Pixabay
 *   the courtesy line «<user> מ־Pixabay» / "<user> on Pixabay" with due false; Commons from extmetadata.
 * - canonicalLink: http(s) only; lower-case host; fragment dropped; every query parameter dropped except a per-host allow-list;
 *   Dropbox `dl=0` → `dl=1` for the REQUEST only (never in pageUrl). itemId = first 32 hex of sha256(canonical) — the hash is the
 *   caller's (no crypto here: the web reads this file).
 */
import { ConnectorNotBuiltError } from './sources.ts';

export interface MappedLicence { id: string; name: string; url: string | null; from: 'item' | 'provider' | 'none' }
export function openverseLicence(license: string, version: string | null, url: string | null): MappedLicence { void license; void version; void url; throw new ConnectorNotBuiltError('openverseLicence'); }
export function commonsLicence(extmetadata: Record<string, { value?: unknown }>): MappedLicence & { credit: { text: string; due: boolean } | null; author: string | null } { void extmetadata; throw new ConnectorNotBuiltError('commonsLicence'); }
export function creditText(provider: 'openverse' | 'pixabay' | 'wikimedia', item: { title: string; author: string | null; attribution?: string | null; licenceName: string; pageUrl: string | null }, lang: 'he' | 'en'): { text: string; due: boolean } | null { void provider; void item; void lang; throw new ConnectorNotBuiltError('creditText'); }
export interface CanonicalLink { canonical: string; host: string; requestUrl: string; pageUrl: string }
export function canonicalLink(url: string): CanonicalLink { void url; throw new ConnectorNotBuiltError('canonicalLink'); }
