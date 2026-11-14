/**
 * Capability probe (SPEC §8/§9, Phase 0 gate): records what THIS machine's pinned runtimes can
 * actually do, and runs a known-pattern canvas readback self-test. Output is evidence, not a promise
 * about other machines.   Usage: pnpm probe [out.json]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const sh = (cmd: string, args: string[]) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e: any) { return `unavailable: ${String(e.message).split('\n')[0]}`; } };

async function browserProbe(args: string[]) {
  const srv = http.createServer((_q, s) => {
    s.setHeader('content-type', 'text/html');
    s.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    s.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    s.end('<!doctype html><title>probe</title>');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args });
  try {
    const page = await browser.newPage();
    // tsx (esbuild keepNames) wraps named functions in a `__name` helper that does not exist in the page.
    await page.addInitScript('globalThis.__name = (f) => f');
    await page.goto(`http://127.0.0.1:${(srv.address() as any).port}/`);
    const result = await page.evaluate(async () => {
      const out: Record<string, any> = { userAgent: navigator.userAgent, crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: (navigator as any).deviceMemory };
      const gpu = (navigator as any).gpu;
      out.webgpu = { api: !!gpu, adapter: null as any };
      if (gpu) {
        try {
          const a = await gpu.requestAdapter();
          if (a) out.webgpu.adapter = { vendor: a.info?.vendor, architecture: a.info?.architecture, isFallbackAdapter: a.isFallbackAdapter ?? a.info?.isFallbackAdapter, maxTextureDimension2D: a.limits.maxTextureDimension2D, deviceOk: !!(await a.requestDevice()) };
        } catch (e) { out.webgpu.error = String(e); }
      }
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      out.webgl2 = gl ? { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) } : null;
      out.offscreenCanvas = typeof OffscreenCanvas !== 'undefined';
      out.audioWorklet = typeof AudioWorkletNode !== 'undefined';
      out.intlSegmenter = typeof (Intl as any).Segmenter === 'function';
      out.opfs = !!navigator.storage?.getDirectory;
      out.storageEstimate = await navigator.storage.estimate();
      const vcodecs = { 'h264-baseline': 'avc1.42E028', 'h264-high': 'avc1.640028', vp8: 'vp8', vp9: 'vp09.00.10.08', av1: 'av01.0.04M.08', hevc: 'hvc1.1.6.L93.B0' };
      const acodecs = { aac: 'mp4a.40.2', opus: 'opus', mp3: 'mp3' };
      const ok = async (f: () => Promise<{ supported?: boolean }>) => { try { return !!(await f()).supported; } catch { return false; } };
      out.videoEncode1080p30 = {}; out.videoDecode1080p = {}; out.audioEncode = {}; out.audioDecode = {};
      for (const [k, codec] of Object.entries(vcodecs)) {
        out.videoEncode1080p30[k] = await ok(() => VideoEncoder.isConfigSupported({ codec, width: 1920, height: 1080, bitrate: 8e6, framerate: 30 }));
        out.videoDecode1080p[k] = await ok(() => VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 }));
      }
      for (const [k, codec] of Object.entries(acodecs)) {
        out.audioEncode[k] = await ok(() => AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }));
        out.audioDecode[k] = await ok(() => AudioDecoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2 }));
      }
      // Known-pattern readback self-test on the CPU canvas path used by the render worker.
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d', { willReadFrequently: true, alpha: false })!;
      const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [16, 128, 235], [0, 0, 0]];
      colors.forEach(([r, g, b], i) => { ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(i * 10, 0, 10, 64); });
      const px = ctx.getImageData(0, 0, 64, 64).data;
      out.canvasReadbackSelfTest = { exact: colors.every(([r, g, b], i) => { const o = (32 * 64 + i * 10 + 5) * 4; return px[o] === r && px[o + 1] === g && px[o + 2] === b && px[o + 3] === 255; }) };
      // Hebrew shaping sanity: niqqud must not add advance width; bidi run must measure.
      ctx.font = '40px sans-serif';
      out.hebrewTextSanity = { plain: ctx.measureText('בראשית').width, withNiqqud: ctx.measureText('בְּרֵאשִׁית').width };
      return out;
    });
    return { launchArgs: args, chromiumVersion: browser.version(), ...result };
  } finally {
    await browser.close();
    srv.close();
  }
}

const outFile = path.resolve(process.argv[2] ?? 'docs/evidence/capability-probe.json');
const report = {
  probedAt: new Date().toISOString(),
  note: 'Measured on the development container only. Other machines need their own probe run.',
  system: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: 'none (software rendering)' },
  runtimes: { node: process.version, pnpm: sh('pnpm', ['-v']), ffmpeg: sh('ffmpeg', ['-hide_banner', '-version']).split('\n')[0], ffmpegConfiguration: sh('ffmpeg', ['-hide_banner', '-buildconf']).split('\n').slice(1).map((s) => s.trim()).filter((s) => /gpl|nonfree|version3|libx264|libx265|libass|harfbuzz|fribidi|freetype|libvpx|libopus|libaom|dav1d|svtav1|lame/.test(s)), python: sh('python3', ['-V']) },
  ffmpegEncoders: Object.fromEntries(['libx264', 'aac', 'libopus', 'libvpx-vp9', 'libsvtav1', 'libx265'].map((e) => [e, new RegExp(`\\s${e}\\s`).test(sh('ffmpeg', ['-hide_banner', '-encoders']))])),
  browserDefault: await browserProbe([]),
  browserSoftwareWebGPU: await browserProbe(['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader']),
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
console.log(`wrote ${outFile}`);
const b = report.browserDefault as any;
console.log(JSON.stringify({ chromium: b.chromiumVersion, webgpuAdapterDefault: !!b.webgpu.adapter, webgpuAdapterSwiftShaderFlags: !!(report.browserSoftwareWebGPU as any).webgpu.adapter, webgl2: b.webgl2?.renderer, encode: b.videoEncode1080p30, audioEncode: b.audioEncode, readback: b.canvasReadbackSelfTest, hebrew: b.hebrewTextSanity }, null, 1));
