/**
 * What the browser this page is open in can do with the machine's graphics hardware (blocker B-1).
 * The command-line probe drives a headless browser, which uses a software renderer and never sees a real GPU;
 * this page runs in the owner's own browser instead. Nothing is sent anywhere: the result is shown for copying.
 * The timing at the end is ONE sample of one simple workload, labelled as such; it is not a performance figure.
 */
const out: Record<string, unknown> = { page: 'gpu.html', at: new Date().toISOString(), userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGb: (navigator as { deviceMemory?: number }).deviceMemory ?? null, screen: `${screen.width}x${screen.height} @${devicePixelRatio}` };
const ok = async (f: () => Promise<{ supported?: boolean }>) => { try { return !!(await f()).supported; } catch { return false; } };

async function webgpu() {
  const gpu = (navigator as { gpu?: any }).gpu;
  if (!gpu) return { api: false };
  const describe = async (powerPreference: 'high-performance' | 'low-power') => {
    try {
      const a = await gpu.requestAdapter({ powerPreference });
      if (!a) return null;
      const info = a.info ?? (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
      return { vendor: info.vendor ?? null, architecture: info.architecture ?? null, device: info.device ?? null, description: info.description ?? null, isFallbackAdapter: a.isFallbackAdapter ?? info.isFallbackAdapter ?? null, features: [...a.features].sort(), limits: { maxTextureDimension2D: a.limits.maxTextureDimension2D, maxBufferSize: a.limits.maxBufferSize, maxColorAttachments: a.limits.maxColorAttachments } };
    } catch (e) { return { error: String(e) }; }
  };
  const res: Record<string, unknown> = { api: true, preferredCanvasFormat: gpu.getPreferredCanvasFormat?.() ?? null, highPerformance: await describe('high-performance'), lowPower: await describe('low-power') };
  // One timing sample: 120 full-frame fragment passes at 1080x1920, then a readback of the last frame.
  try {
    const a = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return { ...res, oneTimingSample: null };
    const d = await a.requestDevice();
    const W = 1080, H = 1920, format = 'rgba8unorm';
    const tex = d.createTexture({ size: [W, H], format, usage: 0x10 /* RENDER_ATTACHMENT */ | 0x01 /* COPY_SRC */ });
    const mod = d.createShaderModule({ code: `
      @vertex fn v(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3)); return vec4f(p[i], 0, 1); }
      @fragment fn f(@builtin(position) p: vec4f) -> @location(0) vec4f { var c = vec3f(0); for (var k = 0; k < 16; k++) { c += 0.0625 * (0.5 + 0.5 * sin(vec3f(p.x, p.y, p.x + p.y) * 0.01 * f32(k + 1))); } return vec4f(c, 1); }` });
    const pipe = d.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'v' }, fragment: { module: mod, entryPoint: 'f', targets: [{ format }] } });
    const frame = () => { const e = d.createCommandEncoder(); const p = e.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }); p.setPipeline(pipe); p.draw(3); p.end(); d.queue.submit([e.finish()]); };
    frame(); await d.queue.onSubmittedWorkDone(); // warm-up, not timed
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) frame();
    await d.queue.onSubmittedWorkDone();
    const t1 = performance.now();
    const buf = d.createBuffer({ size: W * H * 4, usage: 0x01 /* MAP_READ */ | 0x08 /* COPY_DST */ });
    const e = d.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: W * 4 }, [W, H]); d.queue.submit([e.finish()]);
    await buf.mapAsync(0x01);
    const px = new Uint8Array(buf.getMappedRange()).slice(0, 4);
    const t2 = performance.now();
    res.oneTimingSample = { workload: '120 full-frame passes of a 16-step fragment shader at 1080x1920, rgba8', msPerFrame: Number(((t1 - t0) / 120).toFixed(3)), readbackOfOneFrameMs: Number((t2 - t1).toFixed(1)), firstPixel: [...px], note: 'one run, one workload: not a performance figure' };
    d.destroy();
  } catch (e) { res.timingError = String(e); }
  return res;
}
function webgl2() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return null;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), floatRenderTargets: !!gl.getExtension('EXT_color_buffer_float') };
}
async function codecs() {
  const v = { 'h264-high': 'avc1.640028', hevc: 'hvc1.1.6.L93.B0', vp9: 'vp09.00.10.08', av1: 'av01.0.04M.08' };
  const res: Record<string, unknown> = {};
  if (typeof VideoEncoder === 'undefined') return { webcodecs: false };
  for (const [k, codec] of Object.entries(v)) {
    const cfg = { codec, width: 1920, height: 1080, bitrate: 8e6, framerate: 30 };
    res[k] = {
      encode: await ok(() => VideoEncoder.isConfigSupported(cfg)),
      encodeHardware: await ok(() => VideoEncoder.isConfigSupported({ ...cfg, hardwareAcceleration: 'prefer-hardware' })),
      decode: await ok(() => VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 })),
      decodeHardware: await ok(() => VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080, hardwareAcceleration: 'prefer-hardware' })),
    };
  }
  res.aacEncode = await ok(() => AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }));
  return res;
}

const summary = document.getElementById('summary')!, box = document.getElementById('out') as HTMLTextAreaElement, copy = document.getElementById('copy') as HTMLButtonElement;
copy.addEventListener('click', () => { box.select(); void navigator.clipboard?.writeText(box.value).then(() => { copy.textContent = 'הועתק'; }, () => { document.execCommand('copy'); copy.textContent = 'הועתק'; }); });
(async () => {
  out.webgpu = await webgpu();
  out.webgl2 = webgl2();
  out.codecs = await codecs();
  box.value = JSON.stringify(out, null, 1);
  copy.disabled = false;
  const hp = (out.webgpu as { highPerformance?: { vendor?: string; description?: string; isFallbackAdapter?: boolean } | null }).highPerformance;
  const gl = out.webgl2 as { renderer?: string } | null;
  summary.textContent = hp && !('error' in hp)
    ? `WebGPU זמין: ${hp.description || hp.vendor || 'מתאם ללא שם'}${hp.isFallbackAdapter ? ' (מתאם תוכנה, לא כרטיס המסך)' : ''}. WebGL2: ${gl?.renderer ?? 'לא זמין'}.`
    : `WebGPU אינו זמין בדפדפן הזה. WebGL2: ${gl?.renderer ?? 'לא זמין'}.`;
  summary.dataset.done = '1';
})().catch((e) => { summary.textContent = `הבדיקה נכשלה: ${e}`; box.value = JSON.stringify({ ...out, error: String(e) }, null, 1); copy.disabled = false; });
