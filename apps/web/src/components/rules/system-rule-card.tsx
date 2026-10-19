import type { AutoAcceptSystemRule } from '@analyzr/client';
import { Link } from '@tanstack/react-router';
import { LockIcon } from 'lucide-react';

/**
 * Decision 9 as a fixed system rule, in one line (UX-SIMPLIFICATION.md
 * §3.11 item 6): „Eindeutige Aufrufe nimmt analyzr beim Hochladen an ·
 * immer aktiv · 10 angenommen“, the count leading to those relations. Always
 * on, never stored as an auto-accept rule, not editable; what it matches and
 * its procedure stay out of the text (P2).
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
        {system.name} nimmt analyzr beim Hochladen an
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
      </span>
    </p>
  );
}
