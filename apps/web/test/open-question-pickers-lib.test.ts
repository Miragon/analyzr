/**
 * The pure side of answering by action (M6 §4.8 a, S5c-1,
 * `src/lib/open-question-pickers.ts`): what the pickers offer and leave
 * out, the sentence naming what an action writes (the proposals it accepts
 * by name), the toast after it, what „Rückgängig“ rejects and the refusals
 * in German.
 */
import type { OpenQuestionActionResult } from '@analyzr/client';
import { describe, expect, it } from 'vitest';

import {
  actionToast,
  catchesOnly,
  chooseCopyNote,
  decidedPlacements,
  endpointChoices,
  linkExclusions,
  linkPreview,
  processChoices,
  processSection,
  refusalText,
  subjectHints,
  subjectProcess,
  undoPlan,
  undoable,
  type ModelFacts,
} from '../src/lib/open-question-pickers';
import { buildRefIndex, resolverOf } from '../src/lib/refs';
import { fact, placement, relation } from './support/fixtures';

const facts: ModelFacts[] = [
  {
    modelKey: 'a/shop',
    processes: [{ ref: 'a/shop#P_Shop', processId: 'P_Shop', name: 'Shop', participantName: null }],
    facts: [
      fact({
        modelKey: 'a/shop',
        elementId: 'Catch_Paid',
        kind: 'msg_catch',
        eventDef: 'message',
        label: 'Bezahlt',
        processId: 'P_Shop',
        attrs: { elementType: 'bpmn:IntermediateCatchEvent' },
      }),
      fact({
        modelKey: 'a/shop',
        elementId: 'Sig_Done',
        kind: 'sig_throw',
        eventDef: 'signal',
        label: 'Fertig',
        processId: 'P_Shop',
        attrs: { elementType: 'bpmn:IntermediateThrowEvent' },
      }),
    ],
  },
  {
    modelKey: 'b/pay',
    processes: [
      { ref: 'b/pay#P_Pay', processId: 'P_Pay', name: null, participantName: 'Zahlung' },
      { ref: 'b/pay#P_Refund', processId: 'P_Refund', name: 'Erstattung', participantName: null },
    ],
    facts: [
      fact({
        modelKey: 'b/pay',
        elementId: 'Send_Paid',
        kind: 'msg_throw',
        eventDef: 'message',
        label: 'Bezahlt senden',
        processId: 'P_Pay',
        attrs: { elementType: 'bpmn:IntermediateThrowEvent' },
      }),
      fact({
        modelKey: 'b/pay',
        elementId: 'Sig_Catch',
        kind: 'sig_catch',
        eventDef: 'signal',
        label: 'Fertig?',
        processId: 'P_Refund',
        attrs: { elementType: 'bpmn:IntermediateCatchEvent' },
      }),
    ],
  },
];

const resolve = resolverOf(
  buildRefIndex(
    facts.flatMap((m) => m.facts),
    facts.flatMap((m) => m.processes.map((p) => ({ ...p, isExecutable: true }))),
  ),
);

describe('pickers', () => {
  it('lists processes as „Name – Modell“: the suggested first, the item’s own left out', () => {
    expect(
      processChoices(facts, { suggested: ['b/pay#P_Refund'], exclude: ['a/shop#P_Shop'] }).map(
        (c) => [c.ref, c.name, c.suggested],
      ),
    ).toEqual([
      ['b/pay#P_Refund', 'Erstattung', true],
      // the pool's name when the process has none
      ['b/pay#P_Pay', 'Zahlung', false],
    ]);
    expect(subjectProcess(facts, { type: 'ref', id: 'b/pay#Send_Paid' })).toBe('b/pay#P_Pay');
    expect(subjectProcess(facts, { type: 'process', id: 'b/pay#P_Pay' })).toBe('b/pay#P_Pay');
    expect(subjectProcess(facts, { type: 'step', id: 'x' })).toBeNull();
    // The server names the processes of a pool's anchors; else the subject's own is left out.
    const pool = { subject: { type: 'ref' as const, id: 'a/shop#Pool' } };
    expect(linkExclusions(facts, pool, { exclude: ['b/pay#P_Pay'] })).toEqual(['b/pay#P_Pay']);
    expect(linkExclusions(facts, { subject: { type: 'ref', id: 'b/pay#Send_Paid' } }, {})).toEqual([
      'b/pay#P_Pay',
    ]);
  });

  it('offers a caught message its throws in other processes and a thrown signal its catches, then whole processes', () => {
    expect(endpointChoices(facts, 'a/shop#Catch_Paid').map((c) => [c.ref, c.kind])).toEqual([
      ['b/pay#Send_Paid', 'endpoint'],
      ['b/pay#P_Refund', 'process'],
      ['b/pay#P_Pay', 'process'],
    ]);
    expect(endpointChoices(facts, 'a/shop#Sig_Done').map((c) => c.ref)[0]).toBe('b/pay#Sig_Catch');
    expect(catchesOnly(facts, 'a/shop#Catch_Paid')).toBe(true);
    expect(catchesOnly(facts, 'a/shop#Sig_Done')).toBe(false);
  });
});

describe('„Passt vermutlich“ (UX4)', () => {
  const named = (modelKey: string, processes: [string, string][]): ModelFacts => ({
    modelKey,
    processes: processes.map(([processId, name]) => ({
      ref: `${modelKey}#${processId}`,
      processId,
      name,
      participantName: null,
    })),
    facts: [],
  });
  const landscape = [
    named('finanzen/forderungsmanagement', [['Process_Forderung', 'Forderungsmanagement']]),
    named('finanzen/inkasso', [['Process_Inkasso', 'Inkasso']]),
    named('finanzen/ruecklastschrift', [['Process_RLS', 'Rücklastschrift']]),
    named('finanzen/gutschrift', [['Process_Gut', 'Gutschrift']]),
    named('vertrieb/auftrag', [['Process_Auftrag', 'Auftrag anlegen']]),
    named('einkauf/bestellung', [['Process_Best', 'Bestellung']]),
  ];
  const likely = (hints: string[], suggested: string[] = []) =>
    processChoices(landscape, {
      hints,
      suggested,
      exclude: ['finanzen/forderungsmanagement#Process_Forderung'],
    })
      .filter((c) => c.likely)
      .map((c) => c.name);

  it('ranks the best fits to the call’s label or its unresolved value after the suggested ones', () => {
    expect(likely(['Forderung an Inkasso übergeben'])).toEqual(['Inkasso']);
    expect(likely(['Process_Inkasso'])).toEqual(['Inkasso']);
    expect(likely(['RuecklastschriftEingegangen'])).toEqual(['Rücklastschrift']);
    expect(likely(['Gutschrift erstellen'])).toEqual(['Gutschrift']);
    // a suggested process stays under „Vorgeschlagen“, not twice
    expect(likely(['Inkasso'], ['finanzen/inkasso#Process_Inkasso'])).toEqual([]);
    // generic and technical words alone fit nothing
    expect(likely(['Daten senden', 'Process_1'])).toEqual([]);
    const all = processChoices(landscape, { hints: ['Forderung an Inkasso übergeben'] });
    expect(all.map((c) => [c.name, processSection(c)])).toEqual([
      ['Inkasso', 'Passt vermutlich'],
      ['Forderungsmanagement', 'Passt vermutlich'],
      // then the rest by name, not by model key
      ['Auftrag anlegen', 'Alle Prozesse'],
      ['Bestellung', 'Alle Prozesse'],
      ['Gutschrift', 'Alle Prozesse'],
      ['Rücklastschrift', 'Alle Prozesse'],
    ]);
  });

  it('reads the hints from the subject’s fact: its label, its value, its name', () => {
    const withCall: ModelFacts[] = [
      {
        modelKey: 'a',
        processes: [],
        facts: [
          fact({
            modelKey: 'a',
            elementId: 'Call_1',
            kind: 'call',
            label: 'Forderung an Inkasso übergeben',
            keyRaw: 'Process_Inkasso',
          }),
        ],
      },
    ];
    expect(
      subjectHints(withCall, { subject: { type: 'ref', id: 'a#Call_1' }, subjectLabel: '„x“' }),
    ).toEqual(['Forderung an Inkasso übergeben', 'Process_Inkasso']);
    expect(
      subjectHints(withCall, { subject: { type: 'ref', id: 'a#Gone' }, subjectLabel: '„Gone“' }),
    ).toEqual(['„Gone“']);
  });
});

describe('what an action writes', () => {
  it('names the pair, the direction towards an endpoint that only catches, and a pool’s flows', () => {
    const q = {
      kind: 'message-partner-missing' as const,
      subject: { type: 'ref' as const, id: 'a/shop#Catch_Paid' },
    };
    expect(linkPreview(q, {}, ['b/pay#Send_Paid'], resolve, true)).toEqual([
      'Legt eine angenommene Relation „Bezahlt senden“ → „Bezahlt“ an.',
    ]);
    const proposal = (target: string, from: string, to: string, n = 1) => ({
      target,
      relation: `rel_${String(n).padStart(26, '0')}`,
      type: 'message' as const,
      from,
      to,
    });
    expect(
      linkPreview(
        q,
        { proposals: [proposal('b/pay#Send_Paid', 'b/pay#Send_Paid', 'a/shop#Catch_Paid')] },
        ['b/pay#Send_Paid'],
        resolve,
        true,
      ),
    ).toEqual(['Nimmt den Vorschlag „Bezahlt senden“ → „Bezahlt“ an.']);
    // A process target names each proposal it accepts inside that process, by its ends.
    const external = {
      kind: 'external-partner' as const,
      subject: { type: 'ref' as const, id: 'a/shop#Sig_Done' },
    };
    expect(
      linkPreview(
        external,
        {
          proposals: [
            proposal('b/pay#P_Refund', 'a/shop#Sig_Done', 'b/pay#Sig_Catch'),
            proposal('b/pay#P_Pay', 'a/shop#Sig_Done', 'b/pay#Send_Paid', 2),
          ],
        },
        ['b/pay#P_Refund'],
        resolve,
        false,
      ),
    ).toEqual(['Nimmt den Vorschlag „Fertig“ → „Fertig?“ an.']);
    const box = {
      kind: 'black-box-partner' as const,
      subject: { type: 'ref' as const, id: 'a/shop#Pool' },
    };
    expect(linkPreview(box, {}, ['b/pay#P_Refund'], resolve, false)).toEqual([
      'Legt für jeden Nachrichtenfluss des Pools eine angenommene Relation mit „Erstattung“ an, in Richtung des Flusses.',
    ]);
    expect(
      linkPreview(
        box,
        {
          proposals: [
            proposal('b/pay#P_Refund', 'a/shop#Sig_Done', 'b/pay#Sig_Catch'),
            proposal('b/pay#P_Refund', 'a/shop#Catch_Paid', 'b/pay#Sig_Catch', 2),
          ],
        },
        ['b/pay#P_Refund'],
        resolve,
        false,
      ),
    ).toEqual([
      'Verknüpft jeden Nachrichtenfluss des Pools mit „Erstattung“: nimmt die Vorschläge „Fertig“ → „Fertig?“ und „Bezahlt“ → „Fertig?“ an und legt für jeden Fluss ohne Vorschlag eine angenommene Relation in Richtung des Flusses an.',
    ]);
    expect(chooseCopyNote(resolve, 'b/pay#P_Refund')).toBe(
      'Gültig ist „Erstattung“ in b/pay; die anderen Kopien sind veraltet oder Varianten.',
    );
  });

  it('undoes only what it wrote, and says what it did', () => {
    const manual = relation({
      id: 'rel_M',
      from: 'a/shop#Catch_Paid',
      to: 'b/pay#Send_Paid',
      type: 'manual',
      status: 'accepted',
      version: 1,
    });
    const decided = relation({
      id: 'rel_D',
      from: 'a/shop#Catch_Paid',
      to: 'b/pay#P_Pay',
      type: 'call',
      status: 'accepted',
      version: 4,
    });
    const result: OpenQuestionActionResult = {
      result: 'applied',
      question: null,
      relations: [
        { effect: 'manual', relation: manual },
        { effect: 'decision', relation: decided },
      ],
      placements: [],
      answer: null,
      warnings: [],
    };
    expect(undoPlan(result)).toEqual({ relations: [{ id: 'rel_M', version: 1 }], placements: [] });
    expect(
      undoable(
        undoPlan({ relations: [{ effect: 'decision', relation: decided }], placements: [] }),
      ),
    ).toBe(false);
    expect(actionToast('link', result, resolve)).toEqual({
      tone: 'success',
      title: 'Verknüpft',
      description:
        'Angenommene Relation „Bezahlt“ → „Bezahlt senden“ angelegt. Vorschlag „Bezahlt“ → „Zahlung“ angenommen.',
    });
    expect(actionToast('link', { ...result, relations: [] }, resolve).title).toBe(
      'Schon verknüpft',
    );
    expect(actionToast('place', { ...result, relations: [] }, resolve).title).toBe(
      'War schon platziert',
    );
    expect(
      actionToast(
        'place',
        {
          ...result,
          relations: [],
          placements: [
            {
              effect: 'manual',
              placement: placement({
                id: 'plc_1',
                elementId: '@outside',
                process: 'b/pay#P_Pay',
                processName: 'Zahlung',
              }),
            },
          ],
        },
        resolve,
      ).description,
    ).toBe('„Zahlung“ → „Außerhalb der Kette“.');
    // A placement that decided an agent's proposal on the step: no undo, the way to the chain.
    const decidedPlacement = {
      ...result,
      relations: [],
      placements: [
        {
          effect: 'decision' as const,
          placement: placement({
            id: 'plc_2',
            elementId: 'step-a',
            stepName: 'Vertrieb',
            process: 'b/pay#P_Pay',
            processName: 'Zahlung',
          }),
        },
      ],
    };
    expect(undoable(undoPlan(decidedPlacement))).toBe(false);
    expect(decidedPlacements(decidedPlacement)).toEqual(['plc_2']);
    expect(actionToast('place', decidedPlacement, resolve).description).toBe(
      '„Zahlung“ → „Vertrieb“. Damit ist der Vorschlag auf diesem Schritt angenommen; ändern kannst du das in der Wertschöpfungskette.',
    );
    expect(actionToast('outside', { ...result, result: 'unchanged' }, resolve).title).toBe(
      'Schon als außerhalb markiert',
    );
  });

  it('says a refusal in German where the server gives its reason', () => {
    expect(
      refusalText('same-process', 'b/pay#P_Pay lies in the process of b/pay#Send_Paid', resolve),
    ).toBe(
      '„Zahlung“ liegt im selben Prozess wie „Bezahlt senden“; eine Relation verbindet zwei Prozesse.',
    );
    expect(refusalText('unknown-step', 'x is not a step of the value chain', resolve)).toBeNull();
  });
});
