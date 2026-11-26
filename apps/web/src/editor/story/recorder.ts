/**
 * The microphone recorder engine (W2; contract recorder.contract.ts). Raw mono capture through the static worklet
 * '/pf-recorder.js' (apps/web/public), blocks of at least RECORDER_LIMITS.blockSamples, a 16-bit mono WAV at the context's own rate.
 *
 * PRIVACY (C10; the lead reviews every line that releases the microphone): the microphone is released — EVERY track of the stream
 * stopped, the worklet and source disconnected, the context closed — by `releaseMic()` (the live stream) or `releaseOrphan()` (a
 * stream that is no longer the live one), which run:
 *   1. on stop()                                    (the take is kept as a WAV in memory),
 *   2. on discard()  — «הקלטה מחדש»                 (the take is dropped),
 *   3. on release()  — dialog closed, unmount        (the UI calls it from its cleanup; idempotent),
 *   4. when the page is hidden (visibilitychange → hidden, or pagehide) — the engine listens by itself while the microphone is open,
 *   5. when the sample limit is reached (state 'limit'),
 *   6. when the microphone ends by itself (a track's 'ended': unplugged, permission revoked),
 *   7. when anything fails after the microphone was granted (the worklet cannot load, the context cannot start),
 *   8. when the microphone is granted only after release()/discard() or a new start() was asked for (the late stream is stopped at once).
 * Nothing leaves the machine here: the engine makes a Blob in memory and never calls the network; the UI saves it only through the
 * existing authenticated import path. Nothing is stored until «שמירה».
 */
import { RECORDER_LIMITS, type RecorderPorts, type RecorderState, type StoryRecorderHandle } from './recorder.contract.ts';

/** True once the engine is built (W2 flips it). */
export const RECORDER_BUILT: boolean = true;

/** The constraints of the capture: the raw microphone, mono (no echo cancellation, noise suppression or gain control). */
export const RECORDER_CONSTRAINTS: MediaStreamConstraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false };
/** The worklet's registered name (apps/web/public/pf-recorder.js). */
export const RECORDER_PROCESSOR = 'pf-recorder';

/** A 16-bit PCM mono WAV of `samples` at `rate` (RIFF header, little-endian). */
export function encodeWav(samples: Int16Array, rate: number): Uint8Array {
  if (!Number.isInteger(rate) || rate <= 0) throw new Error(`encodeWav: the rate must be a positive whole number, not ${rate}`);
  const data = samples.length * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const ascii = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + data, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + 2 * i, samples[i]!, true);
  return out;
}

/** dBFS of a peak (0..32768), one decimal; null for digital silence. */
export const peakDbfs = (peak: number): number | null => (peak > 0 ? Math.round(200 * Math.log10(Math.min(peak, 32768) / 32768)) / 10 : null);

/** What the worklet posts: one block of mono samples, its peak (absolute, 0..32768) and how many of its samples are at full scale. */
export interface RecorderBlock { samples: Int16Array; peak: number; clipped: number }
const isBlock = (x: unknown): x is RecorderBlock => !!x && typeof x === 'object' && (x as RecorderBlock).samples instanceof Int16Array && typeof (x as RecorderBlock).peak === 'number' && typeof (x as RecorderBlock).clipped === 'number';

type Live = { stream: MediaStream; ctx: AudioContext | null; source: AudioNode | null; node: AudioWorkletNode | null; unlisten: (() => void)[] };

export function createRecorder(ports: RecorderPorts): StoryRecorderHandle {
  /** Bumped by every start, discard and release: an answer that arrives for an older generation is released at once (path 8). */
  let gen = 0;
  let live: Live | null = null;
  let blocks: Int16Array[] = [];
  let samples = 0, peak = 0, clipped = 0, rate = 0, device: string | null = null;
  let recording = false;
  const limitMs = Math.max(1, Math.floor(ports.maxMs ?? RECORDER_LIMITS.maxMs));

  /** THE release of the microphone: every track stopped, nodes disconnected, the context closed, the page listeners removed. */
  const releaseMic = () => {
    const l = live;
    live = null;
    if (!l) return;
    for (const off of l.unlisten) { try { off(); } catch { /* listener already gone */ } }
    for (const t of l.stream.getTracks()) { try { t.stop(); } catch { /* a track that cannot be stopped is already ended */ } }
    try { l.node?.port?.close?.(); } catch { /* closed */ }
    try { if (l.node) l.node.port.onmessage = null; } catch { /* closed */ }
    try { l.node?.disconnect(); } catch { /* not connected */ }
    try { l.source?.disconnect(); } catch { /* not connected */ }
    if (l.ctx && l.ctx.state !== 'closed') l.ctx.close().catch(() => { /* closing a context that failed to start */ });
  };
  const take = (): Int16Array => {
    const all = new Int16Array(samples);
    let o = 0;
    for (const b of blocks) { all.set(b, o); o += b.length; }
    return all;
  };
  /** Ends a take that was recording: the microphone first, then the WAV (states 'stopped' or 'limit'). */
  const finish = (kind: 'stopped' | 'limit') => {
    releaseMic();
    if (!recording) return;
    recording = false;
    const wav = new Blob([encodeWav(take(), rate) as BlobPart], { type: 'audio/wav' });
    blocks = [];
    ports.onState({ kind, samples, rate, peakDbfs: peakDbfs(peak), clipped, wav });
  };
  /** Ends whatever is open: a take that was recording is kept (stopped); one still being set up is cancelled (idle). */
  const end = () => {
    if (recording) { finish('stopped'); return; }
    gen++;
    releaseMic();
    ports.onState({ kind: 'idle' });
  };
  const onBlock = (myGen: number, data: unknown) => {
    if (myGen !== gen || !recording || !isBlock(data)) return;
    const max = Math.round((limitMs * rate) / 1000);
    const room = max - samples;
    const block = data.samples.length > room ? data.samples.slice(0, Math.max(0, room)) : data.samples;
    blocks.push(block);
    samples += block.length;
    peak = Math.max(peak, data.peak);
    clipped += data.clipped;
    if (samples >= max) { finish('limit'); return; }
    ports.onState({ kind: 'recording', samples, rate, peakDbfs: peakDbfs(peak), clipped, device });
  };
  /** Paths 4 and 6: the page hidden, or a track that ended by itself, end the take (kept, as on stop). */
  const watch = (l: Live, myGen: number) => {
    const doc = (globalThis as { document?: Document }).document;
    const win = (globalThis as { window?: Window }).window;
    const hidden = () => { if (myGen === gen && (!doc || doc.visibilityState === 'hidden')) end(); };
    const pagehide = () => { if (myGen === gen) end(); };
    if (doc?.addEventListener) { doc.addEventListener('visibilitychange', hidden); l.unlisten.push(() => doc.removeEventListener('visibilitychange', hidden)); }
    if (win?.addEventListener) { win.addEventListener('pagehide', pagehide); l.unlisten.push(() => win.removeEventListener('pagehide', pagehide)); }
    for (const t of l.stream.getTracks()) {
      const ended = () => { if (myGen === gen) end(); };
      if (t.addEventListener) { t.addEventListener('ended', ended); l.unlisten.push(() => t.removeEventListener('ended', ended)); }
    }
  };

  return {
    async start() {
      // a new take: whatever was open is released first (never two microphones)
      const myGen = ++gen;
      releaseMic();
      recording = false; blocks = []; samples = 0; peak = 0; clipped = 0; rate = 0; device = null;
      ports.onState({ kind: 'asking' });
      let stream: MediaStream;
      try {
        stream = await ports.getUserMedia(RECORDER_CONSTRAINTS);
      } catch (e) {
        if (myGen !== gen) return;
        const name = (e as { name?: string })?.name ?? '';
        ports.onState({ kind: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' ? 'no-device' : 'unsupported' });
        return;
      }
      const l: Live = { stream, ctx: null, source: null, node: null, unlisten: [] };
      if (myGen !== gen) { releaseOrphan(l); return; } // path 8: released, discarded or restarted while the browser was asking
      live = l;
      watch(l, myGen);
      try {
        const ctx = ports.createContext();
        l.ctx = ctx;
        await ctx.audioWorklet.addModule(RECORDER_LIMITS.worklet);
        if (myGen !== gen || live !== l) { if (live === l) releaseMic(); else releaseOrphan(l); return; } // path 8 during set-up
        if (ctx.state === 'suspended') await ctx.resume();
        if (myGen !== gen || live !== l) { if (live === l) releaseMic(); else releaseOrphan(l); return; } // path 8 during set-up
        rate = ctx.sampleRate;
        const source = ctx.createMediaStreamSource(stream);
        l.source = source;
        const node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions: { blockSamples: RECORDER_LIMITS.blockSamples } });
        l.node = node;
        node.port.onmessage = (ev: MessageEvent) => onBlock(myGen, ev.data);
        source.connect(node); // never connected to the output: nothing is played back
        device = stream.getAudioTracks()[0]?.label || null;
        recording = true;
        ports.onState({ kind: 'recording', samples: 0, rate, peakDbfs: null, clipped: 0, device });
      } catch {
        if (live === l) releaseMic(); else releaseOrphan(l); // path 7
        if (myGen !== gen) return;
        recording = false;
        ports.onState({ kind: 'unsupported' });
      }
    },
    stop() { end(); }, // path 1 (before recording began: a late answer must not open the microphone)
    discard() { // path 2
      gen++;
      recording = false; blocks = []; samples = 0; peak = 0; clipped = 0;
      releaseMic();
      ports.onState({ kind: 'idle' });
    },
    release() { // path 3 (idempotent; no state is reported, the caller is going away)
      gen++;
      recording = false; blocks = [];
      releaseMic();
    },
    tracks: () => (live ? live.stream.getTracks() : []),
  };
}
/** A stream that is no longer the live one (a newer start replaced it while it was being set up): stopped all the same. */
function releaseOrphan(l: Live) {
  for (const off of l.unlisten) { try { off(); } catch { /* gone */ } }
  for (const t of l.stream.getTracks()) { try { t.stop(); } catch { /* ended */ } }
  if (l.ctx && l.ctx.state !== 'closed') l.ctx.close().catch(() => {});
}
