// Types for build-data.mjs (the script stays plain JavaScript, Node built-ins only).
export const INPUTS: Record<string, { path: string; sha256: string; bytes: number }>;
export const SOURCE: { repo: string; tag: string; commit: string };
export const MAX_LAT: number;
export const DETAIL_BOX: { lonMin: number; lonMax: number; latMin: number; latMax: number };
export const PLACE_BOX: { lonMin: number; lonMax: number; latMin: number; latMax: number };
export const PLACE_MAX_SCALERANK: number;
export const LEVELS: { id: string; src: string; q: number; tol: number; minArea: number; box?: boolean; use: string }[];
export const GRID: number;
export const FORMAT: number;
export const OUT: { outlines: string; places: string };
export function mercY(lat: number): number;
export interface Ring { pts: [number, number][]; cut: boolean[] }
export function ringFromCoords(coords: [number, number][]): Ring;
export function clipRing(ring: Ring, box: { lonMin?: number; lonMax?: number; latMin: number; latMax: number }): Ring;
export function simplifyRing(ring: Ring, tol: number): Ring | null;
export function encodeGroup(rings: { q: [number, number][]; cut: boolean[] }[]): Buffer;
export function buildPlaces(fc: { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: number[] } | null }[] }): [number, string, string, number, number][];
export function build(srcDir: string): { outlinesTs: string; placesTs: string; outlines: unknown; places: unknown[] };
