import type { BulkDecisionBody, Relation } from '@analyzr/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { BulkAcceptDialog } from '../src/components/review/bulk-accept-dialog';
import { nameUsage } from '../src/lib/generic-names';
import { MAX_BULK_DECISIONS } from '../src/lib/limits';
import { bulkRows, type BulkPreselect } from '../src/lib/review';
import { buildRefIndex, resolverOf } from '../src/lib/refs';
import { fact, noLink, provenance, relation } from './support/fixtures';
import { findToast, json, renderWithRouter, stubApi, type Call } from './support/render';

const PATH = '/api/v1/projects/demo/decisions';

const facts = [
  fact({
    modelKey: 'vertrieb/auftrag',
    elementId: 'Send_Rechnung',
    kind: 'msg_throw',
    eventDef: 'message',
    processId: 'P_auftrag',
    label: 'Rechnung versenden',
    attrs: { messageName: 'RechnungVersendet' },
  }),
  fact({
    modelKey: 'finanzen/debitoren',
    elementId: 'Catch_Rechnung',
    kind: 'msg_catch',
    eventDef: 'message',
    processId: 'P_deb',
    label: 'Rechnung erhalten',
    attrs: { messageName: 'RechnungVersendet' },
  }),
  fact({
    modelKey: 'vertrieb/angebot',
    elementId: 'Send_Antwort',
    kind: 'msg_throw',
    eventDef: 'message',
    processId: 'P_angebot',
    label: 'Antwort senden',
    attrs: { messageName: 'Antwort' },
  }),
  fact({
    modelKey: 'einkauf/anfrage',
    elementId: 'Catch_Antwort',
    kind: 'msg_catch',
    eventDef: 'message',
    processId: 'P_anfrage',
    label: 'Antwort erhalten',
    attrs: { messageName: 'Antwort' },
  }),
  fact({
    modelKey: 'service/ticket',
    elementId: 'Catch_Antwort',
    kind: 'msg_catch',
    eventDef: 'message',
    processId: 'P_ticket',
    label: 'Kunde hat geantwortet',
    attrs: { messageName: 'Antwort' },
  }),
  fact({
    modelKey: 'lager/versand',
    elementId: 'Send_Ware',
    kind: 'msg_throw',
    eventDef: 'message',
    processId: 'P_versand',
    label: 'Ware versandbereit',
    attrs: { messageName: 'WareVersandbereit' },
  }),
  fact({
    modelKey: 'finanzen/debitoren',
    elementId: 'Catch_Ware',
    kind: 'msg_catch',
    eventDef: 'message',
    processId: 'P_deb',
    label: 'Ware versandbereit',
    attrs: { messageName: 'WareVersandbereit' },
  }),
];
const resolve = resolverOf(buildRefIndex(facts, []));
const usage = nameUsage(facts);

const pairs: Relation[] = [
  relation({
    id: 'rel_01RECHNUNG',
    from: 'vertrieb/auftrag#Send_Rechnung',
    to: 'finanzen/debitoren#Catch_Rechnung',
    version: 2,
    attrs: { messageName: 'RechnungVersendet' },
  }),
  relation({
    id: 'rel_01ANTWORT',
    from: 'vertrieb/angebot#Send_Antwort',
    to: 'einkauf/anfrage#Catch_Antwort',
    version: 1,
    attrs: { messageName: 'Antwort' },
  }),
  relation({
    id: 'rel_01WARE',
    from: 'lager/versand#Send_Ware',
    to: 'finanzen/debitoren#Catch_Ware',
    version: 5,
    attrs: { messageName: 'WareVersandbereit' },
  }),
];

function Harness({
  initialOpen = true,
  relations = pairs,
  canOwn = false,
  preselect,
}: {
  initialOpen?: boolean;
  relations?: Relation[];
  canOwn?: boolean;
  preselect?: BulkPreselect;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        öffnen
      </button>
      <BulkAcceptDialog
        project="demo"
        rows={bulkRows(relations, resolve, usage)}
        resolve={resolve}
        canOwn={canOwn}
        {...(preselect ? { preselect } : {})}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

async function setup(
  answer?: (call: Call) => Response,
  relations: Relation[] = pairs,
  canOwn = false,
  preselect?: BulkPreselect,
) {
  const calls = stubApi({
    [`POST ${PATH}`]:
      answer ??
      ((call) => {
        const body = call.body as BulkDecisionBody;
        return json({
          items: body.items.map((i) => ({
            ...relations.find((p) => p.id === i.id),
            status: 'accepted',
            version: i.version + 1,
          })),
        });
      }),
  });
  const user = userEvent.setup();
  const { router } = await renderWithRouter(
    <Harness relations={relations} canOwn={canOwn} {...(preselect ? { preselect } : {})} />,
  );
  return { calls, user, router };
}

const rows = () => screen.getAllByTestId('bulk-row');
const row = (id: string) => rows().find((r) => r.dataset['relationId'] === id)!;
const bodies = (calls: Call[]) => calls.filter((c) => c.path === PATH).map((c) => c.body);

describe('BulkAcceptDialog („Gleicher Name“, UX5)', () => {
  it('selects the unremarkable pairs and keeps the flagged ones under „Genauer ansehen“', async () => {
    await setup();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 unauffällige Vorschläge annehmen?')).toBeTruthy();
    expect(dialog.textContent).toContain(
      'Gleicher Name. Markierte mögliche Relationen wählst du bewusst selbst aus.',
    );
    // no unique calls of derived models: no groups
    expect(screen.queryByTestId('bulk-calls')).toBeNull();
    expect(within(dialog).queryByRole('heading', { level: 3 })).toBeNull();
    // the processes first, then the message once
    expect(row('rel_01RECHNUNG').textContent).toContain('P_auftrag → P_deb');
    expect(row('rel_01RECHNUNG').textContent).toContain('Rechnung versenden → Rechnung erhalten');
    expect(
      rows()
        .filter((r) => r.dataset['flagged'] === 'false')
        .map((r) => r.dataset['relationId']),
    ).toEqual(['rel_01RECHNUNG', 'rel_01WARE']);
    expect(screen.getByTestId('bulk-summary').textContent).toBe('2 von 2 ausgewählt');
    // flagged: closed, one flag line and „Vorschlag öffnen“, no checkbox
    const more = screen.getByTestId('bulk-flagged');
    expect(more.hasAttribute('open')).toBe(false);
    expect(more.querySelector('summary')?.textContent).toBe('Genauer ansehen (1)');
    const antwort = row('rel_01ANTWORT');
    expect(within(antwort).queryByRole('checkbox')).toBeNull();
    expect(within(antwort).getByTestId('generic-flag').textContent).toBe(
      'Allgemeiner Name · in 3 Prozessen',
    );
    expect(
      within(antwort).getByRole('link', { name: 'Vorschlag öffnen' }).getAttribute('href'),
    ).toBe('/projects/demo/review/rel_01ANTWORT');
  });

  it('accepts the selection with ids, versions, the tier and the count', async () => {
    const { calls, user } = await setup();
    await screen.findByRole('dialog');
    await user.click(screen.getByTestId('bulk-confirm'));
    const toast = await findToast('2 Relationen angenommen');
    expect(toast.textContent).toContain('Grundlage „Gleicher Name“.');
    expect(bodies(calls)).toEqual([
      {
        verdict: 'accept',
        tier: 'key',
        items: [
          { id: 'rel_01RECHNUNG', version: 2 },
          { id: 'rel_01WARE', version: 5 },
        ],
        expectedCount: 2,
      },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('leaves out a pair unchecked on purpose', async () => {
    const { calls, user } = await setup();
    await screen.findByRole('dialog');
    await user.click(within(row('rel_01WARE')).getByRole('checkbox'));
    expect(screen.getByTestId('bulk-summary').textContent).toBe('1 von 2 ausgewählt');
    await user.click(screen.getByRole('button', { name: '1 annehmen' }));
    await findToast('1 Relation angenommen');
    expect((bodies(calls)[0] as BulkDecisionBody).items).toEqual([
      { id: 'rel_01RECHNUNG', version: 2 },
    ]);
  });

  it('offers an owner the rule afterwards: „Gleicher Name ab 100 %“ prefilled', async () => {
    const { user, router } = await setup(undefined, pairs, true);
    await screen.findByRole('dialog');
    await user.click(screen.getByTestId('bulk-confirm'));
    // (earlier tests' toasts may still be on screen: the one with the offer)
    let toast: HTMLElement | undefined;
    await waitFor(() => {
      toast = screen
        .getAllByTestId('toast')
        .find((t) =>
          t.textContent.includes('Gleicher Name ab 100 % künftig automatisch annehmen?'),
        );
      expect(toast).toBeDefined();
    });
    await user.click(within(toast!).getByTestId('toast-action'));
    await waitFor(() => expect(router.state.location.href).toBe('/projects/demo/rules?new=key'));
  });

  it('keeps the dialog open with a clear message when the list changed (409)', async () => {
    const { user } = await setup(() =>
      json(
        {
          type: 'urn:analyzr:problem:conflict',
          title: 'Conflict',
          status: 409,
          code: 'conflict',
          detail: 'the relations changed; reload and decide again',
          mismatches: [{ id: 'rel_01WARE', reason: 'version', version: 6 }],
        },
        409,
      ),
    );
    await screen.findByRole('dialog');
    await user.click(screen.getByTestId('bulk-confirm'));
    const conflict = await screen.findByTestId('bulk-conflict');
    expect(conflict.textContent).toContain('Eine Relation hat sich seit dem Laden geändert');
    expect(conflict.textContent).toContain('Es wurde nichts entschieden');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('flags an open agent question, an ambiguous call target and an agent’s no-link', async () => {
    const agentPairs = [
      pairs[0]!,
      relation({
        ...pairs[2]!,
        provenance: provenance({
          tier: 'key',
          confidence: 1,
          question: 'Ist die Ware hier wirklich versandbereit oder nur kommissioniert?',
        }),
        noLinks: [noLink({ id: 'nlk_01A', handle: 'agent:claude code', reason: 'nein' })],
      }),
      relation({
        id: 'rel_01CALLDUP',
        type: 'call',
        tier: 'key',
        from: 'einkauf/anforderung#Call_Freigabe',
        to: 'einkauf/archiv/freigabe-2019#Process_Freigabe',
        confidence: 0.5,
        attrs: { match: 'duplicate-process-id', calledElement: 'Process_Freigabe' },
      }),
    ];
    const { calls, user } = await setup(undefined, agentPairs);
    await screen.findByRole('dialog');
    expect(screen.getByTestId('bulk-summary').textContent).toBe('1 von 1 ausgewählt');
    expect(within(row('rel_01WARE')).getByTestId('generic-flag').textContent).toBe(
      'Frage des Agenten · Einwand',
    );
    expect(within(row('rel_01CALLDUP')).getByTestId('generic-flag').textContent).toBe(
      'Ziel mehrdeutig',
    );
    await user.click(screen.getByRole('button', { name: '1 annehmen' }));
    await findToast('1 Relation angenommen');
    expect((bodies(calls)[0] as BulkDecisionBody).items).toEqual([
      { id: 'rel_01RECHNUNG', version: 2 },
    ]);
  });

  it('lists only the key tier’s open proposals (owner decision 26 (6))', () => {
    const mixed = [
      pairs[0]!,
      relation({ ...pairs[2]!, id: 'rel_01LEX', tier: 'lexical', confidence: 0.65 }),
      relation({ ...pairs[1]!, id: 'rel_01DONE', status: 'accepted' }),
    ];
    expect(bulkRows(mixed, resolve, usage).map((r) => r.relation.id)).toEqual(['rel_01RECHNUNG']);
  });
});

describe('BulkAcceptDialog: unique calls from derived models (M6 S2c)', () => {
  const call = (id: string, n: number, extra: Partial<Relation> = {}) =>
    relation({
      id,
      type: 'call',
      tier: 'key',
      confidence: 0.9,
      from: `vertrieb/auftrag#Call_${n}`,
      to: `finanzen/ziel-${n}#Process_${n}`,
      version: n,
      attrs: { calledElement: `Process_${n}`, match: 'derived-caller' },
      ...extra,
    });
  const calls = [call('rel_01CALL1', 1), call('rel_01CALL2', 2)];
  const mixed = [...pairs, ...calls];
  const groupIds = (testId: string) =>
    within(screen.getByTestId(testId))
      .getAllByTestId('bulk-row')
      .map((r) => r.dataset['relationId']);
  const checked = () =>
    rows()
      .filter((r) => within(r).queryByRole('checkbox')?.getAttribute('aria-checked') === 'true')
      .map((r) => r.dataset['relationId']);

  it('lists them first under their own heading, unflagged and selected with the others', async () => {
    await setup(undefined, mixed);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('4 unauffällige Vorschläge annehmen?')).toBeTruthy();
    expect(dialog.textContent).toContain(
      'Gleicher Name und eindeutige Aufrufe. Markierte mögliche Relationen wählst du bewusst selbst aus.',
    );
    expect(
      within(dialog)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Eindeutige Aufrufe aus abgeleiteten Modellen (2)', 'Gleicher Name (2)']);
    expect(groupIds('bulk-calls')).toEqual(['rel_01CALL1', 'rel_01CALL2']);
    expect(rows()[0]?.dataset['relationId']).toBe('rel_01CALL1');
    expect(row('rel_01CALL1').dataset['flagged']).toBe('false');
    expect(row('rel_01CALL1').textContent).toContain('90 %');
    expect(screen.getByTestId('bulk-summary').textContent).toBe('4 von 4 ausgewählt');
  });

  it('opened from „Gesammelt annehmen“, selects exactly those calls and accepts them, no rule offered', async () => {
    const { calls: sent, user } = await setup(undefined, mixed, true, 'calls');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 eindeutige Aufrufe annehmen?')).toBeTruthy();
    expect(screen.getByTestId('bulk-summary').textContent).toBe('2 von 4 ausgewählt');
    expect(checked()).toEqual(['rel_01CALL1', 'rel_01CALL2']);
    // the others stay listed, unselected, and can be added
    expect(within(row('rel_01RECHNUNG')).getByRole('checkbox').getAttribute('aria-checked')).toBe(
      'false',
    );
    await user.click(within(row('rel_01RECHNUNG')).getByRole('checkbox'));
    expect(screen.getByTestId('bulk-summary').textContent).toBe('3 von 4 ausgewählt');
    await user.click(within(row('rel_01RECHNUNG')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '2 annehmen' }));
    // (earlier tests' toasts may still be on screen: the one with this description)
    const toast = await findToast('Eindeutige Aufrufe aus abgeleiteten Modellen.');
    expect(toast.textContent).toContain('2 Relationen angenommen');
    // no „Gleicher Name“ rule: an agent rule never accepts these (the calls rule is S2c-3's)
    expect(toast.textContent).not.toContain('künftig automatisch');
    expect(within(toast).queryByTestId('toast-action')).toBeNull();
    expect(bodies(sent)).toEqual([
      {
        verdict: 'accept',
        tier: 'key',
        items: [
          { id: 'rel_01CALL1', version: 1 },
          { id: 'rel_01CALL2', version: 2 },
        ],
        expectedCount: 2,
      },
    ]);
  });

  it('keeps a call with an agent’s question in its group, flagged and unselected', async () => {
    const asked = call('rel_01CALL3', 3, {
      provenance: provenance({
        tier: 'key',
        confidence: 0.9,
        question: 'Ist das wirklich der Zielprozess?',
      }),
    });
    await setup(undefined, [...pairs, ...calls, asked], false, 'calls');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 eindeutige Aufrufe annehmen?')).toBeTruthy();
    expect(within(dialog).getAllByRole('heading', { level: 3 })[0]?.textContent).toBe(
      'Eindeutige Aufrufe aus abgeleiteten Modellen (3)',
    );
    expect(groupIds('bulk-calls')).toEqual(['rel_01CALL1', 'rel_01CALL2', 'rel_01CALL3']);
    expect(row('rel_01CALL3').dataset['flagged']).toBe('true');
    expect(within(row('rel_01CALL3')).queryByRole('checkbox')).toBeNull();
    expect(within(row('rel_01CALL3')).getByTestId('generic-flag').textContent).toBe(
      'Frage des Agenten',
    );
    // „Genauer ansehen“ keeps the other flagged pairs only
    expect(groupIds('bulk-flagged')).toEqual(['rel_01ANTWORT']);
    expect(checked()).toEqual(['rel_01CALL1', 'rel_01CALL2']);
  });

  it(`selects at most ${MAX_BULK_DECISIONS} calls from „Gesammelt annehmen“ and says the rest follow`, async () => {
    const many = Array.from({ length: MAX_BULK_DECISIONS + 2 }, (_, i) =>
      call(`rel_01MANY${String(i).padStart(4, '0')}`, i + 1),
    );
    const { calls: sent, user } = await setup(undefined, [...pairs, ...many], false, 'calls');
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(`${MAX_BULK_DECISIONS} eindeutige Aufrufe annehmen?`),
    ).toBeTruthy();
    expect(within(dialog).getAllByRole('heading', { level: 3 })[0]?.textContent).toBe(
      `Eindeutige Aufrufe aus abgeleiteten Modellen (${MAX_BULK_DECISIONS + 2})`,
    );
    expect(screen.getByTestId('bulk-summary').textContent).toBe(
      `${MAX_BULK_DECISIONS} von ${MAX_BULK_DECISIONS + 4} ausgewählt`,
    );
    expect(screen.getByTestId('bulk-rest').textContent).toBe(
      `Höchstens ${MAX_BULK_DECISIONS} auf einmal; die übrigen 2 danach.`,
    );
    await user.click(screen.getByRole('button', { name: `${MAX_BULK_DECISIONS} annehmen` }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const body = sent[0]?.body as BulkDecisionBody;
    expect(body.expectedCount).toBe(MAX_BULK_DECISIONS);
    expect(body.items.map((i) => i.id)).toEqual(many.slice(0, MAX_BULK_DECISIONS).map((r) => r.id));
  });

  it('offers an owner the „Gleicher Name“ rule when other pairs were accepted with the calls', async () => {
    const { user } = await setup(undefined, mixed, true);
    await screen.findByRole('dialog');
    await user.click(screen.getByTestId('bulk-confirm'));
    const toast = await findToast('4 Relationen angenommen');
    expect(toast.textContent).toContain('Gleicher Name ab 100 % künftig automatisch annehmen?');
  });
});
