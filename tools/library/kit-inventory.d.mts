// Types for kit-inventory.mjs (the script stays plain JavaScript so it runs with plain node on the owner's computer).
export const LIMITS: { sfzBytes: number; includes: number; includeDepth: number; regions: number; files: number; wavChunks: number };
export interface Args { root: string | null; item: string; match: string[]; sfz: string[]; help: boolean }
export function parseArgs(argv: string[]): Args;
export function insideItem(dirPosix: string, raw: string): string | null;
export function walk(dir: string): Map<string, null>;
export function keyNumber(v: string): number | null;
export interface Scan {
  regions: number; groups: number; samples: { written: string; withDefault: string }[]; includes: string[]; includeMissing: string[]; defaultPath: string;
  opcodes: Record<string, number>; keyLo: number | null; keyHi: number | null; velLayers: Set<string>; release: number; seq: number;
  loopModes: Record<string, number>; problems: string[]; dir: string;
}
export function scanSfz(text: string, read: (rel: string) => string | null, sfzRel: string): Scan;
export interface WavInfo { tag: number; channels: number; rate: number; blockAlign: number; bits: number; frames: number; seconds: number; smpl: boolean }
export function wavInfo(file: string): WavInfo | null;
export interface Inspected {
  sfzRel: string; scan: Scan; used: Map<string, 'exact' | 'caseOnly'>;
  counts: { exact: number; caseOnly: number; missing: number; outside: number; dotdot: number; backslash: number }; missing: string[];
}
export function inspect(itemDir: string, files: Map<string, null>, lower: Map<string, string[]>, sfzRel: string): Inspected;
export function tableLines(itemDir: string, results: Inspected[]): { lines: string[]; digest: string; bytes: number };
export function run(argv: string[], out?: (line: string) => void): number;
