import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { projectRoute } from './project';

/** The tab's filters in the URL; the page keeps only valid kinds, sources and states. */
export interface OpenQuestionsSearch {
  kind?: string;
  source?: string;
  /** A model key or a folder (the API's `modelKey`). */
  model?: string;
  askWho?: string;
  state?: string;
}

const KEYS = ['kind', 'source', 'model', 'askWho', 'state'] as const;

/**
 * The tab „Offene Fragen“ (M6 §4.4): every gap of the landscape as a
 * question, with filters and the export. Read permission, so every role and
 * the read-only demo see it. The page (`project-open-questions-page.tsx`)
 * loads with the route, so the entry chunk carries none of it.
 */
export const projectOpenQuestionsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'open-questions',
  validateSearch: (search: Record<string, unknown>): OpenQuestionsSearch => {
    const out: OpenQuestionsSearch = {};
    for (const key of KEYS) {
      const value = search[key];
      if (typeof value === 'string' && value !== '') out[key] = value;
    }
    return out;
  },
  component: lazyRouteComponent(() => import('./project-open-questions-page'), 'OpenQuestionsPage'),
});
