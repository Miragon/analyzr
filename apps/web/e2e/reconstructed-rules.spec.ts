import { expect, test, type APIRequestContext } from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';

/**
 * No owner rule accepts anything on a model read from a picture (owner
 * decision 30 (2)) against a running server with the built UI: three
 * synthetic Camunda 7 models imported over REST with a manifest that
 * declares one of them `reconstructed`; an enabled rule „Nachricht ab 90 %“
 * (ad-hoc proposals included); an agent token proposes two key-tier message
 * pairs ad hoc, one into the picture model. The pair between the other two
 * is accepted, the picture's pair stays a proposal, and the rule's live
 * preview names the safeguard „Modell KI-rekonstruiert oder aus Interview“
 * and opens nothing. Skips itself when no server answers.
 */

const PROJECT = `reconrules-${Date.now().toString(36)}`;
const BASE = `/api/v1/projects/${PROJECT}`;
const LABEL = 'Modell KI-rekonstruiert oder aus Interview';

const DEFS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="http://example.org/bpmn"';
const SENDER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} id="Defs_Bestellung">
  <bpmn:process id="Process_Bestellung" name="Bestellung" isExecutable="true">
    <bpmn:startEvent id="Start_Bestellung" name="Bedarf gemeldet" />
    <bpmn:intermediateThrowEvent id="Event_Einlagern" name="Ware einlagern">
      <bpmn:messageEventDefinition id="MED_Einlagern" messageRef="Message_Einlagern" />
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="End_Buchen" name="Rechnung buchen">
      <bpmn:messageEventDefinition id="MED_Buchen" messageRef="Message_Buchen" />
    </bpmn:endEvent>
  </bpmn:process>
  <bpmn:message id="Message_Einlagern" name="Ware einlagern" />
  <bpmn:message id="Message_Buchen" name="Rechnung buchen" />
</bpmn:definitions>
`;
const receiver = (
  id: string,
  name: string,
  message: string,
) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} id="Defs_${id}">
  <bpmn:process id="Process_${id}" name="${name}" isExecutable="true">
    <bpmn:startEvent id="Start_${id}" name="${message}">
      <bpmn:messageEventDefinition id="MED_${id}" messageRef="Message_${id}" />
    </bpmn:startEvent>
  </bpmn:process>
  <bpmn:message id="Message_${id}" name="${message}" />
</bpmn:definitions>
`;
const PICTURE_PAIR = ['einkauf/bestellung#Event_Einlagern', 'bild/lager#Start_Lager'] as const;
const EXPORT_PAIR = ['einkauf/bestellung#End_Buchen', 'finanzen/buchhaltung#Start_Buchhaltung'];

interface Relation {
  type: string;
  from: string;
  to: string;
  status: string;
}

let owner: APIRequestContext;
let agent: APIRequestContext;
let tokenId = '';

async function statusOf([from, to]: readonly string[]): Promise<string | undefined> {
  const response = await owner.get(`${BASE}/relations?type=message&limit=200`);
  expect(response.ok()).toBe(true);
  const page = (await response.json()) as { items: Relation[] };
  return page.items.find((r) => r.from === from && r.to === to)?.status;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(120_000);
  const base = baseURL ?? 'http://127.0.0.1:7400';
  const probe = await playwright.request.newContext({ baseURL: base });
  const mode = await probeServer(probe);
  await probe.dispose();
  test.skip(mode === 'down', 'no analyzr server at ANALYZR_E2E_URL; start one to run this flow');
  test.skip(mode === 'demo', DEMO_SKIP);

  owner = await playwright.request.newContext({ baseURL: base });
  expect((await owner.post('/api/v1/session', { data: { client: 'analyzr-web' } })).ok()).toBe(
    true,
  );
  expect(
    (
      await owner.post('/api/v1/projects', { data: { key: PROJECT, name: 'Regeln und Bilder' } })
    ).status(),
  ).toBe(201);
  const form = new FormData();
  for (const [path, xml] of [
    ['einkauf/bestellung.bpmn', SENDER],
    ['bild/lager.bpmn', receiver('Lager', 'Einlagerung', 'Ware einlagern')],
    ['finanzen/buchhaltung.bpmn', receiver('Buchhaltung', 'Buchhaltung', 'Rechnung buchen')],
  ] as const) {
    form.append('files', new File([xml], path, { type: 'application/xml' }));
  }
  form.append(
    'manifest',
    JSON.stringify({
      format: 'analyzr-import/1',
      source: { system: 'images' },
      files: [
        {
          path: 'bild/lager.bpmn',
          key: 'bild/lager',
          derived: { kind: 'reconstructed', llmModel: 'e2e-model' },
        },
      ],
    }),
  );
  expect((await owner.post(`${BASE}/imports`, { multipart: form })).ok()).toBe(true);
  const rule = await owner.post(`${BASE}/auto-accept-rules`, {
    data: {
      name: 'Nachricht ab 90 %',
      kind: 'relation',
      tier: 'key',
      minConfidence: 0.9,
      relationType: 'message',
      includeAdHoc: true,
      enabled: true,
    },
  });
  expect(rule.status()).toBe(201);
  const token = await owner.post(`${BASE}/agent-tokens`, {
    data: { name: 'e2e-bilder', scopes: ['analyzr:read', 'analyzr:propose'], expiresInDays: 1 },
  });
  expect(token.status()).toBe(201);
  const created = (await token.json()) as { secret: string; id: string };
  tokenId = created.id;
  agent = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { authorization: `Bearer ${created.secret}` },
  });
  for (const [[from, to], confidence] of [
    [PICTURE_PAIR, 0.97],
    [EXPORT_PAIR, 0.96],
  ] as const) {
    const response = await agent.post(`${BASE}/relations`, {
      data: {
        type: 'message',
        from,
        to,
        confidence,
        rationale: 'Gleicher Nachrichtenname.',
        llmModel: 'e2e-model',
      },
    });
    expect(response.ok()).toBe(true);
  }
});

test.afterAll(async () => {
  if (owner && tokenId) await owner.delete(`${BASE}/agent-tokens/${tokenId}`);
  await agent?.dispose();
  await owner?.dispose();
});

test('a rule accepts the pair between exports and names why it leaves the picture’s pair', async ({
  page,
}) => {
  expect(await statusOf(EXPORT_PAIR)).toBe('accepted');
  expect(await statusOf(PICTURE_PAIR)).toBe('proposed');

  await page.goto(`/projects/${PROJECT}/rules`);
  const row = page.getByTestId('rule-row').filter({ hasText: 'Nachricht ab 90 %' });
  await row.getByRole('button', { name: 'Bearbeiten' }).click();
  const dialog = page.getByTestId('rule-dialog');
  const blocked = dialog.getByTestId('rule-preview').getByTestId('blocked-reasons');
  await expect(blocked).toContainText(LABEL, { timeout: 30_000 });
  await expect(blocked.getByRole('listitem').filter({ hasText: LABEL })).toHaveText(`${LABEL}1`);
  await expect(dialog.getByTestId('preview-open')).toHaveText('Jetzt offen: 0 würden angenommen');
  expect(await statusOf(PICTURE_PAIR)).toBe('proposed');
});
