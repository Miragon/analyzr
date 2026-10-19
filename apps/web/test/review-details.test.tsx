import type { Relation } from '@analyzr/client';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReviewDetails } from '../src/components/review/review-details';
import { formatDateTime } from '../src/lib/labels';
import { buildRefIndex, resolverOf } from '../src/lib/refs';
import {
  assertion,
  fact,
  noLink,
  openQuestion,
  openQuestionAnswer,
  openQuestionPage,
  provenance,
  relation,
} from './support/fixtures';
import { json, renderWithRouter, stubApi } from './support/render';

const HOSTILE =
  '<img src=x onerror="alert(1)"><script>alert(2)</script> **fett** [link](javascript:x)';

const facts = [
  fact({
    modelKey: 'shop',
    elementId: 'Throw',
    kind: 'msg_throw',
    eventDef: 'message',
    processId: 'P_shop',
    label: 'Ware versandbereit',
  }),
  fact({
    modelKey: 'billing',
    elementId: 'Catch',
    kind: 'msg_catch',
    eventDef: 'message',
    processId: 'P_bill',
    label: 'Versand gemeldet',
  }),
  fact({
    modelKey: 'billing',
    elementId: 'Task_Rechnung',
    kind: 'task',
    processId: 'P_bill',
    label: 'Rechnung erstellen',
  }),
];
const resolve = resolverOf(buildRefIndex(facts, []));

const rel = relation({
  id: 'rel_01DETAILS0000000000000001',
  type: 'message',
  from: 'shop#Throw',
  to: 'billing#Catch',
  tier: 'semantic',
  confidence: 0.82,
  version: 4,
  provenance: provenance({
    assertionId: 'ast_02',
    rationale: HOSTILE,
    question: 'Gilt das auch für Abholung?',
  }),
});

const history = [
  assertion({ id: 'ast_01', seq: 3, rationale: 'erste Fassung', evidence: [] }),
  assertion({
    id: 'ast_w',
    seq: 4,
    kind: 'withdrawal',
    tier: null,
    confidence: null,
    rationale: 'superseded by submission 7',
  }),
  assertion({
    id: 'ast_02',
    seq: 5,
    rationale: HOSTILE,
    question: 'Gilt das auch für Abholung?',
    evidence: ['billing#Task_Rechnung', 'Fachkonzept Kapitel 4', '<b>shop#Throw</b>'],
  }),
  assertion({
    id: 'ast_03',
    seq: 6,
    kind: 'decision',
    verdict: 'reject',
    sourceKind: 'human',
    handle: 'owner',
    clientId: 'analyzr-web',
    procedure: null,
    llmModel: null,
    tier: null,
    confidence: null,
    rationale: 'Falscher Empfänger',
    linkedRelationId: 'rel_01MANUAL000000000000000001',
  }),
];

async function setup(onEvidence = vi.fn(), relationShown: Relation = rel) {
  stubApi({});
  await renderWithRouter(
    <ReviewDetails
      project="demo"
      relation={relationShown}
      assertions={history}
      resolve={resolve}
      modelKeys={new Set(['shop', 'billing'])}
      onEvidence={onEvidence}
    />,
  );
  return { onEvidence, user: userEvent.setup() };
}

describe('ReviewDetails', () => {
  it('renders agent text as plain text, never as HTML', async () => {
    await setup();
    const details = screen.getByTestId('review-details');
    expect(details.querySelector('img, script, a[href^="javascript"], strong')).toBeNull();
    // the rationale appears verbatim, once: „Verlauf“ keeps only the title of an entry shown above
    expect(screen.getAllByText(HOSTILE).length).toBeGreaterThanOrEqual(1);
    for (const el of screen.getAllByText(HOSTILE)) {
      expect(el.hasAttribute('data-plain-text')).toBe(true);
    }
  });

  it('shows endpoints, the agent question; who and how in a closed „Verlauf“ (UX5)', async () => {
    await setup();
    expect(screen.getByText('Ware versandbereit')).toBeTruthy();
    expect(screen.getByText('Versand gemeldet')).toBeTruthy();
    expect(screen.getByTestId('agent-question').textContent).toContain(
      'Gilt das auch für Abholung?',
    );
    // the header: type, status, both ends, the confidence; the tier is in „Verlauf“
    expect(screen.getByTestId('review-details').firstElementChild?.textContent).toContain('82 %');
    expect(screen.queryByRole('region', { name: 'Herkunft' })).toBeNull();
    const history = screen.getByTestId('review-history');
    expect(history.hasAttribute('open')).toBe(false);
    expect(history.querySelector('summary')?.textContent).toBe('Verlauf (4)');
    // ids, client, procedure and model behind „Technische Angaben“
    const technical = within(history).getByTestId('review-technical');
    expect(technical.textContent).toContain('rel_01DETAILS0000000000000001 · Version 4');
    expect(technical.textContent).toContain('agt_01CLAUDE');
    expect(technical.textContent).toContain('analyzr-relations@0.1.0');
    expect(technical.textContent).toContain('claude-sonnet-5-5');
    // no current no-link on the pair, no callout
    expect(screen.queryByTestId('agent-no-links')).toBeNull();
  });

  it('shows agent no-links right after the question, with reasons as plain text', async () => {
    await setup(
      vi.fn(),
      relation({
        ...rel,
        noLinks: [
          noLink({
            id: 'nlk_01FIRST',
            handle: 'agent:claude code',
            origin: 'billing',
            reason: `no-evidence: ${HOSTILE}`,
            at: '2026-10-06T14:30:00.000Z',
          }),
          noLink({ id: 'nlk_02SECOND', handle: 'agent:codex', origin: 'shop', reason: '' }),
        ],
      }),
    );
    const callout = screen.getByTestId('agent-no-links');
    expect(within(callout).getByText('Kein Zusammenhang laut Agent')).toBeTruthy();
    // right after the agent's question
    expect(screen.getByTestId('agent-question').nextElementSibling).toBe(callout);
    const entries = within(callout).getAllByTestId('agent-no-link');
    expect(entries.map((e) => e.dataset['noLinkId'])).toEqual(['nlk_01FIRST', 'nlk_02SECOND']);

    const [first, second] = entries;
    expect(within(first!).getByText('agent:claude code')).toBeTruthy();
    expect(within(first!).getByText('(Agent)')).toBeTruthy();
    expect(first!.textContent).toContain('Analyse von billing');
    expect(first!.textContent).toContain(formatDateTime('2026-10-06T14:30:00.000Z'));
    const reason = within(first!).getByText(`no-evidence: ${HOSTILE}`);
    expect(reason.hasAttribute('data-plain-text')).toBe(true);
    expect(callout.querySelector('img, script, a, strong')).toBeNull();

    expect(within(second!).getByText('agent:codex')).toBeTruthy();
    expect(second!.textContent).toContain('Analyse von shop');
    expect(second!.textContent).toContain('Ohne Begründung.');
  });

  it('makes evidence refs into known models clickable, other evidence stays text', async () => {
    const { onEvidence, user } = await setup();
    const refs = screen.getAllByTestId('evidence-ref');
    expect(refs).toHaveLength(1);
    expect(refs[0]!.textContent).toContain('Rechnung erstellen');
    await user.click(refs[0]!);
    expect(onEvidence).toHaveBeenCalledWith({
      kind: 'ref',
      text: 'billing#Task_Rechnung',
      modelKey: 'billing',
      elementId: 'Task_Rechnung',
    });
    const evidence = screen.getByRole('region', { name: 'Belege' });
    expect(within(evidence).getByText('Fachkonzept Kapitel 4')).toBeTruthy();
    expect(within(evidence).getByText('<b>shop#Throw</b>')).toBeTruthy();
  });

  it('lists the history in order with the assertion the status rests on', async () => {
    await setup();
    const entries = screen.getAllByTestId('timeline-entry');
    expect(entries.map((e) => [e.dataset['kind'], e.dataset['verdict'] ?? null])).toEqual([
      ['proposal', null],
      ['withdrawal', null],
      ['proposal', null],
      ['decision', 'reject'],
    ]);
    expect(within(entries[0]!).getByText('Vom Agenten vorgeschlagen')).toBeTruthy();
    expect(within(entries[1]!).getByText('Vorschlag zurückgezogen')).toBeTruthy();
    // shown above: the title, who and when only; no „maßgeblich“, no client id (UX5)
    expect(within(entries[2]!).queryByText(HOSTILE)).toBeNull();
    expect(within(entries[2]!).queryByText('maßgeblich')).toBeNull();
    expect(entries[2]!.textContent).not.toContain('agt_01CLAUDE');
    expect(within(entries[3]!).getByText('Abgelehnt')).toBeTruthy();
    expect(within(entries[3]!).getByText('Falscher Empfänger')).toBeTruthy();
    const link = within(entries[3]!).getByRole('link', { name: /Korrigiert durch/ });
    expect(link.getAttribute('href')).toBe('/projects/demo/review/rel_01MANUAL000000000000000001');
  });

  it('shows a hold’s question, note and label read-only; the answer is in the decision bar (UX5)', async () => {
    const held = relation({
      ...rel,
      status: 'held',
      provenance: provenance({
        kind: 'decision',
        verdict: 'hold',
        sourceKind: 'human',
        handle: 'owner',
        rationale: 'Laut Handbuch der Vertrieb.',
        question: 'Wer verschickt die Rechnung?',
        label: 'mit Finanzen klären',
      }),
    });
    const question = openQuestion({
      id: 'q-00000000000000f1',
      kind: 'held',
      source: 'hold',
      subject: { type: 'relation', id: held.id },
      text: 'Wer verschickt die Rechnung?',
      actions: [{ type: 'note', primary: false, label: 'Notiz hinzufügen' }],
    });
    stubApi({
      'GET /api/v1/projects/demo/open-questions': (call) =>
        json(openQuestionPage([question], call.search)),
    });
    await renderWithRouter(
      <ReviewDetails
        project="demo"
        relation={held}
        assertions={history}
        resolve={resolve}
        modelKeys={new Set(['shop', 'billing'])}
      />,
    );
    const box = screen.getByTestId('hold-box');
    expect(box.textContent).toContain('Offene Frage (vorgemerkt)');
    expect(box.textContent).toContain('Wer verschickt die Rechnung?');
    expect(box.textContent).toContain('Notiz zur Vormerkung: Laut Handbuch der Vertrieb.');
    expect(box.textContent).toContain('mit Finanzen klären');
    expect(within(box).queryByRole('button')).toBeNull();
  });

  it('shows the hold’s latest answer where it is decided', async () => {
    const held = relation({
      ...rel,
      status: 'held',
      provenance: provenance({
        assertionId: 'ast_h',
        kind: 'decision',
        verdict: 'hold',
        sourceKind: 'human',
        handle: 'owner',
        rationale: 'Laut Handbuch der Vertrieb.',
        question: 'Wer verschickt die Rechnung?',
      }),
    });
    const answered = [
      ...history,
      assertion({ id: 'ast_h', seq: 7, kind: 'decision', verdict: 'hold', sourceKind: 'human' }),
      assertion({
        id: 'ast_n1',
        seq: 8,
        kind: 'note',
        sourceKind: 'human',
        rationale: 'Erst so.',
        at: '2026-10-17T09:00:00.000Z',
      }),
      assertion({
        id: 'ast_n2',
        seq: 9,
        kind: 'note',
        sourceKind: 'human',
        rationale: 'Ja, laut Einkauf immer.',
        at: '2026-10-18T09:00:00.000Z',
      }),
    ];
    const question = openQuestion({
      id: 'q-00000000000000f2',
      kind: 'held',
      source: 'hold',
      subject: { type: 'relation', id: held.id },
      answers: [openQuestionAnswer({ questionId: 'q-00000000000000f2', target: 'relation-note' })],
      actions: [{ type: 'note', primary: false, label: 'Notiz hinzufügen' }],
    });
    stubApi({
      'GET /api/v1/projects/demo/open-questions': (call) =>
        json(openQuestionPage([question], call.search)),
    });
    await renderWithRouter(
      <ReviewDetails
        project="demo"
        relation={held}
        assertions={answered}
        resolve={resolve}
        modelKeys={new Set(['shop', 'billing'])}
      />,
    );
    const box = screen.getByTestId('hold-box');
    expect(within(box).getByTestId('hold-answer-latest').textContent).toBe(
      'Antwort vom 18.10.2026: Ja, laut Einkauf immer.',
    );
  });
});
