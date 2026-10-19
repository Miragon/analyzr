import type { AutoAcceptSystemRule } from '@analyzr/client';
import { Link } from '@tanstack/react-router';
import { LockIcon } from 'lucide-react';

/**
 * Decision 9 as a fixed system rule, in one line (UX-SIMPLIFICATION.md
 * §3.11 item 6): „Eindeutige Aufrufe aus Camunda-Modellen nimmt analyzr beim
 * Hochladen an · immer aktiv · 10 angenommen“, the count leading to those
 * relations; with the trust rule (M6 S2c, decision 24.2) „ · 12 aus
 * abgeleiteten Modellen vorgeschlagen“ when such proposals are open, as text
 * (a count leads only to a list of exactly those rows). Always on, never
 * stored as an auto-accept rule, not editable; what it matches and its
 * procedure stay out of the text (P2).
 */
export function SystemRuleCard({
  project,
  system,
}: {
  project: string;
  system: AutoAcceptSystemRule;
}) {
  const accepted = `${system.accepted} angenommen`;
  return (
    <p
      className="flex items-start gap-2 rounded-xl border bg-card px-4 py-3 text-sm"
      data-testid="system-rule"
    >
      <LockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        {system.name} aus Camunda-Modellen nimmt analyzr beim Hochladen an
        <span className="text-muted-foreground"> · immer aktiv · </span>
        {system.accepted > 0 ? (
          <Link
            to="/projects/$project/relations"
            params={{ project }}
            search={{ status: 'accepted', tier: 'rule' }}
            className="text-link tabular-nums hover:underline"
            data-testid="system-rule-count"
          >
            {accepted}
          </Link>
        ) : (
          <span className="text-muted-foreground tabular-nums" data-testid="system-rule-count">
            {accepted}
          </span>
        )}
        {system.proposed > 0 ? (
          <>
            <span className="text-muted-foreground"> · </span>
            {/* Text only: no list shows exactly these rows yet (the bulk dialog's group, S2c-2). */}
            <span className="tabular-nums" data-testid="system-rule-proposed">
              {system.proposed} aus abgeleiteten Modellen vorgeschlagen
            </span>
          </>
        ) : null}
      </span>
    </p>
  );
}
