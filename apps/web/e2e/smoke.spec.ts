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

  // „Relationen“: the inbox and the results, views of one tab (UX5)
  await page
    .getByRole('navigation', { name: 'Projektbereiche' })
    .getByRole('link', { name: /^Relationen/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/review$`));
  const views = page.getByRole('navigation', { name: 'Ansichten' });
  await views.getByRole('link', { name: 'Alle' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/relations$`));
  const accepted = page.locator('[data-testid=relation-row][data-status=accepted][data-tier=rule]');
  await expect(accepted).toHaveCount(1);
  await expect(accepted).toContainText('Zahlung abwickeln');
  // UX9: who decided, not the procedure
  await expect(accepted.getByTestId('decided-by')).toHaveText('analyzr');
  await expect(
    page.locator('[data-testid=relation-row][data-status=proposed][data-tier=key]').first(),
  ).toBeVisible();

  await views.getByRole('link', { name: 'Abgelehnt' }).click();
  await expect(page).toHaveURL(/status=rejected/);
  await expect(accepted).toHaveCount(0);
  await views.getByRole('link', { name: 'Gilt' }).click();
  await expect(page).toHaveURL(/status=accepted/);

  // UX9: a row's one action „Öffnen“ leads to the review screen, its way back to „Gilt“
  await accepted.getByRole('link', { name: /öffnen$/ }).click();
  await expect(page).toHaveURL(/\/review\/rel_.*from=relations/);
  await expect(page.getByTestId('review-back')).toHaveText('Gilt');

  // model view: the call's endpoint is highlighted in the caller …
  await page
    .getByTestId('pane-chip')
    .filter({ hasText: /^Von/ })
    .getByRole('link', { name: 'Im Modell' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/models/${CALL_FROM}\\?relation=rel_`));
  await expect(page.getByTestId('bpmn-canvas')).toHaveAttribute('data-imported', 'true');
  await expect(
    page.locator('.djs-element.analyzr-endpoint[data-element-id=Call_ZahlungAbwickeln]'),
  ).toHaveCount(1);
  await expect(page.locator('.analyzr-overlay', { hasText: 'Von' })).toBeVisible();

  // … and the switch leads to the called process in the other model
  await page.getByTestId('switch-model').click();
  await expect(page).toHaveURL(new RegExp(`/models/${CALL_TO}\\?relation=rel_`));
  await expect(page.getByTestId('model-header')).toContainText(CALL_TO);
  await expect(page.getByTestId('bpmn-canvas')).toHaveAttribute('data-imported', 'true');
  await expect(page.locator('[data-testid=model-relation][data-selected=true]')).toHaveCount(1);
});

test('upload: a folder keeps its paths, so re-importing it changes nothing', async ({ page }) => {
  await page.goto(`/projects/${PROJECT}/upload`);
  await page.getByTestId('folder-input').setInputFiles(SAMPLE);
  // M6 S2b: the preview says so before anything is sent; nothing to import, no „Importieren“
  await expect(page.getByTestId('import-outcome')).toHaveCount(3);
  await expect(page.locator('[data-testid=import-outcome][data-outcome=unchanged]')).toHaveCount(3);
  await expect(page.getByTestId('import-headline')).toHaveText('Vorschau: 3 unverändert');
  await expect(page.getByTestId('preview-impact')).toHaveText(
    'Danach: keine Änderung an Relationen und Befunden.',
  );
  await expect(page.getByTestId('preview-import')).toHaveCount(0);
  await expect(page.getByRole('link', { name: CALL_FROM })).toBeVisible();
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
  await expect(page.getByTestId('import-headline')).toHaveText(
    'Vorschau: 1 Modell neu · 1 übersprungen',
  );
  await page.getByTestId('preview-import').click();
  const row = page.locator('[data-testid=import-outcome][data-outcome=created]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('doppelt');
  const warnings = row.getByTestId('import-warnings');
  await expect(warnings.locator(':scope > summary')).toHaveText('1 Hinweis');
  await expect(warnings.getByTestId('import-warning')).toBeHidden();
  await warnings.locator(':scope > summary').click();
  const warning = warnings.getByTestId('import-warning');
  await expect(warning).toBeVisible();
  // UX7: in German, what it means and the fix; bpmn-moddle's English behind „Technische Details“
  await expect(warning).toContainText(
    '1 Element übersprungen, weil seine ID schon vergeben ist: Aufgabe „Task_A“.',
  );
  await expect(warning).toContainText('Es fehlt im Diagramm und in den Verbindungen.');
  await warning.getByTestId('technical-details').locator('summary').click();
  await expect(warning.getByTestId('technical-details')).toContainText('duplicate ID <Task_A>');
  // The plain XML is no model: listed with the skipped files, not as a failure.
  await expect(page.getByTestId('import-skipped')).toHaveText(
    '1 Datei übersprungen: meta.xml (kein BPMN)',
  );
  await expect(page.getByTestId('import-headline')).toHaveText(
    '1 Modell importiert · 1 übersprungen',
  );
  await expect(page.getByTestId('toast').filter({ hasText: '1 Dateien importiert' })).toBeVisible();
});

test('upload: a bundle folder with its manifest imports as `analyzr import` does, its provenance round trips (UX8)', async ({
  page,
  request,
}) => {
  // The integrate skill's golden bundle (synthetic Signavio), into a project of its own.
  const bundle = join(
    import.meta.dirname,
    '../../../tools/integrate/test/fixtures/signavio/bundle',
  );
  const manifest = JSON.parse(readFileSync(join(bundle, 'analyzr-import.json'), 'utf8')) as {
    files: { path: string; key: string; externalId: string; externalPath: string }[];
  };
  const key = `${PROJECT}-bundle`;
  // A test's own request context: the owner session first, as the browser opens it.
  expect((await request.post('/api/v1/session', { data: { client: 'analyzr-web' } })).ok()).toBe(
    true,
  );
  expect((await request.post('/api/v1/projects', { data: { key, name: 'Bundle' } })).status()).toBe(
    201,
  );
  await page.goto(`/projects/${key}/upload`);
  await page.getByTestId('folder-input').setInputFiles(bundle);
  // M6 S2b: the preview names the new models first; „Importieren“ sends the same
  await expect(page.getByTestId('import-headline')).toHaveText('Vorschau: 6 Modelle neu');
  // S2b follow-up: a first import names the agent work it sets off, in the last line
  await expect(page.getByTestId('preview-impact')).toHaveText(
    / · \d+ mögliche Relationen? zu beurteilen$/,
  );
  await expect(page.getByTestId('preview-claimed')).toHaveCount(0);
  await page.getByTestId('preview-import').click();
  await expect(page.getByTestId('import-headline')).toHaveText('6 Modelle importiert');
  // S2b follow-up step 3b: „Als Nächstes“ names the size of the agents' run, the summary's count
  const { pairsToJudge } = (await (
    await request.get(`/api/v1/projects/${key}/summary`)
  ).json()) as {
    pairsToJudge: number;
  };
  expect(pairsToJudge).toBeGreaterThan(1);
  const pairs = `etwa ${pairsToJudge.toLocaleString('de-DE')} mögliche Relationen`;
  await expect(page.getByTestId('upload-next-agent')).toContainText(
    `6 Modelle warten auf den Agenten · ${pairs}`,
  );
  await expect(page.getByTestId('upload-bundle')).toHaveText(
    'Bundle erkannt: Signavio, exportiert am 14.10.2026 · 6 von 6 Dateien gelistet · Kurznamen aus dem Bundle',
  );
  // the manifest is the bundle's: not a skipped file
  await expect(page.getByTestId('import-skipped')).toHaveCount(0);
  // the keys the bundle pins and the identity it declares, as `analyzr import` stores them
  const ids = (await (await request.get(`/api/v1/projects/${key}/external-ids`)).json()) as {
    items: { key: string; system: string; externalId: string; externalPath: string }[];
  };
  expect(ids.items.map((i) => [i.key, i.system, i.externalId, i.externalPath]).sort()).toEqual(
    manifest.files.map((f) => [f.key, 'signavio', f.externalId, f.externalPath]).sort(),
  );
  // „Übersicht“ names the one source; the model view's „Herkunft“ reads it back
  await page.getByTestId('upload-overview').click();
  await expect(page.getByTestId('project-source')).toHaveText(
    'Aus Signavio · exportiert am 14.10.2026',
  );
  // … and „Übersicht“ beside the agent row („Agent verbinden“: no token yet)
  await expect(page.getByTestId('next-step-pairs')).toHaveText(pairs);
  const [first] = manifest.files;
  await page.goto(`/projects/${key}/models/${first?.key ?? ''}`);
  await page.getByTestId('model-more').click();
  await page.getByTestId('menu-provenance').click();
  const panel = page.getByTestId('model-provenance');
  await expect(panel).toContainText('Aus Signavio 19.6.0 · exportiert am 14.10.2026 (angegeben)');
  await expect(panel).toContainText(first?.externalPath ?? '');
  await expect(panel).toContainText('über den Owner-Zugang');
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
