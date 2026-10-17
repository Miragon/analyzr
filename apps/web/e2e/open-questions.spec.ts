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
 * after „Befunde“ with the API's count, the list in the API's order, the
 * filters giving what the API gives for the same filter, human and agent
 * texts as plain text, the links to the review screen, the chain page and
 * the model view, filters combined, both exports as downloads (named after
 * the filters; the CSV without the informational items), and the model
 * view's section.
 * Answers (M6 S5a), after the reading tests: „Beantworten“ on the held
 * relation (a note on it, the item answered, the live personal-data
 * warning) and on the held placement (a placement note; the hold stays, so
 * nothing becomes due or is queued), the Status filter against the API, an
 * answer in the model view's section with the pointer at the model's
 * documentation, and the exported CSV filled in and taken back with
 * „Antworten aus CSV übernehmen“ (the German file picker, preview, unknown
 * ids and invalid rows never stored and listed after storing, the rest on
 * confirmation).
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
interface Answer {
  id: string;
  kind: string;
  target: string;
  text: string;
  note: { type: string; subjectId: string; assertionId: string } | null;
  by: string;
  sourceKind: string;
}
interface Question {
  id: string;
  kind: string;
  source: string;
  subject: { type: string; id: string };
  modelKeys: string[];
  unlocks: number;
  askWho: { lanes: string[]; stepOwners: string[]; folder: string | null };
  state: string;
  answers: Answer[];
}

/** Kinds that ask nothing (the list ranks them last, the CSV leaves them out). */
const INFORMATIONAL = new Set(['summary-note', 'descriptive-model']);
const CHAIN_FINDINGS = new Set(['process-without-step', 'step-without-process', 'unresolved-link']);

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
  // the server's order: questions, then the value chain findings (owner answer 2026-10-16),
  // then informational items, each group by `unlocks` descending
  expect(await shownIds(page)).toEqual(all.map((q) => q.id));
  const shown = await rows(page).evaluateAll((els) =>
    els.map((e) => ({
      kind: e.getAttribute('data-kind') ?? '',
      unlocks: Number(e.getAttribute('data-unlocks')),
    })),
  );
  const group = (kind: string) => (INFORMATIONAL.has(kind) ? 2 : CHAIN_FINDINGS.has(kind) ? 1 : 0);
  const groups = shown.map((q) => group(q.kind));
  expect(groups).toEqual([...groups].sort((a, b) => a - b));
  for (const g of [0, 1, 2]) {
    const unlocks = shown.filter((q) => group(q.kind) === g).map((q) => q.unlocks);
    expect(unlocks).toEqual([...unlocks].sort((a, b) => b - a));
  }
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

// ------------------------------------------------------------------ answers (M6 S5a)

const AGENTS_SENTENCE =
  'Die Agenten berücksichtigen die Antwort, sobald das Paar neu bewertet wird.';

/** The cells of a CSV as the export writes it (`;`, every field quoted, CRLF), after the BOM. */
function parseSheet(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = text.startsWith('\uFEFF') ? 1 : 0;
  while (i < text.length) {
    expect(text[i]).toBe('"');
    let cell = '';
    i++;
    for (;;) {
      if (text[i] === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
      } else if (text[i] === '"') {
        i++;
        break;
      } else {
        cell += text[i];
        i++;
      }
    }
    row.push(cell);
    if (text[i] === ';') {
      i++;
    } else {
      expect(text.slice(i, i + 2)).toBe('\r\n');
      i += 2;
      rows.push(row);
      row = [];
    }
  }
  return rows;
}

const writeSheet = (rows: string[][]) =>
  `\uFEFF${rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(';')).join('\r\n')}\r\n`;

/** The tab's count of open questions in the navigation. */
const tabCount = (page: Page) =>
  page.getByRole('navigation', { name: 'Projektbereiche' }).getByRole('link', {
    name: /Offene Fragen/,
  });

test('a reviewer answers the held relation: a note on it, the item answered', async ({ page }) => {
  const held = (await api({ kind: 'held' })).find((q) => q.subject.type === 'relation')!;
  expect(held.subject.id).toBe(heldId);
  const open = await api({ state: 'open' });

  await page.goto(`/projects/${PROJECT}/open-questions?kind=held`);
  await expect(tabCount(page)).toHaveText(`Offene Fragen${open.length} offen`);
  const item = page.locator(`[data-testid=open-question][data-question-id="${held.id}"]`);
  await expect(item).toHaveAttribute('data-state', 'open');
  await item.getByTestId('question-answer-button').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Frage beantworten' })).toBeVisible();
  await expect(dialog.getByTestId('answer-question')).toContainText(HOLD.question);
  await expect(dialog.getByRole('radio')).toHaveText([
    'Antwort',
    'Liegt außerhalb der Landschaft',
    'Wird im Modell ergänzt',
  ]);
  await expect(dialog.getByRole('radio', { name: 'Antwort', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(dialog.getByTestId('answer-hint')).toHaveText(
    'Keine Namen oder anderen personenbezogenen Daten.',
  );
  await expect(dialog.getByTestId('answer-permanent')).toHaveText(
    'Eine gespeicherte Antwort lässt sich nicht mehr ändern oder löschen.',
  );
  await expect(dialog.getByTestId('answer-effect')).toContainText(AGENTS_SENTENCE);
  await expect(dialog.getByTestId('answer-effect')).toContainText(
    'Die Vormerkung bleibt; die Entscheidung triffst du.',
  );

  // the personal-data warning comes as you type and never blocks
  const field = dialog.getByLabel('Deine Antwort');
  await expect(field).toBeFocused();
  await field.fill('Die Buchhaltung; Rückfragen an rechnung@example.com');
  await expect(dialog.getByTestId('answer-personal-data')).toContainText(
    'Der Text enthält vermutlich eine E-Mail-Adresse.',
  );
  const save = dialog.getByRole('button', { name: 'Antwort speichern' });
  await expect(save).toBeEnabled();
  const answer = 'Die Buchhaltung verschickt die Rechnung, auch bei Teillieferungen.';
  await field.fill(answer);
  await expect(dialog.getByTestId('answer-personal-data')).toHaveText('');
  await save.click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Antwort gespeichert' })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(item.getByTestId('question-answer-button')).toBeFocused();

  // answered in the tab and over REST: a human note on the relation, linked from the answer
  await expect(item).toHaveAttribute('data-state', 'answered');
  await expect(item.getByTestId('question-state')).toHaveText('Beantwortet');
  await expect(item.getByTestId('question-answer-text')).toHaveText(answer);
  await expect(item.getByTestId('question-answer')).toContainText('als Notiz an der Relation');
  await expect(tabCount(page)).toHaveText(`Offene Fragen${open.length - 1} offen`);
  const [stored] = (await api({ kind: 'held' })).filter((q) => q.id === held.id);
  expect(stored!.state).toBe('answered');
  expect(stored!.answers).toHaveLength(1);
  expect(stored!.answers[0]).toMatchObject({
    kind: 'answer',
    target: 'relation-note',
    text: answer,
    sourceKind: 'human',
    note: { type: 'relation', subjectId: heldId },
  });
  const assertions = await owner.get(`/api/v1/projects/${PROJECT}/relations/${heldId}/assertions`);
  const note = (
    (await assertions.json()) as {
      items: { id: string; kind: string; rationale: string | null; sourceKind: string }[];
    }
  ).items.find((a) => a.id === stored!.answers[0]!.note!.assertionId);
  expect(note).toMatchObject({ kind: 'note', rationale: answer, sourceKind: 'human' });

  // the review screen shows it as the note it is
  await item.getByTestId('question-link').click();
  await expect(page.getByTestId('review-details')).toBeVisible();
  await expect(page.getByTestId('timeline-entry').filter({ hasText: answer })).toBeVisible();
});

test('a reviewer answers the held placement: a placement note, the hold stays, nothing due', async ({
  page,
}) => {
  const held = (await api({ kind: 'held' })).find((q) => q.subject.type === 'placement')!;
  expect(held.subject.id).toBe(heldPlacementId);
  const chain = `/api/v1/projects/${PROJECT}/value-chains/main`;
  const pipeline = async () =>
    (
      (await (await owner.get(chain)).json()) as {
        pipeline: { stage: string; task: { id: string; state: string } | null };
      }
    ).pipeline;
  const before = await pipeline();

  await page.goto(`/projects/${PROJECT}/open-questions?kind=held`);
  const item = page.locator(`[data-testid=open-question][data-question-id="${held.id}"]`);
  await item.getByTestId('question-answer-button').click();
  const dialog = page.getByRole('dialog');
  const effect = dialog.getByTestId('answer-effect');
  await expect(effect).toContainText('als Notiz an der Platzierung');
  // a held placement keeps homing its process: the answer makes nothing due
  await expect(effect).toContainText(
    'Die Platzierung bleibt vorgemerkt; solange bekommt kein Agent den Prozess.',
  );
  await expect(effect).not.toContainText('fällig');
  await expect(effect).not.toContainText(AGENTS_SENTENCE);
  const answer = 'Der Prozess gehört zur Finanzbuchhaltung, nicht zum Mahnwesen.';
  await dialog.getByLabel('Deine Antwort').fill(answer);
  await dialog.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(item).toHaveAttribute('data-state', 'answered');
  await expect(item.getByTestId('question-answer')).toContainText('als Notiz an der Platzierung');

  const [stored] = (await api({ kind: 'held' })).filter((q) => q.id === held.id);
  expect(stored!.answers).toHaveLength(1);
  expect(stored!.answers[0]).toMatchObject({
    kind: 'answer',
    target: 'placement-note',
    text: answer,
    note: { type: 'placement', subjectId: heldPlacementId },
  });
  const assertions = await owner.get(`${chain}/placements/${heldPlacementId}/assertions`);
  expect(assertions.ok()).toBe(true);
  const note = (
    (await assertions.json()) as {
      items: { id: string; kind: string; rationale: string | null; sourceKind: string }[];
    }
  ).items.find((a) => a.id === stored!.answers[0]!.note!.assertionId);
  expect(note).toMatchObject({ kind: 'note', rationale: answer, sourceKind: 'human' });
  // the placement stays held, so the process stays homed: nothing due, nothing queued (M6 §4.5, S5a)
  expect(await pipeline()).toEqual(before);
});

test('the Status filter separates answered from open questions, as the API does', async ({
  page,
}) => {
  const answered = await api({ state: 'answered' });
  expect(answered.length).toBeGreaterThan(0);
  await page.goto(`/projects/${PROJECT}/open-questions`);
  await expect(rows(page).first()).toBeVisible();
  const state = page.getByLabel('Status', { exact: true });
  await expect(state.getByRole('option', { name: `Beantwortet (${answered.length})` })).toHaveCount(
    1,
  );
  await state.selectOption('answered');
  await expect(page).toHaveURL(/state=answered/);
  expect(await shownIds(page)).toEqual(answered.map((q) => q.id));
  await state.selectOption('open');
  expect(await shownIds(page)).toEqual((await api({ state: 'open' })).map((q) => q.id));
});

test('the model view answers a gap signal and points at the model’s documentation', async ({
  page,
}) => {
  const signal = (await api({ kind: 'black-box-partner', state: 'open' }))[0]!;
  const modelKey = signal.modelKeys[0]!;
  await page.goto(`/projects/${PROJECT}/models/${modelKey}`);
  const section = page.getByTestId('model-open-questions');
  const item = section.locator(`[data-question-id="${signal.id}"]`);
  await item.getByTestId('question-answer-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('answer-effect')).toContainText(
    'ergänze die Dokumentation des Modells und importiere es erneut',
  );
  await expect(dialog.getByTestId('answer-effect')).not.toContainText(AGENTS_SENTENCE);
  await dialog.getByRole('radio', { name: 'Wird im Modell ergänzt' }).click();
  await dialog.getByLabel('Deine Antwort').fill('Der Partner bekommt ein eigenes Modell.');
  await dialog.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(item).toHaveAttribute('data-state', 'answered');
  await expect(item.getByTestId('question-answer-kind')).toHaveText('Wird im Modell ergänzt');

  const [stored] = (await api({ kind: 'black-box-partner' })).filter((q) => q.id === signal.id);
  expect(stored!.answers.map((a) => [a.kind, a.target, a.note])).toEqual([
    ['will-be-modelled', 'answer', null],
  ]);
});

test('answers from the filled-in CSV: a preview first, unknown ids and invalid rows never stored', async ({
  page,
}) => {
  await page.goto(`/projects/${PROJECT}/open-questions`);
  await expect(rows(page).first()).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Als CSV exportieren' }).click(),
  ]);
  const sheet = parseSheet(readFileSync(await download.path(), 'utf8'));
  expect(sheet[0]).toEqual([
    'id',
    'Art',
    'Frage',
    'Ansprechpartner-Hinweis',
    'Antwort',
    'Antwortart',
  ]);

  // the answered items come back with their latest answer: unchanged, nothing stored twice
  const before = await api();
  const answered = before.filter((q) => q.state === 'answered' && !INFORMATIONAL.has(q.kind));
  // the held relation, the held placement and the gap signal answered above
  expect(answered.length).toBe(3);
  for (const q of answered) {
    const row = sheet.find((r) => r[0] === q.id)!;
    expect(row[4]).toBe(q.answers.at(-1)!.text);
  }
  // the customer answers two open questions, one row with a kind the sheet does not know,
  // and one row whose question no longer exists (with an address, but never stored: no hint)
  const open = before.filter((q) => q.state === 'open' && !INFORMATIONAL.has(q.kind));
  const [first, second, third] = [
    open.find((q) => q.kind === 'process-without-step')!,
    open.find((q) => q.kind === 'message-partner-missing')!,
    open.find((q) => q.kind === 'step-without-process')!,
  ];
  const fill = (id: string, answer: string, kind: string) => {
    const row = sheet.find((r) => r[0] === id)!;
    row[4] = answer;
    row[5] = kind;
  };
  fill(first.id, 'Der Prozess gehört zum Schritt „Auftragsabwicklung“.', '');
  fill(second.id, 'Der Partner ist ein externer Zahlungsdienst.', 'Liegt außerhalb der Landschaft');
  fill(third.id, 'Vielleicht später.', 'Vielleicht');
  sheet.push(['q-0000000000000000', 'Befund', 'Alte Frage', '', 'Fragen an info@example.com', '']);

  await page.getByRole('button', { name: 'Antworten aus CSV übernehmen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('answer-sheet-file-name')).toHaveText('Keine Datei ausgewählt');
  // the German button opens the browser's file chooser
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Datei auswählen' }).click(),
  ]);
  await chooser.setFiles({
    name: 'antworten.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(writeSheet(sheet), 'utf8'),
  });
  await expect(dialog.getByTestId('answer-sheet-file-name')).toHaveText('„antworten.csv“');
  const preview = dialog.getByTestId('answer-sheet-preview');
  const ignored = sheet.length - 1 - answered.length - 4;
  await expect(dialog.getByTestId('answer-sheet-summary')).toHaveText(
    `„antworten.csv“: 2 Antworten werden gespeichert, ${answered.length} sind schon gespeichert, 1 unbekannte Kennung, 1 ungültige Zeile, ${ignored} Zeilen ohne Antwort.`,
  );
  await expect(dialog.getByTestId('answer-sheet-personal-data')).toHaveCount(0);
  const byOutcome = (outcome: string) =>
    preview.locator(`[data-testid=answer-sheet-row][data-outcome=${outcome}]`);
  expect(
    await byOutcome('recorded').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-question-id')),
    ),
  ).toEqual(sheet.slice(1).flatMap((r) => ([first.id, second.id].includes(r[0]!) ? [r[0]] : [])));
  await expect(byOutcome('unchanged')).toHaveCount(answered.length);
  await expect(byOutcome('unknown')).toHaveAttribute('data-question-id', 'q-0000000000000000');
  await expect(byOutcome('invalid')).toHaveAttribute('data-question-id', third.id);
  await expect(byOutcome('invalid').getByTestId('answer-sheet-reason')).toContainText(
    'Die Antwortart ist keine von',
  );
  // the preview stored nothing
  expect((await api({ state: 'answered' })).length).toBe(answered.length);

  await dialog.getByRole('button', { name: '2 Antworten speichern' }).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: '2 Antworten gespeichert' }),
  ).toBeVisible();
  // two rows were left out: the dialog stays with them and their texts, then closes
  await expect(dialog.getByTestId('answer-sheet-left-out')).toBeVisible();
  await expect(byOutcome('unknown')).toContainText('Fragen an info@example.com');
  await expect(byOutcome('invalid')).toContainText('Vielleicht später.');
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();

  const after = await api();
  const answerOf = (id: string) => after.find((q) => q.id === id)!;
  expect(answerOf(first.id).answers.map((a) => [a.kind, a.text])).toEqual([
    ['answer', 'Der Prozess gehört zum Schritt „Auftragsabwicklung“.'],
  ]);
  expect(answerOf(second.id).answers.map((a) => [a.kind, a.text])).toEqual([
    ['outside-landscape', 'Der Partner ist ein externer Zahlungsdienst.'],
  ]);
  expect(answerOf(third.id).state).toBe('open');
  for (const q of answered) expect(answerOf(q.id).answers).toHaveLength(1);
  await expect(
    page.locator(`[data-testid=open-question][data-question-id="${second.id}"]`),
  ).toHaveAttribute('data-state', 'answered');
});
