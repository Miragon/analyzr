/**
 * The projects list (UX-SIMPLIFICATION.md §3.12): the columns „Projekt“ (the
 * key small below), „Rolle“ (UX1: hidden while every role is „Inhaber“),
 * „Offen für dich“ and „Zuletzt geändert“ from each project's summary (UX9,
 * item 1: the sum of the tab badges for editors and owners, „–“ for viewers,
 * the demo visitor and none, a placeholder while loading). „Neues Projekt“
 * (item 4, UX1): the key follows the name as one line „Kurzname: … (ändern)“,
 * the field opens on demand, and a taken key says so in German with the field
 * open.
 */
import type { Health, Project, ProjectSummary } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import { formatDate } from '../src/lib/labels';
import { healthQuery, keys, projectsQuery } from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import { json, stubApi } from './support/render';

const LOCAL: Health = { status: 'ok', version: '0.1.0-test', db: 'ok' };
const DEMO: Health = { ...LOCAL, demo: 'readonly' };
const existing: Project = {
  id: 'prj_01A',
  key: 'nordwind-handel',
  name: 'Nordwind Handel GmbH',
  role: 'owner',
  lastSeq: 277,
  createdAt: '2026-10-07T09:00:00.000Z',
};
/** Midday UTC, so the day is the same in every runner's zone. */
const SUMMARY: ProjectSummary = {
  lastEventAt: '2026-10-18T12:00:00.000Z',
  reviewItems: 48,
  openPlacements: 29,
  ask: 21,
};
const SUMMARY_PATH = '/api/v1/projects/nordwind-handel/summary';

function setup(
  routes: Parameters<typeof stubApi>[0] = {},
  { projects = [existing], health = LOCAL }: { projects?: Project[]; health?: Health } = {},
) {
  const calls = stubApi(routes);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(healthQuery.queryKey, health);
  queryClient.setQueryData(projectsQuery.queryKey, projects);
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { calls, queryClient, user: userEvent.setup() };
}

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);
const openForYou = (row: HTMLElement) => within(row).getByTestId('open-for-you');
const lastChanged = (row: HTMLElement) => within(row).getByTestId('last-changed');
const summaryOf = (body: ProjectSummary) => () => json(body);

describe('the projects list', () => {
  it('shows the name with its key below, no „Stand“ and no „Rolle“ in local mode', async () => {
    setup({ [`GET ${SUMMARY_PATH}`]: summaryOf(SUMMARY) });
    const row = await screen.findByTestId('project-row');
    expect(row.textContent).toContain('Nordwind Handel GmbH');
    expect(row.textContent).toContain('nordwind-handel');
    expect(row.textContent).not.toMatch(/s277|Inhaber/);
    expect(headers()).toEqual(['Projekt', 'Offen für dich', 'Zuletzt geändert']);
  });

  it('sums the tab badges for an owner and shows the day of the latest change', async () => {
    const { calls } = setup({ [`GET ${SUMMARY_PATH}`]: summaryOf(SUMMARY) });
    const row = await screen.findByTestId('project-row');
    const cell = openForYou(row);
    await within(cell).findByText('98');
    // The split by where to act, in the title and for screen readers.
    expect(within(cell).getByTitle('48 Relationen · 29 Platzierungen · 21 Fragen')).toBeTruthy();
    expect(cell.textContent).toBe('98 offene Punkte: 48 Relationen · 29 Platzierungen · 21 Fragen');
    // Text, not a link: no one list holds all three (P7).
    expect(within(cell).queryByRole('link')).toBeNull();
    expect(lastChanged(row).textContent).toBe(formatDate(SUMMARY.lastEventAt));
    expect(lastChanged(row).textContent).toBe('18.10.2026');
    // „Angelegt“ went: the creation day shows nowhere.
    expect(row.textContent).not.toContain('07.10.2026');
    expect(calls.filter((c) => c.path === SUMMARY_PATH)).toHaveLength(1);
  });

  it('shows a placeholder while the summary loads', async () => {
    setup({ [`GET ${SUMMARY_PATH}`]: () => new Promise<Response>(() => undefined) });
    const row = await screen.findByTestId('project-row');
    expect(within(openForYou(row)).getByLabelText('Wird geladen')).toBeTruthy();
    expect(within(lastChanged(row)).getByLabelText('Wird geladen')).toBeTruthy();
    expect(openForYou(row).textContent).toBe('');
  });

  it('shows „–“ when nothing is open, and in both cells when the summary fails', async () => {
    setup(
      {
        [`GET ${SUMMARY_PATH}`]: summaryOf({
          ...SUMMARY,
          reviewItems: 0,
          openPlacements: 0,
          ask: 0,
        }),
      },
      {
        projects: [
          existing,
          { ...existing, id: 'prj_01B', key: 'kaputt', name: 'Kaputt', role: 'editor' },
        ],
      },
    );
    const [none, failed] = await screen.findAllByTestId('project-row');
    if (!none || !failed) throw new Error('two rows expected');
    await within(lastChanged(none)).findByText('18.10.2026');
    expect(openForYou(none).textContent).toBe('–');
    // The second project's summary answers 404 (not stubbed).
    await within(lastChanged(failed)).findByText('–');
    expect(openForYou(failed).textContent).toBe('–');
  });

  it('shows „–“ to a viewer, with „Rolle“ and the latest change', async () => {
    const { calls } = setup(
      {
        [`GET ${SUMMARY_PATH}`]: summaryOf(SUMMARY),
        'GET /api/v1/projects/b/summary': summaryOf(SUMMARY),
      },
      {
        projects: [
          { ...existing, role: 'viewer' },
          { ...existing, id: 'prj_01B', key: 'b', name: 'B', role: 'editor' },
        ],
      },
    );
    const [viewer, editor] = await screen.findAllByTestId('project-row');
    if (!viewer || !editor) throw new Error('two rows expected');
    expect(headers()).toEqual(['Projekt', 'Rolle', 'Offen für dich', 'Zuletzt geändert']);
    expect(viewer.textContent).toContain('Leser');
    await within(lastChanged(viewer)).findByText('18.10.2026');
    expect(openForYou(viewer).textContent).toBe('–');
    // An editor may decide: the number.
    expect(await within(openForYou(editor)).findByText('98')).toBeTruthy();
    // One summary call per row.
    expect(calls.filter((c) => c.path.endsWith('/summary')).map((c) => c.path)).toEqual([
      SUMMARY_PATH,
      '/api/v1/projects/b/summary',
    ]);
  });

  it('shows „–“ to the demo visitor, who cannot decide anything', async () => {
    setup(
      { [`GET ${SUMMARY_PATH}`]: summaryOf(SUMMARY) },
      { health: DEMO, projects: [{ ...existing, role: 'editor' }] },
    );
    const row = await screen.findByTestId('project-row');
    await within(lastChanged(row)).findByText('18.10.2026');
    expect(openForYou(row).textContent).toBe('–');
  });

  it('refreshes the counts with the project (its writes invalidate its keys)', async () => {
    let answer = SUMMARY;
    const { calls, queryClient } = setup({ [`GET ${SUMMARY_PATH}`]: () => json(answer) });
    const row = await screen.findByTestId('project-row');
    await within(openForYou(row)).findByText('98');
    answer = { ...SUMMARY, reviewItems: 47 };
    await act(() => queryClient.invalidateQueries({ queryKey: keys.project('nordwind-handel') }));
    expect(await within(openForYou(row)).findByText('97')).toBeTruthy();
    expect(calls.filter((c) => c.path === SUMMARY_PATH)).toHaveLength(2);
  });
});

describe('„Neues Projekt“', () => {
  it('derives the key from the name as one line and opens the field on demand', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /Neues Projekt/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Ein Projekt ist eine Prozesslandschaft.');
    expect(dialog.textContent).not.toContain('Inhaber');
    expect(within(dialog).queryByLabelText('Kurzname')).toBeNull();
    await user.type(within(dialog).getByLabelText('Name'), 'Kunde Maschinenbau');
    expect(within(dialog).getByTestId('key-preview').textContent).toBe(
      'Kurzname: kunde-maschinenbau (ändern)',
    );
    await user.click(within(dialog).getByRole('button', { name: '(ändern)' }));
    const field = within(dialog).getByLabelText('Kurzname');
    expect((field as HTMLInputElement).value).toBe('kunde-maschinenbau');
  });

  it('shows the field at once for a name that derives no key, keeping the focus in the name', async () => {
    const { user, calls } = setup({
      'POST /api/v1/projects': (call) => json({ ...existing, ...(call.body as object) }, 201),
    });
    await user.click(await screen.findByRole('button', { name: /Neues Projekt/ }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText('Name');
    await user.type(name, '数据');
    // no Latin letters or digits: no key to derive, so the field shows (no dead end)
    const field = within(dialog).getByLabelText('Kurzname');
    expect((field as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(name);
    expect(within(dialog).queryByTestId('key-preview')).toBeNull();
    const create = within(dialog).getByRole('button', { name: 'Projekt anlegen' });
    expect(create).toHaveProperty('disabled', true);
    await user.type(field, 'daten');
    // typing a key keeps the field open
    expect(within(dialog).getByLabelText('Kurzname')).toBeTruthy();
    expect(create).toHaveProperty('disabled', false);
    await user.click(create);
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { key: 'daten', name: '数据' },
    ]);
  });

  it('says in German that a key is taken, with the field open', async () => {
    const { user, calls } = setup({
      'POST /api/v1/projects': () =>
        json(
          {
            type: 'urn:analyzr:problem:conflict',
            title: 'Conflict',
            status: 409,
            code: 'conflict',
            detail: 'project key nordwind-handel already exists',
          },
          409,
        ),
    });
    await user.click(await screen.findByRole('button', { name: /Neues Projekt/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Nordwind Handel');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    expect(
      await within(dialog).findByText(
        'Den Kurznamen „nordwind-handel“ gibt es schon. Wähl einen anderen.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByLabelText('Kurzname')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { key: 'nordwind-handel', name: 'Nordwind Handel' },
    ]);
  });
});
