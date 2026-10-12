import { DerivedRelation } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import {
  LABEL_BASELINE,
  baselineEventsFromFacts,
  labelBaseline,
  labelBaselineProcessNames,
  searchLabel,
} from '../src/index.ts';
import { call, end, model, msgCatch, msgThrow, project, shuffled, start } from './support/facts.ts';

const brief = (rs: DerivedRelation[]) =>
  rs.map((r) => `${r.type} ${r.from} -> ${r.to} d=${String(r.attrs.distance)}`);

describe('searchLabel (the normalized search label)', () => {
  it('lowercases, blanks non-alphanumerics including umlauts, sorts and joins the words', () => {
    expect(searchLabel('Order received')).toBe('orderreceived');
    expect(searchLabel('Received order')).toBe('orderreceived');
    expect(searchLabel('Antrag prüfen')).toBe('antragfenpr');
    expect(searchLabel('  Lieferung   verspätet! ')).toBe('lieferungtetversp');
    expect(searchLabel('???')).toBe('');
    expect(searchLabel(null)).toBeNull();
  });
});

describe('labelBaseline', () => {
  const a = model('a/orders', {
    processes: [{ id: 'Process_A' }],
    facts: [
      end('End_OrderRejected', 'Order rejected'),
      msgThrow('Event_Shipped', 'Shipped', { label: 'Invoice sent' }),
      msgThrow('Task_Send', 'Shipped', { element: 'bpmn:SendTask', label: 'Order received' }),
      start('Start_OrderReceivedSelf', 'Order received again'),
      call('Call_Billing', 'Process_Whatever', { label: 'Billing' }),
    ],
  });
  const b = model('b/billing', {
    processes: [{ id: 'Process_B', name: 'Billing process' }],
    facts: [
      msgCatch('Start_OrderReceived', 'OrderReceived', { label: 'Order received' }),
      start('Start_Delivered', 'Invoice paid'),
      start('Start_Umlaut', 'Lieferung verspätet'),
      msgCatch('Event_Boundary', 'X', { element: 'bpmn:BoundaryEvent', label: 'Order rejected' }),
      start('Start_Timer', 'Order rejected', { eventDef: 'timer' }),
    ],
  });

  it('links throws to catches by search label within Levenshtein 4, whatever the event definitions', () => {
    const rs = labelBaseline(project(a, b));
    expect(brief(rs)).toEqual([
      'call a/orders#Call_Billing -> b/billing#Process_B d=0',
      'message a/orders#End_OrderRejected -> b/billing#Start_OrderReceived d=3',
      'message a/orders#Event_Shipped -> b/billing#Start_Delivered d=4',
      'trigger a/orders#End_OrderRejected -> b/billing#Start_Timer d=0',
    ]);
    for (const r of rs) {
      expect(() => DerivedRelation.parse(r)).not.toThrow();
      expect(r).toMatchObject({ status: 'proposed', tier: 'lexical' });
      expect(r.attrs.algorithm).toBe(LABEL_BASELINE);
    }
  });

  it('ignores boundary events and send/receive tasks', () => {
    const refs = labelBaseline(project(a, b)).flatMap((r) => [r.from, r.to]);
    expect(refs).not.toContain('b/billing#Event_Boundary');
    expect(refs).not.toContain('a/orders#Task_Send');
  });

  it('honours maxDistance and adds events only a full parse sees', () => {
    expect(brief(labelBaseline(project(a, b), { maxDistance: 0 }))).toEqual([
      'call a/orders#Call_Billing -> b/billing#Process_B d=0',
      'trigger a/orders#End_OrderRejected -> b/billing#Start_Timer d=0',
    ]);
    const rs = labelBaseline(project(a, b), {
      maxDistance: 0,
      extraEvents: [
        {
          ref: 'b/billing#Event_Timer',
          process: 'b/billing#Process_B',
          position: 'intermediate_catch',
          label: 'Rejected order',
        },
        // a ref already covered by a fact is ignored
        {
          ref: 'b/billing#Start_Timer',
          process: 'b/billing#Process_B',
          position: 'end',
          label: 'x',
        },
      ],
    });
    expect(brief(rs)).toContain('trigger a/orders#End_OrderRejected -> b/billing#Event_Timer d=0');
    expect(brief(rs)).toContain('trigger a/orders#End_OrderRejected -> b/billing#Start_Timer d=0');
  });

  it('links events of the same process too (a weakness of label matching)', () => {
    const self = model('c/self', {
      processes: [{ id: 'Process_C' }],
      facts: [end('End_Done', 'Antrag geprüft'), start('Start_Done', 'Antrag geprüft')],
    });
    expect(brief(labelBaseline(project(self)))).toEqual([
      'trigger c/self#End_Done -> c/self#Start_Done d=0',
    ]);
  });

  it('is deterministic and independent of the input order', () => {
    expect(labelBaseline(shuffled(project(a, b)))).toEqual(labelBaseline(project(a, b)));
  });

  it('lists the events the baseline matches', () => {
    expect(
      baselineEventsFromFacts(project(b))
        .map((e) => `${e.position} ${e.ref}`)
        .sort(),
    ).toEqual([
      'start b/billing#Start_Delivered',
      'start b/billing#Start_OrderReceived',
      'start b/billing#Start_Timer',
      'start b/billing#Start_Umlaut',
    ]);
  });
});

describe('labelBaselineProcessNames', () => {
  it('names a single-process file after the file', () => {
    expect([
      ...labelBaselineProcessNames(
        model('x/e-invoice', { processes: [{ id: 'P', name: 'E-Invoice' }] }),
      ),
    ]).toEqual([['x/e-invoice#P', 'e-invoice']]);
  });

  it('names the participants of a collaboration after their process, else their pool', () => {
    const collab = model('x/collab', {
      processes: [
        { id: 'P1', name: 'Check', participantId: 'Pool_1', participantName: 'Team' },
        { id: 'P2', participantId: 'Pool_2', participantName: 'Agency' },
      ],
    });
    expect([...labelBaselineProcessNames(collab)]).toEqual([
      ['x/collab#P1', 'Check'],
      ['x/collab#P2', 'Agency'],
    ]);
  });

  it('counts a pool without a process, seen through its message flows', () => {
    const withCustomer = model('x/shop', {
      processes: [{ id: 'P', name: 'Shop', participantId: 'Pool_Shop' }],
      facts: [msgCatch('Start_Order', 'Order')],
      messageFlows: [{ id: 'F', from: 'Pool_Customer', to: 'Start_Order' }],
    });
    expect([...labelBaselineProcessNames(withCustomer)]).toEqual([['x/shop#P', 'Shop']]);
  });
});
