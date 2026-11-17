/**
 * Fixed data-testids of the people UI (ADR-0021, people section), shared by the editor components and the proofs
 * (lifeline-ui-proof.ts, a11y-audit.ts). Lead contracts commit: W3 puts exactly these on the elements named here.
 */
export const PEOPLE_TESTIDS = {
  // the people sheet (palette «אנשים…», and «הוספת אדם…» in the field menu): the sheet, its privacy line, "add a person", "copy from another project"
  peopleOpen: 'life-people-open', sheet: 'life-people', privacy: 'life-people-privacy', personAdd: 'life-person-add', peopleCopy: 'life-people-copy',
  // a person's row and its controls: name, birth date (with the Hebrew date beside it), the word before the age (בן · בת · —), remove
  personRow: (id: string) => `life-person-${id}`, personName: (id: string) => `life-person-name-${id}`, personBirth: (id: string) => `life-person-birth-${id}`,
  personBirthHebrew: (id: string) => `life-person-birth-he-${id}`, personForm: (id: string) => `life-person-form-${id}`, personRemove: (id: string) => `life-person-remove-${id}`,
  // the archive download (DeliverPanel): the option «בלי פרטי משפחה», and the lists of titles it will freeze or empty
  archiveFamily: 'archive-family', archiveFamilyVarying: 'archive-family-varying', archiveFamilyEmpty: 'archive-family-empty',
} as const;
