import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';

/**
 * Rules for derived calls (M6 S2c-3, decision 24.2's extension of decision
 * 19, owner decision 28 (1)) against a running server with the built UI,
 * with the integrate skill's golden bundle (synthetic Signavio, no engine;
 * its one unique call „Rechnung stellen“ comes from a model declared
 * `export`) in projects of their own per run:
 * - after „Gesammelt annehmen“ the toast offers an owner the rule for that
 *   source; its action opens „Neue Regel“ prefilled („Eindeutige Aufrufe aus
 *   abgeleiteten Modellen“, „Export ohne Camunda-Engine“), saved active;
 * - in a fresh project the owner creates and enables the rule in the dialog,
 *   then „Hochladen“ (the owner session, a human upload like the owner key)
 *   says in „Vorschau“ that the rule takes the call, and after
 *   „Importieren“ the call is accepted and marked, with no „Gesammelt
 *   annehmen“ line; the review screen names the call proposal as its
 *   trigger;
 * - an import of the same bundle with an agent token into a project with the
 *   same rule leaves the call a proposal: the rule's preview names the
 *   safeguard „Über ein Agenten-Token hochgeladen“;
 * - the rule's „Widerrufen…“ returns the call to the rule tier's proposal.
 * Skips itself when no server answers.
 */

const ROOT = join(import.meta.dirname, '../../..');
const BUNDLE = join(ROOT, 'tools/integrate/test/fixtures/signavio/bundle');
const CLI_MAIN = join(ROOT, 'apps/cli/src/main.ts');
const RUN = Date.now().toString(36);
const RULE_NAME = 'Aufrufe: Export ohne Engine';

interface Relation {
  id: string;
  type: string;
  tier: string;
  status: string;
  attrs: Record<string, unknown>;
  provenance: { sourceKind: string; verdict: string | null } | null;
}

let owner: APIRequestContext;
let base = '';

const isDerivedCall = (r: Relation) =>
  r.type === 'call' && r.tier === 'key' && r.attrs['match'] === 'derived-caller';

async function relations(key: string): Promise<Relation[]> {
  const response = await owner.get(`/api/v1/projects/${key}/landscape`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { relations: Relation[] }).relations;
}

/** The one unique call of the bundle („Rechnung stellen“), by its marker. */
async function theCall(key: string): Promise<Relation> {
  const calls = (await relations(key)).filter(
    (r) => r.type === 'call' && r.attrs['match'] === 'derived-caller',
  );
  expect(calls).toHaveLength(1);
  return calls[0]!;
}

async function create(key: string, name: string): Promise<void> {
  expect((await owner.post('/api/v1/projects', { data: { key, name } })).status()).toBe(201);
}

/** An enabled rule for derived calls declared `export`, over REST (owner session). */
async function exportRule(key: string): Promise<string> {
  const response = await owner.post(`/api/v1/projects/${key}/auto-accept-rules`, {
    data: {
      name: RULE_NAME,
      kind: 'relation',
      tier: 'key',
      minConfidence: 0.9,
      relationType: 'call',
      proposedBy: 'rule',
      derivedKind: 'export',
      enabled: true,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { rule: { id: string } }).rule.id;
}

/** `analyzr import` with `token` in ANALYZR_TOKEN. */
function cliImport(key: string, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [CLI_MAIN, 'import', BUNDLE, '--project', key, '--url', base],
      { env: { ...process.env, ANALYZR_TOKEN: token } },
    );
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`exit ${String(code)}: ${out}`)),
    );
  });
}

/** „Hochladen“ of the bundle with the owner session: the preview, then „Importieren“. */
async function upload(page: Page, key: string): Promise<void> {
  await page.goto(`/projects/${key}/upload`);
  await page.getByTestId('folder-input').setInputFiles(BUNDLE);
  await expect(page.getByTestId('import-headline')).toHaveText('Vorschau: 6 Modelle neu', {
    timeout: 30_000,
  });
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

test('after „Gesammelt annehmen“ the toast offers the rule for the calls’ source, prefilled', async ({
  page,
}) => {
  const key = `dcr-offer-${RUN}`;
  await create(key, 'Regel für abgeleitete Aufrufe (Angebot)');
  await upload(page, key);
  await page.getByTestId('preview-import').click();
  await expect(page.getByTestId('import-headline')).toHaveText('6 Modelle importiert', {
    timeout: 30_000,
  });
  await page
    .getByTestId('upload-next-calls')
    .getByRole('link', { name: 'Gesammelt annehmen' })
    .click();
  const dialog = page.getByTestId('bulk-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByTestId('bulk-confirm').click();
  const toast = page.getByTestId('toast').filter({
    hasText: 'Eindeutige Aufrufe aus abgeleiteten Modellen künftig automatisch annehmen?',
  });
  await expect(toast).toBeVisible();
  await toast.getByTestId('toast-action').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/rules$`), { timeout: 30_000 });
  const rule = page.getByTestId('rule-dialog');
  await expect(rule.getByLabel('Art')).toHaveValue('calls');
  await expect(rule.getByLabel('Herkunft')).toHaveValue('export');
  await expect(rule.getByLabel('Name')).toHaveValue(RULE_NAME);
  await expect(rule.getByTestId('rule-source-hint')).toHaveText(
    'Die Herkunft gibt der Import an; analyzr prüft sie nicht. Über ein Agenten-Token hochgeladene Modelle nimmt keine Regel an.',
  );
  await rule.getByRole('switch', { name: 'Aktiv' }).click();
  await rule.getByTestId('rule-save').click();
  await expect(
    page.getByTestId('toast').filter({ hasText: `Regel „${RULE_NAME}“ angelegt und aktiviert` }),
  ).toBeVisible();
  await expect(page.getByTestId('rule-row').getByTestId('rule-criteria')).toHaveText(
    'Eindeutige Aufrufe aus abgeleiteten Modellen · Export ohne Camunda-Engine',
  );
  // the call accepted by hand stays a plain human acceptance
  expect((await theCall(key)).provenance).toMatchObject({ sourceKind: 'human', verdict: 'accept' });
});

test('with the rule active, „Hochladen“ accepts the calls of that source at once, marked; revoking returns them', async ({
  page,
}) => {
  const key = `dcr-web-${RUN}`;
  await create(key, 'Regel für abgeleitete Aufrufe (Web)');
  // the owner creates and enables the rule in the dialog
  await page.goto(`/projects/${key}/rules`);
  await page.getByTestId('new-rule').click();
  const rule = page.getByTestId('rule-dialog');
  await rule.getByLabel('Art').selectOption('calls');
  await rule.getByLabel('Herkunft').selectOption('export');
  await expect(rule.getByLabel('Name')).toHaveValue(RULE_NAME);
  await expect(rule.getByLabel('Grundlage')).toHaveCount(0);
  await rule.getByRole('switch', { name: 'Aktiv' }).click();
  await rule.getByTestId('rule-save').click();
  await expect(page.getByTestId('rule-row')).toHaveCount(1, { timeout: 30_000 });

  await upload(page, key);
  await expect(page.getByTestId('preview-impact')).toContainText(
    `1 Aufruf nur vorgeschlagen (ohne Camunda-Engine) · deine Regel „${RULE_NAME}“ nimmt 1 davon gleich an`,
  );
  await page.getByTestId('preview-import').click();
  await expect(page.getByTestId('import-headline')).toHaveText('6 Modelle importiert', {
    timeout: 30_000,
  });
  const accepted = await theCall(key);
  expect(accepted).toMatchObject({ status: 'accepted' });
  expect(accepted.provenance).toMatchObject({ sourceKind: 'human', verdict: 'accept' });
  // nothing waits for a click (once „Als Nächstes“ has loaded, not while its skeleton shows)
  const next = page.getByTestId('upload-next');
  await expect(next).toBeVisible({ timeout: 30_000 });
  await expect(next).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
  await expect(next.getByTestId('upload-next-loading')).toHaveCount(0);
  await expect(page.getByTestId('upload-next-calls')).toHaveCount(0);
  const ledger = await owner.get(`/api/v1/projects/${key}/auto-accepted`);
  expect(((await ledger.json()) as { items: unknown[] }).items).toMatchObject([
    { id: accepted.id, proposedBy: 'rule', ruleName: RULE_NAME, state: 'in-force' },
  ]);

  // marked: the status badge, and the review screen names the call proposal as its trigger
  await page.goto(`/projects/${key}/review/${accepted.id}`);
  await expect(page.getByTestId('auto-accept-mark').first()).toHaveText('Automatisch angenommen', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('auto-accept-provenance')).toContainText(
    'ausgelöst vom Aufrufvorschlag aus einem abgeleiteten Modell (90 %)',
  );

  // „Widerrufen…“: back to the rule tier's proposal
  await page.goto(`/projects/${key}/rules`);
  await page.getByTestId('rule-row').getByTestId('rule-more').click();
  await page.getByRole('menuitem', { name: 'Widerrufen…' }).click();
  const revoke = page.getByTestId('revoke-dialog');
  await expect(revoke.getByTestId('revoke-summary')).toHaveText(
    '1 automatische Annahme: 1 geht zurück in die Prüfung (ein Vorschlag ist noch offen).',
  );
  await revoke.getByRole('button', { name: '1 widerrufen' }).click();
  await expect(revoke).toBeHidden();
  const back = await theCall(key);
  expect(back).toMatchObject({ status: 'proposed', tier: 'key' });
  expect(isDerivedCall(back)).toBe(true);
});

test('an import with an agent token is never accepted by the rule (agent upload)', async ({
  page,
}) => {
  const key = `dcr-agent-${RUN}`;
  await create(key, 'Regel für abgeleitete Aufrufe (Agent)');
  const ruleId = await exportRule(key);
  const response = await owner.post(`/api/v1/projects/${key}/agent-tokens`, {
    data: { name: 'dcr', scopes: ['analyzr:read', 'analyzr:write'], expiresInDays: 1 },
  });
  expect(response.status()).toBe(201);
  const writer = (await response.json()) as { id: string; secret: string };
  await cliImport(key, writer.secret);
  expect((await owner.delete(`/api/v1/projects/${key}/agent-tokens/${writer.id}`)).status()).toBe(
    204,
  );
  expect(await theCall(key)).toMatchObject({ status: 'proposed', tier: 'key' });
  const dry = await owner.post(
    `/api/v1/projects/${key}/auto-accept-rules/${ruleId}/apply?dryRun=true`,
    { data: {} },
  );
  expect(await dry.json()).toMatchObject({
    count: 0,
    blocked: [{ reason: 'agent-upload', count: 1 }],
  });
  // the rule's preview says why
  await page.goto(`/projects/${key}/rules`);
  await page.getByTestId('rule-row').getByRole('button', { name: 'Bearbeiten' }).click();
  const dialog = page.getByTestId('rule-dialog');
  await expect(dialog.getByTestId('rule-preview')).toContainText(
    'Über ein Agenten-Token hochgeladen',
    { timeout: 30_000 },
  );
  await expect(dialog.getByTestId('preview-curve')).toHaveCount(0);
});
