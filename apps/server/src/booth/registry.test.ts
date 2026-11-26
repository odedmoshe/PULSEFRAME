/**
 * The booth registry (wave 8 booth; plan check 1 and 2 as cut by verify): coverage of every catalogue, the first sitting, the 11
 * auto-used sounds (derived, never a hand list), recipes and what changes them.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_EFFECTS, BOOTH_FIRST_MUSIC, BOOTH_FIRST_SITTING_CARDS, BOOTH_FIRST_TRANSITIONS, BOOTH_GROUPS, BOOTH_SOURCES as SOURCE_IDS, BoothItemSchema, EFFECTS,
  effectChangesLight, MUSIC_STYLES, TRANSITIONS,
} from '@pulseframe/core';
import { BOOTH_EN, BOOTH_HE } from '../../../../packages/i18n/src/booth.ts';
import { SFX } from '../sfx.ts';
import { autoUsedSfx, BOOTH_CONTENT_DEPENDENT_EFFECTS, BOOTH_LATER, BOOTH_SOURCES, BOOTH_WHAT, boothItems, boothRegistry, ffmpegFirstLine, sfxSource, type BoothSourceDef } from './registry.ts';

const env = { ffmpegLine: 'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers', picturesRgba: `sha256:${'c'.repeat(64)}` };
const items = boothItems(env);
const byId = new Map(items.map((i) => [i.id, i]));
const golden = JSON.parse(fs.readFileSync(new URL('../music.golden.json', import.meta.url), 'utf8')) as { sha256: Record<string, string> };

describe('coverage (plan check 1)', () => {
  it('every catalogue member is exactly one item or one BOOTH_LATER row, never both; ids unique; every item parses', () => {
    const members: [string, string | null][] = [
      ...MUSIC_STYLES.filter((s) => s.review !== 'rejected').map((s) => [`music:${s.id}`, null] as [string, null]),
      ...SFX.map((s) => [`sfx:${s.id}`, null] as [string, null]),
      ...TRANSITIONS.map((t) => [t.gpu ? `gpu-transition:${t.id}` : `transition:${t.id}`, `transition:${t.id}`] as [string, string]),
      ...EFFECTS.map((e) => [e.cost === 'gpu' ? `gpu-effect:${e.id}` : `effect:${e.id}`, `effect:${e.id}`] as [string, string]),
      ...AUDIO_EFFECTS.map((e) => [`voice-effect:${e.id}`, `voice-effect:${e.id}`] as [string, string]),
    ];
    for (const [itemId, laterId] of members) {
      const asItem = byId.has(itemId), asLater = laterId !== null && laterId in BOOTH_LATER;
      expect({ itemId, once: asItem !== asLater }).toEqual({ itemId, once: true });
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) expect(BoothItemSchema.safeParse(i).success).toBe(true);
    // nothing else: every item is a catalogue member or the mic task, every later row names a member
    const memberIds = new Set(members.flatMap(([a, b]) => [a, ...(b ? [b] : [])]));
    expect(items.filter((i) => !memberIds.has(i.id)).map((i) => i.id)).toEqual(['task:mic']);
    expect(Object.keys(BOOTH_LATER).filter((k) => !memberIds.has(k))).toEqual([]);
  });
  it('the counts: 6 music, 80 SFX, 46 GPU transitions, 29 GPU effects shown; later: 23 Canvas2D transitions, 22 Canvas2D effects, 3 content-dependent GPU effects, the voice effects', () => {
    const n = (src: string) => items.filter((i) => i.source === src).length;
    expect({ music: n('music'), sfx: n('sfx'), tr: n('gpu-transition'), fx: n('gpu-effect'), task: n('task') }).toEqual({ music: 6, sfx: 80, tr: 46, fx: 29, task: 1 });
    const later = Object.keys(BOOTH_LATER);
    expect(later.filter((k) => k.startsWith('transition:')).length).toBe(23);
    expect(later.filter((k) => k.startsWith('effect:') && !BOOTH_LATER[k]!.startsWith('content')).length).toBe(22);
    expect(Object.keys(BOOTH_CONTENT_DEPENDENT_EFFECTS).sort()).toEqual(['color.lut', 'depth.living', 'key.chroma']); // depth.living joined with «תמונה חיה» (wave 8)
    expect(later.filter((k) => k.startsWith('voice-effect:')).length).toBe(AUDIO_EFFECTS.length);
    for (const why of Object.values(BOOTH_LATER)) expect(why.length).toBeGreaterThan(20);
  });
  it('one source per BoothSource value, in groups of BOOTH_GROUPS order', () => {
    expect(BOOTH_SOURCES.map((s) => s.id)).toEqual([...SOURCE_IDS]);
    const order = items.map((i) => BOOTH_GROUPS.indexOf(i.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('the first sitting', () => {
  it('is 14 items: the 7 transitions (exportStrip), the 6 styles (expected = music.golden.json), task:mic', () => {
    const first = items.filter((i) => i.group.startsWith('first.'));
    expect(first.length).toBe(BOOTH_FIRST_SITTING_CARDS);
    expect(first.filter((i) => i.group === 'first.gpu-new').map((i) => i.id)).toEqual(BOOTH_FIRST_TRANSITIONS.map((t) => `gpu-transition:${t}`));
    expect(first.filter((i) => i.group === 'first.gpu-new').every((i) => i.exportStrip)).toBe(true);
    expect(items.filter((i) => i.exportStrip).length).toBe(7);
    expect(first.filter((i) => i.group === 'first.music').map((i) => [i.id, i.expected])).toEqual(BOOTH_FIRST_MUSIC.map((s) => [`music:${s}`, `sha256:${golden.sha256[s]}`]));
    expect(first.filter((i) => i.group === 'first.mic').map((i) => i.id)).toEqual(['task:mic']);
  });
});

describe('auto-used sounds (verify C10a) and the other flags', () => {
  it('are derived from packs, templates and perform pads: 11 ids, including shutter, vinyl crackle and the short whoosh', () => {
    const auto = autoUsedSfx();
    expect([...auto.keys()].sort()).toEqual(['sfx.boing', 'sfx.bubble', 'sfx.chime', 'sfx.coin', 'sfx.ding', 'sfx.impact', 'sfx.pop', 'sfx.shutter', 'sfx.success', 'sfx.vinyl-crackle', 'sfx.whoosh-short']);
    expect(items.filter((i) => i.group === 'more.auto-sounds').map((i) => i.id).sort()).toEqual([...auto.keys()].map((k) => `sfx:${k}`).sort());
    expect(byId.get('sfx:sfx.impact')!.usedBy).toEqual(['perform']);
    expect(byId.get('sfx:sfx.success')!.usedBy).toEqual(['pack', 'template']);
    for (const id of auto.keys()) expect(SFX.some((s) => s.id === id)).toBe(true);
  });
  it('changesLight follows effectChangesLight and light transitions (plus the flash); titles are the catalogues\' names', () => {
    for (const i of items.filter((x) => x.source === 'gpu-effect')) expect(i.changesLight).toBe(effectChangesLight(i.id.split(':')[1]!));
    expect(items.filter((i) => i.source === 'gpu-transition' && i.changesLight).map((i) => i.id).sort()).toEqual(['gpu-transition:film-burn', 'gpu-transition:flash', 'gpu-transition:light-leak']);
    expect(byId.get('music:music.calm')!.title).toEqual(MUSIC_STYLES.find((s) => s.id === 'music.calm')!.name);
    expect(byId.get('gpu-transition:ink-bleed')!.title).toEqual(TRANSITIONS.find((t) => t.id === 'ink-bleed')!.name);
  });
  it('the «what» words are the i18n strings (the server has no i18n dependency)', () => {
    const pairs: [keyof typeof BOOTH_WHAT, string][] = [['music', 'booth.what.music'], ['sfx', 'booth.what.sfx'], ['transition', 'booth.what.transition'], ['effect', 'booth.what.effect'], ['micTitle', 'booth.mic.title'], ['mic', 'booth.mic.what']];
    for (const [k, key] of pairs) expect(BOOTH_WHAT[k]).toEqual({ he: (BOOTH_HE as Record<string, string>)[key], en: (BOOTH_EN as Record<string, string>)[key] });
  });
});

describe('recipes (plan check 2, verify C7)', () => {
  it('are equal across two builds of the registry (the same inputs, a fresh computation)', async () => {
    expect(boothItems(env).map((i) => i.recipe)).toEqual(items.map((i) => i.recipe));
    const a = await boothRegistry(), b = await boothRegistry();
    expect(a).toBe(b); // once per process
  });
  it('a labelled synthetic registry with ONE changed SFX graph changes only that item\'s recipe', () => {
    // LABELLED STAND-IN (test only): the real SFX source with one graph edited
    const edited: BoothSourceDef = { id: 'sfx', items: (e) => sfxSource.items(e).map((i) => i) };
    const synthetic = BOOTH_SOURCES.map((s) => (s.id === 'sfx' ? edited : s));
    const changedId = 'sfx:sfx.click';
    const orig = SFX.find((s) => s.id === 'sfx.click')!;
    const saved = orig.graph;
    try {
      (orig as { graph: string }).graph = `${saved},volume=0.9`;
      const again = boothItems(env, synthetic);
      const diff = again.filter((i, n) => i.recipe !== items[n]!.recipe).map((i) => i.id);
      expect(diff).toEqual([changedId]);
    } finally { (orig as { graph: string }).graph = saved; }
  });
  it('the SFX recipe holds the ffmpeg version line: another ffmpeg changes every SFX recipe and nothing else', () => {
    const other = boothItems({ ...env, ffmpegLine: 'ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024 the FFmpeg developers' });
    const diff = new Set(other.filter((i, n) => i.recipe !== items[n]!.recipe).map((i) => i.source));
    expect([...diff]).toEqual(['sfx']);
    // and the test pictures' pixels are in every picture recipe
    const pix = boothItems({ ...env, picturesRgba: `sha256:${'d'.repeat(64)}` });
    expect([...new Set(pix.filter((i, n) => i.recipe !== items[n]!.recipe).map((i) => i.source))].sort()).toEqual(['gpu-effect', 'gpu-transition']);
  });
  it('ffmpegFirstLine takes line 1 as ASCII, and says unavailable when ffmpeg cannot start', async () => {
    expect(await ffmpegFirstLine(async () => 'ffmpeg version 6.1 \u200fx\nconfiguration: --prefix=/home/x')).toBe('ffmpeg version 6.1 x');
    expect(await ffmpegFirstLine(async () => { throw new Error('C:\\Users\\x\\ffmpeg.exe ENOENT'); })).toBe('ffmpeg unavailable');
  });
});
