/**
 * Binds the domain's {@link AnalysisPort} to the deterministic libraries
 * (`@analyzr/bpmn-facts`, `@analyzr/relations`). Hostile, oversized or malformed
 * input comes back as a value (→ 413/422 per file); any other error is a
 * bug and propagates (→ 500 `internal`, logged).
 */
import {
  BpmnInputError,
  DEFAULT_PARSE_LIMITS,
  applyAmendments,
  extractFacts,
  factsHash,
  normalizeAmendmentValue,
  readAmendable,
  type ExtractResult,
} from '@analyzr/bpmn-facts';
import {
  createPairAssessor,
  generateCandidates,
  indexCandidates,
  runRules,
} from '@analyzr/relations';

import type { AnalysisPort, Extracted, ExtractFailure } from './domain/ports.ts';

function toExtracted(result: ExtractResult): Extracted {
  return {
    factsVersion: result.factsVersion,
    engine: result.engine,
    processes: result.processes,
    facts: result.facts,
    messageFlows: result.messageFlows,
    warnings: result.warnings,
  };
}

/** A `BpmnInputError` as a value; anything else is a bug and propagates. */
function rejected(err: unknown): { ok: false; error: ExtractFailure } {
  if (err instanceof BpmnInputError) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.encoding === undefined ? {} : { encoding: err.encoding }),
      },
    };
  }
  throw err;
}

export const libraryAnalysis: AnalysisPort = {
  async extract(xml, modelKey) {
    try {
      const result = await extractFacts(xml, { modelKey, limits: DEFAULT_PARSE_LIMITS });
      return { ok: true, value: toExtracted(result) };
    } catch (err) {
      return rejected(err);
    }
  },
  factsHash: (facts) => factsHash(facts),
  runRules: (projectFacts) => runRules(projectFacts),
  candidates: (projectFacts, focusModelKey) => generateCandidates(projectFacts, focusModelKey),
  candidateSource: (projectFacts) => {
    const prepared = indexCandidates(projectFacts);
    return (focusModelKey) => generateCandidates(projectFacts, focusModelKey, undefined, prepared);
  },
  pairAssessor: (projectFacts) => createPairAssessor(projectFacts),
  async amend(xml, amendments, modelKey) {
    try {
      const result = await applyAmendments(xml, amendments, {
        modelKey,
        limits: DEFAULT_PARSE_LIMITS,
      });
      return {
        ok: true,
        value: {
          xml: result.xml,
          outcomes: result.outcomes,
          extracted: toExtracted(result.extraction),
        },
      };
    } catch (err) {
      return rejected(err);
    }
  },
  async readAmendable(xml, modelKey) {
    try {
      return {
        ok: true,
        value: await readAmendable(xml, { modelKey, limits: DEFAULT_PARSE_LIMITS }),
      };
    } catch (err) {
      return rejected(err);
    }
  },
  normalizeAmendmentValue: (op, raw) => normalizeAmendmentValue(op, raw),
};
