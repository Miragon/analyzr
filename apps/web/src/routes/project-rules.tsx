import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { projectRoute } from './project';

/** The sources a rule for derived calls names (M6 S2c-3; `AutoAcceptDerivedKind`). */
const DERIVED_KINDS = ['export', 'converted', 'none'] as const;
type DerivedKind = (typeof DERIVED_KINDS)[number];

export interface RulesSearch {
  /**
   * Open „Neue Regel“ prefilled: `key` is „Gleicher Name ab 100 %“ (after a
   * bulk accept, UX5); `calls` a rule for derived calls of `derivedKind`
   * (and `converter`), after a bulk accept of such calls (M6 S2c-3).
   */
  new?: 'key' | 'calls';
  derivedKind?: DerivedKind;
  converter?: string;
}

/** `?new=…` as the page reads it: anything unknown is dropped. */
export function parseRulesSearch(search: Record<string, unknown>): RulesSearch {
  if (search['new'] === 'key') return { new: 'key' };
  if (search['new'] !== 'calls') return {};
  const kind = search['derivedKind'];
  const derivedKind = DERIVED_KINDS.find((k) => k === kind);
  const converter = search['converter'];
  return {
    new: 'calls',
    ...(derivedKind ? { derivedKind } : {}),
    ...(derivedKind === 'converted' && typeof converter === 'string' && converter.trim() !== ''
      ? { converter: converter.trim().slice(0, 120) }
      : {}),
  };
}

/**
 * The tab „Regeln“ (owner decision 19): the project's auto-accept rules,
 * owners only; `?new=key` or `?new=calls` opens a new rule prefilled. The
 * page (`project-rules-page.tsx`) loads with the route, so no other page
 * carries its dialogs.
 */
export const projectRulesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'rules',
  validateSearch: parseRulesSearch,
  component: lazyRouteComponent(() => import('./project-rules-page'), 'RulesPage'),
});
