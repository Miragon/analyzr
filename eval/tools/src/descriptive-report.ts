// Renders eval:descriptive as Markdown (eval/reports/descriptive.md).
// Deterministic: no timestamps, stable order.
import { CLAIM_BUDGET_BYTES } from './claim-estimate.ts';
import { UNKNOWN_PARTNER } from './descriptive-context.ts';
import type { Cell, LandscapeDescriptive, VariantName, VariantResult } from './descriptive-score.ts';
import { HOLDOUT_MIN_GROUP } from './placements-score.ts';
import { formatRatio } from './score.ts';

export interface DescriptiveReport {
  /** Report order: the unchanged models, then the cumulative variants. */
  variants: VariantName[];
  budgetBytes: number;
  /** Tool behaviour the variants model, still to verify against real exports (M6 §3.8). */
  assumptions: string[];
  /** What facts v1 makes of the variants, apart from tool behaviour. */
  factsEffects: string[];
  landscapes: LandscapeDescriptive[];
}

/** What each variant changes (on top of the previous one). */
export const VARIANT_DESCRIPTIONS: Readonly<Record<VariantName, string>> = {
  baseline: 'the corpus models unchanged (executable Camunda 7 and 8)',
  'engine-stripped':
    'Camunda namespaces (camunda, zeebe, modeler) and everything in them removed, so no engine is detected; a C8 call target ' +
    '(zeebe:calledElement) moves verbatim to the standard BPMN attribute calledElement (the optimistic case: the tool keeps it)',
  descriptive:
    'plus isExecutable="false"; call activities as collapsed subprocesses named exactly like the callee process (no call ' +
    'target; the exact name is the optimistic case); messages and signals without messageRef and signalRef (names only on ' +
    'labels), no bpmn:message and bpmn:signal definitions',
  pools:
    'plus every message endpoint without a message flow in its file gets a message flow to or from a black-box pool per ' +
    'partner; every event, send and receive task stays what it is. Partners are the processes the rule tier pairs the ' +
    'endpoint with by message name in the unchanged models, each pool named exactly like the partner\'s pool or process (the ' +
    `optimistic case); without such a pair, one pool „${UNKNOWN_PARTNER}“`,
  tasks:
    'plus those endpoints\' intermediate message throws and catches and send and receive tasks become plain tasks with the ' +
    'same message flows (a catch or receive task after an event-based gateway, and start, end and boundary events, stay events)',
  'no-docs': 'plus every bpmn:documentation removed',
};

/** The tool behaviour the variants assume; every item is to verify against real exports. */
export const ASSUMPTIONS: readonly string[] = [
  'Descriptive tools (Signavio, ARIS, ADONIS, Bizagi, Visio exports) write no Camunda namespaces and no `modeler:executionPlatform`, so `engine` is null.',
  'A tool that keeps a call target writes the standard `calledElement` (engine-stripped); one that links a subprocess to another diagram exports a collapsed `bpmn:subProcess` named exactly like the linked process, without a call target (descriptive; the exact name is the optimistic case).',
  'Descriptive message and signal events carry no `messageRef` or `signalRef` and the tool writes no `bpmn:message` or `bpmn:signal`; the names exist only as labels.',
  `Modellers connect an exchange with another process by a message flow to a black-box pool named exactly like the partner (pools; the exact name is the optimistic case, and a partner the unchanged models do not reveal becomes one pool „${UNKNOWN_PARTNER}“).`,
  'Modellers draw such an exchange as a task (tasks); they keep message start, end and boundary events, and catches after an event-based gateway, as events.',
  'Message flows to black-box pools carry no name; the layout of added pools and flows is generated (pools below the diagram).',
  'Element ids survive the export unchanged (as the integrate skill requires, M6 §3.4); labels and documentation are the corpus texts.',
];

/** What facts v1 makes of the variants, apart from tool behaviour (gaps for a later facts version). */
export const FACTS_EFFECTS: readonly string[] = [
  'engine-stripped copies a C8 FEEL call target (`=expr`) verbatim into `calledElement`. Without an engine, facts v1 treats only a JUEL expression there as dynamic, so such a call counts as a static target: an unresolved call instead of a dynamic one. The shift of unresolved-call and dynamic-call in engine-stripped is this facts gap, not tool behaviour; `descriptive.test.ts` pins it until a facts version fixes it.',
  'Facts v1 makes no relation endpoint of a collapsed subprocess (descriptive: no call relations left), of a task with a message flow (tasks: the message endpoints it converts are gone) or of a black-box pool.',
  'A message flow to a black-box pool answers its throw or catch: from pools on, no dangling-throw or unmatched-catch is computed for it, while candidates still pair it (only the exact pair a flow connects in one file is excluded).',
];

const cell = (s: string | number): string => String(s).replaceAll('|', '\\|');

function table(header: string[], rows: Array<Array<string | number>>): string {
  return [
    `| ${header.map(cell).join(' | ')} |`,
    `|${header.map((_, i) => (i === 0 ? '---' : '--:')).join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

function of(n: Cell, d: number): string {
  if (typeof n !== 'number') return n;
  return d === 0 ? '–' : `${n}/${d} (${((n / d) * 100).toFixed(0)} %)`;
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

function precision(v: VariantResult): string {
  const p = v.ruleTier.precision;
  if (p === null) return '–';
  if (typeof p === 'string') return p;
  return `${formatRatio(p)} (${v.ruleTier.correct}/${v.ruleTier.accepted})`;
}

function overview(l: LandscapeDescriptive): string {
  return table(
    [
      'Variant',
      'engines c7/c8/none',
      'executable processes',
      'facts',
      'must_link in rules ∪ candidates',
      'in rules ∪ key/lexical',
      'in rule tier',
      'rule-tier accepted: precision',
      'accepted under decision 24.2',
      'rule proposals',
      'candidates',
      'warnings',
    ],
    l.variants.map((v) => [
      v.variant,
      `${v.engines.c7}/${v.engines.c8}/${v.engines.none}`,
      `${v.executableProcesses}/${v.processes}`,
      v.facts,
      of(v.mustLink.covered, v.mustLink.total),
      of(v.mustLink.keyLexical, v.mustLink.total),
      of(v.mustLink.rules, v.mustLink.total),
      precision(v),
      v.ruleTier.acceptedUnderTrustPolicy,
      v.ruleTier.proposed,
      v.candidates.total,
      v.warnings,
    ]),
  );
}

function candidatesTable(l: LandscapeDescriptive): string {
  return table(
    ['Variant', 'total', 'rule', 'key', 'lexical', 'compatible', ...l.variants[0]!.byType.map((t) => `${t.type} pairs`)],
    l.variants.map((v) => [
      v.variant,
      v.candidates.total,
      v.candidates.rule,
      v.candidates.key,
      v.candidates.lexical,
      v.candidates.compatible,
      ...v.byType.map((t) => t.candidates),
    ]),
  );
}

function claimTable(l: LandscapeDescriptive): string {
  const largest = l.variants.some((v) => v.claim.maxModel !== null);
  return table(
    ['Variant', 'mean', 'max', ...(largest ? ['largest'] : []), `over ${kb(CLAIM_BUDGET_BYTES)}`],
    l.variants.map((v) => [
      v.variant,
      kb(v.claim.meanBytes),
      kb(v.claim.maxBytes),
      ...(largest ? [v.claim.maxModel ?? '–'] : []),
      `${v.claim.overBudget} of ${l.models}`,
    ]),
  );
}

function typeTables(l: LandscapeDescriptive): string {
  const types = (l.variants[0]?.byType ?? []).filter((t) => t.coverage !== undefined).map((t) => t.type);
  if (types.length === 0) {
    return table(
      ['Variant', ...(l.variants[0]?.byType ?? []).map((t) => `${t.type} endpoints from/to`)],
      l.variants.map((v) => [v.variant, ...v.byType.map((t) => `${t.endpoints.from}/${t.endpoints.to}`)]),
    );
  }
  const parts: string[] = [];
  for (const type of types) {
    const rows = l.variants.map((v) => ({ v, t: v.byType.find((r) => r.type === type) }));
    const total = rows[0]?.t?.coverage?.total ?? 0;
    parts.push(`**${type}** (${total} must_link)`);
    parts.push(
      table(
        [
          'Variant',
          'endpoints from/to',
          'must_link in rules ∪ candidates',
          'in rules ∪ key/lexical',
          'in rule tier',
          'rule-accepted correct',
          'candidate pairs',
        ],
        rows.map(({ v, t }) => [
          v.variant,
          t ? `${t.endpoints.from}/${t.endpoints.to}` : '–',
          t?.coverage ? of(t.coverage.covered, total) : '–',
          t?.coverage ? of(t.coverage.keyLexical, total) : '–',
          t?.coverage ? of(t.coverage.rules, total) : '–',
          t && t.ruleAccepted > 0 ? `${t.ruleAcceptedCorrect ?? '–'}/${t.ruleAccepted}` : '–',
          t ? t.candidates : '–',
        ]),
      ),
    );
  }
  return parts.join('\n\n');
}

function findingsTable(l: LandscapeDescriptive): string {
  const kinds = l.variants[0]?.findings.map((f) => f.kind) ?? [];
  return table(
    ['Kind', 'expected', ...l.variants.map((v) => v.variant)],
    kinds.map((kind) => {
      const first = l.variants[0]?.findings.find((f) => f.kind === kind);
      return [
        kind,
        first?.expected ?? '–',
        ...l.variants.map((v) => {
          const f = v.findings.find((x) => x.kind === kind);
          if (!f) return '–';
          const expected = typeof f.expected === 'number' ? f.expected : 0;
          return expected === 0 && typeof f.expected === 'number' ? String(f.computed) : `${f.computed} (expected found: ${typeof f.found === 'number' ? `${f.found}/${expected}` : f.found})`;
        }),
      ];
    }),
  );
}

function tagTable(l: LandscapeDescriptive): string {
  return table(
    ['Tag', 'must_link', ...l.variants.map((v) => v.variant)],
    (l.byTag ?? []).map((t) => [t.tag, t.mustLink, ...t.covered.map((c) => `${c}/${t.mustLink}`)]),
  );
}

function landscapeSection(l: LandscapeDescriptive): string {
  const parts: string[] = [];
  parts.push(`## ${l.name} (${l.split})`);
  if (l.note) parts.push(`_${l.note}._`);
  parts.push(`${l.models} models. Each variant applies on top of the previous one.`);
  parts.push('### Overview');
  parts.push(overview(l));
  const perType = l.variants[0]?.byType.some((t) => t.coverage !== undefined) ?? false;
  parts.push(perType ? '### By relation type' : '### Endpoints by relation type');
  parts.push(typeTables(l));
  if (l.byTag) {
    parts.push('### must_link in rules ∪ candidates by tag');
    parts.push(tagTable(l));
  }
  parts.push('### Candidate volume');
  parts.push(candidatesTable(l));
  parts.push('### Estimated claim input size');
  parts.push(claimTable(l));
  parts.push('### Findings');
  parts.push(
    'Computed by the rule tier on the variant; for kinds with expected entries, how many of them are still computed.',
  );
  parts.push(findingsTable(l));
  return parts.join('\n\n');
}

export function renderDescriptiveMarkdown(report: DescriptiveReport): string {
  const parts: string[] = [];
  parts.push('# eval:descriptive');
  parts.push(
    'Generated by `pnpm eval:descriptive` (eval/tools/src/descriptive.ts); do not edit. M6 §3.11: how much of the ' +
      'LLM-free relation finding survives tool-style, descriptive models. Deterministic byte transforms of every scored ' +
      "landscape's models (`eval/tools/lib/descriptive.mjs`), cumulative, scored like `eval:candidates` against " +
      '`expected.yaml`. Report only: no threshold. Element ids never change, so the ground truth applies unchanged.',
  );
  parts.push('**Variants**');
  parts.push(table(['Variant', 'Transform'], report.variants.map((v) => [v, VARIANT_DESCRIPTIONS[v]])));
  parts.push('**Assumptions to verify** (tool behaviour the variants model; no real export has been checked yet, M6 §3.8):');
  parts.push(report.assumptions.map((a) => `- ${a}`).join('\n'));
  parts.push('**Facts v1 effects** (what the extractor and the rule tier make of the variants, not tool behaviour):');
  parts.push(report.factsEffects.map((a) => `- ${a}`).join('\n'));
  parts.push(
    `**Claim size** is estimated per model as the server renders a relations task's input on a fresh import ` +
      '(`src/claim-estimate.ts`, pinned to `renderClaimInput` by the server test `claim-estimate.test.ts`): every ' +
      'candidate listed, without the judge-once lists `judged` and `skip`, which depend on the claim order; budget ' +
      `${kb(report.budgetBytes)}. **Rule-tier precision** counts unlisted pairs as wrong (closed world). ` +
      '**Accepted under decision 24.2** counts the acceptances whose caller has an engine: the trust policy (S2c) ' +
      'turns the calls of engine-less models into proposals. ' +
      `Holdout numbers follow the holdout hygiene: none counts fewer than ${HOLDOUT_MIN_GROUP} items, and nested ` +
      `numbers differ by 0 or at least ${HOLDOUT_MIN_GROUP}.`,
  );
  parts.push('## Summary');
  parts.push(
    table(
      ['Landscape', 'split', 'variant', 'must_link in rules ∪ candidates', 'in rule tier', 'rule-tier accepted', 'under 24.2', 'candidates', 'claim max'],
      report.landscapes.flatMap((l) =>
        l.variants.map((v) => [
          l.name,
          l.split,
          v.variant,
          of(v.mustLink.covered, v.mustLink.total),
          of(v.mustLink.rules, v.mustLink.total),
          v.ruleTier.accepted,
          v.ruleTier.acceptedUnderTrustPolicy,
          v.candidates.total,
          kb(v.claim.maxBytes),
        ]),
      ),
    ),
  );
  for (const l of report.landscapes) parts.push(landscapeSection(l));
  return `${parts.join('\n\n')}\n`;
}
