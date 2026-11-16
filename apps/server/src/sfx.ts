/**
 * Built-in sound effects (SPEC §10: "sounds are actual assets"). Each one is synthesised by ffmpeg from a formula
 * (no recordings, no third-party content, nothing downloaded), stored as a normal content-addressed WAV asset with its
 * recipe in provenance, and placed on the timeline like any other clip. This is a small starter set, not a sound library.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Asset } from '@pulseframe/core';
import { describeMedia } from './ingest.ts';
import { ApiError, type Store } from './store.ts';

const exec = promisify(execFile);
export type SfxCategory = 'ui' | 'whoosh' | 'impact' | 'riser' | 'glitch' | 'notify' | 'cartoon' | 'ambience' | 'drum' | 'tone';
export interface SfxDef { id: string; version: number; name: { he: string; en: string }; seconds: number; /** ffmpeg lavfi source graph (mono), deterministic */ graph: string; category: SfxCategory }
const tone = (expr: string, d: number) => `aevalsrc=${expr.replaceAll(',', '\\,')}:s=48000:d=${d}`;
const ORIGINAL_SFX: readonly SfxDef[] = [
  { id: 'sfx.click', version: 1, name: { he: 'קליק', en: 'Click' }, seconds: 0.05, graph: tone('0.8*sin(2*PI*2000*t)*exp(-200*t)', 0.05), category: 'ui' },
  { id: 'sfx.pop', version: 1, name: { he: 'פופ', en: 'Pop' }, seconds: 0.15, graph: tone('0.8*sin(2*PI*(700-1800*t)*t)*exp(-25*t)', 0.15), category: 'ui' },
  { id: 'sfx.beep', version: 1, name: { he: 'ביפ', en: 'Beep' }, seconds: 0.2, graph: `${tone('0.5*sin(2*PI*1000*t)', 0.2)},afade=t=in:d=0.005,afade=t=out:st=0.195:d=0.005`, category: 'tone' },
  { id: 'sfx.ding', version: 1, name: { he: 'דינג', en: 'Ding' }, seconds: 1.2, graph: tone('0.5*sin(2*PI*1320*t)*exp(-6*t)+0.25*sin(2*PI*2640*t)*exp(-9*t)', 1.2), category: 'notify' },
  { id: 'sfx.impact', version: 1, name: { he: 'מכה', en: 'Impact' }, seconds: 0.9, graph: tone('0.9*sin(2*PI*(95-55*t)*t)*exp(-5*t)', 0.9), category: 'impact' },
  { id: 'sfx.whoosh', version: 1, name: { he: 'ווש', en: 'Whoosh' }, seconds: 0.6, graph: 'anoisesrc=c=pink:r=48000:a=0.8:seed=11:d=0.6,highpass=f=300,afade=t=in:d=0.25:curve=qsin,afade=t=out:st=0.25:d=0.35:curve=qsin', category: 'whoosh' },
  { id: 'sfx.riser', version: 1, name: { he: 'עלייה', en: 'Riser' }, seconds: 1.5, graph: 'anoisesrc=c=white:r=48000:a=0.5:seed=7:d=1.5,highpass=f=900,afade=t=in:d=1.45:curve=cub,afade=t=out:st=1.47:d=0.03', category: 'riser' },
];

// ---- Procedural library (formulas only; every noise source has a fixed seed) ----
/** Tone from a formula, with a 5 ms fade-out so the end never clicks. */
const T = (expr: string, d: number) => `${tone(expr, d)},afade=t=out:st=${+(d - 0.005).toFixed(4)}:d=0.005`;
/** Seeded noise shaped by an envelope expression in t (1 ms resolution), then optional filters. */
const N = (color: string, amp: number, seed: number, d: number, env: string, filters = '') =>
  `anoisesrc=c=${color}:r=48000:a=${amp}:seed=${seed}:d=${d}:nb_samples=48,volume='${env}':eval=frame${filters ? `,${filters}` : ''},afade=t=out:st=${+(d - 0.005).toFixed(4)}:d=0.005`;
/** Sum of two graphs, both of the same duration. */
const mix = (a: string, b: string) => `${a}[x];${b}[y];[x][y]amix=inputs=2:normalize=0:duration=longest`;
const SIN = (f: number | string, t = 't') => `sin(2*PI*${f}*${t})`;
/** Linear chirp f0 -> f1 over d seconds. */
const chirp = (f0: number, f1: number, d: number) => `sin(2*PI*(${f0}*t+${+((f1 - f0) / (2 * d)).toPrecision(6)}*t*t))`;
/** A decaying note starting at s seconds. */
const note = (s: number, f: number, k: number, a = 0.5) => `${a}*gt(t,${s})*${SIN(f, `(t-${s})`)}*exp(-${k}*(t-${s}))`;
const sq = (f: number | string) => `(gt(${SIN(f)},0)-0.5)`;
const mk = (id: string, category: SfxCategory, he: string, en: string, seconds: number, graph: string): SfxDef => ({ id: `sfx.${id}`, version: 1, name: { he, en }, seconds, graph, category });

const NEW_SFX: readonly SfxDef[] = [
  // ui
  mk('tick', 'ui', 'טיק', 'Tick', 0.06, T(`0.8*${SIN(3500)}*exp(-400*t)`, 0.06)),
  mk('tick-soft', 'ui', 'טיק רך', 'Soft tick', 0.08, T(`0.6*${SIN(1200)}*exp(-150*t)`, 0.08)),
  mk('toggle-on', 'ui', 'מתג דלוק', 'Toggle on', 0.15, T(`${note(0, 600, 40)}+${note(0.05, 900, 40)}`, 0.15)),
  mk('toggle-off', 'ui', 'מתג כבוי', 'Toggle off', 0.15, T(`${note(0, 900, 40)}+${note(0.05, 600, 40)}`, 0.15)),
  mk('key-press', 'ui', 'לחיצת מקש', 'Key press', 0.08, T(`0.6*${SIN(180)}*exp(-80*t)+0.4*${SIN(2500)}*exp(-300*t)`, 0.08)),
  mk('shutter', 'ui', 'צמצם מצלמה', 'Camera shutter', 0.16, T(`0.7*${SIN(1800)}*exp(-250*t)+0.3*${SIN(90)}*exp(-60*t)+${note(0.06, 1100, 200, 0.6)}`, 0.16)),
  mk('tap', 'ui', 'נקישה', 'Tap', 0.1, T(`0.8*${SIN(400)}*exp(-90*t)`, 0.1)),
  mk('select', 'ui', 'בחירה', 'Select', 0.12, T(`0.4*${SIN(1500)}*exp(-40*t)+0.2*${SIN(3000)}*exp(-60*t)`, 0.12)),
  mk('swipe-tick', 'ui', 'החלקה קצרה', 'Swipe tick', 0.12, N('white', 0.9, 21, 0.12, 'sin(PI*t/0.12)', 'bandpass=f=3000:w=1500,volume=24dB')),
  // whoosh
  mk('whoosh-short', 'whoosh', 'ווש קצר', 'Short whoosh', 0.3, N('pink', 0.8, 31, 0.3, 'pow(sin(PI*t/0.3),2)', 'highpass=f=500')),
  mk('whoosh-long', 'whoosh', 'ווש ארוך', 'Long whoosh', 1.5, N('pink', 0.8, 32, 1.5, 'pow(sin(PI*t/1.5),2)', 'highpass=f=250')),
  mk('whoosh-low', 'whoosh', 'ווש נמוך', 'Low whoosh', 0.8, N('brown', 1, 33, 0.8, 'pow(sin(PI*t/0.8),2)', 'lowpass=f=600')),
  mk('whoosh-high', 'whoosh', 'ווש גבוה', 'High whoosh', 0.5, N('white', 0.5, 34, 0.5, 'pow(sin(PI*t/0.5),2)', 'highpass=f=2500')),
  mk('whoosh-reverse', 'whoosh', 'ווש הפוך', 'Reverse swell', 0.8, N('pink', 0.8, 35, 0.8, 'pow(t/0.8,3)', 'highpass=f=400')),
  mk('whoosh-swirl', 'whoosh', 'מערבולת', 'Swirl', 1.2, N('pink', 0.8, 36, 1.2, 'sin(PI*t/1.2)*(0.6+0.4*sin(2*PI*7*t))', 'bandpass=f=1500:w=1800,volume=28dB')),
  mk('whoosh-air', 'whoosh', 'משב אוויר', 'Air burst', 0.4, N('white', 0.7, 37, 0.4, 'exp(-8*t)', 'highpass=f=1000,lowpass=f=4500')),
  // impact
  mk('boom', 'impact', 'בום', 'Boom', 3, T(`0.9*${SIN('(70-20*t)')}*exp(-1.6*t)`, 3)),
  mk('hit', 'impact', 'פגיעה', 'Hit', 0.3, T(`0.9*${SIN('(180-250*t)')}*exp(-18*t)`, 0.3)),
  mk('thud', 'impact', 'חבטה', 'Thud', 0.4, T(`0.9*${SIN(60)}*exp(-12*t)`, 0.4)),
  mk('slam', 'impact', 'טריקה', 'Slam', 0.7, mix(N('brown', 1, 41, 0.7, 'exp(-9*t)', 'lowpass=f=1800'), T(`0.6*${SIN('(90-50*t)')}*exp(-6*t)`, 0.7))),
  mk('punch', 'impact', 'אגרוף', 'Punch', 0.25, T(`0.9*${SIN('(220-600*t)')}*exp(-22*t)`, 0.25)),
  mk('cinematic-hit', 'impact', 'מכה קולנועית', 'Cinematic hit', 1.8, mix(N('pink', 0.8, 42, 1.8, 'exp(-4*t)', 'lowpass=f=900'), T(`0.7*${SIN('(55-10*t)')}*exp(-2.2*t)`, 1.8))),
  mk('metal-clang', 'impact', 'צלצול מתכת', 'Metal clang', 1, T(`0.3*${SIN(523)}*exp(-5*t)+0.25*${SIN(1347)}*exp(-7*t)+0.2*${SIN(2210)}*exp(-9*t)+0.15*${SIN(3480)}*exp(-12*t)`, 1)),
  // riser / downer
  mk('riser-short', 'riser', 'עלייה קצרה', 'Short riser', 0.8, N('white', 0.6, 51, 0.8, 'pow(t/0.8,2)', 'highpass=f=1200')),
  mk('riser-long', 'riser', 'עלייה ארוכה', 'Long riser', 3.5, N('pink', 0.7, 52, 3.5, 'pow(t/3.5,2.5)', 'highpass=f=600')),
  mk('riser-tonal', 'riser', 'עלייה טונלית', 'Tonal riser', 2, T(`0.5*(t/2)*${chirp(200, 2000, 2)}`, 2)),
  mk('riser-pulse', 'riser', 'עלייה פועמת', 'Pulsing riser', 2, T(`0.5*(t/2)*${chirp(300, 1200, 2)}*(0.5+0.5*${SIN('(4+8*t)')})`, 2)),
  mk('downer', 'riser', 'ירידה', 'Downer', 1.5, N('pink', 0.7, 53, 1.5, 'pow(1-t/1.5,2)', 'highpass=f=500')),
  mk('downer-tonal', 'riser', 'ירידה טונלית', 'Tonal downer', 1.5, T(`0.5*(1-t/1.5)*${chirp(1500, 150, 1.5)}`, 1.5)),
  mk('bass-drop', 'riser', 'נפילת בס', 'Bass drop', 1.5, T(`0.9*sin(2*PI*(30*t+80*(1-exp(-3*t))/3))*exp(-0.8*t)`, 1.5)),
  // glitch
  mk('blip', 'glitch', 'בליפ', 'Blip', 0.08, T(`0.5*${sq(1800)}`, 0.08)),
  mk('blip-double', 'glitch', 'בליפ כפול', 'Double blip', 0.2, T(`0.5*${sq(1400)}*(lt(t,0.07)+gt(t,0.12))`, 0.2)),
  mk('stutter', 'glitch', 'גמגום', 'Stutter', 0.4, T(`0.5*${sq(500)}*gt(mod(t,0.08),0.04)`, 0.4)),
  mk('digital-noise', 'glitch', 'רעש דיגיטלי', 'Digital noise burst', 0.25, N('white', 0.7, 61, 0.25, 'gt(mod(t,0.05),0.015)', 'acrusher=bits=4:mix=1:samples=12')),
  mk('zap', 'glitch', 'זאפ', 'Zap', 0.25, T(`0.6*${chirp(3000, 200, 0.25)}*exp(-4*t)`, 0.25)),
  mk('laser', 'glitch', 'לייזר', 'Laser', 0.4, T(`0.5*(gt(${chirp(2000, 300, 0.4)},0)-0.5)*exp(-3*t)`, 0.4)),
  mk('glitch-bits', 'glitch', 'גליץ׳ ביטים', 'Bit glitch', 0.5, T(`0.4*${sq('(300+250*mod(floor(t*30)*7,5))')}`, 0.5)),
  // notify
  mk('chime', 'notify', 'צלצול עדין', 'Chime', 1.5, T(`${note(0, 880, 4)}+${note(0.18, 1175, 3.5)}`, 1.5)),
  mk('success', 'notify', 'הצלחה', 'Success arpeggio', 0.9, T(`${note(0, 523, 6, 0.35)}+${note(0.1, 659, 6, 0.35)}+${note(0.2, 784, 6, 0.35)}+${note(0.3, 1047, 4, 0.35)}`, 0.9)),
  mk('error-buzz', 'notify', 'זמזום שגיאה', 'Error buzz', 0.4, `${T(`0.5*${sq(150)}`, 0.4)},lowpass=f=1500`),
  mk('message-pop', 'notify', 'הודעה חדשה', 'Message pop', 0.25, T(`0.7*${SIN('(500+1400*t)')}*exp(-14*t)`, 0.25)),
  mk('coin', 'notify', 'מטבע', 'Coin', 0.7, T(`${note(0, 988, 12, 0.4)}+${note(0.08, 1319, 6, 0.4)}`, 0.7)),
  mk('notify-soft', 'notify', 'התראה רכה', 'Soft notification', 0.8, T(`${note(0, 660, 7, 0.4)}+${note(0.12, 990, 6, 0.3)}`, 0.8)),
  mk('warning-double', 'notify', 'אזהרה כפולה', 'Double warning', 0.7, T(`${note(0, 800, 5, 0.4)}+${note(0.25, 600, 5, 0.4)}`, 0.7)),
  // cartoon
  mk('boing', 'cartoon', 'בוינג', 'Boing', 0.8, T(`0.7*sin(2*PI*(300*t+25*sin(2*PI*9*t)))*exp(-4*t)`, 0.8)),
  mk('whistle-up', 'cartoon', 'שריקה עולה', 'Slide whistle up', 0.6, T(`0.4*${chirp(400, 2000, 0.6)}*sin(PI*t/0.6)`, 0.6)),
  mk('whistle-down', 'cartoon', 'שריקה יורדת', 'Slide whistle down', 0.6, T(`0.4*${chirp(2000, 400, 0.6)}*sin(PI*t/0.6)`, 0.6)),
  mk('bubble', 'cartoon', 'בועה', 'Bubble', 0.15, T(`0.7*${chirp(300, 900, 0.15)}*exp(-18*t)`, 0.15)),
  mk('bonk', 'cartoon', 'בונק', 'Bonk', 0.3, T(`0.7*${SIN(200)}*exp(-14*t)+0.4*${SIN(530)}*exp(-20*t)`, 0.3)),
  mk('wobble', 'cartoon', 'וובל', 'Wobble', 1, T(`0.5*sin(2*PI*(500*t+60*sin(2*PI*6*t)))*sin(PI*t)`, 1)),
  // ambience
  mk('wind', 'ambience', 'רוח', 'Wind', 4, N('pink', 0.8, 71, 4, '0.6+0.4*sin(2*PI*0.4*t)', 'lowpass=f=900,afade=t=in:d=0.5')),
  mk('rain', 'ambience', 'גשם', 'Rain', 4, N('white', 0.5, 72, 4, '1', 'highpass=f=2000,lowpass=f=9000,afade=t=in:d=0.3')),
  mk('room-tone', 'ambience', 'שקט חדר', 'Room tone', 4, N('brown', 0.9, 73, 4, '1', 'lowpass=f=400,afade=t=in:d=0.3')),
  mk('vinyl-crackle', 'ambience', 'שריקת תקליט', 'Vinyl crackle', 4, N('white', 1, 74, 4, '1', 'agate=threshold=0.6:ratio=9000:attack=0.01:release=2:detection=peak,bandpass=f=3500:w=3000,volume=30dB,afade=t=in:d=0.2')),
  mk('electric-hum', 'ambience', 'זמזום חשמלי', 'Electric hum', 3, T(`0.4*${SIN(50)}+0.2*${SIN(100)}+0.1*${SIN(150)}`, 3)),
  // drum
  mk('kick', 'drum', 'קיק', 'Kick', 0.4, T(`0.95*sin(2*PI*(45*t+55*(1-exp(-30*t))/30))*exp(-9*t)`, 0.4)),
  mk('kick-808', 'drum', 'קיק 808', 'Kick 808', 1, T(`0.95*sin(2*PI*(40*t+60*(1-exp(-20*t))/20))*exp(-3.5*t)`, 1)),
  mk('snare', 'drum', 'סנר', 'Snare', 0.25, mix(N('white', 0.7, 81, 0.25, 'exp(-22*t)', 'highpass=f=1500'), T(`0.5*${SIN(190)}*exp(-30*t)`, 0.25))),
  mk('hihat-closed', 'drum', 'היי-האט סגור', 'Hi-hat closed', 0.08, N('white', 0.6, 82, 0.08, 'exp(-60*t)', 'highpass=f=7000')),
  mk('hihat-open', 'drum', 'היי-האט פתוח', 'Hi-hat open', 0.5, N('white', 0.6, 83, 0.5, 'exp(-8*t)', 'highpass=f=6500')),
  mk('clap', 'drum', 'מחיאת כף', 'Clap', 0.3, N('white', 0.9, 84, 0.3, 'if(lt(t,0.03),pow(mod(t,0.01)/0.01,0.5),exp(-18*(t-0.03)))', 'bandpass=f=1400:w=1200,volume=30dB')),
  mk('tom-low', 'drum', 'תוף נמוך', 'Low tom', 0.6, T(`0.9*sin(2*PI*(90*t+40*(1-exp(-15*t))/15))*exp(-6*t)`, 0.6)),
  mk('tom-high', 'drum', 'תוף גבוה', 'High tom', 0.4, T(`0.9*sin(2*PI*(200*t+80*(1-exp(-20*t))/20))*exp(-9*t)`, 0.4)),
  mk('rimshot', 'drum', 'רימשוט', 'Rimshot', 0.15, T(`0.5*${SIN(1700)}*exp(-90*t)+0.4*${SIN(480)}*exp(-60*t)+0.3*${SIN(3100)}*exp(-120*t)`, 0.15)),
  // tone
  mk('beep-high', 'tone', 'ביפ גבוה', 'High beep', 0.15, `${T(`0.5*${SIN(2000)}`, 0.15)},afade=t=in:d=0.005`),
  mk('beep-low', 'tone', 'ביפ נמוך', 'Low beep', 0.25, `${T(`0.5*${SIN(440)}`, 0.25)},afade=t=in:d=0.005`),
  mk('beep-double', 'tone', 'ביפ כפול', 'Double beep', 0.35, `${T(`0.5*${SIN(1200)}*(lt(t,0.12)+gt(t,0.2))`, 0.35)},afade=t=in:d=0.005`),
  mk('countdown-beep', 'tone', 'ביפ ספירה', 'Countdown beep', 0.15, `${T(`0.5*${SIN(880)}`, 0.15)},afade=t=in:d=0.005`),
  mk('countdown-final', 'tone', 'ביפ סיום ספירה', 'Countdown final', 0.6, `${T(`0.5*${SIN(1760)}`, 0.6)},afade=t=in:d=0.005`),
  mk('heartbeat', 'tone', 'פעימת לב', 'Heartbeat', 1, T(`0.9*${SIN(55)}*exp(-25*(t-0.0))*lt(t,0.2)+0.7*gt(t,0.3)*${SIN(48, '(t-0.3)')}*exp(-25*(t-0.3))`, 1)),
  mk('alarm-soft', 'tone', 'אזעקה רכה', 'Soft alarm', 1.6, T(`0.4*sin(2*PI*(700+100*sgn(sin(2*PI*2.5*t)))*t)`, 1.6)),
  mk('sonar-ping', 'tone', 'פינג סונאר', 'Sonar ping', 2.5, T(`0.6*${SIN(1000)}*exp(-3*t)+${note(0.4, 1000, 4, 0.2)}`, 2.5)),
  mk('tuning-a440', 'tone', 'כוונון לה', 'Tuning A440', 1, `${T(`0.4*${SIN(440)}`, 1)},afade=t=in:d=0.01`),
];

export const SFX: readonly SfxDef[] = [...ORIGINAL_SFX, ...NEW_SFX];

/** ffmpeg arguments used by makeSfx (exported so tests render exactly what production renders). */
export const sfxFfmpegArgs = (graph: string, out: string): string[] => ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', graph, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', '-bitexact', '-fflags', '+bitexact', out];

/** Rendered bytes of one effect for listening before adding it. Held in memory for the few most recent ones; nothing is stored. */
const previews = new Map<string, Buffer>();
export async function sfxPreview(tmpDir: string, id: string): Promise<Buffer> {
  const def = SFX.find((s) => s.id === id);
  if (!def) throw new ApiError(404, 'not_found', `sound effect "${id}" does not exist`, { available: SFX.map((s) => s.id) }, 'Call list_catalog.');
  const hit = previews.get(id);
  if (hit) return hit;
  const tmp = path.join(tmpDir, `sfxp_${randomBytes(6).toString('hex')}.wav`);
  try {
    await exec('ffmpeg', sfxFfmpegArgs(def.graph, tmp), { timeout: 30_000 });
    const bytes = fs.readFileSync(tmp);
    previews.set(id, bytes);
    if (previews.size > 24) previews.delete(previews.keys().next().value!);
    return bytes;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Synthesise one effect and return it as an asset (blob stored, not yet attached to a project). */
export async function makeSfx(store: Store, id: string, actor: string): Promise<Omit<Asset, 'id'>> {
  const def = SFX.find((s) => s.id === id);
  if (!def) throw new ApiError(404, 'not_found', `sound effect "${id}" does not exist`, { available: SFX.map((s) => s.id) }, 'Call list_catalog.');
  const tmp = path.join(store.tmpDir, `sfx_${randomBytes(6).toString('hex')}.wav`);
  try {
    // -bitexact and a fixed graph: the same build produces the same bytes, so the asset is content-addressed and de-duplicated.
    await exec('ffmpeg', sfxFfmpegArgs(def.graph, tmp), { timeout: 30_000 });
    const bytes = fs.readFileSync(tmp);
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const meta = await describeMedia(tmp);
    store.putBlob(contentHash, tmp, bytes.length, meta.mimeType);
    return { ...meta, name: `${def.name.en}.wav`, contentHash, byteSize: bytes.length, provenance: { origin: 'generated', importedAt: new Date().toISOString(), importedBy: actor, procedural: { id: def.id, version: def.version, generator: 'ffmpeg lavfi formula; no third-party content' } } };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
