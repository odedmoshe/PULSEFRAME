/**
 * OpenAPI 3.1 document, generated from the op registry (describeOps) plus a hand-written route table.
 * Bodies whose zod schemas are module-private in http.ts are described by hand; openapi.test.ts
 * posts documented payloads to a real in-process server to catch drift.
 */
import fs from 'node:fs';
import { describeOps } from '@pulseframe/core';

type J = Record<string, unknown>;
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const ref = (n: string): J => ({ $ref: `#/components/schemas/${n}` });
const json = (schema: J): J => ({ 'application/json': { schema } });
const errResp = (description: string): J => ({ description, content: json(ref('Error')) });
const ERR: Record<string, string> = {
  '400': 'Invalid request', '401': 'Unauthenticated or invalid token', '403': 'Credential lacks the required scope',
  '404': 'Not found', '409': 'Conflict', '422': 'Operation rejected (validation)', '503': 'Provider or service unavailable',
};
const errs = (...codes: string[]): J => Object.fromEntries(codes.map((c) => [c, errResp(ERR[c]!)]));
const pid: J = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Project id' };
const pathParam = (name: string, description: string): J => ({ name, in: 'path', required: true, schema: { type: 'string' }, description });
const bodyOf = (schema: J, required = true): J => ({ required, content: json(schema) });
const idem = { type: 'string', minLength: 1, maxLength: 128 };

interface Route { method: 'get' | 'post' | 'put'; path: string; id: string; scope: 'observe' | 'edit' | 'none'; summary: string; description?: string; extra?: J; parameters?: J[]; requestBody?: J; responses: J; security?: J[] }

export function buildOpenApi(): Record<string, unknown> {
  const ops = describeOps();
  const opItems = ops.map((o) => {
    const { $schema: _s, ...args } = o.argsSchema as J;
    return { type: 'object', title: o.name, description: o.description, required: ['op', 'args'], additionalProperties: false, properties: { op: { const: o.name }, args } };
  });

  const schemas: J = {
    Error: {
      type: 'object', required: ['error'],
      properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object', additionalProperties: true }, hint: { type: 'string' } } } },
    },
    TransactionRequest: {
      type: 'object', additionalProperties: false, required: ['ops'],
      properties: {
        requestId: { type: 'string', maxLength: 128 },
        expectedRevision: { type: 'integer', minimum: 0, description: 'Strict: reject unless this is the current revision' },
        baseRevision: { type: 'integer', minimum: 0, description: 'Revision the caller last saw; the edit is rebased if nothing it depends on changed since' },
        dependsOn: { type: 'array', maxItems: 200, items: { type: 'string' } },
        idempotencyKey: idem,
        label: { type: 'string', maxLength: 200 },
        ops: { type: 'array', minItems: 1, maxItems: 200, items: { oneOf: opItems } },
      },
    },
    CommitResult: {
      type: 'object', required: ['transactionId', 'revision', 'committed', 'replayed', 'affectedIds', 'summary', 'results', 'warnings'],
      properties: {
        transactionId: { type: ['string', 'null'] }, revision: { type: 'integer' }, committed: { type: 'boolean' }, replayed: { type: 'boolean' },
        affectedIds: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
        results: { type: 'array', items: { type: 'object', required: ['op', 'summary', 'affectedIds'], properties: { op: { type: 'string' }, summary: { type: 'string' }, affectedIds: { type: 'array', items: { type: 'string' } }, output: { type: 'object', additionalProperties: true } } } },
        warnings: { type: 'array', items: { type: 'string' } },
        kind: { enum: ['edit', 'undo', 'redo'] }, undoes: { type: 'string' }, rebasedFrom: { type: 'integer' },
      },
    },
    UndoRequest: { type: 'object', additionalProperties: false, properties: { transactionId: { type: 'string' } } },
    NewProject: {
      type: 'object', additionalProperties: false, required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 }, width: { type: 'integer', minimum: 16, maximum: 8192 }, height: { type: 'integer', minimum: 16, maximum: 8192 },
        frameRate: { type: 'object', additionalProperties: false, required: ['num', 'den'], properties: { num: { type: 'integer', exclusiveMinimum: 0 }, den: { type: 'integer', exclusiveMinimum: 0 } } },
      },
    },
    ProjectEnvelope: { type: 'object', required: ['project', 'revision'], properties: { project: { type: 'object', additionalProperties: true, description: 'ProjectDocument' }, revision: { type: 'integer' } } },
    Job: {
      type: 'object', required: ['id', 'projectId', 'type', 'actor', 'status'],
      properties: {
        id: { type: 'string' }, projectId: { type: 'string' }, type: { enum: ['export', 'capability', 'model-download'] }, actor: { type: 'string' }, status: { enum: ['queued', 'running', 'succeeded', 'failed', 'canceled', 'cancel-requested', 'submission-unknown'] },
        stage: { type: ['string', 'null'] }, attempt: { type: 'integer' }, output: {}, error: {}, createdAt: { type: 'string' }, updatedAt: { type: 'string' },
        revision: { type: 'integer' }, capabilityId: { type: 'string' }, capabilityVersion: {}, graphDigest: { type: 'string' }, params: { type: 'object', additionalProperties: true },
      },
    },
    JobAccepted: { type: 'object', required: ['jobId', 'status'], properties: { jobId: { type: 'string' }, status: { type: 'string' }, revision: { type: 'integer' }, type: { type: 'string' } } },
    RationalTime: { type: 'object', additionalProperties: false, required: ['value', 'timescale'], properties: { value: { type: 'string', description: 'Integer ticks as a decimal string' }, timescale: { type: 'integer', exclusiveMinimum: 0 } } },
    RunRequest: {
      type: 'object', additionalProperties: false,
      properties: {
        params: { type: 'object', additionalProperties: true, default: {} }, idempotencyKey: idem,
        attach: { type: 'object', additionalProperties: false, required: ['start'], description: 'Place the primary output on the timeline when the job finishes, if nothing it depends on changed meanwhile', properties: { start: ref('RationalTime'), duration: ref('RationalTime'), trackId: { type: 'string' } } },
        dependsOn: { type: 'array', maxItems: 100, items: { type: 'string' }, description: 'Entity ids the placement depends on; a change to any of them turns the placement into a proposal' },
      },
    },
    DownloadRequest: { type: 'object', additionalProperties: false, required: ['confirmBytes'], properties: { confirmBytes: { type: 'integer', exclusiveMinimum: 0, description: 'Exact byte count shown to the owner; must match the server-computed size' } } },
    Derivative: {
      type: 'object', required: ['kind', 'status'],
      properties: {
        kind: { enum: ['thumbnails', 'waveform', 'proxy'] }, status: { enum: ['queued', 'running', 'ready', 'failed', 'not-applicable'] },
        bytes: { type: ['integer', 'null'] }, mimeType: { type: ['string', 'null'] }, meta: { type: ['object', 'null'], additionalProperties: true }, error: { type: ['string', 'null'] }, updatedAt: { type: 'string' },
      },
    },
    ImportRequest: {
      type: 'object', additionalProperties: false, required: ['id', 'title', 'graph'],
      properties: { id: { type: 'string', pattern: '^[a-z0-9]+(\\.[a-z0-9-]+)+$' }, title: { type: 'string', minLength: 1, maxLength: 120 }, graph: { description: 'Workflow graph to import as a draft; never executed directly' } },
    },
  };

  const okJson = (d: string, s: J): J => ({ description: d, content: json(s) });
  const blob = (d: string, mime: string): J => ({ description: d, content: { [mime]: { schema: { type: 'string', format: 'binary' } } } });
  const rangeable = (d: string, mime: string): J => ({ '200': blob(d, mime), '206': blob('Partial content (Range request)', mime), '416': { description: 'Range not satisfiable' } });
  const P = '/api/v1';

  const routes: Route[] = [
    { method: 'get', path: `${P}/session`, id: 'getSession', scope: 'none', summary: 'Issue a browser session cookie (allow-listed origins only)', security: [], responses: { '200': okJson('Local user principal; sets pf_session cookie', { type: 'object', properties: { actor: { type: 'string' }, scopes: { type: 'array', items: { enum: ['observe', 'edit'] } } } }), ...errs('403') } },
    { method: 'get', path: `${P}/whoami`, id: 'whoami', scope: 'none', summary: 'Resolved principal for the credential', responses: { '200': okJson('Principal', { type: 'object', properties: { actor: { type: 'string' }, kind: { type: 'string' }, scopes: { type: 'array', items: { enum: ['observe', 'edit'] } } } }), ...errs('401') } },
    { method: 'get', path: `${P}/ops`, id: 'listOps', scope: 'observe', summary: 'Describe public operations with JSON Schemas', responses: { '200': okJson('Operations', { type: 'object', required: ['ops'], properties: { ops: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'integer' }, description: { type: 'string' }, argsSchema: { type: 'object' } } } } } }), ...errs('401', '403') } },
    { method: 'get', path: `${P}/projects`, id: 'listProjects', scope: 'observe', summary: 'List projects', responses: { '200': okJson('Projects', { type: 'object', required: ['projects'], properties: { projects: { type: 'array', items: { type: 'object', additionalProperties: true } } } }), ...errs('401', '403') } },
    { method: 'post', path: `${P}/projects`, id: 'createProject', scope: 'edit', summary: 'Create a project', requestBody: bodyOf(ref('NewProject')), responses: { '201': okJson('Created', ref('ProjectEnvelope')), ...errs('400', '401', '403') } },
    { method: 'get', path: `${P}/projects/{id}`, id: 'getProject', scope: 'observe', summary: 'Get a project document, optionally at a past revision', parameters: [pid, { name: 'revision', in: 'query', schema: { type: 'integer', minimum: 0 } }], responses: { '200': okJson('Project', ref('ProjectEnvelope')), ...errs('401', '403', '404') } },
    { method: 'get', path: `${P}/projects/{id}/summary`, id: 'getProjectSummary', scope: 'observe', summary: 'Compact project summary', parameters: [pid], responses: { '200': okJson('Summary (revision plus summary fields)', { type: 'object', required: ['revision'], additionalProperties: true, properties: { revision: { type: 'integer' } } }), ...errs('401', '403', '404') } },
    { method: 'get', path: `${P}/projects/{id}/timeline`, id: 'getProjectTimeline', scope: 'observe', summary: 'Timeline view', parameters: [pid], responses: { '200': okJson('Timeline (revision plus timeline fields)', { type: 'object', required: ['revision'], additionalProperties: true, properties: { revision: { type: 'integer' } } }), ...errs('401', '403', '404') } },
    { method: 'get', path: `${P}/projects/{id}/history`, id: 'getProjectHistory', scope: 'observe', summary: 'Revision events since a revision', parameters: [pid, { name: 'since', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }], responses: { '200': okJson('Events', { type: 'object', required: ['events'], properties: { events: { type: 'array', items: { type: 'object', additionalProperties: true } } } }), ...errs('401', '403', '404') } },
    ...(['transactions', 'operations'] as const).map((seg): Route => ({ method: 'post', path: `${P}/projects/{id}/${seg}`, id: seg === 'transactions' ? 'commitTransaction' : 'commitOperations', scope: 'edit', summary: `Apply a transaction of operations atomically${seg === 'operations' ? ' (alias of /transactions)' : ''}`, parameters: [pid], requestBody: bodyOf(ref('TransactionRequest')), responses: { '200': okJson('Commit result', ref('CommitResult')), ...errs('400', '401', '403', '404', '409', '422') } })),
    { method: 'post', path: `${P}/projects/{id}/operations/validate`, id: 'validateOperations', scope: 'edit', summary: 'Dry-run a transaction without committing', parameters: [pid], requestBody: bodyOf(ref('TransactionRequest')), responses: { '200': okJson('Dry-run result (committed=false)', ref('CommitResult')), ...errs('400', '401', '403', '404', '409', '422') } },
    ...(['undo', 'redo'] as const).map((m): Route => ({ method: 'post', path: `${P}/projects/{id}/${m}`, id: m, scope: 'edit', summary: `${m === 'undo' ? 'Undo' : 'Redo'} the latest (or a named) transaction`, parameters: [pid], requestBody: bodyOf(ref('UndoRequest'), false), responses: { '200': okJson('Commit result', ref('CommitResult')), ...errs('400', '401', '403', '404', '409') } })),
    { method: 'get', path: `${P}/projects/{id}/events`, id: 'streamProjectEvents', scope: 'observe', summary: 'Server-sent events: hello, revision, job, derivative', description: 'Events: `hello` {revision} once on connect; `revision` (id = revision number) for each committed revision, replayed from `since`/Last-Event-ID; `job` {id,type,status,stage,output,error} on job changes in this project; `derivative` {assetId,kind,status} when a derivative changes state.', parameters: [pid, { name: 'since', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Replay revisions after this one (or send Last-Event-ID)' }, { name: 'Last-Event-ID', in: 'header', schema: { type: 'string' } }], responses: { '200': { description: 'Event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }, ...errs('401', '403', '404') } },
    { method: 'post', path: `${P}/projects/{id}/assets`, id: 'uploadAsset', scope: 'edit', summary: 'Upload media (raw body) and import it as an asset', parameters: [pid, { name: 'x-filename', in: 'header', schema: { type: 'string' }, description: 'URI-encoded file name; default "upload"' }], requestBody: { required: true, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, responses: { '201': okJson('Imported', { type: 'object', required: ['assetId', 'revision'], properties: { assetId: { type: 'string' }, revision: { type: 'integer' }, deduplicated: { type: 'boolean' }, asset: { type: 'object', additionalProperties: true } } }), ...errs('400', '401', '403', '404', '422') } },
    { method: 'get', path: `${P}/projects/{id}/assets/{assetId}/content`, id: 'getAssetContent', scope: 'observe', summary: 'Asset bytes (supports Range)', parameters: [pid, pathParam('assetId', 'Asset id')], responses: { ...rangeable('Asset bytes; media type is the asset mimeType', 'application/octet-stream'), ...errs('401', '403', '404') } },
    { method: 'get', path: `${P}/projects/{id}/frame`, id: 'renderFrame', scope: 'observe', summary: 'Render a still frame with the shared evaluator and compositor', parameters: [pid, { name: 'index', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Frame index; takes precedence over seconds' }, { name: 'seconds', in: 'query', schema: { type: 'string' }, description: 'Decimal seconds, default "0"' }], responses: { '200': { description: 'PNG; headers X-PF-Revision and X-PF-Frame-Index', headers: { 'X-PF-Revision': { schema: { type: 'string' } }, 'X-PF-Frame-Index': { schema: { type: 'string' } } }, content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } }, ...errs('400', '401', '403', '404', '503') } },
    { method: 'get', path: `${P}/projects/{id}/assets/{assetId}/derivatives`, id: 'listAssetDerivatives', scope: 'observe', summary: 'Derivatives (thumbnails, waveform, proxy) of an asset; starts them if none exist', parameters: [pid, pathParam('assetId', 'Asset id')], responses: { '200': okJson('Derivative list', { type: 'object', required: ['assetId', 'derivatives'], properties: { assetId: { type: 'string' }, derivatives: { type: 'array', items: ref('Derivative') } } }), ...errs('401', '403', '404') } },
    { method: 'put', path: `${P}/projects/{id}/presence`, id: 'setPresence', scope: 'observe', summary: 'Announce this session\'s playhead and selection (transient; not part of the project)', parameters: [pid], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['sessionId'], properties: { sessionId: { type: 'string', minLength: 1, maxLength: 64 }, frame: { type: ['integer', 'null'], minimum: 0 }, selection: { type: 'array', maxItems: 200, items: { type: 'string' } }, label: { type: 'string', maxLength: 80 } } } } } }, responses: { '200': okJson('Presence entry', { type: 'object' }), ...errs('400', '401', '403', '404') } },
    { method: 'get', path: `${P}/projects/{id}/presence`, id: 'listPresence', scope: 'observe', summary: 'Current participants (expire after 30 s without an update)', parameters: [pid], responses: { '200': okJson('Presence list', { type: 'object' }), ...errs('401', '403') } },
    { method: 'get', path: `${P}/projects/{id}/assets/{assetId}/derivatives/{kind}`, id: 'getAssetDerivative', scope: 'observe', summary: 'Derivative bytes (supports Range)', description: 'Returns 404 `derivative_not_ready` (details: status, error) unless the derivative is ready.', parameters: [pid, pathParam('assetId', 'Asset id'), { name: 'kind', in: 'path', required: true, schema: { enum: ['thumbnails', 'waveform', 'proxy'] } }], responses: { ...rangeable('Derivative bytes; media type is the derivative mimeType', 'application/octet-stream'), ...errs('401', '403', '404') } },
    { method: 'post', path: `${P}/projects/{id}/exports`, id: 'createExport', scope: 'edit', summary: 'Start an export job for the current revision', parameters: [pid], responses: { '202': okJson('Accepted', ref('JobAccepted')), ...errs('401', '403', '404') } },
    { method: 'get', path: `${P}/jobs/{jobId}`, id: 'getJob', scope: 'observe', summary: 'Job status', parameters: [pathParam('jobId', 'Job id')], responses: { '200': okJson('Job view', ref('Job')), ...errs('401', '403', '404') } },
    { method: 'get', path: `${P}/jobs/{jobId}/output`, id: 'getJobOutput', scope: 'observe', summary: 'Download a finished export (MP4, supports Range)', parameters: [pathParam('jobId', 'Job id')], responses: { ...rangeable('MP4 video', 'video/mp4'), ...errs('401', '403', '404', '409') } },
    { method: 'get', path: `${P}/jobs/{jobId}/outputs/{index}`, id: 'getJobOutputByIndex', scope: 'observe', summary: 'Validated capability output by bundle index (supports Range)', parameters: [pathParam('jobId', 'Job id'), pathParam('index', 'Index into the output bundle')], responses: { ...rangeable('Output bytes; media type is the validated output mimeType', 'application/octet-stream'), ...errs('401', '403', '404') } },
    { method: 'post', path: `${P}/jobs/{jobId}/cancel`, id: 'cancelJob', scope: 'edit', summary: 'Cancel a capability job', parameters: [pathParam('jobId', 'Job id')], responses: { '200': okJson('Cancellation result', { type: 'object', additionalProperties: true }), ...errs('401', '403', '404', '409') } },
    { method: 'get', path: `${P}/capabilities`, id: 'listCapabilities', scope: 'observe', summary: 'Provider capabilities and setup state', responses: { '200': okJson('Capabilities list', { type: 'object', additionalProperties: true }), ...errs('401', '403') } },
    { method: 'post', path: `${P}/capabilities/import`, id: 'importCapabilityDraft', scope: 'edit', summary: 'Import a workflow graph as a capability draft (not executed)', requestBody: bodyOf(ref('ImportRequest')), responses: { '200': okJson('Draft descriptor', { type: 'object', additionalProperties: true }), ...errs('400', '401', '403', '422') } },
    { method: 'post', path: `${P}/projects/{id}/capabilities/{capabilityId}/runs`, id: 'runCapability', scope: 'edit', summary: 'Start a capability run as a durable job', parameters: [pid, pathParam('capabilityId', 'Capability id')], requestBody: bodyOf(ref('RunRequest')), responses: { '202': okJson('Accepted', ref('JobAccepted')), ...errs('400', '401', '403', '404', '409', '422', '503') } },
    { method: 'post', path: `${P}/projects/{id}/capabilities/{capabilityId}/models/download`, id: 'downloadCapabilityModels', scope: 'edit', summary: 'Download a capability\'s models as a durable job (owner session only)', description: 'A deliberate human action: not exposed over MCP, and bound to the exact byte count shown. Agent credentials get 403 `human_approval_required`. 409 codes: `download_size_mismatch`, `models_already_ready`, `capability_blocked`.', extra: { 'x-owner-session-only': true }, parameters: [pid, pathParam('capabilityId', 'Capability id')], requestBody: bodyOf(ref('DownloadRequest')), responses: { '202': okJson('Accepted', ref('JobAccepted')), ...errs('400', '401', '403', '404', '409', '503') } },
    { method: 'get', path: `${P}/openapi.json`, id: 'getOpenApi', scope: 'observe', summary: 'This OpenAPI document', responses: { '200': okJson('OpenAPI 3.1 document', { type: 'object', additionalProperties: true }), ...errs('401', '403') } },
  ];

  const paths: Record<string, Record<string, J>> = {};
  for (const r of routes) {
    (paths[r.path] ??= {})[r.method] = {
      operationId: r.id, summary: r.summary, ...(r.description ? { description: r.description } : {}), 'x-required-scope': r.scope, ...(r.extra ?? {}),
      ...(r.security ? { security: r.security } : {}),
      ...(r.parameters ? { parameters: r.parameters } : {}),
      ...(r.requestBody ? { requestBody: r.requestBody } : {}),
      responses: r.responses,
    };
  }
  paths['/mcp'] = { post: { operationId: 'mcp', summary: 'MCP Streamable HTTP endpoint', description: 'Model Context Protocol over Streamable HTTP. The route accepts all methods; the wire format is defined by the MCP specification and is not described here.', 'x-required-scope': 'none', responses: { '200': { description: 'MCP response (JSON or event stream)' } } } };

  return {
    openapi: '3.1.0',
    info: { title: 'PULSEFRAME Studio API', version: pkg.version, description: 'Generated from the operation registry and route table. Every persistent edit is a registered operation applied through a transaction.' },
    servers: [{ url: 'http://127.0.0.1:8787' }],
    security: [{ bearerAuth: [] }, { cookieSession: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token from tokens.json in the data directory. Scopes: observe (read), edit (write).' },
        cookieSession: { type: 'apiKey', in: 'cookie', name: 'pf_session', description: 'Browser session from GET /api/v1/session' },
      },
      schemas,
    },
    'x-internal-routes': [
      'GET /api/v1/render/{token}/snapshot',
      'GET /api/v1/render/{token}/assets/{assetId}',
      'POST /api/v1/render/{token}/frames',
    ],
  };
}
