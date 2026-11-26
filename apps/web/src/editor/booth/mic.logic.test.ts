/** Builder W2: the microphone card's logic (a labelled fake engine; the real engine's release paths are recorder.test.ts's). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { RecorderPorts, RecorderState, StoryRecorderHandle } from '../story/recorder.contract.ts';
import { attachHiddenRelease, createMicSession, MIC_MS, micBusy, micMeasure, peakText } from './mic.logic.ts';
import { BOOTH_PAGE_STRINGS } from './check/check.strings.ts';

// ---- STAND-IN (labelled): an engine that counts what the session asks of it
function fakeEngine() {
  const log = { starts: 0, stops: 0, discards: 0, releases: 0, maxMs: undefined as number | undefined, constraints: null as unknown, ports: null as RecorderPorts | null };
  const factory = (ports: RecorderPorts): StoryRecorderHandle => {
    log.ports = ports; log.maxMs = ports.maxMs;
    return { async start() { log.starts++; log.constraints = await ports.getUserMedia({ audio: true }).then(() => 'granted', () => 'refused'); }, stop() { log.stops++; }, discard() { log.discards++; }, release() { log.releases++; }, tracks: () => [] };
  };
  return { log, factory };
}
const nav = (getUserMedia?: () => Promise<MediaStream>) => ({ mediaDevices: getUserMedia ? { getUserMedia } : undefined });

describe('microphone card logic (builder W2)', () => {
  it('the take is 5 seconds through the story recorder\'s own session; the permission is asked only when a take starts', async () => {
    const e = fakeEngine(); let asked = 0;
    const s = createMicSession(() => undefined, e.factory, nav(async () => { asked++; return {} as MediaStream; }));
    expect(e.log.maxMs).toBe(5000); expect(MIC_MS).toBe(5000);
    expect(asked).toBe(0); // building the session never touches the microphone
    await s.start();
    expect(asked).toBe(1); expect(e.log.starts).toBe(1);
  });
  it('a browser without a microphone API refuses with an error the recorder words as unsupported, never a throw out of the card', async () => {
    const e = fakeEngine();
    const s = createMicSession(() => undefined, e.factory, nav());
    await s.start();
    expect(e.log.constraints).toBe('refused');
  });
  it('released on every path of this card: stop, a new take, dialog close or card change (dispose), and the page hidden', () => {
    const e = fakeEngine();
    const s = createMicSession(() => undefined, e.factory, nav(async () => ({}) as MediaStream));
    s.stop(); expect(e.log.stops).toBe(1);
    s.discard(); expect(e.log.discards).toBe(1);
    s.release(); expect(e.log.releases).toBe(1);
    s.dispose(); s.dispose(); // the card closing, twice: idempotent, and each one releases
    expect(s.releases()).toBe(3);
    // the page hidden: an extra release beyond the recorder's own listener
    const listeners = new Map<string, () => void>(); const winL = new Map<string, () => void>();
    const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: (k: string, f: () => void) => { listeners.set(k, f); }, removeEventListener: (k: string) => { listeners.delete(k); } };
    const win = { addEventListener: (k: string, f: () => void) => { winL.set(k, f); }, removeEventListener: (k: string) => { winL.delete(k); } };
    let hidden = 0;
    const off = attachHiddenRelease(doc as never, win as never, () => { hidden++; });
    listeners.get('visibilitychange')!(); expect(hidden).toBe(0); // still visible
    doc.visibilityState = 'hidden'; listeners.get('visibilitychange')!(); expect(hidden).toBe(1);
    winL.get('pagehide')!(); expect(hidden).toBe(2);
    off(); expect(listeners.size).toBe(0); expect(winL.size).toBe(0);
  });
  it('a state reported after dispose is not forwarded (a gone card is not updated)', () => {
    const e = fakeEngine(); const got: string[] = [];
    const s = createMicSession((st) => got.push(st.kind), e.factory, nav());
    e.log.ports!.onState({ kind: 'asking' });
    s.dispose();
    e.log.ports!.onState({ kind: 'recording', samples: 1, rate: 48000, peakDbfs: -3, clipped: 0, device: null });
    expect(got).toEqual(['asking']);
  });
  it('measurements: peak dBFS and the clipped count of a finished take, as numbers; digital silence has no peak; nothing is measured before', () => {
    const wav = new Blob([new Uint8Array(4)]);
    const done = (peak: number | null, clipped: number): RecorderState => ({ kind: 'limit', samples: 240000, rate: 48000, peakDbfs: peak, clipped, wav });
    expect(micMeasure(done(-12.3, 4))).toEqual({ peakDbfs: -12.3, clipped: 4 });
    expect(micMeasure({ kind: 'stopped', samples: 1, rate: 48000, peakDbfs: null, clipped: 0, wav })).toEqual({ peakDbfs: null, clipped: 0 });
    expect(micMeasure({ kind: 'recording', samples: 1, rate: 48000, peakDbfs: -3, clipped: 0, device: null })).toBeNull();
    expect(micMeasure({ kind: 'idle' })).toBeNull();
    expect(peakText(-12.34)).toBe('-12.3'); expect(peakText(null)).toBe('-∞');
    expect(micBusy({ kind: 'asking' })).toBe(true); expect(micBusy({ kind: 'idle' })).toBe(false);
  });
  it('nothing is stored or sent: the card and its logic have no network, storage, import or download path; the words call no take good', () => {
    const src = ['MicCard.tsx', 'mic.logic.ts'].map((f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')).map((s) => s.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')).join('\n');
    expect(src).not.toMatch(/\bfetch\(|localStorage|sessionStorage|indexedDB|importFiles|saveRecording|sendBeacon|XMLHttpRequest|\.download\b|api\./);
    for (const l of ['he', 'en'] as const) for (const [k, v] of Object.entries(BOOTH_PAGE_STRINGS[l])) if (k.startsWith('mic') && typeof v === 'string') expect(v, k).not.toMatch(/\b(good|right|sharp|safe|verified)\b|מצוין|תקין|בסדר גמור|מאומת/i);
  });
});
