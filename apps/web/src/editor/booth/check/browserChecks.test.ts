/** Builder W2: the browser rows (verify C3 rows 1, 2, 7). */
import { describe, it } from 'vitest';

describe('browser rows (builder W2)', () => {
  it.todo('browser-gpu: a hardware adapter is ok with data.adapter ASCII and data.discrete true only for a discrete vendor; a fallback adapter is setup with code software_adapter; Intel integrated is ok with code integrated (L1 order "other")');
  it.todo('browser-gpu: no timing sample runs and gpu.html still shows what it showed (gpuProbe.ts reduced to the page, gpuProbe.logic.ts shared)');
  it.todo('browser-codecs: states only for H.264/HEVC/AV1 encode and decode and AAC encode; no speed claim');
  it.todo('mic: permissions.query state granted/prompt/denied → ok/setup/off; never calls getUserMedia; an unsupported query is unknown');
  it.todo('every row parses with core BoothCheckRowSchema and a row that exceeds its timeout is unknown');
});
