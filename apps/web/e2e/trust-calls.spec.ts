import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';

/**
 * The trust rule's fast path (M6 S2c-2) against a running server with the
 * built UI: the integrate skill's golden bundle (synthetic Signavio, no
 * engine) into projects of their own per run, once through „Hochladen“ (the
 * owner session) and once through `analyzr import` with an agent token (as
 * `ui-load.spec.ts` imports `signavio-beispiel`). Its one unique call
 * („Rechnung stellen“) arrives as a proposal at 90 %. Checked: the CLI says
 * so on stderr before sending and names the step on stdout with the web link
 * that opens the bulk dialog; „Als Nächstes“ after „Importieren“ and on
 * „Übersicht“ counts exactly the calls the bulk dialog behind „Gesammelt
 * annehmen“ selects (`?bulk=calls`), as does the system rule card on
 * „Annahmeregeln“; closing it drops `?bulk` and leaves the focus on the page;
 * one click accepts them, the toast shows (since M6 S2c-3 offering the owner
 * of the web upload the rule for the caller's `export` source, and nothing
 * after the agent token's import, whose calls no rule accepts), the URL
 * loses `?bulk`, the relation is accepted by the human, and every line is
 * gone. Skips itself when no server answers.
 */

const ROOT = join(import.meta.dirname, '../../..');
const BUNDLE = join(ROOT, 'tools/integrate/test/fixtures/signavio/bundle');
const CLI_MAIN = join(ROOT, 'apps/cli/src/main.ts');
const RUN = Date.now().toString(36);

interface Relation {
  id: string;
  type: string;
  tier: string;
  status: string;
  attrs: Record<string, unknown>;
  provenance: { sourceKind: string; verdict: string | null; question: string | null } | null;
  noLinks: unknown[];
}

let owner: APIRequestContext;
let base = '';

/**
 * The web's `isBulkCall` (apps/web/src/lib/review.ts), over the API's
 * relations: an open unique call from a derived model with no agent's
 * question and no no-link, what „Gesammelt annehmen“ selects.
 */
const isBulkCall = (r: Relation) =>
  r.type === 'call' &&
  r.tier === 'key' &&
  r.status === 'proposed' &&
  r.attrs['match'] === 'derived-caller' &&
  !r.provenance?.question?.trim() &&
  r.noLinks.length === 0;

async function relations(key: string): Promise<Relation[]> {
  const response = await owner.get(`/api/v1/projects/${key}/landscape`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { relations: Relation[] }).relations;
}

async function create(key: string, name: string): Promise<void> {
  expect((await owner.post('/api/v1/projects', { data: { key, name } })).status()).toBe(201);
}

/** `analyzr import` with `token` in ANALYZR_TOKEN: stdout and stderr. */
function cliImport(key: string, token: string): Promise<{ out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [CLI_MAIN, 'import', BUNDLE, '--project', key, '--url', base],
      { env: { ...process.env, ANALYZR_TOKEN: token } },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve({ out, err }) : reject(new Error(`exit ${String(code)}: ${err}${out}`)),
    );
  });
}

/** The ids the open bulk dialog has selected. */
async function selected(page: Page): Promise<string[]> {
  return page
    .getByTestId('bulk-dialog')
    .locator('[data-testid=bulk-row]:has([role=checkbox][aria-checked=true])')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-relation-id') ?? ''));
}

/**
 * The dialog `?bulk=calls` opened: its group counts `expected`, exactly those
 * are selected; „n annehmen“ accepts them, the toast names them with
 * `toastText`, the dialog closes and `?bulk` goes.
 */
async function acceptCalls(
  page: Page,
  key: string,
  expected: readonly string[],
  toastText: string,
): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/review\\?bulk=calls$`));
  const dialog = page.getByTestId('bulk-dialog');
  await expect(dialog.getByTestId('bulk-calls').getByRole('heading')).toHaveText(
    `Eindeutige Aufrufe aus abgeleiteten Modellen (${expected.length})`,
  );
  await expect(dialog.getByTestId('bulk-summary')).toHaveText(
    new RegExp(`^${expected.length} von \\d+ ausgewählt$`),
  );
  expect(new Set(await selected(page))).toEqual(new Set(expected));
  await dialog.getByTestId('bulk-confirm').click();
  const toast = page.getByTestId('toast').filter({
    hasText: `${expected.length === 1 ? '1 Relation' : `${expected.length} Relationen`} angenommen`,
  });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(toastText);
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/review$`));
  const after = await relations(key);
  for (const id of expected) {
    const r = after.find((x) => x.id === id);
    expect(r?.status, id).toBe('accepted');
    expect(r?.provenance, id).toMatchObject({ sourceKind: 'human', verdict: 'accept' });
  }
  expect(after.filter(isBulkCall)).toEqual([]);
}

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

test('„Hochladen“ of an engine-less bundle: „Gesammelt annehmen“ after „Importieren“ accepts its unique calls', async ({
  page,
}) => {
  const key = `trust-web-${RUN}`;
  await create(key, 'Vertrauensregel (Web)');
  await page.goto(`/projects/${key}/upload`);
  await page.getByTestId('folder-input').setInputFiles(BUNDLE);
  await expect(page.getByTestId('import-headline')).toHaveText('Vorschau: 6 Modelle neu', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('preview-impact')).toContainText(
    '1 Aufruf nur vorgeschlagen (ohne Camunda-Engine)',
  );
  await page.getByTestId('preview-import').click();
  await expect(page.getByTestId('import-headline')).toHaveText('6 Modelle importiert', {
    timeout: 30_000,
  });
  const derived = (await relations(key)).filter(isBulkCall).map((r) => r.id);
  expect(derived).toHaveLength(1);
  // first in „Als Nächstes“, before the agent's line
  const next = page.getByTestId('upload-next');
  const calls = next.getByTestId('upload-next-calls');
  await expect(calls).toHaveText(
    '1 eindeutiger Aufruf wartet auf deine Bestätigung·Gesammelt annehmen',
  );
  // (the questions there are already may follow)
  expect(
    (
      await next
        .locator('li[data-testid]')
        .evaluateAll((items) => items.map((li) => li.getAttribute('data-testid')))
    ).slice(0, 2),
  ).toEqual(['upload-next-calls', 'upload-next-agent']);
  await calls.getByRole('link', { name: 'Gesammelt annehmen' }).click();
  // the caller declares `export` and the owner has no rule for it: the toast offers one (S2c-3)
  await acceptCalls(
    page,
    key,
    derived,
    'Eindeutige Aufrufe aus abgeleiteten Modellen künftig automatisch annehmen?',
  );
  // „Übersicht“: the line is gone
  await page.goto(`/projects/${key}`);
  await expect(page.getByTestId('next-step-primary')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid=next-step-line][data-kind=calls]')).toHaveCount(0);
});

test('`analyzr import` with an agent token: the CLI says so, „Übersicht“ and the rule card open exactly those calls', async ({
  page,
}) => {
  const key = `trust-cli-${RUN}`;
  await create(key, 'Vertrauensregel (CLI)');
  const response = await owner.post(`/api/v1/projects/${key}/agent-tokens`, {
    data: { name: 'trust-calls', scopes: ['analyzr:read', 'analyzr:write'], expiresInDays: 1 },
  });
  expect(response.status()).toBe(201);
  const writer = (await response.json()) as { id: string; secret: string };
  const { out, err } = await cliImport(key, writer.secret);
  expect(err).toContain(
    'importing with an agent token (ANALYZR_TOKEN): unique calls become proposals (trust rule); unset ANALYZR_TOKEN to import with the owner key',
  );
  expect(out).toContain(
    [
      'next: 6 models are derived (no engine 6); 1 unique call is a proposal: accept it in the web review before the agent runs:',
      `  ${base}/projects/${key}/review?bulk=calls`,
    ].join('\n'),
  );
  // no agent connected: the project waits for one („Agent verbinden“ leads)
  expect((await owner.delete(`/api/v1/projects/${key}/agent-tokens/${writer.id}`)).status()).toBe(
    204,
  );
  const derived = (await relations(key)).filter(isBulkCall).map((r) => r.id);
  expect(derived).toHaveLength(1);

  // the CLI's link opens the bulk dialog with exactly those selected
  await page.goto(`/projects/${key}/review?bulk=calls`);
  await expect(page.getByTestId('bulk-dialog')).toBeVisible({ timeout: 30_000 });
  expect(new Set(await selected(page))).toEqual(new Set(derived));
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/review$`));
  // opened by the URL, nothing had the focus: „Vorschläge prüfen“ gets it back
  await expect(page.getByTestId('review-start')).toBeFocused();

  // the rule card's count opens the same group
  await page.goto(`/projects/${key}/rules`);
  const card = page.getByTestId('system-rule-proposed');
  await expect(card).toHaveText(`${derived.length} aus abgeleiteten Modellen vorgeschlagen`, {
    timeout: 30_000,
  });
  await card.click();
  await expect(page.getByTestId('bulk-dialog')).toBeVisible({ timeout: 30_000 });
  expect(new Set(await selected(page))).toEqual(new Set(derived));
  // closing drops `?bulk`, so a reload does not open it again
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/review$`));
  await page.reload();
  await expect(page.getByTestId('review-start')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('bulk-dialog')).toHaveCount(0);

  // „Übersicht“: the calls line instead of „Vorschläge prüfen“ for the same rows
  await page.goto(`/projects/${key}`);
  const line = page.locator('[data-testid=next-step-line][data-kind=calls]');
  await expect(line).toHaveText('1 eindeutigen Aufruf zuerst bestätigen · Gesammelt annehmen', {
    timeout: 30_000,
  });
  await expect(page.locator('[data-testid=next-step-line][data-kind=review-too]')).toHaveCount(0);
  await line.getByRole('link', { name: 'Gesammelt annehmen' }).click();
  // an agent token's upload: no rule could accept its calls, so nothing is offered (S2c-3)
  await acceptCalls(page, key, derived, 'Eindeutige Aufrufe aus abgeleiteten Modellen.');
  await page.goto(`/projects/${key}`);
  await expect(page.getByTestId('next-step-primary')).toBeVisible({ timeout: 30_000 });
  await expect(line).toHaveCount(0);
  await page.goto(`/projects/${key}/rules`);
  await expect(page.getByTestId('system-rule')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('system-rule-proposed')).toHaveCount(0);
});
