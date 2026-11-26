/**
 * Fixture documents of the credits GOLDEN (wave 8 `sources`, verify C3 and "most likely to go wrong" 1). Recorded in the pre-pass
 * BEFORE libraryCredits.ts was touched: when W1 moves collectCredits / creditDue / shareable / archiveLibraryPlan / the export lines /
 * the agent summary onto source records too, the answers for these library-only documents must stay byte-identical.
 * Used by packages/core/src/credits.golden.test.ts (core answers) and apps/server/src/library/credits.golden.test.ts (export answers).
 * Synthetic: nothing here names a real person or file. Test-only module; not exported from the package index.
 */
import * as T from '@pulseframe/time';
import { applyTransaction } from './ops.ts';
import { MUSIC_RECORDED_GENERATOR } from './musicKits.ts';
import { createProject, type Asset, type LibraryRecord, type ProjectDocument } from './schema.ts';
import { FIT_METHOD } from './musicFitContract.ts';

const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
const AT = '2026-11-25T00:00:00Z';
const rec = (over: Partial<LibraryRecord>): LibraryRecord => ({ itemId: 'gold-a/a.wav', sourceId: 'gold-a', kind: 'music', title: 'Item', sourceSha256: 'a'.repeat(64), ledger: { item: 'gold-a' }, licence: { id: 'CC0-1.0' }, flags: {}, ...over });
const audio = (id: string, n: number, provenance: Asset['provenance'], name = `${id}.wav`): Asset => ({ id, kind: 'audio', name, contentHash: hash(n), byteSize: 1000 + n, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance });
const video = (id: string, n: number, provenance: Asset['provenance']): Asset => ({ id, kind: 'video', name: `${id}.mp4`, contentHash: hash(n), byteSize: 2000 + n, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance });
const image = (id: string, n: number, provenance: Asset['provenance']): Asset => ({ id, kind: 'image', name: `${id}.png`, contentHash: hash(n), byteSize: 300 + n, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 64, height: 64, codec: 'png', hasAlpha: true }, provenance } as Asset);
const up = (library?: LibraryRecord): Asset['provenance'] => ({ origin: 'upload', importedAt: AT, importedBy: 'user:local', ...(library ? { library } : {}) });

const CC0_COURTESY = rec({ itemId: 'gold-a/zero.wav', title: 'Zero', credit: { text: 'Zero by Somebody (courtesy)', placement: 'description' } });
const BY_SCREEN = rec({ itemId: 'gold-b/song.wav', sourceId: 'gold-b', title: 'Song', licence: { id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, credit: { text: 'Song Somebody   Else (example.invalid)\nLicensed under CC BY 4.0', placement: 'on_screen' } });
const NC_SOUND = rec({ itemId: 'gold-c/bird.wav', sourceId: 'gold-c', kind: 'sound', title: 'Bird', licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'Bird by Rec', placement: 'either' }, flags: { nonCommercial: true, diskOnly: true } });
const BY_PICTURE = rec({ itemId: 'gold-d/star.svg#star', sourceId: 'gold-d', kind: 'sticker', title: 'Star', licence: { id: 'CC-BY-4.0' }, credit: { text: 'Star set by Ann — CC BY 4.0 (https://example.invalid)', placement: 'description' } });
const PEOPLE_VIDEO = rec({ itemId: 'gold-e/walk.mp4', sourceId: 'gold-e', kind: 'video', title: 'Walk', licence: { id: 'CC0-1.0' }, flags: { people: true } });
const MUSOPEN = rec({ itemId: 'musopen-flac/x.flac', sourceId: 'musopen-flac', title: 'Prelude', licence: { id: 'custom:musopen-flac' }, flags: { diskOnly: true } });
const BY_SONG = rec({ itemId: 'gold-f/tune.wav', sourceId: 'gold-f', title: 'Tune', licence: { id: 'CC-BY-3.0' }, credit: { text: '"Tune" by Player, CC BY 3.0', placement: 'description' } });
const BY_VOICE = rec({ itemId: 'gold-g/read.wav', sourceId: 'gold-g', kind: 'sound', title: 'Reading', licence: { id: 'CC-BY-4.0' }, credit: { text: 'Reading by Speaker, CC BY 4.0', placement: 'either' } });
const PIANO_BY = rec({ itemId: 'gold-h/piano.sfz', sourceId: 'gold-h', title: 'Piano', licence: { id: 'CC-BY-4.0' }, credit: { text: 'Piano samples by Nobody, CC BY 4.0', placement: 'description' } });
const STRINGS_NC = rec({ itemId: 'gold-i/strings.sfz', sourceId: 'gold-i', title: 'Strings', licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'Strings samples by Nobody, CC BY-NC 4.0', placement: 'description' }, flags: { nonCommercial: true, diskOnly: true } });

const fitted = (sourceAssetId: string) => ({ sourceAssetId, method: FIT_METHOD, startAt: T.ZERO, removed: { from: T.rt(8, 1), to: T.rt(28, 1) }, crossfade: T.rt(40, 1000), joinAt: T.rt(8, 1), measured: { similarity: 0.9, levelStepDb: 0.4, phraseBars: 4, tempoSpreadMs: 0, beatConfidence: 0.9 } });

function place(doc: ProjectDocument, uses: [assetId: string, startFrame: number, frames: number][], seed: string, sequenceId?: string): ProjectDocument {
  const f = (n: number) => T.frameTime(n, doc.settings.frameRate);
  return applyTransaction(doc, uses.map(([assetId, s, n]) => ({ op: 'add_clip', args: { assetId, start: f(s), duration: f(n), withLinkedAudio: false, ...(sequenceId ? { sequenceId } : {}) } })), { idSeed: seed, actor: 'test' }).doc;
}

/** Library files only: a CC0 song with a courtesy credit, a CC BY song wanted on screen (used twice), an NC sound, a CC BY picture, stock with people, a disk-only custom licence; plus a short second sequence. */
export function goldLibrary(): ProjectDocument {
  let d = createProject({ id: 'prj_gold_lib', name: 'Gold library', width: 640, height: 360 });
  for (const a of [audio('ast_zero', 1, up(CC0_COURTESY)), audio('ast_song', 2, up(BY_SCREEN)), audio('ast_bird', 3, up(NC_SOUND)), image('ast_star', 4, up(BY_PICTURE)), video('ast_walk', 5, up(PEOPLE_VIDEO)), audio('ast_prel', 6, up(MUSOPEN)), audio('ast_own', 7, up())]) d.assets[a.id] = a;
  d.assets.ast_bird = { ...d.assets.ast_bird!, conform: { originalContentHash: hash(33), originalByteSize: 1, reasons: ['codec'], original: { codec: 'x', width: 0, height: 0, avgFrameRate: '0/0', rFrameRate: '0/0', rotation: 0, frameCount: null, durationSeconds: 60 }, frameMapping: 'identity', method: 'test' } } as Asset;
  d = place(d, [['ast_star', 0, 30], ['ast_bird', 10, 30], ['ast_song', 20, 30], ['ast_zero', 30, 30], ['ast_song', 60, 10], ['ast_walk', 70, 30], ['ast_prel', 80, 30], ['ast_own', 90, 30]], 'gl_');
  d = applyTransaction(d, [{ op: 'add_sequence', args: { name: 'Short' } }], { idSeed: 'gls_', actor: 'test' }).doc;
  const short = Object.keys(d.sequences).find((k) => k !== d.mainSequenceId)!;
  return place(d, [['ast_bird', 0, 20], ['ast_star', 0, 20]], 'glq_', short);
}
/** Built-in music made with recorded instruments (two records: CC BY and NC), and a library file sharing the CC BY credit text. */
export function goldInstruments(): ProjectDocument {
  let d = createProject({ id: 'prj_gold_ins', name: 'Gold instruments', width: 640, height: 360 });
  d.assets.ast_r = audio('ast_r', 11, { origin: 'generated', importedAt: AT, importedBy: 'user:local', procedural: { id: 'music.calm', version: 1, generator: MUSIC_RECORDED_GENERATOR, params: { bars: 8, seed: 1, bpm: 80, meter: 4, synth: 1 } }, instruments: { kitId: 'kit.calm.gold', kitVersion: 1, sampler: 1, bank: '0123456789abcdef', records: [PIANO_BY, STRINGS_NC] } }, 'Calm · recorded instruments.wav');
  d.assets.ast_p = audio('ast_p', 12, up({ ...PIANO_BY, itemId: 'gold-h/piano-loose.wav' }));
  return place(d, [['ast_r', 0, 60], ['ast_p', 30, 30]], 'gi_');
}
/** A CC BY song and its shortened copy (both on the timeline), and a CC0 song only as a shortened copy. */
export function goldMusicfit(): ProjectDocument {
  let d = createProject({ id: 'prj_gold_fit', name: 'Gold musicfit', width: 640, height: 360 });
  d.assets.ast_tune = audio('ast_tune', 21, up(BY_SONG));
  d.assets.ast_tune_fit = { ...audio('ast_tune_fit', 22, { origin: 'derived', importedAt: AT, importedBy: 'user:owner', library: BY_SONG, fitted: fitted('ast_tune') } as Asset['provenance'], 'Tune (shortened).wav'), duration: T.rt(40, 1) };
  d.assets.ast_zero = audio('ast_zero', 23, up(CC0_COURTESY));
  d.assets.ast_zero_fit = { ...audio('ast_zero_fit', 24, { origin: 'derived', importedAt: AT, importedBy: 'user:owner', library: CC0_COURTESY, fitted: fitted('ast_zero') } as Asset['provenance'], 'Zero (shortened).wav'), duration: T.rt(40, 1) };
  return place(d, [['ast_tune', 0, 30], ['ast_tune_fit', 30, 30], ['ast_zero_fit', 60, 30]], 'gf_');
}
/** A provider result made from an NC library sound, and generated speech whose reference recording is a CC BY library file. */
export function goldDerived(): ProjectDocument {
  let d = createProject({ id: 'prj_gold_der', name: 'Gold derived', width: 640, height: 360 });
  d.assets.ast_bird = audio('ast_bird', 31, up(NC_SOUND));
  d.assets.ast_read = audio('ast_read', 32, up(BY_VOICE));
  d.assets.ast_stem = audio('ast_stem', 33, { origin: 'derived', importedAt: AT, importedBy: 'job', derived: { jobId: 'job_g', capabilityId: 'gold.stem', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: ['ast_bird'], outputName: 'o', outputRole: 'r', encoding: 'wav', provider: {} } });
  d.assets.ast_tts = audio('ast_tts', 34, { origin: 'generated', importedAt: AT, importedBy: 'user:local', voice: { jobId: 'job_v', engine: 'gold', model: 'gold', language: 'he', text: 'שלום', seed: 1, voice: 'reference', referenceAssetId: 'ast_read', watermark: null } });
  return place(d, [['ast_stem', 0, 30], ['ast_tts', 30, 30]], 'gd_');
}
/** No library file anywhere. */
export function goldPlain(): ProjectDocument {
  let d = createProject({ id: 'prj_gold_plain', name: 'Gold plain', width: 640, height: 360 });
  d.assets.ast_own = audio('ast_own', 41, up());
  return place(d, [['ast_own', 0, 30]], 'gp_');
}
export const GOLD_DOCS: readonly [string, () => ProjectDocument][] = [
  ['library', goldLibrary], ['instruments', goldInstruments], ['musicfit', goldMusicfit], ['derived', goldDerived], ['plain', goldPlain],
];
