/**
 * Pure timeline evaluator (SPEC §8): ProjectDocument + exact time -> RenderGraph.
 * No I/O, no DOM. Preview, agent frames and export all call this same function.
 *
 * Layer order: tracks bottom-to-top in sequence order; within the graph, later layers draw over earlier ones.
 * Source-frame selection rule (schema v1, speed 1, CFR sources whose first PTS is 0):
 *   sourceTime = clip.sourceIn + (t - clip.start);  sourceFrame = floor(sourceTime * assetFrameRate)
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument, TextStyle, Transform } from '@pulseframe/core';

export interface VideoLayer {
  kind: 'video';
  clipId: string;
  trackId: string;
  assetId: string;
  sourceTime: T.RationalTime;
  sourceFrameIndex: number;
  /** Mid-frame timestamp in seconds: safe to hand to float-second decoder APIs without boundary ambiguity. */
  sourceSeekSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
  transform: Transform;
}
/** A still picture. Same placement rules as video; one decoded image for the whole clip. */
export interface ImageLayer { kind: 'image'; clipId: string; trackId: string; assetId: string; sourceWidth: number; sourceHeight: number; transform: Transform }
export interface TextLayer { kind: 'text'; clipId: string; trackId: string; text: string; style: TextStyle; transform: Transform }
export type Layer = VideoLayer | ImageLayer | TextLayer;
export type PictureLayer = VideoLayer | ImageLayer;
export interface ActiveAudio { clipId: string; trackId: string; assetId: string; sourceTime: T.RationalTime; gain: number }
export interface RenderGraph {
  time: T.RationalTime;
  frameIndex: number;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
  audio: ActiveAudio[];
}

export function evaluate(doc: ProjectDocument, time: T.RationalTime, sequenceId = doc.mainSequenceId): RenderGraph {
  const seq = doc.sequences[sequenceId];
  if (!seq) throw new Error(`sequence ${sequenceId} not found`);
  const { width, height, frameRate, background } = doc.settings;
  const graph: RenderGraph = { time, frameIndex: T.frameIndexAt(time, frameRate), width, height, background, layers: [], audio: [] };
  for (const track of seq.tracks) {
    for (const clip of track.clips) {
      // half-open [start, start+duration)
      if (T.lt(time, clip.start) || !T.lt(time, T.add(clip.start, clip.duration))) continue;
      if (clip.type === 'text') {
        if (!track.hidden) graph.layers.push({ kind: 'text', clipId: clip.id, trackId: track.id, text: clip.text, style: clip.style, transform: clip.transform });
        continue;
      }
      const asset = doc.assets[clip.assetId];
      if (!asset) continue;
      const sourceTime = T.add(clip.sourceIn, T.sub(time, clip.start));
      if (track.kind === 'audio') {
        if (!track.muted && asset.audio) graph.audio.push({ clipId: clip.id, trackId: track.id, assetId: asset.id, sourceTime, gain: clip.gain });
      } else if (track.kind === 'video' && asset.kind === 'image' && asset.image && !track.hidden) {
        graph.layers.push({ kind: 'image', clipId: clip.id, trackId: track.id, assetId: asset.id, sourceWidth: asset.image.width, sourceHeight: asset.image.height, transform: clip.transform });
      } else if (track.kind === 'video' && asset.video && !track.hidden) {
        const rate = asset.video.frameRate;
        let idx = T.frameIndexAt(sourceTime, rate);
        if (asset.video.frameCount !== null) idx = Math.min(idx, asset.video.frameCount - 1);
        graph.layers.push({
          kind: 'video', clipId: clip.id, trackId: track.id, assetId: asset.id, sourceTime, sourceFrameIndex: idx,
          sourceSeekSeconds: ((idx + 0.5) * rate.den) / rate.num,
          sourceWidth: asset.video.width, sourceHeight: asset.video.height, transform: clip.transform,
        });
      }
    }
  }
  return graph;
}

/** Everything active at a time, in readable form (agent sense `describe_moment`). */
export function describeMoment(doc: ProjectDocument, time: T.RationalTime) {
  const g = evaluate(doc, time);
  return {
    time: g.time,
    seconds: T.toSeconds(g.time),
    frameIndex: g.frameIndex,
    layers: g.layers.map((l) => (l.kind === 'video' ? { kind: l.kind, clipId: l.clipId, assetId: l.assetId, sourceFrameIndex: l.sourceFrameIndex, sourceTime: l.sourceTime } : l.kind === 'image' ? { kind: l.kind, clipId: l.clipId, assetId: l.assetId } : { kind: l.kind, clipId: l.clipId, text: l.text })),
    audio: g.audio,
  };
}
