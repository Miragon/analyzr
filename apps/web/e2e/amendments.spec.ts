import { readFileSync } from 'node:fs';

import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';

/**
 * Model amendments in the browser (M6 §4.8 c, S5c-2) against a running
 * server with the built UI. Its own project with two small Camunda 7
 * models written for this test: „Auftrag abwickeln“ (a call activity without
 * a target, unnamed start and end events, no documentation) and
 * „Rechnungsstellung“. In the browser: the call target set at its question
 * (the dry run's summary with the effect and the cost before the save);
 * „Sammeln“ at two questions (the documentation and both event names), one
 * bar, one dry run and one save; the model view's „Ergänzen“ with the
 * element's field and history, the overlay „ergänzt“ on the amended shapes,
 * the header's badge naming the uploaded revision, the revisions, both
 * downloads and the change list, „Zurücknehmen“; the models table's mark;
 * and, after the source tool renamed both events, the conflict items with
 * both values side by side and „Wert aus dem Quellsystem übernehmen“ after
 * the withdrawal's cost; „Meine Ergänzung behalten“ is not offered over a
 * label the tool set (§4.8 c).
 * Skips itself when no server answers or the server is the read-only demo.
 */

const PROJECT = `amend-${Date.now().toString(36)}`;
const API = `/api/v1/projects/${PROJECT}`;
const ORDER_KEY = 'vertrieb/auftrag';
const BILLING_KEY = 'finanzen/rechnung';

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.21.0">`;

/** „Auftrag abwickeln“; `start` and `end` name the events (the source tool's later version). */
function orderXml({ start, end }: { start?: string; end?: string } = {}): string {
  const name = (value: string | undefined) => (value === undefined ? '' : ` name="${value}"`);
  return `${HEAD}
  <bpmn:process id="Process_Auftrag" name="Auftrag abwickeln" isExecutable="true">
    <bpmn:startEvent id="Start_Auftrag"${name(start)}>
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_Auftrag" targetRef="Call_Rechnung" />
    <bpmn:callActivity id="Call_Rechnung" name="Rechnung stellen">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:callActivity>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Call_Rechnung" targetRef="End_Auftrag" />
    <bpmn:endEvent id="End_Auftrag"${name(end)}>
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Auftrag">
    <bpmndi:BPMNPlane id="Plane_Auftrag" bpmnElement="Process_Auftrag">
      <bpmndi:BPMNShape id="Start_Auftrag_di" bpmnElement="Start_Auftrag">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Call_Rechnung_di" bpmnElement="Call_Rechnung">
        <dc:Bounds x="250" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Auftrag_di" bpmnElement="End_Auftrag">
        <dc:Bounds x="422" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="120" />
        <di:waypoint x="250" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="350" y="120" />
        <di:waypoint x="422" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

const BILLING = `${HEAD}
  <bpmn:process id="Process_Rechnung" name="Rechnungsstellung" isExecutable="true">
    <bpmn:documentation>Stellt Rechnungen zu Aufträgen und überwacht den Zahlungseingang.</bpmn:documentation>
    <bpmn:startEvent id="Start_Rechnung" name="Rechnung angefordert">
      <bpmn:outgoing>Flow_R</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_R" sourceRef="Start_Rechnung" targetRef="End_Rechnung" />
    <bpmn:endEvent id="End_Rechnung" name="Rechnung gestellt">
      <bpmn:incoming>Flow_R</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Rechnung">
    <bpmndi:BPMNPlane id="Plane_Rechnung" bpmnElement="Process_Rechnung">
      <bpmndi:BPMNShape id="Start_Rechnung_di" bpmnElement="Start_Rechnung">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Rechnung_di" bpmnElement="End_Rechnung">
        <dc:Bounds x="252" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_R_di" bpmnElement="Flow_R">
        <di:waypoint x="188" y="120" />
        <di:waypoint x="252" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

interface Model {
  id: string;
  key: string;
  name: string | null;
  headRevisionId: string;
  headRev: number;
}
interface Question {
  id: string;
  kind: string;
  subject: { type: string; id: string };
  actions: { type: string; primary: boolean; label: string }[];
}
interface Revision {
  id: string;
  rev: number;
  source: {
    kind: string;
    upstream?: { revisionId: string; rev: number };
    amendments?: { id: string; elementId: string; op: string; outcome: string; reason?: string }[];
  };
}

let owner: APIRequestContext;

test.describe.configure({ mode: 'serial' });

const violations: string[] = [];
test.beforeEach(({ page }) => {
  violations.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|CSP violation/i.test(message.text()))
      violations.push(message.text());
  });
});
test.afterEach(() => {
  expect(violations).toEqual([]);
});

async function importFiles(files: Record<string, string>) {
  const form = new FormData();
  for (const [path, xml] of Object.entries(files))
    form.append('files', new File([xml], path, { type: 'application/xml' }));
  const response = await owner.post(`${API}/imports`, { multipart: form });
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    files: { path: string; outcome: string; amendments?: Record<string, { count: number }> }[];
  };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(120_000);
  const url = baseURL ?? 'http://127.0.0.1:7400';
  const probe = await playwright.request.newContext({ baseURL: url });
  const mode = await probeServer(probe);
  await probe.dispose();
  test.skip(mode === 'down', 'no analyzr server at ANALYZR_E2E_URL; start one to run this flow');
  test.skip(mode === 'demo', DEMO_SKIP);

  owner = await playwright.request.newContext({ baseURL: url });
  expect((await owner.post('/api/v1/session', { data: { client: 'analyzr-web' } })).ok()).toBe(
    true,
  );
  expect(
    (
      await owner.post('/api/v1/projects', { data: { key: PROJECT, name: 'Ergänzungen (e2e)' } })
    ).status(),
  ).toBe(201);
  await importFiles({ [`${ORDER_KEY}.bpmn`]: orderXml(), [`${BILLING_KEY}.bpmn`]: BILLING });
});

test.afterAll(async () => {
  await owner?.dispose();
});

async function modelOf(key: string): Promise<Model> {
  const response = await owner.get(`${API}/models?limit=200`);
  expect(response.ok()).toBe(true);
  const found = ((await response.json()) as { items: Model[] }).items.find((m) => m.key === key);
  expect(found, key).toBeDefined();
  return found!;
}

async function questions(filter: Record<string, string> = {}): Promise<Question[]> {
  const query = new URLSearchParams({ ...filter, limit: '200' });
  const response = await owner.get(`${API}/open-questions?${query}`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { items: Question[] }).items;
}

async function questionOf(kind: string): Promise<Question> {
  const found = (await questions({ kind, modelKey: ORDER_KEY })).find((q) => q.kind === kind);
  expect(found, `an open ${kind} question`).toBeDefined();
  return found!;
}

const item = (page: Page, id: string) =>
  page.locator(`[data-testid=open-question][data-question-id="${id}"]`);
const primaryOf = (scope: ReturnType<typeof item>) =>
  scope.locator('[data-testid=question-action][data-primary=true]');
const toast = (page: Page, title: string) => page.getByTestId('toast').filter({ hasText: title });

/** The amendment writes the page sends (`POST …/amendments`), with their query. */
function amendRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/models\/[^/]+\/amendments(\?|$)/.test(request.url()))
      seen.push(request);
  });
  return seen;
}

test('sets a call target at its question: the dry run’s summary first, then the save', async ({
  page,
}) => {
  const order = await modelOf(ORDER_KEY);
  expect(order.headRev).toBe(1);
  const call = await questionOf('call-target-unknown');
  expect(call.actions.find((a) => a.primary)?.label).toBe('Aufrufziel eintragen …');
  const sent = amendRequests(page);

  await page.goto(`/projects/${PROJECT}/open-questions?kind=call-target-unknown`);
  const row = item(page, call.id);
  await expect(primaryOf(row)).toHaveText('Aufrufziel eintragen …');
  await primaryOf(row).click();
  const form = row.getByTestId('amend-form');
  await expect(form.getByLabel('Aufgerufenen Prozess suchen')).toBeFocused();
  await expect(form.getByTestId('amend-current')).toHaveText('Bisher: leer');
  await expect(form.getByTestId('amend-hint')).toContainText(
    'Der nächste Import aus dem Quellsystem behält die Ergänzung',
  );
  await form.getByLabel('Aufgerufenen Prozess suchen').fill('Rechnungs');
  await form
    .locator(`[data-testid=amend-option][data-ref="${BILLING_KEY}#Process_Rechnung"]`)
    .click();
  await form.getByTestId('amend-submit').click();

  const summary = row.getByTestId('amend-summary');
  // The process the human picked, by its name, with its id.
  await expect(summary.getByTestId('amend-summary-after')).toHaveText(
    'Prozess „Rechnungsstellung“ Process_Rechnung',
  );
  await expect(summary.getByTestId('amend-effect')).toContainText(
    /^Danach: 1 Aufruf angenommen, 1 Befund erledigt/,
  );
  // nothing written by the dry run
  expect(sent.map((r) => new URL(r.url()).searchParams.get('dryRun'))).toEqual(['true']);
  expect(sent[0]!.headers()['if-match']).toBe('"r1"');
  expect((await modelOf(ORDER_KEY)).headRev).toBe(1);

  await summary.getByTestId('amend-confirm').click();
  await expect(toast(page, 'Ergänzung gespeichert')).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(sent.map((r) => new URL(r.url()).searchParams.get('dryRun'))).toEqual(['true', 'false']);
  // the uploaded revision stays; the amended one is the head, and the rule tier accepted the call
  const after = await modelOf(ORDER_KEY);
  expect(after.headRev).toBe(2);
  const landscape = (await (await owner.get(`${API}/landscape`)).json()) as {
    relations: { type: string; status: string; from: string; to: string }[];
  };
  expect(
    landscape.relations.some(
      (r) =>
        r.type === 'call' &&
        r.status === 'accepted' &&
        r.from === `${ORDER_KEY}#Call_Rechnung` &&
        r.to === `${BILLING_KEY}#Process_Rechnung`,
    ),
  ).toBe(true);
});

test('„Sammeln“: the documentation and both event names in one bar, one dry run, one save', async ({
  page,
}) => {
  const doc = await questionOf('undocumented-process');
  const names = await questionOf('unlabelled-boundary');
  const sent = amendRequests(page);
  await page.goto(`/projects/${PROJECT}/open-questions?model=${ORDER_KEY}`);

  const docRow = item(page, doc.id);
  await expect(primaryOf(docRow)).toHaveText('Dokumentation ergänzen …');
  await primaryOf(docRow).click();
  const docForm = docRow.getByTestId('amend-form');
  await docForm
    .getByTestId('amend-text')
    .fill('Nimmt Aufträge an,   prüft sie und stellt die Rechnung.');
  await expect(docForm.getByTestId('amend-stored-as')).toHaveText(
    'Gespeichert wird: „Nimmt Aufträge an, prüft sie und stellt die Rechnung.“',
  );
  await docForm.getByTestId('amend-collect').click();
  await expect(toast(page, 'Gesammelt')).toBeVisible();
  await expect(docRow.getByTestId('question-collected')).toHaveText('gesammelt');
  const bar = page.getByTestId('collect-bar');
  await expect(bar.getByTestId('collect-bar-text')).toHaveText(
    '1 Ergänzung für „Auftrag abwickeln“ gesammelt',
  );

  const namesRow = item(page, names.id);
  await primaryOf(namesRow).click();
  const namesForm = namesRow.getByTestId('amend-form');
  await expect(namesForm.getByTestId('amend-text')).toHaveCount(2);
  const eventField = (id: string) =>
    namesForm.locator(`[data-testid=amend-field][data-element="${id}"]`);
  await expect(eventField('Start_Auftrag').locator('legend')).toHaveText(
    'Startereignis „Start_Auftrag“ · Name',
  );
  await eventField('Start_Auftrag').getByTestId('amend-text').fill('Auftrag eingegangen');
  await eventField('End_Auftrag').getByTestId('amend-text').fill('Auftrag erledigt');
  await namesForm.getByTestId('amend-collect').click();
  await expect(bar.getByTestId('collect-bar-text')).toHaveText(
    '3 Ergänzungen für „Auftrag abwickeln“ gesammelt',
  );
  // nothing sent while collecting
  expect(sent).toHaveLength(0);

  await bar.getByTestId('collect-bar-save').click();
  const summary = bar.getByTestId('amend-summary');
  await expect(summary.getByTestId('amend-summary-item')).toHaveCount(3);
  await expect(summary.getByTestId('amend-effect')).toContainText('Danach:');
  await summary.getByTestId('amend-confirm').click();
  await expect(toast(page, '3 Ergänzungen gespeichert')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(docRow).toHaveCount(0);
  await expect(namesRow).toHaveCount(0);
  expect(sent.map((r) => new URL(r.url()).searchParams.get('dryRun'))).toEqual(['true', 'false']);
  // one request: the three amendments share the seq of one `model.amended` event
  const listed = (
    (await (await owner.get(`${API}/amendments?modelKey=${ORDER_KEY}`)).json()) as {
      items: { elementId: string; op: string; seq: number; state: string }[];
    }
  ).items.filter((a) => a.op !== 'call-target');
  expect(listed.map((a) => `${a.op} ${a.elementId} ${a.state}`).sort()).toEqual([
    'event-name End_Auftrag applied',
    'event-name Start_Auftrag applied',
    'process-documentation Process_Auftrag applied',
  ]);
  expect(new Set(listed.map((a) => a.seq)).size).toBe(1);
  expect((await modelOf(ORDER_KEY)).headRev).toBe(3);
});

test('the model view: „Ergänzen“ with the history, the overlay, the badge, the downloads, „Zurücknehmen“', async ({
  page,
}) => {
  const order = await modelOf(ORDER_KEY);
  const revisions = (
    (await (await owner.get(`${API}/models/${order.id}/revisions`)).json()) as {
      items: Revision[];
    }
  ).items;
  expect(revisions.map((r) => [r.rev, r.source.kind])).toEqual([
    [3, 'amendment'],
    [2, 'amendment'],
    [1, 'import'],
  ]);
  expect(revisions[0]!.source.upstream?.rev).toBe(1);

  await page.goto(`/projects/${PROJECT}/models/${ORDER_KEY}?element=Call_Rechnung`);
  await expect(page.getByTestId('bpmn-canvas')).toHaveAttribute('data-imported', 'true');
  const section = page.getByTestId('amend-section');
  const field = section.getByTestId('amend-section-field');
  await expect(field).toHaveCount(1);
  await expect(field).toHaveAttribute('data-op', 'call-target');
  // A call target by the process's name and model, its id small.
  await expect(field.getByTestId('amend-section-value')).toHaveText(
    'Prozess „Rechnungsstellung“ (Rechnungsstellung) Process_Rechnung (im Quellsystem: leer)',
  );
  await expect(field).toContainText('angewendet');
  const history = section.getByTestId('amend-history-item');
  await expect(history).toHaveCount(1);
  await expect(history).toHaveAttribute('data-state', 'applied');
  await expect(history).toContainText('leer');
  await expect(history).toContainText('Prozess „Rechnungsstellung“');

  // the overlay „ergänzt“ on every amended shape (the process of a plain diagram has none)
  const overlays = page.getByTestId('amended-overlay');
  await expect(overlays).toHaveCount(3);
  expect(
    (await overlays.evaluateAll((els) => els.map((e) => e.getAttribute('data-element-id')))).sort(),
  ).toEqual(['Call_Rechnung', 'End_Auftrag', 'Start_Auftrag']);
  await expect(overlays.first()).toHaveText('ergänzt');

  // the header's badge names the uploaded revision; the revisions list both kinds
  await expect(page.getByTestId('amended-badge')).toHaveText('In analyzr ergänzt (4) · aus r1');
  await page.getByTestId('model-revisions').locator('summary').click();
  await expect(page.getByTestId('model-revision')).toHaveText([
    /^r3 · in analyzr ergänzt \(aus r1\) · .* · Kopf$/,
    /^r2 · in analyzr ergänzt \(aus r1\) · /,
    /^r1 · importiert · /,
  ]);

  // both downloads: the original as it came, the amended head with the values (the menu
  // closes before it opens again)
  const menu = page.getByRole('menu');
  await page.getByTestId('model-downloads').click();
  const [original] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Original herunterladen' }).click(),
  ]);
  expect(original.suggestedFilename()).toBe('vertrieb-auftrag-original-r1.bpmn');
  expect(readFileSync(await original.path(), 'utf8')).toBe(orderXml());
  await expect(menu).toHaveCount(0);
  await page.getByTestId('model-downloads').click();
  const [amended] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'BPMN herunterladen' }).click(),
  ]);
  expect(amended.suggestedFilename()).toBe('vertrieb-auftrag.bpmn');
  const bytes = readFileSync(await amended.path(), 'utf8');
  expect(bytes).toContain('calledElement="Process_Rechnung"');
  expect(bytes).toContain('<bpmn:startEvent id="Start_Auftrag" name="Auftrag eingegangen">');
  expect(bytes).toContain('<bpmn:endEvent id="End_Auftrag" name="Auftrag erledigt">');
  expect(bytes).toContain(
    '<bpmn:documentation>Nimmt Aufträge an, prüft sie und stellt die Rechnung.</bpmn:documentation>',
  );
  await expect(menu).toHaveCount(0);
  await page.getByTestId('model-downloads').click();
  const [list] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Änderungsliste (Markdown)' }).click(),
  ]);
  expect(list.suggestedFilename()).toMatch(/^ergaenzungen-.*\.md$/);
  expect(readFileSync(await list.path(), 'utf8')).toContain('Stand: Ereignis');

  // „Zurücknehmen …“: its cost first, then a new revision without it; the question comes back
  await history.getByTestId('amend-withdraw').click();
  await expect(history.getByTestId('withdraw-effect')).toContainText(
    'Das Modell bekommt eine neue Revision ohne diese Ergänzung',
  );
  await history.getByTestId('withdraw-confirm-button').click();
  await expect(toast(page, 'Ergänzung zurückgenommen')).toBeVisible();
  await expect(page.getByTestId('amended-badge')).toHaveText('In analyzr ergänzt (3) · aus r1');
  await expect(history).toHaveAttribute('data-state', 'withdrawn');
  await expect(history).toContainText('zurückgenommen');
  await expect(overlays).toHaveCount(2);
  expect((await modelOf(ORDER_KEY)).headRev).toBe(4);
  expect((await questions({ kind: 'call-target-unknown' })).length).toBe(1);
});

test('the models table marks the amended model and offers the change list', async ({ page }) => {
  await page.goto(`/projects/${PROJECT}`);
  const rows = page.getByTestId('model-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: ORDER_KEY }).getByTestId('model-amended')).toHaveText(
    'ergänzt',
  );
  await expect(rows.filter({ hasText: BILLING_KEY }).getByTestId('model-amended')).toHaveCount(0);
  await page.getByTestId('change-list-export').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Als CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`ergaenzungen-${PROJECT}.csv`);
});

test('after the source tool renamed both events: both values side by side, its value taken after the cost, never mine over its label', async ({
  page,
}) => {
  const result = await importFiles({
    [`${ORDER_KEY}.bpmn`]: orderXml({ start: 'Bestellung da', end: 'Bestellung abgeschlossen' }),
  });
  expect(result.files[0]!.outcome).toBe('revised');
  expect(result.files[0]!.amendments?.['conflicts']?.count).toBe(2);
  const conflicts = await questions({ kind: 'amendment-conflict' });
  expect(conflicts).toHaveLength(2);
  const at = (id: string) => conflicts.find((q) => q.subject.id === `${ORDER_KEY}#${id}`)!;
  // A label the tool set is never overwritten (§4.8 c): only its value can be taken.
  for (const q of conflicts) {
    expect(q.actions.map((a) => a.label)).toEqual([
      'Wert aus dem Quellsystem übernehmen',
      'Notiz hinzufügen',
    ]);
  }

  await page.goto(`/projects/${PROJECT}/open-questions?kind=amendment-conflict`);
  const start = item(page, at('Start_Auftrag').id);
  await expect(start.getByTestId('conflict-incoming')).toHaveText('„Bestellung da“');
  await expect(start.getByTestId('conflict-after')).toHaveText('„Auftrag eingegangen“');
  await expect(primaryOf(start)).toHaveText('Wert aus dem Quellsystem übernehmen');
  await expect(start).toContainText('Jetzt im Quellsystem: „Bestellung da“');
  await primaryOf(start).click();
  await expect(start.getByTestId('withdraw-effect')).toContainText(
    'Das Modell bekommt eine neue Revision ohne diese Ergänzung',
  );
  await start.getByTestId('withdraw-confirm-button').click();
  await expect(toast(page, 'Wert aus dem Quellsystem übernommen')).toBeVisible();
  await expect(start).toHaveCount(0);

  const end = item(page, at('End_Auftrag').id);
  await expect(end.getByTestId('conflict-incoming')).toHaveText('„Bestellung abgeschlossen“');
  await expect(end.getByRole('button', { name: 'Meine Ergänzung behalten' })).toHaveCount(0);
  await primaryOf(end).click();
  await end.getByTestId('withdraw-confirm-button').click();
  await expect(toast(page, 'Wert aus dem Quellsystem übernommen')).toBeVisible();
  await expect(end).toHaveCount(0);
  expect(await questions({ kind: 'amendment-conflict' })).toHaveLength(0);
});
