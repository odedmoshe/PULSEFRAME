/**
 * Keeps the Hebrew wording of the content-pack and built-in-music refusals (packages/i18n/src/packs.ts HE_PACKS) in step with
 * the fixed English sentences: add_builtin_music and attaching a known grid (core packOps.ts PACK_REFUSALS), the planner's
 * built-in-music refusals (templatePlan.ts) and the server's (apps/server/src/music.ts, http.ts). Each is provoked for real
 * through its operation, the planner or the server's own error, and worded; every pattern of the table is used. Also: the
 * shared strings of the track exist in both languages.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, findMusicStyle, FONT_CATALOG, knownGridOf, MUSIC_GENERATOR, MUSIC_SECTION_KINDS, MUSIC_STYLES, MUSIC_UNHEARD_LABEL, musicLayout, musicProvenanceParams,
  OpError, PACK_FIELD_KEYS, PACK_REFUSALS, TEMPLATE_NOTICE_CODES, TemplateError, TITLE_FONT_ROWS, type PackRefusalKey, type ProjectDocument, type TemplateDef,
} from '@pulseframe/core';
import { planTemplate } from '../../core/src/templatePlan.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addMusic, createMusicQueue, musicNotBuilt, musicPreview, resolveMusicRequest, validateMusic } from '../../../apps/server/src/music.ts';
import { MusicCancelled, type RenderedMusic } from '../../../apps/server/src/music/render.ts';
import { knownByConstruction, packSuggestions } from '../../../apps/server/src/http.ts';
import { Governance, type Principal } from '../../../apps/server/src/governance.ts';
import { Store } from '../../../apps/server/src/store.ts';
import { dictionaries, PACK_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const caught = (fn: () => unknown): Error => { try { fn(); } catch (e) { if (e instanceof OpError || e instanceof TemplateError) return e; throw e; } throw new Error('not refused'); };
let n = 0;
const tx = (doc: ProjectDocument, op: string, args: unknown) => applyTransaction(doc, [{ op, args }], { idSeed: `pw${n++}_`, actor: 'test', allowInternal: true });

/** Each refusal of PACK_REFUSALS, provoked through add_builtin_music. */
function provokedOpRefusals(): Record<PackRefusalKey, string> {
  const layout = musicLayout('music.festive', 4);
  const asset = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'5'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: layout.duration, audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'generated' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', procedural: { id: 'music.festive', version: 1, generator: MUSIC_GENERATOR, params: musicProvenanceParams(layout, 1) } } };
  const grid = knownGridOf(layout, 1, '2026-11-17T00:00:00Z');
  const doc = createProject({ id: 'prj_pw', name: 'PW', width: 640, height: 360 });
  const add = (a: unknown, g: unknown = grid) => caught(() => tx(doc, 'add_builtin_music', { asset: a, grid: g })).message;
  return {
    notBuiltinMusic: add({ ...asset, provenance: { ...asset.provenance, procedural: { id: 'sfx.pop', version: 1, generator: 'x' } } }),
    // attachKnownGrid's guard for an asset that is not there: unreachable through the two callers (both add the asset first), so the table's own sentence
    gridAssetMissing: PACK_REFUSALS.gridAssetMissing.message('ast_pw'),
    gridBeatsOrder: add(asset, { ...grid, beats: [grid.beats[1]!, grid.beats[0]!, ...grid.beats.slice(2)] }),
    gridBarNotBeat: add(asset, { ...grid, downbeats: [T.rt(1, 7)] }),
    gridOutsideFile: add(asset, { ...grid, beats: [...grid.beats, layout.duration] }),
    gridSections: add(asset, { ...grid, sections: [{ start: T.rt(1, 1), kind: 'intro', level: 0 }] }),
  };
}
/** The planner's refusals of built-in music. */
function provokedPlannerRefusals(): string[] {
  const doc = createProject({ id: 'prj_pw2', name: 'PW2', width: 1080, height: 1920, frameRate: { num: 30, den: 1 } });
  doc.assets.img = { id: 'img', kind: 'image', name: 'i.png', contentHash: `sha256:${'6'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 1080, height: 1920, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture', importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
  doc.assets.snd = { id: 'snd', kind: 'audio', name: 's.wav', contentHash: `sha256:${'4'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture', importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
  const w = (en: string) => ({ he: `${en} בעברית`, en });
  const def: TemplateDef = { id: 'tpl.pw', version: 1, name: w('PW'), hint: w('PW'), genre: 'celebration', designedFor: 'tall', tempo: { fallbackBpm: 120 }, music: { need: 'optional', startAt: 'zero' }, slots: Array.from({ length: 10 }, (_, i) => ({ key: `s${i}`, role: w('S'), accept: 'any' as const, span: { bars: 16 } })), slotUse: { mode: 'all', min: 1 }, texts: [], elements: [], sfx: [], adjust: [] };
  return [
    caught(() => planTemplate(doc, def, { media: ['img'], musicAssetId: 'snd', builtinMusic: { styleId: 'music.pop' } })).message,
    caught(() => planTemplate(doc, def, { media: ['img'], builtinMusic: { styleId: 'music.unknown' } })).message,
    caught(() => planTemplate(doc, def, { media: ['img'], builtinMusic: { styleId: 'music.cinematic' } })).message,
  ];
}

/** The music routes' own refusals (apps/server/src/music.ts) and the suggestion route's day, each provoked through the server's functions. */
async function provokedServerRefusals(): Promise<string[]> {
  const rejected = async (p: Promise<unknown> | (() => unknown)): Promise<string> => { try { await (typeof p === 'function' ? p() : p); } catch (e) { return (e as Error).message; } throw new Error('not refused'); };
  const L = musicLayout('music.pop', 4);
  const silent = (): RenderedMusic => { const wav = Buffer.alloc(44 + 4 * L.totalFrames); return { wav, layout: L, peak: 0, rms: 0 } as RenderedMusic; };
  // a renderer that waits until it is cancelled (the queue's time limit or the caller going away)
  const waits = (_s: string, _b: number, _seed: number, o: { cancel: { cancelled: boolean } }) => new Promise<RenderedMusic>((_ok, fail) => { const t = setInterval(() => { if (o.cancel.cancelled) { clearInterval(t); fail(new MusicCancelled()); } }, 2); });
  const busyQueue = createMusicQueue({ maxWaitingPreviews: 0, previewTimeoutMs: 50 }, waits);
  const running: Promise<string> = busyQueue.render('music.pop', 4, 1, 'preview').then(() => 'not refused', (e: Error) => e.message);
  const busy = await rejected(busyQueue.render('music.pop', 4, 2, 'preview'));
  const timeout = await running;
  const aborted = new AbortController();
  aborted.abort();
  const cancelled = await rejected(createMusicQueue({}, waits).render('music.pop', 4, 1, 'preview', aborted.signal));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-packs-wording-'));
  const store = new Store(dir);
  try {
    const proposer: Principal = { actor: 'agent:p', kind: 'agent', scopes: ['observe'], mode: 'propose' } as Principal;
    const pid = store.createProject({ name: 'w' }).doc.id;
    return [
      await rejected(() => resolveMusicRequest({ styleId: 'music.pop', bars: 4, fitSeconds: '8', seed: 1 })),
      await rejected(() => resolveMusicRequest({ styleId: 'music.pop', bars: 4, seed: 2_000_000 })),
      await rejected(() => resolveMusicRequest({ styleId: 'music.pop', fitSeconds: '0', seed: 1 })),
      await rejected(musicPreview('music.pop', 33, 1)),
      await rejected(musicPreview('music.pop', 2, 1)),
      await rejected(() => resolveMusicRequest({ styleId: 'music.pop', bars: 600, seed: 1 })),
      busy, timeout, cancelled,
      await rejected(() => validateMusic({ ...silent(), wav: silent().wav.subarray(0, 100) })),
      await rejected(addMusic(store, new Governance(store), proposer, pid, { styleId: 'music.pop', bars: 4, seed: 1 })),
      await rejected(() => packSuggestions(store, new Governance(store), proposer, '2026-02-30')),
    ];
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('Hebrew wording of the content-pack and built-in-music refusals (ADR-0022)', () => {
  it('every refusal, provoked for real, is worded in Hebrew with its numbers kept; every pattern of the table is used; English shows the server\'s sentence', async () => {
    const ops = provokedOpRefusals();
    const routes = await provokedServerRefusals();
    expect(routes.slice(0, 3)).toEqual(['give exactly one of bars and fitSeconds', 'a seed is a whole number from 0 to 1000000', 'fitSeconds is a positive number of seconds written "n" or "n/d"']);
    expect(routes.slice(6, 9)).toEqual(['too many pieces of built-in music are being made at the moment; this one was not started', 'making the built-in music took too long and was stopped', 'the built-in music was not made: the request was cancelled']);
    expect(Object.keys(ops).sort()).toEqual(Object.keys(PACK_REFUSALS).sort());
    for (const [key, message] of Object.entries(ops)) expect(message, key).toBe(PACK_REFUSALS[key as PackRefusalKey].message('ast_pw'));
    const planner = provokedPlannerRefusals();
    const server = [musicNotBuilt().message, knownByConstruction().message, ...routes];
    const used = new Set<number>();
    for (const message of [...Object.values(ops), ...planner, ...server]) {
      const he = translateRefusal('he', message);
      expect(he, message).toMatch(/[א-ת]/);
      expect(translateRefusal('en', message), message).toBeUndefined();
      PACK_REFUSAL_PATTERNS.forEach((re, i) => { if (re.test(message)) used.add(i); });
    }
    // the missing asset is the common sentence, worded by the common table, not by this track's
    expect(PACK_REFUSAL_PATTERNS.some((re) => re.test(ops.gridAssetMissing))).toBe(false);
    expect(PACK_REFUSAL_PATTERNS.filter((_, i) => !used.has(i)).map((re) => re.source)).toEqual([]);
    expect(translateRefusal('he', planner[2]!)).toMatch(/534.*160.*300/);
    expect(translateRefusal('he', routes[1]!)).toContain('1000000');
    expect(translateRefusal('he', routes[3]!)).toContain('32');
    expect(translateRefusal('he', routes[4]!)).toMatch(/4.*2/);
    expect(translateRefusal('he', routes[5]!)).toMatch(/600.*1125.*300.*160/);
  }, 30_000);
  it('the shared strings of the track exist in both languages and differ: notices, pack fields, sections, moods, font categories and tags; the unheard label is the core one', () => {
    const keys = [
      'op.add_builtin_music', 'error.code.known_by_construction', 'error.code.music_not_built', 'error.code.synthesis_busy', 'error.code.music_invalid',
      'error.code.music_timeout', 'error.code.music_cancelled', 'error.code.invalid_option',
      ...TEMPLATE_NOTICE_CODES.map((c) => `template.notice.${c}`), 'pack.fields', ...PACK_FIELD_KEYS.map((k) => `pack.field.${k}`), 'pack.field.date', 'pack.field.atLighting', 'pack.source',
      'music.unheard', 'music.approved', 'music.knownFromRecipe', 'music.source.none', 'music.source.library', 'music.source.builtin', 'music.fitNote',
      ...MUSIC_SECTION_KINDS.map((k) => `music.section.${k}`), ...[...new Set(MUSIC_STYLES.map((s) => s.mood))].map((m) => `music.mood.${m}`),
      ...[...new Set([...FONT_CATALOG, ...TITLE_FONT_ROWS].map((f) => f.category)), 'handwriting'].map((c) => `font.category.${c}`),
      ...['rounded', 'classic', 'condensed', 'playful', 'cursive', 'bold'].map((t) => `font.tag.${t}`), 'font.nikudChecked', 'font.pairsWith',
    ];
    const missing: string[] = [];
    for (const lang of ['he', 'en'] as const) for (const k of keys) if (!(dictionaries[lang] as Record<string, string>)[k]?.trim()) missing.push(`${lang} ${k}`);
    expect(missing).toEqual([]);
    for (const k of keys) expect((dictionaries.he as Record<string, string>)[k], k).not.toBe((dictionaries.en as Record<string, string>)[k]);
    expect(dictionaries.he['music.unheard']).toBe(MUSIC_UNHEARD_LABEL.he);
    expect(dictionaries.en['music.unheard']).toBe(MUSIC_UNHEARD_LABEL.en);
    expect(findMusicStyle('music.festive')).toBeDefined();
  });
});
