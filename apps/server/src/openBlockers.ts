/**
 * Rows D8 (egress) and H1 (licences) of ADR-0036, warn and continue: in OPEN server mode the blockers below stop nothing; each
 * becomes a warning that quotes the descriptor's own model table (licence id, the recorded evidence sentence, the recorded
 * commercial-use value) or names the tool that may reach outside the machine. No legal conclusion is written here: the words are
 * the table's. Every other blocker (a changed graph or code digest, an unreviewed control, a model without a pinned digest and
 * size) is a fact about the files and still stops, in both modes. In GUARDED mode nothing here changes anything.
 *
 * A result made while a licence warning stood is marked (`openLicences` on the job, then `derived.modelLicences` on the asset),
 * so the export shows the non-commercial warning that exists for library files (export.ts libraryExportWarnings).
 */
import type { Blocker, CapabilityDescriptor, DistributionProfile } from '@pulseframe/providers';
import { openWarning, type OpenWarning } from './autonomy-mode.ts';

/** The blocker codes open mode warns about instead of refusing. */
export const WARNED_IN_OPEN: ReadonlySet<string> = new Set(['model_license_unknown', 'model_not_commercially_eligible', 'graph_defined_egress', 'local_tool_egress']);

/** A model's licence as the descriptor records it, carried onto the result (core schema `derived.modelLicences`). */
export interface ModelLicenceMark { path: string; licence: string | null; commercialUse: 'allowed' | 'conditional' | 'prohibited' | 'unknown' }

/**
 * Split blockers by the server mode the CALLER read (`open`, from warnsOpen at its own site). Guarded: returned unchanged, no
 * warnings. Open: the warned codes leave the list and become warnings; `marks` lists the models whose licence warning stood.
 */
export function splitBlockers<B extends Blocker>(d: CapabilityDescriptor, profile: DistributionProfile, blockers: B[], open: boolean): { blockers: B[]; warnings: OpenWarning[]; marks: ModelLicenceMark[] } {
  if (!open) return { blockers, warnings: [], marks: [] };
  const warned = blockers.filter((b) => WARNED_IN_OPEN.has(b.code));
  if (!warned.length) return { blockers, warnings: [], marks: [] };
  const warnings: OpenWarning[] = [];
  const marks: ModelLicenceMark[] = [];
  if (warned.some((b) => b.code === 'model_license_unknown' || b.code === 'model_not_commercially_eligible')) {
    for (const m of d.models) {
      const unknown = !m.license || !m.licenseEvidence;
      const notCommercial = profile === 'commercial' && m.commercialUse !== 'allowed';
      if (!unknown && !notCommercial) continue;
      warnings.push(m.license ? openWarning('licence', { model: m.path, licence: m.license, evidence: m.licenseEvidence ?? '', use: m.commercialUse }) : openWarning('licence_unknown', { model: m.path }));
      marks.push({ path: m.path, licence: m.license ?? null, commercialUse: m.commercialUse });
    }
  }
  if (warned.some((b) => b.code === 'graph_defined_egress' || b.code === 'local_tool_egress')) warnings.push(openWarning('egress', { tool: d.id }));
  return { blockers: blockers.filter((b) => !WARNED_IN_OPEN.has(b.code)), warnings, marks };
}
/** What a job input records at admission: the warnings, and the licence marks its result carries. */
export const openAdmission = (s: { warnings: OpenWarning[]; marks: ModelLicenceMark[] }) => ({ ...(s.warnings.length ? { openWarnings: s.warnings } : {}), ...(s.marks.length ? { openLicences: s.marks } : {}) });
