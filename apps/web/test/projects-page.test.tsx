/**
 * The projects list's „Neues Projekt“ (UX-SIMPLIFICATION.md §3.12 item 4, UX1):
 * the key follows the name as one line „Kurzname: … (ändern)“, the field opens
 * on demand, and a taken key says so in German with the field open.
 */
import type { Health, Project } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import { healthQuery, projectsQuery } from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import { json, stubApi } from './support/render';

const LOCAL: Health = { status: 'ok', version: '0.1.0-test', db: 'ok' };
const existing: Project = {
  id: 'prj_01A',
  key: 'nordwind-handel',
  name: 'Nordwind Handel GmbH',
  role: 'owner',
  lastSeq: 277,
  createdAt: '2026-10-07T09:00:00.000Z',
};

function setup(routes: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi(routes);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(healthQuery.queryKey, LOCAL);
  queryClient.setQueryData(projectsQuery.queryKey, [existing]);
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { calls, user: userEvent.setup() };
}

describe('the projects list', () => {
  it('shows the name with its key below, no „Stand“ and no „Rolle“ in local mode', async () => {
    setup();
    const row = await screen.findByTestId('project-row');
    expect(row.textContent).toContain('Nordwind Handel GmbH');
    expect(row.textContent).toContain('nordwind-handel');
    expect(row.textContent).not.toMatch(/s277|Inhaber/);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Projekt',
      'Angelegt',
    ]);
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
