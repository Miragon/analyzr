// The claim input size estimate of eval:descriptive: a relations task's input
// (`analyzr-claim/1`) as the server's `renderClaimInput`
// (apps/server/src/domain/claim-input.ts) renders it for a freshly imported
// project, from the libraries alone: the model's head facts, every candidate
// of `generateCandidates(facts, model)`, the partner endpoints and processes
// they name, the rule tier's relations touching the model (source `rule`,
// endpoints `ok`) and the visible findings with a ref in the model. It leaves
// out the judge-once lists (`judged`, `skip`), which depend on the order
// tasks are claimed in: every candidate is listed. Ids are fixed
// placeholders of the real length. The server's unit test
// `claim-estimate.test.ts` requires the same input from `renderClaimInput`
// for every model of nordwind-handel, so the two cannot drift apart.
import {
  CLAIM_DOC_CHARS,
  CLAIM_INPUT_FORMAT,
  RELATION_ENDPOINT_KINDS,
  type ClaimCandidate,
  type ClaimEndpoint,
  type ClaimFact,
  type ClaimInput,
  type ClaimPartnerProcess,
  type ClaimRelation,
  type DerivedRelation,
  type Fact,
  type FactKind,
  type Finding,
  type ProcessInfo,
  type ProjectFacts,
  type RelationId,
  type RevisionId,
} from '@analyzr/contracts';
import { generateCandidates, type RuleResult } from '@analyzr/relations';

/** The relations claim input budget (CONCEPT §3 "≤ ~100 KB"; the server's claim-input-size test). */
export const CLAIM_BUDGET_BYTES = 100 * 1024;

/** Placeholder revision id of every estimated input (`rev_` + 26 characters, as a real one). */
export const ESTIMATE_REVISION_ID: RevisionId = `rev_${'0'.repeat(26)}`;

/** Placeholder id of the rule relation at `index` in `RuleResult.relations`. */
export function estimateRelationId(index: number): RelationId {
  return `rel_${String(index).padStart(26, '0')}`;
}

/** The model's name as the server stores it at ingest: the first process's pool name, else its name. */
export function modelNameOf(processes: readonly ProcessInfo[]): string | null {
  const first = processes[0];
  return first?.participantName ?? first?.name ?? null;
}

const LIVE = new Set(['proposed', 'accepted', 'held']);

/**
 * Findings as the server shows them (`visibleFindings`): `dangling-throw` and
 * `unmatched-catch` whose endpoints a live relation connects are hidden.
 */
export function visibleRuleFindings(findings: readonly Finding[], relations: readonly DerivedRelation[]): Finding[] {
  const connected = new Set<string>();
  for (const r of relations) {
    if (!LIVE.has(r.status)) continue;
    connected.add(r.from);
    connected.add(r.to);
  }
  return findings.filter(
    (f) => (f.kind !== 'dangling-throw' && f.kind !== 'unmatched-catch') || !f.refs.every((ref) => connected.has(ref)),
  );
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;
const truncate = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function docOf(f: Fact): { doc?: string } {
  const doc = f.attrs.documentation;
  return doc ? { doc: truncate(doc, CLAIM_DOC_CHARS) } : {};
}

function compactFact(f: Fact): ClaimFact {
  const { sourceRef, targetRef } = f.attrs;
  return {
    ref: f.ref,
    kind: f.kind,
    ...(f.eventDef === null ? {} : { eventDef: f.eventDef }),
    label: f.label,
    ...(f.keyRaw === '' || f.keyRaw === f.label ? {} : { key: f.keyRaw }),
    ...(f.scope === 'process' ? {} : { scope: f.scope }),
    ...(f.processId === null ? {} : { process: f.processId }),
    ...(f.kind === 'message_flow' && sourceRef !== undefined ? { from: sourceRef } : {}),
    ...(f.kind === 'message_flow' && targetRef !== undefined ? { to: targetRef } : {}),
    ...docOf(f),
  };
}

export interface ClaimEstimateSource {
  projectFacts: ProjectFacts;
  /** `runRules(projectFacts)`. */
  rules: RuleResult;
  modelKey: string;
  engine: 'c7' | 'c8' | null;
}

/** The estimated input of the model's relations task (see the file header). */
export function estimateClaimInput(src: ClaimEstimateSource): ClaimInput {
  const { projectFacts, rules, modelKey } = src;
  const prefix = `${modelKey}#`;
  const own = projectFacts.models.find((m) => m.modelKey === modelKey);
  const factsByRef = new Map<string, Fact[]>();
  const processNames = new Map<string, string | null>();
  for (const m of projectFacts.models) {
    for (const f of m.facts) {
      const list = factsByRef.get(f.ref) ?? [];
      list.push(f);
      factsByRef.set(f.ref, list);
    }
    for (const p of m.processes) processNames.set(p.ref, p.name ?? p.participantName);
  }
  const processFact = (ref: string): Fact | undefined => factsByRef.get(ref)?.find((f) => f.kind === 'process');

  const partners: Record<string, ClaimEndpoint> = {};
  const addPartner = (ref: string, kinds: readonly FactKind[] | null): void => {
    if (ref.startsWith(prefix) || partners[ref] !== undefined) return;
    const facts = factsByRef.get(ref);
    const fact = facts?.find((f) => kinds === null || kinds.includes(f.kind)) ?? facts?.[0];
    if (!fact || fact.processId === null) return;
    const processRef = `${fact.modelKey}#${fact.processId}`;
    const c = compactFact(fact);
    const processName = processNames.get(processRef);
    partners[ref] = {
      kind: c.kind,
      ...(c.eventDef === undefined ? {} : { eventDef: c.eventDef }),
      label: c.label,
      ...(c.key === undefined ? {} : { key: c.key }),
      ...(c.scope === undefined ? {} : { scope: c.scope }),
      process: processRef as ClaimEndpoint['process'],
      ...(processName ? { processName } : {}),
      ...(c.doc === undefined ? {} : { doc: c.doc }),
    };
  };

  const candidates: ClaimCandidate[] = generateCandidates(projectFacts, modelKey).map((c) => {
    addPartner(c.from, RELATION_ENDPOINT_KINDS[c.type].from);
    addPartner(c.to, RELATION_ENDPOINT_KINDS[c.type].to);
    return [c.type, c.from, c.to, c.basis, round4(c.score)];
  });

  const relations: ClaimRelation[] = [];
  rules.relations.forEach((r, i) => {
    if (!r.from.startsWith(prefix) && !r.to.startsWith(prefix)) return;
    addPartner(r.from, RELATION_ENDPOINT_KINDS[r.type].from);
    addPartner(r.to, RELATION_ENDPOINT_KINDS[r.type].to);
    relations.push({
      id: estimateRelationId(i),
      type: r.type,
      from: r.from,
      to: r.to,
      status: r.status,
      tier: r.tier,
      confidence: r.confidence,
      source: 'rule',
      endpointState: 'ok',
    });
  });

  const partnerProcesses: Record<string, ClaimPartnerProcess> = {};
  const processRefs = [...new Set(Object.values(partners).map((p) => p.process))];
  for (const ref of processRefs.sort(compareStrings)) {
    const name = processNames.get(ref);
    const fact = processFact(ref);
    partnerProcesses[ref] = { ...(name ? { name } : {}), ...(fact ? docOf(fact) : {}) };
  }

  const findings = visibleRuleFindings(rules.findings, rules.relations)
    .filter((f) => f.refs.some((ref) => ref.startsWith(prefix)))
    .sort(
      (a, b) =>
        compareStrings(a.kind, b.kind) ||
        compareStrings(a.refs.join(' '), b.refs.join(' ')) ||
        compareStrings(a.detail, b.detail),
    )
    .map((f) => ({ kind: f.kind, refs: [...f.refs], detail: f.detail }));

  const processes = own?.processes ?? [];
  return {
    format: CLAIM_INPUT_FORMAT,
    model: {
      key: modelKey,
      name: modelNameOf(processes),
      revisionId: ESTIMATE_REVISION_ID,
      rev: 1,
      engine: src.engine,
      processes: processes.map((p) => ({ processId: p.processId, name: p.name, participantName: p.participantName })),
    },
    facts: (own?.facts ?? []).map(compactFact),
    candidates,
    partners,
    ...(processRefs.length > 0 ? { partnerProcesses } : {}),
    relations,
    ...(findings.length > 0 ? { findings } : {}),
  };
}

/** Size of an input in bytes (UTF-8 JSON), as an agent receives it (the server's `claimInputBytes`). */
export function claimBytes(input: ClaimInput): number {
  return Buffer.byteLength(JSON.stringify(input), 'utf8');
}
