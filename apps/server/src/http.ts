import type { BackupScheduler } from './backup.ts';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { MOMENTS_JOB_TYPE, StartMomentsBodySchema, TRACKING_JOB_TYPE, TrackRunBody, COLOR_LOOKS, TEXT_PRESETS, SPEED_CURVES, MOTION_PRESETS, CAPTION_LOOKS, LAYOUTS, ELEMENTS, findFillers, timeOriginSeconds, transcriptFor, skippedClips, timingCoverage, untimedCopyRefusal, describeOps, projectVariant, RationalTimeSchema, serializeAss, serializeSrt, serializeVtt, describeRecipes, FORMAT_PROFILES, CAPTION_PRESETS, CLIP_MOTIONS, describeAudioCatalog, describeCatalog, FONT_CATALOG, cutOps, sourceRangesToTimeline, summarize, timeline, transcriptView, type Analysis, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, captionCues } from '@pulseframe/engine';
import { measureLoudness, mixToRaw, normalisationGain } from './audiomix.ts';
import type { Auth, Principal, Scope } from './auth.ts';
import { NarrationBody, NarrationScriptBody, Speech, TranscribeBody } from './speech.ts';
import { SPEECH_ENGINE_JOB_TYPE } from './speechEngine.ts';
import type { Capabilities } from './capabilities.ts';
import type { Config } from './config.ts';
import type { DerivativeKind, Derivatives } from './derive.ts';
import type { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { ingestUpload } from './ingest.ts';
import { BEAT_MAX_SECONDS, BEAT_TOTAL_MAX_SECONDS, detectBeatsOfFile, detectScenes, detectSilences, heavy } from './analysis.ts';
import { makeSfx, SFX, sfxPreview } from './sfx.ts';
import { canRasteriseSvg, makeElement } from './elements.ts';
import { applyTransaction, beatNumbers, ownSceneCuts, birthdayHints, findClip, isBuiltinMusic, isKnownGrid, isRealWallDate, listMusicStyles, OpError, PACKS, suggestPacks, summarizePack, WALL_DATE, type Asset, type OpCall, TemplateBodySchema, TemplateRegenerateBodySchema, FindShortsBodySchema, SHORTS_MEASUREMENT_KIND, sequenceList, shortsRefusal, MulticamSyncBody, multicamGroupOf, MULTICAM_REFUSALS, MULTICAM_SYNC_KIND, TakeRequestSchema } from '@pulseframe/core';
import { addMusic, MusicBody, musicPreviewAnswer, musicQueue, registerMusicOptions } from './music.ts';
import { instrumentsError } from './instruments/contract.ts';
import { markKitHeard } from './instruments/heard.ts';
import { listMusicKits } from './instruments/routes.ts';
import { onThisDayFor, readMissingCaptures } from './lifeline.ts';
import { preflight } from './preflight.ts';
import { collectGarbage, deleteProject, assertStorageRoom, storageReport } from './storage.ts';
import { importArchive, planArchive, writeArchive } from './archive.ts';
import { pipeline } from 'node:stream/promises';
import { applyRecipe, planRecipeFor, regenerateRecipe } from './recipes.ts';
import { applyTemplateFor, listTemplates, planTemplateFor, probeElements, regenerateTemplateFor, templateCatalog } from './templates.ts';
import { assertMayExportStill, outputDoc } from './export.ts';
import { envelopeDerivative, multicamView, runMulticamSyncJob, setMulticamDerivatives, syncMulticam } from './multicamSync.ts';
import { applyShorts, cachedShortCandidates, findShortCandidates, planReframeFor, planShortsFor, shortsApiError, withShortsErrors } from './shorts.ts';
import { registerBrowserExportRoutes } from './browser-export.ts';
import { buildOpenApi } from './openapi.ts';
import { cancelTrackingJob, motionTrackView, startTrackingJob } from './tracking.ts';
import { cameraMotionView, cancelStabiliseJob, startStabiliseJob } from './stabilise.ts';
import { pearlsView } from './pearls.ts';
import { audienceChangesFor } from './audiences/routes.ts';
import { deriveLessonFor } from './lessons/routes.ts';
import { applyMusicFitFor, markJoinHeardFor, musicJoinPreviewFor, planMusicFitFor, refuseHeardByAgent } from './musicfit/routes.ts';
import { MusicFitApplyRequestSchema, MusicFitPlanRequestSchema } from '@pulseframe/core';
import { STABILISE_JOB_TYPE, StabiliseRunBodySchema } from '@pulseframe/core';
import type { MusicKit } from '@pulseframe/core';
import { cancelMomentsJob, momentsLaneOf, startMomentsJob } from './moments.ts';
import { cancelStillsJob, readSharpFrames, startStillsJob, stillsReady, withStillsErrors } from './stills.ts';
import { FindSharpBodySchema, ReadSharpQuerySchema, STILLS_JOB_TYPE } from '@pulseframe/core';
import type { Presence } from './presence.ts';
import { ApiError, revisionWithChanges, type JobRow, type RevisionEvent, type Store } from './store.ts';
import { blobPresent, logMissingMedia, missingAssets, missingMediaError } from './mediaPresence.ts';
import { measureVoiceCheck, VoiceMeasureBody } from './voiceClean.ts';
import { ColourMatchBody, matchColour } from './colourMatch.ts';
import { ClipLoudnessBody, measureClipLoudness } from './clipLoudness.ts';
import { ApplyModeSchema, RunSourceSchema, type RunRequest } from './aiContracts.ts';
import { assertMayTakeRendered, forPrincipal, mayHoldPeople, peopleAccess, peopleNote, readingAs, scrubPeople, withoutFamily } from './peoplePrivacy.ts';
import { assertMayHandleImportJob, decodeUploadHeader, IMPORT_JOB_TYPE, type DropDoor, type ImportQueue } from './importContracts.ts';
import { declaredLength, registerImportRoutes } from './importRoutes.ts';
import { registerRenderCacheRoutes, type RenderCacheService } from './renderCacheRoutes.ts';
import { registerCraftRoutes } from './craft/routes.ts';
import { peopleSuggestions } from './lifeline.ts';
import { takeFor } from './perform.ts';
import { ASSISTANT_JOB_TYPE, AssistantConfigBodySchema, AssistantKeyBodySchema, AssistantRequestBodySchema } from '@pulseframe/core';
import { isOwnerSession, type AssistantDeps } from './assistant/contract.ts';
import { actsAsOwner, AutonomySettings, isOwnerFloor, ownerKeeps, registerAutonomyRoutes } from './autonomy.ts';
import { assistantCancelRefusal, createAssistantHandlers, type AssistantJobControls } from './assistant/routes.ts';
import { assertMayReadProposal, assertMayReleaseBudget, assistantJobStub, mayReadProposal, proposalsFor } from './assistant/visibility.ts';
import { libraryOwner } from './library/contract.ts';
import { registerLibraryRoutes } from './library/routes.ts';
import { notBuiltRuntime, SEARCH_INDEX_JOB_TYPE, type SearchRuntime } from './search/contract.ts';
import { registerSearchRoutes } from './search/routes.ts';
import { registerBoothRoutes } from './booth/routes.ts';
import { notBuiltPictureModels, type PictureModelsRuntime } from './picmodels/contract.ts';
import { registerPicmodelsRoutes } from './picmodels/routes.ts';
import { registerOwnTemplateRoutes } from './ownTemplates.ts';
import { registerAgentRoutes } from './agent/routes.ts';
import { notBuiltAgentService, type AgentRunService } from './agent/loop.ts';
import { registerMadeRoutes } from './made/routes.ts';
import { registerSourcesRoutes } from './sources/routes.ts';
import { notBuiltSourcesRuntime, type SourcesRuntime } from './sources/contract.ts';
import { SOURCE_JOB_TYPE } from '@pulseframe/core';
import type { MadeRunner } from './made/contract.ts';
import type { RenderHost } from '@pulseframe/renderer';

const TxBody = z
  .object({
    requestId: z.string().max(128).optional(),
    expectedRevision: z.number().int().nonnegative().optional().describe('Strict: reject unless this is the current revision'),
    baseRevision: z.number().int().nonnegative().optional().describe('Revision the caller last saw; the edit is rebased if nothing it depends on changed since'),
    dependsOn: z.array(z.string()).max(200).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
    label: z.string().max(200).optional(),
    ops: z.array(z.object({ op: z.string(), args: z.unknown() }).strict()).min(1).max(200),
  })
  .strict();
const NewProject = z.object({ name: z.string().min(1).max(200), width: z.number().int().min(16).max(8192).optional(), height: z.number().int().min(16).max(8192).optional(), frameRate: z.object({ num: z.number().int().positive(), den: z.number().int().positive() }).optional() }).strict();

type Env = { Variables: { principal: Principal } };
/** Public job shape, identical for REST and MCP. Snapshots and resolved graphs stay server-side. */
export const jobView = ({ input, ...j }: JobRow) => ({ ...j, revision: input.revision ?? input.projectRevision, ...(j.type === 'export' ? { options: input.manifest?.options, estimate: input.manifest?.estimate, warnings: input.warnings ?? [], retryOf: input.retryOf ?? null } : {}), ...(j.type === 'capability' ? { capabilityId: input.capabilityId, capabilityVersion: input.capabilityVersion, graphDigest: input.graphDigest, params: input.params } : {}) });
/**
 * A job as `p` may read it, for REST (GET /jobs/:jobId), MCP (get_job) and the event stream alike: jobView, except that a
 * language-assistant job is whole only for the owner's own session; anyone else reads its id, project, type, status and times
 * (assistant/visibility.ts, the one place that decides it).
 */
export const jobViewFor = (p: Principal, j: JobRow) => assistantJobStub(p, j) ?? jobView(j);

/** The body of a capability run, the same for REST (POST …/runs) and MCP (run_capability). ADR-0017 adds source, apply and confirmLongRun. */
export const RunBody = z
  .object({
    params: z.record(z.string(), z.unknown()).default({}),
    idempotencyKey: z.string().min(1).max(128).optional(),
    attach: z.object({ start: RationalTimeSchema, duration: RationalTimeSchema.optional(), trackId: z.string().optional() }).strict().optional().describe('Place the primary output on the timeline when the job finishes, if nothing it depends on changed meanwhile'),
    dependsOn: z.array(z.string()).max(100).optional().describe('Entity ids the placement depends on; a change to any of them turns the placement into a proposal'),
    source: RunSourceSchema.optional().describe('What the tool reads: {clipId} (the exact source span of a timeline clip) or {assetId, range?: {firstFrame, frameCount}} (a library file, optionally a frame range of it)'),
    apply: ApplyModeSchema.optional().describe('Where the result goes: library (default; the media library only), replace-clip (in place of the source clip\'s file, when nothing it depends on changed), new-track (a new clip on a new track)'),
    confirmLongRun: z.boolean().optional().describe('Required (true) when the estimate says needsConfirm: a run measured to take longer than PF_AI_CONFIRM_MINUTES'),
  })
  .strict();
/** One RunRequest from a REST or MCP run body: both surfaces hand the capability service exactly the same request. */
export const runRequestOf = (projectId: string, capabilityId: string, b: z.input<typeof RunBody>, p: Principal): RunRequest => ({
  projectId, capabilityId, params: b.params ?? {}, actor: p.actor, principal: p,
  ...(b.idempotencyKey !== undefined ? { idempotencyKey: b.idempotencyKey } : {}), ...(b.attach !== undefined ? { attach: b.attach } : {}), ...(b.dependsOn !== undefined ? { dependsOn: b.dependsOn } : {}),
  ...(b.source !== undefined ? { source: b.source } : {}), ...(b.apply !== undefined ? { apply: b.apply } : {}), ...(b.confirmLongRun !== undefined ? { confirmLongRun: b.confirmLongRun } : {}),
});
/** The query of GET …/estimate (and the arguments of MCP estimate_capability): what the run would read, and its parameters. */
export const EstimateBody = z.object({
  params: z.record(z.string(), z.unknown()).default({}),
  source: RunSourceSchema.optional(),
}).strict();
/**
 * Ask the owner for a capability's model download (REST models/request and MCP request_model_download). Any credential that may
 * propose can ask; it creates a pending approval bound to the exact missing bytes and model hashes and starts no job. Only the
 * owner's decision (POST …/approvals/{id}/approve) starts the download.
 */
/**
 * Start a model download for the exact missing byte count (REST …/models/download and …/speech/models/:id/download, MCP
 * start_model_download): one authority. The owner's own session, or an agent the open server stamped (autonomy.ts, B4/D2);
 * pinned hashes and the disk margin are checked by the download itself in both modes.
 */
export async function startModelDownloadFor(svc: { capabilities: Capabilities; speech: Speech }, p: Principal, projectId: string, kind: 'capability' | 'speech', id: string, confirmBytes: number) {
  if (!actsAsOwner(p)) throw new ApiError(403, 'human_approval_required', 'model downloads must be started from the owner\'s own session, not by an agent credential');
  return kind === 'capability' ? svc.capabilities.startDownload(projectId, id, confirmBytes, p) : svc.speech.startDownload(projectId, id, confirmBytes, p.actor);
}
export async function requestModelDownload(capabilities: Capabilities, gov: Governance, p: Principal, projectId: string, capabilityId: string) {
  gov.assertMayAct(p, projectId, 'propose'); // asking for something is a proposal-level act: refused while paused or in Observe mode
  const info = (await capabilities.list()).capabilities.find((x) => x.id === capabilityId);
  if (!info) throw new ApiError(404, 'capability_not_found', 'capability not found');
  if (info.missingDownloadBytes === 0) throw new ApiError(409, 'models_already_ready', 'all model files for this capability are present and verified');
  return gov.requestApproval({ projectId, kind: 'model-download', requestedBy: p.actor, action: { capabilityId: info.id, bytes: info.missingDownloadBytes, models: info.models.map((m) => ({ path: m.path, sha256: m.sha256 })) } });
}
/** The translation review mark (ADR-0017): only the owner's own session may set it; an agent credential is refused. */
export const ReviewBody = z.object({ review: z.enum(['reviewed', 'needed']) }).strict();
export function reviewTranslation(gov: Governance, p: Principal, projectId: string, variantId: string, review: 'reviewed' | 'needed') {
  if (!actsAsOwner(p)) throw new ApiError(403, 'human_approval_required', 'only the project owner can mark a translation reviewed or not, from their own session', { variantId }, 'Tell the owner which phrases to read; they mark it in the editor.');
  return gov.commitAs(p, { projectId, allowInternal: true, label: review === 'reviewed' ? 'Translation reviewed' : 'Translation needs review', ops: [{ op: 'review_translation', args: { variantId, review, at: new Date().toISOString() } }] });
}
const ImportBody = z.object({ id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/), title: z.string().min(1).max(120), graph: z.unknown() }).strict();

/**
 * Content security policy of the app's pages: same-origin code only, no inline or blob: scripts, no plugins, no framing. Style attributes set from code are allowed by the browser without 'unsafe-inline'.
 * `worker-src 'self' blob:` (wave 8 motioncode, gate G1): mediabunny 1.66 decodes the alpha of a VP8/VP9 WebM in a pool of workers it makes from a blob: URL
 * (media-sink.js ColorAlphaMerger), with no hook to self-host it; under `worker-src 'self'` a transparent video failed to draw in the preview and in
 * render_frame (made-g1.ts, measured). What it opens: script already running under `script-src 'self'` can run a string as worker code (no DOM, the same
 * connect-src 'self'). script-src keeps no blob:; proof:phase5 asserts worker-src is exactly 'self' blob:.
 */
export const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
/** Policy of every non-page response (JSON, media, exports): nothing may load or run if it is ever opened as a document. */
export const DATA_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

/** Services wired by the server (index.ts) that tests may leave out: the import queue and the phone drop (ADR-0023), the render cache (ADR-0024). */
export interface AppExtras { /** The server mode (autonomy.ts); absent in unit tests that build an app by hand (then the config's mode, read-only). */ autonomy?: AutonomySettings; imports?: ImportQueue; door?: DropDoor | null; renderCache?: RenderCacheService; /** The command bar's assistant (ADR-0027): installed adapters (none in wave 1) and the owner's endpoint. */ assistant?: AssistantDeps; /** picture search (wave 7 search track; search/runtime.ts): absent = the not-built runtime */ search?: SearchRuntime; /** the local picture-model runtime and eyes (wave 8 picmodels; picmodels/runtime.ts): absent = the not-built runtime */ pictureModels?: PictureModelsRuntime; /** TEST only (wave 7 instruments proof): a labelled synthetic kit list in place of MUSIC_KITS, never from the environment */ musicKits?: readonly MusicKit[]; /** The render host whose identity the export uses (wave 8 booth: self-check row export-gpu); absent in test apps without one */ renderHost?: RenderHost; /** «קליפ מקוד» (wave 8 motioncode): the render runner (made/contract.ts MadeRunner, W1); absent = 501 made_not_built */ made?: MadeRunner; /** «מאגר» (wave 8 sources): the runtime (sources/contract.ts SourcesRuntime, W2); absent = 501 sources_not_built */ sources?: SourcesRuntime }
export function createApp(cfg: Config, store: Store, auth: Auth, exporter: Exporter, capabilities: Capabilities, derivatives: Derivatives, presence: Presence, mcp: (req: Request) => Promise<Response>, governance?: Governance, backup?: BackupScheduler, speechService?: Speech, extras: AppExtras = {}) {
  setMeasurementExporter(exporter); // colour-match jobs render stills, also when they are recovered after a restart
  const gov = governance ?? new Governance(store);
  const speech = speechService ?? new Speech(store, cfg);
  const app = new Hono<Env>();
  const body = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error), { issues: parsed.error.issues });
    return parsed.data;
  };
  const need = (c: Context<Env>, scope: Scope) => { auth.require(c.var.principal, scope); return c.var.principal; };
  const autonomy = extras.autonomy ?? new AutonomySettings(cfg.dataDir, { mode: cfg.mode, modeFromEnv: true });
  // Templates with graphic elements are available only where ffmpeg can draw SVG: ask once now, so catalog() knows (ADR-0016).
  void probeElements();

  app.onError((e, c) => {
    if (e instanceof ApiError) { if (e.status === 429 && typeof e.details.retryAfterSeconds === 'number') c.header('Retry-After', String(e.details.retryAfterSeconds)); return c.json(e.toJSON(), e.status as any); }
    // The client went away while sending its request body (e.g. the render worker was stopped by a cancel). Not a server fault.
    if ((e as { code?: string }).code === 'ECONNRESET') return c.json({ error: { code: 'client_disconnected', message: 'the client closed the connection before the request was complete' } }, 400);
    console.error(e);
    return c.json({ error: { code: 'internal_error', message: 'unexpected server error' } }, 500);
  });
  app.use('*', async (c, next) => {
    auth.checkHost(c.req.raw);
    const origin = c.req.header('origin');
    if (origin && auth.originAllowed(c.req.raw)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Vary', 'Origin');
      if (c.req.method === 'OPTIONS') {
        c.header('Access-Control-Allow-Headers', 'content-type, authorization, x-filename, x-pf-via, x-pf-relative-path, x-pf-last-modified, x-pf-batch'); // x-pf-*: the import queue's upload headers (ADR-0023)
        c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        return c.body(null, 204);
      }
    }
    // Set before and after the handler: handlers that return their own Response (stored files, streams) would otherwise
    // go out without any of these — which is how media responses used to lack even nosniff.
    const secure = () => {
      const p = new URL(c.req.url).pathname;
      const h = c.res.headers;
      h.set('X-Content-Type-Options', 'nosniff');
      h.set('Referrer-Policy', 'no-referrer');
      h.set('X-Frame-Options', 'DENY');
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      h.set('Cross-Origin-Resource-Policy', 'same-site');
      // API, MCP and stored files are never documents: if one is opened as a page it may load and run nothing.
      // The app's own pages get a policy that allows only this origin's scripts, styles, fonts and media.
      h.set('Content-Security-Policy', p.startsWith('/api/') || p === '/mcp' || p.startsWith('/mcp/') ? DATA_CSP : APP_CSP);
    };
    await next();
    try { secure(); } catch { c.res = new Response(c.res.body, c.res); secure(); } // a Response with immutable headers is re-wrapped
  });

  // ----- render worker routes: single-purpose token, no user credentials -----
  const session = (token: string) => {
    const s = exporter.sessions.get(token);
    if (!s) throw new ApiError(404, 'render_session_not_found', 'unknown render session');
    return s;
  };
  /**
   * A stored file, whole or by range. A file that is not there is an expected state, not a fault: `missing` gives the typed
   * answer (404), and no stack is logged. Before, statSync threw ENOENT here and the client got 500 internal_error.
   */
  const sendBlob = (c: Context, file: string, mime: string, missing: () => ApiError, downloadName?: string) => {
    let size: number;
    try { size = fs.statSync(file).size; } catch (e) { if ((e as { code?: string }).code === 'ENOENT' || (e as { code?: string }).code === 'ENOTDIR') throw missing(); throw e; }
    const range = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('range') ?? '');
    const headers: Record<string, string> = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
    if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName}"`;
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
      if (start > end) return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as any, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)) as any, { headers: { ...headers, 'Content-Length': String(size) } });
  };
  /** An asset's stored file (editor preview and render worker alike): 404 missing_media when it is gone or no longer its imported size. */
  const sendAsset = (c: Context, a: Asset, where: string) => {
    const missing = () => { logMissingMedia(a.id, where); return missingMediaError(a.id); };
    if (!blobPresent(store, a)) throw missing();
    return sendBlob(c, store.blobPath(a.contentHash), a.mimeType, missing);
  };
  const fileMissing = (code: string, what: string) => () => new ApiError(404, code, `${what} is no longer stored on this computer`, {}, 'Make it again (run the export or the job once more).');
  app.get('/api/v1/render/:token/snapshot', (c) => { const s = session(c.req.param('token')); return c.json({ doc: s.doc, revision: s.revision, frameCount: s.totalFrames, firstFrame: s.firstFrame, outWidth: s.outWidth, outHeight: s.outHeight, ...(s.runs ? { runs: s.runs.map((r) => [r.first, r.count]) } : {}) }); });
  app.get('/api/v1/render/:token/assets/:assetId', (c) => {
    const a = session(c.req.param('token')).doc.assets[c.req.param('assetId')];
    if (!a) throw new ApiError(404, 'asset_not_found', 'asset not in snapshot');
    return sendAsset(c, a, 'render worker');
  });
  app.post('/api/v1/render/:token/frames', async (c) => {
    await exporter.acceptFrames(c.req.param('token'), Number(c.req.query('first')), new Uint8Array(await c.req.arrayBuffer()));
    return c.json({ ok: true });
  });

  // ----- session + auth -----
  app.get('/api/v1/session', (c) => {
    // A browser that already holds the owner session (reloads, other pages of the app) needs no key again.
    if (!auth.sessionOf(c.req.raw)) c.header('Set-Cookie', auth.issueSession(c.req.raw));
    return c.json({ actor: 'user:local', scopes: ['observe', 'edit'] });
  });
  app.all('/mcp', (c) => mcp(c.req.raw));
  app.use('/api/v1/*', async (c, next) => {
    const principal = auth.authenticate(c.req.raw);
    c.set('principal', principal);
    // People (ADR-0021, people section; peoplePrivacy.ts): everything this request reads from the store is what its credential
    // may read. For a credential without the people scope, the JSON answer is also passed through the net that takes birth
    // dates out of rows that were not read as a document (proposals, and whatever a later route returns).
    await readingAs(principal, next);
    if (peopleAccess(principal) === 'full' || !(c.res.headers.get('content-type') ?? '').startsWith('application/json')) return;
    const text = await c.res.clone().text();
    if (!mayHoldPeople(text)) return;
    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    const status = c.res.status;
    c.res = undefined;
    c.res = new Response(JSON.stringify(scrubPeople(JSON.parse(text))), { status, headers });
  });
  // Grants limited to certain projects cannot even read others.
  app.use('/api/v1/projects/:id/*', async (c, next) => { gov.assertMayAct(c.var.principal, c.req.param('id'), 'observe'); await next(); });
  app.use('/api/v1/projects/:id', async (c, next) => { gov.assertMayAct(c.var.principal, c.req.param('id'), 'observe'); await next(); });
  // Guards must be registered before the routes they protect (Hono applies middleware in registration order).
  // Jobs are reached by id, not by project path: a project-limited grant must not see or touch other projects' jobs.
  // One exception, for the owner's own session only: a reservation outlives its job when the job's project is deleted (the
  // ledger row stays counted), so releasing it must not need the job row. Any other credential gets 404 as for every missing job.
  const jobScope = async (c: Context<Env>, next: () => Promise<void>) => {
    const jobId = c.req.param('jobId')!;
    const orphanRelease = c.req.method === 'POST' && c.req.path.endsWith('/budget/release') && actsAsOwner(c.var.principal) && gov.ledgerFor(jobId) !== null;
    if (!orphanRelease) gov.assertMayAct(c.var.principal, store.getJob(jobId).projectId, 'observe');
    await next();
  };
  app.use('/api/v1/jobs/:jobId', jobScope);
  app.use('/api/v1/jobs/:jobId/*', jobScope);
  // Starting any job is refused while agents are paused, whichever route creates it.
  app.use('/api/v1/projects/:id/exports/browser', async (c, next) => { gov.assertMayAct(c.var.principal, c.req.param('id'), 'job'); await next(); });


  // ----- discovery -----
  app.get('/api/v1/ops', (c) => { need(c, 'observe'); return c.json({ ops: describeOps() }); });
  app.get('/api/v1/openapi.json', (c) => { need(c, 'observe'); return c.json(buildOpenApi()); });
  app.get('/api/v1/whoami', (c) => c.json(c.var.principal));

  // ----- projects -----
  app.get('/api/v1/projects', (c) => { const p = need(c, 'observe'); const only = p.grant?.projectIds; return c.json({ projects: store.listProjects().filter((x) => !only || only.includes(x.id)) }); });
  app.post('/api/v1/projects', async (c) => { const who = need(c, 'edit'); if (who.grant?.projectIds) throw new ApiError(403, 'out_of_scope', 'this grant is limited to specific projects and cannot create new ones'); const p = store.createProject(await body(c, NewProject)); return c.json({ project: p.doc, revision: p.revision }, 201); });
  app.get('/api/v1/projects/:id', (c) => {
    need(c, 'observe');
    const rev = c.req.query('revision');
    // Both reads answer with what this credential may read about people (Store.getProject / Store.replay).
    const p = rev === undefined ? store.getProject(c.req.param('id')) : store.replay(c.req.param('id'), Number(rev));
    return c.json({ project: p.doc, revision: p.revision, ...peopleNote(c.var.principal, p.doc) });
  });
  app.post('/api/v1/projects/:id/delete', async (c) => { const p = need(c, 'observe'); const b = await body(c, z.object({ confirmName: z.string() }).strict()); return c.json(deleteProject(store, p, c.req.param('id'), b.confirmName)); });
  // Automatic backups: status for anyone who may observe; running one now is the owner's action (it writes outside the data directory).
  app.get('/api/v1/backup', (c) => { need(c, 'observe'); return c.json(backup?.status() ?? { enabled: false, everyHours: 0, keep: 0, lastAt: null, lastOk: null, lastError: null, nextAt: null, snapshots: 0, running: false }); });
  app.post('/api/v1/backup', async (c) => {
    if (!actsAsOwner(need(c, 'observe'))) throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session');
    if (!cfg.backupDir || !backup) throw new ApiError(409, 'backup_not_configured', 'no backup destination is configured; set PF_BACKUP_DIR and restart the server');
    await backup.runNow();
    const st = backup.status();
    return c.json(st, st.lastOk ? 200 : 500);
  });
  app.get('/api/v1/storage', (c) => { const p = need(c, 'observe'); const rep = storageReport(store, p); const { hashes: _h, ...unref } = rep.unreferenced; return c.json({ ...rep, unreferenced: unref }); });
  app.post('/api/v1/storage/gc', async (c) => { const p = need(c, 'observe'); const b = await body(c, z.object({ apply: z.boolean().optional() }).strict()); return c.json(collectGarbage(store, p, b.apply === true)); });
  app.get('/api/v1/projects/:id/archive', (c) => {
    const who = need(c, 'observe');
    // ?family=omit: the archive «בלי פרטי משפחה» (people left out, their fields made plain text). A credential without the
    // people scope gets the document as it may read it either way (names, no birth dates): planArchive reads through the store.
    const family = c.req.query('family') ?? 'keep';
    if (family !== 'keep' && family !== 'omit') throw new ApiError(400, 'invalid_request', 'family must be keep or omit', { family: family.slice(0, 16) });
    // ?library=strip «ארכיון לשיתוף» leaves restricted library files out; ?library=keep «ארכיון לעצמי» keeps them, owner's own session only
    // (wave 7 library track; archive.ts planArchive, worker B)
    const library = c.req.query('library');
    if (library !== undefined && library !== 'strip' && library !== 'keep') throw new ApiError(400, 'invalid_request', 'library must be strip or keep', { library: library.slice(0, 16) });
    if (library === 'keep') libraryOwner(who);
    const plan = planArchive(store, c.req.param('id'), { family, ...(library ? { library } : {}) });
    const name = plan.doc.name.replace(/[^\p{L}\p{N} _.-]+/gu, '_').slice(0, 60) || 'project';
    // «ארכיון לעצמי» says so in its name: it holds library files that may not be passed on (archive.ts planArchive().library)
    const suffix = plan.library === 'keep' ? '.private.pulseframe.tar' : '.pulseframe.tar';
    return new Response(Readable.toWeb(Readable.from(writeArchive(plan))) as ReadableStream, { headers: { 'content-type': 'application/x-tar', 'content-length': String(plan.bytes), 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}${suffix}` } });
  });
  // What the archive «בלי פרטי משפחה» would change, for the dialog before the download: titles whose words change inside them
  // (frozen at their first value) and titles whose people field has no words. The owner's own session only.
  app.get('/api/v1/projects/:id/archive/family-check', (c) => {
    if (!actsAsOwner(need(c, 'observe'))) throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session');
    const { varying, empty } = withoutFamily(store.wholeProject(c.req.param('id')).doc);
    return c.json({ varying, empty });
  });
  app.post('/api/v1/projects/import', async (c) => {
    const who = need(c, 'edit');
    if (who.grant?.projectIds) throw new ApiError(403, 'out_of_scope', 'this grant is limited to specific projects and cannot create new ones');
    gov.assertUnrestricted(who, 'import a project');
    if (!c.req.raw.body) throw new ApiError(400, 'empty_upload', 'request has no body');
    // As for uploads: refuse up front when the declared size cannot fit, and cut a body of unknown (or understated) size off at
    // the room left, not only at the archive size limit. Without the cut a chunked body could fill the disk past the ceiling.
    const room = assertStorageRoom(store, Number(c.req.header('content-length') ?? 0) || 1, 'import this project');
    const maxBytes = Math.min(cfg.maxUploadBytes * 4, room);
    const tmp = path.join(store.tmpDir, `imp_${Date.now()}_${Math.random().toString(36).slice(2)}.tar`);
    let size = 0;
    try {
      await pipeline(Readable.fromWeb(c.req.raw.body as any), async function* (src) { for await (const chunk of src) { size += chunk.length; if (size > maxBytes) throw new ApiError(413, 'upload_too_large', `archive exceeds ${maxBytes} bytes${maxBytes < cfg.maxUploadBytes * 4 ? ' (the room left under the storage ceiling)' : ''}`, { maxBytes }); yield chunk; } }, fs.createWriteStream(tmp, { mode: 0o600 }));
      const r = importArchive(store, tmp);
      for (const a of Object.values(r.doc.assets)) derivatives.ensure(a);
      return c.json({ project: { id: r.doc.id, name: r.doc.name }, revision: r.revision, blobsAdded: r.blobsAdded, blobsAlreadyPresent: r.blobsAlreadyPresent, notes: r.notes }, 201);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
  app.get('/api/v1/projects/:id/summary', (c) => { const who = need(c, 'observe'); const p = store.getProject(c.req.param('id')); return c.json({ revision: p.revision, ...summarize(p.doc), ...peopleNote(who, p.doc) }); });
  app.get('/api/v1/projects/:id/timeline', (c) => { need(c, 'observe'); const p = store.getProject(c.req.param('id')); return c.json({ revision: p.revision, ...timeline(p.doc) }); });
  app.get('/api/v1/projects/:id/transcripts/:assetId', (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const view = transcriptView(p.doc, c.req.param('assetId'));
    if (!view) throw new ApiError(404, 'not_found', 'this asset has no transcript');
    return c.json({ revision: p.revision, ...view });
  });
  app.get('/api/v1/projects/:id/captions', (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const out = exportCaptions(p.doc, c.req.query('trackId'), c.req.query('format') ?? 'srt', c.req.query('variant'), c.req.query('sequence'));
    return c.body(out.text, 200, { 'content-type': `${out.mime}; charset=utf-8`, 'content-disposition': `attachment; filename="captions.${out.format}"`, 'x-pulseframe-revision': String(p.revision), 'x-pulseframe-cues': String(out.cues) });
  });
  app.post('/api/v1/projects/:id/analysis/fillers', async (c) => { need(c, 'observe'); return c.json(findFillerWords(store, c.req.param('id'), await body(c, FillerBody))); });
  app.post('/api/v1/projects/:id/analysis/silences', async (c) => {
    const p = need(c, 'observe');
    const { background, ...b } = await body(c, SilenceBody.extend({ background: z.boolean().optional() }).strict());
    // background=true: a durable job (poll get job); the result is the same object, as the job's output. Use it for long recordings.
    if (background) { const j = startMeasurementJob(store, p, c.req.param('id'), 'silences', b); return c.json({ jobId: j.id, status: j.status }, 202); }
    return c.json(await findSilences(store, c.req.param('id'), b));
  });
  // voice cleanup (ADR-0013) and colour match (ADR-0014): read-only measurements that return candidate ops, in the pattern above
  app.post('/api/v1/projects/:id/analysis/voice', async (c) => {
    const p = need(c, 'observe');
    const { background, ...b } = await body(c, VoiceMeasureBody.extend({ background: z.boolean().optional() }).strict());
    if (background) { const j = startMeasurementJob(store, p, c.req.param('id'), 'voice', b); return c.json({ jobId: j.id, status: j.status }, 202); }
    return c.json(await measureVoiceCheck(store, c.req.param('id'), b));
  });
  app.post('/api/v1/projects/:id/analysis/colour-match', async (c) => {
    const p = need(c, 'observe');
    const { background, ...b } = await body(c, ColourMatchBody.extend({ background: z.boolean().optional() }).strict());
    if (background) { const j = startMeasurementJob(store, p, c.req.param('id'), 'colour', b); return c.json({ jobId: j.id, status: j.status }, 202); }
    return c.json(await matchColour(store, exporter, c.req.param('id'), b));
  });
  app.post('/api/v1/projects/:id/assets/:assetId/analyze', async (c) => {
    const p = need(c, 'edit');
    const { background, ...b } = await body(c, AnalyzeBody.extend({ background: z.boolean().optional() }).strict());
    if (background) { const j = startAnalysisJob(store, gov, p, c.req.param('id'), { assetId: c.req.param('assetId'), ...b }); return c.json({ jobId: j.id, status: j.status }, 202); }
    return c.json(await analyzeAsset(store, gov, p, c.req.param('id'), { assetId: c.req.param('assetId'), ...b }));
  });
  app.get('/api/v1/projects/:id/assets/:assetId/analysis', (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const view = analysisViewOf(p.doc, c.req.param('assetId'));
    if (!view) throw new ApiError(404, 'not_found', 'this asset has no analysis results');
    return c.json({ revision: p.revision, ...view });
  });
  // ----- motion tracking (ADR-0015): a durable job; its samples are attached by the internal op attach_motion_track -----
  app.post('/api/v1/projects/:id/motion-tracks/:motionTrackId/track', async (c) => {
    const p = need(c, 'edit');
    const b = await body(c, TrackRunBody);
    const j = startTrackingJob(store, gov, p, c.req.param('id'), c.req.param('motionTrackId'), b, { derivatives });
    return c.json({ jobId: j.id, status: j.status }, 202);
  });
  // ----- measured moments (wave 5 family film, ADR-0026): a durable, model-free job; attached by the internal op attach_moments -----
  app.post('/api/v1/projects/:id/moments', async (c) => {
    const p = need(c, 'edit');
    const b = await body(c, StartMomentsBodySchema);
    const r = startMomentsJob(store, gov, p, c.req.param('id'), b, { derivatives, lane: momentsLaneOf(exporter.lane) });
    return 'cached' in r ? c.json(r, 200) : c.json({ jobId: r.id, status: r.status }, 202);
  });
  // ----- «הפריים הכי חד» (wave 8 cover): a durable, model-free measurement of one stretch of one file; numbers only (stills.ts) -----
  app.post('/api/v1/projects/:id/stills', async (c) => {
    const p = need(c, 'edit');
    const b = await body(c, FindSharpBodySchema);
    await stillsReady(); // the cache check needs the ffmpeg build line (a first POST after start must not measure again)
    const r = withStillsErrors(() => startStillsJob(store, gov, p, c.req.param('id'), b, { derivatives, lane: momentsLaneOf(exporter.lane) }));
    return 'cached' in r ? c.json(r, 200) : c.json({ jobId: r.jobId, status: r.status }, 202);
  });
  app.get('/api/v1/projects/:id/stills', async (c) => {
    const p = need(c, 'observe');
    gov.assertMayAct(p, c.req.param('id'), 'observe');
    const q = ReadSharpQuerySchema.safeParse(c.req.query());
    if (!q.success) throw new ApiError(400, 'invalid_request', z.prettifyError(q.error), { issues: q.error.issues });
    await stillsReady(); // a first read right after start answers what is stored, not "nothing measured"
    return c.json(withStillsErrors(() => readSharpFrames(store, c.req.param('id'), q.data, { derivatives })));
  });
  app.get('/api/v1/projects/:id/motion-tracks/:motionTrackId', (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    return c.json(motionTrackView(p.doc, p.revision, c.req.param('motionTrackId')));
  });
  // ----- stabilisation (wave 7): a durable, model-free job; attach_camera_motion + set_clip_stabilise in one transaction (stabilise.ts) -----
  app.post('/api/v1/projects/:id/clips/:clipId/stabilise', async (c) => {
    const p = need(c, 'edit');
    const b = await body(c, StabiliseRunBodySchema);
    const j = startStabiliseJob(store, gov, p, c.req.param('id'), c.req.param('clipId'), b, { derivatives });
    return c.json({ jobId: j.id, status: j.status }, 202);
  });
  app.get('/api/v1/projects/:id/assets/:assetId/camera-motion', (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    return c.json(cameraMotionView(p.doc, p.revision, c.req.param('assetId')));
  });
  // ----- marked ranges «פנינים» (wave 7): read-only; the three ops reach REST through the registry like every op (pearls.ts) -----
  app.get('/api/v1/projects/:id/pearls', (c) => {
    const who = need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    return c.json(pearlsView(p.doc, p.revision, who, c.req.query('sequenceId') || undefined));
  });
  // ----- versions for an audience «גרסה לכל קהל» (wave 8; audiences/routes.ts): the change list, 501 audience_not_built until built -----
  app.get('/api/v1/projects/:id/variants/:variantId/audience', (c) => { need(c, 'observe'); return c.json(audienceChangesFor(store, c.req.param('id'), c.req.param('variantId'))); });
  // ----- «למדו אותי פעם אחת» (wave 8 teach; lessons/routes.ts): the lesson of one clip, the owner's own session only; 501 teach_not_built until built -----
  app.get('/api/v1/projects/:id/clips/:clipId/lesson', (c) => { const p = need(c, 'observe'); return c.json(deriveLessonFor(store, gov, p, c.req.param('id'), c.req.param('clipId'))); });
  const RecipeBody = z.object({ params: z.record(z.string(), z.unknown()).optional(), expectedRevision: z.number().int().optional() }).strict();
  app.post('/api/v1/projects/:id/recipes/:recipeId/plan', async (c) => { const p = need(c, 'observe'); store.getProject(c.req.param('id')); return c.json(await planRecipeFor(store, c.req.param('id'), c.req.param('recipeId'), (await body(c, RecipeBody)).params, gov, p)); });
  app.post('/api/v1/projects/:id/recipes/:recipeId/apply', async (c) => { const p = need(c, 'observe'); const b = await body(c, RecipeBody); return c.json(await applyRecipe(store, gov, p, c.req.param('id'), c.req.param('recipeId'), b.params, b.expectedRevision)); });
  // restoreRemoved: the explicit choice to make again what was deleted by hand (template and family film runs; ADR-0016 decision 6)
  const RecipeRegenerateBody = RecipeBody.extend({ restoreRemoved: z.boolean().optional() }).strict();
  app.post('/api/v1/projects/:id/recipe-runs/:runId/regenerate', async (c) => { const p = need(c, 'observe'); const b = await body(c, RecipeRegenerateBody); return c.json(await regenerateRecipe(store, gov, p, c.req.param('id'), c.req.param('runId'), b.params, { restoreRemoved: b.restoreRemoved }, b.expectedRevision)); });
  // Templates (ADR-0016): the gallery, a read-only plan, apply as one undoable step, regenerate keeping hand edits. Edit rights and
  // the propose-mode refusal are checked inside (templates.ts), so the refusal names the mode.
  app.get('/api/v1/templates', async (c) => { need(c, 'observe'); return c.json({ templates: await listTemplates() }); });
  app.post('/api/v1/projects/:id/templates/:templateId/plan', async (c) => { const p = need(c, 'observe'); const b = await body(c, TemplateBodySchema); return c.json(await planTemplateFor(store, gov, p, c.req.param('id'), c.req.param('templateId'), b.params)); });
  app.post('/api/v1/projects/:id/templates/:templateId/apply', async (c) => { const p = need(c, 'observe'); const b = await body(c, TemplateBodySchema); return c.json(await applyTemplateFor(store, gov, p, c.req.param('id'), c.req.param('templateId'), b.params, b.expectedRevision)); });
  app.post('/api/v1/projects/:id/template-runs/:runId/regenerate', async (c) => { const p = need(c, 'observe'); const b = await body(c, TemplateRegenerateBodySchema); return c.json(await regenerateTemplateFor(store, gov, p, c.req.param('id'), c.req.param('runId'), b.params, b.expectedRevision, { restoreRemoved: b.restoreRemoved })); });
  // ----- perform mode (ADR-0025): a take's raw taps, planned here and committed as ONE internal apply_take (dryRun: plan only) -----
  app.post('/api/v1/projects/:id/takes', async (c) => {
    // edit rights and the propose-mode refusal are checked inside (perform.ts), so the refusal names the mode
    const p = need(c, 'observe');
    return c.json(takeFor(store, gov, p, c.req.param('id'), await body(c, TakeRequestSchema)));
  });
  // ----- multicam (ADR-0020): sync a group by sound (edit; dryRun observe), the group view, a file's level envelope -----
  setMulticamDerivatives(derivatives); // the sync job and the envelope route store envelopes there (recovered jobs too)
  const mustGroup = (projectId: string, groupId: string) => {
    if (!multicamGroupOf(store.getProject(projectId).doc, groupId)) throw new ApiError(404, 'not_found', MULTICAM_REFUSALS.groupNotFound.message(groupId), { groupId }, MULTICAM_REFUSALS.groupNotFound.hint);
  };
  app.post('/api/v1/projects/:id/multicam/:groupId/sync', async (c) => {
    const b = await body(c, MulticamSyncBody);
    const p = need(c, b.dryRun ? 'observe' : 'edit');
    const projectId = c.req.param('id'), groupId = c.req.param('groupId');
    mustGroup(projectId, groupId);
    const r = await syncMulticam(store, gov, p, projectId, groupId, b);
    return 'jobId' in r ? c.json(r, 202) : c.json(r);
  });
  app.get('/api/v1/projects/:id/multicam/:groupId', (c) => { need(c, 'observe'); const projectId = c.req.param('id'), groupId = c.req.param('groupId'); mustGroup(projectId, groupId); return c.json(multicamView(store, projectId, groupId)); });
  app.post('/api/v1/projects/:id/assets/:assetId/derivatives/envelope', async (c) => {
    need(c, 'observe');
    const projectId = c.req.param('id'), assetId = c.req.param('assetId');
    if (!Object.hasOwn(store.getProject(projectId).doc.assets, assetId)) throw new ApiError(404, 'not_found', `asset ${assetId} not found`, { assetId });
    return c.json(await envelopeDerivative(store, projectId, assetId));
  });
  // ----- shorts (ADR-0018): sequences of the project, candidate moments, plan, make (one undoable step), reframe -----
  app.get('/api/v1/projects/:id/sequences', (c) => { need(c, 'observe'); const p = store.getProject(c.req.param('id')); return c.json({ revision: p.revision, sequences: sequenceList(p.doc) }); });
  app.post('/api/v1/projects/:id/shorts/candidates', async (c) => {
    const who = need(c, 'observe');
    const projectId = c.req.param('id');
    const b = await body(c, FindShortsBodySchema);
    const p = store.getProject(projectId); // 404 before anything else
    if (!Object.hasOwn(p.doc.assets, b.assetId)) throw shortsApiError(shortsRefusal('assetNotFound', { assetId: b.assetId }, b.assetId));
    const cached = withShortsErrors(() => cachedShortCandidates(store, projectId, b));
    if (cached) return c.json(cached);
    const j = startMeasurementJob(store, who, projectId, SHORTS_MEASUREMENT_KIND, b);
    return c.json({ jobId: j.id, status: j.status }, 202);
  });
  app.post('/api/v1/projects/:id/shorts/plan', async (c) => { need(c, 'observe'); const projectId = c.req.param('id'); store.getProject(projectId); const b = await c.req.json().catch(() => undefined); return c.json(await withShortsErrors(() => planShortsFor(store, projectId, b))); });
  app.post('/api/v1/projects/:id/shorts', async (c) => { const pr = need(c, 'edit'); const projectId = c.req.param('id'); store.getProject(projectId); const b = await c.req.json().catch(() => undefined); return c.json(await withShortsErrors(() => applyShorts(store, gov, pr, projectId, b))); });
  app.post('/api/v1/projects/:id/sequences/:sequenceId/reframe-plan', async (c) => {
    need(c, 'observe');
    const projectId = c.req.param('id');
    outputDoc(store.getProject(projectId).doc, { sequenceId: c.req.param('sequenceId') }); // 404 for an unknown sequence
    const b = await c.req.json().catch(() => undefined);
    return c.json(withShortsErrors(() => planReframeFor(store, projectId, c.req.param('sequenceId'), b)));
  });
  app.get('/api/v1/projects/:id/preflight', (c) => {
    const who = need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const cps = c.req.query('maxCharsPerSecond');
    return c.json({ ...preflight(exporter, p.doc, p.revision, { variantId: c.req.query('variant'), sequenceId: c.req.query('sequence'), ...(cps ? { maxCharsPerSecond: Number(cps) } : {}) }), ...peopleNote(who, p.doc) });
  });
  app.post('/api/v1/projects/:id/exports/batch', async (c) => {
    const pr = need(c, 'edit');
    return c.json(startExportBatch(store, gov, exporter, pr, c.req.param('id'), await c.req.json().catch(() => undefined)), 202);
  });
  app.post('/api/v1/projects/:id/analysis/loudness', async (c) => {
    const p = need(c, 'observe');
    const b = await c.req.json().catch(() => ({}));
    // { sequenceId } measures that sequence (a short) as it exports (ADR-0018); { variantId } that linked format or audience version
    // (wave 8 qc, verifier C2); both together the version of the short; absent = the main edit
    const t = loudnessTargetOf(b);
    if (t.sequenceId !== undefined || t.variantId !== undefined) outputDoc(store.getProject(c.req.param('id')).doc, t); // 404 before any job exists
    if (b && typeof b === 'object' && (b as { background?: unknown }).background === true) { const j = startMeasurementJob(store, p, c.req.param('id'), 'loudness', { ...t }); return c.json({ jobId: j.id, status: j.status }, 202); }
    return c.json(await programmeLoudness(store, c.req.param('id'), t));
  });
  // loudness of single clips (wave 7 send): read-only; the match is committed separately with match_clip_loudness and expectedRevision
  app.post('/api/v1/projects/:id/analysis/clip-loudness', async (c) => {
    const p = need(c, 'observe');
    const parsed = ClipLoudnessBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error));
    if (parsed.data.sequenceId !== undefined) outputDoc(store.getProject(c.req.param('id')).doc, { sequenceId: parsed.data.sequenceId }); // 404 before any job exists
    else store.getProject(c.req.param('id'));
    if (parsed.data.background === true) { const j = startMeasurementJob(store, p, c.req.param('id'), 'clip-loudness', parsed.data); return c.json({ jobId: j.id, status: j.status }, 202); }
    return c.json(await measureClipLoudness(store, c.req.param('id'), parsed.data));
  });
  app.get('/api/v1/projects/:id/history', (c) => { need(c, 'observe'); store.getProject(c.req.param('id')); return c.json({ events: store.eventsSince(c.req.param('id'), Number(c.req.query('since') ?? 0)) }); });

  // ----- edits: one command path for UI, REST and (via store.commit) MCP -----
  const commit = (dryRun: boolean) => async (c: Context<Env>) => {
    // Mode (observe / propose / edit), pause state and track/range limits are decided by governance, not by a coarse scope.
    const b = await body(c, TxBody);
    return c.json(gov.commitAs(c.var.principal, { ...b, projectId: c.req.param('id')!, dryRun }));
  };
  app.post('/api/v1/projects/:id/transactions', commit(false));
  app.post('/api/v1/projects/:id/operations', commit(false));
  app.post('/api/v1/projects/:id/operations/validate', commit(true));
  const UndoBody = z.object({ transactionId: z.string().optional() }).strict();
  for (const mode of ['undo', 'redo'] as const)
    app.post(`/api/v1/projects/:id/${mode}`, async (c) => {
      const p = need(c, 'edit');
      const parsed = UndoBody.safeParse((await c.req.json().catch(() => ({}))) ?? {});
      if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error), { issues: parsed.error.issues });
      const b = parsed.data;
      void p;
      return c.json(gov.undoAs(c.var.principal, c.req.param('id'), mode, b.transactionId));
    });

  // ----- revision events (SSE), with replay of missed revisions on (re)connect -----
  app.get('/api/v1/projects/:id/events', (c) => {
    need(c, 'observe');
    const projectId = c.req.param('id');
    const current = store.getProject(projectId).revision;
    const since = Number(c.req.query('since') ?? c.req.header('last-event-id') ?? current);
    // Events are written from whichever request committed, so each is reduced here for the credential that LISTENS: a revision,
    // job, proposal or presence event never carries a birth date to one without the people scope (peoplePrivacy.ts).
    const listener = c.var.principal;
    const seen = <X,>(e: X): X => forPrincipal(e, listener);
    // A live revision event carries the states its transaction left (Store.liveChanges), so the editor applies them instead of
    // reading the whole document again: only to a credential that may read every entity state whole (the people scope; the
    // owner's session). Others get the event as before and read the document through the store, as their credential may.
    const whole = peopleAccess(listener) === 'full';
    return streamSSE(c, async (stream) => {
      let last = since;
      const revisionMessage = (e: RevisionEvent) => {
        if (e.projectId !== projectId || e.revision <= last) return null; // drop duplicates
        last = e.revision;
        const changes = whole ? store.liveChanges(e) : undefined;
        return { event: 'revision', id: String(e.revision), data: changes ? revisionWithChanges(e, changes) : JSON.stringify(seen(e)) };
      };
      const send = async (e: RevisionEvent) => { const m = revisionMessage(e); if (m) await stream.writeSSE(m); };
      // Live events are written in the order they happened, each after the macrotask that emitted it: the answer to the edit that
      // caused a revision goes out first, and the revision's data (with its changes) is serialised then, not inside Store.commit.
      let queue: Promise<void> = Promise.resolve();
      const later = (message: () => { event: string; id?: string; data: string } | null) => {
        queue = queue.then(() => new Promise<void>((r) => setImmediate(r))).then(async () => { const m = message(); if (m) await stream.writeSSE(m); }).catch(() => {});
      };
      const now = (m: { event: string; data: string }) => later(() => m); // the data is taken when the event happens
      const pending: RevisionEvent[] = [];
      let live = false;
      const onEvent = (e: RevisionEvent) => (live ? later(() => revisionMessage(e)) : pending.push(e));
      // an assistant job reaches a listener other than the owner's session as its id, type, status and times only (assistant/visibility.ts)
      const onJob = (j: any) => j.projectId === projectId && now({ event: 'job', data: JSON.stringify(assistantJobStub(listener, j) ?? seen({ id: j.id, type: j.type, status: j.status, stage: j.stage, output: j.output, error: j.error })) });
      store.events.on('revision', onEvent);
      const onDerivative = (d: any) => { const a = Object.values(store.getProject(projectId).doc.assets).find((x) => x.contentHash === d.assetHash); if (a) now({ event: 'derivative', data: JSON.stringify({ assetId: a.id, kind: d.kind, status: d.status }) }); };
      store.events.on('job', onJob);
      store.events.on('derivative', onDerivative);
      // the assistant's proposals are announced to the owner's session only (assistant/visibility.ts)
      const onGov = (kind: string) => (e: any) => e.projectId === projectId && (kind !== 'proposal' || mayReadProposal(listener, e)) && now({ event: kind, data: JSON.stringify(seen(e)) });
      const govHandlers = (['control', 'proposal', 'approval'] as const).map((k) => [k, onGov(k)] as const);
      for (const [k, fn] of govHandlers) store.events.on(k, fn);
      const onPresence = (p: any) => p.projectId === projectId && now({ event: 'presence', data: JSON.stringify(seen(p)) });
      presence.events.on('presence', onPresence);
      // The phone drop's public view (no token, PIN or session: drop.ts), to the owner's own session only: it is the owner's dialog.
      const onDrop = (d: { projectId: string }) => d.projectId === projectId && now({ event: 'drop', data: JSON.stringify(d) });
      if (listener.kind === 'user') extras.door?.events.on('drop', onDrop);
      // a mode switch closes every stream but the owner's own (C4): the client reconnects and is judged under the new mode
      let endForMode: (() => void) | null = null;
      const onMode = (m: unknown) => { const end = endForMode; if (!end) return; endForMode = null; void stream.writeSSE({ event: 'mode', data: JSON.stringify(m) }).catch(() => {}).finally(end); };
      if (!ownerKeeps(listener)) autonomy.on('mode', onMode);
      try {
        await stream.writeSSE({ event: 'hello', data: JSON.stringify({ revision: current }) });
        for (const e of store.eventsSince(projectId, since)) await send(e);
        for (const e of pending) await send(e);
        live = true;
        await new Promise<void>((resolve) => { endForMode = resolve; stream.onAbort(resolve); });
      } finally {
        store.events.off('revision', onEvent);
        store.events.off('job', onJob);
        store.events.off('derivative', onDerivative);
        for (const [k, fn] of govHandlers) store.events.off(k, fn);
        presence.events.off('presence', onPresence);
        extras.door?.events.off('drop', onDrop);
        autonomy.off('mode', onMode);
      }
    });
  });

  // ----- human control: grants, pause, proposals, approvals -----
  registerAutonomyRoutes(app, { autonomy, need }); // GET any credential, PUT the floor (autonomy.ts)
  // FLOOR (autonomy.ts FLOOR_SITES): only the owner's own session mints or revokes credentials, in both modes
  const floorOwner = (c: Context<Env>) => { const p = c.var.principal; if (!isOwnerFloor(p)) throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session'); return p; };
  // the owner's switches kept in both modes by decision: pause (A6), proposal and approval decisions (B2, B3)
  const owner = (c: Context<Env>) => { const p = c.var.principal; if (!ownerKeeps(p)) throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session'); return p; };
  app.get('/api/v1/grants', (c) => { const p = c.var.principal; if (!actsAsOwner(p)) throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session'); return c.json({ grants: gov.listGrants() }); }); // A19 policy: an open agent reads the list (hashes only)
  app.post('/api/v1/grants', async (c) => c.json(gov.createGrant(await c.req.json().catch(() => undefined), floorOwner(c)), 201));
  app.post('/api/v1/grants/:grantId/revoke', (c) => c.json({ grant: gov.revokeGrant(c.req.param('grantId'), floorOwner(c)) }));
  app.get('/api/v1/projects/:id/controls', (c) => { need(c, 'observe'); return c.json({ projectId: c.req.param('id'), agentsPaused: gov.isPaused(c.req.param('id')) }); });
  app.post('/api/v1/projects/:id/agents/pause', (c) => c.json(gov.setPaused(c.req.param('id'), true, owner(c))));
  app.post('/api/v1/projects/:id/agents/resume', (c) => c.json(gov.setPaused(c.req.param('id'), false, owner(c))));
  /** A frame worth looking at for a proposal: the middle of the first clip it changes. */
  const previewFrame = (changes: { before: any; after: any }[], rate: { num: number; den: number }) => {
    const st = changes.map((ch) => ch.after ?? ch.before).find((x) => x?.kind === 'clip');
    return st ? T.frameIndexAt(T.add(st.clip.start, { value: st.clip.duration.value, timescale: st.clip.duration.timescale * 2 }), rate) : 0;
  };
  app.get('/api/v1/projects/:id/proposals', (c) => {
    need(c, 'observe');
    const rate = store.getProject(c.req.param('id')).doc.settings.frameRate;
    // entity states and operation arguments of a proposal: without birth dates for a credential that may not read them
    return c.json({ proposals: forPrincipal(proposalsFor(c.var.principal, gov.listProposals(c.req.param('id'), c.req.query('status'))), c.var.principal).map((p) => ({ ...p, previewFrame: previewFrame(p.changes, rate) })) });
  });
  app.post('/api/v1/projects/:id/proposals', async (c) => { const b = await body(c, TxBody); return c.json(gov.propose(c.var.principal, c.req.param('id'), b.ops, b.label), 201); });
  const proposalIn = (c: Context<Env>) => { const pr = gov.getProposal(c.req.param('proposalId')!); assertMayReadProposal(c.var.principal, pr); if (pr.projectId !== c.req.param('id')) throw new ApiError(404, 'proposal_not_found', 'proposal not found in this project'); return pr; };
  app.get('/api/v1/projects/:id/proposals/:proposalId', (c) => { const who = need(c, 'observe'); return c.json({ proposal: forPrincipal(proposalIn(c), who) }); });
  /** Before/after stills of a proposal, rendered by the same compositor as export. `side=before|after`. */
  app.get('/api/v1/projects/:id/proposals/:proposalId/frame', async (c) => {
    need(c, 'observe');
    const pr = proposalIn(c);
    const docs = gov.proposalDocs(pr.id);
    const side = c.req.query('side') === 'before' ? 'before' : 'after';
    const png = await exporter.renderStill(docs[side], docs.baseRevision, Number(c.req.query('index') ?? 0), c.req.query('scale') === '0.25' ? 0.25 : c.req.query('scale') === '0.5' ? 0.5 : 1);
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'X-PF-Proposal-Side': side });
  });
  for (const decision of ['accept', 'reject'] as const)
    app.post(`/api/v1/projects/:id/proposals/:proposalId/${decision}`, (c) => { proposalIn(c); return c.json(gov.decide(c.req.param('proposalId'), decision, owner(c))); });
  app.get('/api/v1/projects/:id/approvals', (c) => { need(c, 'observe'); return c.json({ approvals: gov.listApprovals(c.req.param('id')) }); });
  /** An agent (or anyone) may ASK for a model download; only the owner's decision starts it, and only for exactly the bytes that were shown. */
  app.post('/api/v1/projects/:id/capabilities/:capabilityId/models/request', async (c) => {
    const p = need(c, 'observe');
    return c.json({ approval: await requestModelDownload(capabilities, gov, p, c.req.param('id'), c.req.param('capabilityId')) }, 201);
  });
  /** Mark a machine translation reviewed (or back to needs review): the owner's own session only (ADR-0017); agents get 403. */
  app.post('/api/v1/projects/:id/variants/:variantId/translation/review', async (c) => {
    const p = need(c, 'edit');
    if (!actsAsOwner(p)) throw new ApiError(403, 'human_approval_required', 'only the project owner can mark a translation reviewed or not, from their own session', { variantId: c.req.param('variantId') }, 'Tell the owner which phrases to read; they mark it in the editor.');
    const b = await body(c, ReviewBody);
    return c.json(reviewTranslation(gov, p, c.req.param('id'), c.req.param('variantId'), b.review));
  });
  for (const decision of ['approve', 'reject'] as const)
    app.post(`/api/v1/projects/:id/approvals/:approvalId/${decision}`, async (c) => {
      const by = owner(c);
      const a = gov.decideApproval(c.req.param('approvalId'), decision, by);
      if (decision === 'reject' || a.kind !== 'model-download') return c.json({ approval: a });
      // Re-derive the action from the CURRENT state: if the download changed since it was shown, the approval does not cover it.
      const info = (await capabilities.list()).capabilities.find((x) => x.id === a.action.capabilityId);
      const current = { capabilityId: a.action.capabilityId, bytes: info?.missingDownloadBytes ?? 0, models: (info?.models ?? []).map((m) => ({ path: m.path, sha256: m.sha256 })) };
      gov.consumeApproval(a.id, 'model-download', current);
      const job = await capabilities.startDownload(c.req.param('id'), a.action.capabilityId, current.bytes, by.actor);
      return c.json({ approval: gov.getApproval(a.id), jobId: job.id });
    });

  // ----- presence: transient session state, never part of the document or the op log -----
  const PresenceBody = z.object({ sessionId: z.string().min(1).max(64), frame: z.number().int().nonnegative().nullable().optional(), selection: z.array(z.string()).max(200).optional(), label: z.string().max(80).optional() }).strict();
  app.put('/api/v1/projects/:id/presence', async (c) => {
    const p = need(c, 'observe');
    store.getProject(c.req.param('id'));
    const b = await body(c, PresenceBody);
    return c.json(presence.update(c.req.param('id'), { sessionId: b.sessionId, actor: p.actor, kind: p.kind, frame: b.frame ?? null, selection: b.selection ?? [], label: b.label ?? null }));
  });
  app.get('/api/v1/projects/:id/presence', (c) => { need(c, 'observe'); return c.json({ presence: presence.list(c.req.param('id')) }); });

  // ----- media -----
  app.post('/api/v1/projects/:id/assets', async (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    gov.assertMayAct(p, projectId, 'edit');
    gov.assertUnrestricted(p, 'add media to the library');
    if (!c.req.raw.body) throw new ApiError(400, 'empty_upload', 'request has no body');
    const name = decodeUploadHeader(c.req.header('x-filename')) ?? 'upload';
    // Media goes through the import queue (ADR-0023) and this route waits for its job, so it answers as it always did: 201 with the
    // asset, or the import's own error. Its commit kind is 'edit', as before. A colour table (.cube) keeps the direct path.
    if (extras.imports && !/\.cube$/i.test(name)) {
      const job = await extras.imports.receive({ projectId, actor: p.actor, body: Readable.fromWeb(c.req.raw.body as any), name, via: 'browser', declaredBytes: declaredLength(c.req.header('content-length')), maxBytes: cfg.maxUploadBytes, commitKind: 'edit', signal: c.req.raw.signal });
      const done = await extras.imports.wait(job.id);
      const head = { 'X-PF-Import-Job': job.id };
      if (done.status !== 'succeeded') {
        const e = (done.error ?? {}) as { code?: string; message?: string; status?: number; details?: Record<string, unknown>; hint?: string };
        const err = new ApiError(typeof e.status === 'number' && e.status >= 400 ? e.status : 500, e.code ?? 'internal_error', e.message ?? `the import ended ${done.status}`, e.details ?? {}, e.hint);
        return c.json(err.toJSON(), err.status as any, head);
      }
      const out = done.output as { assetId: string; revision: number; deduplicated: boolean };
      return c.json({ assetId: out.assetId, revision: out.revision, deduplicated: out.deduplicated, asset: store.getProject(projectId).doc.assets[out.assetId] }, 201, head);
    }
    // Storage ceiling: refuse up front when the declared size cannot fit, and cut a stream of unknown size off at the room left.
    const room = assertStorageRoom(store, Number(c.req.header('content-length') ?? 0) || 1, 'store this upload');
    const asset = await ingestUpload(store, c.req.raw.body, name, p.actor, Math.min(cfg.maxUploadBytes, room), { homeZone: cfg.homeZone, now: new Date() });
    // The ingest job attaches its result through a normal (internal) operation.
    const r = store.commit({ projectId, actor: p.actor, label: `Import ${asset.name}`, allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
    const assetId = r.results[0]!.output!.assetId as string;
    // Thumbnails, waveform peaks and a proxy are produced progressively in the background; editing does not wait for them.
    derivatives.ensure(store.getProject(projectId).doc.assets[assetId]!);
    return c.json({ assetId, revision: r.revision, deduplicated: r.results[0]!.output!.deduplicated, asset: store.getProject(projectId).doc.assets[assetId] }, 201);
  });
  // ----- life line (ADR-0021): capture dates and "on this day" -----
  // Re-read capture dates from the stored originals of files that have none; one transaction of internal attach operations.
  app.post('/api/v1/projects/:id/captures/read', async (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    gov.assertMayAct(p, projectId, 'edit');
    gov.assertUnrestricted(p, 'read capture dates into the library');
    return c.json(await readMissingCaptures(store, p, projectId, { homeZone: cfg.homeZone, now: new Date() }));
  });
  // Across every project, so it answers the owner's own session only. The browser gives its local day; the server's clock is not used.
  app.get('/api/v1/on-this-day', (c) => {
    const p = need(c, 'observe');
    if (!actsAsOwner(p)) throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session');
    const date = c.req.query('date') ?? '';
    if (!WALL_DATE.test(date) || !isRealWallDate(date)) throw new ApiError(400, 'invalid_request', 'date must be a real day written YYYY-MM-DD (the day on the viewer\'s own clock)', { date: date.slice(0, 32) });
    return c.json({ items: onThisDayFor(store, p, date) });
  });
  // People already entered in the owner's other projects (names, birth dates, word choices), so they are typed once. Across
  // every project and with birth dates, so it answers the owner's own session only, never a token or a grant.
  app.get('/api/v1/people-suggestions', (c) => {
    const p = need(c, 'observe');
    if (!actsAsOwner(p)) throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session');
    return c.json({ people: peopleSuggestions(store, p) });
  });
  app.post('/api/v1/projects/:id/sfx', async (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    gov.assertMayAct(p, projectId, 'edit');
    return c.json(await addSfx(store, gov, p, projectId, await body(c, SfxBody)), 201);
  });
  // Listening to a built-in sound before adding it: the same bytes that adding it would store.
  app.get('/api/v1/sfx/:sfxId/audio', async (c) => {
    need(c, 'observe');
    const bytes = await sfxPreview(store.tmpDir, c.req.param('sfxId'));
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'audio/wav', 'content-length': String(bytes.length), 'cache-control': 'private, max-age=3600' });
  });
  // ----- content packs and built-in music (ADR-0022) -----
  app.get('/api/v1/packs', (c) => { need(c, 'observe'); return c.json({ packs: PACKS.map(summarizePack) }); });
  // The packs to suggest on the caller's own local day; with projectId, also the birthdays of that project's people, as the
  // credential may read them (a credential without the people scope reads no birth dates, so it gets no birthday hints).
  app.get('/api/v1/packs/suggest', (c) => {
    const p = need(c, 'observe');
    return c.json(packSuggestions(store, gov, p, c.req.query('date') ?? '', c.req.query('projectId')));
  });
  // the recorded path reads the library through this Config (MCP add_builtin_music too, through registerMusicOptions); the kit list is
  // MUSIC_KITS unless a TEST passes a labelled synthetic one (extras.musicKits, never from the environment)
  const musicOpts = { cfg, ...(extras.musicKits ? { kits: extras.musicKits } : {}) };
  registerMusicOptions(store, musicOpts);
  app.get('/api/v1/music', (c) => { need(c, 'observe'); return c.json({ styles: listMusicStyles() }); });
  // Listening before adding: the same bytes adding it would store (at most 32 bars); cancelled when the request goes away.
  app.get('/api/v1/music/:styleId/audio', async (c) => {
    need(c, 'observe');
    const int = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : /^\d{1,7}$/.test(v) ? Number(v) : Number.NaN);
    // wave 7 instruments: ?instruments=synth|recorded (recorded: the kit checked first, refused with its reason, never silently
    // synthesised) and ?match=1 (x-pf-level-scale for the blind pair). Headers carry ASCII codes only.
    const instruments = c.req.query('instruments');
    if (instruments !== undefined && instruments !== 'synth' && instruments !== 'recorded') throw new ApiError(400, 'invalid_option', 'instruments is synth or recorded', { instruments: instruments.slice(0, 16) });
    const match = c.req.query('match');
    if (match !== undefined && match !== '0' && match !== '1') throw new ApiError(400, 'invalid_option', 'match is 0 or 1', { match: match.slice(0, 8) });
    const { bytes, headers } = await musicPreviewAnswer(c.req.param('styleId'), int(c.req.query('bars'), 16), int(c.req.query('seed'), 1), { ...musicOpts, signal: c.req.raw.signal, ...(instruments ? { instruments } : {}), ...(match === '1' ? { match: true } : {}) });
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'audio/wav', 'content-length': String(bytes.length), 'cache-control': 'private, max-age=3600', ...headers });
  });
  // recorded instruments «כלים מוקלטים» (wave 7 instruments track; instruments/routes.ts): the kits and their honest states; the owner's mark
  app.get('/api/v1/music/kits', async (c) => { need(c, 'observe'); return c.json(await listMusicKits(cfg, musicOpts.kits)); });
  app.post('/api/v1/music/kits/:kitId/heard', async (c) => {
    const p = need(c, 'observe');
    if (!actsAsOwner(p)) throw instrumentsError('ownerOnly', {}); // before the body is read: an agent learns nothing else
    return c.json(markKitHeard(cfg.dataDir, p, c.req.param('kitId'), (await body(c, z.object({ heard: z.boolean() }).strict())).heard, new Date().toISOString(), musicOpts.kits));
  });
  // As for templates: the credential's own mode decides (addMusic refuses observe and propose modes with the reason).
  app.post('/api/v1/projects/:id/music', async (c) => {
    const p = need(c, 'observe');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    return c.json(await addMusic(store, gov, p, projectId, await body(c, MusicBody), musicQueue, musicOpts), 201);
  });
  // ----- music that fits the film «מוזיקה שמתאימה לסרט» (wave 7 musicfit; musicfit/routes.ts): 501 musicfit_not_built until built -----
  app.post('/api/v1/projects/:id/music-fit/plan', async (c) => { const p = need(c, 'observe'); return c.json(await planMusicFitFor(store, gov, p, c.req.param('id'), await body(c, MusicFitPlanRequestSchema))); });
  app.post('/api/v1/projects/:id/music-fit/apply', async (c) => { const p = need(c, 'observe'); return c.json(await applyMusicFitFor(store, gov, p, c.req.param('id'), await body(c, MusicFitApplyRequestSchema))); });
  app.get('/api/v1/projects/:id/music-fit/join.wav', async (c) => {
    const p = need(c, 'observe');
    const q = { assetId: c.req.query('assetId') ?? '', from: c.req.query('from') ?? '', to: c.req.query('to') ?? '', ...(c.req.query('startAt') ? { startAt: c.req.query('startAt')! } : {}) };
    const bytes = await musicJoinPreviewFor(store, gov, p, c.req.param('id'), q, c.req.raw.signal);
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'audio/wav', 'content-length': String(bytes.length), 'cache-control': 'no-store' });
  });
  app.post('/api/v1/projects/:id/assets/:assetId/music-join/heard', async (c) => {
    const p = need(c, 'observe');
    refuseHeardByAgent(p, c.req.param('assetId')); // before the body is read: an agent learns nothing else
    return c.json(markJoinHeardFor(store, gov, p, c.req.param('id'), c.req.param('assetId'), (await body(c, z.object({ heard: z.boolean() }).strict())).heard));
  });
  // Graphic elements: the same route for the editor and for agents. Element pictures count against the storage ceiling like
  // uploads; makeElement checks it (store.maxStorageBytes), so the agent tool is held to it as well.
  app.get('/api/v1/elements', async (c) => { need(c, 'observe'); return c.json({ available: await canRasteriseSvg(), count: ELEMENTS.length, note: 'Elements are listed in the catalog. available=false means this machine\'s ffmpeg cannot read SVG, so elements cannot be made here.' }); });
  app.post('/api/v1/projects/:id/elements', async (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    gov.assertMayAct(p, projectId, 'edit');
    return c.json(await addElement(store, gov, p, projectId, await body(c, ElementBody)), 201);
  });
  app.get('/api/v1/projects/:id/assets/:assetId/content', (c) => {
    need(c, 'observe');
    const a = store.getProject(c.req.param('id')).doc.assets[c.req.param('assetId')];
    if (!a) throw new ApiError(404, 'asset_not_found', 'asset not found in this project');
    return sendAsset(c, a, 'asset content');
  });
  /** The project's assets whose stored file is missing: the editor marks them (library card, timeline clips) instead of failing to draw them. */
  app.get('/api/v1/projects/:id/missing-media', (c) => {
    need(c, 'observe');
    return c.json({ missing: missingAssets(store, store.getProject(c.req.param('id')).doc) });
  });

  const assetOf = (c: Context<Env>) => {
    const a = store.getProject(c.req.param('id')!).doc.assets[c.req.param('assetId')!];
    if (!a) throw new ApiError(404, 'asset_not_found', 'asset not found in this project');
    return a;
  };
  app.get('/api/v1/projects/:id/assets/:assetId/derivatives', (c) => {
    need(c, 'observe');
    const a = assetOf(c);
    const rows = derivatives.list(a.contentHash);
    return c.json({ assetId: a.id, derivatives: (rows.length ? rows : derivatives.ensure(a)).map(({ assetHash: _h, blobHash: _b, ...r }) => r) });
  });
  app.get('/api/v1/projects/:id/assets/:assetId/derivatives/:kind', (c) => {
    need(c, 'observe');
    const row = derivatives.get(assetOf(c).contentHash, c.req.param('kind') as DerivativeKind);
    if (!row || row.status !== 'ready' || !row.blobHash) throw new ApiError(404, 'derivative_not_ready', `derivative is ${row?.status ?? 'unknown'}`, { status: row?.status ?? null, error: row?.error ?? null });
    return sendBlob(c, store.blobPath(row.blobHash), row.mimeType ?? 'application/octet-stream', () => new ApiError(404, 'derivative_not_ready', 'the derivative file is no longer stored on this computer', { status: 'missing', error: null }));
  });

  // ----- senses -----
  app.get('/api/v1/projects/:id/frame', async (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const index = c.req.query('index') !== undefined ? Number(c.req.query('index')) : T.frameIndexAt(T.fromSeconds(c.req.query('seconds') ?? '0'), p.doc.settings.frameRate);
    // ?sequence= renders a sequence of the project (a short) and ?variant= the frame as that linked format would export it (ADR-0018).
    // `p.doc` is what this credential may read: for one without the people scope the frame is drawn without ages, and says so.
    const png = await exporter.renderStill(outputDoc(p.doc, { sequenceId: c.req.query('sequence'), variantId: c.req.query('variant') }), p.revision, index);
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'X-PF-Revision': String(p.revision), 'X-PF-Frame-Index': String(index), ...(peopleNote(c.var.principal, p.doc).peopleAccess ? { 'X-PF-People': 'names; age fields are drawn empty' } : {}) });
  });

  // ----- jobs / export -----
  app.post('/api/v1/projects/:id/exports', async (c) => {
    const pr = need(c, 'edit');
    gov.assertMayAct(pr, c.req.param('id'), 'job');
    const options = await c.req.json().catch(() => ({}));
    assertMayExportStill(pr, options); // a full-size picture is the owner's own (wave 8 cover)
    gov.takeExportQuota(pr, 1, true);
    assertMayTakeRendered(pr, store.wholeProject(c.req.param('id')).doc, 'export this project');
    // exporter.start refuses once the storage ceiling is reached (the same check for this route, the batch route, retries and MCP)
    const job = exporter.start(c.req.param('id'), pr.actor, options);
    gov.takeExportQuota(pr);
    return c.json({ jobId: job.id, status: job.status, revision: job.input.revision, estimate: job.input.manifest.estimate, warnings: job.input.warnings }, 202);
  });
  /** Dry run: what would be exported, what it depends on, and what blocks it. Starts nothing. */
  app.post('/api/v1/projects/:id/exports/plan', async (c) => {
    const who = need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    return c.json({ ...exporter.plan(p.doc, p.revision, await c.req.json().catch(() => ({}))), ...peopleNote(who, p.doc) });
  });
  // The owner confirms a reservation left 'unknown' was not charged. The owner's own session only (assistant/visibility.ts
  // assertMayReleaseBudget): any other credential is refused before the ledger is looked at, so its answer tells nothing of it.
  app.post('/api/v1/jobs/:jobId/budget/release', (c) => { const p = need(c, 'observe'); const jobId = c.req.param('jobId'); assertMayReleaseBudget(p, jobId); gov.releaseUnknown(p, jobId); return c.json({ jobId, ledger: gov.ledgerFor(jobId) }); });
  app.post('/api/v1/jobs/:jobId/retry', (c) => { const pr = need(c, 'edit'); const old = store.getJob(c.req.param('jobId'));
    if (old.type === IMPORT_JOB_TYPE && extras.imports) { assertMayHandleImportJob(gov, pr, old, 'retry'); const job = extras.imports.retry(old.id, pr.actor); return c.json({ jobId: job.id, status: job.status, retryOf: old.id }, 202); } gov.assertMayAct(pr, old.projectId, 'job'); assertMayTakeJobOutput(pr, old, 'retry this export'); assertMayExportStill(pr, old.input?.manifest?.options); const job = exporter.retry(c.req.param('jobId'), pr.actor); return c.json({ jobId: job.id, status: job.status, retryOf: job.input.retryOf }, 202); });
  app.get('/api/v1/jobs/:jobId', (c) => c.json(jobViewFor(need(c, 'observe'), store.getJob(c.req.param('jobId')))));
  app.get('/api/v1/jobs/:jobId/output', (c) => {
    const who = need(c, 'observe');
    const j = store.getJob(c.req.param('jobId'));
    assertMayTakeJobOutput(who, j, 'download this export');
    if (j.status !== 'succeeded') throw new ApiError(409, 'job_not_finished', `job is ${j.status}`, { status: j.status });
    // only an export leaves a file to download; any other kind of job (an analysis, a language-assistant request) has none
    if (typeof j.output?.file !== 'string') throw new ApiError(404, 'not_found', 'this job has no file to download', { jobId: j.id }, 'Only a finished export has a file; read other jobs with GET /api/v1/jobs/{jobId}.');
    return sendBlob(c, path.join(store.outDir, path.basename(j.output.file)), j.output.mimeType ?? 'video/mp4', fileMissing('output_missing', 'the exported file'), `pulseframe-${j.id}${path.extname(j.output.file)}`);
  });
  app.get('/api/v1/jobs/:jobId/captions', (c) => {
    need(c, 'observe');
    const j = store.getJob(c.req.param('jobId'));
    if (j.status !== 'succeeded') throw new ApiError(409, 'job_not_finished', `job is ${j.status}`, { status: j.status });
    if (!j.output?.captions) throw new ApiError(404, 'not_found', 'this export has no caption file');
    return sendBlob(c, path.join(store.outDir, path.basename(j.output.captions.file)), j.output.captions.format === 'vtt' ? 'text/vtt' : 'application/x-subrip', fileMissing('output_missing', 'the caption file of this export'), `pulseframe-${j.id}.${j.output.captions.format}`);
  });
  // the credits text written with an export of library material (wave 7 library track; export.ts exportLicence): the sidecar
  // file of the server route, or the text of the job row for the browser route (which stores no file)
  app.get('/api/v1/jobs/:jobId/credits', (c) => {
    need(c, 'observe');
    const j = store.getJob(c.req.param('jobId'));
    if (j.status !== 'succeeded') throw new ApiError(409, 'job_not_finished', `job is ${j.status}`, { status: j.status });
    const credits = j.output?.licence?.credits as { descriptionText?: unknown; file?: unknown } | undefined;
    if (!credits || typeof credits.descriptionText !== 'string' || !credits.descriptionText) throw new ApiError(404, 'not_found', 'this export has no credits text', { jobId: j.id }, 'Only an export holding library material whose licence asks for a credit has one; read the project\'s credits with GET /api/v1/projects/{id}/credits.');
    if (typeof credits.file === 'string') return sendBlob(c, path.join(store.outDir, path.basename(credits.file)), 'text/plain; charset=utf-8', fileMissing('output_missing', 'the credits file of this export'), `pulseframe-${j.id}.credits.txt`);
    return c.body(credits.descriptionText, 200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="pulseframe-${j.id}.credits.txt"` });
  });
  // ----- browser export route: the tab renders and encodes; the server holds the durable job and a tab lease -----
  const browserExport = registerBrowserExportRoutes(app, store, exporter);
  (app as any).browserExport = browserExport;
  // ----- import queue and phone drop (ADR-0023); render cache (ADR-0024) -----
  if (extras.imports) registerImportRoutes(app, { cfg, store, gov, imports: extras.imports, door: extras.door ?? null, need });
  if (extras.renderCache) registerRenderCacheRoutes(app, extras.renderCache, need);
  // the content library on disk (wave 7 library track): every library route, and GET …/credits (library/contract.ts LIBRARY_ROUTES)
  registerLibraryRoutes(app, { cfg, store, gov, imports: extras.imports ?? null, need });
  // editing craft (wave 7 craft track): named versions and find (craft/contract.ts CRAFT_ROUTES; 501 craft_not_built until W2)
  registerCraftRoutes(app, { cfg, store, gov, exporter, need });
  // «חיפוש בצילומים» (wave 7 search track; search/contract.ts SEARCH_ROUTES): POST …/search for observers (agents: no-model part of the reader
  // document, agentAnswerOf), the picture index for the owner's own session only; index.ts passes the built runtime (a test host without one gets 501)
  const searchRuntime = extras.search ?? notBuiltRuntime();
  registerSearchRoutes(app, { cfg, store, gov, runtime: searchRuntime, need });
  // the local picture-model runtime and «הציעו עיניים» (wave 8 picmodels; picmodels/contract.ts PICMODELS_ROUTES): the state report for
  // observers (no yunet row but for the owner's own session), eyes for the owner's own session only; nothing of eyes is stored
  registerPicmodelsRoutes(app, { cfg, store, gov, runtime: extras.pictureModels ?? notBuiltPictureModels(), need });

  // ----- the command bar's language assistant (ADR-0027; assistant/contract.ts ASSISTANT_ROUTES): status for any observer (whole
  // for the owner's own session, connected or not for anyone else: assistant/visibility.ts), the rest for the owner's own session
  // only (the money and the key are the owner's). The handlers are W2's (assistant/routes.ts).
  const assistant = createAssistantHandlers({ cfg, store, gov, deps: extras.assistant ?? { adapters: new Map(), endpoint: () => null } });
  // MCP cancel_job reaches an assistant job through this same handler (one cancel path; mcp.ts bindAssistant)
  (mcp as { bindAssistant?: (a: AssistantJobControls) => void }).bindAssistant?.(assistant);
  // «תא הבדיקה» (wave 8 booth track; booth/contract.ts BOOTH_ROUTES): every route the owner's own session only, GET included
  // «שמירת הסרט כתבנית» (wave 8 owntemplate; ownTemplates.ts, core OWN_TEMPLATE_ROUTES): the owner's own session only; 501 own_template_not_built until W2
  registerOwnTemplateRoutes(app, { cfg, store, gov, need });
  registerMadeRoutes(app, { cfg, store, gov, need, ...(extras.made ? { runner: extras.made } : {}) }); // «קליפ מקוד» (wave 8 motioncode; made/contract.ts MADE_ROUTES): 501 made_not_built until W1/W2
  registerSourcesRoutes(app, { store, gov, need, ...(extras.sources ? { runtime: extras.sources } : {}) }); // «מאגר» (wave 8 sources; sources/contract.ts SOURCES_ROUTES): 501 sources_not_built until W2
  registerBoothRoutes(app, { cfg, store, gov, need, exporter, renderHost: extras.renderHost ?? null, speech, assistant, search: searchRuntime, door: extras.door ?? null, ...(extras.musicKits ? { musicKits: extras.musicKits } : {}) });
  // the in-editor agent «סוכן» (wave 8 autonomy Part 2; agent/routes.ts, core AGENT_ROUTES): runs, undo-all, providers; 501 agent_not_built until built
  registerAgentRoutes(app, { store, gov, need, service: () => (mcp as { agentService?: () => AgentRunService }).agentService?.() ?? notBuiltAgentService() });
  const assistantOwner = (c: Context<Env>) => {
    const p = need(c, 'observe');
    if (!actsAsOwner(p)) throw new ApiError(403, 'owner_required', 'the language assistant is set up and used from the owner\'s own session only', undefined, 'The owner sets it up in Settings.');
    return p;
  };
  app.get('/api/v1/assistant/status', async (c) => c.json(await assistant.status(need(c, 'observe'))));
  app.get('/api/v1/projects/:id/assistant/summary', async (c) => {
    const p = assistantOwner(c);
    const projectId = c.req.param('id');
    store.getProject(projectId); // 404 first
    const frame = Number(c.req.query('playheadFrame') ?? 0), sel = c.req.query('selection'), seq = c.req.query('sequenceId');
    if (!Number.isInteger(frame) || frame < 0) throw new ApiError(400, 'invalid_request', 'playheadFrame is a whole, non-negative frame index', { playheadFrame: c.req.query('playheadFrame') ?? null }, 'Send the playhead as a frame number, for example playheadFrame=90.');
    return c.json(await assistant.summary(p, projectId, { playheadFrame: frame, selection: sel ? sel.split(',').filter(Boolean).slice(0, 2000) : [], ...(seq ? { sequenceId: seq } : {}) }));
  });
  app.put('/api/v1/assistant/config', async (c) => { const p = assistantOwner(c); return c.json(await assistant.putConfig(p, await body(c, AssistantConfigBodySchema))); });
  app.put('/api/v1/assistant/key', async (c) => { const p = assistantOwner(c); return c.json(await assistant.putKey(p, (await body(c, AssistantKeyBodySchema)).key)); });
  app.delete('/api/v1/assistant/key', async (c) => c.json(await assistant.deleteKey(assistantOwner(c))));
  app.post('/api/v1/projects/:id/assistant/requests', async (c) => {
    const p = assistantOwner(c);
    const projectId = c.req.param('id');
    store.getProject(projectId);
    return c.json(await assistant.request(p, projectId, await body(c, AssistantRequestBodySchema)), 202);
  });
  // wave 7, the LOCAL assistant (assistant-decisions.md §4): owner's session only (agents 403 owner_required before anything is
  // looked up); the bodies are builder B's (assistant/routes.ts answers 501 not_built until then). No MCP tool reaches either.
  app.post('/api/v1/assistant/local/check', async (c) => c.json(await assistant.localCheck(assistantOwner(c))));
  app.post('/api/v1/assistant/jobs/:jobId/taken', async (c) => { await assistant.taken(assistantOwner(c), c.req.param('jobId')); return c.body(null, 204); });

  // ----- optional provider capabilities (Amendment A1). No route accepts a raw graph for execution. -----
  app.get('/api/v1/catalog', (c) => { need(c, 'observe'); return c.json(catalog()); });
  app.get('/api/v1/capabilities', async (c) => { need(c, 'observe'); return c.json(await capabilities.list()); });
  app.post('/api/v1/capabilities/import', async (c) => { need(c, 'edit'); const b = await body(c, ImportBody); return c.json(capabilities.importDraft(b.graph, { id: b.id, title: b.title })); });
  app.post('/api/v1/projects/:id/capabilities/:capabilityId/runs', async (c) => {
    const p = need(c, 'edit');
    gov.assertMayAct(p, c.req.param('id'), 'job');
    gov.assertUnrestricted(p, 'run provider jobs (their results are added to the library and may be placed on any track)');
    const b = await body(c, RunBody);
    const job = capabilities.start(runRequestOf(c.req.param('id'), c.req.param('capabilityId'), b, p));
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  /** What a run would read and cost here (frames, chunks, scratch, missing downloads, a measured time or none) and its setup state. Read-only. */
  app.get('/api/v1/projects/:id/capabilities/:capabilityId/estimate', async (c) => {
    const p = need(c, 'observe');
    const json = (name: string) => { const v = c.req.query(name); if (v === undefined) return undefined; try { return JSON.parse(v) as unknown; } catch { throw new ApiError(400, 'invalid_request', `query parameter "${name}" must be JSON`, { parameter: name }); } };
    const parsed = EstimateBody.safeParse({ ...(json('params') !== undefined ? { params: json('params') } : {}), ...(json('source') !== undefined ? { source: json('source') } : {}) });
    if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error), { issues: parsed.error.issues });
    store.getProject(c.req.param('id'));
    return c.json(await capabilities.estimate(runRequestOf(c.req.param('id'), c.req.param('capabilityId'), parsed.data, p)));
  });
  // Model downloads are a deliberate human action: not exposed as an MCP tool, and bound to the exact byte count shown.
  app.post('/api/v1/projects/:id/capabilities/:capabilityId/models/download', async (c) => {
    const p = need(c, 'edit');
    if (!actsAsOwner(p)) throw new ApiError(403, 'human_approval_required', 'model downloads must be started from the owner\'s own session, not by an agent credential');
    const b = await body(c, z.object({ confirmBytes: z.number().int().positive() }).strict());
    const job = await startModelDownloadFor({ capabilities, speech }, p, c.req.param('id'), 'capability', c.req.param('capabilityId'), b.confirmBytes);
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  // ---- local speech recognition (optional; an honest setup state when the engine or the model is absent) ----
  app.get('/api/v1/speech', async (c) => { need(c, 'observe'); return c.json(await speech.status()); });
  // As with capability models: a deliberate human action for the exact byte count shown, never an agent's.
  // «התקנת מנוע הדיבור» (speechEngine.ts): the owner's own session only, before anything is read; no MCP tool.
  app.get('/api/v1/speech/engine', async (c) => { const p = need(c, 'observe'); speech.engineInstall.assertOwner(p); return c.json(await speech.engineInstall.view(p)); });
  app.post('/api/v1/projects/:id/speech/engine/install', async (c) => {
    const p = need(c, 'observe');
    speech.engineInstall.assertOwner(p);
    const b = await body(c, z.object({ confirmBytes: z.number().int().positive(), replace: z.boolean().optional() }).strict());
    const job = await speech.engineInstall.start(p, c.req.param('id'), b.confirmBytes, b.replace ?? false);
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  app.post('/api/v1/projects/:id/speech/models/:modelId/download', async (c) => {
    const p = need(c, 'edit');
    if (!actsAsOwner(p)) throw new ApiError(403, 'human_approval_required', 'model downloads must be started from the owner\'s own session, not by an agent credential');
    const b = await body(c, z.object({ confirmBytes: z.number().int().positive() }).strict());
    const job = await startModelDownloadFor({ capabilities, speech }, p, c.req.param('id'), 'speech', c.req.param('modelId'), b.confirmBytes);
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  app.post('/api/v1/projects/:id/assets/:assetId/transcribe', async (c) => {
    const p = need(c, 'edit');
    const b = await body(c, TranscribeBody);
    const job = await speech.startTranscription(gov, p, c.req.param('id'), { ...b, assetId: c.req.param('assetId') });
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  app.post('/api/v1/projects/:id/narration', async (c) => {
    const p = need(c, 'edit');
    const job = await speech.startNarration(gov, p, c.req.param('id'), await body(c, NarrationBody));
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  app.post('/api/v1/projects/:id/transcribe', async (c) => {
    const p = need(c, 'edit');
    const b = await body(c, z.object({ language: TranscribeBody.shape.language }).strict());
    const r = await speech.startTranscriptionAll(gov, p, c.req.param('id'), b);
    return c.json({ jobs: r.jobs.map((j) => ({ assetId: j.assetId, jobId: j.job.id, status: j.job.status, type: j.job.type })), alreadyQueued: r.skipped }, 202);
  });
  app.post('/api/v1/projects/:id/narration/script', async (c) => {
    const p = need(c, 'edit');
    const r = await speech.startNarrationScript(gov, p, c.req.param('id'), await body(c, NarrationScriptBody));
    return c.json({ sentences: r.sentences, jobs: r.jobs.map((j) => ({ jobId: j.id, status: j.status, type: j.type })) }, 202);
  });
  app.post('/api/v1/jobs/:jobId/cancel', async (c) => {
    const j = store.getJob(c.req.param('jobId'));
    if (j.type === SPEECH_ENGINE_JOB_TYPE) speech.engineInstall.assertOwner(c.var.principal); // the owner's own, before any scope is named
    const p = need(c, 'edit');
    if (j.type === IMPORT_JOB_TYPE && extras.imports) { assertMayHandleImportJob(gov, p, j, 'cancel'); return c.json(extras.imports.cancel(j.id, p.actor)); }
    if (j.type === SOURCE_JOB_TYPE) return c.json((extras.sources ?? notBuiltSourcesRuntime).cancel(p, j.id)); // a stock-source download (wave 8 sources; W2: who may cancel)
    assertMayCancel(gov, p, j);
    if (j.type === ASSISTANT_JOB_TYPE) return c.json(assistant.cancel(p, j.id));
    if (j.type === 'analysis') return c.json(cancelAnalysisJob(store, j.id, p.actor));
    if (j.type === TRACKING_JOB_TYPE) return c.json(cancelTrackingJob(store, j.id, p.actor));
    if (j.type === MOMENTS_JOB_TYPE) return c.json(cancelMomentsJob(store, j.id, p.actor));
    if (j.type === STILLS_JOB_TYPE) return c.json(cancelStillsJob(store, j.id, p.actor));
    if (j.type === STABILISE_JOB_TYPE) return c.json(cancelStabiliseJob(store, j.id, p.actor));
    if (j.type === SEARCH_INDEX_JOB_TYPE) return c.json(searchRuntime.cancel(j.id, p.actor)); // a picture scan (wave 7 search): the owner's own
    if (speech.handles(j)) return c.json(speech.cancel(j.id, p.actor));
    // an export the editor's tab renders is handed to its lease holder by Exporter.cancel (browser-export.ts), as for MCP cancel_job
    return c.json(j.type === 'export' ? exporter.cancel(j.id, p.actor) : await capabilities.cancel(j.id, p.actor));
  });
  app.get('/api/v1/jobs/:jobId/outputs/:index', (c) => {
    need(c, 'observe');
    const j = store.getJob(c.req.param('jobId'));
    const o = j.status === 'succeeded' ? j.output?.bundle?.[Number(c.req.param('index'))] : undefined;
    if (!o) throw new ApiError(404, 'output_not_found', 'no validated output at that index');
    return sendBlob(c, store.blobPath(o.contentHash), o.mimeType, fileMissing('output_missing', 'this output of the job'));
  });
  app.all('/api/*', () => { throw new ApiError(404, 'not_found', 'no such API route'); });

  // ----- web app (built bundle) -----
  if (fs.existsSync(cfg.webDist)) {
    const root = path.relative(process.cwd(), cfg.webDist) || '.';
    app.use('*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  } else app.get('/', (c) => c.text('PULSEFRAME server is running. Build the web app with `pnpm build`, or use `pnpm dev`.'));
  return app;
}

/** One output of a batch: a sequence of the project (default the main edit), in a linked format (default its own frame). */
export const BatchItemSchema = z.object({ sequenceId: z.string().optional(), variantId: z.string().optional() }).strict();
/** Formats of the main edit (variantIds), or outputs of any sequence (items: a short, a short in a linked format; ADR-0018). Exactly one of the two. */
export const ExportBatchBody = z.object({ variantIds: z.array(z.string()).min(1).max(8).optional(), items: z.array(BatchItemSchema).min(1).max(8).optional(), options: z.record(z.string(), z.unknown()).optional() }).strict()
  .refine((x) => (x.variantIds === undefined) !== (x.items === undefined), { message: 'give variantIds or items, not both' });
/**
 * Start one export job per output, all-or-nothing: every item must exist and plan without blockers before any job is created
 * (REST POST /exports/batch and MCP export_batch). The same admission as one export: the job right, the storage ceiling once
 * for the whole batch, the people rule for films, the export quota.
 */
export function startExportBatch(store: Store, gov: Governance, exporter: Exporter, pr: Principal, projectId: string, raw: unknown) {
  gov.assertMayAct(pr, projectId, 'job');
  assertStorageRoom(store, 1, 'start exports'); // once for the whole batch, before any job exists (each start below is told so)
  const parsed = ExportBatchBody.safeParse(raw ?? {});
  if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error), { issues: parsed.error.issues });
  const b = parsed.data;
  assertMayExportStill(pr, b.options); // a full-size picture is the owner's own (wave 8 cover); the plan refuses a still in a batch anyway
  const items = b.items ?? b.variantIds!.map((variantId) => ({ variantId }));
  assertMayTakeRendered(pr, store.wholeProject(projectId).doc, 'export this project');
  const doc = store.getProject(projectId).doc;
  const what = (it: z.infer<typeof BatchItemSchema>) => (it.sequenceId ? `sequence ${it.sequenceId}${it.variantId ? ` in format ${it.variantId}` : ''}` : `format ${it.variantId ?? 'of the main edit'}`);
  for (const it of items) { const plan = exporter.plan(doc, store.getProject(projectId).revision, { ...b.options, ...it }); if (plan.blockers.length) throw new ApiError(422, 'render_blocked', `${what(it)} cannot be exported: ${plan.blockers[0]!.message}`, { ...it, blockers: plan.blockers }); }
  gov.takeExportQuota(pr, items.length, true);
  const jobs = items.map((it) => exporter.start(projectId, pr.actor, { ...b.options, ...it }, undefined, { roomChecked: true }));
  gov.takeExportQuota(pr, jobs.length);
  return { jobs: jobs.map((j) => ({ jobId: j.id, variantId: j.input.manifest.options.variantId, ...(j.input.manifest.options.sequenceId ? { sequenceId: j.input.manifest.options.sequenceId } : {}), status: j.status })) };
}

/** Serialize one caption track (default: the first) as it plays on the timeline. */
export function exportCaptions(master: ProjectDocument, trackId: string | undefined, format: string, variantId?: string, sequenceId?: string) {
  if (format !== 'srt' && format !== 'vtt' && format !== 'ass') throw new ApiError(400, 'invalid_args', 'format must be srt, vtt or ass');
  if (variantId && !Object.hasOwn(master.variants ?? {}, variantId)) throw new ApiError(404, 'not_found', `format ${variantId} not found`, { variantId });
  // A linked format has its own caption style, hidden or reworded cues and reworded transcript phrases; a sequence (a short,
  // ADR-0018) is its own timeline with its own frame.
  const doc = outputDoc(master, { sequenceId, variantId });
  const seq = doc.sequences[doc.mainSequenceId]!;
  const track = trackId ? seq.tracks.find((t) => t.id === trackId && t.kind === 'caption') : seq.tracks.find((t) => t.kind === 'caption');
  if (!track) throw new ApiError(404, 'not_found', trackId ? `caption track ${trackId} not found` : 'the project has no caption track');
  const cues = captionCues(doc, seq, track);
  const st = track.caption!.style;
  const text = format === 'srt' ? serializeSrt(cues) : format === 'vtt' ? serializeVtt(cues) : serializeAss(cues, { width: doc.settings.width, height: doc.settings.height, fontFamily: st.fontFamily, fontSize: Math.round(st.sizeFrac * doc.settings.height), primaryColor: st.color.slice(0, 7), outlineColor: (st.stroke ?? '#000000').slice(0, 7), alignment: st.position === 'top' ? 8 : st.position === 'center' ? 5 : 2, marginV: Math.round(st.marginFrac * doc.settings.height) });
  return { format, text, cues: cues.length, trackId: track.id, mime: format === 'vtt' ? 'text/vtt' : format === 'srt' ? 'application/x-subrip' : 'text/x-ssa' };
}

/**
 * Candidates by a recording's times skip the clips that show a copy of it whose timing is unknown and name them (skippedClips, the
 * editor shows a note); refused only when no clip plays the recording on a known clock and such a copy is there (core cleanup.ts timingCoverage).
 */
function untimedSkips(doc: ProjectDocument, assetId: string) {
  const cov = timingCoverage(doc, assetId);
  if (cov.mapped === 0 && cov.untimed.length) { const r = untimedCopyRefusal(cov.untimed); throw new ApiError(422, r.code, r.message, r.details, r.hint); }
  return skippedClips(cov.untimed);
}

export const SilenceBody = z.object({
  assetId: z.string(),
  thresholdDb: z.number().min(-90).max(-10).optional().describe('Quieter than this counts as silence. Default -35 dB'),
  minSeconds: z.number().min(0.1).max(30).optional().describe('Shortest silence to report. Default 0.5 s'),
  keepSeconds: z.number().min(0).max(5).optional().describe('Silence left untouched on each side of a cut. Default 0.1 s'),
}).strict();
/** Silent stretches of an asset and the cuts that would remove them from the current timeline. Read-only: nothing is edited. */
export async function findSilences(store: Store, projectId: string, a: z.infer<typeof SilenceBody>) {
  const p = store.getProject(projectId);
  const asset = p.doc.assets[a.assetId];
  if (!asset) throw new ApiError(404, 'not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
  if (!asset.audio) throw new ApiError(422, 'no_audio', 'this asset has no audio');
  const opts = { thresholdDb: a.thresholdDb ?? -35, minSeconds: a.minSeconds ?? 0.5 };
  const keepSeconds = a.keepSeconds ?? 0.1;
  const skipped = untimedSkips(p.doc, a.assetId);
  const source = await heavy(() => detectSilences(store.blobPath(asset.contentHash), opts, timeOriginSeconds(asset)));
  // mapped through every clip that plays this recording: its own and those of copies that keep its timing (core cleanup.ts)
  const candidates = sourceRangesToTimeline(p.doc, a.assetId, source, T.fromSeconds(keepSeconds.toFixed(6)));
  const sec = (t: T.RationalTime) => Number(T.toSeconds(t).toFixed(6));
  return {
    revision: p.revision, assetId: a.assetId, method: 'ffmpeg silencedetect on the original file', options: { ...opts, keepSeconds },
    sourceSilences: source.map((r) => ({ startSeconds: sec(r.start), endSeconds: sec(r.end) })),
    candidates: candidates.map((r) => ({ start: r.start, end: r.end, startSeconds: sec(r.start), seconds: sec(T.sub(r.end, r.start)) })),
    removableSeconds: sec(candidates.reduce((n, r) => T.add(n, T.sub(r.end, r.start)), T.ZERO)),
    ops: cutOps(candidates), skippedClips: skipped,
    note: `Candidates only. To apply, send \`ops\` as ONE transaction with expectedRevision set to this revision (or propose it). Quiet speech can be mistaken for silence: review before applying.${skipped.length ? ' skippedClips show a copy that does not keep the recording\'s timing and were not searched.' : ''}`,
  };
}

export const FillerBody = z.object({
  assetId: z.string(),
  repeats: z.boolean().optional().describe('Also mark the first of two identical consecutive words (default true)'),
  words: z.array(z.string().min(1).max(40)).max(50).optional().describe('Extra words to treat as fillers in this search (for example a speaker\'s habitual word)'),
}).strict();
/** Filler candidates from the transcript's words, and the timeline cuts that would remove them. Read-only. */
export function findFillerWords(store: Store, projectId: string, a: z.infer<typeof FillerBody>) {
  const p = store.getProject(projectId);
  if (!Object.hasOwn(p.doc.assets, a.assetId)) throw new ApiError(404, 'not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
  // the asset's own transcript, or that of the recording a time-preserving copy was made from (core lineage.ts)
  const tr = transcriptFor(p.doc, a.assetId)?.transcript;
  if (!tr) throw new ApiError(404, 'no_transcript', 'this asset has no transcript to search', { assetId: a.assetId }, 'Recognise or import a transcript first.');
  const anchor = tr.assetId;
  const skipped = untimedSkips(p.doc, anchor);
  const { candidates: found, skippedPhrases } = findFillers(tr, { repeats: a.repeats, words: a.words });
  const sec = (t: T.RationalTime) => Number(T.toSeconds(t).toFixed(6));
  // Each word is mapped on its own, so a word that is no longer on the timeline simply yields no cut. Source times are the transcribed recording's.
  const rows = found.map((c) => ({ ...c, timeline: sourceRangesToTimeline(p.doc, anchor, [{ start: c.start, end: c.end }]) }));
  const cuts = sourceRangesToTimeline(p.doc, anchor, found.map((c) => ({ start: c.start, end: c.end })));
  return {
    revision: p.revision, assetId: a.assetId, ...(anchor !== a.assetId ? { transcriptAssetId: anchor } : {}), method: 'rules over the transcript\'s words (hesitation sounds, immediate repetitions, listed words); no model, no audio',
    transcript: { origin: tr.origin.kind, language: tr.language, phrasesWithoutWordTiming: skippedPhrases },
    words: rows.map((r) => ({ kind: r.kind, text: r.text, segmentId: r.segmentId, wordIds: r.wordIds, sourceStartSeconds: sec(r.start), sourceEndSeconds: sec(r.end), onTimeline: r.timeline.map((x) => ({ startSeconds: sec(x.start), seconds: sec(T.sub(x.end, x.start)) })) })),
    candidates: cuts.map((r) => ({ start: r.start, end: r.end, startSeconds: sec(r.start), seconds: sec(T.sub(r.end, r.start)) })),
    removableSeconds: sec(cuts.reduce((n, r) => T.add(n, T.sub(r.end, r.start)), T.ZERO)),
    ops: cutOps(cuts), skippedClips: skipped,
    note: 'Candidates only. Recognisers often leave hesitation sounds out of their text, so an empty list does not mean there are none. Cuts are snapped inward to whole frames; a word shorter than a frame yields no cut. To apply, send `ops` as ONE transaction with expectedRevision set to this revision (or propose it).',
  };
}

/**
 * Everything creative that is registered in this build: effects, transitions, blends, masks, caption presets, clip motions, fonts,
 * and the sound effects with their presets (audioEffects, audioPresets; ADR-0010). `soundEffects` are the synthesised sound files of
 * the sound library, a different thing.
 */
export const catalog = () => ({
  ...describeCatalog(),
  ...describeAudioCatalog(),
  captionPresets: [...CAPTION_PRESETS],
  clipMotions: CLIP_MOTIONS.filter((m) => m !== 'none'),
  looks: COLOR_LOOKS.map((l) => ({ id: l.id, name: l.name, effect: 'color.grade', params: l.params, note: 'A setting of the color.grade effect; apply with apply_look. Chosen by description, not graded against reference pictures.' })),
  captionLooks: CAPTION_LOOKS.map((l) => ({ id: l.id, name: l.name, hint: l.hint, style: l.style, needsWordTiming: l.needsWordTiming, note: 'Apply with apply_caption_look. Chosen for readable contrast by rule; not judged on a video.' })),
  elements: ELEMENTS.map((e) => ({ id: e.id, category: e.category, name: e.name, width: e.width, height: e.height, colors: e.colors, source: 'drawn by formula in this build; no third-party content' })),
  layouts: LAYOUTS.map((l) => ({ id: l.id, name: l.name, count: l.count, slots: l.slots, fill: l.fill, note: 'Apply with apply_layout to that many picture clips. Geometry is checked by formula, not judged on footage.' })),
  speedCurves: SPEED_CURVES.map((c) => ({ id: c.id, name: c.name, hint: c.hint, smooth: c.smooth, segments: c.segments, note: 'Apply with apply_speed_curve. The shapes are this project\'s own, written from descriptions of what such curves do; not matched against another editor.' })),
  motionPresets: MOTION_PRESETS.map((m) => ({ id: m.id, kind: m.kind, name: m.name, defaultFrames: m.defaultFrames, properties: m.properties, note: 'Apply with apply_motion_preset. Written as keyframe recipes; not judged on a video.' })),
  textPresets: TEXT_PRESETS.map((p) => ({ id: p.id, name: p.name, style: p.style, shadow: p.shadow, note: 'Apply with apply_text_preset. Written from descriptions, not judged on a video.' })),
  recipes: describeRecipes(),
  templates: templateCatalog(),
  formatProfiles: FORMAT_PROFILES.map((p) => ({ ...p, note: 'Generic safe-area guide, editable per variant; not a platform specification.' })),
  soundEffects: SFX.map((s) => ({ id: s.id, version: s.version, name: s.name, seconds: s.seconds, category: s.category, source: 'synthesised by formula in this build; no third-party content' })),
  fonts: FONT_CATALOG,
  packs: PACKS.map(summarizePack),
  music: listMusicStyles().map((m) => ({ ...m, note: 'Add with add_builtin_music (POST /api/v1/projects/{id}/music), or as builtinMusic of a template. Synthesised by formula in this build; its beats, bars and sections are known from the recipe. review "unheard": nobody has listened to it yet.' })),
  note: 'This is the complete list for this build; anything not listed here does not exist. Picture entries render through the Canvas2D compositor (GPU passes where listed); sound entries through the shared engine DSP in preview and export alike. audioEffects are effects applied to sound clips (add_audio_effect, apply_audio_preset); soundEffects are sound files of the sound library.',
});

/** Moved to programmeLoudness.ts (wave 7 send pre-pass; worker A's file); re-exported so REST, MCP and tests keep one import. */
export { programmeLoudness } from './programmeLoudness.ts';
import { programmeLoudness } from './programmeLoudness.ts';
/** The output a loudness body names (REST body or a job's stored options): string sequenceId / variantId, anything else ignored as before. */
function loudnessTargetOf(b: unknown): { sequenceId?: string; variantId?: string } {
  const o = b && typeof b === 'object' ? b as { sequenceId?: unknown; variantId?: unknown } : {};
  return { ...(typeof o.sequenceId === 'string' ? { sequenceId: o.sequenceId } : {}), ...(typeof o.variantId === 'string' ? { variantId: o.variantId } : {}) };
}

export const SfxBody = z.object({ sfxId: z.string(), start: RationalTimeSchema.optional().describe('Place it on the timeline at this frame-aligned time (omit to only add it to the media library)'), trackId: z.string().optional() }).strict();
/** Synthesise a built-in sound effect, attach it as a normal asset, and optionally place it. Goes through governance like any edit. */
export const ElementBody = z.object({
  elementId: z.string(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('#RRGGBB; default white'),
  color2: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('#RRGGBB; second colour of two-colour elements'),
  start: RationalTimeSchema.optional().describe('Place it on the timeline at this frame-aligned time (omit to only add it to the media library)'),
  duration: RationalTimeSchema.optional().describe('How long it stays, frame-aligned; default three seconds'),
  trackId: z.string().optional(),
}).strict();
/**
 * Attach a synthesised asset to the project and, when a place on the timeline was asked for, put it there.
 * A refused placement must leave the project as it was. So the placement is tried first on a copy of the current document (the same
 * two operations; nothing is stored), and only when that passes are the import and the placement committed, one straight after the
 * other. They stay two transactions because the import is the trusted internal step every media source uses, while the placement is
 * an ordinary edit that goes through governance. Making the asset took time, so the right to act is checked again before anything
 * is written: an owner who paused agents meanwhile must not find an agent's change dated after the pause.
 */
function attachGenerated(store: Store, gov: Governance, principal: Principal, projectId: string, asset: Omit<Asset, 'id'>, what: 'element' | 'sound', clip: { start: T.RationalTime; duration?: T.RationalTime; trackId?: string } | null) {
  gov.assertMayAct(principal, projectId, 'edit');
  const importOp: OpCall = { op: 'import_asset', args: { asset } };
  const placeOp = (assetId: string, c: NonNullable<typeof clip>): OpCall => ({ op: 'add_clip', args: { assetId, start: c.start, ...(c.duration ? { duration: c.duration } : {}), ...(c.trackId ? { trackId: c.trackId } : {}) } });
  if (clip) {
    try {
      const imported = applyTransaction(store.getProject(projectId).doc, [importOp], { idSeed: 'dryrun-a', actor: principal.actor, allowInternal: true });
      applyTransaction(imported.doc, [placeOp(imported.results[0]!.output!.assetId as string, clip)], { idSeed: 'dryrun-b', actor: principal.actor });
    } catch (e) {
      if (e instanceof OpError) throw new ApiError(e.code === 'forbidden_op' ? 403 : e.code === 'not_found' ? 404 : 422, e.code, e.message, e.details, e.hint); // as Store.commit reports it
      throw e;
    }
  }
  const imp = store.commit({ projectId, actor: principal.actor, label: `Add ${what} ${asset.name}`, allowInternal: true, ops: [importOp] });
  const assetId = imp.results[0]!.output!.assetId as string;
  if (!clip) return { assetId, revision: imp.revision, placed: null };
  const placed = gov.commitAs(principal, { projectId, ops: [placeOp(assetId, clip)], label: `Place ${what} ${asset.name}` }) as { revision?: number; results?: { output?: Record<string, unknown> }[]; proposal?: unknown };
  return { assetId, revision: placed.revision ?? imp.revision, placed: placed.results?.[0]?.output ?? null, ...(placed.proposal ? { proposal: placed.proposal } : {}) };
}

/** Make a graphic element (see list_catalog → elements) as a PNG image asset and optionally place it as an ordinary picture clip. */
export async function addElement(store: Store, gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof ElementBody>) {
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'add media to the library');
  const asset = await makeElement(store, a.elementId, { ...(a.color ? { color: a.color } : {}), ...(a.color2 ? { color2: a.color2 } : {}) }, principal.actor);
  const rate = store.getProject(projectId).doc.settings.frameRate;
  return attachGenerated(store, gov, principal, projectId, asset, 'element', a.start ? { start: a.start, duration: a.duration ?? T.frameTime(Math.round((3 * rate.num) / rate.den), rate), ...(a.trackId ? { trackId: a.trackId } : {}) } : null);
}

export async function addSfx(store: Store, gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof SfxBody>) {
  gov.assertMayAct(principal, projectId, 'edit'); // same rule as uploading media: needs edit rights and agents must not be paused
  gov.assertUnrestricted(principal, 'add media to the library');
  const asset = await makeSfx(store, a.sfxId, principal.actor);
  return attachGenerated(store, gov, principal, projectId, asset, 'sound', a.start ? { start: a.start, ...(a.trackId ? { trackId: a.trackId } : {}) } : null);
}

/**
 * GET /api/v1/packs/suggest and MCP suggest_packs: the packs to suggest on `date`, nearest first (core suggestPacks). With a
 * project, the birthdays of its people are hints (core birthdayHints), read through the store as the credential may read
 * them: a credential without the people scope reads no birth dates, so its answer never depends on one.
 */
export function packSuggestions(store: Store, gov: Governance, p: Principal, date: string, projectId?: string) {
  if (!WALL_DATE.test(date) || !isRealWallDate(date)) throw new ApiError(400, 'invalid_request', 'date must be a real day written YYYY-MM-DD (the day on the viewer\'s own clock)', { date: date.slice(0, 32) });
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const today = { y, m, d };
  let hints: ReturnType<typeof birthdayHints> = [];
  let birthdays: 'none' | 'not_readable' | 'used' = 'none';
  if (projectId !== undefined) {
    gov.assertMayAct(p, projectId, 'observe');
    const doc = store.getProject(projectId).doc;
    hints = birthdayHints(doc.people, today);
    const people = Object.values(doc.people ?? {});
    birthdays = hints.length ? 'used' : people.length && peopleAccess(p) !== 'full' ? 'not_readable' : 'none';
  }
  return {
    suggestions: suggestPacks(PACKS, today, hints), birthdays,
    note: birthdays === 'not_readable' ? 'This credential may not read birth dates, so the people\'s birthdays were not looked at; packs are suggested from the date only.' : 'Packs whose occasion is near this day, nearest first. A dismissal is the viewer\'s own preference; nothing is stored.',
  };
}

const secs = (t: T.RationalTime) => Number(T.toSeconds(t).toFixed(6));
export const analysisView = (a: Analysis) => ({
  assetId: a.assetId, note: 'Times are in the source media. Correct them with edit_analysis; use split_at_scenes to cut a clip into its shots.',
  ...(a.scenes ? { scenes: { ...a.scenes.origin, count: a.scenes.cuts.length, cuts: a.scenes.cuts, cutSeconds: a.scenes.cuts.map(secs) } } : {}),
  ...(a.beats ? { beats: { ...a.beats.origin, bpm: a.beats.bpm, confidence: a.beats.confidence, count: a.beats.beats.length, beatSeconds: a.beats.beats.map(secs), ...(a.beats.downbeats?.length ? { meter: a.beats.meter ?? null, barCount: a.beats.downbeats.length, downbeatSeconds: a.beats.downbeats.map(secs) } : {}) } } : {}),
});
/**
 * What GET …/assets/{id}/analysis and get_analysis answer for an asset, by the rule every reader follows (core lineage.ts): its own
 * scene cuts and beats, or those of the nearest time-preserving source it is a copy of, on the asset's OWN clock (rational
 * subtraction of the lineage offset; of a source's cuts and beats only those inside the copy). `measuredOn` then names, per kind,
 * the asset whose record it is and the offset (that asset's time = this asset's time + offset), which is where a correction
 * belongs: edit_analysis writes the record of the asset it names. null when the asset is not in the project or has neither: also a
 * copy made without a recorded time mapping (reversed, stretched, generated), whose next step is to measure it itself.
 */
export function analysisViewOf(doc: ProjectDocument, assetId: string) {
  if (!Object.hasOwn(doc.assets, assetId)) return null;
  const s = ownSceneCuts(doc, assetId), n = beatNumbers(doc, assetId);
  if (!s && !n) return null;
  const inside = (t: T.RationalTime) => !T.isNegative(t) && T.lt(t, doc.assets[assetId]!.duration);
  const b = n?.own, mine = b?.assetId === assetId;
  const view = analysisView({
    assetId,
    ...(s ? { scenes: { origin: doc.analyses[s.assetId]!.scenes!.origin, cuts: [...s.cuts] } } : {}),
    ...(b ? { beats: mine ? b.analysis : { origin: b.analysis.origin, bpm: b.analysis.bpm, confidence: b.analysis.confidence, beats: b.beats.filter(inside), ...(b.analysis.downbeats?.length ? { downbeats: b.downbeats.filter(inside), meter: b.analysis.meter ?? null } : {}) } } : {}),
  });
  const from = (id: string, offset: T.RationalTime) => ({ assetId: id, offset: T.normalize(offset), offsetSeconds: secs(offset) });
  const measuredOn = { ...(s && s.assetId !== assetId ? { scenes: from(s.assetId, s.offset) } : {}), ...(b && !mine ? { beats: from(b.assetId, b.offset) } : {}) };
  if (!Object.keys(measuredOn).length) return view;
  return { ...view, note: 'Times are in this asset\'s own media. They were measured on the asset named in measuredOn, of which this asset is a copy that keeps the timing; that asset\'s time = this time + offset. Correct them there with edit_analysis (it corrects every copy that keeps the timing); use split_at_scenes to cut a clip into its shots.', measuredOn };
}
export const AnalyzeBody = z.object({ kind: z.enum(['scenes', 'beats']), overwrite: z.boolean().optional().describe('Required to replace a result that was corrected by hand'), threshold: z.number().min(0.05).max(0.9).optional().describe('scenes only: how different two frames must be to count as a cut (default 0.3; lower finds more)') }).strict();
/** Everything that can be refused before measuring starts: permissions, the asset, hand-made corrections, the right kind of media. */
function checkAnalysis(store: Store, gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }) {
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'change analysis data');
  assertAnalysable(store, projectId, a);
}
/** The refusal to measure the beats of built-in music (ADR-0022), whose beats, bars and sections are known from its recipe. */
export const knownByConstruction = () => new ApiError(409, 'known_by_construction', 'the beats of this built-in music are known from its recipe; measuring them would replace exact beats, bars and sections with an estimate', { kind: 'beats' }, 'Nothing needs measuring. Pass overwrite=true to measure it anyway.');
function assertAnalysable(store: Store, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }) {
  const p = store.getProject(projectId);
  const asset = p.doc.assets[a.assetId];
  if (!asset) throw new ApiError(404, 'not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
  // The asset's OWN record on purpose, not its lineage (core lineage.ts): measuring replaces the record of the file it names. A
  // copy that is measured itself gets its own record (the next step offered for a copy without a recorded time mapping); its
  // source's record and the corrections in it stay as they are. Pinned in analysisLineage.test.ts.
  const existing = a.kind === 'scenes' ? p.doc.analyses?.[a.assetId]?.scenes : p.doc.analyses?.[a.assetId]?.beats;
  if (existing?.origin.edited && !a.overwrite) throw new ApiError(409, 'would_discard_edits', 'this result was corrected by hand; analysing again would discard those corrections', { kind: a.kind }, 'Pass overwrite=true to replace it.');
  // Built-in music (ADR-0022): its beats, bars and sections are known from the recipe. A measurement would replace them with
  // an estimate (the tracker can lock half a beat off or at double tempo) and drop the sections.
  if (a.kind === 'beats' && !a.overwrite && isBuiltinMusic(asset) && isKnownGrid(p.doc.analyses?.[a.assetId]?.beats)) throw knownByConstruction();
  if (a.kind === 'scenes' && !asset.video) throw new ApiError(422, 'no_video', 'this asset has no moving picture to analyse');
  if (a.kind === 'beats' && !asset.audio) throw new ApiError(422, 'no_audio', 'this asset has no audio to analyse');
  return asset;
}
/** Measure, then attach the result through a normal (internal) operation. Returns null when `abandoned()` says the caller no longer wants the result. */
async function measureAndAttach(store: Store, actor: string, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }, abandoned: () => boolean = () => false) {
  const asset = assertAnalysable(store, projectId, a);
  const file = store.blobPath(asset.contentHash);
  let args: Record<string, unknown>;
  if (a.kind === 'scenes') {
    const threshold = a.threshold ?? 0.3;
    args = { method: 'ffmpeg scene score (hard cuts only; dissolves are not detected)', params: { threshold }, times: await heavy(() => detectScenes(file, threshold, asset.video!.frameRate, timeOriginSeconds(asset))) };
  } else {
    const seconds = T.toSeconds(asset.duration);
    const r = await heavy(() => detectBeatsOfFile(file, timeOriginSeconds(asset), seconds));
    // Long files are analysed in 20-minute windows; beyond four hours only the first four are analysed. Both are said in the stored result.
    const partial = seconds > BEAT_TOTAL_MAX_SECONDS + 1;
    args = { method: `spectral-flux onsets + dynamic-programming beat tracking (no model); assumes a steady pulse${r.downbeats.length ? `; bar starts from the loudest beat of each bar (found in ${Math.round(r.barConfidence * 100)}% of the bars)` : '; no regular bar accent found'}${r.windows > 1 ? `; analysed in ${r.windows} consecutive ${BEAT_MAX_SECONDS / 60}-minute windows, each with its own tempo` : ''}${partial ? `; ONLY THE FIRST ${BEAT_TOTAL_MAX_SECONDS / 3600} HOURS were analysed` : ''}`, params: { sampleRate: 22050, hop: 256, ...(r.windows > 1 ? { windows: r.windows } : {}), ...(partial ? { analysedSeconds: BEAT_TOTAL_MAX_SECONDS } : {}) }, times: r.beats.filter((x) => x <= seconds).map((x) => T.fromSeconds(x.toFixed(3))), bpm: r.bpm, confidence: r.confidence, ...(r.downbeats.length ? { downbeats: r.downbeats.filter((x) => x <= seconds).map((x) => T.fromSeconds(x.toFixed(3))), meter: r.meter } : {}) };
  }
  if (abandoned()) return null;
  // Measuring can take a while: the asset may be gone, or the result corrected by hand, since it started.
  assertAnalysable(store, projectId, a);
  const r = store.commit({ projectId, actor, label: a.kind === 'scenes' ? 'Find scene cuts' : 'Find beats', allowInternal: true, ops: [{ op: 'attach_analysis', args: { assetId: a.assetId, kind: a.kind, createdAt: new Date().toISOString(), ...args } }] });
  return { revision: r.revision, summary: r.summary, ...analysisView(store.getProject(projectId).doc.analyses[a.assetId]!) };
}
/** Measure scene cuts or beats from the source file and attach the result to the project as editable data (inside the request). */
export async function analyzeAsset(store: Store, gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }) {
  checkAnalysis(store, gov, principal, projectId, a);
  return (await measureAndAttach(store, principal.actor, projectId, a))!;
}

/**
 * The same analysis as a durable job, for media too long to measure inside one request. The job row survives a restart
 * (it is measured again from the start); the result is attached exactly as in the synchronous path.
 */
export function startAnalysisJob(store: Store, gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }): JobRow {
  checkAnalysis(store, gov, principal, projectId, a);
  const job = store.createJob(projectId, 'analysis', principal.actor, { assetId: a.assetId, kind: a.kind, ...(a.threshold !== undefined ? { threshold: a.threshold } : {}), ...(a.overwrite ? { overwrite: true } : {}), projectRevision: store.getProject(projectId).revision });
  void runAnalysisJob(store, job.id);
  return store.getJob(job.id);
}
/** The exporter colour-match measurements render their stills with (set by createApp, so recovered jobs have it too). */
let measurementExporter: Exporter | null = null;
export function setMeasurementExporter(exporter: Exporter): void { measurementExporter = exporter; }
const exporterForMeasurement = (): Exporter => {
  if (!measurementExporter) throw new ApiError(503, 'unavailable', 'colour match needs the renderer, which is not running in this process');
  return measurementExporter;
};
export type MeasurementKind = 'silences' | 'loudness' | 'voice' | 'colour' | typeof SHORTS_MEASUREMENT_KIND | 'clip-loudness';
/** Start a silence, loudness, voice (ADR-0013), colour-match (ADR-0014) or shorts-candidates (ADR-0018) measurement as a durable job of type `analysis`. It changes nothing in the project; its output carries the same object the in-request route returns. */
export function startMeasurementJob(store: Store, principal: Principal, projectId: string, kind: MeasurementKind, options: unknown): JobRow {
  const p = store.getProject(projectId); // 404 before any job exists
  if (kind === 'silences' && !p.doc.assets[(options as { assetId: string }).assetId]) throw new ApiError(404, 'asset_not_found', 'asset not found in this project');
  if (kind === 'voice' && !findClip(p.doc, (options as { clipId: string }).clipId)) throw new ApiError(404, 'not_found', 'clip not found in this project', { clipId: (options as { clipId: string }).clipId });
  const job = store.createJob(projectId, 'analysis', principal.actor, { kind, options, projectRevision: p.revision });
  void runAnalysisJob(store, job.id);
  return store.getJob(job.id);
}
async function runAnalysisJob(store: Store, jobId: string) {
  if (store.getJob(jobId).status !== 'queued') return;
  if (store.getJob(jobId).input?.kind === MULTICAM_SYNC_KIND) return runMulticamSyncJob(store, jobId); // multicam (ADR-0020): its own runner
  store.updateJob(jobId, { status: 'running', stage: 'measuring' });
  const j = store.getJob(jobId);
  try {
    // Measurements that attach nothing to the project (silence candidates, programme loudness, voice and colour checks): the result is the job's output.
    if (j.input.kind === 'silences' || j.input.kind === 'loudness' || j.input.kind === 'voice' || j.input.kind === 'colour' || j.input.kind === SHORTS_MEASUREMENT_KIND || j.input.kind === 'clip-loudness') {
      const kind = j.input.kind as MeasurementKind;
      const result = kind === 'silences' ? await findSilences(store, j.projectId, j.input.options)
        : kind === 'loudness' ? await programmeLoudness(store, j.projectId, loudnessTargetOf(j.input.options))
        // shorts (ADR-0018): measure the audio features that are missing, then rank; stops between windows once cancel is requested
        : kind === SHORTS_MEASUREMENT_KIND ? await withShortsErrors(() => findShortCandidates(store, j.projectId, FindShortsBodySchema.parse(j.input.options), () => store.getJob(jobId).status === 'cancel-requested'))
        : kind === 'clip-loudness' ? await measureClipLoudness(store, j.projectId, ClipLoudnessBody.parse(j.input.options), () => store.getJob(jobId).status === 'cancel-requested')
        : kind === 'voice' ? await measureVoiceCheck(store, j.projectId, VoiceMeasureBody.parse(j.input.options))
        : await matchColour(store, exporterForMeasurement(), j.projectId, ColourMatchBody.parse(j.input.options));
      if (store.getJob(jobId).status === 'cancel-requested') { store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled while measuring; the result was discarded' } }); return; }
      store.updateJob(jobId, { status: 'succeeded', stage: null, output: { kind: j.input.kind, result } });
      return;
    }
    const r = await measureAndAttach(store, j.actor, j.projectId, j.input, () => store.getJob(jobId).status === 'cancel-requested');
    if (!r) { store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled while measuring; the result was discarded' } }); return; }
    store.updateJob(jobId, { status: 'succeeded', stage: null, output: { kind: j.input.kind, assetId: j.input.assetId, revision: r.revision, scenes: r.scenes ? { count: r.scenes.count } : undefined, beats: r.beats ? { count: r.beats.count, bpm: r.beats.bpm, confidence: r.beats.confidence } : undefined } });
  } catch (e) {
    if (!(e instanceof ApiError)) console.error(e);
    store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'analysis failed unexpectedly' } });
  }
}
/** Analysis jobs that were queued or running when the process stopped are measured again. */
export function recoverAnalysisJobs(store: Store): number {
  const jobs = store.recoverJobs('analysis');
  for (const j of jobs) void runAnalysisJob(store, j.id);
  return jobs.length;
}
export function cancelAnalysisJob(store: Store, jobId: string, actor: string) {
  const j = store.getJob(jobId);
  if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
  if (j.status === 'queued') { store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor} before it started` } }); return { jobId, status: 'canceled', outcome: 'removed-from-queue' }; }
  store.updateJob(jobId, { status: 'cancel-requested' });
  return { jobId, status: 'cancel-requested', outcome: 'result-will-be-discarded', note: 'the measurement in progress runs to its end; its result is not attached' };
}

/**
 * A finished export is a film rendered from the WHOLE document of its snapshot. A credential without the people scope may not
 * take one whose snapshot holds an age field, nor start it again (ADR-0021, people section; peoplePrivacy.ts rule 2b). The
 * same check for REST and MCP. Other kinds of job hold no rendered film.
 */
export function assertMayTakeJobOutput(p: Principal, job: JobRow, what: string): void {
  if (job.type === 'export' && job.input?.snapshot) assertMayTakeRendered(p, job.input.snapshot as ProjectDocument, what);
}
/**
 * Cancelling is an action: a paused agent may not do it, and an agent may only cancel jobs it started. The owner may cancel any job.
 * One exception, for REST and MCP alike: an export the owner's editor tab renders (the browser route) has no agent that started
 * it, so an agent may stop it when its grant lets it run jobs on that project (edit or autopilot, not paused) and is not limited
 * to certain tracks or a time range (the export is the whole project). Stopping one publishes nothing; the owner can start it again.
 * A language-assistant request (assistant.propose, ADR-0027) is the owner's own: no agent credential cancels it, whatever its grant.
 * It is refused here, after the checks every cancel makes (project in scope, not paused, a grant that runs jobs), with its own
 * reason and next step (assistant/routes.ts assistantCancelRefusal), the same for REST and MCP.
 */
export function assertMayCancel(gov: Governance, p: Principal, job: JobRow) {
  // the speech engine install runs software on the owner's computer: only the owner's own session stops it (REST and MCP alike)
  if (job.type === SPEECH_ENGINE_JOB_TYPE && !actsAsOwner(p)) throw new ApiError(403, 'owner_required', 'the speech engine install is stopped only from the owner\'s own editor window', { jobId: job.id }, 'Ask the owner to cancel it in the speech panel.');
  if (ownerKeeps(p)) return;
  gov.assertMayAct(p, job.projectId, 'job'); // paused (the owner's brake) and project limits hold for open agents too
  if (actsAsOwner(p)) return; // A10/A22: an open agent cancels any job, the assistant's included
  if (job.type === ASSISTANT_JOB_TYPE) throw assistantCancelRefusal(job.id);
  if (job.actor === p.actor) return;
  if (job.type === 'export' && job.input?.route === 'browser' && !job.actor.startsWith('agent:')) { gov.assertUnrestricted(p, 'stop an export of the whole project'); return; }
  throw new ApiError(403, 'not_your_job', 'agents can only cancel jobs they started', { jobId: job.id, startedBy: job.actor }, 'Ask the owner to cancel it, or cancel only jobs this credential started.');
}
