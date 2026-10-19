import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';

/**
 * Screenshots of the M1 UI for docs/screenshots, taken from a running
 * analyzr with the seeded landscapes (`analyzr seed`). Opt-in: runs only with
 * ANALYZR_SCREENSHOTS_DIR set, e.g.
 *
 *   ANALYZR_SCREENSHOTS_DIR=$PWD/docs/screenshots pnpm --filter @analyzr/web e2e screenshots
 *
 * The connect page creates an agent token named "Screenshot"; its secret is
 * blanked in the page before each screenshot, and the token is revoked after.
 */

const DIR = process.env['ANALYZR_SCREENSHOTS_DIR'];
const PROJECT = process.env['ANALYZR_SCREENSHOTS_PROJECT'] ?? 'nordwind-handel';
/** An accepted call of nordwind-handel (rule tier), shown in the model view. */
const CALL_FROM = 'finanzen/forderungsmanagement#Call_Mahnwesen';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  test.skip(!DIR, 'set ANALYZR_SCREENSHOTS_DIR to take the screenshots');
  const mode = await probeServer(request);
  test.skip(mode === 'down', 'no analyzr server at ANALYZR_E2E_URL');
  test.skip(mode === 'demo', DEMO_SKIP);
  mkdirSync(DIR ?? '.', { recursive: true });
});

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  // Let fonts and the last layout settle; no animation is captured.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: join(DIR ?? '.', `${name}.png`),
    animations: 'disabled',
    fullPage,
  });
}

/** Never put a live secret into an image: blank every full secret (prefixes may stay). */
async function blankSecrets(page: Page): Promise<void> {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      n.textContent = (n.textContent ?? '').replace(/analyzr_at_[A-Za-z0-9]{20,}/g, 'analyzr_at_…');
    }
  });
  await expect(page.locator('body')).not.toContainText(/analyzr_at_[A-Za-z0-9]{20,}/);
}

test('projects', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Nordwind Handel/ })).toBeVisible();
  await shot(page, '01-projects');
});

test('„Übersicht“: the next step, phase chips and the models table', async ({ page }) => {
  await page.goto(`/projects/${PROJECT}`);
  await expect(page.getByTestId('model-row').first()).toBeVisible();
  await expect(page.getByTestId('next-step')).toContainText('Als Nächstes');
  await expect(page.locator('[data-testid=stage-filter]').first()).toBeVisible();
  // The counts load in parallel; on a fresh stack the open questions answer last.
  await expect(
    page.getByTestId('project-tabs').getByRole('link', { name: /Offene Fragen.*\d/ }),
  ).toBeVisible({ timeout: 30_000 });
  await shot(page, '02-models');
});

test('relations: rule acceptances and key-tier proposals', async ({ page }) => {
  await page.goto(`/projects/${PROJECT}/relations`);
  await expect(
    page.locator('[data-testid=relation-row][data-status=accepted][data-tier=rule]').first(),
  ).toBeVisible();
  await expect(page.getByTestId('relation-row').first().getByTestId('decided-by')).toHaveText(
    'analyzr',
  );
  await shot(page, '03-relations');
});

test('model view with a highlighted relation', async ({ page }) => {
  await page.goto(`/projects/${PROJECT}/relations?status=accepted`);
  const row = page.locator('[data-testid=relation-row][data-status=accepted]', {
    hasText: 'Mahnwesen',
  });
  // UX9: „Öffnen“ is the row's one action; the review screen's „Von“ chip leads to the model
  await row
    .first()
    .getByRole('link', { name: /öffnen$/ })
    .click();
  await page
    .getByTestId('pane-chip')
    .filter({ hasText: /^Von/ })
    .getByRole('link', { name: 'Im Modell' })
    .click();
  await expect(page).toHaveURL(/\/models\/finanzen\/forderungsmanagement\?relation=rel_/);
  await expect(page.getByTestId('bpmn-canvas')).toHaveAttribute('data-imported', 'true');
  const [, element] = CALL_FROM.split('#');
  await expect(
    page.locator(`.djs-element.analyzr-endpoint[data-element-id=${element}]`),
  ).toHaveCount(1);
  await expect(page.locator('.analyzr-overlay', { hasText: 'Von' })).toBeVisible();
  await shot(page, '04-model-view');
});

test('findings', async ({ page }) => {
  await page.goto(`/projects/${PROJECT}/findings`);
  await expect(page.getByTestId('finding').first()).toBeVisible();
  await shot(page, '05-findings');
});

test('connect an agent: token and client configurations', async ({ page }) => {
  await page.goto(`/projects/${PROJECT}/agents`);
  await page.getByLabel('Name').fill('Screenshot');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/projects/${PROJECT}/agent-tokens`),
  );
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  const token = (await (await created).json()) as { id: string };
  try {
    await expect(page.getByTestId('created-secret')).toContainText('analyzr_at_');
    await blankSecrets(page);
    await shot(page, '06-connect-agent', true);

    // Claude Desktop with analyzr in Docker: `analyzr mcp` via docker exec, absolute docker path.
    await page.getByRole('tab', { name: 'Claude Desktop' }).click();
    await page.getByRole('radio', { name: 'Im Docker-Container' }).click();
    await page.getByLabel('Docker', { exact: true }).fill('/usr/local/bin/docker');
    await expect(page.getByTestId('code-block')).toContainText('analyzr-server-1');
    await blankSecrets(page);
    await shot(page, '07-connect-claude-desktop', true);
  } finally {
    const revoked = await page.request.delete(
      `/api/v1/projects/${PROJECT}/agent-tokens/${token.id}`,
    );
    expect(revoked.status()).toBe(204);
  }
});
