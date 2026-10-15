// eval:descriptive (M6 §3.11): the numbers of one landscape in one variant
// (the unchanged models or one of the cumulative transforms of
// lib/descriptive.mjs), and the holdout's redaction.
//
// Per variant: extractor warnings, engines, must_link coverage among the rule
// tier ∪ candidates (the eval:candidates metric), also within the rule tier ∪
// key/lexical candidates and within the rule tier alone, the rule tier's
// acceptances and their precision (and how many stay accepted under the
// trust policy of decision 24.2, which turns the calls of engine-less models
// into proposals), candidate volume, the estimated claim input size against
// the 100 KB budget (src/claim-estimate.ts), findings; per relation type and,
// for the dev landscape, per tag.
import { FACTS_VERSION, extractFacts } from '@analyzr/bpmn-facts';
import type { FindingKind, ProjectFacts } from '@analyzr/contracts';
import { LINK_TYPES, generateCandidates, indexLandscape, runRules } from '@analyzr/relations';

import type { Variant } from '../lib/descriptive.mjs';
import { CLAIM_BUDGET_BYTES, claimBytes, estimateClaimInput } from './claim-estimate.ts';
import type { Expected, LandscapeMeta } from './landscape.ts';
import { HOLDOUT_MIN_GROUP } from './placements-score.ts';
import { scoreLandscape } from './score.ts';

export type VariantName = 'baseline' | Variant;

export const SMALL = `< ${HOLDOUT_MIN_GROUP}` as const;
export const HIDDEN = 'hidden' as const;
/** A number derived from the ground truth; on the holdout possibly redacted. */
export type Cell = number | typeof SMALL | typeof HIDDEN;

export const FINDING_KINDS = [
  'unresolved-call',
  'dynamic-call',
  'duplicate-process-id',
  'dangling-throw',
  'unmatched-catch',
] as const satisfies readonly FindingKind[];

export interface Coverage {
  /** must_link pairs of the group. */
  total: number;
  /** Among the rule tier ∪ all candidates (what agents get to judge). */
  covered: Cell;
  /** Among the rule tier ∪ key and lexical candidates. */
  keyLexical: Cell;
  /** Among the rule tier (accepted or proposed). */
  rules: Cell;
}

export interface TypeRow {
  type: string;
  /** Endpoints of the type (`from` and `to` side). */
  endpoints: { from: number; to: number };
  /** Candidate pairs of the type (rule, key, lexical, compatible). */
  candidates: number;
  ruleAccepted: number;
  /** must_link coverage of the type; left out on the holdout. */
  coverage?: Coverage;
  /** Left out on the holdout. */
  ruleAcceptedCorrect?: number;
}

export interface FindingRow {
  kind: FindingKind;
  /** Computed by the rule tier on the variant. */
  computed: number;
  /** In expected.yaml (units as eval:candidates compares them). */
  expected: Cell;
  /** Expected ones still computed. */
  found: Cell;
}

export interface VariantResult {
  variant: VariantName;
  /** Extractor warnings over all models (the transforms must produce none). */
  warnings: number;
  engines: { c7: number; c8: number; none: number };
  processes: number;
  executableProcesses: number;
  facts: number;
  mustLink: Coverage;
  ruleTier: {
    accepted: number;
    correct: Cell;
    /** correct / accepted; `null` without acceptances. */
    precision: number | null | typeof SMALL | typeof HIDDEN;
    proposed: number;
    /** Acceptances whose caller has an engine: what decision 24.2 (S2c) keeps accepted. */
    acceptedUnderTrustPolicy: number;
  };
  candidates: { total: number; rule: number; key: number; lexical: number; compatible: number };
  claim: {
    meanBytes: number;
    maxBytes: number;
    /** The model with the largest input; `null` on the holdout. */
    maxModel: string | null;
    overBudget: number;
  };
  findings: FindingRow[];
  byType: TypeRow[];
}

export interface TagRow {
  tag: string;
  mustLink: number;
  /** must_link among the rule tier ∪ candidates, per variant in report order. */
  covered: number[];
}

export interface LandscapeDescriptive {
  name: string;
  split: 'dev' | 'holdout';
  models: number;
  /** Set on the holdout: what the section leaves out. */
  note?: string;
  variants: VariantResult[];
  /** Dev only. */
  byTag?: TagRow[];
}

export interface VariantModel {
  key: string;
  xml: string;
}

/** Facts of a variant's models; every extractor warning is counted. */
export async function variantFacts(
  models: readonly VariantModel[],
): Promise<{ projectFacts: ProjectFacts; engines: Map<string, 'c7' | 'c8' | null>; warnings: number }> {
  const extracted = await Promise.all(models.map((m) => extractFacts(m.xml, { modelKey: m.key })));
  return {
    projectFacts: {
      models: extracted.map((r) => ({
        modelKey: r.modelKey,
        factsVersion: FACTS_VERSION,
        processes: r.processes,
        facts: r.facts,
        messageFlows: r.messageFlows,
      })),
    },
    engines: new Map(extracted.map((r) => [r.modelKey, r.engine])),
    warnings: extracted.reduce((n, r) => n + r.warnings.length, 0),
  };
}

const modelOf = (ref: string): string => ref.slice(0, ref.indexOf('#'));

/** Scores one variant of a landscape (unredacted). */
export async function scoreVariant(
  variant: VariantName,
  meta: LandscapeMeta,
  expected: Expected,
  models: readonly VariantModel[],
): Promise<{ result: VariantResult; byTag: Map<string, { mustLink: number; covered: number }> }> {
  const { projectFacts, engines, warnings } = await variantFacts(models);
  const rules = runRules(projectFacts);
  const candidates = generateCandidates(projectFacts);
  const score = scoreLandscape({ meta, expected, facts: projectFacts, rules, candidates, baseline: [], extraEvents: [] });
  const index = indexLandscape(projectFacts);

  const accepted = rules.relations.filter((r) => r.status === 'accepted');
  const sizes = projectFacts.models.map((m) => ({
    key: m.modelKey,
    bytes: claimBytes(estimateClaimInput({ projectFacts, rules, modelKey: m.modelKey, engine: engines.get(m.modelKey) ?? null })),
  }));
  const largest = sizes.reduce<{ key: string; bytes: number } | null>(
    (best, s) => (best === null || s.bytes > best.bytes ? s : best),
    null,
  );

  const engineCounts = { c7: 0, c8: 0, none: 0 };
  for (const e of engines.values()) engineCounts[e ?? 'none']++;
  const processes = projectFacts.models.flatMap((m) => m.processes);

  const findings: FindingRow[] = FINDING_KINDS.map((kind) => {
    const check = score.findings.find((f) => f.kind === kind);
    const computed = rules.findings.filter((f) => f.kind === kind).length;
    const exp = check?.expected ?? [];
    const comp = new Set(check?.computed ?? []);
    return { kind, computed, expected: exp.length, found: exp.filter((u) => comp.has(u)).length };
  });

  const byType: TypeRow[] = LINK_TYPES.map((type) => {
    const g = score.byType[type];
    return {
      type,
      coverage: {
        total: g?.mustLink ?? 0,
        covered: g?.mustLinkCandidates ?? 0,
        keyLexical: g?.mustLinkKeyLexical ?? 0,
        rules: g?.mustLinkRules ?? 0,
      },
      endpoints: { from: index.endpoints[type].from.length, to: index.endpoints[type].to.length },
      candidates: candidates.filter((c) => c.type === type).length,
      ruleAccepted: accepted.filter((r) => r.type === type).length,
      ruleAcceptedCorrect: accepted.filter((r) => r.type === type).length - score.ruleTier.wrong.filter((w) => w.type === type).length,
    };
  });

  const ml = score.counts.expected.must_link;
  const result: VariantResult = {
    variant,
    warnings,
    engines: engineCounts,
    processes: processes.length,
    executableProcesses: processes.filter((p) => p.isExecutable).length,
    facts: score.counts.facts,
    mustLink: {
      total: ml,
      covered: score.systems.candidates.mustLink,
      keyLexical: score.systems.keyLexical.mustLink,
      rules: score.systems.rules.mustLink,
    },
    ruleTier: {
      accepted: score.ruleTier.accepted,
      correct: score.ruleTier.correct,
      precision: score.ruleTier.precision,
      proposed: score.counts.rules.proposed,
      acceptedUnderTrustPolicy: accepted.filter((r) => (engines.get(modelOf(r.from)) ?? null) !== null).length,
    },
    candidates: {
      total: score.counts.candidates.total,
      rule: score.counts.candidates.rule,
      key: score.counts.candidates.key,
      lexical: score.counts.candidates.lexical,
      compatible: score.counts.candidates.compatible,
    },
    claim: {
      meanBytes: sizes.length === 0 ? 0 : Math.round(sizes.reduce((n, s) => n + s.bytes, 0) / sizes.length),
      maxBytes: largest?.bytes ?? 0,
      maxModel: largest?.key ?? null,
      overBudget: sizes.filter((s) => s.bytes > CLAIM_BUDGET_BYTES).length,
    },
    findings,
    byType,
  };
  const byTag = new Map(
    Object.entries(score.byTag)
      .filter(([, g]) => g.mustLink > 0)
      .map(([tag, g]) => [tag, { mustLink: g.mustLink, covered: g.mustLinkCandidates }]),
  );
  return { result, byTag };
}

// ------------------------------------------------------------------ holdout

export const HOLDOUT_NOTE =
  'holdout: whole-landscape numbers only, no per-item lines (no model names) and no ground truth per relation ' +
  `type or tag; a ground-truth count of 1 to ${HOLDOUT_MIN_GROUP - 1} items, or over a group of fewer than ` +
  `${HOLDOUT_MIN_GROUP}, is „${SMALL}“, and one that differs by 1 to ${HOLDOUT_MIN_GROUP - 1} from a number it is ` +
  'nested with is „hidden“: the same metric in another variant; must_link total, coverage in rules ∪ candidates, ' +
  'in rules ∪ key/lexical and in the rule tier within one variant; the candidate, rule-tier relation and ' +
  'acceptance counts they lie in; expected and computed findings (eval/README.md, holdout hygiene)';

/** One ground-truth number of a holdout landscape, with what a reader can subtract it from. */
export interface GridCell {
  /** The variant's index in report order. */
  variant: number;
  /** Cells of one metric are nested across variants; see {@link nested}. */
  metric: string;
  value: Cell;
  /** Numbers the report shows anyway that the cell is nested with (group sizes, counts from the model files). */
  anchors: readonly number[];
}

/** Within one variant: must_link total ⊇ in rules ∪ candidates ⊇ in rules ∪ key/lexical ⊇ in the rule tier. */
const COVERAGE_CHAIN: ReadonlySet<string> = new Set(['covered', 'keyLexical', 'rules']);

/** Whether the difference of two ground-truth cells counts a group of items: same metric, or one variant's coverage chain. */
export function nested(a: Pick<GridCell, 'variant' | 'metric'>, b: Pick<GridCell, 'variant' | 'metric'>): boolean {
  if (a.metric === b.metric) return true;
  return a.variant === b.variant && COVERAGE_CHAIN.has(a.metric) && COVERAGE_CHAIN.has(b.metric);
}

/** A difference of 1 to HOLDOUT_MIN_GROUP − 1 items. */
export const revealing = (a: number, b: number): boolean => a !== b && Math.abs(a - b) < HOLDOUT_MIN_GROUP;

/**
 * Redacts the ground-truth numbers of one holdout landscape, visited in the
 * given order (report order, so the result is deterministic): a number is
 * shown only if it differs by 0 or at least {@link HOLDOUT_MIN_GROUP} from 0,
 * from each of its anchors and from every number shown before it that it is
 * {@link nested} with; a count of 1 to 4 becomes „< 5“, any other conflict
 * „hidden“. So any two shown numbers that are nested, and any shown number and
 * its anchors, differ by 0 or at least 5 items.
 */
export function redactGrid(cells: readonly GridCell[]): Cell[] {
  const shown: Array<{ variant: number; metric: string; value: number }> = [];
  return cells.map((c) => {
    const v = c.value;
    if (typeof v !== 'number') return v;
    if (revealing(v, 0)) return SMALL;
    if (c.anchors.some((a) => revealing(v, a))) return HIDDEN;
    if (shown.some((s) => nested(s, c) && revealing(v, s.value))) return HIDDEN;
    shown.push({ variant: c.variant, metric: c.metric, value: v });
    return v;
  });
}

const num = (c: Cell): number => (typeof c === 'number' ? c : Number.NaN);

/** The holdout's section: see {@link HOLDOUT_NOTE}. Dev landscapes pass unchanged. */
export function redactDescriptive(l: LandscapeDescriptive): LandscapeDescriptive {
  if (l.split !== 'holdout') return l;
  const vs = l.variants;
  const total = vs[0]?.mustLink.total ?? 0;
  const ofTotal = (c: Cell): Cell => (total < HOLDOUT_MIN_GROUP ? SMALL : c);
  // Report order: the variants, within each the coverage chain, the rule tier, the findings.
  const cells: GridCell[] = [];
  const index = new Map<string, number>();
  const add = (variant: number, metric: string, value: Cell, anchors: readonly number[]): void => {
    index.set(`${variant}|${metric}`, cells.length);
    cells.push({ variant, metric, value, anchors });
  };
  vs.forEach((v, i) => {
    const c = v.candidates;
    add(i, 'covered', ofTotal(v.mustLink.covered), [total, c.total]);
    add(i, 'keyLexical', ofTotal(v.mustLink.keyLexical), [total, c.rule + c.key + c.lexical]);
    add(i, 'rules', ofTotal(v.mustLink.rules), [total, v.ruleTier.accepted + v.ruleTier.proposed]);
    // Correct acceptances: over the variant's own acceptances (at least 5 needed).
    add(i, 'correct', v.ruleTier.accepted < HOLDOUT_MIN_GROUP ? SMALL : v.ruleTier.correct, [v.ruleTier.accepted]);
    for (const f of v.findings) {
      const expected = num(f.expected);
      add(i, `found:${f.kind}`, expected < HOLDOUT_MIN_GROUP ? SMALL : f.found, [expected, f.computed]);
    }
  });
  const redacted = redactGrid(cells);
  const get = (variant: number, metric: string): Cell => redacted[index.get(`${variant}|${metric}`) ?? -1] ?? SMALL;
  return {
    name: l.name,
    split: l.split,
    models: l.models,
    note: HOLDOUT_NOTE,
    variants: vs.map((v, i) => {
      const c = get(i, 'correct');
      return {
        ...v,
        mustLink: { total, covered: get(i, 'covered'), keyLexical: get(i, 'keyLexical'), rules: get(i, 'rules') },
        ruleTier: {
          ...v.ruleTier,
          correct: v.ruleTier.accepted === 0 ? 0 : c,
          precision: v.ruleTier.accepted === 0 ? null : typeof c === 'number' ? c / v.ruleTier.accepted : c,
        },
        claim: { ...v.claim, maxModel: null },
        findings: v.findings.map((f) => {
          const expected = num(f.expected);
          return {
            ...f,
            expected: expected < HOLDOUT_MIN_GROUP ? SMALL : expected,
            found: get(i, `found:${f.kind}`),
          };
        }),
        // Per type only what the model files give: one type's ground truth is the total minus the others'.
        byType: v.byType.map((r) => ({
          type: r.type,
          endpoints: r.endpoints,
          candidates: r.candidates,
          ruleAccepted: r.ruleAccepted,
        })),
      };
    }),
  };
}
