/**
 * TEST FIXTURE (tests of apps/server/src/assistant only). A project with every kind of private detail planted where a
 * careless summary would pick it up: a person with a birth date and a word choice, a capture date, an event named after
 * the child, a file name, a transcript word, a GPS-like string in the file's folder path, a title, a marker label and a
 * track named after the child. The summary tests search the serialized summary (and the exact request bytes) for each.
 */
import * as T from '@pulseframe/time';
import type { Store } from '../store.ts';

export const R = { num: 30, den: 1 };
export const f = (n: number) => T.frameTime(n, R);
export const PLANTED = {
  birthDate: '2019-03-04',
  /** The word choice 'f' is a single letter; its effect is the word «בת», which appears in no other planted string. */
  formWord: 'בת',
  captureDate: '2023-06-01',
  eventName: 'יום הולדת 5 של נועה',
  fileName: 'נועה_גן.mp4',
  transcriptWord: 'סבתאשושנה',
  gps: '32.0853,34.7818',
  personName: 'נועה',
  title: 'מזל טוב גדול',
  markerLabel: 'הנאום של סבא',
  trackName: 'הסרטים של נועה',
} as const;
export const PLANTED_PRIVATE = [PLANTED.birthDate, PLANTED.captureDate, PLANTED.eventName, PLANTED.fileName, PLANTED.transcriptWord, PLANTED.gps, PLANTED.formWord] as const;

const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;

export function plantedProject(store: Store) {
  const pid = store.createProject({ name: 'p', width: 640, height: 360, frameRate: R }).doc.id;
  const video = { kind: 'video' as const, name: PLANTED.fileName, contentHash: hash(1), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1),
    video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
    provenance: { origin: 'upload' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'user:local', upload: { via: 'folder' as const, jobId: 'job_fixture', relativePath: `DCIM/${PLANTED.gps}/${PLANTED.fileName}` } } };
  const song = { kind: 'audio' as const, name: 'שיר_של_נועה.mp3', contentHash: hash(2), byteSize: 500, container: 'mp3', mimeType: 'audio/mpeg', duration: T.rt(30, 1),
    audio: { sampleRate: 48000, channels: 2, codec: 'mp3' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' } };
  const imp = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: song } }] });
  const [videoId, songId] = imp.results.map((x) => x.output!.assetId as string) as [string, string];
  store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [
    { op: 'attach_analysis', args: { assetId: songId, kind: 'beats', method: 'fixture', params: {}, createdAt: '2026-11-15T00:00:00Z', times: [T.rt(0, 1), T.rt(1, 2), T.rt(1, 1)], bpm: 120, confidence: 0.9 } },
  ] });
  const r = store.commit({ projectId: pid, actor: 'user:local', ops: [
    { op: 'set_asset_capture', args: { assetId: videoId, capture: { at: `${PLANTED.captureDate}T10:00:00` } } },
    { op: 'add_person', args: { name: PLANTED.personName, birthDate: PLANTED.birthDate, form: 'f' } },
    { op: 'add_event', args: { assetIds: [videoId], name: PLANTED.eventName } },
    { op: 'set_transcript', args: { assetId: videoId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(2, 1), text: `שלום ${PLANTED.transcriptWord}` }] } },
    { op: 'add_track', args: { kind: 'video', name: PLANTED.trackName } },
    { op: 'add_clip', args: { assetId: videoId, start: f(0) } },
    { op: 'add_clip', args: { assetId: songId, start: f(0) } },
    { op: 'add_text', args: { text: PLANTED.title, start: f(30), duration: f(60) } },
    { op: 'add_marker', args: { time: f(15), label: PLANTED.markerLabel } },
  ] });
  const doc = store.getProject(pid).doc;
  const personId = Object.keys(doc.people ?? {})[0]!;
  const clipIds = Object.values(doc.sequences[doc.mainSequenceId]!.tracks).flatMap((t) => t.clips.map((c) => c.id));
  return { pid, videoId, songId, personId, clipIds, revision: r.revision };
}
