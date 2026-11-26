/** The live grade preview's document (W2; grade-verify C3). */
import { describe, it } from 'vitest';

describe('gradePreviewDoc (W2)', () => {
  it.todo('replaces the first color.grade of the clip with the previewed curves and params (same id); the input document is unchanged (deep-equal before and after)');
  it.todo('copies only the path to the clip: other sequences, tracks and clips are the same objects (===)');
  it.todo('adds a neutral grade in memory when the clip has none (after a time effect); curves null shows the grade without curves');
  it.todo('a caption, a sound clip or an unknown id gives the document itself');
  it.todo('the store: previewGrade(id, preview) calls player.setPictureDoc with it; previewGrade(id, null) shows viewDoc again; sound is not restarted');
});
