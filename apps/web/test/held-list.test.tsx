import type { RelationAssertion } from '@analyzr/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { HeldList } from '../src/components/review/held-list';
import {
  assertion,
  openQuestion,
  openQuestionAnswer,
  openQuestionPage,
  provenance,
  relation,
  sampleResolver,
} from './support/fixtures';
import { findToast, json, renderWithRouter, stubApi } from './support/render';

const ID = 'rel_01HELD0000000000000000001';
const ASSERTIONS = `/api/v1/projects/demo/relations/${ID}/assertions`;
const QUESTIONS = '/api/v1/projects/demo/open-questions';
/** The hold as an open question (UX2b: its one answer place is the note dialog). */
const QUESTION = openQuestion({
  id: 'q-00000000000000e1',
  kind: 'held',
  source: 'hold',
  subject: { type: 'relation', id: ID },
  subjectLabel: '„Ware versandbereit“ → „Ware versandbereit“',
  text: 'Wird bei Teillieferungen auch eine Rechnung gestellt?',
  actions: [
    {
      type: 'decide',
      primary: true,
      label: 'Vorschlag prüfen',
      decides: [{ type: 'relation', id: ID, version: 1 }],
    },
    { type: 'note', primary: false, label: 'Notiz hinzufügen' },
  ],
});

const hold = provenance({
  assertionId: 'ast_01HOLD',
  kind: 'decision',
  verdict: 'hold',
  sourceKind: 'human',
  handle: 'owner',
  clientId: 'analyzr-web',
  procedure: null,
  llmModel: null,
  tier: null,
  confidence: null,
  rationale: 'Bei Teillieferungen unklar.',
  question: 'Wird bei Teillieferungen auch eine Rechnung gestellt?',
  label: 'mit Fachbereich Finanzen klären',
  at: '2026-10-07T10:00:00.000Z',
});

const held = relation({
  id: ID,
  from: 'vertrieb/auftragsabwicklung#Event_WareVersandbereit',
  to: 'finanzen/rechnungsstellung#Start_WareVersandbereit',
  status: 'held',
  tier: 'lexical',
  provenance: hold,
});

function setup(history: RelationAssertion[]) {
  let items = [...history];
  const calls = stubApi({
    [`GET ${ASSERTIONS}`]: () => json({ items }),
    [`GET ${QUESTIONS}`]: (call) => json(openQuestionPage([QUESTION], call.search)),
    // the open question's answer: a note on the relation, as the server records it
    [`POST ${QUESTIONS}/${QUESTION.id}/answers`]: (call) => {
      const text = (call.body as { text: string }).text;
      const note = assertion({
        id: `ast_01NOTE${items.length}`,
        kind: 'note',
        sourceKind: 'human',
        handle: 'owner',
        clientId: 'analyzr-web',
        procedure: null,
        llmModel: null,
        tier: null,
        confidence: null,
        rationale: text,
        at: '2026-10-08T08:00:00.000Z',
      });
      items = [...items, note];
      const answer = openQuestionAnswer({
        questionId: QUESTION.id,
        target: 'relation-note',
        text,
        note: { type: 'relation', subjectId: ID, assertionId: note.id },
      });
      return json(
        {
          result: 'recorded',
          answer,
          question: { ...QUESTION, answers: [answer] },
          warnings: [],
        },
        201,
      );
    },
  });
  return { calls, user: userEvent.setup() };
}

const history = [
  assertion({ id: 'ast_01PROP', rationale: 'Gleiche Bezeichnung' }),
  assertion({
    id: 'ast_01NOTE_OLD',
    kind: 'note',
    sourceKind: 'human',
    handle: 'owner',
    rationale: 'alte Notiz',
  }),
  assertion({
    id: 'ast_01HOLD',
    kind: 'decision',
    verdict: 'hold',
    sourceKind: 'human',
    handle: 'owner',
    rationale: 'Bei Teillieferungen unklar.',
  }),
  assertion({
    id: 'ast_01ANSWER',
    kind: 'note',
    sourceKind: 'human',
    handle: 'owner',
    rationale: 'Finanzen: ja, auch bei Teillieferungen.',
    at: '2026-10-07T12:00:00.000Z',
  }),
];

describe('HeldList', () => {
  it('shows each held relation with note, question, label and the answers so far', async () => {
    setup(history);
    await renderWithRouter(<HeldList project="demo" relations={[held]} resolve={sampleResolver} />);
    const item = screen.getByTestId('held-item');
    expect(within(item).getAllByText('Ware versandbereit')).toHaveLength(2);
    expect(within(item).getByText('Bei Teillieferungen unklar.')).toBeTruthy();
    expect(
      within(item).getByText('Wird bei Teillieferungen auch eine Rechnung gestellt?'),
    ).toBeTruthy();
    expect(within(item).getByText('mit Fachbereich Finanzen klären')).toBeTruthy();
    // only notes after the hold count as answers
    const answers = await within(item).findAllByTestId('held-answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]!.textContent).toContain('Finanzen: ja, auch bei Teillieferungen.');
    expect(within(item).queryByText('alte Notiz')).toBeNull();
    const link = within(item).getByRole('link', { name: /Prüfen/ });
    expect(link.getAttribute('href')).toBe(`/projects/demo/review/${ID}?view=held`);
  });

  it('answers in the note dialog of „Offene Fragen“, one place to answer a hold (UX2b)', async () => {
    const { calls, user } = setup(history.slice(0, 3));
    await renderWithRouter(<HeldList project="demo" relations={[held]} resolve={sampleResolver} />);
    const item = screen.getByTestId('held-item');
    // no open answer field in the row any more
    expect(within(item).queryByRole('textbox')).toBeNull();
    await user.click(await within(item).findByRole('button', { name: 'Antwort geben' }));
    const dialog = await screen.findByTestId('note-dialog');
    expect(within(dialog).getByRole('heading', { name: 'Antwort geben' })).toBeDefined();
    expect(within(dialog).getByTestId('note-question').textContent).toContain(QUESTION.text);
    await user.type(within(dialog).getByLabelText('Deine Antwort'), 'Ja, laut Finanzen.');
    await user.click(
      within(dialog).getByRole('button', { name: 'Antwort speichern (nicht änderbar)' }),
    );
    expect((await findToast('Antwort gespeichert')).textContent).toContain(
      'Gespeichert an der Relation. Die Vormerkung bleibt, bis du sie entscheidest.',
    );
    expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body])).toEqual([
      [`${QUESTIONS}/${QUESTION.id}/answers`, { text: 'Ja, laut Finanzen.' }],
    ]);
    // the hold's question is found by its relation
    const list = calls.find((c) => c.method === 'GET' && c.path === QUESTIONS);
    expect(new URLSearchParams(list?.search).get('kind')).toBe('held');
    await waitFor(() =>
      expect(within(item).getByTestId('held-answer').textContent).toContain('Ja, laut Finanzen.'),
    );
  });

  it('answers a hold without an open question on the relation itself (an end went missing)', async () => {
    const calls = stubApi({
      [`GET ${ASSERTIONS}`]: () => json({ items: history }),
      // no `held` item: an end of the relation is missing from the head models
      [`GET ${QUESTIONS}`]: (call) => json(openQuestionPage([], call.search)),
      [`POST /api/v1/projects/demo/relations/${ID}/notes`]: (call) =>
        json(
          assertion({
            id: 'ast_01NOTE_NEW',
            kind: 'note',
            sourceKind: 'human',
            handle: 'owner',
            rationale: (call.body as { text: string }).text,
          }),
          201,
        ),
    });
    const user = userEvent.setup();
    await renderWithRouter(<HeldList project="demo" relations={[held]} resolve={sampleResolver} />);
    const item = screen.getByTestId('held-item');
    await user.click(await within(item).findByRole('button', { name: 'Antwort geben' }));
    const dialog = await screen.findByTestId('note-dialog');
    expect(within(dialog).getByRole('heading', { name: 'Antwort geben' })).toBeTruthy();
    expect(dialog.textContent).toContain('Die Vormerkung bleibt, bis du sie entscheidest.');
    await user.type(within(dialog).getByLabelText('Deine Antwort'), 'Ja, laut Finanzen.');
    await user.click(
      within(dialog).getByRole('button', { name: 'Antwort speichern (nicht änderbar)' }),
    );
    expect((await findToast('Antwort gespeichert')).textContent).toContain(
      'Gespeichert an der Relation.',
    );
    expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body])).toEqual([
      [`/api/v1/projects/demo/relations/${ID}/notes`, { text: 'Ja, laut Finanzen.' }],
    ]);
  });

  it('offers no answer to viewers', async () => {
    setup(history);
    await renderWithRouter(
      <HeldList project="demo" relations={[held]} resolve={sampleResolver} canAnswer={false} />,
    );
    await screen.findAllByTestId('held-answer');
    expect(screen.queryByRole('button', { name: 'Antwort geben' })).toBeNull();
  });

  it('explains an empty list', async () => {
    stubApi({});
    await renderWithRouter(<HeldList project="demo" relations={[]} resolve={sampleResolver} />);
    expect(screen.getByText('Nichts vorgemerkt')).toBeTruthy();
  });
});
