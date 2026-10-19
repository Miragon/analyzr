import { describe, expect, it } from 'vitest';

import {
  autoAcceptLabel,
  inForceByAgent,
  indexLedger,
  matchesAuto,
  parseAutoFilter,
  revocationSummary,
} from '../src/lib/auto-accept';
import { countNameFlags } from '../src/lib/auto-accept-flags';
import { subjectLabel } from '../src/lib/auto-accept-names';
import {
  changingCurve,
  criteriaOf,
  draftOf,
  formatPercent,
  formatThreshold,
  historyText,
  nameFlagsText,
  narrowingOf,
  openMatchesText,
  parsePercent,
  percentInput,
  suggestedRuleName,
  tiersOf,
} from '../src/lib/auto-accept-rules';
import { nameUsage } from '../src/lib/generic-names';
import { buildRefIndex, resolverOf } from '../src/lib/refs';
import { filterRelations, parseRelationFilters, sameFilters } from '../src/lib/relation-filters';
import {
  autoAcceptPreview,
  autoAcceptRule,
  fact,
  ledgerEntry,
  relation,
  sampleResolver,
} from './support/fixtures';

const RULE_A = 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3';
const RULE_B = 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y4';

describe('ledger join (owner decision 19)', () => {
  const entries = [
    // rel_A: accepted by rule A, revoked, accepted again by rule B (in force)
    ledgerEntry({
      id: 'rel_A',
      decisionId: 'ast_A1',
      state: 'revoked',
      revocationId: 'ast_A2',
      revokedAt: '2026-10-08T00:00:00.000Z',
    }),
    ledgerEntry({ id: 'rel_A', decisionId: 'ast_A3', ruleId: RULE_B, ruleName: 'B' }),
    // rel_B: revoked (back in review)
    ledgerEntry({ id: 'rel_B', decisionId: 'ast_B1', state: 'revoked', revocationId: 'ast_B2' }),
    // rel_C: a human rejected it since
    ledgerEntry({
      id: 'rel_C',
      decisionId: 'ast_C1',
      state: 'human-decided',
      laterVerdict: 'reject',
      agent: { principalId: 'prn_01OTHER', handle: 'agent:other' },
    }),
    // plc_D: a placement in force
    ledgerEntry({ id: 'plc_D', kind: 'placement', decisionId: 'pas_D1' }),
  ];
  const index = indexLedger(entries);

  it('indexes acceptances in force, per subject, and the marks of decisions and revocations', () => {
    expect([...index.inForce.keys()].sort()).toEqual(['plc_D', 'rel_A']);
    expect(index.inForce.get('rel_A')?.ruleId).toBe(RULE_B);
    expect(index.bySubject.get('rel_A')).toHaveLength(2);
    expect(index.byAssertion.get('ast_A1')).toEqual({
      kind: 'decision',
      ruleName: 'Schlüssel ab 95 %',
      revision: 2,
    });
    expect(index.byAssertion.get('ast_A2')?.kind).toBe('revocation');
    expect([...index.revoked]).toEqual(['rel_B']);
  });

  it('filters by any rule or by one rule, counts per agent', () => {
    expect(matchesAuto(index, 'rel_A', 'any')).toBe(true);
    expect(matchesAuto(index, 'rel_A', RULE_B)).toBe(true);
    expect(matchesAuto(index, 'rel_A', RULE_A)).toBe(false);
    expect(matchesAuto(index, 'rel_B', 'any')).toBe(false);
    expect(matchesAuto(index, 'rel_C', 'any')).toBe(false);
    expect(inForceByAgent(index, 'prn_01AGENT')).toBe(2);
    expect(inForceByAgent(index, 'prn_01OTHER')).toBe(0);
  });

  it('parses the URL filter `auto` and filters relations by it', () => {
    expect(parseAutoFilter('any')).toBe('any');
    expect(parseAutoFilter(RULE_A)).toBe(RULE_A);
    expect(parseAutoFilter('aar_x')).toBeUndefined();
    expect(parseAutoFilter(3)).toBeUndefined();
    expect(parseRelationFilters({ auto: RULE_B, status: 'accepted' })).toEqual({
      status: 'accepted',
      auto: RULE_B,
    });
    const relations = ['rel_A', 'rel_B', 'rel_C'].map((id) =>
      relation({ id, from: `m#${id}`, to: `n#${id}`, status: 'accepted' }),
    );
    expect(filterRelations(relations, { auto: 'any' }, index).map((r) => r.id)).toEqual(['rel_A']);
    // Without the ledger (not an owner, still loading) nothing matches.
    expect(filterRelations(relations, { auto: 'any' })).toEqual([]);
    expect(sameFilters({ auto: 'any' }, { auto: 'any' })).toBe(true);
    expect(sameFilters({ auto: 'any' }, {})).toBe(false);
  });
});

describe('texts and numbers in German', () => {
  it('marks, decimals and percentages', () => {
    expect(autoAcceptLabel('Schlüssel')).toBe('Automatisch angenommen – Regel „Schlüssel“');
    expect(formatPercent(0.9)).toBe('90 %');
    expect(formatPercent(0.925)).toBe('92,5 %');
    expect(formatPercent(14 / 15)).toBe('93,3 %');
    expect(percentInput(0.925)).toBe('92,5');
    // Thresholds keep every decimal they have: never rounder (and looser) than stored.
    expect(formatThreshold(0.9)).toBe('90 %');
    expect(formatThreshold(0.9004)).toBe('90,04 %');
    expect(percentInput(0.9004)).toBe('90,04');
    expect(percentInput(0.92345)).toBe('92,345');
    for (const v of [0.9, 0.9004, 0.9255, 0.9999, 0.92345, 0.5, 1]) {
      expect(parsePercent(percentInput(v)), String(v)).toBe(v);
    }
  });

  it('reads percentages between 50 and 100, inclusive', () => {
    expect(parsePercent('90')).toBe(0.9);
    expect(parsePercent('92,5')).toBe(0.925);
    expect(parsePercent(' 92.5 % ')).toBe(0.925);
    expect(parsePercent('50')).toBe(0.5);
    expect(parsePercent('100')).toBe(1);
    expect(parsePercent('90,04')).toBe(0.9004);
    expect(parsePercent('92,55')).toBe(0.9255);
    expect(parsePercent('99,99')).toBe(0.9999);
    for (const bad of ['49', '49,9', '101', '0.9', 'neunzig', '', '90,12345']) {
      expect(parsePercent(bad), bad).toBeNull();
    }
  });

  it('the tiers per kind, narrowing, drafts and criteria', () => {
    expect(tiersOf('relation')).toEqual(['key', 'lexical', 'semantic']);
    expect(tiersOf('placement')).toEqual(['lexical', 'semantic']);
    expect(
      narrowingOf({
        relationType: 'message',
        llmModel: 'm1',
        includeAdHoc: true,
        agentHandle: 'agent:sim',
        agentRevoked: true,
      }),
    ).toEqual(['Typ Nachricht', 'Agent sim (widerrufen)', 'LLM-Modell m1', 'auch Ad-hoc']);
    const rule = autoAcceptRule({ id: RULE_A, relationType: 'call', enabled: true });
    expect(criteriaOf(draftOf(rule))).toEqual({
      kind: 'relation',
      tier: 'key',
      minConfidence: 0.95,
      relationType: 'call',
      agentPrincipalId: null,
      llmModel: null,
      includeAdHoc: false,
    });
  });

  it('the preview history and a revocation dry run', () => {
    expect(historyText(autoAcceptPreview().history)).toBe(
      'Bisher: 15 von 40 entschiedenen Agentenvorschlägen hätte die Regel angenommen – davon 14 angenommen, 1 abgelehnt, 0 korrigiert (Trefferquote 93,3 %)',
    );
    expect(historyText({ ...autoAcceptPreview().history, held: 2, precision: null })).toContain(
      '0 korrigiert, 2 vorgemerkt (noch keine Trefferquote)',
    );
    expect(
      revocationSummary({
        dryRun: true,
        count: 3,
        toProposed: 2,
        toObsolete: 1,
        humanDecidedSince: 2,
        alreadyRevoked: 1,
        items: [],
        truncated: false,
      }),
    ).toBe(
      '3 automatische Annahmen: 2 gehen zurück in die Prüfung (ein Agentenvorschlag ist noch offen); 1 wird veraltet und von den Agenten neu beurteilt (kein offener Vorschlag mehr). 2 wurden inzwischen von einem Menschen entschieden und bleiben unverändert. 1 war schon widerrufen.',
    );
  });
});

describe('the rules page’s helpers (UX9)', () => {
  it('suggests a rule name from the criteria, „(2)“ … while another rule has it', () => {
    const key = { kind: 'relation' as const, tier: 'key' as const, relationType: null };
    expect(suggestedRuleName({ ...key, threshold: '95 %' }, [])).toBe('Gleicher Name ab 95 %');
    expect(suggestedRuleName({ ...key, relationType: 'signal', threshold: '90 %' }, [])).toBe(
      'Signal: Gleicher Name ab 90 %',
    );
    expect(
      suggestedRuleName(
        { kind: 'placement', tier: 'semantic', relationType: null, threshold: '80 %' },
        [],
      ),
    ).toBe('Platzierung: Gleiche Bedeutung ab 80 %');
    // names are unique ignoring case
    expect(
      suggestedRuleName({ ...key, threshold: '95 %' }, [
        'GLEICHER NAME AB 95 %',
        'Gleicher Name ab 95 % (2)',
      ]),
    ).toBe('Gleicher Name ab 95 % (3)');
  });

  it('keeps the curve rows whose numbers change, and the rule’s own', () => {
    const curve = autoAcceptPreview().curve;
    expect(changingCurve(curve, 0.95).map((c) => c.minConfidence)).toEqual([0.5, 0.95]);
    expect(changingCurve(curve, 0.8).map((c) => c.minConfidence)).toEqual([0.5, 0.8, 0.95]);
    expect(changingCurve(curve, null).map((c) => c.minConfidence)).toEqual([0.5, 0.95]);
  });

  it('the open matches and the flags count', () => {
    expect(openMatchesText(1)).toBe('1 offener Vorschlag passt');
    expect(openMatchesText(2)).toBe('2 offene Vorschläge passen');
    expect(nameFlagsText(3, false)).toBe(
      'davon 3 mit allgemeinem oder mehrfach genutztem Namen (in der Sammelannahme markiert)',
    );
    expect(nameFlagsText(3, true)).toContain('davon mindestens 3 mit');
  });

  it('names a subject by its processes, element and step, never by ref', () => {
    const steps = (id: string) => (id === 'step-a' ? 'Auftrag abwickeln' : id);
    expect(subjectLabel(ledgerEntry({ id: 'rel_01A' }), sampleResolver, steps)).toEqual({
      title: 'Auftragsabwicklung → Rechnungsstellung',
      meta: 'Nachricht · Ware versandbereit',
    });
    const placed = {
      kind: 'placement' as const,
      type: null,
      from: null,
      to: null,
      process: 'vertrieb/auftragsabwicklung#Process_Auftragsabwicklung',
      step: 'step-a',
    };
    expect(subjectLabel(placed, sampleResolver, steps)).toEqual({
      title: 'Auftragsabwicklung → Auftrag abwickeln',
      meta: 'Platzierung',
    });
    expect(subjectLabel({ ...placed, step: '@outside' }, sampleResolver, steps).title).toBe(
      'Auftragsabwicklung → Außerhalb der Kette',
    );
  });

  it('counts the items with a generic or shared name, as the bulk accept flags them', () => {
    const facts = [
      ['a/angebot', 'Send_Antwort', 'msg_throw', 'P_a'],
      ['b/anfrage', 'Catch_Antwort', 'msg_catch', 'P_b'],
      ['c/ticket', 'Catch_Antwort', 'msg_catch', 'P_c'],
      ['d/auftrag', 'Send_Rechnung', 'msg_throw', 'P_d'],
      ['e/debitoren', 'Catch_Rechnung', 'msg_catch', 'P_e'],
    ].map(([modelKey, elementId, kind, processId]) =>
      fact({
        modelKey: modelKey!,
        elementId: elementId!,
        kind: kind as 'msg_throw' | 'msg_catch',
        processId: processId!,
        label: elementId!.endsWith('Antwort') ? 'Antwort' : 'Rechnung gestellt',
        attrs: { messageName: elementId!.endsWith('Antwort') ? 'Antwort' : 'RechnungGestellt' },
      }),
    );
    const resolve = resolverOf(buildRefIndex(facts, []));
    const antwort = relation({
      id: 'rel_01ANTWORT',
      from: 'a/angebot#Send_Antwort',
      to: 'b/anfrage#Catch_Antwort',
      attrs: { messageName: 'Antwort' },
    });
    const item = (id: string, from: string, to: string) => ({
      id,
      kind: 'relation' as const,
      type: 'message' as const,
      from,
      to,
    });
    const items = [
      item(antwort.id, antwort.from, antwort.to),
      item('rel_01RECHNUNG', 'd/auftrag#Send_Rechnung', 'e/debitoren#Catch_Rechnung'),
      { ...item('plc_01X', '', ''), kind: 'placement' as const, type: null },
    ];
    expect(countNameFlags(items, new Map([[antwort.id, antwort]]), resolve, nameUsage(facts))).toBe(
      1,
    );
  });
});
