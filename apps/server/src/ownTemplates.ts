/**
 * «שמירת הסרט כתבנית» on the server (wave 8 owntemplate; core ownTemplateContract.ts). LEAD PRE-PASS: the store file contract, the
 * owner check COMPLETE on every route (403 owner_required before the id or the body is read) and an honest 501
 * own_template_not_built after it; the store and gallery functions as typed stubs. BUILDER W2 owns this file after the pre-pass and
 * replaces each stub; the first line of every handler stays `ownTemplateOwner(need(c, 'observe'))`.
 *
 * The store: `<dataDir>/own-templates.json` = OwnTemplatesFileSchema ({version: 1, templates: [{def}]}, insertion order, no
 * timestamps), written atomically (tmp + rename, mode 0600, chmod ignored on Windows) as instruments/heard.ts does; read with an
 * mtime cache; each entry parsed with TemplateDefSchema and re-scanned (scanOwnTemplate) on read: an entry that fails is listed
 * unavailable (privacy_scan_failed) and never planned. Limits OWN_TEMPLATE_STORE. It IS backed up (backup.ts step 3b, C1); never in a
 * project archive. Saving and deleting change no project: no op, exactly like marking a kit heard.
 */
import path from 'node:path';
import type { Context, Hono } from 'hono';
import {
  OWN_TEMPLATE_BUILT, OWN_TEMPLATE_STORE, ownTemplateNotBuilt, OwnTemplateRefusal, ownTemplateRefusal,
  type OwnTemplateSummary, type TemplateDef,
} from '@pulseframe/core';
import { isOwnerSession } from './assistant/contract.ts';
import type { Scope } from './auth.ts';
import type { Config } from './config.ts';
import type { Governance, Principal } from './governance.ts';
import { ApiError, type Store } from './store.ts';

/** The file name in the data directory (backup.ts copies it every time: step 3b). */
export const OWN_TEMPLATES_FILE = OWN_TEMPLATE_STORE.file;
export const ownTemplatesPath = (dataDir: string): string => path.join(dataDir, OWN_TEMPLATES_FILE);

/** A core OwnTemplateRefusal as the ApiError the routes answer (same status, code, message, hint and details). */
export const ownTemplateApiError = (e: OwnTemplateRefusal): ApiError => new ApiError(e.status, e.code, e.message, e.details, e.hint);
/** The first line of every own-template handler: the owner's own session, else 403 owner_required. */
export function ownTemplateOwner(p: Principal): Principal {
  if (!isOwnerSession(p)) throw ownTemplateApiError(ownTemplateRefusal('ownerRequired'));
  return p;
}

// ---------- the store (STUBS until W2) ----------
/** Every stored own definition that parses and passes the scan, in insertion order. */
export function readOwnTemplates(dataDir: string): TemplateDef[] { void dataDir; throw ownTemplateNotBuilt('store'); }
/** One stored definition by id, or undefined (templates.ts templateOf tries this only for the tpl.own- prefix, C10). */
export function findOwnTemplate(dataDir: string, templateId: string): TemplateDef | undefined { void dataDir; void templateId; return undefined; }
/** Append a definition (409 already_saved for the same content, too_many_templates past OWN_TEMPLATE_STORE.templates). */
export function saveOwnTemplate(dataDir: string, def: TemplateDef): void { void dataDir; void def; throw ownTemplateNotBuilt('store'); }
/** Remove one (404 when absent). Runs made from it keep working; only regeneration needs it (C10). */
export function deleteOwnTemplate(dataDir: string, templateId: string): void { void dataDir; void templateId; throw ownTemplateNotBuilt('store'); }
/**
 * The own templates of the gallery for `principal` (GET /api/v1/templates and catalog().templates join them after the built-ins):
 * core ownSummaryForReader strips kept words for every reader but the owner's own session (C2h). The same stripped definition is
 * what plan/apply use for such a reader, so an agent never receives the family's words through a plan either. [] until W2.
 */
export function ownGalleryFor(dataDir: string, principal: Principal): OwnTemplateSummary[] { void dataDir; void principal; return []; }

// ---------- routes ----------
export type OwnTemplateEnv = { Variables: { principal: Principal } };
export interface OwnTemplateRouteDeps { cfg: Config; store: Store; gov: Governance; need: (c: Context<OwnTemplateEnv>, scope: Scope) => Principal }
/**
 * POST /api/v1/projects/:id/own-templates/preview  OwnTemplatePreviewBody -> OwnTemplatePreviewAnswer (read-only; nothing written)
 * POST /api/v1/projects/:id/own-templates          OwnTemplateSaveBody    -> OwnTemplateSaveAnswer (captures again; 409 stale_revision)
 * DELETE /api/v1/own-templates/:templateId                                -> OwnTemplateDeleteAnswer
 */
export function registerOwnTemplateRoutes(app: Hono<OwnTemplateEnv>, deps: OwnTemplateRouteDeps): void {
  const { need } = deps;
  const notBuilt = (part: string): never => { throw ownTemplateApiError(ownTemplateNotBuilt(part)); };
  void OWN_TEMPLATE_BUILT;
  app.post('/api/v1/projects/:id/own-templates/preview', (c) => { ownTemplateOwner(need(c, 'observe')); return notBuilt('preview'); });
  app.post('/api/v1/projects/:id/own-templates', (c) => { ownTemplateOwner(need(c, 'observe')); return notBuilt('save'); });
  app.delete('/api/v1/own-templates/:templateId', (c) => { ownTemplateOwner(need(c, 'observe')); return notBuilt('delete'); });
}
