/**
 * The runtime of «מה יש בקליפ» (wave 8 `understand`; contract.ts UnderstandRuntime, rules in contract.ts's header). LEAD PRE-PASS:
 * `createUnderstandRuntime(deps)` is what index.ts calls; it returns the not-built runtime until W2 builds it. BUILDER W2 (opus) owns
 * this file and its siblings job.ts, shots.ts, keyframes.ts, describer.ts, testDescriber.ts, settings.ts:
 * - settings in <dataDir>/understand.json (core UNDERSTAND_SETTINGS_FILE; backup.ts copies it every time), defaults
 *   DEFAULT_UNDERSTAND_SETTINGS; the describer's state from deps.providers (resolve + the merged model table: vision rows, or a local
 *   preset the owner marked `seeing`);
 * - auto-run on import (decision 4): subscribe to store.events 'revision' (ops holding import_asset) in this constructor; a project
 *   with an open job is JOINED (the work list is computed), never a second job;
 * - creating the runtime opens no process and no file except the tables (notesDb.ensureNotesTables).
 */
import { notBuiltUnderstandRuntime, type UnderstandDeps, type UnderstandRuntime } from './contract.ts';
import { ensureNotesTables } from './notesDb.ts';

export function createUnderstandRuntime(deps: UnderstandDeps): UnderstandRuntime {
  ensureNotesTables(deps.store.db);
  return notBuiltUnderstandRuntime;
}
