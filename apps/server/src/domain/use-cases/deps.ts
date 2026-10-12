import type { DeclaredProcedure } from '@analyzr/contracts';

import type { AnalysisPort, Clock, Notifier, Store } from '../ports.ts';

/** What every use case gets injected. */
export interface UseCaseDeps {
  store: Store;
  analysis: AnalysisPort;
  clock: Clock;
  /** Wake-ups for the pending long-poll (LISTEN/NOTIFY). */
  notifier: Notifier;
  /** The procedure a relations claim names (`analyzr-relations` and its current version). */
  expectedProcedure: () => DeclaredProcedure;
  /** The procedure a placement claim names (`analyzr-placements` and its current version, M4 §3.2). */
  expectedPlacementProcedure: () => DeclaredProcedure;
}

/** Upper bound for "all rows" reads (landscape, process lookups). */
export const ALL = 100_000;
