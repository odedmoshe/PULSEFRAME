/**
 * The agent's providers (wave 8 autonomy Part 2, builder W2): `createAgentProviders(dataDir, adapters)` implements the FROZEN
 * `AgentProviders` seam of contract.ts (resolve + view) for W1's loop, and adds what the provider routes need (the key store, the
 * merged model table, the probe). Files are read per call (no cache), so a key saved in the connect card reaches the next step.
 *
 * Every adapter handed out is wrapped: whatever it throws or answers passes `redact(key)` (assistant/credential.ts) a second time
 * (the adapters redact once themselves), so a provider that echoes the key back cannot put it into a step, an SSE event or a log.
 */
import { AGENT_PROBE_DETAIL_CHARS, AGENT_REFUSAL_CODES, type AgentModelsAnswer, type AgentProbeAnswer, type AgentProvidersAnswer } from '@pulseframe/core';
import { AGENT_MODEL_TABLE, AGENT_PROVIDER_PRESETS, AgentProviderError, isUnencryptedRemote, mergeModelTable, type AgentEndpoint, type AgentModelAdapter, type AgentModelRow, type AgentProviderPreset } from '@pulseframe/providers';
import { createAnthropicAdapter } from '@pulseframe/providers/agentAnthropic.ts';
import { createOpenAIChatAdapter } from '@pulseframe/providers/agentOpenAIChat.ts';
import { redact } from '../assistant/credential.ts';
import { ApiError } from '../store.ts';
import type { AgentAdapters, AgentProviders, ResolvedProvider } from './contract.ts';
import { AgentKeyStore, presetOf } from './keys.ts';

/** The product's adapters: one network adapter per family (tests and proofs pass their own map with the labelled scripted double). */
export function defaultAgentAdapters(): AgentAdapters {
  return new Map<AgentProviderPreset['family'], AgentModelAdapter>([['anthropic-messages', createAnthropicAdapter()], ['openai-chat', createOpenAIChatAdapter()]]);
}

/** The adapter with every error detail and probe detail passed through redact(key). */
export function redactingAdapter(a: AgentModelAdapter): AgentModelAdapter {
  const clean = (key: string | null, e: unknown): unknown => {
    if (e instanceof AgentProviderError) return new AgentProviderError(e.code, e.retryable, redact(key)(e.message), e.retryAfterSeconds);
    if (e instanceof Error) { const c = new Error(redact(key)(e.message)); c.name = e.name; return c; }
    return e;
  };
  return {
    id: a.id,
    family: a.family,
    async turn(req, ep, key, signal) { try { return await a.turn(req, ep, key, signal); } catch (e) { throw clean(key, e); } },
    async probe(ep, key, signal) {
      try { const r = await a.probe(ep, key, signal); return r.ok ? r : { ...r, detail: redact(key)(r.detail) }; } catch (e) { throw clean(key, e); }
    },
  };
}

export interface AgentProvidersService extends AgentProviders {
  readonly keys: AgentKeyStore;
  /** The built-in rows with the owner's merged in (agentModels.ts mergeModelTable), and the owner's own rows. */
  models(): AgentModelsAnswer & { rows: AgentModelRow[]; ownerRows: AgentModelRow[] };
  /** «בדיקה»: one 1-token request with the stored key, address and model. The answer never holds the key; a failure carries the provider's words, redacted (lead decision 7). */
  probe(providerId: string, signal?: AbortSignal): Promise<AgentProbeAnswer>;
}

const notConnected = (providerId: string | null, why: string) => new ApiError(AGENT_REFUSAL_CODES.providerNotConnected.status, AGENT_REFUSAL_CODES.providerNotConnected.code, why, { providerId }, 'Connect a provider in the «סוכן» tab (address, model, and a key where it needs one). / עוד לא חובר מודל: חברו ספק בכרטיס החיבור.');

export function createAgentProviders(dataDir: string, adapters: AgentAdapters = defaultAgentAdapters()): AgentProvidersService {
  const keys = new AgentKeyStore(dataDir);
  const models = () => { const own = keys.readOwnerModels(); return { rows: mergeModelTable(AGENT_MODEL_TABLE, own.rows), ownerRows: own.rows, problem: own.problem }; };
  /** connected = a model is set, and a key is stored where the preset needs one */
  const connected = (p: AgentProviderPreset) => keys.settingsOf(p.id).model !== null && (!p.needsKey || keys.keyState(p.id).keySet);
  const defaultProviderId = (): string | null => {
    const last = keys.lastConnected();
    const lastPreset = last ? AGENT_PROVIDER_PRESETS.find((p) => p.id === last) : undefined;
    if (lastPreset && connected(lastPreset)) return lastPreset.id;
    return AGENT_PROVIDER_PRESETS.find(connected)?.id ?? null;
  };
  const adapterFor = (p: AgentProviderPreset): AgentModelAdapter => {
    const a = adapters.get(p.family);
    if (!a) throw new ApiError(AGENT_REFUSAL_CODES.notBuilt.status, AGENT_REFUSAL_CODES.notBuilt.code, `no adapter for the ${p.family} family in this build`, { family: p.family }, 'Choose a provider of another family. / בחרו ספק אחר.');
    return redactingAdapter(a);
  };
  const service: AgentProvidersService = {
    keys,
    models,
    resolve(providerId?: string, model?: string): ResolvedProvider {
      const id = providerId ?? defaultProviderId();
      if (!id) throw notConnected(null, 'no model provider is connected yet');
      const preset = presetOf(id);
      const s = keys.settingsOf(preset.id);
      const m = model?.trim() || s.model;
      if (!m) throw notConnected(preset.id, `${preset.id} has no model chosen`);
      const key = preset.needsKey ? keys.readKey(preset.id) : null;
      if (preset.needsKey && !key) throw notConnected(preset.id, `${preset.id} needs a key and none is stored`);
      const endpoint: AgentEndpoint = { providerId: preset.id, family: preset.family, baseUrl: s.baseUrl, model: m };
      const row = models().rows.find((r) => r.providerId === preset.id && r.id === m) ?? null;
      return { preset, endpoint, adapter: adapterFor(preset), key, row };
    },
    view(): AgentProvidersAnswer {
      return {
        providers: AGENT_PROVIDER_PRESETS.map((p) => {
          const s = keys.settingsOf(p.id);
          const k = keys.keyState(p.id);
          return { id: p.id, family: p.family, baseUrl: s.baseUrl, model: s.model, needsKey: p.needsKey, keySet: k.keySet, keyAddedAt: k.keyAddedAt, unencrypted: isUnencryptedRemote(s.baseUrl), compatNote: p.compatNote, local: p.local };
        }),
        defaultProviderId: defaultProviderId(),
      };
    },
    async probe(providerId: string, signal: AbortSignal = new AbortController().signal): Promise<AgentProbeAnswer> {
      const preset = presetOf(providerId);
      const s = keys.settingsOf(preset.id);
      if (!s.model) return { ok: false, code: 'bad_config', model: null, detail: 'no model is chosen for this provider' };
      const key = preset.needsKey ? keys.readKey(preset.id) : null;
      if (preset.needsKey && !key) return { ok: false, code: 'bad_config', model: s.model, detail: 'this provider needs a key and none is stored' };
      const r = await adapterFor(preset).probe({ providerId: preset.id, family: preset.family, baseUrl: s.baseUrl, model: s.model }, key, signal);
      // the detail passed redact(key) in the adapter and again in redactingAdapter; cut to a line for the card
      return r.ok ? { ok: true, code: null, model: r.model, detail: null } : { ok: false, code: r.code, model: s.model, detail: redact(key)(r.detail).slice(0, AGENT_PROBE_DETAIL_CHARS) || null };
    },
  };
  return service;
}
