/**
 * The would-be effect and the cost of amendments (M6 §4.8 c "What an
 * amended revision sets off"), pure: the rule tier over the head facts with
 * the model's facts replaced by the derived head's, compared with the rule
 * tier over the head facts as they are, both under the trust rule (M6 S2c:
 * a call target set in analyzr counts as modelled, decision 25.2); the
 * accepted relations whose endpoint fingerprint changes; the manual links
 * the amendments retire; and the current judgements a new `facts_hash`
 * makes non-current.
 */
import type {
  AmendmentEffect,
  AmendmentEffectRelation,
  DerivedRelation,
  Finding,
  ProjectFacts,
  Ref,
  RelationType,
} from '@analyzr/contracts';

import { headFingerprints } from '../fingerprints.ts';
import type { AnalysisPort, Extracted, RelationRecord } from '../ports.ts';
import { applyTrust, type ModelTrust } from '../trust.ts';

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const naturalKey = (type: string, from: string, to: string): string =>
  `${type}\u0000${from}\u0000${to}`;

/** A candidate amendment as the effect reads it. */
export interface EffectCandidate {
  op: string;
  /** The element whose field is written. */
  key: string;
  /** The endpoints whose name it sets (`message-name`): the one the form was opened from, else the readers. */
  endpoints: readonly string[];
  /** The call (`call-target`). */
  call: string | null;
  partner: Ref | null;
}

/** The head facts with one model's facts replaced. */
export function replaceModel(
  projectFacts: ProjectFacts,
  modelKey: string,
  extracted: Extracted,
): ProjectFacts {
  return {
    models: projectFacts.models.map((m) =>
      m.modelKey === modelKey
        ? {
            modelKey,
            factsVersion: extracted.factsVersion,
            processes: extracted.processes,
            facts: extracted.facts,
            messageFlows: extracted.messageFlows,
          }
        : m,
    ),
  };
}

const findingKey = (f: Finding): string => `${f.kind}\u0000${f.refs.join(',')}`;

function sortRelations(list: AmendmentEffectRelation[]): AmendmentEffectRelation[] {
  return list.sort(
    (a, b) => byCodePoint(a.type, b.type) || byCodePoint(a.from, b.from) || byCodePoint(a.to, b.to),
  );
}

/** The effect, and per candidate the key-tier proposals its `partner` accepts. */
export interface EffectResult {
  effect: AmendmentEffect;
  /** By candidate index: the derived relations between its endpoints and its partner. */
  partnerPairs: Map<number, AmendmentEffectRelation[]>;
}

/**
 * The effect of replacing a model's facts with the derived head's (the
 * rule tier before and after, each under its models' trust), at the model
 * and wherever the rules reach.
 */
export function amendmentEffect(input: {
  modelKey: string;
  projectFacts: ProjectFacts;
  amended: Extracted;
  relations: readonly RelationRecord[];
  runRules: AnalysisPort['runRules'];
  /** The models' trust now, and with the derived head's call targets (M6 S2c). */
  trust: { before: ReadonlyMap<string, ModelTrust>; after: ReadonlyMap<string, ModelTrust> };
  candidates: readonly EffectCandidate[];
}): EffectResult {
  const { modelKey, projectFacts, relations } = input;
  const afterFacts = replaceModel(projectFacts, modelKey, input.amended);
  const before = applyTrust(input.runRules(projectFacts), input.trust.before);
  const after = applyTrust(input.runRules(afterFacts), input.trust.after);
  const stored = new Map(relations.map((r) => [naturalKey(r.type, r.fromRef, r.toRef), r]));
  const view = (r: { type: RelationType; from: string; to: string }): AmendmentEffectRelation => ({
    relation: stored.get(naturalKey(r.type, r.from, r.to))?.id ?? null,
    type: r.type,
    from: r.from as Ref,
    to: r.to as Ref,
  });
  const keyOf = (d: DerivedRelation) => naturalKey(d.type, d.from, d.to);
  const beforeDerived = new Map(before.relations.map((d) => [keyOf(d), d]));
  const afterDerived = new Map(after.relations.map((d) => [keyOf(d), d]));

  const beforeFindings = new Set(before.findings.map(findingKey));
  const afterFindings = new Set(after.findings.map(findingKey));

  const accepted: AmendmentEffectRelation[] = [];
  const proposed: AmendmentEffectRelation[] = [];
  for (const [key, d] of afterDerived) {
    const was = beforeDerived.get(key);
    if (d.status === 'accepted' && was?.status !== 'accepted') accepted.push(view(d));
    else if (d.status !== 'accepted' && was === undefined) proposed.push(view(d));
  }
  const withdrawn = [...beforeDerived]
    .filter(([key]) => !afterDerived.has(key))
    .map(([, d]) => view(d));

  // Partners: the derived relations between a candidate's endpoints and its partner.
  const partnerPairs = new Map<number, AmendmentEffectRelation[]>();
  for (const [i, c] of input.candidates.entries()) {
    if (c.partner === null) continue;
    const ends = new Set(c.endpoints.map((id) => `${modelKey}#${id}`));
    const pairs = after.relations
      .filter(
        (d) =>
          (d.type === 'message' || d.type === 'signal') &&
          ((ends.has(d.from) && d.to === c.partner) || (ends.has(d.to) && d.from === c.partner)),
      )
      .map(view);
    partnerPairs.set(i, sortRelations(pairs));
  }

  // Manual links retired: from a call to the target it now calls (the rule tier accepts the
  // call), and between an endpoint and the partner whose proposal the amendment accepts.
  const retired: AmendmentEffectRelation[] = [];
  const retiredIds = new Set<string>();
  const retire = (r: RelationRecord) => {
    if (retiredIds.has(r.id)) return;
    retiredIds.add(r.id);
    retired.push(view({ type: r.type, from: r.fromRef, to: r.toRef }));
  };
  for (const [i, c] of input.candidates.entries()) {
    if (c.call !== null) {
      const callRef = `${modelKey}#${c.call}`;
      for (const d of after.relations) {
        if (d.type !== 'call' || d.from !== callRef || d.status !== 'accepted') continue;
        const manual = stored.get(naturalKey('manual', callRef, d.to));
        if (manual?.status === 'accepted') retire(manual);
      }
    }
    for (const pair of partnerPairs.get(i) ?? []) {
      for (const [from, to] of [
        [pair.from, pair.to],
        [pair.to, pair.from],
      ] as const) {
        const manual = stored.get(naturalKey('manual', from, to));
        if (manual?.status === 'accepted') retire(manual);
      }
    }
  }

  // Accepted relations whose endpoint fingerprint changes (they wait for re-confirming),
  // unless the rules re-derive them or the amendment retires them.
  const fpsAfter = headFingerprints(afterFacts);
  const changed: AmendmentEffectRelation[] = [];
  for (const r of relations) {
    if (r.status !== 'accepted' || retiredIds.has(r.id)) continue;
    if (afterDerived.has(naturalKey(r.type, r.fromRef, r.toRef))) continue;
    const touches = r.fromRef.startsWith(`${modelKey}#`) || r.toRef.startsWith(`${modelKey}#`);
    if (!touches) continue;
    const from = fpsAfter.get(r.type, 'from', r.fromRef);
    const to = fpsAfter.get(r.type, 'to', r.toRef);
    if (from === undefined || to === undefined) continue;
    if (from !== r.fromFp || to !== r.toFp)
      changed.push(view({ type: r.type, from: r.fromRef, to: r.toRef }));
  }

  return {
    effect: {
      findingsResolved: before.findings.filter((f) => !afterFindings.has(findingKey(f))),
      findingsAdded: after.findings.filter((f) => !beforeFindings.has(findingKey(f))),
      accepted: sortRelations(accepted),
      proposed: sortRelations(proposed),
      withdrawn: sortRelations(withdrawn),
      partnerAccepted: sortRelations([...partnerPairs.values()].flat()),
      changed: sortRelations(changed),
      retired: sortRelations(retired),
    },
    partnerPairs,
  };
}

/** No effect: nothing is written. */
export function noEffect(): AmendmentEffect {
  return {
    findingsResolved: [],
    findingsAdded: [],
    accepted: [],
    proposed: [],
    withdrawn: [],
    partnerAccepted: [],
    changed: [],
    retired: [],
  };
}
