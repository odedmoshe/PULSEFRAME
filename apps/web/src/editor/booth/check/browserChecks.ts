/**
 * The browser rows of «בדיקת המחשב» (wave 8 booth; core BOOTH_CHECKS side 'browser': browser-gpu, browser-codecs, mic). BUILDER W2.
 * browser-gpu uses ONLY the adapter part of apps/web/src/gpuProbe.ts (split into gpuProbe.logic.ts: no 120-pass timing sample, no DOM
 * side effects); data: vendor, architecture, adapter (`${vendor}|${architecture}|${device}|${description}`, ASCII), software, discrete.
 * browser-codecs: hardware H.264/HEVC/AV1 encode/decode and AAC encode states, no speed claim. mic: permissions.query, never a prompt.
 * Rows are parsed with core BoothCheckRowSchema before they leave this file; results are kept in localStorage by the dialog (W3).
 */
import type { BrowserCheckRunner } from '../booth.contract.ts';

export const runBrowserCheck: BrowserCheckRunner = async (id) => ({ id, state: 'unknown', code: 'not_built', data: {} });
