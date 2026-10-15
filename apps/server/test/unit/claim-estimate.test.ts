/**
 * eval:descriptive estimates each model's claim input from the libraries
 * alone (`estimateClaimInput` in `@analyzr/eval-tools`, M6 S3a). This pins it
 * to the real renderer: for every model of `nordwind-handel`, imported fresh
 * (the rule tier's relations, one rule assertion each, the visible findings,
 * no judgements), `renderClaimInput` without the judge-once lists renders the
 * same input, byte for byte.
 */
import { extractFacts } from '@analyzr/bpmn-facts';
import type { AssertionId, PrincipalId, ProjectId } from '@analyzr/contracts';
import {
  ESTIMATE_REVISION_ID,
  claimBytes,
  estimateClaimInput,
  estimateRelationId,
  modelNameOf,
} from '@analyzr/eval-tools';
import { generateCandidates } from '@analyzr/relations';
import { describe, expect, it } from 'vitest';

import { claimInputBytes, renderClaimInput } from '../../src/domain/claim-input.ts';
import { visibleFindings } from '../../src/domain/findings.ts';
import type { RelationRecord, StoredAssertion } from '../../src/domain/ports.ts';
import { corpusFiles, libraryView } from '../support/corpus.ts';

const PROJECT: ProjectId = `prj_${'0'.repeat(26)}`;
const RULES = `prn_${'0'.repeat(22)}RULE` as PrincipalId;
const AT = new Date('2026-10-15T00:00:00.000Z');

describe('the claim estimate of eval:descriptive', () => {
  it('equals renderClaimInput for every model of a fresh nordwind-handel import', async () => {
    const files = await corpusFiles('nordwind-handel');
    const { projectFacts, rules } = await libraryView(files);
    const records: RelationRecord[] = rules.relations.map((r, i) => ({
      id: estimateRelationId(i),
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
    // As recomputeProject records them: an accepted call is a rule decision, the rest rule proposals.
    const histories = new Map(
      records.map((rec, i): [string, StoredAssertion[]] => [
        rec.id,
        [
          {
            id: `asr_${String(i).padStart(26, '0')}` satisfies AssertionId,
            projectId: PROJECT,
            relationId: rec.id,
            seq: i + 1,
            kind: rec.status === 'accepted' ? 'decision' : 'proposal',
            verdict: rec.status === 'accepted' ? 'accept' : null,
            sourceKind: 'rule',
            principalId: RULES,
            clientId: null,
            declared: null,
            submissionId: null,
            tier: rec.tier,
            confidence: rec.confidence,
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
          },
        ],
      ]),
    );
    const findings = visibleFindings(rules.findings, records);
    let largest = 0;
    for (const f of files) {
      const { engine } = await extractFacts(f.bytes, { modelKey: f.key });
      const processes = projectFacts.models.find((m) => m.modelKey === f.key)?.processes ?? [];
      const rendered = renderClaimInput({
        model: {
          key: f.key,
          name: modelNameOf(processes),
          revisionId: ESTIMATE_REVISION_ID,
          rev: 1,
          engine,
          processes,
        },
        projectFacts,
        candidates: generateCandidates(projectFacts, f.key),
        relations: records.filter(
          (r) => r.fromRef.startsWith(`${f.key}#`) || r.toRef.startsWith(`${f.key}#`),
        ),
        histories,
        findings,
      });
      const estimate = estimateClaimInput({ projectFacts, rules, modelKey: f.key, engine });
      expect(JSON.stringify(estimate), f.key).toBe(JSON.stringify(rendered));
      expect(claimBytes(estimate)).toBe(claimInputBytes(rendered));
      largest = Math.max(largest, claimBytes(estimate));
    }
    // Every candidate listed, as before judge-once (DEVELOPMENT.md: 80.1 KB at most then).
    expect(largest).toBeLessThan(100 * 1024);
  });
});
