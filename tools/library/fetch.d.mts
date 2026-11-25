// Types for fetch.mjs (the script itself stays plain JavaScript so it can be sent and run as one file).
import type { Readable } from 'node:stream';

export const VERSION: number;
export const LIB_DIRS: string[];
export class Fail extends Error {
  retryable: boolean;
  constructor(msg: string, retryable?: boolean);
}
export function fmt(n: number | null | undefined): string;
export interface Options {
  root: string; manifest: string; dryRun: boolean; verify: boolean; maxGb: number; delayMs: number; only: string[] | null; skip: string[];
}
export function parseArgs(argv: string[]): Options;
export function sanitizeSegment(s: string): string;
export function checkDest(rel: unknown): string | null;
export type Seen = Map<string, string> & { renamed?: number };
export function entryPath(name: string, opt?: { strip?: number; keep?: string[] | null; seen?: Seen | null }): string | null;

export interface Licence { spdx?: string; custom?: string; url: string; readOn: string; quote: string }
export interface Item {
  id: string; kind: 'file' | 'archive' | 'npm' | 'git'; dest: string; notes?: string;
  url?: string; sha256?: string; bytes?: number; format?: 'zip' | 'tar.gz'; approxUnpackedBytes?: number; strip?: number; keep?: string[];
  name?: string; version?: string; integrity?: string;
  repo?: string; commit?: string; sparse?: string[]; sparseNoCone?: boolean; approxBytes?: number;
}
export interface Source {
  id: string; title: string; homepage?: string; licence: Licence; credit: string | null;
  diskOnly: boolean; creditInExport: boolean; shareAlike: boolean; people: boolean; aiGenerated: boolean; repoAllowed: boolean;
  needsOwnerKey?: boolean; trademark?: boolean; personalOnly?: boolean; notes?: string; items: Item[];
}
export interface Manifest { manifestVersion: 1; id: string; title: string; created: string; notes?: string; sources: Source[] }
export function validateManifest(m: unknown, opt?: { insecureOk?: boolean }): { errors: string[]; items: { src: Source; item: Item }[] };

export function budgetCheck(a: { budget: number; used: number; reserved?: number; need?: number }): { ok: boolean; after: number; reason?: string };
export function itemNeed(item: Partial<Item> & { kind: Item['kind'] }, probe?: { bytes?: number | null; unpackedBytes?: number }): number;

export function sha256File(p: string): Promise<string>;
export function hashTree(dir: string, root?: string): Promise<{ files: number; bytes: number; longPaths: number; sha256: string }>;
export function dirBytes(dir: string): Promise<number>;

export interface TransportResponse { status: number; headers: Record<string, string | string[] | undefined>; body: Readable }
export type Transport = (url: URL, opt?: { method?: string; headers?: Record<string, string> }) => Promise<TransportResponse>;
export function makeTransport(mod: { request: (...args: any[]) => any }, proto: string): Transport;
export const httpsTransport: Transport;
export interface Net {
  acquire(host: string): Promise<() => void>;
  withResponse<T>(url: string, opt: { method?: string; headers?: Record<string, string> }, fn: (res: TransportResponse, finalUrl: URL) => Promise<T>): Promise<T>;
  retrying<T>(what: string, fn: (attempt: number) => Promise<T>): Promise<T>;
  getBuffer(url: string, max?: number): Promise<{ body: Buffer; type: string | null }>;
  probeSize(url: string): Promise<number | null>;
}
export function makeNet(opt?: {
  transport?: Transport; sleep?: (ms: number) => Promise<void>; now?: () => number; delayMs?: number; perHost?: number; retries?: number;
  insecureOk?: boolean; log?: (s: string) => void;
}): Net;

export interface PartMeta { url: string; etag: string | null; total: number | null }
export function resumeHeaders(have: number, meta: PartMeta | null, url: string): { range?: string; 'if-range'?: string };
export function resumeDecision(a: { have: number; ranged: boolean; status: number; contentRange?: string; etag?: string; meta?: PartMeta | null }): 'restart' | 'append' | 'discard' | 'error';
export function download(net: Net, url: string, part: string, opt?: { tick?: (n: number) => void; log?: (s: string) => void }): Promise<{ bytes: number }>;

export interface UnpackStats { files: number; skipped: number; renamed: number }
export interface UnpackOptions { strip?: number; keep?: string[] | null; tick?: (n: number) => void }
export function extractTarGz(file: string, dest: string, opt?: UnpackOptions): Promise<UnpackStats>;
export function extractZip(file: string, dest: string, opt?: UnpackOptions): Promise<UnpackStats>;

export interface GitResult { code: number; out: string; err: string }
export type GitRunner = (args: string[], opt?: { cwd?: string; insecureOk?: boolean }) => Promise<GitResult>;
export const runGit: GitRunner;

export interface LedgerEntry {
  item: string; source: string; sourceTitle: string; manifest: string; manifestSha256: string; kind: Item['kind']; identity: string; url: string; path: string;
  bytes: number; pinned: boolean; sha256?: string; downloadBytes?: number; files?: number; treeSha256?: string; integrity?: string; version?: string; commit?: string;
  licence: Licence; credit: string | null; flags: Record<string, boolean>; warnings?: string[]; time: string;
}
export function creditsText(entries: LedgerEntry[]): string;
export interface RunResult {
  code: number;
  results?: { id: string; status: 'fetched' | 'present' | 'skipped' | 'failed' | 'refused' | 'would fetch' | 'not selected'; bytes?: number; reason?: string; entry?: LedgerEntry }[];
  warnings?: string[];
  used?: number;
}
export function run(argv: string[], deps?: {
  log?: (s: string) => void; transport?: Transport; sleep?: (ms: number) => Promise<void>; git?: GitRunner; npmRegistry?: string;
  /** Tests only: lets http: and file: URLs through. Not reachable from the command line. */
  insecureOk?: boolean;
}): Promise<RunResult>;
