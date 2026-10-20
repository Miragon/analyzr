/**
 * Auto-accept rules (owner decision 19), pure part: the checks of a rule as
 * the owner writes it, whether an edit changes anything, and decision 9 as
 * the read-only system rule. The few defaults the owner may want to change
 * later (the 0.5 floor, unique names, ad hoc off) live here and in the
 * contracts as single constants.
 */
import {
  AUTO_ACCEPT_TIERS,
  DERIVED_CALL_CONFIDENCE,
  MAX_AUTO_ACCEPT_CONVERTER_CHARS,
  MIN_AUTO_ACCEPT_CONFIDENCE,
  RULES_PROCEDURE,
  hasControlCharacters,
  type AutoAcceptRuleDraft,
  type AutoAcceptSystemRule,
  type PrincipalId,
} from '@analyzr/contracts';

import type { AutoAcceptRuleRevisionRecord } from '../ports.ts';

/**
 * Why a draft is refused (`validation-failed` with this `reason`). Over REST
 * only `unknown-agent` and `name-taken` reach a client: the contract's schema
 * refuses the others first (422 with `errors`); the domain checks them again
 * for every other caller.
 */
export type RuleDraftProblem =
  | 'kind-tier-mismatch'
  | 'type-not-for-placements'
  | 'derived-criteria'
  | 'unknown-agent'
  | 'name-taken'
  | 'confidence-out-of-range'
  | 'control-characters';

/** A rule name as compared for uniqueness: trimmed, lower case. */
export const nameKey = (name: string): string => name.trim().toLocaleLowerCase('de');

/**
 * Whether a draft's criteria fit whose proposals it accepts (M6 S2c-3, owner
 * decision 28 (1)): an agent rule names no derivation; a rule for derived
 * calls is a relation rule of tier `key`, type `call` at
 * {@link DERIVED_CALL_CONFIDENCE} without agent, model or ad hoc, naming
 * `export`, `converted` or `none`, and a converter (1 to 120 characters)
 * exactly for `converted`. The contract refuses the same first; the
 * database checks it once more.
 */
export function proposerFits(
  draft: Pick<
    AutoAcceptRuleDraft,
    | 'kind'
    | 'tier'
    | 'minConfidence'
    | 'relationType'
    | 'agentPrincipalId'
    | 'llmModel'
    | 'includeAdHoc'
    | 'proposedBy'
    | 'derivedKind'
    | 'converter'
  >,
): boolean {
  if (draft.proposedBy === 'agent') return draft.derivedKind === null && draft.converter === null;
  const converter = draft.converter?.trim() ?? null;
  return (
    draft.kind === 'relation' &&
    draft.tier === 'key' &&
    draft.relationType === 'call' &&
    draft.minConfidence === DERIVED_CALL_CONFIDENCE &&
    draft.agentPrincipalId === null &&
    draft.llmModel === null &&
    !draft.includeAdHoc &&
    (draft.derivedKind === 'export' ||
      draft.derivedKind === 'converted' ||
      draft.derivedKind === 'none') &&
    (draft.derivedKind === 'converted') === (converter !== null) &&
    (converter === null ||
      (converter.length >= 1 && converter.length <= MAX_AUTO_ACCEPT_CONVERTER_CHARS))
  );
}

/**
 * The checks of a draft beyond its schema, in this order: tier of the kind,
 * no type on a placement rule, the criteria of whose proposals it accepts
 * ({@link proposerFits}), the confidence floor, control characters in name,
 * note, model and converter, an unknown agent, a name another rule of the
 * project already has (ignoring case).
 *
 * @param names the head names of the project's other rules
 * @param agents the principals a rule may be narrowed to (the project's
 *   agent-token principals and service members)
 */
export function ruleDraftProblem(
  draft: AutoAcceptRuleDraft,
  names: readonly string[],
  agents: ReadonlySet<PrincipalId>,
): RuleDraftProblem | null {
  if (!(AUTO_ACCEPT_TIERS[draft.kind] as readonly string[]).includes(draft.tier)) {
    return 'kind-tier-mismatch';
  }
  if (draft.kind === 'placement' && draft.relationType !== null) return 'type-not-for-placements';
  if (!proposerFits(draft)) return 'derived-criteria';
  if (
    !Number.isFinite(draft.minConfidence) ||
    draft.minConfidence < MIN_AUTO_ACCEPT_CONFIDENCE ||
    draft.minConfidence > 1
  ) {
    return 'confidence-out-of-range';
  }
  if (
    /\p{Cc}/u.test(draft.name) ||
    (draft.note !== null && hasControlCharacters(draft.note)) ||
    (draft.llmModel !== null && /\p{Cc}/u.test(draft.llmModel)) ||
    (draft.converter !== null && /\p{Cc}/u.test(draft.converter))
  ) {
    return 'control-characters';
  }
  if (draft.agentPrincipalId !== null && !agents.has(draft.agentPrincipalId)) {
    return 'unknown-agent';
  }
  const key = nameKey(draft.name);
  if (names.some((n) => nameKey(n) === key)) return 'name-taken';
  return null;
}

/** The fields of a revision a draft sets. */
export type DraftFields = Pick<
  AutoAcceptRuleRevisionRecord,
  | 'name'
  | 'enabled'
  | 'note'
  | 'tier'
  | 'minConfidence'
  | 'relationType'
  | 'agentPrincipalId'
  | 'llmModel'
  | 'includeAdHoc'
  | 'proposedBy'
  | 'derivedKind'
  | 'converter'
>;

/**
 * The revision fields of a draft (name, note and converter trimmed, an empty
 * note as `null`). A draft without the M6 S2c-3 fields (an older client) is
 * an agent rule, so saving an older rule unchanged writes nothing.
 */
export function draftFields(draft: AutoAcceptRuleDraft): DraftFields {
  const note = draft.note?.trim() ?? null;
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    note: note === '' ? null : note,
    tier: draft.tier,
    minConfidence: draft.minConfidence,
    relationType: draft.kind === 'relation' ? draft.relationType : null,
    agentPrincipalId: draft.agentPrincipalId,
    llmModel: draft.llmModel,
    includeAdHoc: draft.includeAdHoc,
    proposedBy: draft.proposedBy,
    derivedKind: draft.derivedKind,
    converter: draft.converter?.trim() ?? null,
  };
}

/** Whether a draft's fields equal a revision's (an edit that changes nothing writes nothing). */
export function sameFields(head: DraftFields, next: DraftFields): boolean {
  return (
    head.name === next.name &&
    head.enabled === next.enabled &&
    head.note === next.note &&
    head.tier === next.tier &&
    head.minConfidence === next.minConfidence &&
    head.relationType === next.relationType &&
    head.agentPrincipalId === next.agentPrincipalId &&
    head.llmModel === next.llmModel &&
    head.includeAdHoc === next.includeAdHoc &&
    head.proposedBy === next.proposedBy &&
    head.derivedKind === next.derivedKind &&
    head.converter === next.converter
  );
}

/**
 * Decision 9 as a system rule (German, as the review UI shows it): the rule
 * tier accepts an unambiguous call at ingest when the calling model is
 * modelled, and proposes it from a derived one (decision 24.2; a call target
 * set in analyzr counts as modelled, 25.2). Recorded under `analyzr-rules`
 * (`source_kind = 'rule'`), never stored as an auto-accept rule, never
 * editable. `proposed`: the open proposals of such calls; `preTrust`: the
 * acceptances from before the trust rule the owner has not reviewed yet (M6
 * S2c-4, „Vor der Vertrauensregel angenommen“).
 */
export function systemRule(
  accepted: number,
  proposed: number,
  preTrust: number,
): AutoAcceptSystemRule {
  return {
    id: RULES_PROCEDURE,
    name: 'Eindeutige Aufrufe',
    description:
      'Ein statischer Aufruf (calledElement), der genau einen anderen Prozess nennt, wird beim Import ' +
      'angenommen, wenn das aufrufende Modell aus Camunda 7 oder 8 stammt, über den Owner-Zugang oder ' +
      'das Web hochgeladen wurde und nicht als konvertiert, KI-rekonstruiert oder aus einem Interview ' +
      'angegeben ist. Sonst wird er mit 90 % vorgeschlagen. Ein Aufrufziel, das du in analyzr ergänzt ' +
      'hast, gilt immer als modelliert.',
    kind: 'relation',
    relationType: 'call',
    readOnly: true,
    accepted,
    proposed,
    preTrust,
  };
}
