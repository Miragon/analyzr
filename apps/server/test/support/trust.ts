/**
 * The trust rule's inputs for pure tests (M6 S2c): a {@link ModelTrust} per
 * model, modelled unless a test says otherwise.
 */
import type { ProjectFacts, RevisionTrust } from '@analyzr/contracts';

import type { ModelTrust } from '../../src/domain/trust.ts';

export const MODELLED: RevisionTrust = { class: 'modelled', reasons: [] };
export const NO_ENGINE: RevisionTrust = { class: 'derived', reasons: ['no-engine'] };

/** One model's trust: modelled, a human upload of a Camunda 7 file, unless overridden. */
export function modelTrustOf(overrides: Partial<ModelTrust> = {}): ModelTrust {
  return {
    trust: MODELLED,
    modelledCalls: new Set(),
    conflictedCalls: new Set(),
    derivedKind: null,
    converter: null,
    engine: 'c7',
    uploader: 'human',
    ...overrides,
  };
}

/** Every model of `projectFacts` modelled, except those `overrides` names. */
export function trustOfModels(
  projectFacts: ProjectFacts,
  overrides: Readonly<Record<string, Partial<ModelTrust>>> = {},
): Map<string, ModelTrust> {
  return new Map(
    projectFacts.models.map((m) => [m.modelKey, modelTrustOf(overrides[m.modelKey] ?? {})]),
  );
}
