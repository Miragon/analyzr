/**
 * „Agent starten“ and „Nochmal versuchen“ (UX-SIMPLIFICATION.md §2.6): the
 * popover's commands wrap instead of being cut, its last line names where the
 * proposals appear, and „Nochmal versuchen“ requeues once and toggles its
 * popover; editors get a plain button without popup semantics.
 */
import type { Project } from '@analyzr/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AgentStartPanel, RetryAgent } from '../src/components/agent-start';
import { agentToken } from './support/fixtures';
import { findToast, json, renderWithRouter, stubApi } from './support/render';

const BASE = '/api/v1/projects/demo';

function project(role: Project['role']): Project {
  return {
    id: 'prj_01DEMO',
    key: 'demo',
    name: 'Demo',
    role,
    lastSeq: 7,
    createdAt: '2026-10-07T09:00:00.000Z',
  };
}

function routes(role: Project['role']) {
  return stubApi({
    'GET /health': () => json({ status: 'ok', version: '0.1.0-test', db: 'ok' }),
    [`GET ${BASE}`]: () => json(project(role)),
    [`GET ${BASE}/agent-tokens`]: () =>
      json({ items: [agentToken({ id: 'agt_01A', name: 'claude' })] }),
    [`POST ${BASE}/analyses/requeue`]: () =>
      json({ items: [{ modelKey: 'a/failed', outcome: 'queued', taskId: null }] }),
  });
}

describe('„Agent starten“', () => {
  it('wraps the commands instead of cutting them, and names where proposals appear', async () => {
    stubApi({});
    await renderWithRouter(<AgentStartPanel project="nordwind-handel" state="start" hasChain />);
    const panel = screen.getByTestId('agent-start');
    for (const code of panel.querySelectorAll('code')) {
      expect(code.className).not.toContain('truncate');
      expect(code.className).toContain('break-all');
    }
    expect(panel.textContent).toContain('/analyzr:placements nordwind-handel');
    expect(panel.textContent).toContain(
      'Die Vorschläge erscheinen unter „Relationen“ und auf der „Wertschöpfungskette“. Entscheiden kannst nur du.',
    );
  });

  it('„Nochmal versuchen“ requeues once and opens the popover; clicked again it closes it', async () => {
    const calls = routes('owner');
    await renderWithRouter(<RetryAgent project="demo" modelKeys={['a/failed']} hasChain={false} />);
    const user = userEvent.setup();
    // the popup's trigger once the owner's tokens are known
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Nochmal versuchen' }).getAttribute('aria-haspopup'),
      ).toBe('dialog'),
    );
    const retry = screen.getByRole('button', { name: 'Nochmal versuchen' });
    await user.click(retry);
    expect(await screen.findByTestId('agent-start')).toBeTruthy();
    await user.click(retry);
    await waitFor(() => expect(screen.queryByTestId('agent-start')).toBeNull());
    const requeues = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/requeue'));
    expect(requeues).toHaveLength(1);
    expect(requeues[0]?.body).toEqual({ modelKeys: ['a/failed'] });
  });

  it('gives editors a plain button: no popup, every click a requeue with a toast', async () => {
    const calls = routes('editor');
    await renderWithRouter(<RetryAgent project="demo" modelKeys={['a/failed']} hasChain={false} />);
    const user = userEvent.setup();
    const retry = await screen.findByRole('button', { name: 'Nochmal versuchen' });
    expect(retry.hasAttribute('aria-haspopup')).toBe(false);
    expect(retry.hasAttribute('aria-expanded')).toBe(false);
    await user.click(retry);
    await findToast('Nochmal eingeplant');
    expect(screen.queryByTestId('agent-start')).toBeNull();
    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/requeue'))).toHaveLength(1);
  });
});
