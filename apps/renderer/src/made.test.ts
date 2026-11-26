/**
 * The made-clip harness (wave 8 motioncode, W1; plan §3.5, §4.1; verify C1, C5, C6). One made browser for the file, launched as the
 * product launches it (on Linux as root: through the privilege-drop wrapper, so Chromium's sandbox runs). Synthetic pages written
 * here; budgets are widened for a loaded machine where a test is about something else than the budget.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MadeDrawError, MadeHost, madeCompareFrames, madeInitScript, unlistedFamilies, type MadeDrawSpec } from './made.ts';

const host = new MadeHost();
afterAll(async () => { await host.close(); });
const heebo = path.join(path.dirname(createRequire(path.resolve(import.meta.dirname, '../../web/package.json')).resolve('@fontsource/heebo/package.json')), 'files');
const spec = (page: string, over: Partial<MadeDrawSpec> = {}): MadeDrawSpec => ({
  page, width: 64, height: 48, fps: { num: 30, den: 1 }, frames: 4, fields: { title: 'שלום', n: 3 },
  file: (p) => (p.startsWith('/fonts/') && fs.existsSync(path.join(heebo, p.slice(7))) ? { body: fs.readFileSync(path.join(heebo, p.slice(7))), contentType: 'font/woff2' } : null),
  fonts: [], catalogueFamilies: ['Heebo'], compareFrames: [0, 2, 3], frameMs: 30_000, jobMs: 300_000, onFrame: () => {}, ...over,
});
const canvas = (body: string) => `<!doctype html><meta charset=utf-8><canvas id=c width=64 height=48></canvas><script>const c=document.getElementById('c').getContext('2d');${body}</script>`;

describe('made harness — pure parts', () => {
  it('compares 0, n/2, n−1 and three seeded frames, distinct, within the clip', () => {
    const f = madeCompareFrames(120, 'job_a');
    expect(f.slice(0, 3)).toEqual([0, 60, 119]);
    expect(f).toHaveLength(6);
    expect(new Set(f).size).toBe(6);
    expect(f.every((x) => x >= 0 && x < 120)).toBe(true);
    expect(madeCompareFrames(120, 'job_a')).toEqual(f);
    expect(madeCompareFrames(120, 'job_b').slice(3)).not.toEqual(f.slice(3));
    expect(madeCompareFrames(1, 'x')).toEqual([0]);
    expect(madeCompareFrames(2, 'x').sort()).toEqual([0, 1]);
  });
  it('names families outside the catalogue, never generic ones', () => {
    expect(unlistedFamilies(['"Heebo", sans-serif', 'Comic Sans MS, cursive', 'system-ui', "'Times New Roman'"], ['Heebo'])).toEqual(['Comic Sans MS', 'Times New Roman']);
  });
  it('the init script carries the network lock and the frozen PF', () => {
    const s = madeInitScript({ width: 64, height: 48, fps: { num: 30, den: 1 }, frames: 4, fields: { a: 'x' } }, []);
    expect(s).toContain("'RTCPeerConnection'");
    expect(s).toContain('Object.freeze(PF)');
  });
});

describe('made harness — drawing (made browser)', () => {
  it('draws every frame from PF.render with the typed values; two passes give the same bytes; PF cannot be replaced', async () => {
    const got: number[] = [];
    const r = await host.draw(spec(canvas(`
      try { PF.fields.title = 'x'; } catch {} try { window.PF = null; } catch {}
      PF.render = (f) => { c.clearRect(0,0,64,48); c.fillStyle = PF.fields.title === 'שלום' && PF.fields.n === 3 && window.PF ? '#2060e0' : '#ff0000'; c.fillRect(f*10, 0, 10, 48); };`),
    { onFrame: (i, png) => { got.push(i); expect(png.subarray(1, 4).toString()).toBe('PNG'); } }));
    expect(got).toEqual([0, 1, 2, 3]);
    expect(r.compared.map((c) => c.frame)).toEqual([0, 2, 3]);
    expect(r.compared.every((c) => c.equalBytes)).toBe(true);
    expect(r.compared[0]!.a.equals(r.compared[1]!.a)).toBe(false); // frames differ from each other
    expect(r.clock).toEqual([]);
    expect(r.webgl).toBe(false);
    expect(['chromium', 'chromium-dropped-uid', 'none']).toContain(r.sandbox);
    console.log(`made harness sandbox here: ${r.sandbox}; browser ${r.browser}`);
  }, 240_000);

  it('the clock and random numbers are the frame\'s (recorded with API and first frame), so such a page still draws each frame alike', async () => {
    const r = await host.draw(spec(canvas(`PF.render = (f) => { c.clearRect(0,0,64,48); const x = (Date.now() / 10) % 60; c.fillStyle = 'rgb(' + Math.floor(Math['ran'+'dom']()*255) + ',0,0)'; c.fillRect(x, 0, 4, 48); void new Intl.DateTimeFormat().format(); void document['time'+'line'].currentTime; };`)));
    expect(r.clock.map((u) => u.api).sort()).toEqual(['Date.now', 'Intl.DateTimeFormat', 'Math.random', 'document.timeline']);
    expect(r.clock.every((u) => u.frame === 0)).toBe(true);
    expect(r.compared.every((c) => c.equalBytes)).toBe(true);
  }, 240_000);

  it('a page that keeps a counter between frames draws a compared frame differently in the second pass', async () => {
    const r = await host.draw(spec(canvas(`let k = 0; PF.render = () => { k++; c.clearRect(0,0,64,48); c.fillStyle = '#fff'; c.fillRect(k*5, 0, 5, 48); };`)));
    expect(r.compared.some((c) => !c.equalBytes)).toBe(true);
  }, 240_000);

  it('loads a catalogue face before frame 0 and reports a family outside the catalogue', async () => {
    const r = await host.draw(spec(canvas(`PF.render = () => { c.clearRect(0,0,64,48); c.font = '700 20px Heebo'; c.fillStyle='#fff'; c.fillText(PF.fields.title, 4, 30); c.font = '20px "Nowhere Sans"'; c.fillText('a', 40, 30); };`), {
      fonts: [{ family: 'Heebo', weight: 700, url: 'https://made.invalid/fonts/heebo-hebrew-700-normal.woff2', unicodeRange: 'U+0590-05FF', preload: true }],
    }));
    expect(r.fontsChecked).toEqual({ '700 40px "Heebo"': true });
    expect(r.missingFonts).toContain('"Nowhere Sans"'.replace(/"/g, ''));
    expect(r.served).toContain('/fonts/heebo-hebrew-700-normal.woff2');
  }, 240_000);

  it('seeks CSS animations and SMIL to the frame\'s time (two passes alike, frames differ)', async () => {
    const r = await host.draw(spec(`<!doctype html><style>@keyframes m{from{transform:translateX(0)}to{transform:translateX(40px)}} #s{width:8px;height:8px;background:#fff;animation:m 0.1333s linear}</style><div id=s></div>
      <svg width=64 height=20><rect width=4 height=4 fill=red><animate attributeName=x from=0 to=60 dur=0.1333s fill=freeze /></rect></svg>`));
    expect(r.maxAnimations).toBe(1);
    expect(r.compared.every((c) => c.equalBytes)).toBe(true);
    expect(r.compared[0]!.a.equals(r.compared[1]!.a)).toBe(false);
  }, 240_000);

  it('a frame that never finishes fails with frameTimeout naming it; the next draw succeeds', async () => {
    const err = await host.draw(spec(canvas(`PF.render = (f) => { if (f === 2) for (;;) {} c.fillRect(0,0,8,8); };`), { frameMs: 3000 })).catch((e) => e);
    expect(err).toBeInstanceOf(MadeDrawError);
    expect(err).toMatchObject({ why: 'frameTimeout', frame: 2 });
    const ok = await host.draw(spec(canvas(`PF.render = () => { c.fillStyle='#fff'; c.fillRect(0,0,8,8); };`)));
    expect(ok.compared).toHaveLength(3);
  }, 300_000);

  it('navigation fails the draw (made_navigated); a cancel ends it (canceled) and leaves no context open', async () => {
    const nav = await host.draw(spec(canvas(`PF.render = (f) => { if (f === 1) location.href = 'about:blank'; };`))).catch((e) => e);
    expect(nav).toMatchObject({ why: 'navigated' });
    const ac = new AbortController();
    const canceled = await host.draw(spec(canvas(`PF.render = () => {};`), { frames: 200, compareFrames: [0], signal: ac.signal, onFrame: (i) => { if (i === 5) ac.abort(); } })).catch((e) => e);
    expect(canceled).toMatchObject({ why: 'canceled' });
    expect(await host.openContexts()).toBe(0);
  }, 300_000);

  it('navigating to an address (aborted by the route), a form submit and window.open: navigation fails the draw with navigated, a form is stopped by the CSP, a pop-up is closed (proof:made G3.4 found "crashed")', async () => {
    const err = await host.draw(spec(canvas(`PF.render = (f) => { if (f === 1) location.href = 'http://127.0.0.1:9/nav'; c.fillRect(0,0,9,9); };`))).catch((e) => e);
    expect(err).toMatchObject({ why: 'navigated' });
    // a form submit is stopped by the page CSP (form-action 'none'): nothing navigates, the draw goes on
    const form = await host.draw(spec(canvas(`PF.render = (f) => { if (f === 1) { const x = document.createElement('form'); x.action = 'http://127.0.0.1:9/form'; x.method = 'post'; document.body.appendChild(x); x.submit(); } c.fillRect(0,0,9,9); };`)));
    expect(form.compared).toHaveLength(3);
    const r = await host.draw(spec(canvas(`PF.render = (f) => { if (f === 1) window.open('http://127.0.0.1:9/open'); c.fillRect(0,0,9,9); };`)));
    expect(r.compared).toHaveLength(3);
  }, 300_000);

  it('a page that eats memory fails with crashed; the next draw succeeds', async () => {
    const err = await host.draw(spec(canvas(`PF.render = () => { const keep = []; for (;;) keep.push(new Array(1e6).fill(Math.PI)); };`), { frameMs: 120_000 })).catch((e) => e);
    expect(err).toBeInstanceOf(MadeDrawError);
    expect(err.why).toBe('crashed');
    const ok = await host.draw(spec(canvas(`PF.render = () => {};`)));
    expect(ok.compared).toHaveLength(3);
  }, 400_000);
});
