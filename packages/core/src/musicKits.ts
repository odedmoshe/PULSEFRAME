/**
 * Recorded instruments for the built-in music «כלים מוקלטים» (wave 7 instruments track; .artifacts/wave7/instruments-decisions.md).
 * LEAD CONTRACT: the kit table, its schema, the labels, the bank input, the licence rule of a kit and the record a made file carries.
 * Pure (no crypto, no fs): the server hashes kitBankInput, reads the ledger and checks the files (apps/server/src/instruments).
 *
 * RULES
 * - Opt-in: a request without `instruments` (or 'synth') is the synthesiser of ADR-0022, byte for byte. A recorded request is made with
 *   EVERY part of the kit recorded or refused before anything is made (all-or-nothing): it is never silently synthesised.
 * - A kit is offered only when every file it uses is listed here with its sha256 (filled from the laptop's check L1 of a tree that the
 *   download tool's --verify proved equal to the ledger) and every library source it uses passes the core licence table
 *   (libraryDuties.ts licenceDuties). Share-alike, no-derivatives or unknown → the whole kit is refused (mixing samples into a piece is a
 *   derivative). Non-commercial is allowed and carried. A kit that mixes sources carries the UNION of their duties: one LibraryRecord per
 *   source in provenance.instruments.records, which libraryOrigins (libraryCredits.ts) visits.
 * - The bank hash depends on the kit table only (kitBankInput): never on the frames a render read or on a cache.
 * - Nobody here can listen: every kit is review 'unheard' until the OWNER marks it from their own session (server, not project state);
 *   no string says a recorded kit sounds better, real, warm or natural (INSTRUMENTS_FORBIDDEN_WORDS).
 */
import { z } from 'zod';
import type { LedgerEntry } from './libraryContract.ts';
import type { LicenceDuties } from './libraryDuties.ts';
import type { LibraryRecord } from './schema.ts';

/** Version of the sampler (recorded in provenance.instruments.sampler); a change that gives other bytes for the same kit raises it. */
export const MUSIC_SAMPLER_VERSION = 1;
/** The generator of a recorded track. MUSIC_GENERATOR ("no recordings, no samples") never sits on one, and this never sits on a synth track. */
export const MUSIC_RECORDED_GENERATOR = 'pulseframe music synthesiser 1 with recorded instrument samples from the owner\'s library (see provenance.instruments)' as const;
export const MusicInstrumentsSchema = z.enum(['synth', 'recorded']);
export type MusicInstruments = z.infer<typeof MusicInstrumentsSchema>;

/** The parts a kit may replace: the pitched roles of a style (apps/server/src/music/styles.ts PartSpec.role). Drums stay synthesised in v1. */
export const KIT_PART_ROLES = ['pad', 'stab', 'arp', 'bass', 'lead', 'double'] as const;
export type KitPartRole = (typeof KIT_PART_ROLES)[number];
/** The tag every note of the arranger carries (music/arrange.ts Note.part): a pitched role, `drum.<voice kind>` (drums, crash, riser, roll) or `click`. */
export type PartKey = KitPartRole | `drum.${string}` | 'click';

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
/** A path inside a ledger item: forward slashes, no empty, '.' or '..' segment, no drive or leading slash. */
export const ItemPathSchema = z.string().min(1).max(400).refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..'), { message: 'a path inside the item, forward slashes, no . or .. segment' });
export const KitFileSchema = z.object({ path: ItemPathSchema, bytes: z.number().int().positive(), sha256: Hex64 }).strict();
export type KitFile = z.infer<typeof KitFileSchema>;
export const KitInstrumentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  title: z.object({ he: z.string().min(1).max(80), en: z.string().min(1).max(80) }).strict(),
  /** The ledger item id (tools/library manifests: `<source>/<item>`), e.g. 'vsco-2-ce/repo'. */
  ledgerItem: z.string().min(1).max(200),
  /** The commit (git item) or sha256 (file item) the files below were read from; the ledger's current entry must name the same. */
  ledgerPin: z.string().min(1).max(64),
  /** The .sfz file inside the item; null until the laptop's check L1 named it (the kit is then not calibrated and not offered). */
  entry: ItemPathSchema.nullable(),
  /** Every file the instrument uses (the .sfz, its #include files and every sample), with the sha256 L1 read; empty until L1. */
  files: z.array(KitFileSchema).max(4000),
  /** Fixed CC values for locc/hicc and xfin/xfout conditions (a CC crossfade is a constant gain at this value; v1 cut). */
  cc: z.record(z.string().regex(/^\d{1,3}$/), z.number().int().min(0).max(127)).optional(),
}).strict();
export type KitInstrument = z.infer<typeof KitInstrumentSchema>;
export const KitPartSchema = z.object({
  instrument: z.string().regex(/^[a-z0-9-]{1,32}$/),
  /** dB added to the part; −18 until the laptop's calibration L6 (real samples peak near 0 dBFS, the synth parts are at 0.05–0.28). */
  gainDb: z.number().min(-60).max(12),
  /** note.vel 0..1 → MIDI velocity lo + (hi − lo)·vel, rounded. */
  vel: z.tuple([z.number().int().min(1).max(127), z.number().int().min(1).max(127)]),
  /** Caps, in seconds, on the instrument's envelope (so the ending stays inside its bar: test M8). */
  attackMax: z.number().min(0).max(4).optional(), releaseMax: z.number().min(0).max(8).optional(),
}).strict();
export type KitPart = z.infer<typeof KitPartSchema>;
export const MusicKitSchema = z.object({
  id: z.string().regex(/^kit\.[a-z0-9-]{1,24}\.[a-z0-9-]{1,24}$/),
  version: z.number().int().min(1).max(1000),
  styleId: z.string().regex(/^music\.[a-z0-9-]{1,24}$/),
  /** 'unheard' in code; the owner's own mark is kept by the server (music-kits-heard.json), never by an agent. */
  review: z.literal('unheard'),
  instruments: z.array(KitInstrumentSchema).min(1).max(8),
  parts: z.partialRecord(z.enum(KIT_PART_ROLES), KitPartSchema),
}).strict();
export type MusicKit = z.infer<typeof MusicKitSchema>;

/** VSCO-2 CE at the pinned commit of tools/library/manifests/audio-01.json (CC0 1.0; read at the source 2026-11-25). */
const VSCO = { ledgerItem: 'vsco-2-ce/repo', ledgerPin: '28092772094b2d9f1148d84cea97f4545b8c687d' } as const;
/**
 * The kits of this build. ONE in v1 (decisions §1): calm, from VSCO-2 CE only. The .sfz names and file lists are filled by the lead
 * after laptop check L1; until then the kit is not calibrated and every recorded request for it is refused with that reason.
 */
export const MUSIC_KITS: readonly MusicKit[] = [
  {
    id: 'kit.calm.vsco', version: 1, styleId: 'music.calm', review: 'unheard',
    instruments: [
      { id: 'strings', title: { he: 'מיתרים (VSCO-2 CE)', en: 'Strings (VSCO-2 CE)' }, ...VSCO, entry: null, files: [] },
      { id: 'piano', title: { he: 'פסנתר (VSCO-2 CE)', en: 'Piano (VSCO-2 CE)' }, ...VSCO, entry: null, files: [] },
    ],
    parts: {
      pad: { instrument: 'strings', gainDb: -18, vel: [40, 100] },
      double: { instrument: 'strings', gainDb: -18, vel: [40, 100] },
      arp: { instrument: 'piano', gainDb: -18, vel: [40, 110] },
      lead: { instrument: 'piano', gainDb: -18, vel: [50, 120] },
    },
  },
];
/** `kit.calm.vsco@1`: the kit and its version, as the queue key and the heard file name them. */
export const kitKey = (kit: Pick<MusicKit, 'id' | 'version'>): string => `${kit.id}@${kit.version}`;
/** The kit of a style, or undefined (a style without a kit refuses recorded requests with instruments_no_kit). */
export const kitForStyle = (styleId: string, kits: readonly MusicKit[] = MUSIC_KITS): MusicKit | undefined => kits.find((k) => k.styleId === styleId);
/** Every instrument a part uses is named (entry) and has its file list: false means not calibrated, never offered. */
export const kitCalibrated = (kit: MusicKit): boolean => {
  const used = new Set(Object.values(kit.parts).map((p) => p!.instrument));
  return used.size > 0 && kit.instruments.every((i) => !used.has(i.id) || (i.entry !== null && i.files.length > 0 && i.files.some((f) => f.path === i.entry)));
};
/**
 * The canonical text whose sha256 (first 16 hex characters) is a recorded track's bank: the kit, its version, the sampler version, the
 * part settings, and every file of every used instrument sorted by (ledger item, path) with its bytes and sha256. Nothing read at render
 * time enters it.
 */
export function kitBankInput(kit: MusicKit, sampler: number = MUSIC_SAMPLER_VERSION): string {
  const used = new Set(Object.values(kit.parts).map((p) => p!.instrument));
  const files = kit.instruments.filter((i) => used.has(i.id))
    .flatMap((i) => i.files.map((f) => [i.ledgerItem, i.ledgerPin, f.path, f.bytes, f.sha256] as const))
    .sort((a, b) => (a[0] + '\n' + a[2] < b[0] + '\n' + b[2] ? -1 : a[0] + '\n' + a[2] > b[0] + '\n' + b[2] ? 1 : 0));
  const parts = KIT_PART_ROLES.filter((r) => kit.parts[r]).map((r) => [r, kit.parts[r]!.instrument, kit.parts[r]!.gainDb, kit.parts[r]!.vel[0], kit.parts[r]!.vel[1], kit.parts[r]!.attackMax ?? null, kit.parts[r]!.releaseMax ?? null]);
  const instruments = kit.instruments.filter((i) => used.has(i.id)).map((i) => [i.id, i.ledgerItem, i.ledgerPin, i.entry, Object.entries(i.cc ?? {}).sort()]);
  return JSON.stringify(['pulseframe-kit-bank', 1, kit.id, kit.version, sampler, parts, instruments, files]);
}

/** Shown with every recorded kit and every recorded track until the owner marks the kit as heard. */
export const MUSIC_RECORDED_UNHEARD_LABEL = { he: 'כלים מוקלטים — עוד לא הושמעו לאף אחד', en: 'Recorded instruments — nobody has listened yet' } as const;
/** After the owner's own mark ({date} is the day they marked it). Says that they listened, nothing about how it sounds. */
export const MUSIC_RECORDED_HEARD_LABEL = { he: 'כלים מוקלטים — בעל הפרויקט שמע ({date})', en: 'Recorded instruments — the owner listened ({date})' } as const;
/** Added to the library name of a recorded track ("Calm and warm · 16 bars · recorded instruments.wav"). */
export const RECORDED_NAME_SUFFIX = ' · recorded instruments' as const;
/** Words no instruments string may use (he, en): nobody here has listened, and a recording is not «better» by being recorded. */
export const INSTRUMENTS_FORBIDDEN_WORDS = ['better', 'real', 'realistic', 'warm', 'natural', 'authentic', 'rich', 'lifelike', 'professional', 'studio quality'] as const;
export const INSTRUMENTS_FORBIDDEN_WORDS_HE = ['טוב יותר', 'אמיתי', 'חם', 'חמים', 'טבעי', 'עשיר', 'מציאותי', 'מקצועי', 'איכות אולפן'] as const;

/** Limits of a recorded render (decisions §4.6). The laptop has little RAM headroom next to a browser: one render at a time, bounded. */
export const INSTRUMENTS_LIMITS = {
  /** Decoded sample data of one render (Int32, 4 bytes per sample per channel); more → instruments_too_large. */
  maxDecodedBytes: 96 * 1024 * 1024,
  /** The highest playback ratio of a region (above it the note is out of the instrument's range → instruments_range). */
  maxRatio: 2,
  /** Every sampled note starts with a linear attack of at least this many frames (the track's first sample stays 0). */
  minAttackFrames: 32,
  /** The last frames of every sampled note fade linearly to 0. */
  endFadeFrames: 64,
  /** Remembered file hashes (absolute path, size, mtimeMs → sha256). */
  hashCacheEntries: 4096,
  /** A WAV or .sfz larger than this is refused unread (instruments_unreadable). */
  maxFileBytes: 512 * 1024 * 1024,
  /** #include depth inside a .sfz. */
  maxIncludeDepth: 4,
  /** Records the owner's heard file keeps (the oldest dropped). */
  heardRows: 200,
} as const;

/** What a kit needs from one library source, and what the core licence table answered for it. */
export type KitLicenceProblem = 'licence_unknown' | 'licence_share_alike' | 'licence_no_derivatives' | 'credit_missing';
/**
 * The library record a recorded track carries for one library source (decisions §3, the union of duties), or the reason the kit is
 * refused. `duties` is core licenceDuties(entry.source, entry.licence, entry.flags) — the server calls it, never a table of its own.
 * `entrySha256` is the sha256 of the instrument's .sfz file (one record per instrument; equal credits are listed once by collectCredits).
 * Pure; mirrors the record use_library_item writes (apps/server/src/library/routes.ts recordOf).
 */
export function kitLibraryRecord(entry: Pick<LedgerEntry, 'item' | 'source' | 'sourceTitle' | 'credit' | 'flags' | 'treeSha256' | 'commit' | 'version' | 'licence'>, duties: LicenceDuties, instrument: Pick<KitInstrument, 'entry' | 'title'>, entrySha256: string): { record: LibraryRecord } | { problem: KitLicenceProblem } {
  if (duties.use !== 'ok') return { problem: duties.use };
  const credit = entry.credit?.trim() ?? '';
  if (duties.credit && (!credit || credit.length > 500)) return { problem: 'credit_missing' };
  const flag = (k: string) => Object.hasOwn(entry.flags, k) && entry.flags[k] === true;
  const record: LibraryRecord = {
    itemId: `${entry.source}/${instrument.entry ?? ''}`.slice(0, 300), sourceId: entry.source.slice(0, 64), kind: 'music',
    title: `${instrument.title.en} — ${entry.sourceTitle}`.slice(0, 200),
    sourceSha256: entrySha256,
    ledger: { item: entry.item.slice(0, 200), ...(entry.treeSha256 ? { treeSha256: entry.treeSha256 } : {}), ...(entry.version && entry.version.length <= 80 ? { version: entry.version } : {}), ...(entry.commit && entry.commit.length <= 64 ? { commit: entry.commit } : {}) },
    licence: { id: duties.licenceId.slice(0, 80), ...(entry.licence.url ? { url: entry.licence.url.slice(0, 500) } : {}) },
    ...(credit && credit.length <= 500 ? { credit: { text: credit, placement: duties.placement } } : {}),
    flags: { ...(duties.nonCommercial ? { nonCommercial: true as const } : {}), ...(!duties.shareable ? { diskOnly: true as const } : {}), ...(flag('people') ? { people: true as const } : {}), ...(flag('aiGenerated') ? { aiGenerated: true as const } : {}), ...(flag('trademark') ? { trademark: true as const } : {}) },
  };
  return { record };
}

// ---------- wire shapes (GET /api/v1/music/kits, POST /api/v1/projects/:id/music) ----------
/** Why a kit is or is not offered now. 'ready' = every file checked against the table and every source passes the licence table. */
export const KIT_STATES = ['not_built', 'library_not_set', 'not_calibrated', 'item_missing', 'item_version', 'licence', 'file_missing', 'file_changed', 'unreadable', 'checking', 'ready'] as const;
export type KitState = (typeof KIT_STATES)[number];
export interface MusicKitStatus {
  kitId: string; version: number; styleId: string; state: KitState;
  /** The refusal code a recorded request would get now (instruments_*), or null when ready. */
  reason: string | null;
  /** Which part plays which instrument (the rest of the style stays synthesised). */
  parts: { part: KitPartRole; instrument: string; title: { he: string; en: string } }[];
  /** The library sources and what their licences ask of a video made with them (empty until checked). */
  sources: { sourceId: string; title: string; licenceId: string; credit: boolean; nonCommercial: boolean; shareable: boolean }[];
  label: { he: string; en: string };
  /** The owner's own mark (server file), or null: unheard. */
  heard: { at: string } | null;
}
/** Added to the answer of POST /api/v1/projects/:id/music for a recorded request. */
export interface RecordedMusicResult { kitId: string; version: number; bank: string; parts: KitPartRole[]; label: { he: string; en: string } }
