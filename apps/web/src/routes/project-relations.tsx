import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';

import { ErrorText } from '@/components/error-text';
import { RelationsView } from '@/components/relation-table';
import { RelationViews } from '@/components/review/relation-views';
import { RelationsEmpty } from '@/components/review/relations-empty';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ledgerRules } from '@/lib/auto-accept';
import { useAutoAcceptIndex, useCanReview, useIsOwner } from '@/lib/auto-accept-actions';
import { autoAcceptRulesQuery, landscapeQuery, modelsQuery, valueChainQuery } from '@/lib/queries';
import type { RefLabel } from '@/lib/refs';
import { matchesFilters, parseRelationFilters, resultViewOf } from '@/lib/relation-filters';
import { reviewQueue, sideName } from '@/lib/review';
import { useProjectFacts } from '@/lib/use-project-facts';

import { projectRoute } from './project';

export const projectRelationsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'relations',
  validateSearch: parseRelationFilters,
  component: RelationsTab,
});

/** An end's name for the row's „Öffnen“: the element's label, else its process (no ids, P2). */
const endName = (label: RefLabel) => label.label ?? sideName(label);

/**
 * The result views of „Relationen“ (UX-SIMPLIFICATION.md §3.10; UX5, UX9):
 * „Gilt“, „Abgelehnt“, „Automatisch angenommen“ and „Alle“ with their
 * filters in the URL; each row's „Öffnen“ leads to the review screen with
 * the list's filters, so J/K walk this list and the way back returns to it.
 * While the project has no relation at all, `RelationsEmpty` instead of
 * views and filters.
 */
function RelationsTab() {
  const { project } = projectRelationsRoute.useParams();
  const filters = projectRelationsRoute.useSearch();
  const navigate = projectRelationsRoute.useNavigate();
  const landscape = useQuery(landscapeQuery(project));
  const models = useQuery(modelsQuery(project));
  const chain = useQuery(valueChainQuery(project));
  const { resolve } = useProjectFacts(project, models.data);
  const owner = useIsOwner(project);
  const reviewer = useCanReview(project);
  const autoIndex = useAutoAcceptIndex(project);
  const rules = useQuery({ ...autoAcceptRulesQuery(project), enabled: owner });
  // Owners filter by any of their relation rules; editors by the rules the ledger names.
  const autoRules = owner
    ? (rules.data?.items ?? []).filter((r) => r.kind === 'relation')
    : reviewer
      ? ledgerRules(autoIndex, 'relation')
      : undefined;

  if (landscape.isPending) return <Skeleton className="h-60 w-full" />;
  if (landscape.isError)
    return (
      <Alert variant="destructive">
        <AlertTitle>Relationen konnten nicht geladen werden</AlertTitle>
        <AlertDescription>
          <ErrorText error={landscape.error} />
        </AlertDescription>
      </Alert>
    );

  const relations = landscape.data.relations;
  if (relations.length === 0)
    return (
      <RelationsEmpty
        project={project}
        hasModels={landscape.data.models.length > 0}
        hasChain={chain.data !== undefined}
      />
    );

  const modelKeys = landscape.data.models.map((m) => m.key).sort();
  const autoCount =
    autoRules !== undefined
      ? relations.filter((r) => matchesFilters(r, { auto: 'any' }, autoIndex)).length
      : null;
  return (
    <div className="flex flex-col gap-4">
      <RelationViews
        project={project}
        current={resultViewOf(filters)}
        reviewCount={reviewQueue(relations, models.data ?? []).length}
        autoCount={autoCount}
        model={filters.model}
      />
      <RelationsView
        relations={relations}
        resolve={resolve}
        modelKeys={modelKeys}
        filters={filters}
        onFiltersChange={(next) => void navigate({ search: next, replace: true })}
        autoIndex={autoIndex}
        autoRules={autoRules}
        renderActions={(relation) => (
          <Button variant="outline" size="sm" asChild>
            <Link
              to="/projects/$project/review/$relation"
              params={{ project, relation: relation.id }}
              search={{ ...filters, from: 'relations' as const }}
              aria-label={`${endName(resolve(relation.from))} → ${endName(resolve(relation.to))} öffnen`}
              data-testid="relation-open"
            >
              Öffnen
            </Link>
          </Button>
        )}
      />
    </div>
  );
}
