/**
 * `eyes` — the worker's line to the owner's answer (wave 8 picmodels; contract.ts RULES; verify C9–C11). Pure except for nothing:
 * everything here is a function of the worker's raw line and the decoded picture's size. NOTHING is stored or logged; every failure
 * is a picmodelsError with codes and integers only (a raw ZodError, SyntaxError or worker text never reaches app.onError).
 *   - the line parsed with core EyesWorkerLineSchema (STRICT: a box, a score, a third point, a count → 502 eyes_engine_failed);
 *   - pixels → (u, v) = (x / w, y / h) of the decoded shown picture; every value finite and in 0..1, else 502;
 *   - a face whose two points are closer than GROWING.minEyeShownPx in the asset's SHOWN pixels is dropped;
 *   - faces sorted by the midpoint of their eyes, u then v (position only: nothing ranks people);
 *   - tooMany → outcome too_many with no point (C9);
 *   - core EyesAnswerSchema.parse last.
 */
import { EyesAnswerSchema, EyesWorkerLineSchema, GROWING, type EyePoint, type EyesAnswer, type EyesWorkerLine } from '@pulseframe/core';
import { picmodelsError, type ParseEyesLine } from './contract.ts';

export const parseEyesLine: ParseEyesLine = (raw, id) => {
  const r = EyesWorkerLineSchema.safeParse(raw);
  if (!r.success) throw picmodelsError('engineFailed', { reason: 'line' });
  if (r.data.id !== id) throw picmodelsError('engineFailed', { reason: 'line_id' });
  return r.data;
};

/** The answer to the owner from a parsed result line. `decoded`: the picture the worker saw; `shown`: the asset's shown size. */
export function eyesAnswerFrom(line: EyesWorkerLine, decoded: { w: number; h: number }, shown: { width: number; height: number }, method: string): EyesAnswer {
  if (line.event === 'error') {
    if (line.code === 'not_built') throw picmodelsError('notBuilt');
    if (line.code === 'model_mismatch') throw picmodelsError('notReady', { setup: 'model_missing' }, 'model_missing');
    throw picmodelsError('engineFailed', { reason: 'worker', code: line.code });
  }
  if ('tooMany' in line) return checked({ outcome: 'too_many', faces: [], method });
  const inUnit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  const faces: [EyePoint, EyePoint][] = [];
  for (const [[ax, ay], [bx, by]] of line.faces) {
    const a = { u: ax / decoded.w, v: ay / decoded.h }, b = { u: bx / decoded.w, v: by / decoded.h };
    if (![a.u, a.v, b.u, b.v].every(inUnit)) throw picmodelsError('engineFailed', { reason: 'outside' });
    const apart = Math.hypot((a.u - b.u) * shown.width, (a.v - b.v) * shown.height);
    if (apart < GROWING.minEyeShownPx) continue;
    faces.push([a, b]);
  }
  const mid = (f: [EyePoint, EyePoint]) => ({ u: (f[0].u + f[1].u) / 2, v: (f[0].v + f[1].v) / 2 });
  faces.sort((p, q) => mid(p).u - mid(q).u || mid(p).v - mid(q).v);
  return checked(faces.length ? { outcome: 'faces', faces: faces.map((eyes) => ({ eyes })), method } : { outcome: 'none', faces: [], method });
}
/** core EyesAnswerSchema, last; a failure is 502 with a code, never the ZodError. */
function checked(a: unknown): EyesAnswer {
  const r = EyesAnswerSchema.safeParse(a);
  if (!r.success) throw picmodelsError('engineFailed', { reason: 'answer' });
  return r.data;
}
