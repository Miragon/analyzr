import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';

/**
 * Open questions in the browser (M6 S4, §4.4) against a running server with
 * the built UI. It creates its own project from eval/corpus/nordwind-handel,
 * lets an agent (REST, agent token) propose one pair with a question that
 * carries HTML and a summary, holds a key-tier proposal as the owner (note,
 * question, label) and pushes the golden dev chain. In the browser: the tab
 * after „Befunde“ with the API's count, the list ordered by `unlocks`, the
 * filters giving what the API gives for the same filter, human and agent
 * texts as plain text, the links to the review screen, the chain page and
 * the model view, filters combined, both exports as downloads (named after
 * the filters; the CSV without the informational items), and the model
 * view's section.
 * Skips itself when no server answers or the server is the read-only demo.
 */

const ROOT = join(import.meta.dirname, '../../..');
const CORPUS = join(ROOT, 'eval/corpus/nordwind-handel/models');
const GOLDEN = join(ROOT, 'eval/value-chains/nordwind-handel/value-chain.vc.json');
const PROJECT = `oq-${Date.now().toString(36)}`;
const BASE = `/api/v1/projects/${PROJECT}/open-questions`;
const HOSTILE =
  'Gilt das auch für Teillieferungen? <img src=x onerror="alert(1)"> <b>kein HTML</b>';
const SUMMARY = 'Eine Frage gestellt; das Lager scheint als Modell zu fehlen.';
const HOLD = {
  note: 'Laut Handbuch der Vertrieb, laut Lane die Buchhaltung.',
  question: 'Wer verschickt die Rechnung bei Teillieferungen?',
  label: 'mit Fachbereich Finanzen klären',
};

interface Claimed {
  taskId: string;
  modelKey: string;
  leaseToken: string;
  procedure: { id: string; version: string };
  input: { candidates: [string, string, string, string, number][] };
}
interface Relation {
  id: string;
  status: string;
  tier: string;
  version: number;
}
interface Question {
  id: string;
  kind: string;
  source: string;
  subject: { type: string; id: string };
  modelKeys: string[];
  unlocks: number;
  askWho: { lanes: string[]; stepOwners: string[]; folder: string | null };
}

/** Kinds that ask nothing (the list ranks them last, the CSV leaves them out). */
const INFORMATIONAL = new Set(['summary-note', 'descriptive-model']);

let owner: APIRequestContext;
let agent: APIRequestContext;
let heldId = '';
let heldPlacementId = '';

function bpmnFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? bpmnFiles(path) : name.endsWith('.bpmn') ? [path] : [];
  });
}

/** Every open question for a filter, over REST (the list the tab must show). */
async function api(filter: Record<string, string> = {}): Promise<Question[]> {
  const items: Question[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ ...filter, limit: '200', ...(cursor ? { cursor } : {}) });
    const response = await owner.get(`${BASE}?${query}`);
    expect(response.ok()).toBe(true);
    const page = (await response.json()) as { items: Question[]; nextCursor: string | null };
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

const rows = (page: Page) => page.getByTestId('open-question');

/** The ids the tab shows (after „Weitere anzeigen“ until every item is there). */
async function shownIds(page: Page): Promise<string[]> {
  await expect(rows(page).first()).toBeVisible();
  const more = page.getByTestId('open-questions-more');
  while (await more.isVisible()) await more.click();
  return rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-question-id') ?? ''));
}

test.describe.configure({ mode: 'serial' });

const violations: string[] = [];
test.beforeEach(async ({ page }) => {
  violations.length = 0;
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|CSP violation/i.test(message.text()))
      violations.push(message.text());
  });
  page.on('dialog', (dialog) => {
    // an agent's text must never run
    violations.push(`dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
});
test.afterEach(() => {
  expect(violations).toEqual([]);
});

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
      await owner.post('/api/v1/projects', {
        data: { key: PROJECT, name: 'Nordwind Handel (Offene Fragen)' },
      })
    ).status(),
  ).toBe(201);
  const form = new FormData();
  for (const file of bpmnFiles(CORPUS)) {
    form.append(
      'files',
      new File([readFileSync(file)], relative(CORPUS, file), { type: 'application/xml' }),
    );
  }
  expect((await owner.post(`/api/v1/projects/${PROJECT}/imports`, { multipart: form })).ok()).toBe(
    true,
  );

  // an agent: one proposal with a question (HTML inside) and a summary; the other tasks go back
  const token = await owner.post(`/api/v1/projects/${PROJECT}/agent-tokens`, {
    data: { name: 'e2e-questions', scopes: ['analyzr:read', 'analyzr:propose'] },
  });
  expect(token.status()).toBe(201);
  const { secret } = (await token.json()) as { secret: string };
  agent = await playwright.request.newContext({
    baseURL: url,
    extraHTTPHeaders: { authorization: `Bearer ${secret}` },
  });
  const claim = await agent.post('/api/v1/analyses/claim', {
    data: { projectId: PROJECT, max: 5 },
  });
  expect(claim.ok()).toBe(true);
  const claimed = ((await claim.json()) as { items: Claimed[] }).items;
  const task = claimed.find((t) => t.input.candidates.some((c) => c[3] === 'lexical'));
  expect(task).toBeDefined();
  const [type, from, to] = task!.input.candidates
    .filter((c) => c[3] === 'lexical')
    .sort((a, b) => b[4] - a[4])[0]!;
  const submitted = await agent.post(`/api/v1/analyses/${task!.taskId}/submission`, {
    data: {
      leaseToken: task!.leaseToken,
      submissionId: randomUUID(),
      procedure: task!.procedure,
      llmModel: 'sim-e2e',
      relations: [
        {
          type,
          from,
          to,
          confidence: 0.6,
          rationale: 'Die Bezeichnungen beschreiben denselben Vorgang.',
          evidence: [from, to],
          question: HOSTILE,
        },
      ],
      noLinks: [],
      summary: SUMMARY,
    },
  });
  expect(submitted.ok()).toBe(true);
  for (const t of claimed.filter((c) => c !== task)) {
    expect(
      (
        await agent.post(`/api/v1/analyses/${t.taskId}/release`, {
          data: { leaseToken: t.leaseToken, reason: 'e2e' },
        })
      ).ok(),
    ).toBe(true);
  }

  // the owner holds a key-tier proposal with a note, a question and a label
  const landscape = (await (await owner.get(`/api/v1/projects/${PROJECT}/landscape`)).json()) as {
    relations: Relation[];
  };
  const key = landscape.relations.find((r) => r.tier === 'key' && r.status === 'proposed');
  expect(key).toBeDefined();
  const held = await owner.post(`/api/v1/projects/${PROJECT}/relations/${key!.id}/decision`, {
    data: { verdict: 'hold', version: key!.version, ...HOLD },
  });
  expect(held.ok()).toBe(true);
  heldId = key!.id;

  // the golden dev chain: its findings become questions too
  const pushed = await owner.put(`/api/v1/projects/${PROJECT}/value-chains/main/content`, {
    headers: { 'if-none-match': '*', 'content-type': 'application/json' },
    data: readFileSync(GOLDEN, 'utf8'),
  });
  expect(pushed.status()).toBe(201);

  // the owner holds one of the rule tier's placement proposals on the chain
  const proposed = await owner.get(
    `/api/v1/projects/${PROJECT}/value-chains/main/placements?status=proposed&limit=1`,
  );
  expect(proposed.ok()).toBe(true);
  const [placement] = ((await proposed.json()) as { items: { id: string; version: number }[] })
    .items;
  expect(placement).toBeDefined();
  const holdPlacement = await owner.post(
    `/api/v1/projects/${PROJECT}/value-chains/main/placements/${placement!.id}/decision`,
    { data: { verdict: 'hold', version: placement!.version, note: 'Gehört das hierher?' } },
  );
  expect(holdPlacement.ok()).toBe(true);
  heldPlacementId = placement!.id;
});

test.afterAll(async () => {
  await agent?.dispose();
  await owner?.dispose();
});

test('the tab follows „Befunde“ with the count and lists every question by unlocks', async ({
  page,
}) => {
  const all = await api();
  const open = await api({ state: 'open' });
  expect(open.length).toBe(all.length);
  // every source this flow made is there
  const kinds = new Set(all.map((q) => q.kind));
  for (const kind of ['held', 'agent-question', 'summary-note', 'black-box-partner'])
    expect(kinds).toContain(kind);
  expect(kinds).toContain('process-without-step');

  await page.goto(`/projects/${PROJECT}`);
  const nav = page.getByRole('navigation', { name: 'Projektbereiche' });
  const names = (await nav.getByRole('link').allTextContents()).map((t) =>
    t.replace(/\d+.*/, '').trim(),
  );
  expect(names.indexOf('Offene Fragen')).toBe(names.indexOf('Befunde') + 1);
  const tab = nav.getByRole('link', { name: /Offene Fragen/ });
  await expect(tab).toHaveText(`Offene Fragen${open.length} offen`);
  await tab.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/open-questions$`));
  await expect(page.getByTestId('open-questions-count')).toHaveText(
    `${all.length} Fragen, geordnet nach offenen Entscheidungen`,
  );
  // the server's order: questions by `unlocks` descending, informational items last
  expect(await shownIds(page)).toEqual(all.map((q) => q.id));
  const shown = await rows(page).evaluateAll((els) =>
    els.map((e) => ({
      kind: e.getAttribute('data-kind') ?? '',
      unlocks: Number(e.getAttribute('data-unlocks')),
    })),
  );
  const informational = shown.map((q) => INFORMATIONAL.has(q.kind));
  expect(informational).toEqual([...informational].sort((a, b) => Number(a) - Number(b)));
  const unlocks = shown.filter((q) => !INFORMATIONAL.has(q.kind)).map((q) => q.unlocks);
  expect(unlocks).toEqual([...unlocks].sort((a, b) => b - a));
});

test('each filter shows what the API returns for it', async ({ page }) => {
  await page.goto(`/projects/${PROJECT}/open-questions`);
  await expect(rows(page).first()).toBeVisible();

  await page.getByLabel('Art', { exact: true }).selectOption('black-box-partner');
  await expect(page).toHaveURL(/kind=black-box-partner/);
  expect(await shownIds(page)).toEqual((await api({ kind: 'black-box-partner' })).map((q) => q.id));

  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await page.getByLabel('Quelle', { exact: true }).selectOption('value-chain-finding');
  expect(await shownIds(page)).toEqual(
    (await api({ source: 'value-chain-finding' })).map((q) => q.id),
  );
  await page.getByLabel('Quelle', { exact: true }).selectOption('');

  // a folder: every model below it
  const folder = (await api()).flatMap((q) => q.modelKeys).find((k) => k.includes('/'))!;
  const top = folder.slice(0, folder.indexOf('/'));
  await page.getByLabel('Modell oder Ordner', { exact: true }).selectOption(top);
  await expect(page).toHaveURL(new RegExp(`model=${top}`));
  expect(await shownIds(page)).toEqual((await api({ modelKey: top })).map((q) => q.id));
  await page.getByLabel('Modell oder Ordner', { exact: true }).selectOption('');

  // a contact hint: a lane, a step owner or a folder, exactly
  const hint = (await api()).find((q) => q.askWho.stepOwners.length > 0)?.askWho.stepOwners[0];
  expect(hint).toBeTruthy();
  await page.getByLabel('Ansprechpartner-Hinweis', { exact: true }).selectOption(hint!);
  expect(await shownIds(page)).toEqual((await api({ askWho: hint! })).map((q) => q.id));

  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await expect(page).toHaveURL(new RegExp(`/open-questions$`));
});

test('filters combine as on the server, in the list and in the export', async ({ page }) => {
  // a top folder that holds some of the signals, not all: the two filters narrow each other
  const signals = await api({ source: 'signal' });
  const tops = [
    ...new Set(signals.flatMap((q) => q.modelKeys).map((k) => k.slice(0, k.indexOf('/')))),
  ];
  const top = tops.find(
    (t) =>
      signals.filter((q) => q.modelKeys.some((k) => k.startsWith(`${t}/`))).length < signals.length,
  )!;
  expect(top).toBeTruthy();
  const expected = (await api({ source: 'signal', modelKey: top })).map((q) => q.id);
  expect(expected.length).toBeGreaterThan(0);
  expect(expected.length).toBeLessThan(signals.length);

  await page.goto(`/projects/${PROJECT}/open-questions?source=signal&model=${top}`);
  await expect(page.getByLabel('Quelle', { exact: true })).toHaveValue('signal');
  await expect(page.getByLabel('Modell oder Ordner', { exact: true })).toHaveValue(top);
  expect(await shownIds(page)).toEqual(expected);
  await expect(page.getByTestId('open-questions-count')).toHaveText(
    new RegExp(`^${expected.length} von \\d+ Fragen`),
  );

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Als CSV exportieren' }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe(`offene-fragen-${PROJECT}-${top}-signal.csv`);
  const lines = readFileSync(await csv.path(), 'utf8')
    .slice(1)
    .split('\r\n')
    .filter(Boolean);
  expect(lines.slice(1).map((l) => /^"(q-[0-9a-f]{16})"/.exec(l)?.[1])).toEqual(expected);

  // a held placement: its question leads to that placement on the chain page
  await page.goto(`/projects/${PROJECT}/open-questions?kind=held`);
  const placement = page.locator('[data-testid=open-question][data-kind=held]', {
    has: page.locator('[data-link=chain]'),
  });
  await expect(placement).toHaveCount(1);
  await placement.getByTestId('question-link').click();
  await expect(page).toHaveURL(new RegExp(`/value-chain\\?placement=${heldPlacementId}`));
  await expect(page.getByTestId('value-chain-page')).toBeVisible();
});

test('human and agent texts stay plain text; items lead to where they are decided', async ({
  page,
}) => {
  await page.goto(`/projects/${PROJECT}/open-questions?source=hold`);
  const held = page.locator('[data-testid=open-question][data-kind=held]', {
    has: page.locator('[data-link=review]'),
  });
  await expect(held.getByTestId('question-text')).toHaveText(HOLD.question);
  await expect(held.getByTestId('question-context')).toHaveText(`Notiz${HOLD.note}`);
  await expect(held.getByTestId('question-label')).toHaveText(HOLD.label);
  await held.getByTestId('question-link').click();
  await expect(page).toHaveURL(new RegExp(`/review/${heldId}`));
  await expect(page.getByTestId('review-details')).toBeVisible();

  await page.goto(`/projects/${PROJECT}/open-questions?kind=agent-question`);
  const asked = page.locator('[data-testid=open-question][data-kind=agent-question]').first();
  await expect(asked.getByTestId('question-text')).toHaveText(HOSTILE);
  await expect(asked.locator('img, b')).toHaveCount(0);
  await expect(asked.getByTestId('question-verbatim')).toContainText('agent:e2e-questions');

  await page.goto(`/projects/${PROJECT}/open-questions?kind=summary-note`);
  await expect(page.getByTestId('question-text').getByText(SUMMARY)).toBeVisible();

  await page.goto(`/projects/${PROJECT}/open-questions?kind=step-without-process`);
  const step = rows(page).first();
  const stepId = await step.getAttribute('data-question-id');
  const subject = (await api({ kind: 'step-without-process' })).find((q) => q.id === stepId)!
    .subject.id;
  await step.getByTestId('question-link').click();
  await expect(page).toHaveURL(new RegExp(`/value-chain\\?step=${subject}`));
  await expect(page.getByTestId('value-chain-page')).toBeVisible();

  await page.goto(`/projects/${PROJECT}/open-questions?kind=black-box-partner`);
  const pool = rows(page).first();
  await pool.getByTestId('question-link').click();
  await expect(page).toHaveURL(/\/models\/.+\?element=/);
  await expect(page.getByTestId('model-view')).toBeVisible();
});

test('exports the filtered list as Markdown and as CSV through the export route', async ({
  page,
}) => {
  const filtered = await api({ source: 'finding' });
  await page.goto(`/projects/${PROJECT}/open-questions?source=finding`);
  await expect(rows(page).first()).toBeVisible();

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Als CSV exportieren' }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe(`offene-fragen-${PROJECT}-finding.csv`);
  const bytes = readFileSync(await csv.path());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lines = bytes.toString('utf8').slice(1).split('\r\n').filter(Boolean);
  expect(lines[0]).toBe('"id";"Art";"Frage";"Ansprechpartner-Hinweis";"Antwort";"Antwortart"');
  expect(lines.slice(1).map((l) => /^"(q-[0-9a-f]{16})"/.exec(l)?.[1])).toEqual(
    filtered.map((q) => q.id),
  );
  // the answer columns are empty for the customer
  expect(lines.slice(1).every((l) => l.endsWith(';"";""'))).toBe(true);

  const [md] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Als Markdown exportieren' }).click(),
  ]);
  expect(md.suggestedFilename()).toBe(`offene-fragen-${PROJECT}-finding.md`);
  const text = readFileSync(await md.path(), 'utf8');
  expect(text.startsWith('# Offene Fragen: Nordwind Handel (Offene Fragen)')).toBe(true);
  expect(text).toContain('Filter: Quelle „Befund“.');
  for (const q of filtered) expect(text).toContain(q.id);
});

test('the model view lists the questions of its model and leads to the tab', async ({ page }) => {
  const finding = (await api({ source: 'finding' })).find((q) => q.subject.type === 'ref')!;
  const modelKey = finding.subject.id.slice(0, finding.subject.id.indexOf('#'));
  const expected = (await api({ modelKey })).filter((q) => q.modelKeys.includes(modelKey));

  await page.goto(`/projects/${PROJECT}/models/${modelKey}`);
  const section = page.getByTestId('model-open-questions');
  await expect(
    section.getByRole('heading', { name: `Offene Fragen (${expected.length})` }),
  ).toBeVisible();
  await expect(section.getByTestId('open-question')).toHaveCount(expected.length);
  expect(
    await section
      .getByTestId('open-question')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-question-id'))),
  ).toEqual(expected.map((q) => q.id));
  // a question at an element of this model highlights it in place
  await section.locator(`[data-question-id="${finding.id}"]`).getByTestId('question-link').click();
  await expect(page).toHaveURL(new RegExp(`\\?element=${finding.subject.id.split('#')[1]}`));
  await expect(
    page.locator('.djs-element.analyzr-finding, .djs-element.analyzr-endpoint').first(),
  ).toBeVisible();

  await section.getByRole('link', { name: /Im Tab zeigen/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/open-questions\\?model=${encodeURIComponent(modelKey)}`),
  );
  await expect(page.getByLabel('Modell oder Ordner', { exact: true })).toHaveValue(modelKey);
});
