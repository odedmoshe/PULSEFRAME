/**
 * The family film planner (wave 5, ADR-0026): planFamilyFilm and filmPickKey, exactly as declared in familyFilmContract.ts
 * (PlanFamilyFilm, FilmPickKey). Pure and deterministic: no clock, no random source, no I/O; the document is never mutated.
 *
 * LEAD STUB, final signatures. W1 (core) owns the bodies, familyFilm.test.ts and familyFilm.testDouble.ts. Until then both
 * refuse; nothing is planned. W1 sets FAMILY_FILM_BUILT to true with the bodies (the server answers 501 film_not_built while it
 * is false, as built-in music did before it was built).
 */
import type { FamilyFilmPlan, FilmPickKey, FilmPlanContext, PlanFamilyFilm } from './familyFilmContract.ts';
import type { ProjectDocument } from './schema.ts';

/** True once the planner below is built. */
export const FAMILY_FILM_BUILT: boolean = false;

export const filmPickKey: FilmPickKey = (assetId: string, ordinal: number): string => {
  void assetId; void ordinal;
  throw new Error('filmPickKey: not built yet (family film W1)');
};

export const planFamilyFilm: PlanFamilyFilm = (doc: ProjectDocument, params: unknown, ctx: FilmPlanContext): FamilyFilmPlan => {
  void doc; void params; void ctx;
  throw new Error('planFamilyFilm: not built yet (family film W1)');
};
