import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';

/**
 * The agent work in the „Vorschau“ (M6 S2b follow-up step 3) against a
 * running server with the built UI, in a project of its own from
 * eval/corpus/_sample: an agent (REST, agent token) claims every relations
 * task, judges one model's pairs with no-links and keeps another model's
 * claim. A re-export of both models through „Hochladen“ then previews the
 * cost line („… mögliche Relationen zu beurteilen (… davon erneut)“: the
 * no-links turn stale) and the warning for the claim it cancels; the first
 * „Importieren“ (a double click too) sends nothing and turns into „Trotzdem importieren“,
 * „Abbrechen“ and a new preview disarm, the second click imports, and the
 * agent holding the claim gets 409 `task-cancelled` at submit. Skips itself
 * when no server answers.
 */

const SAMPLE = join(import.meta.dirname, '../../../eval/corpus/_sample/models');
const PROJECT = `vorschau-${Date.now().toString(36)}`;

interface Claimed {
  taskId: string;
  modelKey: string;
  leaseToken: string;
  procedure: { id: string; version: string };
  input: { candidates: [string, string, string, string, number][] };
}

let owner: APIRequestContext;
let agent: APIRequestContext;

function bpmnFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? bpmnFiles(path) : name.endsWith('.bpmn') ? [path] : [];
  });
}

/** The pairs a claim assigns the agent (the search space `compatible` is never assigned). */
const assigned = (t: Claimed) => t.input.candidates.filter((c) => c[3] !== 'compatible');

/** A re-export: the model with other documentation of its process, so its facts change. */
function reExport(xml: string): string {
  return xml.includes('</bpmn:documentation>')
    ? xml.replace('</bpmn:documentation>', ' Neu exportiert.</bpmn:documentation>')
    : xml.replace(
        /(<bpmn:process\b[^>]*>)/,
        '$1<bpmn:documentation>Neu exportiert.</bpmn:documentation>',
      );
}

/** The live models' head revisions by key. */
async function heads(): Promise<Record<string, number>> {
  const response = await owner.get(`/api/v1/projects/${PROJECT}/models?limit=100`);
  expect(response.ok()).toBe(true);
  const { items } = (await response.json()) as { items: { key: string; headRev: number }[] };
  return Object.fromEntries(items.map((m) => [m.key, m.headRev]));
}

/** The judged model (its pairs no-links) and the one whose claim the agent keeps. */
let judged = '';
let held: Claimed;
/** A folder with the re-exported files of both, the import root of the drop. */
let folder = '';

test.describe.configure({ mode: 'serial' });

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
    (await owner.post('/api/v1/projects', { data: { key: PROJECT, name: 'Vorschau' } })).status(),
  ).toBe(201);
  const form = new FormData();
  for (const file of bpmnFiles(SAMPLE)) {
    form.append(
      'files',
      new File([readFileSync(file)], relative(SAMPLE, file), { type: 'application/xml' }),
    );
  }
  expect((await owner.post(`/api/v1/projects/${PROJECT}/imports`, { multipart: form })).ok()).toBe(
    true,
  );
  const token = await owner.post(`/api/v1/projects/${PROJECT}/agent-tokens`, {
    data: { name: 'e2e-vorschau', scopes: ['analyzr:read', 'analyzr:propose'] },
  });
  expect(token.status()).toBe(201);
  const { secret } = (await token.json()) as { secret: string };
  agent = await playwright.request.newContext({
    baseURL: url,
    extraHTTPHeaders: { authorization: `Bearer ${secret}` },
  });

  // the agent claims every task, judges the model with the most assigned pairs, keeps a claim
  const claim = await agent.post('/api/v1/analyses/claim', {
    data: { projectId: PROJECT, max: 5 },
  });
  expect(claim.ok()).toBe(true);
  const claimed = ((await claim.json()) as { items: Claimed[] }).items.sort(
    (a, b) => assigned(b).length - assigned(a).length,
  );
  expect(claimed).toHaveLength(3);
  const [first, second, third] = claimed as [Claimed, Claimed, Claimed];
  expect(assigned(first).length, 'a claim with assigned pairs').toBeGreaterThan(0);
  const submitted = await agent.post(`/api/v1/analyses/${first.taskId}/submission`, {
    data: {
      leaseToken: first.leaseToken,
      submissionId: randomUUID(),
      procedure: first.procedure,
      llmModel: 'sim-e2e',
      relations: [],
      noLinks: assigned(first).map(([type, from, to]) => ({
        type,
        from,
        to,
        reason: 'no-evidence: Die Modelle beschreiben verschiedene Vorgänge.',
      })),
      summary: 'Keine Zusammenhänge',
    },
  });
  expect(submitted.ok()).toBe(true);
  judged = first.modelKey;
  held = second;
  expect(
    (
      await agent.post(`/api/v1/analyses/${third.taskId}/release`, {
        data: { leaseToken: third.leaseToken, reason: 'e2e' },
      })
    ).ok(),
  ).toBe(true);

  folder = join(mkdtempSync(join(tmpdir(), 'analyzr-vorschau-')), 'export');
  for (const key of [judged, held.modelKey]) {
    const target = join(folder, `${key}.bpmn`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, reExport(readFileSync(join(SAMPLE, `${key}.bpmn`), 'utf8')));
  }
});

test('„Vorschau“ names the agent work and asks a second time before cancelling a claim', async ({
  page,
}) => {
  const before = await heads();
  await page.goto(`/projects/${PROJECT}/upload`);
  await page.getByTestId('folder-input').setInputFiles(folder);
  await expect(page.getByTestId('import-headline')).toHaveText('Vorschau: 2 neue Revisionen', {
    timeout: 30_000,
  });
  // the cost in the last line: the judged model's no-links turn stale, so they are judged again
  await expect(page.getByTestId('preview-impact')).toHaveText(
    /(^Danach: | · )\d+ mögliche Relationen? zu beurteilen \(\d+ davon erneut\)$/,
  );
  const details = page.getByTestId('preview-details');
  await details.locator('summary').click();
  await expect(
    details.getByTestId('preview-list').filter({ hasText: 'Mögliche Relationen, die erneut' }),
  ).toContainText(judged);
  // the claim the import cancels: its model by key, no handle
  const warning = page.getByTestId('preview-claimed');
  await expect(warning).toHaveText(
    `Ein Agent bearbeitet „${held.modelKey}“ gerade; seine Arbeit geht verloren.Der Import bricht seine Analyse ab; sie wird danach neu eingeplant.`,
  );
  const button = page.getByTestId('preview-import');
  await expect(button).toHaveText('Importieren');
  // a double click arms only: its later click sends nothing
  await button.dblclick();
  await expect(button).toHaveText('Trotzdem importieren');
  await expect(page.getByTestId('upload-preview')).toBeVisible();
  expect(await heads()).toEqual(before);
  // „Abbrechen“ disarms: the next preview asks again
  await page.getByTestId('preview-cancel').click();
  await expect(page.getByTestId('upload-preview')).toHaveCount(0);
  await page.getByTestId('folder-input').setInputFiles(folder);
  await expect(page.getByTestId('preview-claimed')).toBeVisible({ timeout: 30_000 });
  await expect(button).toHaveText('Importieren');
  await button.click();
  await expect(button).toHaveText('Trotzdem importieren');
  await button.click();
  await expect(page.getByTestId('import-headline')).toHaveText('2 Modelle importiert', {
    timeout: 30_000,
  });
  const after = await heads();
  expect(after[judged]).toBe((before[judged] ?? 0) + 1);
  expect(after[held.modelKey]).toBe((before[held.modelKey] ?? 0) + 1);
  // the agent's work on the claim is lost: its submission is refused
  const late = await agent.post(`/api/v1/analyses/${held.taskId}/submission`, {
    data: {
      leaseToken: held.leaseToken,
      submissionId: randomUUID(),
      procedure: held.procedure,
      llmModel: 'sim-e2e',
      relations: [],
      noLinks: [],
      summary: 'Zu spät',
    },
  });
  expect(late.status()).toBe(409);
  expect(((await late.json()) as { code: string }).code).toBe('task-cancelled');
});
