import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { LocateIcon, SearchCheckIcon } from 'lucide-react';

import { ErrorText } from '@/components/error-text';
import { RelationsView } from '@/components/relation-table';
import { RelationViews, type RelationView } from '@/components/review/relation-views';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ledgerRules } from '@/lib/auto-accept';
import { useAutoAcceptIndex, useCanReview, useIsOwner } from '@/lib/auto-accept-actions';
import { autoAcceptRulesQuery, landscapeQuery, modelsQuery } from '@/lib/queries';
import { splitRef } from '@/lib/refs';
import { matchesFilters, parseRelationFilters, type RelationFilters } from '@/lib/relation-filters';
import { reviewQueue } from '@/lib/review';
import { useProjectFacts } from '@/lib/use-project-facts';

import { projectRoute } from './project';

/** Which view of „Relationen“ a filter set is (UX5): „Gilt“, „Abgelehnt“, „Automatisch angenommen“, else „Alle“. */
function viewOf(filters: RelationFilters): RelationView {
  if (filters.auto === 'any' && filters.status === undefined) return 'auto';
  if (filters.auto !== undefined) return 'all';
  if (filters.status === 'accepted') return 'accepted';
  if (filters.status === 'rejected') return 'rejected';
  return 'all';
}

export const projectRelationsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'relations',
  validateSearch: parseRelationFilters,
  component: RelationsTab,
});

function RelationsTab() {
  const { project } = projectRelationsRoute.useParams();
  const filters = projectRelationsRoute.useSearch();
  const navigate = projectRelationsRoute.useNavigate();
  const landscape = useQuery(landscapeQuery(project));
  const models = useQuery(modelsQuery(project));
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

  const modelKeys = landscape.data.models.map((m) => m.key).sort();

  const relations = landscape.data.relations;
  const autoCount =
    autoRules !== undefined
      ? relations.filter((r) => matchesFilters(r, { auto: 'any' }, autoIndex)).length
      : null;
  return (
    <div className="flex flex-col gap-4">
      <RelationViews
        project={project}
        current={viewOf(filters)}
        reviewCount={reviewQueue(relations, models.data ?? []).length}
        autoCount={autoCount}
        model={filters.model}
      />
      <RelationsView
        relations={landscape.data.relations}
        resolve={resolve}
        modelKeys={modelKeys}
        filters={filters}
        onFiltersChange={(next) => void navigate({ search: next, replace: true })}
        autoIndex={autoIndex}
        autoRules={autoRules}
        renderActions={(relation) => (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/projects/$project/review/$relation"
                params={{ project, relation: relation.id }}
                aria-label={`Relation ${relation.id} prüfen`}
              >
                <SearchCheckIcon data-icon="inline-start" />
                Prüfen
              </Link>
            </Button>
            <Button variant="ghost" size="icon-sm" asChild>
              <Link
                to="/projects/$project/models/$"
                params={{ project, _splat: splitRef(relation.from).modelKey }}
                search={{ relation: relation.id }}
                aria-label={`Relation im Modell ${splitRef(relation.from).modelKey} zeigen`}
                title="Im Modell zeigen"
              >
                <LocateIcon />
              </Link>
            </Button>
          </div>
        )}
      />
    </div>
  );
}
