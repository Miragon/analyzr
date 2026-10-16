/**
 * The open-questions read model's input built from the libraries alone, as
 * the server holds it right after an import (M6 S4): facts, the rule tier's
 * relations with one rule assertion each (an accepted call is a rule
 * decision, the rest rule proposals), the visible findings and every
 * model's candidates; no judgement, no chain, no submission. Tests add
 * those by hand.
 */
import { extractFacts, factsHash } from '@analyzr/bpmn-facts';
import type {
  AssertionId,
  PrincipalId,
  ProjectFacts,
  ProjectId,
  RelationId,
} from '@analyzr/contracts';
import { generateCandidates, runRules } from '@analyzr/relations';

import { visibleFindings } from '../../src/domain/findings.ts';
import type { ModelHead, OpenQuestionInput } from '../../src/domain/open-questions/model.ts';
import type { RelationRecord, StoredAssertion } from '../../src/domain/ports.ts';

export const PROJECT: ProjectId = `prj_${'0'.repeat(26)}`;
export const RULES = `prn_${'0'.repeat(22)}RULE` as PrincipalId;
export const AT = new Date('2026-10-16T00:00:00.000Z');

/** A relation id from a number (`rel_` + 26 digits). */
export const relationId = (i: number): RelationId => `rel_${String(i).padStart(26, '0')}`;
/** An assertion id from a number (`asr_` + 26 digits). */
export const assertionId = (i: number): AssertionId => `asr_${String(i).padStart(26, '0')}`;

/** A stored relation assertion with defaults (a rule proposal); `over` sets the rest. */
export function assertion(
  over: Partial<StoredAssertion> & { relationId: RelationId },
): StoredAssertion {
  return {
    id: assertionId(0),
    projectId: PROJECT,
    seq: 1,
    kind: 'proposal',
    verdict: null,
    sourceKind: 'rule',
    principalId: RULES,
    clientId: null,
    declared: null,
    submissionId: null,
    tier: null,
    confidence: null,
    rationale: null,
    evidence: null,
    question: null,
    label: null,
    linkedRelationId: null,
    fromFp: null,
    toFp: null,
    fromHash: null,
    toHash: null,
    handle: 'analyzr-rules',
    createdAt: AT,
    ...over,
  };
}

/** The read model's input for these files after an import, from the libraries. */
export async function libraryInput(
  files: readonly { key: string; bytes: Uint8Array | string }[],
): Promise<OpenQuestionInput> {
  const models: ProjectFacts['models'] = [];
  const heads = new Map<string, ModelHead>();
  for (const [i, f] of [...files].sort((a, b) => (a.key < b.key ? -1 : 1)).entries()) {
    const r = await extractFacts(f.bytes, { modelKey: f.key });
    models.push({
      modelKey: f.key,
      factsVersion: r.factsVersion,
      processes: r.processes,
      facts: r.facts,
      messageFlows: r.messageFlows,
    });
    heads.set(f.key, {
      name: r.processes[0]?.name ?? null,
      engine: r.engine,
      factsHash: factsHash(r.facts),
      seq: i + 1,
    });
  }
  const projectFacts: ProjectFacts = { models };
  const rules = runRules(projectFacts);
  const relations: RelationRecord[] = rules.relations.map((r, i) => ({
    id: relationId(i),
    projectId: PROJECT,
    type: r.type,
    fromRef: r.from,
    toRef: r.to,
    status: r.status,
    endpointState: 'ok',
    tier: r.tier,
    confidence: r.confidence,
    version: 1,
    attrs: r.attrs,
    fromFp: null,
    toFp: null,
    createdAt: AT,
    updatedAt: AT,
  }));
  const histories = new Map(
    relations.map((rec, i): [string, StoredAssertion[]] => [
      rec.id,
      [
        assertion({
          id: assertionId(i),
          relationId: rec.id,
          seq: files.length + i + 1,
          kind: rec.status === 'accepted' ? 'decision' : 'proposal',
          verdict: rec.status === 'accepted' ? 'accept' : null,
          tier: rec.tier,
          confidence: rec.confidence,
        }),
      ],
    ]),
  );
  return {
    projectFacts,
    models: heads,
    findings: visibleFindings(rules.findings, relations),
    relations,
    histories,
    judged: new Set(),
    noLinks: [],
    candidates: generateCandidates(projectFacts),
    chain: null,
    submissions: [],
  };
}
