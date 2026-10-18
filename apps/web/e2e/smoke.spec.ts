import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { expect, test } from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';

/**
 * Smoke test (M1): projects → relations → model view, against a running
 * server, and the upload (with the extractor warnings of M6 S1). It creates
 * its own project from eval/corpus/_sample, so it never touches existing
 * data, and it skips itself when no server answers.
 */

const SAMPLE = join(import.meta.dirname, '../../../eval/corpus/_sample/models');
const PROJECT = `e2e-${Date.now().toString(36)}`;
const CALL_FROM = 'vertrieb/auftragsabwicklung';
const CALL_TO = 'finance/payment-collection';

function bpmnFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? bpmnFiles(path) : name.endsWith('.bpmn') ? [path] : [];
  });
}

test.describe.configure({ mode: 'serial' });

// The server sends a strict CSP for the UI (script-src 'self', no framing);
// a violation (bpmn-js, Radix, fonts, the watermark) must fail the smoke test.
const cspViolations: string[] = [];
test.beforeEach(async ({ page }) => {
  cspViolations.length = 0;
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /Content Security Policy|CSP violation/i.test(message.text())
    ) {
      cspViolations.push(message.text());
    }
  });
});
test.afterEach(() => {
  expect(cspViolations).toEqual([]);
});

test.beforeAll(async ({ request }) => {
  const mode = await probeServer(request);
  test.skip(
    mode === 'down',
    'no analyzr server at ANALYZR_E2E_URL; start one to run the smoke test',
  );
  test.skip(mode === 'demo', DEMO_SKIP);
  // The API request context keeps the owner session cookie, like the browser does.
  expect((await request.post('/api/v1/session', { data: { client: 'analyzr-web' } })).ok()).toBe(
    true,
  );
  const created = await request.post('/api/v1/projects', {
    data: { key: PROJECT, name: `E2E ${PROJECT}` },
  });
  expect(created.status()).toBe(201);
  const form = new FormData();
  for (const file of bpmnFiles(SAMPLE)) {
    const path = relative(SAMPLE, file);
    form.append('files', new File([readFileSync(file)], path, { type: 'application/xml' }));
  }
  const imported = await request.post(`/api/v1/projects/${PROJECT}/imports`, { multipart: form });
  expect(imported.ok()).toBe(true);
  const result = (await imported.json()) as { files: { outcome: string }[] };
  expect(result.files.map((f) => f.outcome)).toEqual(['created', 'created', 'created']);
});

test('projects → relations → model view', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projekte' })).toBeVisible();
  // UX1: no server line while all is well; the version is in the logo's tooltip.
  await expect(page.getByTestId('server-status')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'analyzr', exact: true })).toHaveAttribute(
    'title',
    /^analyzr \S+/,
  );
  await page.getByRole('link', { name: `E2E ${PROJECT}` }).click();

  // „Übersicht“: three models by name with their keys; the next step waits for an agent
  await expect(page.getByTestId('model-row')).toHaveCount(3);
  await expect(page.getByTestId('model-row').filter({ hasText: CALL_FROM })).toBeVisible();
  await expect(
    page.getByTestId('model-row').filter({ hasText: 'finanzen/rechnungsstellung' }),
  ).toBeVisible();
  await expect(page.getByTestId('next-step')).toContainText('Als Nächstes');

  // „Relationen“: the inbox, the results one link away (UX5 makes them views of the tab)
  await page
    .getByRole('navigation', { name: 'Projektbereiche' })
    .getByRole('link', { name: /^Relationen/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/review$`));
  await page.getByTestId('all-relations').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/relations$`));
  const accepted = page.locator('[data-testid=relation-row][data-status=accepted][data-tier=rule]');
  await expect(accepted).toHaveCount(1);
  await expect(accepted).toContainText('Zahlung abwickeln');
  await expect(accepted).toContainText('analyzr-rules/1.0.0');
  await expect(
    page.locator('[data-testid=relation-row][data-status=proposed][data-tier=key]').first(),
  ).toBeVisible();

  await page.getByRole('button', { name: /Schlüssel-Vorschläge/ }).click();
  await expect(page).toHaveURL(/status=proposed/);
  await expect(accepted).toHaveCount(0);
  await page.getByRole('button', { name: /^Alle \d/ }).click();

  // model view: the call's endpoint is highlighted in the caller …
  await accepted.getByRole('link', { name: /Relation im Modell/ }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${CALL_FROM}\\?relation=rel_`));
  await expect(page.getByTestId('bpmn-canvas')).toHaveAttribute('data-imported', 'true');
  await expect(
    page.locator('.djs-element.analyzr-endpoint[data-element-id=Call_ZahlungAbwickeln]'),
  ).toHaveCount(1);
  await expect(page.locator('.analyzr-overlay', { hasText: 'Von' })).toBeVisible();

  // … and the switch leads to the called process in the other model
  await page.getByTestId('switch-model').click();
  await expect(page).toHaveURL(new RegExp(`/models/${CALL_TO}\\?relation=rel_`));
  await expect(page.getByRole('heading', { name: CALL_TO })).toBeVisible();
  await expect(page.getByTestId('bpmn-canvas')).toHaveAttribute('data-imported', 'true');
  await expect(page.locator('[data-testid=model-relation][data-selected=true]')).toHaveCount(1);
});

test('upload: a folder keeps its paths, so re-importing it changes nothing', async ({ page }) => {
  await page.goto(`/projects/${PROJECT}/upload`);
  await page.getByTestId('folder-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('import-outcome')).toHaveCount(3);
  await expect(page.locator('[data-testid=import-outcome][data-outcome=unchanged]')).toHaveCount(3);
  await expect(page.getByRole('link', { name: CALL_FROM })).toBeVisible();
  await expect(page.getByTestId('toast').filter({ hasText: '3 Dateien importiert' })).toBeVisible();
});

test('upload: extractor warnings per file in a disclosure, a plain XML skipped (M6 S1)', async ({
  page,
}) => {
  // bpmn-moddle drops the second Task_A and warns; the model is still created.
  const duplicate = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">',
    '  <bpmn:process id="Process_Doppelt" isExecutable="false">',
    '    <bpmn:task id="Task_A" name="Eins" />',
    '    <bpmn:task id="Task_A" name="Zwei" />',
    '  </bpmn:process>',
    '</bpmn:definitions>',
    '',
  ].join('\n');
  await page.goto(`/projects/${PROJECT}/upload`);
  await page.getByTestId('file-input').setInputFiles([
    { name: 'doppelt.bpmn', mimeType: 'application/xml', buffer: Buffer.from(duplicate) },
    { name: 'meta.xml', mimeType: 'application/xml', buffer: Buffer.from('<meta/>') },
  ]);
  const row = page.locator('[data-testid=import-outcome][data-outcome=created]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('doppelt');
  const warnings = row.getByTestId('import-warnings');
  await expect(warnings.locator('summary')).toHaveText('1 Hinweis');
  await expect(warnings.getByTestId('import-warning')).toBeHidden();
  await warnings.locator('summary').click();
  const warning = warnings.getByTestId('import-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Unbekannter oder fehlerhafter Inhalt');
  await expect(warning).toContainText('duplicate ID <Task_A>');
  // The plain XML is no model: listed with the skipped files, not as a failure.
  await expect(page.getByText('1 Dateien übersprungen', { exact: false })).toBeVisible();
  await expect(page.getByTestId('toast').filter({ hasText: '1 Dateien importiert' })).toBeVisible();
});

test('findings behind „Offene Fragen“ and the connect page behind „Einstellungen“', async ({
  page,
}) => {
  // Q2: no tab „Befunde“; the list stays one link away at the foot of „Offene Fragen“.
  await page.goto(`/projects/${PROJECT}/open-questions`);
  await page.getByTestId('findings-link').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/findings$`));
  await expect(page.getByRole('navigation', { name: 'Brotkrumen' })).toContainText('Befunde');
  await expect(page.getByRole('heading', { name: /Dynamischer Aufruf/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Aufruf ohne Ziel/ })).toBeVisible();

  // Q1: „Agent verbinden“ in the owner's menu „Einstellungen“.
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('menuitem', { name: 'Agent verbinden' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/agents$`));
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  const secret = page.getByTestId('created-secret');
  await expect(secret).toContainText('analyzr_at_');
  await expect(page.getByTestId('code-block').first()).toContainText(
    'claude mcp add --transport http analyzr',
  );
  await expect(page.getByTestId('token-row')).toHaveCount(1);
});
