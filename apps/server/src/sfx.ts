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
export interface SfxDef { id: string; version: number; name: { he: string; en: string }; seconds: number; /** ffmpeg lavfi source graph (mono), deterministic */ graph: string }
const tone = (expr: string, d: number) => `aevalsrc=${expr.replaceAll(',', '\\,')}:s=48000:d=${d}`;
export const SFX: readonly SfxDef[] = [
  { id: 'sfx.click', version: 1, name: { he: 'קליק', en: 'Click' }, seconds: 0.05, graph: tone('0.8*sin(2*PI*2000*t)*exp(-200*t)', 0.05) },
  { id: 'sfx.pop', version: 1, name: { he: 'פופ', en: 'Pop' }, seconds: 0.15, graph: tone('0.8*sin(2*PI*(700-1800*t)*t)*exp(-25*t)', 0.15) },
  { id: 'sfx.beep', version: 1, name: { he: 'ביפ', en: 'Beep' }, seconds: 0.2, graph: `${tone('0.5*sin(2*PI*1000*t)', 0.2)},afade=t=in:d=0.005,afade=t=out:st=0.195:d=0.005` },
  { id: 'sfx.ding', version: 1, name: { he: 'דינג', en: 'Ding' }, seconds: 1.2, graph: tone('0.5*sin(2*PI*1320*t)*exp(-6*t)+0.25*sin(2*PI*2640*t)*exp(-9*t)', 1.2) },
  { id: 'sfx.impact', version: 1, name: { he: 'מכה', en: 'Impact' }, seconds: 0.9, graph: tone('0.9*sin(2*PI*(95-55*t)*t)*exp(-5*t)', 0.9) },
  { id: 'sfx.whoosh', version: 1, name: { he: 'ווש', en: 'Whoosh' }, seconds: 0.6, graph: 'anoisesrc=c=pink:r=48000:a=0.8:seed=11:d=0.6,highpass=f=300,afade=t=in:d=0.25:curve=qsin,afade=t=out:st=0.25:d=0.35:curve=qsin' },
  { id: 'sfx.riser', version: 1, name: { he: 'עלייה', en: 'Riser' }, seconds: 1.5, graph: 'anoisesrc=c=white:r=48000:a=0.5:seed=7:d=1.5,highpass=f=900,afade=t=in:d=1.45:curve=cub,afade=t=out:st=1.47:d=0.03' },
];

/** Synthesise one effect and return it as an asset (blob stored, not yet attached to a project). */
export async function makeSfx(store: Store, id: string, actor: string): Promise<Omit<Asset, 'id'>> {
  const def = SFX.find((s) => s.id === id);
  if (!def) throw new ApiError(404, 'not_found', `sound effect "${id}" does not exist`, { available: SFX.map((s) => s.id) }, 'Call list_catalog.');
  const tmp = path.join(store.tmpDir, `sfx_${randomBytes(6).toString('hex')}.wav`);
  try {
    // -bitexact and a fixed graph: the same build produces the same bytes, so the asset is content-addressed and de-duplicated.
    await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', def.graph, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', '-bitexact', '-fflags', '+bitexact', tmp], { timeout: 30_000 });
    const bytes = fs.readFileSync(tmp);
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const meta = await describeMedia(tmp);
    store.putBlob(contentHash, tmp, bytes.length, meta.mimeType);
    return { ...meta, name: `${def.name.en}.wav`, contentHash, byteSize: bytes.length, provenance: { origin: 'generated', importedAt: new Date().toISOString(), importedBy: actor, procedural: { id: def.id, version: def.version, generator: 'ffmpeg lavfi formula; no third-party content' } } };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
