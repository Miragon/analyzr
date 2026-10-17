/**
 * Model amendments (M6 §4.8 c, S5c-2), the pure parts: the plan of live
 * amendments against an uploaded revision (`planAmendments`), the
 * concurrency token, which fields an amendment can set and with which value
 * (`resolveField`, `amendability`, `checkItem`), the conflict questions and
 * their actions, the would-be effect, and the change list.
 */
import { readAmendable, extractFacts } from '@analyzr/bpmn-facts';
import {
  OpenQuestion,
  type AmendmentPlanEntry,
  type ModelAmendment,
  type ModelAmendmentId,
  type Ref,
} from '@analyzr/contracts';
import { runRules } from '@analyzr/relations';
import { describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { amendmentEffect } from '../../src/domain/amendments/effect.ts';
import {
  changeListFilename,
  renderChangeListCsv,
  renderChangeListMarkdown,
  type ChangeListEntry,
} from '../../src/domain/amendments/export.ts';
import {
  ReplacesMismatch,
  amendability,
  checkItem,
  fieldKey,
  resolveField,
  suggestionsFor,
  type AmendContext,
} from '../../src/domain/amendments/fields.ts';
import {
  amendmentToken,
  liveAmendments,
  planAmendments,
  planCounts,
  type LiveAmendment,
} from '../../src/domain/amendments/plan.ts';
import { buildOpenQuestions } from '../../src/domain/open-questions/read-model.ts';
import type {
  AmendableDocument,
  RelationRecord,
  StoredModelAmendment,
} from '../../src/domain/ports.ts';
import {
  AUFTRAG_KEY,
  LAGER_KEY,
  RECHNUNG_KEY,
  VERSAND_KEY,
  auftrag,
  lager,
  rechnung,
  versand,
} from '../support/amend-fixtures.ts';
import { AT, PROJECT, libraryInput, relationId } from '../support/open-questions.ts';

const amendmentId = (n: number): ModelAmendmentId => `mam_${String(n).padStart(26, '0')}`;

function live(n: number, over: Partial<LiveAmendment> = {}): LiveAmendment {
  return {
    id: amendmentId(n),
    elementId: 'Call_Rechnung',
    viaElementId: null,
    op: 'call-target',
    before: '',
    after: 'Process_Rechnung',
    seq: n,
    ...over,
  };
}

type Field = AmendableDocument['fields'][number];

function doc(fields: Partial<Field>[]): AmendableDocument {
  return {
    engine: 'c7',
    endpoints: [],
    fields: fields.map((f) => ({
      elementId: 'Call_Rechnung',
      op: 'call-target',
      element: 'call',
      processId: 'Process_Auftrag',
      value: '',
      expression: false,
      blocked: null,
      ...f,
    })),
  };
}

describe('planAmendments', () => {
  it('plans each live amendment against the uploaded revision (M6 §4.8 c "Re-import")', () => {
    const cases: [Partial<Field>[], LiveAmendment, Partial<AmendmentPlanEntry>][] = [
      // The element is gone, or no longer of the op's kind.
      [[], live(1), { outcome: 'conflict', reason: 'element-missing' }],
      [
        [{ op: 'event-name', element: 'start-event' }],
        live(1),
        { outcome: 'conflict', reason: 'element-missing' },
      ],
      // The tool now writes an expression.
      [
        [{ value: '=ziel', expression: true }],
        live(1),
        { outcome: 'conflict', reason: 'expression' },
      ],
      // Taken over by the tool, the value it had before, any other value.
      [[{ value: 'Process_Rechnung' }], live(1), { outcome: 'in-source' }],
      [[{ value: '' }], live(1), { outcome: 'applied' }],
      [[{ value: 'Process_Andere' }], live(1), { outcome: 'conflict', reason: 'value-changed' }],
      // A field the library can no longer write.
      [
        [{ blocked: { reason: 'unsupported-structure', message: 'x' } }],
        live(1),
        { outcome: 'conflict', reason: 'element-missing' },
      ],
      // Names: no name and the empty name are the same.
      [
        [{ op: 'event-name', element: 'start-event', elementId: 'Start', value: null }],
        live(1, { op: 'event-name', elementId: 'Start', before: null, after: 'Los' }),
        { outcome: 'applied' },
      ],
      // Documentation never conflicts: the tool's text always wins.
      [
        [
          {
            op: 'process-documentation',
            element: 'process',
            elementId: 'P',
            value: 'Anders',
            blocked: { reason: 'has-documentation', message: 'x' },
          },
        ],
        live(1, { op: 'process-documentation', elementId: 'P', before: null, after: 'Doku' }),
        { outcome: 'in-source' },
      ],
      [
        [{ op: 'process-documentation', element: 'process', elementId: 'P', value: null }],
        live(1, { op: 'process-documentation', elementId: 'P', before: null, after: 'Doku' }),
        { outcome: 'applied' },
      ],
    ];
    for (const [fields, amendment, expected] of cases) {
      const [entry] = planAmendments([amendment], doc(fields));
      expect(entry, JSON.stringify(fields)).toEqual({
        id: amendment.id,
        elementId: amendment.elementId,
        op: amendment.op,
        ...expected,
      });
    }
  });

  it('compares a name keyed by an endpoint that now references a message', () => {
    const amendment = live(1, {
      op: 'message-name',
      elementId: 'Event_X',
      before: null,
      after: 'Bestätigt',
    });
    const withEndpoint = (name: string | null, expression = false): AmendableDocument => ({
      engine: 'c7',
      fields: [],
      endpoints: [
        {
          elementId: 'Event_X',
          kind: 'msg_throw',
          processId: 'P',
          reference: 'Message_X',
          name,
          expression,
          amendmentElementId: 'Message_X',
        },
      ],
    });
    const outcome = (d: AmendableDocument) => planAmendments([amendment], d)[0];
    expect(outcome(withEndpoint('Bestätigt'))).toMatchObject({ outcome: 'in-source' });
    expect(outcome(withEndpoint('Anders'))).toMatchObject({
      outcome: 'conflict',
      reason: 'value-changed',
    });
    expect(outcome(withEndpoint(null))).toMatchObject({
      outcome: 'conflict',
      reason: 'element-missing',
    });
    expect(outcome(withEndpoint('${x}', true))).toMatchObject({
      outcome: 'conflict',
      reason: 'expression',
    });
  });

  it('counts a plan for the results, at most 20 ids per outcome', () => {
    const plan: AmendmentPlanEntry[] = Array.from({ length: 25 }, (_, i) => ({
      id: amendmentId(i),
      elementId: `E${i}`,
      op: 'event-name',
      outcome: i < 22 ? 'applied' : 'conflict',
      ...(i < 22 ? {} : { reason: 'value-changed' as const }),
    }));
    const counts = planCounts(plan);
    expect(counts.applied.count).toBe(22);
    expect(counts.applied.ids).toHaveLength(20);
    expect(counts.conflicts).toEqual({
      count: 3,
      ids: [amendmentId(22), amendmentId(23), amendmentId(24)],
    });
    expect(counts.inSource).toEqual({ count: 0, ids: [] });
  });

  it('changes the concurrency token with every amendment and withdrawal', () => {
    const stored = (n: number, withdrawn: number | null = null): StoredModelAmendment => ({
      ...live(n),
      projectId: PROJECT,
      modelId: 'mdl_00000000000000000000000001',
      baseRevisionId: 'rev_00000000000000000000000001',
      supersedesId: null,
      principalId: 'prn_00000000000000000000000001',
      clientId: 'analyzr-web',
      sourceKind: 'human',
      modelKey: AUFTRAG_KEY,
      modelDeletedSeq: null,
      handle: 'owner',
      createdAt: AT,
      withdrawal:
        withdrawn === null
          ? null
          : {
              reason: 'withdrawn',
              seq: withdrawn,
              principalId: 'prn_00000000000000000000000001',
              handle: 'owner',
              createdAt: AT,
            },
    });
    const one = amendmentToken([stored(5)]);
    expect(amendmentToken([stored(5), stored(7)])).not.toBe(one);
    expect(amendmentToken([stored(5, 9)])).not.toBe(one);
    expect(amendmentToken([stored(5)])).toBe(one);
    // Live amendments in seq order, without the withdrawn ones.
    expect(liveAmendments([stored(7), stored(5), stored(6, 8)]).map((a) => a.seq)).toEqual([5, 7]);
  });
});

/** The checks' context over the fixtures, the head equal to the uploaded revision. */
async function context(over: Partial<AmendContext> = {}): Promise<AmendContext> {
  const files = [
    { key: AUFTRAG_KEY, bytes: auftrag() },
    { key: RECHNUNG_KEY, bytes: rechnung() },
    { key: LAGER_KEY, bytes: lager() },
    { key: VERSAND_KEY, bytes: versand() },
  ];
  const input = await libraryInput(files);
  const uploaded = await readAmendable(auftrag(), { modelKey: AUFTRAG_KEY });
  return {
    modelKey: AUFTRAG_KEY,
    uploaded,
    head: uploaded,
    projectFacts: input.projectFacts,
    findings: runRules(input.projectFacts).findings,
    live: [],
    applied: new Set(),
    named: new Set(),
    modelNames: new Map([...input.models].map(([k, m]) => [k, m.name])),
    ...over,
  };
}

const normalize = libraryAnalysis.normalizeAmendmentValue.bind(libraryAnalysis);

describe('the fields an amendment can set', () => {
  it('keys an endpoint by the message it references, and offers the landscape’s names', async () => {
    const ctx = await context();
    const r = resolveField(ctx, 'Task_Zahlung', 'message-name');
    expect(r).toMatchObject({
      ok: true,
      field: {
        key: 'Message_Zahlung',
        via: 'Task_Zahlung',
        element: 'message',
        value: 'Zahlung eingegangen',
        readers: ['Task_Mahnung', 'Task_Zahlung'],
        signal: false,
      },
    });
    const nameless = resolveField(ctx, 'Event_Bestaetigung', 'message-name');
    if (!nameless.ok) throw new Error('the nameless throw resolves');
    expect(nameless.field).toMatchObject({ key: 'Event_Bestaetigung', via: null, value: null });
    // The callee's catch names „Auftrag bestätigt“: a partner of the throw.
    expect(suggestionsFor(ctx, nameless.field).names).toEqual([
      {
        name: 'Auftrag bestätigt',
        endpoints: [
          {
            ref: `${RECHNUNG_KEY}#Task_Bestaetigung`,
            kind: 'msg_catch',
            name: 'Bestätigung empfangen',
            processName: 'Rechnungsstellung',
            modelKey: RECHNUNG_KEY,
            partner: true,
          },
        ],
      },
    ]);
    expect(resolveField(ctx, 'Task_Pruefen', 'call-target')).toMatchObject({
      ok: false,
      reason: 'wrong-element',
    });
    expect(resolveField(ctx, 'Nirgends', 'call-target')).toMatchObject({
      ok: false,
      reason: 'element-missing',
    });
  });

  it('allows a field only where a question names it, it is empty or unresolved, or a live amendment set it', async () => {
    const ctx = await context();
    const field = (id: string, op: Parameters<typeof resolveField>[2]) => {
      const r = resolveField(ctx, id, op);
      if (!r.ok) throw new Error(`${id} resolves`);
      return r.field;
    };
    // Empty or unresolved: allowed.
    expect(amendability(ctx, field('Call_Rechnung', 'call-target'))).toBeNull();
    expect(amendability(ctx, field('Call_Versand', 'call-target'))).toBeNull();
    expect(amendability(ctx, field('Start_Auftrag', 'event-name'))).toBeNull();
    // Message_Zahlung's readers pair with nothing (unmatched catches).
    expect(amendability(ctx, field('Task_Zahlung', 'message-name'))).toBeNull();
    // A labelled end event: only where a question names it or a live amendment set it.
    const end = field('End_Auftrag', 'event-name');
    expect(amendability(ctx, end)).toEqual({
      reason: 'only-open-questions',
      message: expect.any(String) as unknown,
    });
    expect(
      amendability({ ...ctx, named: new Set([fieldKey('event-name', 'End_Auftrag')]) }, end),
    ).toBeNull();
    const setByAnalyzr = live(1, {
      op: 'event-name',
      elementId: 'End_Auftrag',
      before: 'Auftrag erledigt',
      after: 'Erledigt',
    });
    expect(
      amendability({ ...ctx, live: [setByAnalyzr], applied: new Set([setByAnalyzr.id]) }, end),
    ).toBeNull();
    // A live amendment the head does not apply (a conflict, carried over) set nothing.
    expect(amendability({ ...ctx, live: [setByAnalyzr] }, end)).toMatchObject({
      reason: 'only-open-questions',
    });
    // The tool's documentation is never replaced.
    expect(amendability(ctx, field('Process_Auftrag', 'process-documentation'))).toMatchObject({
      reason: 'has-documentation',
    });
  });

  it('checks a request item: the target, the value, the partner, the live amendment', async () => {
    const ctx = await context();
    const check = (item: Parameters<typeof checkItem>[1], c = ctx) => checkItem(c, item, normalize);
    expect(
      check({
        elementId: 'Call_Rechnung',
        op: 'call-target',
        target: `${RECHNUNG_KEY}#Process_Rechnung` as Ref,
      }),
    ).toMatchObject({
      outcome: 'candidate',
      after: 'Process_Rechnung',
      before: '',
      partner: null,
      supersedes: null,
    });
    expect(
      check({
        elementId: 'Call_Rechnung',
        op: 'call-target',
        target: `${RECHNUNG_KEY}#Task_Buchen` as Ref,
      }),
    ).toMatchObject({ outcome: 'not-applicable', reason: 'not-a-process' });
    expect(
      check({
        elementId: 'Call_Rechnung',
        op: 'call-target',
        target: `${AUFTRAG_KEY}#Process_Auftrag` as Ref,
      }),
    ).toMatchObject({ outcome: 'not-applicable', reason: 'same-process' });
    expect(
      check({ elementId: 'Call_Rechnung', op: 'call-target', target: 'x/y#Nirgends' }),
    ).toMatchObject({ outcome: 'not-applicable', reason: 'unknown-ref' });
    expect(check({ elementId: 'Call_Rechnung', op: 'call-target', after: '=ziel' })).toMatchObject({
      outcome: 'not-applicable',
      reason: 'invalid-value',
      message: 'the value is expression',
    });
    expect(
      check({ elementId: 'Start_Auftrag', op: 'event-name', after: 'x'.repeat(201) }),
    ).toMatchObject({
      outcome: 'not-applicable',
      reason: 'invalid-value',
      message: 'the value is too-long',
    });
    expect(
      check({
        elementId: 'Start_Auftrag',
        op: 'event-name',
        target: `${RECHNUNG_KEY}#Process_Rechnung` as Ref,
      }),
    ).toMatchObject({
      reason: 'not-a-call-target',
    });
    // The value the uploaded revision has already.
    expect(
      check({ elementId: 'Task_Zahlung', op: 'message-name', after: 'Zahlung eingegangen' }),
    ).toMatchObject({
      outcome: 'not-applicable',
      reason: 'in-source',
    });
    // A partner that is no message endpoint.
    expect(
      check({
        elementId: 'Event_Bestaetigung',
        op: 'message-name',
        after: 'Auftrag bestätigt',
        partner: `${RECHNUNG_KEY}#Start_Rechnung` as Ref,
      }),
    ).toMatchObject({ outcome: 'not-applicable', reason: 'partner-not-paired' });
    // Identical to the live amendment: unchanged; `replaces` must name it.
    const withLive = { ...ctx, live: [live(1)] };
    expect(
      check({ elementId: 'Call_Rechnung', op: 'call-target', after: 'Process_Rechnung' }, withLive),
    ).toMatchObject({
      outcome: 'unchanged',
    });
    expect(
      check({ elementId: 'Call_Rechnung', op: 'call-target', after: 'Process_Versand' }, withLive),
    ).toMatchObject({
      outcome: 'candidate',
      supersedes: { id: amendmentId(1) },
    });
    expect(() =>
      check(
        {
          elementId: 'Call_Rechnung',
          op: 'call-target',
          after: 'Process_Versand',
          replaces: amendmentId(2),
        },
        withLive,
      ),
    ).toThrow(ReplacesMismatch);
  });

  it('computes the effect: the finding resolved, the call accepted, the manual link retired, accepted relations changed', async () => {
    const ctx = await context();
    const amended = await extractFacts(auftrag({ callRechnung: 'Process_Rechnung' }), {
      modelKey: AUFTRAG_KEY,
    });
    const manual: RelationRecord = {
      id: relationId(900),
      projectId: PROJECT,
      type: 'manual',
      fromRef: `${AUFTRAG_KEY}#Call_Rechnung`,
      toRef: `${RECHNUNG_KEY}#Process_Rechnung`,
      status: 'accepted',
      endpointState: 'ok',
      tier: 'manual',
      confidence: null,
      version: 1,
      attrs: {},
      fromFp: 'old',
      toFp: 'old',
      createdAt: AT,
      updatedAt: AT,
    };
    const other: RelationRecord = {
      ...manual,
      id: relationId(901),
      toRef: `${VERSAND_KEY}#Process_Versand`,
    };
    const { effect } = amendmentEffect({
      modelKey: AUFTRAG_KEY,
      projectFacts: ctx.projectFacts,
      amended,
      relations: [manual, other],
      runRules,
      candidates: [
        {
          op: 'call-target',
          key: 'Call_Rechnung',
          endpoints: [],
          call: 'Call_Rechnung',
          partner: null,
        },
      ],
    });
    expect(effect.findingsResolved.map((f) => [f.kind, f.refs])).toEqual([
      ['unresolved-call', [`${AUFTRAG_KEY}#Call_Rechnung`]],
    ]);
    expect(effect.accepted).toEqual([
      {
        relation: null,
        type: 'call',
        from: `${AUFTRAG_KEY}#Call_Rechnung`,
        to: `${RECHNUNG_KEY}#Process_Rechnung`,
      },
    ]);
    expect(effect.retired.map((r) => r.relation)).toEqual([manual.id]);
    expect(effect.changed.map((r) => r.relation)).toEqual([other.id]);
    expect(effect.findingsAdded).toEqual([]);
  });
});

describe('conflicts of amendments as open questions', () => {
  it('asks per conflict, with the incoming value, and offers the actions of its reason', async () => {
    const input = await libraryInput([
      {
        key: AUFTRAG_KEY,
        bytes: auftrag({
          callRechnung: 'Process_Andere',
          startName: 'Neu',
          withoutBestaetigung: true,
        }),
      },
      { key: RECHNUNG_KEY, bytes: rechnung() },
    ]);
    const amendments = [
      {
        id: amendmentId(1),
        elementId: 'Call_Rechnung',
        viaElementId: null,
        op: 'call-target' as const,
        before: '',
        after: 'Process_Rechnung',
      },
      {
        id: amendmentId(2),
        elementId: 'Event_Bestaetigung',
        viaElementId: null,
        op: 'message-name' as const,
        before: null,
        after: 'Auftrag bestätigt',
      },
      {
        id: amendmentId(3),
        elementId: 'Message_Zahlung',
        viaElementId: 'Task_Zahlung',
        op: 'message-name' as const,
        before: 'Zahlung eingegangen',
        after: 'Zahlung erhalten',
      },
      {
        id: amendmentId(5),
        elementId: 'Start_Auftrag',
        viaElementId: null,
        op: 'event-name' as const,
        before: null,
        after: 'Auftrag eingegangen',
      },
    ];
    const { items } = buildOpenQuestions({
      ...input,
      amendments: new Map([
        [
          AUFTRAG_KEY,
          {
            uploadedRevisionId: 'rev_00000000000000000000000009',
            plan: [
              {
                id: amendmentId(1),
                elementId: 'Call_Rechnung',
                op: 'call-target',
                outcome: 'conflict',
                reason: 'value-changed',
              },
              {
                id: amendmentId(2),
                elementId: 'Event_Bestaetigung',
                op: 'message-name',
                outcome: 'conflict',
                reason: 'element-missing',
              },
              {
                id: amendmentId(3),
                elementId: 'Message_Zahlung',
                op: 'message-name',
                outcome: 'conflict',
                reason: 'expression',
              },
              {
                id: amendmentId(5),
                elementId: 'Start_Auftrag',
                op: 'event-name',
                outcome: 'conflict',
                reason: 'value-changed',
              },
            ],
            live: amendments,
          },
        ],
      ]),
    });
    for (const q of items) expect(OpenQuestion.parse(q)).toEqual(q);
    const conflicts = items.filter((q) => q.kind === 'amendment-conflict');
    expect(conflicts.map((q) => q.subject.id).sort()).toEqual(
      [
        `${AUFTRAG_KEY}#Call_Rechnung`,
        `${AUFTRAG_KEY}#Event_Bestaetigung`,
        `${AUFTRAG_KEY}#Message_Zahlung`,
        `${AUFTRAG_KEY}#Start_Auftrag`,
      ].sort(),
    );
    const byElement = (id: string) => {
      const q = conflicts.find((x) => x.subject.id === `${AUFTRAG_KEY}#${id}`);
      if (!q) throw new Error(id);
      return q;
    };
    const call = byElement('Call_Rechnung');
    expect(call).toMatchObject({
      source: 'amendment',
      raisedBy: { sourceKind: 'rule', handle: null },
    });
    expect(call.text).toBe(
      'Welches Aufrufziel gilt für die Aufrufaktivität „Rechnung stellen“ in „Auftragsabwicklung“? ' +
        'Das Quellsystem hat den Wert seit der Ergänzung geändert, deshalb überschreibt analyzr ihn ' +
        'nicht. Jetzt im Quellsystem: „Process_Andere“, in analyzr ergänzt: „Process_Rechnung“; ' +
        'vorher: (leer).',
    );
    expect(call.actions).toEqual([
      {
        type: 'withdraw-amendment',
        primary: true,
        label: 'Wert aus dem Quellsystem übernehmen',
        withdraw: {
          modelId: input.models.get(AUFTRAG_KEY)?.modelId,
          modelKey: AUFTRAG_KEY,
          amendment: amendmentId(1),
          // Both values side by side for the tab.
          compare: {
            field: 'Aufrufziel',
            incoming: 'Process_Andere',
            after: 'Process_Rechnung',
            before: '',
          },
        },
      },
      {
        type: 'amend',
        primary: false,
        label: 'Meine Ergänzung behalten',
        amend: {
          modelId: input.models.get(AUFTRAG_KEY)?.modelId,
          modelKey: AUFTRAG_KEY,
          targets: [
            {
              elementId: 'Call_Rechnung',
              op: 'call-target',
              label: 'Aufrufaktivität „Rechnung stellen“',
              prefill: 'Process_Rechnung',
            },
          ],
          replaces: amendmentId(1),
        },
      },
      { type: 'note', primary: false, label: 'Notiz hinzufügen' },
    ]);
    expect(
      byElement('Event_Bestaetigung').actions.map((a) => [
        a.type,
        a.label,
        a.withdraw?.amendment ?? null,
      ]),
    ).toEqual([
      ['withdraw-amendment', 'Ergänzung zurücknehmen', amendmentId(2)],
      ['withdraw-amendment', 'Alle Ergänzungen dieses Modells zurücknehmen', null],
      ['note', 'Notiz hinzufügen', null],
    ]);
    expect(byElement('Message_Zahlung').actions.map((a) => a.label)).toEqual([
      'Ergänzung zurücknehmen',
      'Notiz hinzufügen',
    ]);
    // A start name the tool set is a label: analyzr never writes over it (§4.8 c), so the
    // conflict only takes the tool's value.
    const start = byElement('Start_Auftrag');
    expect(start.text).toBe(
      'Welcher Name gilt für das Startereignis „Neu“ in „Auftragsabwicklung“? Das Quellsystem ' +
        'hat den Wert seit der Ergänzung geändert, deshalb überschreibt analyzr ihn nicht. Jetzt ' +
        'im Quellsystem: „Neu“, in analyzr ergänzt: „Auftrag eingegangen“; vorher: (leer).',
    );
    expect(start.actions.map((a) => a.label)).toEqual([
      'Wert aus dem Quellsystem übernehmen',
      'Notiz hinzufügen',
    ]);
    // The id follows the uploaded revision: a new import asks again.
    const again = buildOpenQuestions({
      ...input,
      amendments: new Map([
        [
          AUFTRAG_KEY,
          {
            uploadedRevisionId: 'rev_00000000000000000000000010',
            plan: [
              {
                id: amendmentId(1),
                elementId: 'Call_Rechnung',
                op: 'call-target',
                outcome: 'conflict',
                reason: 'value-changed',
              },
            ],
            live: amendments,
          },
        ],
      ]),
    }).items.find((q) => q.kind === 'amendment-conflict');
    expect(again?.id).not.toBe(call.id);
  });

  it('offers no „Meine Ergänzung behalten“ over a call target the tool pointed at a process', async () => {
    const input = await libraryInput([
      { key: AUFTRAG_KEY, bytes: auftrag({ callRechnung: 'Process_Versand' }) },
      { key: RECHNUNG_KEY, bytes: rechnung() },
      { key: VERSAND_KEY, bytes: versand() },
    ]);
    const { items } = buildOpenQuestions({
      ...input,
      amendments: new Map([
        [
          AUFTRAG_KEY,
          {
            uploadedRevisionId: 'rev_00000000000000000000000009',
            plan: [
              {
                id: amendmentId(6),
                elementId: 'Call_Rechnung',
                op: 'call-target',
                outcome: 'conflict',
                reason: 'value-changed',
              },
            ],
            live: [
              {
                id: amendmentId(6),
                elementId: 'Call_Rechnung',
                viaElementId: null,
                op: 'call-target',
                before: '',
                after: 'Process_Rechnung',
              },
            ],
          },
        ],
      ]),
    });
    const conflict = items.find((q) => q.kind === 'amendment-conflict');
    expect(conflict?.actions.map((a) => a.label)).toEqual([
      'Wert aus dem Quellsystem übernehmen',
      'Notiz hinzufügen',
    ]);
  });

  it('replaces a live amendment from an amend at its element, hinting „in analyzr ergänzt“', async () => {
    const input = await libraryInput([
      { key: AUFTRAG_KEY, bytes: auftrag({ callRechnung: 'Process_Fehlt' }) },
      { key: RECHNUNG_KEY, bytes: rechnung() },
    ]);
    const { items } = buildOpenQuestions({
      ...input,
      amendments: new Map([
        [
          AUFTRAG_KEY,
          {
            uploadedRevisionId: 'rev_00000000000000000000000009',
            plan: [
              {
                id: amendmentId(4),
                elementId: 'Call_Rechnung',
                op: 'call-target',
                outcome: 'applied',
              },
            ],
            live: [
              {
                id: amendmentId(4),
                elementId: 'Call_Rechnung',
                viaElementId: null,
                op: 'call-target',
                before: '',
                after: 'Process_Fehlt',
              },
            ],
          },
        ],
      ]),
    });
    const call = items.find(
      (q) => q.kind === 'call-target-unknown' && q.subject.id === `${AUFTRAG_KEY}#Call_Rechnung`,
    );
    const amend = call?.actions.find((a) => a.type === 'amend');
    expect(amend).toMatchObject({
      label: 'Aufrufziel im Modell ändern …',
      hint: 'in analyzr ergänzt',
      amend: { replaces: amendmentId(4) },
    });
  });
});

describe('the change list', () => {
  const amendment = (n: number, over: Partial<ModelAmendment>): ModelAmendment => ({
    id: amendmentId(n),
    modelId: 'mdl_00000000000000000000000001',
    modelKey: AUFTRAG_KEY,
    elementId: 'Call_Rechnung',
    viaElementId: null,
    op: 'call-target',
    before: '',
    after: 'Process_Rechnung',
    baseRevisionId: 'rev_00000000000000000000000001',
    supersedesId: null,
    by: 'owner',
    sourceKind: 'human',
    seq: 10 + n,
    at: '2026-10-17T10:00:00.000Z',
    state: 'applied',
    conflict: null,
    modelDeleted: false,
    withdrawal: null,
    ...over,
  });
  const entries: ChangeListEntry[] = [
    {
      amendment: amendment(1, {}),
      modelName: 'Auftragsabwicklung',
      place: 'Prozess „Auftragsabwicklung“',
      lanes: ['Buchhaltung'],
      element: 'Aufrufaktivität „Rechnung stellen“',
      field: 'Aufrufziel',
      targets: {
        before: null,
        after: {
          processId: 'Process_Rechnung',
          process: { name: 'Rechnungsstellung', modelKey: RECHNUNG_KEY, modelName: 'Rechnung' },
        },
      },
      readers: [],
    },
    {
      amendment: amendment(2, {
        op: 'message-name',
        elementId: 'Message_Zahlung',
        viaElementId: 'Task_Zahlung',
        before: 'Zahlung eingegangen',
        after: '=Zahlung',
        state: 'conflict',
        conflict: 'value-changed',
      }),
      modelName: 'Auftragsabwicklung',
      place: 'Prozess „Auftragsabwicklung“',
      lanes: [],
      element: 'Empfangsaufgabe „Zahlung abwarten“',
      field: 'Nachrichten- oder Signalname',
      readers: ['Empfangsaufgabe „Mahnung abwarten“', 'Empfangsaufgabe „Zahlung abwarten“'],
    },
    {
      amendment: amendment(3, {
        modelKey: LAGER_KEY,
        op: 'call-target',
        after: 'Process_Weg',
        state: 'withdrawn',
        modelDeleted: true,
        withdrawal: { reason: 'withdrawn', by: 'owner', seq: 20, at: '2026-10-17T11:00:00.000Z' },
      }),
      modelName: null,
      place: null,
      lanes: [],
      element: 'Aufrufaktivität „X“',
      field: 'Aufrufziel',
      targets: { before: null, after: { processId: 'Process_Weg', process: null } },
      readers: [],
    },
  ];
  const header = { projectName: 'Projekt', projectKey: 'p', seq: 42, filter: {}, since: undefined };

  it('renders Markdown per model with the target, the readers, who, when and the state', () => {
    const md = renderChangeListMarkdown(entries, header);
    expect(md).toContain('# Änderungsliste: Projekt');
    expect(md).toContain('Projekt `p`, Stand: Ereignis 42. 3 Ergänzungen aus analyzr');
    expect(md.indexOf('## `lager/einlagerung` – Modell gelöscht')).toBeLessThan(
      md.indexOf('## Auftragsabwicklung (`vertrieb/auftrag`)'),
    );
    expect(md).toContain('- Ort: Prozess „Auftragsabwicklung“, Lane „Buchhaltung“');
    expect(md).toContain(
      '- Nachher: Prozess „Rechnungsstellung“ im Modell „Rechnung“ (Pfad finanzen/rechnung, ID Process_Rechnung)',
    );
    expect(md).toContain('- Nachher: „Process_Weg“ (Ziel nicht mehr in der Landschaft)');
    expect(md).toContain(
      '- Gilt für: Empfangsaufgabe „Mahnung abwarten“; Empfangsaufgabe „Zahlung abwarten“',
    );
    expect(md).toContain('- Von: owner, am 2026-10-17 (Ereignis 11)');
    expect(md).toContain('- Stand: Konflikt (Wert im Quellsystem geändert)');
    expect(md).toContain('- Stand: zurückgenommen von owner (Ereignis 20), Modell gelöscht');
    // Per model: what is still to carry over, then what is done.
    expect(md).toContain('### Zu übertragen (2)\n\n#### 2. Aufrufaktivität „Rechnung stellen“');
    expect(md).toContain(
      '### Erledigt (1)\n\nIm Quellsystem übernommen, zurückgenommen oder ersetzt; dort ist nichts mehr zu tun.\n\n#### 1. Aufrufaktivität „X“',
    );
    expect(renderChangeListMarkdown([], { ...header, since: 40 })).toContain(
      'Filter: neu seit Ereignis 40.',
    );
  });

  it('renders CSV with a byte order mark, quoted and formula-safe cells', () => {
    const csv = renderChangeListCsv(entries);
    expect(
      csv.startsWith(
        '﻿"Modell";"Modellschlüssel";"Ort";"Element";"Feld";"Vorher";"Nachher";"Ziel";"Gilt für";"Von";"Am";"Ereignis";"Stand";"Zu übertragen";"Kennung"\r\n',
      ),
    ).toBe(true);
    const rows = csv.split('\r\n').filter((l) => l !== '');
    expect(rows).toHaveLength(4);
    // Raw values (an empty cell for none), no German quotes: a cell copies into the source tool.
    // `=Zahlung` is protected as a value, not a formula.
    expect(rows[3]).toContain(
      `"Zahlung eingegangen";"'=Zahlung";"";"Empfangsaufgabe „Mahnung abwarten“; Empfangsaufgabe „Zahlung abwarten“"`,
    );
    expect(rows[2]).toContain(
      `"";"Process_Rechnung";"Prozess „Rechnungsstellung“ im Modell „Rechnung“ (Pfad finanzen/rechnung, ID Process_Rechnung)"`,
    );
    // lager/einlagerung (withdrawn) first, then vertrieb/auftrag (applied, conflict).
    expect(rows.map((r) => r.split(';').at(-2))).toEqual([
      '"Zu übertragen"',
      '"nein"',
      '"ja"',
      '"ja"',
    ]);
    expect(
      changeListFilename('p', { modelKey: 'vertrieb/auftrag', state: 'applied' }, 12, 'csv'),
    ).toBe('ergaenzungen-p-vertrieb-auftrag-applied-seit-12.csv');
    expect(changeListFilename('p', {}, undefined, 'markdown')).toBe('ergaenzungen-p.md');
  });
});
