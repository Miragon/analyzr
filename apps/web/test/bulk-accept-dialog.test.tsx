import type { BulkDecisionBody, Relation } from '@analyzr/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { BulkAcceptDialog } from '../src/components/review/bulk-accept-dialog';
import { nameUsage } from '../src/lib/generic-names';
import { bulkRows } from '../src/lib/review';
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
}: {
  initialOpen?: boolean;
  relations?: Relation[];
  canOwn?: boolean;
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
  const { router } = await renderWithRouter(<Harness relations={relations} canOwn={canOwn} />);
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
      'Markierte mögliche Relationen wählst du bewusst selbst aus.',
    );
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
