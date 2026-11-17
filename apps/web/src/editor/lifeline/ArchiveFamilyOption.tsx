/**
 * The archive option «בלי פרטי משפחה» (ADR-0021, people section), mounted beside the archive download link of the deliver
 * panel (apps/web/src/editor/DeliverPanel.tsx, the `archive-download` link). Shown only when the project has people. A
 * checkbox; when it is on, the link is peopleApi.archiveUrl(id, 'omit'), the note PEOPLE_STRINGS.archiveFamilyNote is shown
 * (media files are unchanged), and the titles of peopleApi.familyCheck are listed before the download (frozen at their first
 * value; fields without data), each with its timeline label, so nothing is silently broken.
 * Test ids: PEOPLE_TESTIDS.archiveFamily, archiveFamilyVarying, archiveFamilyEmpty.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then nothing is drawn, and the
 * deliver panel's link stays the full archive.
 */
import type { ReactElement } from 'react';
/** `onHref` gives the deliver panel the link to use (the full archive, or the one without family details). */
export function ArchiveFamilyOption(_props: { projectId: string; onHref: (href: string) => void }): ReactElement | null {
  return null;
}
