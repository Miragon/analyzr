/**
 * Auto-accept rules (owner decision 19), pure part: the rule match (every
 * criterion, the inclusive boundary, the first match in creation order) and
 * every safeguard for relations and placements, in their order; rules for
 * derived calls (M6 S2c-3): who triggers which rule (an existing agent rule
 * never accepts the rule tier's proposal of a derived call, a rule for
 * derived calls never an agent's or another rule-tier proposal), the
 * narrowing by derived kind and exact converter, and the order of
 * `agent-upload` and `amendment-conflict`; no rule, an agent rule neither,
 * accepts a call whose caller an agent token uploaded (owner decision 28
 * (1)). Synthetic data only.
 */
import type { AutoAcceptRuleId, PrincipalId } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import {
  agentUploadedCaller,
  derivedCallView,
  evaluatePlacementAutoAccept,
  evaluateRelationAutoAccept,
  isDerivedCallProposal,
  matchRule,
  type AutoAcceptRuleRev,
  type DerivedCallView,
  type HistoryView,
  type PlacementSubjectView,
  type TriggerView,
} from '../../src/domain/auto-accept/evaluate.ts';

const OWNER = 'prn_00000000000000000000OWNER' as PrincipalId;
const AGENT = 'prn_000000000000000000000AGENT' as PrincipalId;
const OTHER = 'prn_000000000000000000000OTHER' as PrincipalId;
const RULES = 'prn_0000000000000000000000RULE' as PrincipalId;
const A1 = 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y1' as AutoAcceptRuleId;
const A2 = 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y2' as AutoAcceptRuleId;

function rule(extra: Partial<AutoAcceptRuleRev> = {}): AutoAcceptRuleRev {
  return {
    ruleId: A1,
    revision: 1,
    kind: 'relation',
    name: 'Schlüssel ab 90 %',
    enabled: true,
    tier: 'key',
    minConfidence: 0.9,
    relationType: null,
    agentPrincipalId: null,
    llmModel: null,
    includeAdHoc: false,
    proposedBy: 'agent',
    derivedKind: null,
    converter: null,
    authorId: OWNER,
    authorClientId: 'analyzr-web',
    authorIsOwner: true,
    order: 1,
    ...extra,
  };
}

function trigger(extra: Partial<TriggerView> = {}): TriggerView {
  return {
    id: 'asr_T',
    principalId: AGENT,
    sourceKind: 'agent',
    kind: 'proposal',
    tier: 'key',
    confidence: 0.95,
    question: null,
    llmModel: 'sim-1',
    pipeline: true,
    current: true,
    derivedCall: null,
    agentUploadedCaller: false,
    ...extra,
  };
}

let seq = 0;
function h(
  principalId: PrincipalId,
  kind: HistoryView['kind'],
  extra: Partial<HistoryView> = {},
): HistoryView {
  return {
    seq: ++seq,
    kind,
    verdict: kind === 'decision' ? 'accept' : null,
    sourceKind: principalId === RULES ? 'rule' : principalId === OWNER ? 'human' : 'agent',
    principalId,
    tier: kind === 'proposal' ? 'key' : null,
    confidence: kind === 'proposal' ? 0.95 : null,
    question: null,
    ...extra,
  };
}

const proposed = { status: 'proposed', endpointState: 'ok', type: 'message' } as const;

/** What a rule for derived calls reads of a call from an engine-less export (M6 S2c-3). */
const EXPORT: DerivedCallView = {
  derivedKind: 'export',
  converter: null,
  agentUpload: false,
  amendmentConflict: false,
};

function relation(
  extra: Partial<Parameters<typeof evaluateRelationAutoAccept>[0]> = {},
): ReturnType<typeof evaluateRelationAutoAccept> {
  return evaluateRelationAutoAccept({
    relation: proposed,
    history: [h(AGENT, 'proposal')],
    trigger: trigger(),
    liveNoLinks: 0,
    competingCall: false,
    rules: [rule()],
    ...extra,
  });
}

const reason = (v: ReturnType<typeof relation>) => (v.accept ? 'accept' : v.reason);

describe('the rule match', () => {
  it('accepts at exactly the minimum confidence and not just below it', () => {
    expect(reason(relation({ trigger: trigger({ confidence: 0.9 }) }))).toBe('accept');
    expect(reason(relation({ trigger: trigger({ confidence: 0.8999 }) }))).toBe('no-matching-rule');
    expect(reason(relation({ trigger: trigger({ confidence: null }) }))).toBe('no-matching-rule');
  });

  it('needs the tier, the kind and an enabled rule of an owner', () => {
    expect(reason(relation({ trigger: trigger({ tier: 'lexical' }) }))).toBe('no-matching-rule');
    expect(reason(relation({ rules: [rule({ kind: 'placement', tier: 'lexical' })] }))).toBe(
      'no-matching-rule',
    );
    expect(reason(relation({ rules: [rule({ enabled: false })] }))).toBe('no-matching-rule');
    expect(reason(relation({ rules: [rule({ authorIsOwner: false })] }))).toBe('no-matching-rule');
  });

  it('narrows by relation type, agent and declared model', () => {
    expect(reason(relation({ rules: [rule({ relationType: 'message' })] }))).toBe('accept');
    expect(reason(relation({ rules: [rule({ relationType: 'signal' })] }))).toBe(
      'no-matching-rule',
    );
    expect(reason(relation({ rules: [rule({ agentPrincipalId: AGENT })] }))).toBe('accept');
    expect(reason(relation({ rules: [rule({ agentPrincipalId: OTHER })] }))).toBe(
      'no-matching-rule',
    );
    expect(reason(relation({ rules: [rule({ llmModel: 'sim-1' })] }))).toBe('accept');
    expect(reason(relation({ rules: [rule({ llmModel: 'sim-2' })] }))).toBe('no-matching-rule');
    expect(
      reason(
        relation({ rules: [rule({ llmModel: 'sim-1' })], trigger: trigger({ llmModel: null }) }),
      ),
    ).toBe('no-matching-rule');
  });

  it('takes ad-hoc proposals only when the rule includes them', () => {
    const adHoc = trigger({ pipeline: false });
    expect(reason(relation({ trigger: adHoc }))).toBe('no-matching-rule');
    expect(reason(relation({ trigger: adHoc, rules: [rule({ includeAdHoc: true })] }))).toBe(
      'accept',
    );
  });

  it('records the first matching rule in creation order', () => {
    const first = rule({ ruleId: A2, order: 1, minConfidence: 0.5 });
    const second = rule({ ruleId: A1, order: 2 });
    expect(
      matchRule([second, first], trigger(), { kind: 'relation', relationType: 'message' }),
    ).toBe(first);
    const v = relation({ rules: [second, rule({ ruleId: A2, order: 3, enabled: false })] });
    expect(v.accept && v.rule.ruleId).toBe(A1);
  });
});

describe('relation safeguards', () => {
  it('never lets humans trigger a rule, the rule tier only with a derived call (M6 S2c-3)', () => {
    expect(reason(relation({ trigger: trigger({ sourceKind: 'human' }) }))).toBe('not-agent');
    // A rule-tier proposal of anything but a unique call from a derived model.
    expect(reason(relation({ trigger: trigger({ sourceKind: 'rule' }) }))).toBe('not-agent');
    expect(reason(relation({ trigger: trigger({ kind: 'withdrawal' }) }))).toBe('not-agent');
    // A derived call's proposal is evaluated, but no agent rule matches it.
    expect(
      reason(
        relation({
          trigger: trigger({ sourceKind: 'rule', derivedCall: EXPORT, principalId: RULES }),
        }),
      ),
    ).toBe('no-matching-rule');
  });

  it('refuses a stale pipeline proposal', () => {
    expect(reason(relation({ trigger: trigger({ current: false }) }))).toBe('stale-proposal');
  });

  it('accepts only open items with both ends unchanged', () => {
    for (const status of ['held', 'accepted', 'rejected', 'obsolete'] as const) {
      expect(reason(relation({ relation: { ...proposed, status } }))).toBe('not-open');
    }
    for (const endpointState of ['changed', 'missing'] as const) {
      expect(reason(relation({ relation: { ...proposed, endpointState } }))).toBe(
        'endpoint-not-ok',
      );
    }
  });

  it('refuses a call with a competing call, allows message fan-out', () => {
    const call = { ...proposed, type: 'call' };
    expect(reason(relation({ relation: call, competingCall: true }))).toBe('competing-call');
    expect(reason(relation({ relation: call, competingCall: false }))).toBe('accept');
    expect(reason(relation({ competingCall: true }))).toBe('accept');
  });

  it('refuses any human involvement', () => {
    const cases: HistoryView[][] = [
      [h(AGENT, 'proposal'), h(OWNER, 'decision', { verdict: 'accept' })],
      [h(AGENT, 'proposal'), h(OWNER, 'decision', { verdict: 'reject' })],
      [h(AGENT, 'proposal'), h(OWNER, 'decision', { verdict: 'hold' })],
      [h(AGENT, 'proposal'), h(OWNER, 'note')],
      [h(OWNER, 'proposal', { tier: 'manual' }), h(AGENT, 'proposal')],
      [
        h(AGENT, 'proposal'),
        h(OWNER, 'decision', { autoAcceptRuleId: A1 }),
        h(OWNER, 'withdrawal', { autoAcceptRuleId: A1 }),
      ],
    ];
    for (const history of cases) expect(reason(relation({ history }))).toBe('human-involved');
  });

  it('is not blocked by a rule-tier stance or another agent without a question', () => {
    const history = [h(RULES, 'proposal'), h(OTHER, 'proposal'), h(AGENT, 'proposal')];
    expect(reason(relation({ history }))).toBe('accept');
  });

  it('refuses a question on any live agent proposal, the trigger included', () => {
    expect(
      reason(relation({ history: [h(AGENT, 'proposal', { question: 'Welcher Prozess?' })] })),
    ).toBe('agent-question');
    expect(
      reason(
        relation({
          history: [h(OTHER, 'proposal', { question: 'Sicher?' }), h(AGENT, 'proposal')],
        }),
      ),
    ).toBe('agent-question');
    // A withdrawn question no longer counts; a blank one never does.
    expect(
      reason(
        relation({
          history: [
            h(OTHER, 'proposal', { question: 'Sicher?' }),
            h(OTHER, 'withdrawal'),
            h(AGENT, 'proposal', { question: '  ' }),
          ],
        }),
      ),
    ).toBe('accept');
  });

  it('refuses a pair with a live no-link', () => {
    expect(reason(relation({ liveNoLinks: 1 }))).toBe('no-link');
  });

  it('reports the first failing check', () => {
    expect(
      reason(
        relation({
          trigger: trigger({ current: false }),
          relation: { ...proposed, status: 'held' },
        }),
      ),
    ).toBe('stale-proposal');
    expect(
      reason(
        relation({
          history: [h(AGENT, 'proposal', { question: '?' }), h(OWNER, 'note')],
          liveNoLinks: 2,
        }),
      ),
    ).toBe('human-involved');
    expect(
      reason(relation({ history: [h(AGENT, 'proposal', { question: '?' })], liveNoLinks: 2 })),
    ).toBe('agent-question');
  });
});

describe('placement safeguards', () => {
  const placementRule = rule({ kind: 'placement', tier: 'lexical' });
  const own: PlacementSubjectView = {
    id: 'plc_A',
    status: 'proposed',
    endpointState: 'ok',
    elementId: 'step-antrag',
    generation: 1,
  };
  const other = (extra: Partial<PlacementSubjectView>): PlacementSubjectView => ({
    ...own,
    id: 'plc_B',
    elementId: 'step-bescheid',
    ...extra,
  });
  const lexical = (principalId: PrincipalId, extra: Partial<HistoryView> = {}) =>
    h(principalId, 'proposal', { tier: 'lexical', ...extra });

  function placement(
    extra: Partial<Parameters<typeof evaluatePlacementAutoAccept>[0]> = {},
  ): string {
    const v = evaluatePlacementAutoAccept({
      placement: own,
      stepLive: true,
      processPlacements: [{ placement: own, history: [lexical(AGENT)] }],
      trigger: trigger({ tier: 'lexical' }),
      priorVerdict: null,
      rules: [placementRule],
      ...extra,
    });
    return v.accept ? 'accept' : v.reason;
  }

  it('accepts a lone agent proposal on a live step', () => {
    expect(placement()).toBe('accept');
  });

  it('never accepts @outside or a removed step', () => {
    const outside = { ...own, elementId: '@outside' };
    expect(
      placement({ placement: outside, processPlacements: [{ placement: outside, history: [] }] }),
    ).toBe('outside');
    expect(placement({ stepLive: false })).toBe('step-removed');
  });

  it('respects decision 18: no second home step', () => {
    for (const status of ['accepted', 'held'] as const) {
      expect(
        placement({
          processPlacements: [
            { placement: own, history: [lexical(AGENT)] },
            { placement: other({ status }), history: [] },
          ],
        }),
      ).toBe('has-home-step');
    }
    // Also an acceptance on a removed step generation.
    expect(
      placement({
        processPlacements: [
          { placement: own, history: [lexical(AGENT)] },
          { placement: other({ status: 'accepted', endpointState: 'missing' }), history: [] },
        ],
      }),
    ).toBe('has-home-step');
  });

  it('refuses a process with live proposals on another step (agent, own or rule tier)', () => {
    for (const p of [lexical(OTHER), lexical(AGENT), h(RULES, 'proposal')]) {
      expect(
        placement({
          processPlacements: [
            { placement: own, history: [lexical(AGENT)] },
            { placement: other({}), history: [p] },
          ],
        }),
      ).toBe('competing-step');
    }
  });

  it('allows two agents on the same step', () => {
    expect(
      placement({
        processPlacements: [{ placement: own, history: [lexical(OTHER), lexical(AGENT)] }],
      }),
    ).toBe('accept');
  });

  it('refuses any human assertion on any placement of the process', () => {
    expect(
      placement({
        processPlacements: [
          { placement: own, history: [lexical(AGENT)] },
          { placement: other({ status: 'rejected' }), history: [h(OWNER, 'note')] },
        ],
      }),
    ).toBe('human-involved');
  });

  it('refuses a question on a live agent proposal of the process', () => {
    expect(
      placement({
        processPlacements: [{ placement: own, history: [lexical(AGENT, { question: '?' })] }],
      }),
    ).toBe('agent-question');
  });

  it('refuses another agent’s current unsure verdict, not a stale or its own', () => {
    expect(
      placement({ priorVerdict: { principalId: OTHER, outcome: 'unsure', current: true } }),
    ).toBe('agent-unsure');
    expect(
      placement({ priorVerdict: { principalId: OTHER, outcome: 'unsure', current: false } }),
    ).toBe('accept');
    expect(
      placement({ priorVerdict: { principalId: AGENT, outcome: 'unsure', current: true } }),
    ).toBe('accept');
    expect(
      placement({ priorVerdict: { principalId: OTHER, outcome: 'skipped', current: true } }),
    ).toBe('accept');
  });

  it('needs a placement rule of the proposal’s tier', () => {
    expect(placement({ rules: [rule()] })).toBe('no-matching-rule');
    expect(placement({ trigger: trigger({ tier: 'semantic' }) })).toBe('no-matching-rule');
  });
});

describe('rules for derived calls (M6 S2c-3)', () => {
  const call = { ...proposed, type: 'call' } as const;
  const derivedRule = (extra: Partial<AutoAcceptRuleRev> = {}) =>
    rule({
      proposedBy: 'rule',
      relationType: 'call',
      minConfidence: 0.9,
      derivedKind: 'export',
      ...extra,
    });
  /** The rule tier's proposal of a unique call from a derived model. */
  const derivedTrigger = (view: Partial<DerivedCallView> = {}, extra: Partial<TriggerView> = {}) =>
    trigger({
      principalId: RULES,
      sourceKind: 'rule',
      confidence: 0.9,
      llmModel: null,
      pipeline: false,
      derivedCall: { ...EXPORT, ...view },
      ...extra,
    });
  const derived = (extra: Partial<Parameters<typeof evaluateRelationAutoAccept>[0]> = {}) =>
    reason(
      relation({
        relation: call,
        history: [h(RULES, 'proposal', { confidence: 0.9 })],
        trigger: derivedTrigger(),
        rules: [derivedRule()],
        ...extra,
      }),
    );

  it('accepts the rule tier’s proposal of a derived call from the named source', () => {
    expect(derived()).toBe('accept');
  });

  it('pins: an existing agent rule (any type or call, 0.5 or 0.9) never accepts a derived call', () => {
    for (const r of [
      rule({ minConfidence: 0.5 }),
      rule({ relationType: 'call' }),
      rule({ relationType: 'call', includeAdHoc: true }),
      rule({
        relationType: 'call',
        minConfidence: 0.5,
        includeAdHoc: true,
        agentPrincipalId: RULES,
      }),
    ]) {
      expect(derived({ rules: [r] })).toBe('no-matching-rule');
    }
  });

  it('never accepts an agent’s proposal, nor other rule-tier proposals', () => {
    // An agent's proposal of the same call.
    expect(
      derived({
        history: [h(AGENT, 'proposal', { confidence: 0.9 })],
        trigger: trigger({ confidence: 0.9 }),
      }),
    ).toBe('no-matching-rule');
    // An agent's proposal with a derived view (cannot happen; the source kind still counts).
    expect(derived({ trigger: trigger({ confidence: 0.9, derivedCall: EXPORT }) })).toBe(
      'no-matching-rule',
    );
    // The rule tier's proposals by file stem, duplicate id or message carry no derived view.
    for (const t of [
      trigger({ principalId: RULES, sourceKind: 'rule', confidence: 0.8, tier: 'key' }),
      trigger({ principalId: RULES, sourceKind: 'rule', confidence: 0.5, tier: 'key' }),
      trigger({ principalId: RULES, sourceKind: 'rule', confidence: 1, tier: 'key' }),
    ]) {
      expect(derived({ trigger: t })).toBe('not-agent');
    }
    expect(derived({ relation: { ...proposed, type: 'message' }, rules: [derivedRule()] })).toBe(
      'no-matching-rule',
    );
  });

  it('narrows by derived kind and the converter, exactly', () => {
    expect(derived({ trigger: derivedTrigger({ derivedKind: 'converted' }) })).toBe(
      'no-matching-rule',
    );
    expect(derived({ trigger: derivedTrigger({ derivedKind: null }) })).toBe('no-matching-rule');
    expect(
      derived({
        trigger: derivedTrigger({ derivedKind: null }),
        rules: [derivedRule({ derivedKind: 'none' })],
      }),
    ).toBe('accept');
    const converted = derivedRule({ derivedKind: 'converted', converter: 'normalize-bpmn@0.1.0' });
    expect(
      derived({
        trigger: derivedTrigger({ derivedKind: 'converted', converter: 'normalize-bpmn@0.1.0' }),
        rules: [converted],
      }),
    ).toBe('accept');
    for (const converter of ['normalize-bpmn@0.2.0', 'other@0.1.0', null]) {
      expect(
        derived({
          trigger: derivedTrigger({ derivedKind: 'converted', converter }),
          rules: [converted],
        }),
      ).toBe('no-matching-rule');
    }
    // Reconstructed or as told: no rule may name them.
    for (const derivedKind of ['reconstructed', 'as-told'] as const) {
      expect(derived({ trigger: derivedTrigger({ derivedKind }) })).toBe('no-matching-rule');
    }
  });

  it('never accepts a call of an agent upload, nor one whose call target is in conflict', () => {
    expect(derived({ trigger: derivedTrigger({ agentUpload: true }) })).toBe('agent-upload');
    expect(derived({ trigger: derivedTrigger({ amendmentConflict: true }) })).toBe(
      'amendment-conflict',
    );
  });

  it('no agent rule accepts an agent’s proposal of a call whose caller an agent token uploaded', () => {
    const agentCall = (t: Partial<TriggerView>, r = rule()) =>
      reason(
        relation({
          relation: call,
          history: [h(AGENT, 'proposal')],
          trigger: trigger(t),
          rules: [r],
        }),
      );
    expect(agentCall({})).toBe('accept');
    expect(agentCall({ agentUploadedCaller: true })).toBe('agent-upload');
    expect(agentCall({ agentUploadedCaller: true }, rule({ relationType: 'call' }))).toBe(
      'agent-upload',
    );
    // after no-matching-rule, before the subject's own state
    expect(agentCall({ agentUploadedCaller: true, tier: 'semantic' })).toBe('no-matching-rule');
    expect(agentCall({ agentUploadedCaller: true, current: false })).toBe('agent-upload');
    // the flag comes from the caller's trust, for calls only
    const trust = new Map([
      [
        'a/x',
        {
          trust: { class: 'derived', reasons: ['no-engine', 'agent-upload'] },
          derivedKind: null,
          converter: null,
          conflictedCalls: new Set<string>(),
        },
      ],
      [
        'h/y',
        {
          trust: { class: 'derived', reasons: ['no-engine'] },
          derivedKind: null,
          converter: null,
          conflictedCalls: new Set<string>(),
        },
      ],
    ]);
    expect(agentUploadedCaller({ type: 'call', fromRef: 'a/x#Call_A' }, trust)).toBe(true);
    expect(agentUploadedCaller({ type: 'message', fromRef: 'a/x#Event_A' }, trust)).toBe(false);
    expect(agentUploadedCaller({ type: 'call', fromRef: 'h/y#Call_A' }, trust)).toBe(false);
    expect(agentUploadedCaller({ type: 'call', fromRef: 'gone/z#Call_A' }, trust)).toBe(false);
  });

  it('pins the order: no-matching-rule, agent-upload, amendment-conflict, then the rest', () => {
    const both = derivedTrigger({ agentUpload: true, amendmentConflict: true }, { current: false });
    expect(derived({ trigger: both, rules: [derivedRule({ derivedKind: 'none' })] })).toBe(
      'no-matching-rule',
    );
    expect(derived({ trigger: both, relation: { ...call, status: 'held' } })).toBe('agent-upload');
    expect(
      derived({
        trigger: derivedTrigger({ amendmentConflict: true }, { current: false }),
        relation: { ...call, status: 'held' },
      }),
    ).toBe('amendment-conflict');
    expect(derived({ trigger: derivedTrigger({}, { current: false }), competingCall: true })).toBe(
      'stale-proposal',
    );
    expect(derived({ relation: { ...call, status: 'accepted' }, competingCall: true })).toBe(
      'not-open',
    );
    expect(derived({ competingCall: true, liveNoLinks: 1 })).toBe('competing-call');
    expect(
      derived({
        history: [h(RULES, 'proposal', { confidence: 0.9 }), h(OWNER, 'note')],
        liveNoLinks: 1,
      }),
    ).toBe('human-involved');
    expect(
      derived({
        history: [
          h(RULES, 'proposal', { confidence: 0.9 }),
          h(AGENT, 'proposal', { question: 'Welcher?' }),
        ],
        liveNoLinks: 1,
      }),
    ).toBe('agent-question');
    expect(derived({ liveNoLinks: 1 })).toBe('no-link');
  });

  it('tells a derived call’s proposal and its view from the caller’s trust', () => {
    const base = { sourceKind: 'rule', kind: 'proposal', tier: 'key', confidence: 0.9 } as const;
    expect(
      isDerivedCallProposal({ type: 'call' }, { ...base, rationale: 'Vertrauensregel: …' }),
    ).toBe(true);
    expect(isDerivedCallProposal({ type: 'call' }, { ...base, rationale: null })).toBe(false);
    expect(
      isDerivedCallProposal({ type: 'message' }, { ...base, rationale: 'Vertrauensregel: …' }),
    ).toBe(false);
    expect(
      isDerivedCallProposal(
        { type: 'call' },
        { ...base, sourceKind: 'agent', rationale: 'Vertrauensregel: …' },
      ),
    ).toBe(false);
    const trust = new Map([
      [
        'a/x',
        {
          trust: { class: 'derived', reasons: ['no-engine', 'agent-upload'] },
          derivedKind: 'export' as const,
          converter: null,
          conflictedCalls: new Set(['Call_B']),
        },
      ],
      [
        'm/y',
        { trust: null, derivedKind: null, converter: null, conflictedCalls: new Set<string>() },
      ],
      [
        'c/z',
        {
          trust: { class: 'modelled', reasons: [] },
          derivedKind: 'export' as const,
          converter: null,
          conflictedCalls: new Set<string>(),
        },
      ],
    ]);
    expect(derivedCallView('a/x#Call_A', trust)).toEqual({
      derivedKind: 'export',
      converter: null,
      agentUpload: true,
      amendmentConflict: false,
    });
    expect(derivedCallView('a/x#Call_B', trust)?.amendmentConflict).toBe(true);
    expect(derivedCallView('m/y#Call_A', trust)).toBeNull();
    expect(derivedCallView('c/z#Call_A', trust)).toBeNull();
    expect(derivedCallView('gone/z#Call_A', trust)).toBeNull();
  });
});
