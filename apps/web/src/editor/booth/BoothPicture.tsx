/**
 * The picture card of «תא הבדיקה» (wave 8 booth). BUILDER W2: the booth's own scene on the two test pictures (GET
 * /api/v1/booth/test-picture/a|b), drawn by drawGraph(evaluate(doc, frame)) as the gallery tiles are; a still first (mid-transition or
 * effect frame); «הפעלה» plays the window once with every frame through the dialog's ONE FlashGuard; prefers-reduced-motion → three
 * stills, no playback; changesLight items start as a still with booth.changesLight; no adapter → booth.needsGpu and only «דלגו».
 * The canvas is role="img" with a Hebrew description (BOOTH_TESTIDS.pictureCanvas). The logic is picture.logic.ts (unit-tested).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { boothScene, BOOTH_SCENE_H, BOOTH_SCENE_W, type BoothScene } from '@pulseframe/core';
import { drawGraph, evaluate } from '@pulseframe/engine';
import { createT } from '@pulseframe/i18n';
import { api } from '../../api.ts';
import { Button } from '../../ds/index.ts';
import type { BoothPictureProps } from './booth.contract.ts';
import { BOOTH_TESTIDS as ID } from './booth.testids.ts';
import { boothPageStrings } from './check/check.strings.ts';
import { adapterFacts, browserExtras, drawIncomplete, drawNeedsGpu, frameAt, fpsOf, loadTestPicture, pictureDescription, pictureMode, pictureProvider, playFrames, playWindow, threeStillFrames } from './picture.logic.ts';

type Phase = 'loading' | 'ready' | 'failed' | 'needs-gpu' | 'not-a-scene';
interface Loaded { scene: BoothScene; provider: ReturnType<typeof pictureProvider>; bitmaps: Map<string, ImageBitmap> }

export function BoothPicture({ lang, view, browserGpu, guard, reducedMotion, onExtras }: BoothPictureProps): ReactElement {
  const t = createT(lang), S = boothPageStrings(lang);
  const item = view.item, make = item.make;
  const mode = pictureMode(item, browserGpu, reducedMotion);
  const [phase, setPhase] = useState<Phase>(make.route !== 'scene' ? 'not-a-scene' : mode === 'needs-gpu' ? 'needs-gpu' : 'loading');
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState(0);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const loaded = useRef<Loaded | null>(null);
  const halt = useRef(false);
  const facts = adapterFacts(browserGpu);

  // what the card knows about the browser's adapter goes to the dialog with the answer
  const extras = useRef(onExtras);
  extras.current = onExtras;
  const extrasKey = `${facts.adapter ?? ''}|${facts.software ?? ''}`;
  useEffect(() => { extras.current(browserExtras(browserGpu)); }, [extrasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // load the two pictures, build the scene, draw the still(s): once per item and per kind of drawing
  useEffect(() => {
    if (make.route !== 'scene') { setPhase('not-a-scene'); return; }
    if (mode === 'needs-gpu') { setPhase('needs-gpu'); return; }
    const ac = new AbortController();
    let cancelled = false;
    setPhase('loading'); setPlaying(false); setHeld(0); halt.current = false;
    (async () => {
      const [a, b] = await Promise.all([loadTestPicture(fetch, api.boothTestPictureUrl('a'), ac.signal), loadTestPicture(fetch, api.boothTestPictureUrl('b'), ac.signal)]);
      const [ba, bb] = await Promise.all([createImageBitmap(a.blob), createImageBitmap(b.blob)]);
      if (cancelled) { ba.close(); bb.close(); return; }
      const bitmaps = new Map<string, ImageBitmap>([[a.ref.contentHash, ba], [b.ref.contentHash, bb]]);
      const scene = boothScene(make, { a: a.ref, b: b.ref });
      const provider = pictureProvider(scene.doc, bitmaps);
      loaded.current = { scene, provider, bitmaps };
      const frames = mode === 'three-stills' ? threeStillFrames(scene) : [scene.still];
      for (let i = 0; i < frames.length; i++) {
        const canvas = canvases.current[i];
        if (!canvas) continue;
        const r = await drawGraph(canvas.getContext('2d')!, evaluate(scene.doc, frameAt(scene.doc, frames[i]!)), provider);
        if (cancelled) return;
        if (drawNeedsGpu(r)) { setPhase('needs-gpu'); return; }
        if (drawIncomplete(r)) { setPhase('failed'); return; }
      }
      setPhase('ready');
    })().catch(() => { if (!cancelled) setPhase('failed'); });
    return () => {
      cancelled = true; halt.current = true; ac.abort();
      const l = loaded.current; loaded.current = null;
      if (l) for (const bm of l.bitmaps.values()) bm.close();
    };
  }, [item.id, item.recipe, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // «הפעלה»: the window once, every frame through the dialog's guard; the card going away or the page hiding ends it
  const play = async () => {
    const l = loaded.current, canvas = canvases.current[0];
    if (!l || !canvas) return;
    if (playing) { halt.current = true; return; }
    halt.current = false; setPlaying(true);
    const before = guard.leftOut;
    const back = document.createElement('canvas'); back.width = canvas.width; back.height = canvas.height;
    const bctx = back.getContext('2d')!, ctx = canvas.getContext('2d')!;
    const ports = {
      guard, now: () => performance.now() / 1000,
      draw: (g: Parameters<typeof drawGraph>[1]) => drawGraph(bctx, g, l.provider),
      copy: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(back, 0, 0); },
      sleep: (s: number) => new Promise<void>((r) => setTimeout(r, Math.ceil(s * 1000))),
      nextFrame: (run: () => void) => { requestAnimationFrame(run); },
      fps: fpsOf(l.scene.doc),
      stopped: () => halt.current || document.visibilityState === 'hidden',
    };
    // the still on this canvas was drawn without the guard: what it shows is not the guard's last frame
    guard.screenUnknown();
    try {
      await playWindow(playFrames(l.scene), { ...ports, graph: (n) => evaluate(l.scene.doc, frameAt(l.scene.doc, n)) });
      // the still goes back through the guard too
      if (loaded.current === l) await guard.paint(evaluate(l.scene.doc, frameAt(l.scene.doc, l.scene.still)), { now: ports.now, draw: ports.draw, copy: ports.copy, sleep: ports.sleep, nextFrame: ports.nextFrame });
    } catch { /* a frame that could not be drawn ends the playback; the still stays */ }
    setHeld(guard.leftOut - before);
    setPlaying(false);
  };
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') halt.current = true; };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  const stills: ('first' | 'mid' | 'last' | 'single')[] = mode === 'three-stills' ? ['first', 'mid', 'last'] : ['single'];
  const stillWords = { first: S.stillFirst, mid: S.stillMid, last: S.stillLast, single: '' } as const;
  const showCanvases = phase === 'loading' || phase === 'ready';
  return (
    <div className="pf-booth-picture" data-state={phase} data-mode={mode} dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang}>
      <p>{t('booth.testPicture')}</p>
      {item.changesLight && <p>{t('booth.changesLight')}</p>}
      {mode === 'three-stills' && <p>{t('booth.reducedMotion')}</p>}
      {phase === 'needs-gpu' && <p role="status">{t('booth.needsGpu')}</p>}
      {phase === 'failed' && <p role="status">{S.pictureFailed}</p>}
      {phase === 'not-a-scene' && <p role="status">{S.pictureNoSceneKind}</p>}
      {phase === 'loading' && <p role="status">{S.pictureLoading}</p>}
      {facts.software === true && <p>{t('booth.software')}</p>}
      {facts.adapter && <p dir="ltr">{S.adapterLine(facts.adapter)}</p>}
      <div hidden={!showCanvases} style={{ display: showCanvases ? 'flex' : 'none', flexWrap: 'wrap', gap: 'var(--pf-sp-4)' }}>
        {stills.map((s, i) => (
          <figure key={s} style={{ margin: 0, flex: '1 1 160px' }}>
            <canvas ref={(el) => { canvases.current[i] = el; }} width={BOOTH_SCENE_W} height={BOOTH_SCENE_H} role="img" aria-label={pictureDescription(item, lang, s)} data-testid={ID.pictureCanvas} data-still={s}
              style={{ inlineSize: '100%', maxInlineSize: BOOTH_SCENE_W, blockSize: 'auto', aspectRatio: `${BOOTH_SCENE_W} / ${BOOTH_SCENE_H}`, background: 'var(--pf-surface-2)' }} />
            {stillWords[s] && <figcaption>{stillWords[s]}</figcaption>}
          </figure>
        ))}
      </div>
      {mode === 'still' && phase !== 'needs-gpu' && phase !== 'not-a-scene' && (
        <Button data-testid={ID.play} aria-pressed={playing} disabled={phase !== 'ready'} onClick={() => void play()}>{playing ? t('booth.stop') : t('booth.play')}</Button>
      )}
      {playing && <p role="status">{S.playing}</p>}
      {held > 0 && <p role="status">{S.playbackHeld(held)}</p>}
    </div>
  );
}
