import { BUILTIN_CAPABILITIES } from './builtin.ts';
import type { CapabilityDescriptor } from './descriptor.ts';
import { LOCAL_TOOLS } from './local-registry.ts';

export * from './descriptor.ts';
export * from './import.ts';
export * from './contract.ts';
export * from './comfy.ts';
export * from './builtin.ts';
export * from './aiPins.ts';
export { LOCAL_TOOLS } from './local-registry.ts';
/** One registry (ADR-0017): ComfyUI descriptors and local tools, dispatched by `provider`. */
export const ALL_CAPABILITIES: CapabilityDescriptor[] = [...BUILTIN_CAPABILITIES, ...LOCAL_TOOLS];
