/**
 * Answering by action (M6 §4.8 a, S5c-1), the pure part: the actions of
 * every kind of the contracts with their single primary (`actionsFor`), the
 * read model's rules R1 (by the direction a link takes, never a call for a
 * pool) and R1b, an `unjudged` pair answered by a link, and the relations a
 * `link` writes or accepts (`linkPlan`, `linkSteps`): one per anchor of a
 * pool's flows, directed like the flow, a pool-to-pool flow and a
 * collapsed-subprocess end anchored at their processes; a suggested
 * process's proposals accepted instead of a manual relation. The synthetic landscape of the S4 tests plus five files: calls
 * without a target, with a JUEL expression and to a duplicated process id,
 * a nameless message, an engine-null FEEL call, and a collaboration with a
 * pool-to-pool flow and a collapsed subprocess.
 */
import {
  OpenQuestion,
  OpenQuestionKind,
  type OpenQuestionAction,
  type Ref,
} from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import {
  actionsFor,
  isExpression,
  linkPlan,
  linkSteps,
  type LinkPair,
} from '../../src/domain/open-questions/actions.ts';
import { buildOpenQuestions, openQuestions } from '../../src/domain/open-questions/read-model.ts';
import { SHIPPED_SIGNALS } from '../../src/domain/open-questions/signals.ts';
import type { RelationRecord } from '../../src/domain/ports.ts';
import { AT, PROJECT, relationId } from '../support/open-questions.ts';
import {
  C7,
  CALL,
  DEFS,
  N,
  R,
  START_RECHNUNG,
  STORNO,
  TASK_NOTIZ,
  placementAssertion,
  placementId,
  synthetic,
} from '../support/open-questions-synthetic.ts';

const SONDER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} ${C7}>
  <bpmn:process id="P_Sonder" name="Sonderfälle" isExecutable="true">
    <bpmn:documentation>Ruft Sonderfälle auf.</bpmn:documentation>
    <bpmn:startEvent id="Start_Sonder" name="Sonderfall gemeldet"/>
    <bpmn:callActivity id="Call_Leer" name="Unbekannt aufrufen"/>
    <bpmn:callActivity id="Call_Dyn" name="Dynamisch aufrufen" calledElement="\${ziel}"/>
    <bpmn:callActivity id="Call_Freigabe" name="Freigabe aufrufen" calledElement="P_Freigabe"/>
    <bpmn:intermediateThrowEvent id="Event_Namenlos" name="Ohne Namen">
      <bpmn:messageEventDefinition id="MED_Namenlos"/>
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="End_Sonder" name="Sonderfall erledigt"/>
  </bpmn:process>
</bpmn:definitions>`;

// No engine namespace: facts v1 treat only JUEL as dynamic, so "=ziel" is a static target.
const PLAIN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS}>
  <bpmn:process id="P_Plain" name="Ohne Engine" isExecutable="false">
    <bpmn:documentation>Ruft per FEEL auf.</bpmn:documentation>
    <bpmn:startEvent id="Start_Plain" name="Los"/>
    <bpmn:callActivity id="Call_Feel" name="FEEL-Aufruf" calledElement="=ziel"/>
    <bpmn:endEvent id="End_Plain" name="Fertig"/>
  </bpmn:process>
</bpmn:definitions>`;

const FREIGABE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} ${C7}>
  <bpmn:process id="P_Freigabe" name="Freigabe" isExecutable="true">
    <bpmn:documentation>Gibt frei.</bpmn:documentation>
    <bpmn:startEvent id="Start_Freigabe" name="Freigabe angefordert"/>
    <bpmn:endEvent id="End_Freigabe" name="Freigegeben"/>
  </bpmn:process>
</bpmn:definitions>`;

// A pool-to-pool flow (Lager → Spedition) and a flow to a collapsed subprocess in a lane.
const POOLS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS}>
  <bpmn:collaboration id="Collab_P">
    <bpmn:participant id="Participant_Lager" name="Lager" processRef="P_Lager"/>
    <bpmn:participant id="Participant_Versand" name="Versand" processRef="P_Versand"/>
    <bpmn:participant id="Participant_Spedition" name="Spedition"/>
    <bpmn:messageFlow id="Flow_Auftrag" name="Transportauftrag" sourceRef="Participant_Lager" targetRef="Participant_Spedition"/>
    <bpmn:messageFlow id="Flow_Status" name="Status" sourceRef="Participant_Spedition" targetRef="Sub_Verladen"/>
  </bpmn:collaboration>
  <bpmn:process id="P_Lager" name="Lager" isExecutable="false">
    <bpmn:documentation>Lagert Ware.</bpmn:documentation>
    <bpmn:startEvent id="Start_Lager" name="Ware da"/>
    <bpmn:endEvent id="End_Lager" name="Ware weg"/>
  </bpmn:process>
  <bpmn:process id="P_Versand" name="Versand" isExecutable="false">
    <bpmn:documentation>Versendet Ware.</bpmn:documentation>
    <bpmn:laneSet id="LaneSet_V">
      <bpmn:lane id="Lane_V" name="Versandteam">
        <bpmn:flowNodeRef>Sub_Verladen</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_Versand" name="Versand beginnt"/>
    <bpmn:subProcess id="Sub_Verladen" name="Verladen"/>
    <bpmn:endEvent id="End_Versand" name="Versendet"/>
  </bpmn:process>
</bpmn:definitions>`;

const EXTRA = [
  { key: 'vertrieb/sonder', bytes: SONDER },
  { key: 'archiv/plain', bytes: PLAIN },
  { key: 'einkauf/freigabe', bytes: FREIGABE },
  { key: 'einkauf/archiv/freigabe-alt', bytes: FREIGABE },
  { key: 'logistik/pools', bytes: POOLS },
];

const LEER = 'vertrieb/sonder#Call_Leer' as Ref;
const DYN = 'vertrieb/sonder#Call_Dyn' as Ref;
const FEEL = 'archiv/plain#Call_Feel' as Ref;
const NAMENLOS = 'vertrieb/sonder#Event_Namenlos' as Ref;
const SONDER_P = 'vertrieb/sonder#P_Sonder' as Ref;
const COPY = 'einkauf/freigabe#P_Freigabe' as Ref;
const OLD_COPY = 'einkauf/archiv/freigabe-alt#P_Freigabe' as Ref;
const SPEDITION = 'logistik/pools#Participant_Spedition' as Ref;
const LAGER = 'logistik/pools#P_Lager' as Ref;
const VERSAND = 'logistik/pools#P_Versand' as Ref;
const BANK = 'archiv/notiz#Participant_Bank' as Ref;

/** A plan's pairs as from → to only. */
function ends(plan: ReturnType<typeof linkPlan>) {
  return plan.ok ? { ok: true, pairs: plan.pairs.map(({ from, to }) => ({ from, to })) } : plan;
}

/** An action in one line: type, `*` when primary, label, picker, `+` for several, the fixed step. */
function line(a: OpenQuestionAction): string {
  return (
    `${a.type}${a.primary ? '*' : ''} ${a.label}` +
    (a.pick === undefined ? '' : ` [${a.pick}]`) +
    (a.multiple === true ? ' +' : '') +
    (a.step === undefined ? '' : ` @${a.step}`)
  );
}

/** A manual relation, accepted unless said otherwise. */
function manual(n: number, from: Ref, to: Ref, status: RelationRecord['status'] = 'accepted') {
  const r: RelationRecord = {
    id: relationId(500 + n),
    projectId: PROJECT,
    type: 'manual',
    fromRef: from,
    toRef: to,
    status,
    endpointState: 'ok',
    tier: 'manual',
    confidence: null,
    version: 1,
    attrs: {},
    fromFp: null,
    toFp: null,
    createdAt: AT,
    updatedAt: AT,
  };
  return r;
}

describe('the actions of every kind', () => {
  it('offers each kind its actions, at most one primary, every question a note', async () => {
    const base = await synthetic(EXTRA);
    // S2a: a head whose stored extractor warnings name a lost element (extractor-loss).
    const input = {
      ...base,
      models: new Map(
        [...base.models].map(([key, head]) => [
          key,
          key === 'archiv/plain'
            ? {
                ...head,
                extractWarnings: [
                  {
                    code: 'duplicate-id',
                    message: 'a second task with id T skipped',
                    elementId: 'T',
                  },
                ],
              }
            : head,
        ]),
      ),
    };
    const { index, items } = buildOpenQuestions(input);
    for (const q of items) expect(OpenQuestion.parse(q)).toEqual(q);
    const at = (kind: string, subject: string, source?: string) => {
      const found = items.filter(
        (q) =>
          q.kind === kind &&
          q.subject.id === subject &&
          (source === undefined || q.source === source),
      );
      expect(found, `${kind} ${subject}`).toHaveLength(1);
      return found[0] as OpenQuestion;
    };
    const lines = (q: OpenQuestion) => q.actions.map(line);
    const NOTE = 'note Notiz hinzufügen';
    const OUTSIDE_MARK = 'outside Liegt außerhalb der Landschaft';
    const LINK = 'link* Verknüpfen mit … [process]';

    // call-target-unknown, every flavour (S5c-2): a target naming no process and a no-link
    // link first and amend second; no target amends first; an engine-null FEEL target is an
    // expression in either dialect, so never an amendment. UX2a: both amends say „Ziel im
    // Modell eintragen …“; the link says „Nur verknüpfen …“ only as the second action beside a
    // primary amend (UX2b review: the primary verb never reads as the lesser option).
    const AMEND_TARGET = 'amend Ziel im Modell eintragen …';
    expect(lines(at('call-target-unknown', CALL, 'finding'))).toEqual([
      LINK,
      AMEND_TARGET,
      OUTSIDE_MARK,
      NOTE,
    ]);
    // The coded no-links join the rule tier's items about the same gap (UX2b review); on
    // their own, without the call's finding and the pool's signal, they act alike.
    expect(items.filter((q) => q.source === 'no-link')).toEqual([]);
    const alone = buildOpenQuestions(
      { ...input, findings: input.findings.filter((f) => !f.refs.includes(CALL)) },
      { signals: SHIPPED_SIGNALS.filter((sig) => sig !== 'black-box-partner') },
    ).items;
    const noLink = (kind: string, subject: string) => {
      const found = alone.filter(
        (q) => q.kind === kind && q.subject.id === subject && q.source === 'no-link',
      );
      expect(found, `${kind} ${subject}`).toHaveLength(1);
      return found[0] as OpenQuestion;
    };
    expect(lines(noLink('call-target-unknown', CALL))).toEqual([
      LINK,
      AMEND_TARGET,
      OUTSIDE_MARK,
      NOTE,
    ]);
    expect(lines(at('call-target-unknown', LEER))).toEqual([
      'amend* Ziel im Modell eintragen …',
      'link Nur verknüpfen … [process]',
      OUTSIDE_MARK,
      NOTE,
    ]);
    expect(at('call-target-unknown', LEER).actions[0]?.amend).toEqual({
      modelId: input.models.get('vertrieb/sonder')?.modelId,
      modelKey: 'vertrieb/sonder',
      targets: [
        {
          elementId: 'Call_Leer',
          op: 'call-target',
          label: 'Aufrufaktivität „Unbekannt aufrufen“',
        },
      ],
    });
    expect(lines(at('call-target-unknown', FEEL))).toEqual([LINK, OUTSIDE_MARK, NOTE]);
    // The agent's call proposal names its target first.
    expect(at('call-target-unknown', CALL, 'finding').actions[0]?.suggested).toEqual([R]);
    expect(at('call-target-unknown', LEER).actions[1]?.suggested).toEqual([]);
    expect(isExpression('=ziel') && isExpression('${ziel}') && isExpression('#{z}')).toBe(true);
    expect(isExpression('P_Freigabe')).toBe(false);
    expect(lines(at('call-target-dynamic', DYN))).toEqual([
      'link* Mögliche Ziele verknüpfen … [process] +',
      OUTSIDE_MARK,
      NOTE,
    ]);

    const duplicate = at('duplicate-process-id', OLD_COPY);
    expect(lines(duplicate)).toEqual(['choose-copy* Gültige Kopie wählen … [process]', NOTE]);
    const calls = input.relations.filter(
      (r) => r.type === 'call' && r.attrs['match'] === 'duplicate-process-id',
    );
    expect(calls).toHaveLength(2);
    expect(duplicate.actions[0]).toMatchObject({
      choices: [OLD_COPY, COPY],
      decides: calls
        .sort((a, b) => (a.toRef < b.toRef ? -1 : 1))
        .map((r) => ({ type: 'relation', id: r.id, version: 1 })),
    });

    // Named and nameless message endpoints: an endpoint picker, and the name in the model.
    expect(lines(at('message-partner-missing', STORNO))).toEqual([
      'link* Verknüpfen mit … [endpoint]',
      'amend Nachrichtennamen im Modell eintragen …',
      OUTSIDE_MARK,
      NOTE,
    ]);
    expect(lines(at('message-partner-missing', NAMENLOS))).toEqual([
      'amend* Nachrichtennamen im Modell eintragen …',
      'link Nur verknüpfen … [endpoint]',
      OUTSIDE_MARK,
      NOTE,
    ]);
    expect(at('message-partner-missing', NAMENLOS).actions[0]?.amend?.targets).toEqual([
      {
        elementId: 'Event_Namenlos',
        op: 'message-name',
        label: 'Nachrichten-Zwischenereignis „Ohne Namen“',
      },
    ]);

    // Holds and agents' questions, on relations and placements: decide.
    const decide = items.filter((q) => q.kind === 'held' || q.kind === 'agent-question');
    expect(decide.map((q) => `${q.kind} ${q.subject.type}`).sort()).toEqual([
      'agent-question placement',
      'agent-question relation',
      'held placement',
      'held relation',
    ]);
    for (const q of decide) {
      expect(lines(q)).toEqual(['decide* Vorschlag prüfen', NOTE]);
      expect(q.actions[0]?.decides).toEqual([
        { type: q.subject.type, id: q.subject.id, version: 1 },
      ]);
    }

    expect(lines(at('placement-unsure', R))).toEqual([
      'place* Schritt wählen … [step]',
      'place Gehört zu keinem Schritt @@outside',
      NOTE,
    ]);
    // process-without-step by state: proposed with an agent's question (N: dropped, the
    // question asks it, UX2a), none (P_Sonder), held (R: dropped, the hold asks it).
    expect(items.some((q) => q.kind === 'process-without-step' && q.subject.id === N)).toBe(false);
    // Without the question, N's item is decided on the chain (group `proposal`, UX2a).
    const histories = new Map(input.chain?.histories);
    histories.set(placementId(3), [placementAssertion(3, placementId(3), {})]);
    const chain = input.chain && { ...input.chain, histories };
    const proposed = openQuestions({ ...input, chain }).find(
      (q) => q.kind === 'process-without-step' && q.subject.id === N,
    );
    expect(proposed?.group).toBe('proposal');
    expect(proposed?.actions.map(line)).toEqual([
      'decide* Auf der Kette prüfen @step-ablage',
      'place Anderen Schritt wählen … [step]',
      'place Gehört zu keinem Schritt @@outside',
      NOTE,
    ]);
    expect(proposed?.actions[0]?.decides).toEqual([
      { type: 'placement', id: placementId(3), version: 1 },
    ]);
    expect(lines(at('process-without-step', SONDER_P))).toEqual([
      'place* Schritt wählen … [step]',
      'place Gehört zu keinem Schritt @@outside',
      NOTE,
    ]);
    expect(items.some((q) => q.kind === 'process-without-step' && q.subject.id === R)).toBe(false);
    // step-without-process: a process picker; „Auf der Kette prüfen“ while a placement is
    // proposed on it (UX2a: group `proposal`).
    expect(lines(at('step-without-process', 'step-finanzen'))).toEqual([
      'place* Prozess platzieren … [process]',
      OUTSIDE_MARK,
      NOTE,
    ]);
    expect(at('step-without-process', 'step-finanzen').group).toBe('ask');
    expect(lines(at('step-without-process', 'step-ablage'))).toEqual([
      'decide* Auf der Kette prüfen @step-ablage',
      'place Prozess platzieren … [process]',
      OUTSIDE_MARK,
      NOTE,
    ]);
    expect(at('step-without-process', 'step-ablage').group).toBe('proposal');
    expect(lines(at('unresolved-link', 'step-ablage'))).toEqual([
      'fix-link* Link korrigieren',
      NOTE,
    ]);
    expect(lines(noLink('external-partner', TASK_NOTIZ))).toEqual([
      'outside* Liegt außerhalb der Landschaft',
      'link Verknüpfen mit … [process]',
      NOTE,
    ]);
    const unjudged = at('unjudged', 'vertrieb/auftrag');
    expect(lines(unjudged)).toEqual([
      'requeue* Erneut einplanen',
      'link Paar verknüpfen … [pair]',
      NOTE,
    ]);
    expect(unjudged.actions[1]?.pairs).toEqual([
      { type: 'message', from: STORNO, to: START_RECHNUNG },
    ]);
    for (const box of [BANK, SPEDITION]) {
      expect(lines(at('black-box-partner', box))).toEqual([
        'outside* Liegt außerhalb der Landschaft',
        'link Verknüpfen mit … [process]',
        NOTE,
      ]);
    }
    // S5c-2: the names and the documentation in the model.
    const boundary = at('unlabelled-boundary', R);
    expect(lines(boundary)).toEqual(['amend* Namen eintragen …', NOTE]);
    expect(boundary.actions[0]?.amend?.targets.map((t) => [t.elementId, t.op])).toEqual(
      boundary.refs.filter((r) => r !== R).map((r) => [r.split('#')[1], 'event-name']),
    );
    const undocumented = at('undocumented-process', N);
    expect(lines(undocumented)).toEqual(['amend* Dokumentation ergänzen …', NOTE]);
    expect(undocumented.actions[0]?.amend?.targets).toEqual([
      {
        elementId: N.split('#')[1],
        op: 'process-documentation',
        label: expect.stringMatching(/^Prozess „.+“$/) as unknown,
      },
    ]);
    expect(lines(at('isolated-process', N))).toEqual([LINK, OUTSIDE_MARK, NOTE]);
    // S2a: a lost element is fixed by a new export; the note is the only action.
    expect(lines(at('extractor-loss', 'archiv/plain'))).toEqual(['note* Notiz hinzufügen']);
    // Informational items: none.
    for (const q of items.filter(
      (x) => x.kind === 'summary-note' || x.kind === 'descriptive-model',
    )) {
      expect(q.actions).toEqual([]);
    }
    // message-without-name stays off (S4); its actions are the nameless endpoint's.
    const nameless = at('message-partner-missing', NAMENLOS);
    expect(
      actionsFor({ ...nameless, kind: 'message-without-name', source: 'signal' }, index).map(line),
    ).toEqual([
      'amend* Nachrichtennamen im Modell eintragen …',
      'link Nur verknüpfen … [endpoint]',
      OUTSIDE_MARK,
      NOTE,
    ]);

    // Every kind of the contracts is here (amendment conflicts in their own test; the coded
    // no-link's `external-partner` on its own), and every item has at most one primary.
    expect(
      OpenQuestionKind.options.filter(
        (k) =>
          k !== 'message-without-name' &&
          k !== 'amendment-conflict' &&
          ![...items, ...alone].some((q) => q.kind === k),
      ),
    ).toEqual([]);
    for (const q of [...items, ...alone]) {
      expect(q.actions.filter((a) => a.primary).length, `${q.kind} ${q.subject.id}`).toBe(
        q.actions.length === 0 ? 0 : 1,
      );
    }
  });
});

describe('the amend form of unnamed starts and ends', () => {
  it('lists the start events first, then the end events, each by id', async () => {
    const EVENTS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} ${C7}>
  <bpmn:process id="P_Ereignisse" name="Ereignisse" isExecutable="true">
    <bpmn:documentation>Beginnt und endet ohne Namen.</bpmn:documentation>
    <bpmn:endEvent id="A_End"/>
    <bpmn:startEvent id="Z_Start"/>
    <bpmn:endEvent id="B_End"/>
  </bpmn:process>
</bpmn:definitions>`;
    const { index, items } = buildOpenQuestions(
      await synthetic([{ key: 'test/ereignisse', bytes: EVENTS }]),
    );
    const boundary = items.find(
      (q) => q.kind === 'unlabelled-boundary' && q.subject.id === 'test/ereignisse#P_Ereignisse',
    );
    if (!boundary) throw new Error('no unlabelled-boundary item');
    // The item's refs are sorted by code point (ends first); the form asks for the start first.
    const targets = actionsFor(boundary, index)[0]?.amend?.targets ?? [];
    expect(targets.map((t) => [t.elementId, t.label])).toEqual([
      ['Z_Start', 'Startereignis „Z_Start“'],
      ['A_End', 'Endereignis „A_End“'],
      ['B_End', 'Endereignis „B_End“'],
    ]);
  });
});

describe('R1 and R1b: links and decisions take items off the list', () => {
  it("hides a call's items once an accepted relation links it to another process", async () => {
    const input = await synthetic(EXTRA);
    const callItems = (relations: readonly RelationRecord[]) =>
      openQuestions({ ...input, relations })
        .filter((q) => q.kind === 'call-target-unknown' && q.subject.id === CALL)
        .map((q) => q.source)
        .sort();
    // The agent's proposal from the call (proposed, with a question) leaves it listed: one
    // item, the coded no-link about the same call joined to the finding (UX2b review).
    expect(callItems(input.relations)).toEqual(['finding']);
    // A link inside the call's own process changes nothing; a rejected one neither.
    expect(callItems([...input.relations, manual(1, CALL, STORNO)])).toHaveLength(1);
    expect(callItems([...input.relations, manual(1, CALL, N, 'rejected')])).toHaveLength(1);
    // An accepted manual relation to another process: the item goes.
    const linked = [...input.relations, manual(1, CALL, N)];
    expect(callItems(linked)).toEqual([]);
    // Without the finding, the no-link's own item goes the same way.
    const noFinding = { ...input, findings: input.findings.filter((f) => !f.refs.includes(CALL)) };
    const noLinkItems = (relations: readonly RelationRecord[]) =>
      openQuestions({ ...noFinding, relations })
        .filter((q) => q.kind === 'call-target-unknown' && q.subject.id === CALL)
        .map((q) => q.source);
    expect(noLinkItems(input.relations)).toEqual(['no-link']);
    expect(noLinkItems(linked)).toEqual([]);
    // „Befunde“ still lists the finding (R1 is read model only).
    expect(input.findings.some((f) => f.refs.includes(CALL))).toBe(true);
    // The agent's proposal, accepted by a human: the same.
    const accepted = input.relations.map((r) =>
      r.id === relationId(90) ? { ...r, status: 'accepted' as const } : r,
    );
    expect(callItems(accepted)).toEqual([]);
  });

  it('hides a pool once every anchor of its flows is linked, also within its model', async () => {
    const input = await synthetic(EXTRA);
    const listed = (relations: readonly RelationRecord[]) =>
      openQuestions({ ...input, relations }).some(
        (q) => q.kind === 'black-box-partner' && q.subject.id === SPEDITION,
      );
    expect(listed(input.relations)).toBe(true);
    // One of two anchors linked: still listed.
    expect(listed([...input.relations, manual(1, LAGER, R)])).toBe(true);
    // Both anchors (the pool's process and the collapsed subprocess's process), each to
    // another process of the same model.
    expect(listed([...input.relations, manual(1, LAGER, VERSAND), manual(2, VERSAND, LAGER)])).toBe(
      false,
    );
    expect(listed([...input.relations, manual(1, LAGER, VERSAND)])).toBe(false);
    // The bank's pool: its one anchor, the notes task.
    const bank = (relations: readonly RelationRecord[]) =>
      openQuestions({ ...input, relations }).some((q) => q.subject.id === BANK);
    expect(bank([...input.relations, manual(1, TASK_NOTIZ, R)])).toBe(false);
  });

  it('counts only links in the direction a link takes, and never a call for a pool', async () => {
    const input = await synthetic(EXTRA);
    const pool = (relations: readonly RelationRecord[]) =>
      openQuestions({ ...input, relations }).some(
        (q) => q.kind === 'black-box-partner' && q.subject.id === SPEDITION,
      );
    const call = (n: number, from: Ref, to: Ref): RelationRecord => ({
      ...manual(n, from, to),
      type: 'call',
      tier: 'rule',
    });
    // Another model's call into the pool's process (an accepted rule-tier call, decision 9)
    // says nothing about the pool's flows; nor does one into the incoming anchor's process.
    expect(pool([...input.relations, call(1, CALL, LAGER)])).toBe(true);
    expect(pool([...input.relations, manual(2, LAGER, R), call(3, CALL, VERSAND)])).toBe(true);
    // Against a flow's direction: Lager's pool sends, so a relation into Lager does not count.
    expect(pool([...input.relations, manual(2, R, LAGER), manual(3, R, VERSAND)])).toBe(true);
    // Along both flows: the pool is answered.
    expect(pool([...input.relations, manual(2, LAGER, R), manual(3, R, VERSAND)])).toBe(false);

    // A relation into a call activity says nothing about what it calls.
    const callItems = (relations: readonly RelationRecord[]) =>
      openQuestions({ ...input, relations }).filter(
        (q) => q.kind === 'call-target-unknown' && q.subject.id === CALL,
      ).length;
    expect(callItems([...input.relations, manual(4, TASK_NOTIZ, CALL)])).toBe(1);
    expect(callItems([...input.relations, manual(4, CALL, N)])).toBe(0);
  });

  it('ends an unjudged pair once an accepted relation joins its refs', async () => {
    const input = await synthetic(EXTRA);
    const unjudged = (relations: readonly RelationRecord[]) =>
      openQuestions({ ...input, relations }).find((q) => q.kind === 'unjudged');
    const before = unjudged(input.relations);
    expect(before?.actions.find((a) => a.pick === 'pair')?.pairs).toEqual([
      { type: 'message', from: STORNO, to: START_RECHNUNG },
    ]);
    // The human's manual link on the pair settles only its own pair key, yet it answers
    // the pair: its last pair, so the item goes. A rejected link does not.
    expect(unjudged([...input.relations, manual(1, STORNO, START_RECHNUNG)])).toBeUndefined();
    expect(unjudged([...input.relations, manual(1, STORNO, START_RECHNUNG, 'rejected')])?.id).toBe(
      before?.id,
    );
  });

  it('lists a duplicated process id only while a call towards a copy waits for a decision', async () => {
    const input = await synthetic(EXTRA);
    const listed = (relations: readonly RelationRecord[]) =>
      openQuestions({ ...input, relations }).some((q) => q.kind === 'duplicate-process-id');
    expect(listed(input.relations)).toBe(true);
    const decided = input.relations.map((r) =>
      r.attrs['match'] === 'duplicate-process-id'
        ? { ...r, status: r.toRef === COPY ? ('accepted' as const) : ('rejected' as const) }
        : r,
    );
    expect(listed(decided)).toBe(false);
    // A new caller's proposal to a copy brings it back.
    const caller: RelationRecord = {
      ...manual(3, 'vertrieb/auftrag#Call_Pruefung', OLD_COPY, 'proposed'),
      type: 'call',
      tier: 'semantic',
    };
    expect(listed([...decided, caller])).toBe(true);
  });
});

describe('what a link writes', () => {
  it('writes one relation per anchor of a pool, directed like its flow', async () => {
    const { index, items } = buildOpenQuestions(await synthetic(EXTRA));
    const pool = items.find((q) => q.subject.id === SPEDITION);
    const action = pool?.actions.find((a) => a.type === 'link');
    if (!pool || !action) throw new Error('no pool with a link');
    // Lager's pool sends to the box (its process, outgoing); the box sends to the collapsed
    // subprocess (its process, incoming).
    expect(ends(linkPlan(index, pool, action, { targets: [R] }))).toEqual({
      ok: true,
      pairs: [
        { from: LAGER, to: R },
        { from: R, to: VERSAND },
      ],
    });
    expect(linkPlan(index, pool, action, { targets: [R, N] })).toMatchObject({
      ok: false,
      reason: 'too-many-targets',
    });
    expect(linkPlan(index, pool, action, { targets: [VERSAND] })).toMatchObject({
      ok: false,
      reason: 'same-process',
    });
    expect(linkPlan(index, pool, action, { targets: [STORNO] })).toMatchObject({
      ok: false,
      reason: 'not-a-process',
    });
    expect(linkPlan(index, pool, action, { targets: ['x/y#Z'] })).toMatchObject({
      ok: false,
      reason: 'unknown-ref',
    });
  });

  it('accepts the proposals a suggested process names, and suggests no call into a pool', async () => {
    const input = await synthetic(EXTRA);
    // A key-tier message proposal from the external partner's end (a task) to the invoice's
    // start, and an agent's call proposal into the process of the pool's incoming anchor.
    const proposal: RelationRecord = {
      ...manual(1, TASK_NOTIZ, START_RECHNUNG, 'proposed'),
      type: 'message',
      tier: 'key',
    };
    const callInto: RelationRecord = {
      ...manual(2, CALL, VERSAND, 'proposed'),
      type: 'call',
      tier: 'semantic',
    };
    // The coded no-link on its own: without the bank pool's signal, which it joins otherwise.
    const { index, items } = buildOpenQuestions(
      { ...input, relations: [...input.relations, proposal, callInto] },
      { signals: SHIPPED_SIGNALS.filter((sig) => sig !== 'black-box-partner') },
    );
    const external = items.find(
      (q) => q.kind === 'external-partner' && q.subject.id === TASK_NOTIZ,
    );
    const link = external?.actions.find((a) => a.type === 'link');
    if (!external || !link) throw new Error('no external partner with a link');
    // „Vorgeschlagen“ names the process; the preview gets the proposal it accepts.
    expect(link).toMatchObject({
      suggested: [R],
      proposals: [
        { target: R, relation: proposal.id, type: 'message', from: TASK_NOTIZ, to: START_RECHNUNG },
      ],
      exclude: [N],
    });
    const steps = (targets: Ref[]) => {
      const plan = linkPlan(index, external, link, { targets });
      if (!plan.ok) throw new Error(plan.message);
      return linkSteps(index, external, link, plan.pairs);
    };
    // Picking the suggested process accepts the proposal and writes no manual relation.
    expect(steps([R])).toEqual([{ kind: 'accept', relations: [proposal] }]);
    // Another process gets a manual relation from the task.
    const [manualStep] = steps([SONDER_P]);
    expect(manualStep?.kind).toBe('manual');
    expect((manualStep as { pair: LinkPair } | undefined)?.pair).toMatchObject({
      from: TASK_NOTIZ,
      to: SONDER_P,
    });
    // Once accepted, a link to the same process writes nothing.
    const accepted = { ...proposal, status: 'accepted' as const };
    const after = buildOpenQuestions({ ...input, relations: [...input.relations, accepted] });
    const plan = linkPlan(after.index, external, link, { targets: [R] });
    if (!plan.ok) throw new Error(plan.message);
    expect(linkSteps(after.index, external, link, plan.pairs)).toEqual([{ kind: 'linked' }]);

    // The pool: the call into Versand's process is no suggestion, the anchors' processes
    // are left out of the picker, and a link writes one manual relation per flow.
    const pools = buildOpenQuestions({
      ...input,
      relations: [...input.relations, proposal, callInto],
    });
    const pool = pools.items.find((q) => q.subject.id === SPEDITION);
    const poolLink = pool?.actions.find((a) => a.type === 'link');
    if (!pool || !poolLink) throw new Error('no pool with a link');
    expect(poolLink.suggested).toEqual([]);
    expect(poolLink.proposals).toBeUndefined();
    expect(poolLink.exclude).toEqual([LAGER, VERSAND]);
    const poolPlan = linkPlan(pools.index, pool, poolLink, { targets: [R] });
    if (!poolPlan.ok) throw new Error(poolPlan.message);
    expect(linkSteps(pools.index, pool, poolLink, poolPlan.pairs).map((s) => s.kind)).toEqual([
      'manual',
      'manual',
    ]);
  });

  it('links calls from the call, endpoints by their direction, pairs as listed', async () => {
    const { index, items } = buildOpenQuestions(await synthetic(EXTRA));
    const of = (kind: string, subject: string) => {
      const q = items.find((x) => x.kind === kind && x.subject.id === subject);
      const a = q?.actions.find((x) => x.type === 'link');
      if (!q || !a) throw new Error(`no link on ${kind} ${subject}`);
      return [q, a] as const;
    };
    const [dyn, dynLink] = of('call-target-dynamic', DYN);
    expect(ends(linkPlan(index, dyn, dynLink, { targets: [R, N] }))).toEqual({
      ok: true,
      pairs: [
        { from: DYN, to: R },
        { from: DYN, to: N },
      ],
    });
    // A throw links from itself; the external partner's end (a task) too.
    const [storno, stornoLink] = of('message-partner-missing', STORNO);
    expect(ends(linkPlan(index, storno, stornoLink, { targets: [START_RECHNUNG] }))).toEqual({
      ok: true,
      pairs: [{ from: STORNO, to: START_RECHNUNG }],
    });
    const [unjudged, pairLink] = of('unjudged', 'vertrieb/auftrag');
    expect(
      ends(
        linkPlan(index, unjudged, pairLink, {
          targets: [],
          pair: { from: STORNO, to: START_RECHNUNG },
        }),
      ),
    ).toEqual({ ok: true, pairs: [{ from: STORNO, to: START_RECHNUNG }] });
    expect(
      linkPlan(index, unjudged, pairLink, {
        targets: [],
        pair: { from: START_RECHNUNG, to: STORNO },
      }),
    ).toMatchObject({ ok: false, reason: 'not-a-pair' });
  });
});
