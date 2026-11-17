/**
 * Reviewed local tools (ADR-0017): PULSEFRAME-owned code run by an operator-installed engine, pinned by `codeDigest`.
 * L0 stub: the registry is empty until the local-tools work (W2) adds the four reviewed descriptors
 * (local.text.translate-he-en, local.text.translate-en-he, local.voice.clean, local.audio.vocals-classic).
 */
import type { LocalToolDescriptor } from './descriptor.ts';

export const LOCAL_TOOLS: LocalToolDescriptor[] = [];
