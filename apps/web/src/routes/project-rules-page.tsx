import type { AutoAcceptRule } from '@analyzr/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDownIcon, PlusIcon, Undo2Icon, WandSparklesIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ErrorText } from '@/components/error-text';
import { LightPopover, MENU_ITEM_CLASS } from '@/components/light-popover';
import { AgentRevokeDialog } from '@/components/rules/agent-revoke';
import { ApplyDialog } from '@/components/rules/apply-dialog';
import { PreTrustDialog } from '@/components/rules/pre-trust-dialog';
import { RevokeDialog } from '@/components/rules/revoke-dialog';
import { RuleDialog, type RuleDraft } from '@/components/rules/rule-dialog';
import { RuleHistoryDialog } from '@/components/rules/rule-history';
import { ReadOnlyNotice } from '@/components/read-only-notice';
import { RuleTable } from '@/components/rules/rule-table';
import { SystemRuleCard } from '@/components/rules/system-rule-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

import { inForceAgents } from '@/lib/auto-accept';
import { useAutoAcceptIndex } from '@/lib/auto-accept-actions';
import { OPEN_PROPOSALS_HINT } from '@/lib/auto-accept-rules';
import { useProjectPermissions } from '@/lib/permissions';
import { agentTokensQuery, autoAcceptRulesQuery, keys, projectQuery } from '@/lib/queries';
import { autoAcceptApplyDryRunQuery, meQuery } from '@/lib/auto-accept-queries';

import { projectRulesRoute, type RulesSearch } from './project-rules';

type Open =
  | { kind: 'create'; draft?: RuleDraft }
  | { kind: 'edit' | 'apply' | 'revoke' | 'history'; rule: AutoAcceptRule }
  | { kind: 'offer-apply'; rule: AutoAcceptRule; count: number }
  | { kind: 'agent-revoke' }
  | { kind: 'pre-trust' }
  | null;

/** „Gleicher Name ab 100 %“ (its name follows the criteria): the rule a bulk accept of the key tier offers (UX5). */
const KEY_RULE_DRAFT: RuleDraft = { tier: 'key', percent: '100' };

/**
 * A rule for derived calls (M6 S2c-3), prefilled with the source the bulk
 * accept of such calls offers (`?new=calls&derivedKind=…&converter=…`);
 * without a source, „Export ohne Camunda-Engine“.
 */
function callsRuleDraft(search: RulesSearch): RuleDraft {
  return {
    derived: {
      derivedKind: search.derivedKind ?? 'export',
      converter: search.derivedKind === 'converted' ? (search.converter ?? null) : null,
    },
  };
}

/** A control of the page by its test id, or of a rule's row with `ruleId`. */
function control(testId: string, ruleId?: string): HTMLElement | null {
  const scope =
    ruleId === undefined
      ? document
      : [...document.querySelectorAll<HTMLElement>('[data-testid="rule-row"]')].find(
          (row) => row.dataset['ruleId'] === ruleId,
        );
  return scope?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null;
}

/**
 * Where the focus goes when a dialog of a rule closes: its row's „Mehr“, else
 * its switch, else the page's „Neue Regel“ or „Mehr“. The dialogs open as a
 * menu closes, or from a hint that may be gone by then (or from another
 * dialog), so Radix has nothing to return to.
 */
const rowFocus = (ruleId: string) => () =>
  control('rule-more', ruleId) ??
  control('rule-toggle', ruleId) ??
  control('new-rule') ??
  control('rules-more');

/** Where the focus goes when „Vor der Vertrauensregel angenommen“ closes: its line, else „Neue Regel“. */
const preTrustFocus = () => control('system-rule-pre-trust') ?? control('new-rule');

/** Where the focus goes when „Nach Agent widerrufen…“ closes: the page's „Mehr“ (gone once nothing is in force). */
const pageFocus = () => control('rules-more') ?? control('new-rule');

/** The page's „Mehr“ (UX9): actions across rules, here „Nach Agent widerrufen…“. */
function PageMenu({ onAgentRevoke }: { onAgentRevoke: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <LightPopover
      open={open}
      onOpenChange={setOpen}
      role="menu"
      label="Weitere Aktionen"
      trigger={(props) => (
        <Button variant="outline" data-testid="rules-more" {...props}>
          Mehr
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      )}
    >
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM_CLASS}
        onClick={() => {
          setOpen(false);
          onAgentRevoke();
        }}
        data-testid="agent-revoke-open"
      >
        <Undo2Icon aria-hidden />
        Nach Agent widerrufen…
      </button>
    </LightPopover>
  );
}

/**
 * „Annahmeregeln“ (owner decision 19; UX-SIMPLIFICATION.md §3.11 items 3–7):
 * the safeguard said once, the built-in system rule of decision 9 in one
 * line, the project's auto-accept rules (a row: the „Aktiv“ switch,
 * „Bearbeiten“ with the live preview, „Mehr“ with „Verlauf“ and
 * „Widerrufen…“; an active rule's open matches as a hint that opens the
 * apply dialog), and in the header's „Mehr“, while acceptances are in
 * force, revoking one agent's acceptances across rules. The system rule's
 * line opens „Vor der Vertrauensregel angenommen“ while acceptances from
 * before the trust rule wait for review (M6 S2c-4; never in the demo). „Neue Regel“ only
 * beside rules: the empty page has „Erste Regel anlegen“. Owners only;
 * agents never see rules.
 */
export function RulesPage() {
  const { project } = projectRulesRoute.useParams();
  const queryClient = useQueryClient();
  const info = useQuery(projectQuery(project));
  const can = useProjectPermissions(project);
  const owner = can.isOwner;
  const rules = useQuery({ ...autoAcceptRulesQuery(project), enabled: owner });
  const tokens = useQuery({ ...agentTokensQuery(project), enabled: owner });
  const me = useQuery({ ...meQuery, enabled: owner });
  const autoIndex = useAutoAcceptIndex(project);
  const agents = inForceAgents(autoIndex);
  const search = projectRulesRoute.useSearch();
  const navigate = projectRulesRoute.useNavigate();
  // `?new=key` (after a bulk accept of „Gleicher Name“) or `?new=calls` (after one of unique
  // calls from derived models, M6 S2c-3): the new rule prefilled, the URL cleaned.
  const [open, setOpen] = useState<Open>(() =>
    search.new === 'key'
      ? { kind: 'create', draft: KEY_RULE_DRAFT }
      : search.new === 'calls'
        ? { kind: 'create', draft: callsRuleDraft(search) }
        : null,
  );
  useEffect(() => {
    if (search.new) void navigate({ search: {}, replace: true });
  }, [search.new, navigate]);
  /** Closes the dialog of `kinds` only: a dialog that closes as another opens leaves that one. */
  const closer =
    (...kinds: NonNullable<Open>['kind'][]) =>
    (isOpen: boolean) => {
      if (!isOpen) setOpen((current) => (current && kinds.includes(current.kind) ? null : current));
    };
  const reload = () =>
    void queryClient.invalidateQueries({ queryKey: keys.autoAcceptRules(project) });

  /** After saving an enabled rule in its dialog: offer to apply it when open proposals already match. */
  async function offerApply(rule: AutoAcceptRule) {
    if (!rule.enabled || !rule.authorIsOwner) return;
    try {
      const dry = await queryClient.fetchQuery(
        autoAcceptApplyDryRunQuery(project, rule.id, rule.revision),
      );
      if (dry.count > 0) setOpen({ kind: 'offer-apply', rule, count: dry.count });
    } catch {
      // The offer is a convenience: the row's hint „… passen – ansehen …“ shows them too.
    }
  }

  if (info.isPending) return <Skeleton className="h-40 w-full" />;
  if (!owner) {
    return (
      <ReadOnlyNotice
        demo={can.demo}
        title="Nur für Inhaber"
        demoText="In der Demo gibt es keine Annahmeregeln."
        roleText="Annahmeregeln sehen und pflegen nur die Inhaber dieses Projekts."
      />
    );
  }
  if (rules.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Regeln konnten nicht geladen werden</AlertTitle>
        <AlertDescription>
          <ErrorText error={rules.error} />
        </AlertDescription>
      </Alert>
    );
  }
  if (!rules.data) return <Skeleton className="h-40 w-full" />;
  const list = rules.data.items;
  const ruleOpen = open && 'rule' in open ? open.rule : null;

  return (
    <div className="flex flex-col gap-5" data-testid="rules-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-3xl flex-col gap-1">
          <h2 className="text-lg font-semibold">Annahmeregeln</h2>
          <p className="text-sm text-muted-foreground" data-testid="rules-safeguard">
            analyzr nimmt neue Vorschläge, die eine aktive Regel trifft, selbst an – nie bei einer
            offenen Frage, einem Einwand oder wenn du schon entschieden hast.
          </p>
        </div>
        {list.length > 0 || agents.length > 0 ? (
          <div className="flex items-center gap-2">
            {list.length > 0 ? (
              <Button onClick={() => setOpen({ kind: 'create' })} data-testid="new-rule">
                <PlusIcon data-icon="inline-start" />
                Neue Regel
              </Button>
            ) : null}
            {agents.length > 0 ? (
              <PageMenu onAgentRevoke={() => setOpen({ kind: 'agent-revoke' })} />
            ) : null}
          </div>
        ) : null}
      </div>
      <SystemRuleCard
        project={project}
        system={rules.data.system}
        {...(can.demo ? {} : { onPreTrust: () => setOpen({ kind: 'pre-trust' }) })}
      />
      {list.length === 0 ? (
        <Empty className="border bg-card" data-testid="rules-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WandSparklesIcon />
            </EmptyMedia>
            <EmptyTitle>Noch keine Regeln</EmptyTitle>
            <EmptyDescription>Ohne Regeln entscheidest du jeden Vorschlag selbst.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setOpen({ kind: 'create' })} data-testid="new-rule">
              <PlusIcon data-icon="inline-start" />
              Erste Regel anlegen
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <RuleTable
          project={project}
          rules={list}
          me={me.data?.principalId ?? null}
          onEdit={(rule) => setOpen({ kind: 'edit', rule })}
          onApply={(rule) => setOpen({ kind: 'apply', rule })}
          onRevoke={(rule) => setOpen({ kind: 'revoke', rule })}
          onHistory={(rule) => setOpen({ kind: 'history', rule })}
          onReload={reload}
        />
      )}

      <RuleDialog
        project={project}
        rule={open?.kind === 'edit' ? open.rule : null}
        draft={open?.kind === 'create' ? open.draft : undefined}
        ruleNames={list.map((r) => r.name)}
        tokens={tokens.data ?? []}
        open={open?.kind === 'create' || open?.kind === 'edit'}
        onOpenChange={closer('create', 'edit')}
        onSaved={(rule) => void offerApply(rule)}
      />
      {ruleOpen ? (
        <>
          <ApplyDialog
            project={project}
            rule={ruleOpen}
            open={open?.kind === 'apply'}
            onOpenChange={closer('apply')}
            returnFocus={rowFocus(ruleOpen.id)}
          />
          <RevokeDialog
            project={project}
            selection={{ ruleId: ruleOpen.id }}
            title={`Annahmen der Regel „${ruleOpen.name}“ widerrufen`}
            open={open?.kind === 'revoke'}
            onOpenChange={closer('revoke')}
            returnFocus={rowFocus(ruleOpen.id)}
          />
          <RuleHistoryDialog
            project={project}
            rule={ruleOpen}
            open={open?.kind === 'history'}
            onOpenChange={closer('history')}
            returnFocus={rowFocus(ruleOpen.id)}
          />
        </>
      ) : null}
      <PreTrustDialog
        project={project}
        open={open?.kind === 'pre-trust'}
        onOpenChange={closer('pre-trust')}
        returnFocus={preTrustFocus}
      />
      {agents.length > 0 ? (
        <AgentRevokeDialog
          project={project}
          agents={agents}
          open={open?.kind === 'agent-revoke'}
          onOpenChange={closer('agent-revoke')}
          returnFocus={pageFocus}
        />
      ) : null}
      <AlertDialog open={open?.kind === 'offer-apply'} onOpenChange={closer('offer-apply')}>
        <AlertDialogContent data-testid="offer-apply">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {open?.kind === 'offer-apply'
                ? open.count === 1
                  ? '1 offener Vorschlag erfüllt die Regel bereits – jetzt anwenden?'
                  : `${open.count} offene Vorschläge erfüllen die Regel bereits – jetzt anwenden?`
                : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>{OPEN_PROPOSALS_HINT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Später</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                open?.kind === 'offer-apply'
                  ? setOpen({ kind: 'apply', rule: open.rule })
                  : undefined
              }
            >
              Liste ansehen…
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
