import { join } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';

/**
 * „Vor der Vertrauensregel angenommen“ (M6 S2c-4, owner decisions 24.2 (a)
 * and 28 (3)) against a running server with the built UI.
 *
 * A revision stored before the trust rule cannot be made through the API:
 * since S2c-1 the server writes `source.trust` last on every uploaded
 * revision, a declared `trust` never reaches it, and no route writes a
 * revision's source. So the server side of the flow (the list, „Zurück in
 * die Prüfung“ turning the calls into proposals, an owner's rule accepting
 * them again in the same write, „Behalten“, the refusals and the dry-run
 * property) is covered by `apps/server/test/integration/trust-review.test.ts`,
 * which strips the class by SQL. Here:
 * - against the server: a project imported now (the integrate skill's golden
 *   Signavio bundle through „Hochladen“) lists nothing, the system rule card
 *   has no line, a review of its classified caller is refused (422
 *   `revision-classified`) and an agent token gets 403;
 * - in the browser, with the list and the review's answers stubbed
 *   (`page.route`; the card's count patched into the real rules list): the
 *   card's line opens the dialog (every model selected with its reasons and
 *   count), unticking a model changes the dry-run line, „Zurück in die
 *   Prüfung“ sends the selection with the list's count, and the toast's
 *   „Gesammelt annehmen“ opens the real bulk dialog of the project's review.
 * Skips itself when no server answers.
 */

const ROOT = join(import.meta.dirname, '../../..');
const BUNDLE = join(ROOT, 'tools/integrate/test/fixtures/signavio/bundle');
const RUN = Date.now().toString(36);
const KEY = `pretrust-${RUN}`;

const REV_A = 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2A1';
const REV_B = 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2B1';
/** The stubbed list: two models stored before the trust rule. */
const LIST = {
  count: 3,
  models: [
    {
      modelId: 'mdl_01J9Z3N4X5Q6R7S8T9V0W1X2A1',
      modelKey: 'vertrieb/auftragsabwicklung',
      modelName: 'Auftragsabwicklung',
      revisionId: REV_A,
      rev: 1,
      reasons: ['no-engine'],
      derivedKind: 'export',
      converter: null,
      count: 2,
      calls: [],
    },
    {
      modelId: 'mdl_01J9Z3N4X5Q6R7S8T9V0W1X2B1',
      modelKey: 'lager/einlagerung',
      modelName: 'Einlagerung',
      revisionId: REV_B,
      rev: 2,
      reasons: ['agent-upload'],
      derivedKind: null,
      converter: null,
      count: 1,
      calls: [],
    },
  ],
};

let owner: APIRequestContext;
let base = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  base = baseURL ?? 'http://127.0.0.1:7400';
  const probe = await playwright.request.newContext({ baseURL: base });
  const mode = await probeServer(probe);
  await probe.dispose();
  test.skip(mode === 'down', 'no analyzr server at ANALYZR_E2E_URL; start one to run this flow');
  test.skip(mode === 'demo', DEMO_SKIP);
  owner = await playwright.request.newContext({ baseURL: base });
  expect((await owner.post('/api/v1/session', { data: { client: 'analyzr-web' } })).ok()).toBe(
    true,
  );
});

test.afterAll(async () => {
  await owner?.dispose();
});

test('a project imported since the trust rule lists nothing; its classified caller is never reviewed', async ({
  page,
  playwright,
}) => {
  expect(
    (
      await owner.post('/api/v1/projects', { data: { key: KEY, name: 'Vor der Vertrauensregel' } })
    ).status(),
  ).toBe(201);
  await page.goto(`/projects/${KEY}/upload`);
  await page.getByTestId('folder-input').setInputFiles(BUNDLE);
  await expect(page.getByTestId('import-headline')).toHaveText('Vorschau: 6 Modelle neu', {
    timeout: 30_000,
  });
  await page.getByTestId('preview-import').click();
  await expect(page.getByTestId('import-headline')).toHaveText('6 Modelle importiert', {
    timeout: 30_000,
  });

  const list = await owner.get(`/api/v1/projects/${KEY}/pre-trust-calls`);
  expect(list.status()).toBe(200);
  expect(await list.json()).toEqual({ count: 0, models: [] });
  await page.goto(`/projects/${KEY}/rules`);
  await expect(page.getByTestId('system-rule')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('system-rule-pre-trust')).toHaveCount(0);

  // The trust rule classified every revision of this import: a review is refused.
  const models = (
    (await (await owner.get(`/api/v1/projects/${KEY}/models?limit=200`)).json()) as {
      items: { headRevisionId: string; trust: { class: string } | null }[];
    }
  ).items;
  expect(models.every((m) => m.trust !== null)).toBe(true);
  const refused = await owner.post(`/api/v1/projects/${KEY}/pre-trust-calls/review?dryRun=true`, {
    data: { verdict: 'modelled', revisionIds: [models[0]?.headRevisionId] },
  });
  expect(refused.status()).toBe(422);
  expect(await refused.json()).toMatchObject({ reason: 'revision-classified' });

  // Agents never see it.
  const token = await owner.post(`/api/v1/projects/${KEY}/agent-tokens`, {
    data: { name: 'pre-trust', scopes: ['analyzr:read', 'analyzr:write'], expiresInDays: 1 },
  });
  expect(token.status()).toBe(201);
  const { id, secret } = (await token.json()) as { id: string; secret: string };
  const agent = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { authorization: `Bearer ${secret}` },
  });
  expect((await agent.get(`/api/v1/projects/${KEY}/pre-trust-calls`)).status()).toBe(403);
  await agent.dispose();
  expect((await owner.delete(`/api/v1/projects/${KEY}/agent-tokens/${id}`)).status()).toBe(204);
});

test('the card’s line opens the dialog; „Zurück in die Prüfung“ sends the selection; the toast leads to „Gesammelt annehmen“', async ({
  page,
}) => {
  const reviews: unknown[] = [];
  await page.route(`**/api/v1/projects/${KEY}/auto-accept-rules`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as { system: { preTrust: number } };
    body.system.preTrust = LIST.count;
    return route.fulfill({ response, json: body });
  });
  await page.route(`**/api/v1/projects/${KEY}/pre-trust-calls`, (route) =>
    route.fulfill({ json: LIST }),
  );
  await page.route(`**/api/v1/projects/${KEY}/pre-trust-calls/review**`, (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { verdict: string; revisionIds: string[] };
    const count = LIST.models
      .filter((m) => body.revisionIds.includes(m.revisionId))
      .reduce((n, m) => n + m.count, 0);
    const dryRun = new URL(request.url()).searchParams.get('dryRun') === 'true';
    if (!dryRun) reviews.push(body);
    return route.fulfill({
      json: {
        dryRun,
        verdict: body.verdict,
        revisions: body.revisionIds.length,
        count,
        toProposed: count,
        autoAcceptedCalls: { count: 0, items: [], ofProposed: 0, byRule: [] },
      },
    });
  });

  await page.goto(`/projects/${KEY}/rules`);
  const line = page.getByTestId('system-rule-pre-trust');
  await expect(line).toHaveText('3 vor der Vertrauensregel angenommen – prüfen…', {
    timeout: 30_000,
  });
  await line.click();
  const dialog = page.getByTestId('pre-trust-dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Vor der Vertrauensregel angenommen');
  await expect(dialog.getByTestId('pre-trust-model')).toHaveText([
    /Auftragsabwicklung\s*2 Aufrufe · ohne Camunda-Engine/,
    /Einlagerung\s*1 Aufruf · über ein Agenten-Token hochgeladen/,
  ]);
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await expect(dialog.getByTestId('pre-trust-summary')).toHaveText(
    '3 Aufrufe gehen zurück in die Prüfung.',
  );
  // „Behalten“ is decided once, and the dialog says so.
  await expect(dialog.getByTestId('pre-trust-keep-note')).toHaveText(
    '„Behalten“ lässt sie angenommen; danach fragt analyzr bei diesen Modellen nicht mehr.',
  );
  // One primary, one secondary.
  await expect(dialog.getByTestId('pre-trust-revoke')).toHaveText('Zurück in die Prüfung');
  await expect(dialog.getByTestId('pre-trust-keep')).toHaveText('Behalten');

  await dialog.getByRole('checkbox', { name: /Einlagerung/ }).click();
  await expect(dialog.getByTestId('pre-trust-summary')).toHaveText(
    '2 Aufrufe gehen zurück in die Prüfung.',
  );
  await dialog.getByTestId('pre-trust-revoke').click();
  await expect(dialog).toHaveCount(0);
  expect(reviews).toEqual([{ verdict: 'derived', revisionIds: [REV_A], expectedCount: 2 }]);
  const toast = page.getByTestId('toast').filter({ hasText: '2 Aufrufe zurück in der Prüfung' });
  await expect(toast).toBeVisible();
  // The project's own unique call (the bundle's „Rechnung stellen“) waits there.
  await toast.getByTestId('toast-action').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/review\\?bulk=calls$`));
  await expect(page.getByTestId('bulk-dialog')).toBeVisible({ timeout: 30_000 });
});
