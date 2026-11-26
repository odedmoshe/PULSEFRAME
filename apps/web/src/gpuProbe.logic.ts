/**
 * The ADAPTER part of the graphics probe (wave 8 booth; split out of gpuProbe.ts so the booth's browser row and gpu.html share it).
 * No timing sample, no DOM side effects, no module-level work: importing this file does nothing. gpu.html shows exactly what it showed
 * (same keys, same order, same values); gpuProbe.ts adds the one timing sample and the page.
 */

/** The parts of the WebGPU adapter this file reads (the page types are not in the DOM lib the web package builds with). */
export interface AdapterLike {
  info?: { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean };
  requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean }>;
  isFallbackAdapter?: boolean;
  features: Iterable<string>;
  limits: { maxTextureDimension2D: number; maxBufferSize: number; maxColorAttachments: number };
}
export interface GpuLike { requestAdapter(o?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<AdapterLike | null>; getPreferredCanvasFormat?: () => string }

export interface AdapterDescription {
  vendor: string | null; architecture: string | null; device: string | null; description: string | null; isFallbackAdapter: boolean | null;
  features: string[]; limits: { maxTextureDimension2D: number; maxBufferSize: number; maxColorAttachments: number };
}

/** One adapter, as the probe has always described it: null when the browser gave none, `{ error }` when asking threw. */
export async function describeAdapter(gpu: GpuLike, powerPreference: 'high-performance' | 'low-power'): Promise<AdapterDescription | { error: string } | null> {
  try {
    const a = await gpu.requestAdapter({ powerPreference });
    if (!a) return null;
    const info = a.info ?? (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
    return { vendor: info.vendor ?? null, architecture: info.architecture ?? null, device: info.device ?? null, description: info.description ?? null, isFallbackAdapter: a.isFallbackAdapter ?? info.isFallbackAdapter ?? null, features: [...a.features].sort(), limits: { maxTextureDimension2D: a.limits.maxTextureDimension2D, maxBufferSize: a.limits.maxBufferSize, maxColorAttachments: a.limits.maxColorAttachments } };
  } catch (e) { return { error: String(e) }; }
}

/** What gpu.html's `webgpu` object starts with (the page appends the timing sample); `{ api: false }` without navigator.gpu. */
export async function adapterReport(gpu: GpuLike | undefined): Promise<Record<string, unknown>> {
  if (!gpu) return { api: false };
  return { api: true, preferredCanvasFormat: gpu.getPreferredCanvasFormat?.() ?? null, highPerformance: await describeAdapter(gpu, 'high-performance'), lowPower: await describeAdapter(gpu, 'low-power') };
}
