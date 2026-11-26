import { BUILTIN_CAPABILITIES } from './builtin.ts';
import type { CapabilityDescriptor } from './descriptor.ts';
import { LOCAL_TOOLS } from './local-registry.ts';

export * from './descriptor.ts';
export * from './import.ts';
export * from './contract.ts';
export * from './comfy.ts';
export * from './builtin.ts';
export * from './aiPins.ts';
// the command bar's language-model path (ADR-0027): provider-neutral types and the chat descriptor, outside DescriptorSchema
export * from './chat.ts';
export { LOCAL_TOOLS } from './local-registry.ts';
/** One registry (ADR-0017): ComfyUI descriptors and local tools, dispatched by `provider`. */
export const ALL_CAPABILITIES: CapabilityDescriptor[] = [...BUILTIN_CAPABILITIES, ...LOCAL_TOOLS];
// the LOCAL language assistant (wave 7 assistant track): loopback-only model path, its own descriptor and prompt pin
export * from './localChat.ts';
// the in-editor agent «סוכן» (wave 8 autonomy Part 2): adapter interface, the two wire families, presets, the model table (data), the labelled scripted double
export * from './agentModel.ts';
export * from './agentModels.ts';
export * from './agentScripted.ts';
