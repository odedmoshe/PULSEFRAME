/**
 * The export sheet's licence lines (wave 7 library track), beside the flash card: «לשימוש לא מסחרי בלבד: …» when the job output's
 * licence.nonCommercial is not empty, and the credits card with its copy button and the paste note. Read from the job output only
 * (the server computed it from the export's snapshot). WORKER C builds it; until then it draws nothing.
 */
export function ExportLicenceLines({ output }: { output: Record<string, unknown> | null | undefined }) {
  void output;
  return null;
}
