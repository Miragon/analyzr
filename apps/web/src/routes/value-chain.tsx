import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export interface ValueChainSearch {
  /** Selected step or org unit (element id). */
  step?: string;
  /** Active placement (`plc_…`), the `reviewUrl` of placement writes. */
  placement?: string;
  /** `svg`: download the drawing once it is shown (the export hub on „Übersicht“, UX1). */
  export?: 'svg';
}

/**
 * The value chain page (M4 §4): the chain on a full-viewport canvas (viewer,
 * or the modeler in edit mode), badges and finding labels on the steps, and
 * the side panel where placements are reviewed, steps edited and the chain
 * saved. `?placement=plc_…` (the `reviewUrl` of refused agent writes) selects
 * a placement and its step, `?step=` a step. The page
 * (`value-chain-page.tsx`) is loaded with the route, and the canvas with the
 * page, so no other page carries their code.
 */
export const valueChainRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$project/value-chain',
  validateSearch: (search: Record<string, unknown>): ValueChainSearch => ({
    ...(typeof search['step'] === 'string' && search['step'] !== ''
      ? { step: search['step'] }
      : {}),
    ...(typeof search['placement'] === 'string' && search['placement'] !== ''
      ? { placement: search['placement'] }
      : {}),
    ...(search['export'] === 'svg' ? { export: 'svg' as const } : {}),
  }),
  component: lazyRouteComponent(() => import('./value-chain-page'), 'ValueChainPage'),
});
