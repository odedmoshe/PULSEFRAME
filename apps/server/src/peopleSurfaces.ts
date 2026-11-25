/**
 * EVERY surface an agent credential can reach, and how people data is filtered on it (ADR-0021, people section; the owner's
 * conditions of 2026-11-17). The helpers that do the filtering are all in peoplePrivacy.ts; this table says which of them
 * guards which surface. peopleSurfaces.test.ts keeps it complete both ways (every registered REST route and every MCP tool
 * and resource is listed, nothing listed is gone) and walks every listed surface with a planted birth date
 * (peoplePrivacy.test.ts), so a new route or tool cannot be added without being classified here.
 *
 * THE RULE AN AGENT LIVES BY (what the people sheet's privacy line says, apps/web/src/editor/lifeline/people.strings.ts):
 * a credential without the people scope ('names', the default for every agent; peoplePrivacy.ts peopleAccess) receives
 * the id and the name of each person and NOTHING computed from a birth date: no birth date, no word choice, no age in any
 * answer, still, contact sheet, describe_moment, preflight range, proposal or event, and no film or browser-export
 * document of a project whose titles show an age. The AGE ORACLE (an agent that edits capture dates and reads the resolved
 * age at two dates can solve for the birth date) is therefore closed, not just stated: for such a credential every age
 * field resolves to no words whatever the capture date, exactly as for a person without a birth date
 * (preflight.fields.ts says "none was entered, or this credential may not read birth dates"), so nothing an agent can do
 * changes what it sees. It may not GIVE a birth date or a word choice either (assertMayWritePeople), so a refusal such as
 * "the person already has these details" cannot answer guesses. What stays visible is ordinary text a person wrote: an age
 * the owner made plain text («קבע כטקסט רגיל»), or typed into a title or an event name, and the capture dates of files.
 *
 * Classes (one or more per surface):
 *  reader-document  answer computed from Store.getProject / Store.replay, which hand the request's credential the document
 *                   without birth dates and word choices (peoplePrivacy.ts docForReader, set by readingAs at the REST
 *                   middleware and the MCP entry). Covers the evaluator: stills, describe_moment, preflight, export plans.
 *  rows-scrubbed    stored rows that are not a document read (proposals: entity states and operation arguments) pass
 *                   forPrincipal before they are answered.
 *  event-scrubbed   server-sent events: each event passes forPrincipal for the credential that LISTENS.
 *  op-log           revision events / history: summary sentences (people summaries name the person only, core
 *                   peopleOps.ts PERSON_SUMMARIES), operation names and ids; never arguments or entity states.
 *  write            commits, dry runs and proposals: assertMayWritePeople refuses a birth date or word choice from a
 *                   'names' credential; the operations run on the whole stored document (Store.commit reads
 *                   wholeProject), and the answer (summaries, ids, outputs) holds no birth date by construction.
 *  rendered-refused a film (or the document a browser renders one from) of a document whose titles show an age is refused
 *                   to a 'names' credential (assertMayTakeRendered / http.ts assertMayTakeJobOutput).
 *  archive          planArchive reads through the store (names only for a 'names' credential); family=omit writes no
 *                   people at all (withoutFamily); the manifest says which.
 *  owner-only       answers the owner's own session only (403 owner_required, or owner(c), for every agent credential).
 *  no-document      answers hold nothing from a project document's people (settings, catalogs, media bytes, job status,
 *                   presence, storage, grants).
 *  renderer-only    the render-session routes of the headless renderer, reached with a session token the server gives
 *                   only to its own renderer process, never to a credential.
 *  json-net         (every REST answer, so not repeated per row) for a 'names' credential every JSON answer of
 *                   /api/v1/* passes scrubPeople before it leaves (http.ts middleware); every MCP tool and resource
 *                   answer passes forPrincipal (mcp.ts text, mcpResources.ts json). A net, never the only guard of a
 *                   surface that reads people.
 */
export const PEOPLE_FILTERS = ['reader-document', 'rows-scrubbed', 'event-scrubbed', 'op-log', 'write', 'rendered-refused', 'archive', 'owner-only', 'no-document', 'renderer-only'] as const;
export type PeopleFilter = (typeof PEOPLE_FILTERS)[number];

const P = '/api/v1/projects/:id';
/** REST routes, `METHOD path` as Hono registers them. */
export const PEOPLE_REST_SURFACES: Readonly<Record<string, readonly PeopleFilter[]>> = {
  // the headless renderer
  'GET /api/v1/render/:token/snapshot': ['renderer-only'],
  'GET /api/v1/render/:token/assets/:assetId': ['renderer-only'],
  'POST /api/v1/render/:token/frames': ['renderer-only'],
  // session, server, catalogs
  'GET /api/v1/session': ['no-document'],
  'GET /api/v1/whoami': ['no-document'],
  'GET /api/v1/openapi.json': ['no-document'],
  'GET /api/v1/ops': ['no-document'],
  'GET /api/v1/catalog': ['no-document'],
  'GET /api/v1/elements': ['no-document'],
  'GET /api/v1/templates': ['no-document'],
  'GET /api/v1/capabilities': ['no-document'],
  'POST /api/v1/capabilities/import': ['no-document'],
  'GET /api/v1/speech': ['no-document'],
  'GET /api/v1/sfx/:sfxId/audio': ['no-document'],
  'GET /api/v1/packs': ['no-document'],
  // with projectId the birthdays of its people are hints: read through the store, so without birth dates for a 'names' credential
  'GET /api/v1/packs/suggest': ['reader-document'],
  'GET /api/v1/music': ['no-document'],
  'GET /api/v1/music/:styleId/audio': ['no-document'],
  'GET /api/v1/storage': ['no-document'],
  'POST /api/v1/storage/gc': ['no-document'],
  'GET /api/v1/backup': ['no-document'],
  'POST /api/v1/backup': ['owner-only'],
  'GET /api/v1/grants': ['owner-only'],
  'POST /api/v1/grants': ['owner-only'],
  'POST /api/v1/grants/:grantId/revoke': ['owner-only'],
  // owner-only reads across projects
  'GET /api/v1/on-this-day': ['owner-only'],
  'GET /api/v1/people-suggestions': ['owner-only'],
  // projects
  'GET /api/v1/projects': ['no-document'],
  'POST /api/v1/projects': ['no-document'],
  'POST /api/v1/projects/import': ['no-document'],
  [`GET ${P}`]: ['reader-document'],
  [`POST ${P}/delete`]: ['no-document'],
  [`GET ${P}/summary`]: ['reader-document'],
  [`GET ${P}/timeline`]: ['reader-document'],
  [`GET ${P}/transcripts/:assetId`]: ['reader-document'],
  [`GET ${P}/captions`]: ['reader-document'],
  [`GET ${P}/preflight`]: ['reader-document'],
  [`GET ${P}/frame`]: ['reader-document'],
  [`GET ${P}/history`]: ['op-log'],
  [`GET ${P}/events`]: ['event-scrubbed'],
  [`GET ${P}/archive`]: ['archive'],
  [`GET ${P}/archive/family-check`]: ['owner-only'],
  [`GET ${P}/controls`]: ['no-document'],
  [`POST ${P}/agents/pause`]: ['owner-only'],
  [`POST ${P}/agents/resume`]: ['owner-only'],
  [`GET ${P}/presence`]: ['no-document'],
  [`PUT ${P}/presence`]: ['no-document'],
  // media
  [`POST ${P}/assets`]: ['no-document'],
  [`GET ${P}/assets/:assetId/content`]: ['no-document'],
  [`GET ${P}/missing-media`]: ['reader-document'], // asset ids only, from the document the credential may read
  [`GET ${P}/assets/:assetId/derivatives`]: ['no-document'],
  [`GET ${P}/assets/:assetId/derivatives/:kind`]: ['no-document'],
  [`GET ${P}/assets/:assetId/analysis`]: ['reader-document'],
  [`POST ${P}/assets/:assetId/analyze`]: ['reader-document'],
  [`POST ${P}/assets/:assetId/transcribe`]: ['reader-document'],
  [`POST ${P}/transcribe`]: ['reader-document'],
  [`POST ${P}/captures/read`]: ['write'],
  [`POST ${P}/analysis/colour-match`]: ['reader-document'],
  [`POST ${P}/analysis/fillers`]: ['reader-document'],
  [`POST ${P}/analysis/loudness`]: ['reader-document'],
  [`POST ${P}/analysis/silences`]: ['reader-document'],
  [`POST ${P}/analysis/voice`]: ['reader-document'],
  [`GET ${P}/motion-tracks/:motionTrackId`]: ['reader-document'],
  [`POST ${P}/motion-tracks/:motionTrackId/track`]: ['reader-document', 'write'],
  // stabilisation (wave 7): the job reads the document and commits; the read view reads it
  [`POST ${P}/clips/:clipId/stabilise`]: ['reader-document', 'write'],
  [`GET ${P}/assets/:assetId/camera-motion`]: ['reader-document'],
  // measured moments (ADR-0026): the job reads media, attaches analyses; nothing about people
  [`POST ${P}/moments`]: ['reader-document', 'write'],
  // edits
  [`POST ${P}/transactions`]: ['write'],
  [`POST ${P}/operations`]: ['write'],
  [`POST ${P}/operations/validate`]: ['write'],
  [`POST ${P}/undo`]: ['write'],
  [`POST ${P}/redo`]: ['write'],
  [`POST ${P}/elements`]: ['write'],
  [`POST ${P}/sfx`]: ['write'],
  [`POST ${P}/music`]: ['write'],
  [`POST ${P}/narration`]: ['reader-document', 'write'],
  [`POST ${P}/narration/script`]: ['reader-document', 'write'],
  [`POST ${P}/recipes/:recipeId/plan`]: ['reader-document'],
  [`POST ${P}/recipes/:recipeId/apply`]: ['reader-document', 'write'],
  [`POST ${P}/recipe-runs/:runId/regenerate`]: ['reader-document', 'write'],
  [`POST ${P}/templates/:templateId/plan`]: ['reader-document'],
  [`POST ${P}/templates/:templateId/apply`]: ['reader-document', 'write'],
  [`POST ${P}/template-runs/:runId/regenerate`]: ['reader-document', 'write'],
  [`POST ${P}/variants/:variantId/translation/review`]: ['owner-only'],
  // shorts (ADR-0018): computed from the reader's document (transcript quotes, measured values, sequence summaries; no people data)
  [`GET ${P}/sequences`]: ['reader-document'],
  [`POST ${P}/shorts/candidates`]: ['reader-document'],
  [`POST ${P}/shorts/plan`]: ['reader-document'],
  [`POST ${P}/shorts`]: ['reader-document', 'write'],
  // multicam (ADR-0020): sync measured from media (attaches maps, no people data), the group view from the reader's document, a media derivative
  [`POST ${P}/multicam/:groupId/sync`]: ['reader-document', 'write'],
  [`GET ${P}/multicam/:groupId`]: ['reader-document'],
  [`POST ${P}/assets/:assetId/derivatives/envelope`]: ['no-document'],
  [`POST ${P}/sequences/:sequenceId/reframe-plan`]: ['reader-document'],
  // perform mode (ADR-0025): planned from the reader's document (clips, beats; no people data), committed as one internal step
  [`POST ${P}/takes`]: ['reader-document', 'write'],
  // the command bar's language assistant (ADR-0027): the status holds settings, ids and money for the owner's own session, and
  // connected-or-not for anyone else (assistant/visibility.ts); everything else is the owner's own session (a model is sent only
  // the allowlisted summary, built without birth dates whatever the switches)
  'GET /api/v1/assistant/status': ['no-document'],
  [`GET ${P}/assistant/summary`]: ['owner-only'],
  'PUT /api/v1/assistant/config': ['owner-only'],
  'PUT /api/v1/assistant/key': ['owner-only'],
  'DELETE /api/v1/assistant/key': ['owner-only'],
  [`POST ${P}/assistant/requests`]: ['owner-only'],
  // proposals and approvals
  [`GET ${P}/proposals`]: ['rows-scrubbed'],
  [`POST ${P}/proposals`]: ['write'],
  [`GET ${P}/proposals/:proposalId`]: ['rows-scrubbed'],
  [`GET ${P}/proposals/:proposalId/frame`]: ['reader-document'],
  [`POST ${P}/proposals/:proposalId/accept`]: ['owner-only'],
  [`POST ${P}/proposals/:proposalId/reject`]: ['owner-only'],
  [`GET ${P}/approvals`]: ['no-document'],
  [`POST ${P}/approvals/:approvalId/approve`]: ['owner-only'],
  [`POST ${P}/approvals/:approvalId/reject`]: ['owner-only'],
  // capabilities (provider jobs take files of the library; their results enter as operations)
  [`GET ${P}/capabilities/:capabilityId/estimate`]: ['reader-document'],
  [`POST ${P}/capabilities/:capabilityId/runs`]: ['reader-document', 'write'],
  [`POST ${P}/capabilities/:capabilityId/models/request`]: ['no-document'],
  [`POST ${P}/capabilities/:capabilityId/models/download`]: ['no-document'],
  [`POST ${P}/speech/models/:modelId/download`]: ['no-document'],
  // exports and jobs
  [`POST ${P}/exports/plan`]: ['reader-document'],
  [`POST ${P}/exports`]: ['rendered-refused', 'reader-document'],
  [`POST ${P}/exports/batch`]: ['rendered-refused', 'reader-document'],
  [`POST ${P}/exports/browser`]: ['rendered-refused', 'reader-document'],
  'GET /api/v1/jobs/:jobId': ['no-document'],
  'GET /api/v1/jobs/:jobId/output': ['rendered-refused'],
  'GET /api/v1/jobs/:jobId/captions': ['no-document'],
  'GET /api/v1/jobs/:jobId/outputs/:index': ['no-document'],
  'POST /api/v1/jobs/:jobId/retry': ['rendered-refused'],
  'POST /api/v1/jobs/:jobId/cancel': ['no-document'],
  'POST /api/v1/jobs/:jobId/budget/release': ['owner-only'],
  'POST /api/v1/jobs/:jobId/heartbeat': ['no-document'],
  'POST /api/v1/jobs/:jobId/complete': ['no-document'],
  'POST /api/v1/jobs/:jobId/abandon': ['no-document'],
  // the content library on disk (wave 7 library track; library/contract.ts LIBRARY_ROUTES): the catalogue holds no project
  // document; the folder is the owner's; use reads the document for its dry run and commits; credits read the document
  'GET /api/v1/library/status': ['no-document'],
  'PUT /api/v1/library/root': ['owner-only'],
  'POST /api/v1/library/reindex': ['owner-only'],
  'DELETE /api/v1/library/reindex': ['owner-only'],
  'GET /api/v1/library/items': ['no-document'],
  'GET /api/v1/library/items/:key': ['no-document'],
  'GET /api/v1/library/items/:key/licence': ['no-document'],
  'GET /api/v1/library/items/:key/audio': ['no-document'],
  'GET /api/v1/library/items/:key/thumb': ['no-document'],
  [`POST ${P}/library/use`]: ['reader-document', 'write'],
  [`GET ${P}/credits`]: ['reader-document'],
  // MCP over HTTP: see PEOPLE_MCP_TOOLS and PEOPLE_MCP_RESOURCES
  'ALL /mcp': ['reader-document'],
};

/**
 * MCP tools besides one tool per public operation (each of those is class 'write': it commits through Governance.commitAs).
 * Every answer passes forPrincipal (mcp.ts text) and every tool runs inside readingAs.
 */
export const PEOPLE_MCP_TOOLS: Readonly<Record<string, readonly PeopleFilter[]>> = {
  list_projects: ['no-document'], get_summary: ['reader-document'], get_timeline: ['reader-document'], describe_ops: ['no-document'],
  apply_transaction: ['write'], undo: ['write'], redo: ['write'], propose_transaction: ['write'], list_proposals: ['rows-scrubbed'],
  describe_moment: ['reader-document'], get_transcript: ['reader-document'], export_captions: ['reader-document'], list_catalog: ['no-document'],
  add_graphic_element: ['write'], add_sound_effect: ['write'], add_builtin_music: ['write'], suggest_packs: ['reader-document'], get_speech_status: ['no-document'], transcribe_asset: ['reader-document'],
  generate_narration: ['reader-document', 'write'], narrate_script: ['reader-document', 'write'], analyze_asset: ['reader-document'], get_analysis: ['reader-document'],
  track_motion: ['reader-document', 'write'], get_motion_track: ['reader-document'],
  stabilise_clip: ['reader-document', 'write'], get_camera_motion: ['reader-document'],
  measure_moments: ['reader-document', 'write'],
  plan_recipe: ['reader-document'], apply_recipe: ['reader-document', 'write'], regenerate_recipe: ['reader-document', 'write'],
  plan_template: ['reader-document'], apply_template: ['reader-document', 'write'], regenerate_template: ['reader-document', 'write'],
  preflight: ['reader-document'], measure_loudness: ['reader-document'], measure_voice: ['reader-document'], match_colour: ['reader-document'],
  find_filler_words: ['reader-document'], find_silences: ['reader-document'], render_contact_sheet: ['reader-document'], render_frame: ['reader-document'],
  get_controls: ['no-document'], set_view: ['no-document'],
  export_project: ['rendered-refused', 'reader-document'], plan_export: ['reader-document'], retry_job: ['rendered-refused'], get_job: ['no-document'],
  list_capabilities: ['no-document'], run_capability: ['reader-document', 'write'], estimate_capability: ['reader-document'], translate_captions: ['reader-document', 'write'],
  request_model_download: ['no-document'], cancel_job: ['no-document'],
  // shorts (ADR-0018)
  list_sequences: ['reader-document'], find_short_candidates: ['reader-document'], plan_shorts: ['reader-document'], make_shorts: ['reader-document', 'write'],
  plan_reframe: ['reader-document'], export_batch: ['rendered-refused', 'reader-document'],
  // multicam (ADR-0020): sync measured from media (attaches maps, no people data); the group view from the reader's document
  sync_multicam: ['reader-document', 'write'], get_multicam: ['reader-document'],
  // perform mode (ADR-0025)
  perform_take: ['reader-document', 'write'],
  // the content library (wave 7 library track)
  use_library_item: ['reader-document', 'write'], get_credits: ['reader-document'],
};
/** MCP resources and prompts (every resource answer passes forPrincipal; prompts carry no project content). */
export const PEOPLE_MCP_RESOURCES: Readonly<Record<string, readonly PeopleFilter[]>> = {
  'pulseframe://guide': ['no-document'], 'pulseframe://ops': ['no-document'], 'pulseframe://catalog': ['no-document'],
  'pulseframe://projects/{projectId}/summary': ['reader-document'], 'pulseframe://projects/{projectId}/timeline': ['reader-document'],
  'prompts/*': ['no-document'],
};
