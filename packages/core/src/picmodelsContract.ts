/**
 * The ONE local picture-model runtime, and `eyes` — automatic eye positions for «גדלים מול העיניים» (wave 8 track `picmodels`;
 * .artifacts/wave8/picmodels-plan.md, corrected by picmodels-verify.md C1–C17, which wins, and decisions.md "Batch C … picmodels").
 * LEAD contract of the pre-pass: frozen after it; a builder who needs a change here reports it.
 *
 * THE RUNTIME (server apps/server/src/picmodels/, W1; Python apps/server/tools/pf_picture.py, W2). The same tools Python as the
 * footage search (PF_TOOLS_PYTHON), one reviewed worker script pinned by digest, models found ONLY through the library ledger
 * (never a guessed folder, no PF_*_MODEL_DIR override) and checked by size and SHA-256 before anything loads, a setup state per model
 * in words. NOT a capability (not in LOCAL_TOOLS): a readiness record, as search's (search-decisions.md:46).
 *
 * `eyes` (verify C9–C11, C16; decisions). An answer to the OWNER'S OWN SESSION that is NEVER STORED: no durable job, no job row, no
 * event, no derivative, no file, no log line (the ADR amendment reads the durable-job rule this way, citing the search track's unstored
 * text query). ONE PROCESS PER REQUEST, killed on abort, no kept worker (C10). What leaves Python is exactly two eye points per face;
 * the worker's line is parsed with a STRICT schema (EyesWorkerLineSchema) so a box, a score or any other landmark fails the request
 * 502 eyes_engine_failed (C11 of the plan's numbering is the verifier's C10 bullet "Worker stdout"). Above EYES.maxFaces faces nothing
 * is proposed and the screen says so (C9: no ranking of people); faces are sorted by POSITION only (left to right by the midpoint of
 * their eyes in shown pixels), never by a score. Agents never see the YuNet row of GET /picture-models, not even as a state.
 *
 * COORDINATES: the points are (u, v) in 0..1 of the picture AS SHOWN (EXIF applied; growingContract.ts EyePointSchema), the same
 * coordinates a hand mark uses. The two points of a face come in no meaningful order: the dialog places them with growing's own
 * placePoint (its swap rule) exactly as two clicks.
 *
 * NOT IN THIS WAVE (decisions): the map job, the map store, the map routes' bodies, any Depth Anything 3 or SAM 2 Python. Their rows
 * are here with built: false so the setup report is complete and honest (`not_built`); the picture-map CONTRACT is types only
 * (pictureMapContract.ts). CUT: `inspect` for torch models; pointer-drag and point-select keys in the eyes interface.
 */
import { z } from 'zod';
import { EyePointSchema } from './growingContract.ts';

/** True once W1 and W2 have built the runtime and the eyes role and the lead has pinned the worker's digest. */
export const PICMODELS_BUILT: boolean = true;

// ---------- the models (registry; pins copied from tools/library/manifests/models-01.json, a test keeps them equal) ----------
export const PICTURE_MODEL_IDS = ['yunet', 'da3-small', 'da3-base', 'sam2-1-hiera-tiny', 'sam2-1-hiera-small'] as const;
export type PictureModelId = (typeof PICTURE_MODEL_IDS)[number];
export const PICTURE_MODEL_OUTPUTS = ['eyes', 'depth', 'matte'] as const;
export type PictureModelOutput = (typeof PICTURE_MODEL_OUTPUTS)[number];
const Sha = z.string().regex(/^[0-9a-f]{64}$/);
/** One file the worker loads: the library ledger item that holds it, its file name (as the worker is told it), exact size and SHA-256. */
export const PictureModelPinSchema = z.object({
  item: z.string().min(1), name: z.string().min(1), bytes: z.number().int().positive(), sha256: Sha,
}).strict();
export type PictureModelPin = z.infer<typeof PictureModelPinSchema>;
/** The picture-model descriptor. */
export const PictureModelSchema = z.object({
  id: z.enum(PICTURE_MODEL_IDS),
  /** the source id in models-01.json (the ledger's `source`) */
  source: z.string().min(1),
  /** the publisher's revision the pins were read at */
  revision: z.string().regex(/^[0-9a-f]{40}$/),
  /** only the files the worker loads (README not pinned) */
  pins: z.array(PictureModelPinSchema).min(1),
  licence: z.object({ spdx: z.enum(['MIT', 'Apache-2.0']), url: z.string().url(), quote: z.string().min(1) }).strict(),
  /** what using the model obliges: no credit in an export (a model's output is never shown as itself); the licence file that stays beside the weights */
  duties: z.object({ creditInExport: z.literal(false), keepLicenceItem: z.string().nullable() }).strict(),
  /** the packages the probe must import for this model */
  engine: z.enum(['onnxruntime', 'torch']),
  /** the model's input: long side in pixels (the picture is scaled to it as shown), padded right/bottom to a multiple of */
  input: z.object({ longSide: z.number().int().positive(), multipleOf: z.number().int().positive() }).strict(),
  output: z.enum(PICTURE_MODEL_OUTPUTS),
  /** false = setup state not_built, never a made-up answer */
  built: z.boolean(),
}).strict();
export type PictureModel = z.infer<typeof PictureModelSchema>;

const HF = 'https://huggingface.co';
/**
 * The registry. yunet is the only model of version 1 (built flips at integration). Depth ships not_built: DA3's publisher code cannot
 * join the lock (verify C6/C7). SAM 2.1 ships not_built with the map job (cut to the laptop wave).
 */
export const PICTURE_MODELS: readonly PictureModel[] = [
  {
    id: 'yunet', source: 'yunet', revision: '3cc26e7f1014a5ee5d74a42acee58bafc9d0a310',
    pins: [{ item: 'yunet/face_detection_yunet_2023mar.onnx', name: 'face_detection_yunet_2023mar.onnx', bytes: 232589, sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4' }],
    licence: { spdx: 'MIT', url: `${HF}/opencv/face_detection_yunet/blob/3cc26e7f1014a5ee5d74a42acee58bafc9d0a310/LICENSE`, quote: 'README: "All files in this directory are licensed under MIT License." LICENSE file: "MIT License / Copyright (c) 2020 Shiqi Yu <shiqi.yu@gmail.com>".' },
    duties: { creditInExport: false, keepLicenceItem: 'yunet/license' },
    engine: 'onnxruntime', input: { longSide: 640, multipleOf: 32 }, output: 'eyes', built: true,
  },
  {
    id: 'da3-small', source: 'da3-small', revision: 'e08cab65ca0ec38e7826075418411ab90cab4da3',
    pins: [
      { item: 'da3-small/model.safetensors', name: 'model.safetensors', bytes: 137248940, sha256: '364492e38a3a06d221ac75da7f6621ada3f2361cd24fde11ba79091e9f40efcf' },
      { item: 'da3-small/config.json', name: 'config.json', bytes: 1202, sha256: 'a486e29e82b7ab4a7d4cefc1ea4526cfe2ae438a572c8ca98917cfbcde7447d2' },
    ],
    licence: { spdx: 'Apache-2.0', url: `${HF}/depth-anything/DA3-SMALL/blob/e08cab65ca0ec38e7826075418411ab90cab4da3/README.md`, quote: 'Model card front matter: "license: apache-2.0"; card table: "License | Apache 2.0".' },
    duties: { creditInExport: false, keepLicenceItem: null },
    engine: 'torch', input: { longSide: 504, multipleOf: 14 }, output: 'depth', built: false,
  },
  {
    id: 'da3-base', source: 'da3-base', revision: 'f4a6c9b3c95e41c82048423d3493a81ec3fa810e',
    pins: [
      { item: 'da3-base/model.safetensors', name: 'model.safetensors', bytes: 541518028, sha256: 'e01067dc1659613083d9145a9a2547ccdbe6ccbbf83c4fe7b3e8a4e2bdae78b5' },
      { item: 'da3-base/config.json', name: 'config.json', bytes: 1205, sha256: '5e34115ebc17bd2d8d43033c5f72e9446ac8833fd61d3fa160b7e67e0bb5b7b5' },
    ],
    licence: { spdx: 'Apache-2.0', url: `${HF}/depth-anything/DA3-BASE/blob/f4a6c9b3c95e41c82048423d3493a81ec3fa810e/README.md`, quote: 'Model card front matter: "license: apache-2.0"; card table: "License | Apache 2.0".' },
    duties: { creditInExport: false, keepLicenceItem: null },
    engine: 'torch', input: { longSide: 504, multipleOf: 14 }, output: 'depth', built: false,
  },
  {
    id: 'sam2-1-hiera-tiny', source: 'sam2-1-hiera-tiny', revision: 'de431c4043854a71d8101e17995dfe596bf101a5',
    pins: [
      { item: 'sam2-1-hiera-tiny/model.safetensors', name: 'model.safetensors', bytes: 155908064, sha256: '48c14467e5cf9e51870511feb72c89688e82dd74523142c0538b663e193ac2a7' },
      { item: 'sam2-1-hiera-tiny/config.json', name: 'config.json', bytes: 5695, sha256: '860aff9751b139d83a4ad7df1e5535416fded533e0ead02625edbefcb9953cce' },
      { item: 'sam2-1-hiera-tiny/preprocessor_config.json', name: 'preprocessor_config.json', bytes: 683, sha256: '6ebf229ee259368ce4a8d4f2fe893a72b053023710853e257253939e601f583d' },
      { item: 'sam2-1-hiera-tiny/processor_config.json', name: 'processor_config.json', bytes: 95, sha256: 'f8a68e865cfad115c1c2763f3d93eca7b1c622da06da2a9273eb437fb2389b6d' },
      { item: 'sam2-1-hiera-tiny/video_preprocessor_config.json', name: 'video_preprocessor_config.json', bytes: 705, sha256: '9fccfe5f464ec38c2f236d0e6a68e95511c80c22132fc2fa4b9f7b65f24fad95' },
    ],
    licence: { spdx: 'Apache-2.0', url: `${HF}/facebook/sam2.1-hiera-tiny/blob/de431c4043854a71d8101e17995dfe596bf101a5/README.md`, quote: 'Model card front matter: "license: apache-2.0".' },
    duties: { creditInExport: false, keepLicenceItem: null },
    engine: 'torch', input: { longSide: 1024, multipleOf: 1 }, output: 'matte', built: false,
  },
  {
    id: 'sam2-1-hiera-small', source: 'sam2-1-hiera-small', revision: 'ee5bba1d82bb8749febdf90f45e84b687142ba03',
    pins: [
      { item: 'sam2-1-hiera-small/model.safetensors', name: 'model.safetensors', bytes: 184305280, sha256: '0a4067b11ce1e23d5229203f11c718a823060d15a4b23fa2372a7d4b77cbbc60' },
      { item: 'sam2-1-hiera-small/config.json', name: 'config.json', bytes: 5698, sha256: '97ff9f65b76d107acda4247885f0a5555d0048850ae3c5f97183df289aaecde9' },
      { item: 'sam2-1-hiera-small/preprocessor_config.json', name: 'preprocessor_config.json', bytes: 683, sha256: '6ebf229ee259368ce4a8d4f2fe893a72b053023710853e257253939e601f583d' },
      { item: 'sam2-1-hiera-small/processor_config.json', name: 'processor_config.json', bytes: 95, sha256: 'f8a68e865cfad115c1c2763f3d93eca7b1c622da06da2a9273eb437fb2389b6d' },
      { item: 'sam2-1-hiera-small/video_preprocessor_config.json', name: 'video_preprocessor_config.json', bytes: 705, sha256: '9fccfe5f464ec38c2f236d0e6a68e95511c80c22132fc2fa4b9f7b65f24fad95' },
    ],
    licence: { spdx: 'Apache-2.0', url: `${HF}/facebook/sam2.1-hiera-small/blob/ee5bba1d82bb8749febdf90f45e84b687142ba03/README.md`, quote: 'Model card front matter: "license: apache-2.0".' },
    duties: { creditInExport: false, keepLicenceItem: null },
    engine: 'torch', input: { longSide: 1024, multipleOf: 1 }, output: 'matte', built: false,
  },
];
export const pictureModel = (id: PictureModelId): PictureModel => PICTURE_MODELS.find((m) => m.id === id)!;
/** The bytes a model's pins hold in all. */
export const pictureModelBytes = (m: PictureModel): number => m.pins.reduce((s, p) => s + p.bytes, 0);
/** Licences a picture model may carry in this build (the ledger's own licence can only make it stricter). */
export const PICTURE_MODEL_LICENCES_ALLOWED: readonly string[] = ['MIT', 'Apache-2.0'];

// ---------- setup states (per model, in the order a person fixes things) ----------
/**
 * not_built → licence_blocked → engine_unverified (pf_picture.py is not the reviewed file, or no digest is pinned yet) →
 * engine_not_configured (PF_TOOLS_PYTHON unset) / engine_not_working (the probe names the module it cannot import) →
 * disk_insufficient / model_missing (the library folder unset, the ledger item absent or not a file, another SHA-256 in the ledger,
 * a link out of the library, a size or a checksum off: the missing bytes named; the app never downloads) → ready (device cpu for
 * yunet always).
 */
export const PICTURE_MODEL_SETUP_CODES = ['not_built', 'licence_blocked', 'engine_unverified', 'engine_not_configured', 'engine_not_working', 'disk_insufficient', 'model_missing', 'ready'] as const;
export type PictureModelSetupCode = (typeof PICTURE_MODEL_SETUP_CODES)[number];
/** The owner's row of GET /api/v1/picture-models. `detail` is a sentence for the owner's own session; it never holds a path or a file name. */
export const PictureModelStatusSchema = z.object({
  id: z.enum(PICTURE_MODEL_IDS),
  output: z.enum(PICTURE_MODEL_OUTPUTS),
  code: z.enum(PICTURE_MODEL_SETUP_CODES),
  /** engine_not_working: the module the probe cannot import (a package name, never a path) */
  module: z.string().regex(/^[A-Za-z0-9_.]{1,60}$/).nullable(),
  device: z.enum(['cpu', 'cuda']).nullable(),
  missingBytes: z.number().int().nonnegative(),
  detail: z.string().max(400),
}).strict();
export type PictureModelStatus = z.infer<typeof PictureModelStatusSchema>;
/** What any other credential gets of a row: codes and numbers only, and NEVER the yunet row (pictureModelsFor). */
export const AgentPictureModelStatusSchema = PictureModelStatusSchema.pick({ id: true, output: true, code: true, device: true, missingBytes: true }).strict();
export type AgentPictureModelStatus = z.infer<typeof AgentPictureModelStatusSchema>;
export const PictureModelsAnswerSchema = z.object({ models: z.array(PictureModelStatusSchema), built: z.boolean() }).strict();
export const AgentPictureModelsAnswerSchema = z.object({ models: z.array(AgentPictureModelStatusSchema), built: z.boolean() }).strict();
export type PictureModelsAnswer = z.infer<typeof PictureModelsAnswerSchema>;
export type AgentPictureModelsAnswer = z.infer<typeof AgentPictureModelsAnswerSchema>;
/** The models no credential but the owner's own session sees, not even as a state (decisions: "agents never see the YuNet row"). */
export const OWNER_ONLY_PICTURE_MODELS: readonly PictureModelId[] = ['yunet'];
/**
 * THE FILTER of GET /picture-models (complete here: it is the rule, not a body). The owner's own session gets the rows as they are;
 * anyone else gets each row rebuilt from five keys (never spread) and no OWNER_ONLY_PICTURE_MODELS row.
 */
export function pictureModelsFor(owner: boolean, rows: readonly PictureModelStatus[]): PictureModelsAnswer['models'] | AgentPictureModelsAnswer['models'] {
  if (owner) return rows.map((r) => ({ ...r }));
  return rows.filter((r) => !OWNER_ONLY_PICTURE_MODELS.includes(r.id)).map((r) => ({ id: r.id, output: r.output, code: r.code, device: r.device, missingBytes: r.missingBytes }));
}
/** A row whose model is not built in this build (every row of the pre-pass): honest, never a fake ready. */
export const notBuiltPictureModelStatus = (m: PictureModel): PictureModelStatus => ({
  id: m.id, output: m.output, code: 'not_built', module: null, device: null, missingBytes: 0,
  detail: m.output === 'eyes' ? 'eye suggestions are not built in this build yet; marking by hand works' : `${m.output} maps are not built in this build yet`,
});

// ---------- eyes: limits ----------
export const EYES = {
  /** more faces than this above the score floor: nothing is proposed (C9) */
  maxFaces: 8,
  /** the picture is decoded as shown and scaled so its long side is this (yunet's input) */
  inputLongSide: 640,
  /** one request at a time; a second one while it runs is 429 eyes_busy */
  concurrent: 1,
  /** the worker process is killed after this (one sample on the laptop decides whether it is generous: PM5) */
  timeoutMs: 30_000,
  /** onnxruntime intra-op threads (C14): a 4-core laptop may be exporting at the same time */
  threads: 2,
  /** YuNet's score floor and NMS IoU: OpenCV FaceDetectorYN defaults, provisional (heuristic, labelled) */
  scoreFloor: 0.9, nmsIoU: 0.3,
} as const;
/** Labels of the answer's `method` (a test adapter names itself with its own label; never presented as a model). */
export const EYES_METHOD_YUNET = 'YuNet 2023mar on this computer, eye positions only (a model\'s suggestion, checked by the owner)' as const;

// ---------- eyes: the request and the answer (wire of POST /api/v1/projects/:id/eyes/propose) ----------
const Id = z.string().min(1).max(64);
/** `frame`: the source frame of a video, as in growing's picks (GrowingPickInputSchema); null for a still. Nothing else. */
export const EyesProposeBodySchema = z.object({
  assetId: Id,
  frame: z.number().int().min(0).nullable(),
}).strict();
export type EyesProposeBody = z.infer<typeof EyesProposeBodySchema>;
/** One face: exactly two points, nothing else (no box, no score, no landmark, no rank). */
export const EyesFaceSchema = z.object({ eyes: z.tuple([EyePointSchema, EyePointSchema]) }).strict();
export type EyesFace = z.infer<typeof EyesFaceSchema>;
/**
 * The answer, `Cache-Control: no-store`. STRICT: an extra key anywhere fails (eyesAnswer.test). Three outcomes:
 *  - faces: 1..EYES.maxFaces faces, sorted by position (left to right by eye midpoint u, then v), never by a score;
 *  - none: no face above the floor («לא נמצאו פנים… סמנו ביד»);
 *  - too_many: more than EYES.maxFaces faces: NO point at all, and the screen says so (C9).
 * `method` is the label of what answered (EYES_METHOD_YUNET, or the test adapter's own label).
 */
export const EyesAnswerSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('faces'), faces: z.array(EyesFaceSchema).min(1).max(EYES.maxFaces), method: z.string().min(1).max(200) }).strict(),
  z.object({ outcome: z.literal('none'), faces: z.tuple([]), method: z.string().min(1).max(200) }).strict(),
  z.object({ outcome: z.literal('too_many'), faces: z.tuple([]), method: z.string().min(1).max(200) }).strict(),
]);
export type EyesAnswer = z.infer<typeof EyesAnswerSchema>;

/**
 * THE WORKER'S LINE for one eyes request (pf_picture.py `serve --role eyes`, and the labelled fake), parsed STRICTLY by the server:
 * points in the pixels of the picture it was sent (w × h, long side EYES.inputLongSide), each face exactly [[x, y], [x, y]]. Over
 * EYES.maxFaces the worker sends `tooMany: true` and NO point (so a count of people beyond the limit and their positions never
 * leave Python). Any other key — a box, a score, a landmark, a count — fails the request with 502 eyes_engine_failed: dropping
 * extras silently would hide a worker that sends more (verify C10).
 */
const Px = z.number().finite();
export const EyesWorkerLineSchema = z.union([
  z.object({ id: z.number().int().positive(), event: z.literal('result'), faces: z.array(z.tuple([z.tuple([Px, Px]), z.tuple([Px, Px])])).max(EYES.maxFaces) }).strict(),
  z.object({ id: z.number().int().positive(), event: z.literal('result'), tooMany: z.literal(true) }).strict(),
  z.object({ id: z.number().int().positive(), event: z.literal('error'), code: z.enum(['bad_request', 'engine_failed', 'model_mismatch', 'not_built']) }).strict(),
]);
export type EyesWorkerLine = z.infer<typeof EyesWorkerLineSchema>;
/** The request line the server writes to the worker's stdin (pixels inline, never a file): rgb24, w × h, base64. */
export interface EyesWorkerRequest { id: number; cmd: 'eyes'; w: number; h: number; rgb: string }

// ---------- refusals (fixed English; Hebrew with the next step in i18n picmodels.ts HE_PICMODELS) ----------
interface PicRefusal<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint: string }
const r = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint: string): PicRefusal<A> => ({ status, code, message, hint });
/** Every refusal of the eyes route. None ever holds a coordinate, a file name, a path or a worker's message. */
export const PICMODELS_REFUSALS = {
  ownerOnly: r(403, 'owner_required', () => 'eye suggestions are for the owner\'s own session only', 'The owner asks for them in «גדלים מול העיניים» in the editor.'),
  notBuilt: r(501, 'eyes_not_built', () => 'eye suggestions are not built in this build yet', 'Mark the eyes by hand; update the editor later.'),
  notReady: r(409, 'eyes_not_ready', (code: string) => `eye suggestions are not set up on this computer: ${code}`, 'Follow the setup line beside the button; marking by hand works meanwhile.'),
  busy: r(429, 'eyes_busy', () => 'an eye suggestion is already being worked out', 'Wait for it, or stop it, then ask again.'),
  assetMissing: r(404, 'not_found', () => 'eye suggestions: the picture is not in this project', 'Choose a picture of this project.'),
  noPicture: r(409, 'incompatible', () => 'eye suggestions: the file has no picture', 'Choose a still or a video.'),
  frameOnStill: r(400, 'invalid_args', () => 'eye suggestions: a still picture has no frame number', 'Send frame null for a still.'),
  noFrame: r(400, 'invalid_args', () => 'eye suggestions: a video needs the number of the frame to look at', 'Choose the frame first.'),
  noSuchFrame: r(400, 'out_of_bounds', () => 'eye suggestions: the video has no such frame', 'Choose a frame inside the video.'),
  engineFailed: r(502, 'eyes_engine_failed', () => 'the eye model gave an answer that failed its checks; nothing is shown', 'Mark the eyes by hand; if it repeats, check the setup line.'),
} as const;
export type PicmodelsRefusalKey = keyof typeof PICMODELS_REFUSALS;

/** Thrown by a function of the runtime that this build does not have yet: never a made-up value. */
export class PictureModelsNotBuilt extends Error {
  readonly code = 'not_built' as const;
  constructor(what: string) { super(`${what}: not built in this build yet`); this.name = 'PictureModelsNotBuilt'; }
}
