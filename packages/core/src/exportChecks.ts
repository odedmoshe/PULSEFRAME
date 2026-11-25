/**
 * Export checks (wave 7, track send): what the document says should be on screen, and the assembly of the report. Worker B's
 * file: signatures are the lead's contract, bodies are stubs until B lands them (send-decisions C10).
 * `moving` counts a frame only for a non-freeze video-asset media clip inside its own source length, on a track that is not
 * hidden, with no opaque full-frame clip above it by document geometry. Opacity keys and effects are not modelled: the picture
 * checks are a labelled HEURISTIC and every finding shows its numbers.
 */
import type { ProjectDocument } from './schema.ts';
import type { ExportChecks, PictureChecks, PictureExpectation, SoundChecks } from './sendContract.ts';

export const EXPORT_CHECKS_BUILT = false;
const notBuilt = (name: string): never => { throw new Error(`${name} is not built yet (send B)`); };

/** Frame intervals of the exported range [firstFrame, firstFrame + frames) where something is drawn and where a video plays. */
export function pictureExpectation(doc: ProjectDocument, sequenceId: string, firstFrame: number, frames: number): PictureExpectation { void doc; void sequenceId; void firstFrame; void frames; return notBuilt('pictureExpectation'); }
/** The report of one export: picture (route) + sound (mix); the quiet state lists what was looked for. */
export function assembleChecks(picture: PictureChecks, sound: SoundChecks): ExportChecks { void picture; void sound; return notBuilt('assembleChecks'); }
