/**
 * Auto-accept rules (owner decision 19), pure part: the checks of a draft
 * beyond its schema, the fields an edit compares, and decision 9 as the
 * read-only system rule; the criteria a rule for derived calls may and may
 * not name (M6 S2c-3, owner decision 28 (1)). Synthetic data only.
 */
import { AutoAcceptRuleDraft, type PrincipalId } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import {
  draftFields,
  nameKey,
  ruleDraftProblem,
  sameFields,
  systemRule,
} from '../../src/domain/auto-accept/rules.ts';

const AGENT = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2A1' as PrincipalId;

const draft = (over: Record<string, unknown> = {}) =>
  AutoAcceptRuleDraft.parse({
    name: 'Schlüssel ab 90 %',
    kind: 'relation',
    tier: 'key',
    minConfidence: 0.9,
    ...over,
  });

describe('a draft', () => {
  it('defaults to off, pipeline proposals only, without narrowing, an agent rule', () => {
    expect(draft()).toMatchObject({
      enabled: false,
      includeAdHoc: false,
      relationType: null,
      agentPrincipalId: null,
      llmModel: null,
      note: null,
      proposedBy: 'agent',
      derivedKind: null,
      converter: null,
    });
  });

  it('is refused by the contract for a tier of another kind, a type on a placement rule, below 0.5', () => {
    expect(
      AutoAcceptRuleDraft.safeParse({ ...draft(), kind: 'placement', tier: 'key' }).success,
    ).toBe(false);
    expect(
      AutoAcceptRuleDraft.safeParse({
        ...draft(),
        kind: 'placement',
        tier: 'lexical',
        relationType: 'call',
      }).success,
    ).toBe(false);
    expect(AutoAcceptRuleDraft.safeParse({ ...draft(), minConfidence: 0.49 }).success).toBe(false);
    expect(AutoAcceptRuleDraft.safeParse({ ...draft(), minConfidence: 1.01 }).success).toBe(false);
    expect(AutoAcceptRuleDraft.safeParse({ ...draft(), name: '  ' }).success).toBe(false);
  });

  it('is checked in the domain as well, in a fixed order', () => {
    const agents = new Set([AGENT]);
    expect(ruleDraftProblem(draft(), [], agents)).toBeNull();
    expect(ruleDraftProblem({ ...draft(), kind: 'placement' }, [], agents)).toBe(
      'kind-tier-mismatch',
    );
    expect(
      ruleDraftProblem(
        { ...draft(), kind: 'placement', tier: 'lexical', relationType: 'call' },
        [],
        agents,
      ),
    ).toBe('type-not-for-placements');
    expect(ruleDraftProblem({ ...draft(), minConfidence: 0.3 }, [], agents)).toBe(
      'confidence-out-of-range',
    );
    expect(ruleDraftProblem({ ...draft(), note: 'a\u0000b' }, [], agents)).toBe(
      'control-characters',
    );
    expect(
      ruleDraftProblem(
        { ...draft(), agentPrincipalId: 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2Z9' },
        [],
        agents,
      ),
    ).toBe('unknown-agent');
    expect(ruleDraftProblem({ ...draft(), agentPrincipalId: AGENT }, [], agents)).toBeNull();
    expect(ruleDraftProblem(draft(), ['SCHLÜSSEL AB 90 %'], agents)).toBe('name-taken');
  });

  it('compares names ignoring case and surrounding blanks', () => {
    expect(nameKey('  Schlüssel ')).toBe(nameKey('SCHLÜSSEL'));
  });
});

describe('a rule for derived calls (M6 S2c-3)', () => {
  const derived = (over: Record<string, unknown> = {}) => ({
    name: 'Aufrufe: Export ohne Engine',
    kind: 'relation',
    tier: 'key',
    minConfidence: 0.9,
    relationType: 'call',
    proposedBy: 'rule',
    derivedKind: 'export',
    ...over,
  });
  const ok = (over: Record<string, unknown> = {}) =>
    AutoAcceptRuleDraft.safeParse(derived(over)).success;

  it('names export, converted with exactly one converter, or none', () => {
    expect(ok()).toBe(true);
    expect(ok({ derivedKind: 'none' })).toBe(true);
    expect(ok({ derivedKind: 'converted', converter: 'normalize-bpmn@0.1.0' })).toBe(true);
    expect(
      AutoAcceptRuleDraft.parse(derived({ derivedKind: 'converted', converter: ' x@1 ' }))
        .converter,
    ).toBe('x@1');
    expect(ok({ derivedKind: 'converted' })).toBe(false);
    expect(ok({ derivedKind: 'converted', converter: '' })).toBe(false);
    expect(ok({ derivedKind: 'converted', converter: 'x'.repeat(121) })).toBe(false);
    expect(ok({ derivedKind: 'converted', converter: 'a\u0007b' })).toBe(false);
    expect(ok({ converter: 'normalize-bpmn@0.1.0' })).toBe(false);
    expect(ok({ derivedKind: null })).toBe(false);
  });

  it('never names reconstructed or as told (decision 28 (1) „Streng“)', () => {
    expect(ok({ derivedKind: 'reconstructed' })).toBe(false);
    expect(ok({ derivedKind: 'as-told' })).toBe(false);
  });

  it('is fixed to a relation rule of tier key, type call, 0.9, without agent, model or ad hoc', () => {
    for (const over of [
      { kind: 'placement', tier: 'lexical', relationType: null },
      { tier: 'lexical' },
      { relationType: null },
      { relationType: 'message' },
      { minConfidence: 0.95 },
      { minConfidence: 0.5 },
      { agentPrincipalId: AGENT },
      { llmModel: 'some-model' },
      { includeAdHoc: true },
    ]) {
      expect(ok(over), JSON.stringify(over)).toBe(false);
    }
  });

  it('is refused for an agent rule that names a derivation', () => {
    expect(AutoAcceptRuleDraft.safeParse({ ...draft(), derivedKind: 'export' }).success).toBe(
      false,
    );
    expect(AutoAcceptRuleDraft.safeParse({ ...draft(), converter: 'x@1' }).success).toBe(false);
  });

  it('is checked in the domain as well', () => {
    const agents = new Set([AGENT]);
    const parsed = AutoAcceptRuleDraft.parse(derived());
    expect(ruleDraftProblem(parsed, [], agents)).toBeNull();
    for (const over of [
      { minConfidence: 0.95 },
      { relationType: 'message' as const },
      { includeAdHoc: true },
      { llmModel: 'm' },
      { derivedKind: null },
      { derivedKind: 'converted' as const },
      { converter: 'x@1' },
    ]) {
      expect(ruleDraftProblem({ ...parsed, ...over }, [], agents), JSON.stringify(over)).toBe(
        'derived-criteria',
      );
    }
    expect(ruleDraftProblem({ ...draft(), derivedKind: 'export' }, [], agents)).toBe(
      'derived-criteria',
    );
    expect(
      ruleDraftProblem({ ...parsed, derivedKind: 'converted', converter: 'a\u0000b' }, [], agents),
    ).toBe('control-characters');
  });

  it('saving an older (agent) rule unchanged writes nothing; the new fields count as changes', () => {
    const head = draftFields(draft());
    expect(head).toMatchObject({ proposedBy: 'agent', derivedKind: null, converter: null });
    expect(sameFields(head, draftFields(draft()))).toBe(true);
    const calls = draftFields(AutoAcceptRuleDraft.parse(derived()));
    expect(
      sameFields(calls, draftFields(AutoAcceptRuleDraft.parse(derived({ derivedKind: 'none' })))),
    ).toBe(false);
    const converted = (converter: string) =>
      draftFields(AutoAcceptRuleDraft.parse(derived({ derivedKind: 'converted', converter })));
    expect(sameFields(converted('x@1'), converted('x@1'))).toBe(true);
    expect(sameFields(converted('x@1'), converted('x@2'))).toBe(false);
  });
});

describe('an edit', () => {
  it('changes something only when a field differs (name and note trimmed)', () => {
    const head = draftFields(draft({ note: ' strenger ' }));
    expect(head.note).toBe('strenger');
    expect(sameFields(head, draftFields(draft({ note: 'strenger' })))).toBe(true);
    expect(sameFields(head, draftFields(draft({ note: 'strenger', enabled: true })))).toBe(false);
    expect(sameFields(head, draftFields(draft({ note: 'strenger', minConfidence: 0.95 })))).toBe(
      false,
    );
    expect(draftFields(draft({ note: '' })).note).toBeNull();
  });
});

describe('the system rule', () => {
  it('describes decision 9 as amended by the trust rule (24.2, 25.2), read-only', () => {
    const rule = systemRule(3, 2);
    expect(rule).toMatchObject({
      id: 'analyzr-rules/1.0.0',
      name: 'Eindeutige Aufrufe',
      kind: 'relation',
      relationType: 'call',
      readOnly: true,
      accepted: 3,
      proposed: 2,
    });
    expect(rule.description).toBe(
      'Ein statischer Aufruf (calledElement), der genau einen anderen Prozess nennt, wird beim ' +
        'Import angenommen, wenn das aufrufende Modell aus Camunda 7 oder 8 stammt, über den ' +
        'Owner-Zugang oder das Web hochgeladen wurde und nicht als konvertiert, KI-rekonstruiert ' +
        'oder aus einem Interview angegeben ist. Sonst wird er mit 90 % vorgeschlagen. Ein ' +
        'Aufrufziel, das du in analyzr ergänzt hast, gilt immer als modelliert.',
    );
  });
});
