import { PlainText } from '@/components/review/plain-text';
import { subjectLabel, type Subject, type SubjectNames } from '@/lib/auto-accept-names';

/**
 * One entry of the apply and revoke lists (UX-SIMPLIFICATION.md §3.11 item
 * 7): the relation's processes („Auftragsabwicklung → Rechnungsstellung“)
 * or the placement's process and step by name, below the type with the
 * element's name and `details` (agent, „97 %“, what becomes of it). No
 * refs; the names come from the BPMN, so they render as plain text.
 */
export function SubjectText({
  subject,
  names,
  details,
}: {
  subject: Subject;
  names: SubjectNames;
  /** Further facts for the second line, e.g. the agent and the confidence. */
  details: readonly string[];
}) {
  const label = subjectLabel(subject, names.resolve, names.stepName);
  return (
    <>
      <PlainText as="span" className="text-sm font-medium" text={label.title} />
      <PlainText
        as="span"
        className="text-xs text-muted-foreground"
        text={[label.meta, ...details].join(' · ')}
      />
    </>
  );
}
