/**
 * WebAudio realisation of one planned audio clip (packages/engine/src/audio.ts), shared by preview and browser export.
 * chain: source(s) -> clip gain -> [volume automation] -> fade envelope -> duck envelope -> left/right balance -> destination
 * Envelopes use exact linear ramps between the plan's points, so they match the server's reference mixer.
 */
import { envAt, panGains, type EnvPoint, type PlannedAudioClip } from '@pulseframe/engine';

function automate(param: AudioParam, env: EnvPoint[], sampleRate: number, timeOfLocalZero: number, fromLocal: number) {
  const t = (s: number) => timeOfLocalZero + s / sampleRate;
  param.setValueAtTime(envAt(env, fromLocal), Math.max(0, t(fromLocal)));
  for (const p of env) if (p.s > fromLocal) param.linearRampToValueAtTime(p.g, Math.max(0, t(p.s)));
}

/**
 * Build the chain for `clip` and return the node that sources connect to.
 * `timeOfLocalZero` is the context time at which clip-local sample 0 plays (may be in the past when starting mid-clip);
 * `fromLocal` is the first clip-local sample that will actually be heard.
 */
export function plannedClipInput(ctx: BaseAudioContext, clip: PlannedAudioClip, sampleRate: number, destination: AudioNode, timeOfLocalZero: number, fromLocal: number): GainNode {
  const input = ctx.createGain();
  // Mono sources are up-mixed to stereo here, so balance and the mix see two channels.
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  input.gain.value = clip.gain;
  const fade = ctx.createGain();
  const duck = ctx.createGain();
  automate(fade.gain, clip.fade, sampleRate, timeOfLocalZero, fromLocal);
  automate(duck.gain, clip.duck, sampleRate, timeOfLocalZero, fromLocal);
  if (clip.vol) {
    const vol = ctx.createGain();
    automate(vol.gain, clip.vol, sampleRate, timeOfLocalZero, fromLocal);
    input.connect(vol).connect(fade).connect(duck);
  } else input.connect(fade).connect(duck);
  if (clip.pan === 0) duck.connect(destination);
  else {
    const [gl, gr] = panGains(clip.pan);
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    const l = ctx.createGain(), r = ctx.createGain();
    l.gain.value = gl;
    r.gain.value = gr;
    duck.connect(split);
    split.connect(l, 0).connect(merge, 0, 0);
    split.connect(r, 1).connect(merge, 0, 1);
    merge.connect(destination);
  }
  return input;
}
