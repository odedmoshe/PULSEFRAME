/**
 * The model table of the in-editor agent (wave 8 autonomy Part 2, lead decision 2): DATA, not code. Every row is copied from
 * .artifacts/wave8/providers-research.md as the providers' own pages printed it on the date in `readAt`; nothing here is a claim
 * about quality. The owner may edit it (PUT /api/v1/agent/models stores his rows in <dataDir>/agent/models.json, which replace a
 * built-in row of the same provider+id and add the rest); the connect card shows the rows with their date. Prices are US dollars per
 * million tokens (in / out); null = not printed (the run then counts tokens, never a guessed price). Local servers have no fixed ids.
 */
import { z } from 'zod';

export const AgentModelRowSchema = z.object({
  providerId: z.string().min(1).max(64),
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(80),
  contextTokens: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  priceInPerMTok: z.number().nonnegative().nullable(),
  priceOutPerMTok: z.number().nonnegative().nullable(),
  /** the provider page says the model takes pictures (stills are then sent as images) */
  vision: z.boolean(),
  /** YYYY-MM-DD the row was read, or 'owner' for a row the owner typed */
  readAt: z.string().min(1).max(10),
  source: z.string().max(200),
  /** price notes the table cannot hold (tiers, a date change) */
  note: z.string().max(300).optional(),
}).strict();
export type AgentModelRow = z.infer<typeof AgentModelRowSchema>;
export const AgentModelTableSchema = z.array(AgentModelRowSchema).max(500);

const R = '2026-11-26';
export const AGENT_MODEL_TABLE: readonly AgentModelRow[] = Object.freeze([
  // R§1.1, R§1.4 (platform.claude.com models overview and pricing)
  { providerId: 'anthropic', id: 'claude-opus-5-5', label: 'Claude Opus 5.5', contextTokens: 1_000_000, maxOutputTokens: 128_000, priceInPerMTok: 4, priceOutPerMTok: 20, vision: true, readAt: R, source: 'R§1.1', note: 'the docs\' default recommendation' },
  { providerId: 'anthropic', id: 'claude-fable-5-2', label: 'Claude Fable 5.2', contextTokens: 1_000_000, maxOutputTokens: 128_000, priceInPerMTok: 8, priceOutPerMTok: 40, vision: true, readAt: R, source: 'R§1.1' },
  { providerId: 'anthropic', id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', contextTokens: 1_000_000, maxOutputTokens: 128_000, priceInPerMTok: 2, priceOutPerMTok: 10, vision: true, readAt: R, source: 'R§1.1' },
  { providerId: 'anthropic', id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', contextTokens: 1_000_000, maxOutputTokens: 128_000, priceInPerMTok: 0.1, priceOutPerMTok: 0.5, vision: true, readAt: R, source: 'R§1.1, R§1.4', note: 'prompts over 100,000 tokens: 0.50 in / 2.50 out' },
  // R§2.2 (developers.openai.com models)
  { providerId: 'openai', id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra', contextTokens: 1_050_000, maxOutputTokens: 128_000, priceInPerMTok: 8, priceOutPerMTok: 40, vision: true, readAt: R, source: 'R§2.2', note: 'id from the page URL (the ID line was not printed); over 272K input: input x2, output x1.5' },
  { providerId: 'openai', id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol', contextTokens: 1_050_000, maxOutputTokens: 128_000, priceInPerMTok: 2, priceOutPerMTok: 10, vision: true, readAt: R, source: 'R§2.2' },
  { providerId: 'openai', id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', contextTokens: 1_050_000, maxOutputTokens: 128_000, priceInPerMTok: 1, priceOutPerMTok: 5, vision: true, readAt: R, source: 'R§2.2' },
  { providerId: 'openai', id: 'gpt-6-luna', label: 'GPT-6 Luna', contextTokens: 1_050_000, maxOutputTokens: 128_000, priceInPerMTok: 0.1, priceOutPerMTok: 0.5, vision: true, readAt: R, source: 'R§2.2' },
  // R§3.1 (docs.x.ai models)
  { providerId: 'xai', id: 'grok-4.7', label: 'Grok 4.7', contextTokens: 500_000, maxOutputTokens: null, priceInPerMTok: 2, priceOutPerMTok: 6, vision: true, readAt: R, source: 'R§3.1', note: 'prompts of 200k tokens or more: 4.00 in / 12.00 out; images jpg/png only' },
  { providerId: 'xai', id: 'grok-4.3', label: 'Grok 4.3', contextTokens: 1_000_000, maxOutputTokens: null, priceInPerMTok: 1.25, priceOutPerMTok: 2.5, vision: true, readAt: R, source: 'R§3.1', note: 'prompts of 200k tokens or more: 2.50 in / 5.00 out' },
  // R§4.1 (ai.google.dev models and pricing; used through the OpenAI-compatible endpoint, R§4.8)
  { providerId: 'gemini', id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', contextTokens: 1_000_000, maxOutputTokens: 64_000, priceInPerMTok: 2, priceOutPerMTok: 10, vision: true, readAt: R, source: 'R§4.1', note: 'from 2026-12-01: 4.00 in / 20.00 out; not on the free tier' },
  { providerId: 'gemini', id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', contextTokens: 1_000_000, maxOutputTokens: 64_000, priceInPerMTok: 1.5, priceOutPerMTok: 7.5, vision: true, readAt: R, source: 'R§4.1', note: 'a free tier exists; on it Google may use what is sent to improve its products (R§4.7)' },
]);

/** The table the server answers: the owner's rows replace a built-in row with the same providerId and id, and the rest are added after. */
export function mergeModelTable(builtIn: readonly AgentModelRow[], owner: readonly AgentModelRow[]): AgentModelRow[] {
  const key = (r: AgentModelRow) => `${r.providerId}\u0000${r.id}`;
  const mine = new Map(owner.map((r) => [key(r), r]));
  const out = builtIn.map((r) => mine.get(key(r)) ?? r);
  const seen = new Set(builtIn.map(key));
  for (const r of owner) if (!seen.has(key(r))) out.push(r);
  return out;
}
/** Cost in cents of one call, or null when the row has no price for either side. */
export function costCents(row: Pick<AgentModelRow, 'priceInPerMTok' | 'priceOutPerMTok'> | null, usage: { inputTokens: number; outputTokens: number }): number | null {
  if (!row || row.priceInPerMTok === null || row.priceOutPerMTok === null) return null;
  return ((usage.inputTokens * row.priceInPerMTok + usage.outputTokens * row.priceOutPerMTok) / 1_000_000) * 100;
}
