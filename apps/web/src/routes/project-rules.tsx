import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { projectRoute } from './project';

export interface RulesSearch {
  /** Open „Neue Regel“ prefilled: `key` is „Gleicher Name ab 100 %“ (after a bulk accept, UX5). */
  new?: 'key';
}

/**
 * The tab „Regeln“ (owner decision 19): the project's auto-accept rules,
 * owners only; `?new=key` opens a new rule prefilled. The page
 * (`project-rules-page.tsx`) loads with the route, so no other page carries
 * its dialogs.
 */
export const projectRulesRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'rules',
  validateSearch: (search: Record<string, unknown>): RulesSearch =>
    search['new'] === 'key' ? { new: 'key' } : {},
  component: lazyRouteComponent(() => import('./project-rules-page'), 'RulesPage'),
});
