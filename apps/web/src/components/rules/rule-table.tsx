import type { AutoAcceptRule } from '@analyzr/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ChevronDownIcon,
  HistoryIcon,
  PencilIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { useState } from 'react';

import { LightPopover, MENU_ITEM_CLASS } from '@/components/light-popover';
import { PlainText } from '@/components/review/plain-text';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError, errorMessage } from '@/lib/api';
import type { AutoFilter } from '@/lib/auto-accept';
import {
  AUTO_ACCEPT_KINDS,
  draftOf,
  formatThreshold,
  narrowingOf,
  openMatchesText,
  tierLabel,
} from '@/lib/auto-accept-rules';
import { useReviseRule } from '@/lib/auto-accept-rule-actions';
import { autoAcceptApplyDryRunQuery } from '@/lib/auto-accept-queries';
import { toast } from '@/lib/toast';

import { EnableDialog, type EnableRequest } from './enable-dialog';

export interface RuleTableProps {
  project: string;
  /** In creation order: the first matching rule is recorded. */
  rules: readonly AutoAcceptRule[];
  /** The caller's principal id, once known: enabling another's rule makes them its deciding person. */
  me: string | null;
  onEdit: (rule: AutoAcceptRule) => void;
  /** Open the rule's apply dialog (the row's hint, or after enabling with „Liste ansehen…“). */
  onApply: (rule: AutoAcceptRule) => void;
  onRevoke: (rule: AutoAcceptRule) => void;
  onHistory: (rule: AutoAcceptRule) => void;
  /** Reload the rules (after a 412). */
  onReload: () => void;
}

/** „Bisher“: only the counts above 0 (UX-SIMPLIFICATION.md §3.11 item 3); acceptances in force lead to them. */
function Stats({ project, rule }: { project: string; rule: AutoAcceptRule }) {
  const s = rule.stats;
  const parts = [
    s.confirmed > 0
      ? { text: `${s.confirmed} bestätigt`, title: 'Seither von einem Menschen angenommen' }
      : null,
    s.revoked > 0
      ? { text: `${s.revoked} widerrufen`, title: 'Von einem Inhaber widerrufen' }
      : null,
    s.overruled > 0
      ? {
          text: `${s.overruled} abgelehnt, korrigiert oder vorgemerkt`,
          title: 'Seither von einem Menschen abgelehnt, korrigiert oder vorgemerkt',
        }
      : null,
  ].filter((p) => p !== null);
  if (s.inForce === 0 && parts.length === 0) {
    return <span className="text-muted-foreground">–</span>;
  }
  return (
    <>
      {s.inForce > 0 ? (
        <span className="block" title="Von der Regel angenommen und weiter in Kraft">
          {rule.kind === 'relation' ? (
            <Link
              to="/projects/$project/relations"
              params={{ project }}
              search={{ auto: rule.id as AutoFilter }}
              className="text-link hover:underline"
            >
              {s.inForce} in Kraft
            </Link>
          ) : (
            `${s.inForce} in Kraft`
          )}
        </span>
      ) : null}
      {parts.map((p) => (
        <span key={p.text} className="block" title={p.title}>
          {p.text}
        </span>
      ))}
    </>
  );
}

/**
 * „2 offene Vorschläge passen – ansehen …“ (UX9): the apply action only as a
 * hint on an active rule whose dry run finds open proposals.
 */
function OpenHint({
  project,
  rule,
  onApply,
}: {
  project: string;
  rule: AutoAcceptRule;
  onApply: (rule: AutoAcceptRule) => void;
}) {
  const active = rule.enabled && rule.authorIsOwner;
  const dry = useQuery({
    ...autoAcceptApplyDryRunQuery(project, rule.id, rule.revision),
    enabled: active,
  });
  const count = active ? (dry.data?.count ?? 0) : 0;
  if (count === 0) return null;
  return (
    <Button
      variant="link"
      size="xs"
      className="h-auto self-start p-0 text-left font-normal whitespace-normal"
      onClick={() => onApply(rule)}
      data-testid="rule-apply"
    >
      {openMatchesText(count)} – ansehen …
    </Button>
  );
}

/** „Mehr“ of a row: „Verlauf“, and „Widerrufen…“ while acceptances are in force. */
function RowMenu({
  rule,
  onRevoke,
  onHistory,
}: {
  rule: AutoAcceptRule;
  onRevoke: (rule: AutoAcceptRule) => void;
  onHistory: (rule: AutoAcceptRule) => void;
}) {
  const [open, setOpen] = useState(false);
  const item = (label: string, Icon: typeof HistoryIcon, run: () => void, testId: string) => (
    <button
      type="button"
      role="menuitem"
      className={MENU_ITEM_CLASS}
      onClick={() => {
        setOpen(false);
        run();
      }}
      data-testid={testId}
    >
      <Icon aria-hidden />
      {label}
    </button>
  );
  return (
    <LightPopover
      open={open}
      onOpenChange={setOpen}
      role="menu"
      label={`Mehr zu „${rule.name}“`}
      trigger={(props) => (
        <Button size="xs" variant="ghost" data-testid="rule-more" {...props}>
          Mehr
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      )}
    >
      {item('Verlauf', HistoryIcon, () => onHistory(rule), 'rule-history-open')}
      {rule.stats.inForce > 0
        ? item('Widerrufen…', Undo2Icon, () => onRevoke(rule), 'rule-revoke')
        : null}
    </LightPopover>
  );
}

/**
 * The project's auto-accept rules (owner decision 19; UX-SIMPLIFICATION.md
 * §3.11 item 3): per row the name, the criteria, what it accepted so far
 * (only the counts above 0) and three controls, the „Aktiv“ switch,
 * „Bearbeiten“ and „Mehr“ („Verlauf“, „Widerrufen…“ while acceptances are
 * in force); an active rule whose dry run finds open proposals offers them
 * in one line. Enabling and disabling write a new revision with `If-Match`;
 * enabling asks first when it makes the caller the deciding person or when
 * open proposals already match ({@link EnableDialog}), disabling never asks.
 * When someone saved a newer revision meanwhile (412) the table offers to
 * load it.
 */
export function RuleTable({
  project,
  rules,
  me,
  onEdit,
  onApply,
  onRevoke,
  onHistory,
  onReload,
}: RuleTableProps) {
  const queryClient = useQueryClient();
  const revise = useReviseRule(project);
  const [conflict, setConflict] = useState<string | null>(null);
  /** The rule whose open proposals and author are being checked before enabling. */
  const [checking, setChecking] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<EnableRequest | null>(null);
  const busy = revise.isPending || checking !== null;

  function write(rule: AutoAcceptRule, enabled: boolean, review = false) {
    setConflict(null);
    revise.mutate(
      { ruleId: rule.id, revision: rule.revision, draft: { ...draftOf(rule), enabled } },
      {
        onSuccess: (r) => {
          toast({
            tone: 'success',
            title: r.rule.enabled
              ? `Regel „${r.rule.name}“ aktiviert`
              : `Regel „${r.rule.name}“ deaktiviert`,
            description: r.rule.enabled
              ? 'Sie wirkt auf neue Agentenvorschläge.'
              : 'Ihre Annahmen bleiben und lassen sich weiter widerrufen.',
          });
          if (review && r.rule.enabled) onApply(r.rule);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 412) setConflict(rule.name);
          else
            toast({
              tone: 'danger',
              title: 'Nicht gespeichert',
              description: errorMessage(error),
              error,
            });
        },
      },
    );
  }

  /**
   * Enabling: the dry run of the head (it runs while the rule is off) and the
   * author decide whether to ask first; a failed dry run asks only about the
   * author (the offer is a convenience, the row's hint shows it later).
   */
  async function enable(rule: AutoAcceptRule) {
    setChecking(rule.id);
    const count = await queryClient
      .fetchQuery(autoAcceptApplyDryRunQuery(project, rule.id, rule.revision))
      .then((dry) => dry.count)
      .catch(() => 0)
      .finally(() => setChecking(null));
    const takeOver = !rule.authorIsOwner || (me !== null && rule.author.principalId !== me);
    if (count > 0 || takeOver) setConfirm({ rule, count, takeOver });
    else write(rule, true);
  }

  return (
    <div className="flex flex-col gap-3">
      {conflict ? (
        <Alert>
          <AlertTitle>Die Regel „{conflict}“ wurde inzwischen geändert</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Es wurde nichts gespeichert.
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setConflict(null);
                onReload();
              }}
            >
              Neuere Revision laden
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="rounded-xl border bg-card">
        {/* Not `Table`: its scrolling wrapper would clip the rows' „Mehr“ menus. Below 768 px
            the criteria move under the name and „Bisher“ hides, so nothing scrolls sideways. */}
        <table aria-label="Annahmeregeln" className="w-full text-sm" data-slot="table">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Kriterien</TableHead>
              <TableHead className="hidden md:table-cell">Bisher</TableHead>
              <TableHead>Aktiv</TableHead>
              <TableHead>
                <span className="sr-only">Aktionen</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => {
              const narrowing = narrowingOf({
                ...rule,
                agentHandle: rule.agent?.handle ?? rule.agentPrincipalId,
                agentRevoked: rule.agent?.revoked ?? false,
              });
              const criteria = `${AUTO_ACCEPT_KINDS[rule.kind].label} · ${tierLabel(rule.tier)} · ab ${formatThreshold(rule.minConfidence)}`;
              return (
                <TableRow
                  key={rule.id}
                  data-testid="rule-row"
                  data-rule-id={rule.id}
                  data-enabled={rule.enabled ? 'true' : 'false'}
                  className="align-top"
                >
                  <TableCell className="whitespace-normal md:max-w-64">
                    <div className="flex flex-col items-start gap-0.5">
                      <PlainText as="span" className="font-medium" text={rule.name} />
                      <span className="text-xs text-muted-foreground md:hidden">{criteria}</span>
                      {rule.note ? (
                        <PlainText
                          as="span"
                          className="text-xs text-muted-foreground"
                          text={rule.note}
                        />
                      ) : null}
                      {rule.authorIsOwner ? null : (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-warning"
                          data-testid="author-not-owner"
                          title="Die Regel nimmt nichts an, bis ein Inhaber sie neu speichert oder aktiviert und damit übernimmt."
                        >
                          <TriangleAlertIcon className="size-3.5" aria-hidden />
                          Urheber ist kein Inhaber mehr
                        </span>
                      )}
                      <OpenHint project={project} rule={rule} onApply={onApply} />
                    </div>
                  </TableCell>
                  <TableCell
                    className="hidden max-w-64 whitespace-normal md:table-cell"
                    data-testid="rule-criteria"
                  >
                    <span className="block">{criteria}</span>
                    {narrowing.length > 0 ? (
                      <PlainText
                        as="span"
                        className="block text-xs text-muted-foreground"
                        text={narrowing.join(' · ')}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="hidden text-xs tabular-nums md:table-cell"
                    data-testid="rule-stats"
                  >
                    <Stats project={project} rule={rule} />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.enabled}
                      disabled={busy}
                      aria-label={`Regel „${rule.name}“ aktiv`}
                      onCheckedChange={(on) => (on ? void enable(rule) : write(rule, false))}
                      data-testid="rule-toggle"
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="xs" variant="outline" onClick={() => onEdit(rule)}>
                        <PencilIcon data-icon="inline-start" />
                        Bearbeiten
                      </Button>
                      <RowMenu rule={rule} onRevoke={onRevoke} onHistory={onHistory} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </table>
      </div>
      <EnableDialog
        request={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        onEnable={(rule, review) => {
          setConfirm(null);
          write(rule, true, review);
        }}
      />
    </div>
  );
}
