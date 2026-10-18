import type { Placement } from '@analyzr/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PlacementCard } from '../src/components/value-chain/placement-card';
import { resolverOf } from '../src/lib/refs';
import { openQuestion, placement, placementAssertion } from './support/fixtures';
import { json, renderWithRouter, stubApi } from './support/render';

/**
 * The placement card as UX6 simplified it (UX-SIMPLIFICATION.md §3.8 items 4
 * and 12): the model path instead of the ref, a status only where it is not
 * a plain proposal, one closed „Details“, and a held placement answered
 * through the note dialog of „Offene Fragen“.
 */

const PROJECT = '/api/v1/projects/demo';
const assertionsOf = (id: string) => `GET ${PROJECT}/value-chains/main/placements/${id}/assertions`;
const projectInfo = () =>
  json({
    id: 'prj_01DEMO',
    key: 'demo',
    name: 'Demo',
    role: 'owner',
    lastSeq: 1,
    createdAt: '2026-10-07T09:00:00.000Z',
  });

const STEPS = [
  { elementId: 's-auftrag', name: 'Auftragsabwicklung', path: 'Vertrieb › Auftragsabwicklung' },
  { elementId: 's-versand', name: 'Versand', path: 'Vertrieb › Versand' },
];
const RESOLVE = resolverOf(
  new Map([
    ['vertrieb/order#Task_Check', { label: 'Auftrag prüfen', kind: 'task', processName: null }],
  ]),
);

function renderCard(p: Placement) {
  return renderWithRouter(
    <PlacementCard
      project="demo"
      placement={p}
      modelKeys={new Set(['vertrieb/order'])}
      stepOptions={STEPS}
      active
      canReview
      shortcuts={false}
      onActivate={() => undefined}
      onSelectStep={() => undefined}
      onDecided={() => undefined}
      onReload={() => undefined}
      resolve={RESOLVE}
    />,
  );
}

describe('placement card (UX6)', () => {
  it('reads a plain proposal: name, model path, rationale; the rest in one „Details“', async () => {
    stubApi({
      [`GET ${PROJECT}`]: projectInfo,
      [assertionsOf('plc_01PROP')]: () =>
        json({
          items: [
            placementAssertion({
              id: 'pas_01PROPOSAL',
              rationale: 'Passt fachlich.',
              evidence: ['vertrieb/order#Task_Check', 'step:s-versand', 'rel_01ABC'],
              at: '2026-10-17T20:32:00.000Z',
            }),
          ],
          nextCursor: null,
        }),
    });
    await renderCard(
      placement({
        id: 'plc_01PROP',
        elementId: 's-auftrag',
        process: 'vertrieb/order#Process_Order',
        processName: 'Auftragsabwicklung',
      }),
    );
    const card = await screen.findByTestId('placement-card');
    expect(within(card).getByTestId('placement-model').textContent).toBe('vertrieb/order');
    // no status for a plain proposal, no tier, no ref in sight
    expect(within(card).queryByText('Vorgeschlagen')).toBeNull();
    expect(within(card).queryByText('Gleiche Bedeutung')).toBeNull();
    const details = within(card).getByTestId<HTMLDetailsElement>('placement-details');
    expect(details.open).toBe(false);
    // six controls: „Details“, „Im Modell“ and the four decisions
    expect(
      within(card)
        .getAllByRole('button')
        .concat(within(card).getAllByRole('link'))
        .map((c) => c.textContent?.trim()),
    ).toEqual(['Annehmen', 'Ablehnen', 'Vormerken', 'Korrigieren', 'Im Modell']);
    expect(details.querySelector(':scope > summary')?.textContent).toBe('Details');

    await userEvent.setup().click(within(card).getByText('Details'));
    expect(details.open).toBe(true);
    expect(within(details).getByTestId('placement-tier').textContent).toBe(
      'Grundlage: Gleiche Bedeutung',
    );
    expect(within(details).getByTestId('placement-proposer').textContent).toMatch(
      /^Vorgeschlagen von Agent „claude code“ · 17\.10\.2026, \d\d:32$/,
    );
    // the evidence by name
    await waitFor(() =>
      expect(within(details).getByTestId('evidence-link').textContent).toBe('Auftrag prüfen'),
    );
    expect(within(details).getByTestId('evidence-step').textContent).toBe('Schritt „Versand“');
    expect(within(details).getByTestId('evidence-relation').textContent).toBe('Relation ansehen');
    // the history keeps the proposal shown above to its title, without „maßgeblich“
    const entry = within(details).getByTestId('timeline-entry');
    expect(entry.textContent).not.toContain('Passt fachlich.');
    expect(details.textContent).not.toContain('maßgeblich');
    // ids, client, procedure and model behind „Technische Angaben“
    const technical = within(details).getByTestId('placement-technical');
    expect(technical.textContent).toContain('vertrieb/order#Process_Order');
    expect(technical.textContent).toContain('agt_01CLAUDE');
    expect(technical.textContent).toContain('analyzr-placements@0.1.0');
  });

  it('shows a hold’s note and answers read-only and answers it in place of „Vormerken“', async () => {
    stubApi({
      [`GET ${PROJECT}`]: projectInfo,
      [assertionsOf('plc_01HELD')]: () =>
        json({
          items: [
            placementAssertion({ id: 'pas_01PROPOSAL', rationale: 'Passt fachlich.' }),
            placementAssertion({
              id: 'pas_01HOLD',
              kind: 'decision',
              verdict: 'hold',
              sourceKind: 'human',
              handle: 'owner',
              rationale: 'Mit dem Vertrieb klären.',
            }),
            placementAssertion({
              id: 'pas_01NOTE',
              kind: 'note',
              sourceKind: 'human',
              handle: 'owner',
              rationale: 'Der Vertrieb sagt: gehört zur Auftragsabwicklung.',
            }),
          ],
          nextCursor: null,
        }),
      [`GET ${PROJECT}/open-questions`]: () =>
        json({
          items: [
            openQuestion({
              id: 'q-00000000000000p1',
              kind: 'held',
              source: 'hold',
              subject: { type: 'placement', id: 'plc_01HELD' },
              text: 'Mit dem Vertrieb klären.',
            }),
          ],
          nextCursor: null,
          totals: { ask: 1, agent: 0, proposal: 0, info: 0 },
          askByModel: {},
        }),
    });
    const base = placement({ id: 'x', elementId: 'x', process: 'a#b' }).provenance!;
    await renderCard(
      placement({
        id: 'plc_01HELD',
        elementId: 's-auftrag',
        process: 'vertrieb/order#Process_Order',
        status: 'held',
        provenance: {
          ...base,
          assertionId: 'pas_01HOLD',
          kind: 'decision',
          verdict: 'hold',
          sourceKind: 'human',
          handle: 'owner',
          rationale: 'Mit dem Vertrieb klären.',
        },
      }),
    );
    const card = await screen.findByTestId('placement-card');
    expect(within(card).getByText('Vorgemerkt')).toBeTruthy();
    expect(within(card).getByText('Mit dem Vertrieb klären.')).toBeTruthy();
    expect((await within(card).findByTestId('placement-answer')).textContent).toBe(
      'Antwort: Der Vertrieb sagt: gehört zur Auftragsabwicklung.',
    );
    // no inline answer form; „Antwort geben“ opens the note dialog of „Offene Fragen“
    expect(within(card).queryByRole('form', { name: 'Antwort geben' })).toBeNull();
    const answer = await within(card).findByTestId('hold-answer');
    expect(answer.textContent).toBe('Antwort geben');
    expect(within(card).queryByRole('button', { name: /Vormerken/ })).toBeNull();
    await userEvent.setup().click(answer);
    expect(await screen.findByTestId('note-dialog')).toBeTruthy();
  });
});
