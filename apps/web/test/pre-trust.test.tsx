/**
 * „Vor der Vertrauensregel angenommen“ (M6 S2c-4, owner decisions 24.2 (a)
 * and 28 (3)): the system rule card's line (owners only, only while some
 * wait, never without its dialog, as in the demo), the dialog in the revoke
 * dialog's pattern (per model a checkbox with its reasons and count, all
 * selected; the dry run in one line; „Zurück in die Prüfung“ as the primary,
 * „Behalten“ beside it with a note that it is decided once; the list's count
 * as `expectedCount`; a 409 of the dry run or the review reloads the list,
 * another failure says so; a failed dry run keeps the primary disabled; the
 * toast leads to the bulk accept) and the texts.
 */
import type { PreTrustList, PreTrustReviewResult } from '@analyzr/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreTrustDialog } from '../src/components/rules/pre-trust-dialog';
import { SystemRuleCard } from '../src/components/rules/system-rule-card';
import {
  preTrustCardText,
  preTrustDoneToast,
  preTrustDryRunText,
  preTrustModelDetail,
} from '../src/lib/pre-trust';
import { findToast, json, renderWithRouter, stubApi } from './support/render';

const BASE = '/api/v1/projects/demo';
const REV_A = 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2A1';
const REV_B = 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2B1';

const SYSTEM = {
  id: 'analyzr-rules/1.0.0',
  name: 'Eindeutige Aufrufe',
  description: '',
  kind: 'relation',
  relationType: 'call',
  readOnly: true,
  accepted: 10,
  proposed: 0,
  preTrust: 3,
} as const;

const LIST: PreTrustList = {
  count: 3,
  models: [
    {
      modelId: 'mdl_01J9Z3N4X5Q6R7S8T9V0W1X2A1',
      modelKey: 'vertrieb/auftrag',
      modelName: 'Auftragsabwicklung',
      revisionId: REV_A,
      rev: 1,
      reasons: ['no-engine'],
      derivedKind: null,
      converter: null,
      count: 2,
      calls: [],
    },
    {
      modelId: 'mdl_01J9Z3N4X5Q6R7S8T9V0W1X2B1',
      modelKey: 'lager/einlagerung',
      modelName: null,
      revisionId: REV_B,
      rev: 3,
      reasons: ['agent-upload', 'converted'],
      derivedKind: 'converted',
      converter: 'normalize-bpmn@0.1.0',
      count: 1,
      calls: [],
    },
  ],
};

const NONE = { count: 0, items: [], ofProposed: 0, byRule: [] };

function result(
  over: Partial<PreTrustReviewResult> & Pick<PreTrustReviewResult, 'count'>,
): PreTrustReviewResult {
  return {
    dryRun: true,
    verdict: 'derived',
    revisions: 1,
    toProposed: over.count,
    autoAcceptedCalls: NONE,
    ...over,
  };
}

/** The review route: a dry run per selection, the real call as `real` answers. */
function routes(real: (body: Record<string, unknown>) => Response = () => json({})) {
  return stubApi({
    [`GET ${BASE}/pre-trust-calls`]: () => json(LIST),
    [`POST ${BASE}/pre-trust-calls/review`]: (c) => {
      const body = c.body as { revisionIds: string[]; verdict: string };
      if (c.search === '?dryRun=true') {
        const count = LIST.models
          .filter((m) => body.revisionIds.includes(m.revisionId))
          .reduce((n, m) => n + m.count, 0);
        return json(result({ count, revisions: body.revisionIds.length }));
      }
      return real(c.body as Record<string, unknown>);
    },
  });
}

describe('the texts', () => {
  it('names the card’s line, a model’s reasons and count, the dry run and the toast', () => {
    expect(preTrustCardText(12)).toBe('12 vor der Vertrauensregel angenommen – prüfen…');
    expect(preTrustModelDetail({ count: 1, reasons: ['agent-upload', 'converted'] })).toBe(
      '1 Aufruf · über ein Agenten-Token hochgeladen; als konvertiert angegeben',
    );
    expect(preTrustDryRunText({ toProposed: 3, autoAcceptedCalls: NONE })).toBe(
      '3 Aufrufe gehen zurück in die Prüfung.',
    );
    expect(preTrustDryRunText({ toProposed: 1, autoAcceptedCalls: NONE })).toBe(
      '1 Aufruf geht zurück in die Prüfung.',
    );
    const byRule = (count: number, names: string[]) => ({
      count,
      items: [],
      ofProposed: count,
      byRule: names.map((ruleName, i) => ({
        ruleId: `aar_0${i}` as `aar_${string}`,
        ruleName,
        count: 1,
      })),
    });
    expect(preTrustDryRunText({ toProposed: 3, autoAcceptedCalls: byRule(2, ['Export']) })).toBe(
      '3 Aufrufe gehen zurück in die Prüfung. Deine Regel „Export“ nimmt 2 davon gleich wieder an.',
    );
    expect(preTrustDryRunText({ toProposed: 2, autoAcceptedCalls: byRule(2, ['A', 'B']) })).toBe(
      '2 Aufrufe gehen zurück in die Prüfung. Deine Regeln nehmen sie alle gleich wieder an.',
    );
    // Only the rules' acceptances among these calls count (`ofProposed`), as in the toast.
    expect(
      preTrustDryRunText({
        toProposed: 2,
        autoAcceptedCalls: { ...byRule(3, ['Export']), ofProposed: 1 },
      }),
    ).toBe(
      '2 Aufrufe gehen zurück in die Prüfung. Deine Regel „Export“ nimmt 1 davon gleich wieder an.',
    );
    expect(
      preTrustDryRunText({
        toProposed: 2,
        autoAcceptedCalls: { ...byRule(1, ['Export']), ofProposed: 0 },
      }),
    ).toBe('2 Aufrufe gehen zurück in die Prüfung.');
    expect(preTrustDoneToast(result({ count: 3, dryRun: false }))).toEqual({
      title: '3 Aufrufe zurück in der Prüfung',
      description: 'Sie stehen in der Prüfung; nimm sie dort gesammelt an.',
      open: 3,
    });
    expect(
      preTrustDoneToast(
        result({ count: 3, autoAcceptedCalls: { ...byRule(2, ['A', 'B']), ofProposed: 2 } }),
      ),
    ).toEqual({
      title: '3 Aufrufe zurück in der Prüfung',
      description:
        'Deine Regeln haben 2 davon gleich wieder angenommen; die übrigen nimmst du gesammelt an.',
      open: 1,
    });
    expect(
      preTrustDoneToast(result({ count: 1, autoAcceptedCalls: byRule(1, ['Export']) })),
    ).toMatchObject({ description: 'Deine Regel hat ihn gleich wieder angenommen.', open: 0 });
    expect(preTrustDoneToast(result({ count: 2, verdict: 'modelled', toProposed: 0 }))).toEqual({
      title: '2 Aufrufe behalten',
      description: 'Sie bleiben angenommen; analyzr fragt nicht mehr danach.',
      open: 0,
    });
  });
});

describe('the system rule card’s line', () => {
  it('opens the dialog for owners while acceptances from before the trust rule wait', async () => {
    const onPreTrust = vi.fn();
    await renderWithRouter(
      <SystemRuleCard project="demo" system={SYSTEM} onPreTrust={onPreTrust} />,
    );
    const card = await screen.findByTestId('system-rule');
    expect(card.textContent).toBe(
      'Eindeutige Aufrufe aus Camunda-Modellen nimmt analyzr beim Hochladen an · immer aktiv · 10 angenommen · 3 vor der Vertrauensregel angenommen – prüfen…',
    );
    await userEvent.setup().click(within(card).getByRole('button'));
    expect(onPreTrust).toHaveBeenCalledOnce();
  });

  it('shows nothing without a count, nor without its dialog (the demo)', async () => {
    await renderWithRouter(
      <>
        <SystemRuleCard project="demo" system={{ ...SYSTEM, preTrust: 0 }} onPreTrust={vi.fn()} />
        <SystemRuleCard project="demo" system={SYSTEM} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('system-rule')).toHaveLength(2));
    expect(screen.queryByTestId('system-rule-pre-trust')).toBeNull();
    for (const card of screen.getAllByTestId('system-rule')) {
      expect(card.textContent).not.toContain('Vertrauensregel');
    }
  });
});

describe('the dialog „Vor der Vertrauensregel angenommen“', () => {
  it('lists every model selected with its reasons; the dry run follows the selection; „Zurück in die Prüfung“ sends it', async () => {
    const calls = routes((body) =>
      json(result({ dryRun: false, count: 2, revisions: (body['revisionIds'] as []).length })),
    );
    const onOpenChange = vi.fn();
    const { router } = await renderWithRouter(
      <PreTrustDialog project="demo" open onOpenChange={onOpenChange} />,
    );
    const dialog = await screen.findByTestId('pre-trust-dialog');
    await waitFor(() => expect(within(dialog).getAllByTestId('pre-trust-model')).toHaveLength(2));
    expect(
      within(dialog)
        .getAllByTestId('pre-trust-model')
        .map((m) => m.textContent),
    ).toEqual([
      'Auftragsabwicklung2 Aufrufe · ohne Camunda-Engine',
      'lager/einlagerung1 Aufruf · über ein Agenten-Token hochgeladen; als konvertiert angegeben',
    ]);
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((c) => c.getAttribute('aria-checked')),
    ).toEqual(['true', 'true']);
    await waitFor(() =>
      expect(within(dialog).getByTestId('pre-trust-summary').textContent).toBe(
        '3 Aufrufe gehen zurück in die Prüfung.',
      ),
    );
    // „Behalten“ is decided once, and the dialog says so.
    expect(within(dialog).getByTestId('pre-trust-keep-note').textContent).toBe(
      '„Behalten“ lässt sie angenommen; danach fragt analyzr bei diesen Modellen nicht mehr.',
    );
    // One primary, one secondary; the dialog's own close button besides.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Behalten', 'Zurück in die Prüfung', 'Close']);

    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('checkbox', { name: /lager\/einlagerung/ }));
    await waitFor(() =>
      expect(within(dialog).getByTestId('pre-trust-summary').textContent).toBe(
        '2 Aufrufe gehen zurück in die Prüfung.',
      ),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Zurück in die Prüfung' }));
    const toast = await findToast('2 Aufrufe zurück in der Prüfung');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const real = calls.filter((c) => c.method === 'POST' && c.search === '');
    expect(real.map((c) => c.body)).toEqual([
      { verdict: 'derived', revisionIds: [REV_A], expectedCount: 2 },
    ]);
    // The toast leads to the bulk accept („Gesammelt annehmen“, S2c-2).
    const action = within(toast).getByTestId('toast-action');
    expect(action.textContent).toBe('Gesammelt annehmen');
    await user.click(action);
    await waitFor(() =>
      expect(router.state.location.href).toBe('/projects/demo/review?bulk=calls'),
    );
  });

  it('„Behalten“ keeps the selected calls, with the list’s count', async () => {
    const calls = routes(() =>
      json(result({ dryRun: false, verdict: 'modelled', count: 3, toProposed: 0, revisions: 2 })),
    );
    await renderWithRouter(<PreTrustDialog project="demo" open onOpenChange={() => undefined} />);
    const dialog = await screen.findByTestId('pre-trust-dialog');
    await userEvent.setup().click(await within(dialog).findByRole('button', { name: 'Behalten' }));
    await findToast('3 Aufrufe behalten');
    expect(calls.filter((c) => c.method === 'POST' && c.search === '').map((c) => c.body)).toEqual([
      { verdict: 'modelled', revisionIds: [REV_A, REV_B], expectedCount: 3 },
    ]);
  });

  it('keeps „Zurück in die Prüfung“ disabled while the dry run failed, and says why', async () => {
    const calls = stubApi({
      [`GET ${BASE}/pre-trust-calls`]: () => json(LIST),
      [`POST ${BASE}/pre-trust-calls/review`]: () =>
        json(
          {
            type: 'urn:analyzr:problem:internal',
            title: 'Internal Server Error',
            status: 500,
            code: 'internal',
            detail: 'Datenbank nicht erreichbar',
          },
          500,
        ),
    });
    await renderWithRouter(<PreTrustDialog project="demo" open onOpenChange={() => undefined} />);
    const dialog = await screen.findByTestId('pre-trust-dialog');
    await waitFor(() =>
      expect(within(dialog).getByTestId('pre-trust-summary').textContent).toContain(
        'Datenbank nicht erreichbar',
      ),
    );
    const revoke = within(dialog).getByRole('button', { name: 'Zurück in die Prüfung' });
    expect(revoke.hasAttribute('disabled')).toBe(true);
    await userEvent.setup().click(revoke);
    // Only the dry run was sent.
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.search)).toEqual(['?dryRun=true']);
  });

  it('reloads the list when the dry run finds a model no longer listed (409)', async () => {
    let lists = 0;
    const calls = stubApi({
      [`GET ${BASE}/pre-trust-calls`]: () => {
        lists += 1;
        return json(lists === 1 ? LIST : { count: 1, models: [LIST.models[1]] });
      },
      [`POST ${BASE}/pre-trust-calls/review`]: (c) =>
        (c.body as { revisionIds: string[] }).revisionIds.includes(REV_A)
          ? json(
              {
                type: 'urn:analyzr:problem:conflict',
                title: 'conflict',
                status: 409,
                code: 'conflict',
                count: 1,
                reason: 'not-listed',
              },
              409,
            )
          : json(result({ count: 1 })),
    });
    await renderWithRouter(<PreTrustDialog project="demo" open onOpenChange={() => undefined} />);
    const dialog = await screen.findByTestId('pre-trust-dialog');
    expect(await within(dialog).findByText('Die Liste hat sich geändert')).toBeTruthy();
    await waitFor(() => expect(within(dialog).getAllByTestId('pre-trust-model')).toHaveLength(1));
    await waitFor(() =>
      expect(within(dialog).getByTestId('pre-trust-summary').textContent).toBe(
        '1 Aufruf geht zurück in die Prüfung.',
      ),
    );
    expect(
      within(dialog)
        .getByRole('button', { name: 'Zurück in die Prüfung' })
        .hasAttribute('disabled'),
    ).toBe(false);
    // Only dry runs: nothing was reviewed.
    expect(calls.filter((c) => c.method === 'POST').map((c) => [c.search, c.body])).toEqual([
      ['?dryRun=true', { verdict: 'derived', revisionIds: [REV_A, REV_B] }],
      ['?dryRun=true', { verdict: 'derived', revisionIds: [REV_B] }],
    ]);
  });

  it('shows „Das hat nicht geklappt“ when the review fails otherwise, keeps the dialog and the list', async () => {
    const calls = stubApi({
      [`GET ${BASE}/pre-trust-calls`]: () => json(LIST),
      [`POST ${BASE}/pre-trust-calls/review`]: (c) =>
        c.search === '?dryRun=true'
          ? json(result({ count: 3 }))
          : json(
              {
                type: 'urn:analyzr:problem:internal',
                title: 'Internal Server Error',
                status: 500,
                code: 'internal',
                detail: 'Datenbank nicht erreichbar',
              },
              500,
            ),
    });
    const onOpenChange = vi.fn();
    await renderWithRouter(<PreTrustDialog project="demo" open onOpenChange={onOpenChange} />);
    const dialog = await screen.findByTestId('pre-trust-dialog');
    await waitFor(() =>
      expect(within(dialog).getByTestId('pre-trust-summary').textContent).toBe(
        '3 Aufrufe gehen zurück in die Prüfung.',
      ),
    );
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: 'Zurück in die Prüfung' }));
    const alert = (await within(dialog).findByText('Das hat nicht geklappt')).closest(
      '[role="alert"]',
    );
    expect(alert?.textContent).toContain('Datenbank nicht erreichbar');
    expect(within(dialog).queryByText('Die Liste hat sich geändert')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
    // The selection stays as it was, for another try.
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((c) => c.getAttribute('aria-checked')),
    ).toEqual(['true', 'true']);
    expect(calls.filter((c) => c.method === 'POST' && c.search === '')).toHaveLength(1);
  });

  it('reloads the list when it changed meanwhile (409) and changes nothing', async () => {
    let lists = 0;
    const calls = stubApi({
      [`GET ${BASE}/pre-trust-calls`]: () => {
        lists += 1;
        return json(lists === 1 ? LIST : { count: 1, models: [LIST.models[1]] });
      },
      [`POST ${BASE}/pre-trust-calls/review`]: (c) =>
        c.search === '?dryRun=true'
          ? json(result({ count: 3 }))
          : json(
              {
                type: 'urn:analyzr:problem:conflict',
                title: 'conflict',
                status: 409,
                code: 'conflict',
                count: 1,
                reason: 'not-listed',
              },
              409,
            ),
    });
    await renderWithRouter(<PreTrustDialog project="demo" open onOpenChange={() => undefined} />);
    const dialog = await screen.findByTestId('pre-trust-dialog');
    await userEvent.setup().click(await within(dialog).findByRole('button', { name: 'Behalten' }));
    expect(await within(dialog).findByText('Die Liste hat sich geändert')).toBeTruthy();
    await waitFor(() => expect(within(dialog).getAllByTestId('pre-trust-model')).toHaveLength(1));
    expect(calls.filter((c) => c.method === 'POST' && c.search === '')).toHaveLength(1);
  });
});
