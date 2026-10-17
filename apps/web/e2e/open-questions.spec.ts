import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

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
 * Actions (M6 §4.8 a, S5c-1), after the reading tests: every item's primary
 * action as the API names it; „Notiz hinzufügen“ on the held relation (a
 * note on it, the item stays open); the held placement and the agent's
 * question decided inline; a call target linked from the process list (the
 * finding stays in „Befunde“, „Rückgängig“ rejects the relation), a dynamic
 * call's possible targets, a message endpoint's partner, a pool linked to a
 * suggested process (the preview names the proposal it accepts, the pool's
 * own processes are not offered); a process placed on
 * a step („Rückgängig“), on „außerhalb“ in one click, a step given a
 * process; the valid copy of a duplicated process id; the outside mark on a
 * pool and its withdrawal, the Status filter „Erledigt (außerhalb)“; the
 * requeue of an analysis with unjudged pairs (the agent judges one of a
 * task's assigned pairs, so the others stay unjudged); the
 * exported CSV taken back as notes (also a sheet with S5a's „Antwortart“);
 * in the model view's section the outside mark, a link, a placement, a
 * decision, a requeue, the valid copy (an agent's new call brings the
 * duplicate back) and a note in place (a step's own items, `fix-link` and a
 * process for a step, never show there: steps belong to no model);
 * „Link korrigieren“ on a step whose link names no process (the chain page
 * at the step, its link editor in edit mode); and „Verknüpfen mit …“ on a
 * collapsed subprocess selected on the canvas (a project of its own).
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
  type: string;
  status: string;
  tier: string;
  version: number;
}
interface Answer {
  id: string;
  kind: string;
  role: 'note' | 'outside-mark';
  target: string;
  text: string | null;
  note: { type: string; subjectId: string; assertionId: string } | null;
  by: string;
  sourceKind: string;
  withdrawal: { by: string; seq: number; at: string } | null;
}
interface Action {
  type: string;
  primary: boolean;
  label: string;
  pick?: string;
  multiple?: boolean;
  suggested?: string[];
  proposals?: { target: string; relation: string; type: string; from: string; to: string }[];
  exclude?: string[];
  choices?: string[];
  step?: string;
  decides?: { type: string; id: string; version: number }[];
}
interface Question {
  id: string;
  kind: string;
  source: string;
  subject: { type: string; id: string };
  subjectLabel: string;
  modelKeys: string[];
  unlocks: number;
  askWho: { lanes: string[]; stepOwners: string[]; folder: string | null };
  state: string;
  answers: Answer[];
  actions: Action[];
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
  // A task with a lexical pair and at least one more assigned pair: the agent judges one,
  // so its submission leaves the others unjudged (the `unjudged` item, its requeue).
  const assigned = (t: Claimed) =>
    t.input.candidates.filter((c) => c[3] === 'rule' || c[3] === 'key' || c[3] === 'lexical');
  const task = claimed.find(
    (t) => assigned(t).length >= 2 && assigned(t).some((c) => c[3] === 'lexical'),
  );
  expect(task, 'a claimed task with a lexical and another assigned pair').toBeDefined();
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
  expect(lines[0]).toBe('"id";"Art";"Frage";"Ansprechpartner-Hinweis";"Antwort"');
  expect(lines.slice(1).map((l) => /^"(q-[0-9a-f]{16})"/.exec(l)?.[1])).toEqual(
    filtered.map((q) => q.id),
  );
  // the answer column is empty for the customer (five columns since M6 S5c-1)
  expect(lines.slice(1).every((l) => l.endsWith(';""'))).toBe(true);

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

// ------------------------------------------------------------------ actions (M6 S5c-1)

const AGENTS_SENTENCE = 'Die Agenten berücksichtigen die Notiz, sobald das Paar neu bewertet wird.';
const UNDO_REASON = 'Rückgängig gemacht';

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

const item = (page: Page, id: string) =>
  page.locator(`[data-testid=open-question][data-question-id="${id}"]`);
const primaryOf = (scope: Locator) =>
  scope.locator('[data-testid=question-action][data-primary=true]');
const panelOf = (scope: Locator) => scope.getByTestId('question-action-panel');
const toast = (page: Page, title: string) => page.getByTestId('toast').filter({ hasText: title });

/** An action from „Weitere Aktionen“. */
async function fromMenu(page: Page, scope: Locator, name: string) {
  await scope.getByTestId('question-more-actions').click();
  await page.getByRole('menuitem', { name }).click();
}

/** The action's response (`POST …/actions`), as the server answered it. */
interface ActionResult {
  result: string;
  question: Question | null;
  relations: { effect: string; relation: Relation & { from: string; to: string } }[];
  placements: { effect: string; placement: { id: string; elementId: string; status: string } }[];
  answer: Answer | null;
}
const actionResponse = (page: Page, id: string) =>
  page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/open-questions/${id}/actions`),
  );

async function relationOf(id: string): Promise<Relation & { from: string; to: string }> {
  const response = await owner.get(`/api/v1/projects/${PROJECT}/relations/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as Relation & { from: string; to: string };
}

async function placementsWith(status: string): Promise<{ id: string; elementId: string }[]> {
  const response = await owner.get(
    `/api/v1/projects/${PROJECT}/value-chains/main/placements?status=${status}&limit=200`,
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { items: { id: string; elementId: string }[] }).items;
}

/** The first open item of a kind whose primary action is `type`. */
async function openItem(kind: string, type: string, extra: (q: Question) => boolean = () => true) {
  const found = (await api({ kind, state: 'open' })).find(
    (q) => q.actions.find((a) => a.primary)?.type === type && extra(q),
  );
  expect(found, `an open ${kind} item with the primary action ${type}`).toBeDefined();
  return found!;
}

test('every item offers its primary action as the API names it; a note leaves the held relation open', async ({
  page,
}) => {
  const all = await api();
  await page.goto(`/projects/${PROJECT}/open-questions`);
  expect(await shownIds(page)).toEqual(all.map((q) => q.id));
  const shown = await rows(page).evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute('data-question-id') ?? '',
      primary:
        e.querySelector('[data-testid=question-action][data-primary=true]')?.textContent ?? null,
      more: e.querySelector('[data-testid=question-more-actions]') !== null,
    })),
  );
  expect(shown).toEqual(
    all.map((q) => ({
      id: q.id,
      primary: q.actions.find((a) => a.primary)?.label ?? null,
      more: q.actions.filter((a) => !a.primary).length > 0,
    })),
  );
  // informational items ask nothing and offer nothing
  for (const q of all.filter((x) => INFORMATIONAL.has(x.kind)))
    await expect(item(page, q.id).getByTestId('question-actions')).toHaveCount(0);

  // „Notiz hinzufügen“ on the held relation: no answer kinds, a note on the relation
  const held = all.find((q) => q.kind === 'held' && q.subject.type === 'relation')!;
  expect(held.subject.id).toBe(heldId);
  const open = await api({ state: 'open' });
  await page.goto(`/projects/${PROJECT}/open-questions?kind=held`);
  await expect(tabCount(page)).toHaveText(`Offene Fragen${open.length} offen`);
  const row = item(page, held.id);
  await expect(primaryOf(row)).toHaveText('Entscheiden');
  await fromMenu(page, row, 'Notiz hinzufügen');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Notiz hinzufügen' })).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog).not.toContainText('Antwortart');
  await expect(dialog.getByTestId('note-effect')).toContainText(AGENTS_SENTENCE);
  const field = dialog.getByLabel('Deine Notiz');
  await expect(field).toBeFocused();
  await field.fill('Die Buchhaltung; Rückfragen an rechnung@example.com');
  await expect(dialog.getByTestId('note-personal-data')).toContainText(
    'Der Text enthält vermutlich eine E-Mail-Adresse.',
  );
  const note = 'Die Buchhaltung verschickt die Rechnung, auch bei Teillieferungen.';
  await field.fill(note);
  await dialog.getByRole('button', { name: 'Notiz speichern' }).click();
  await expect(toast(page, 'Notiz gespeichert')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(row.getByTestId('question-more-actions')).toBeFocused();
  // the note informs; the item stays open and counted
  await expect(row.getByTestId('question-answer-text')).toHaveText(note);
  await expect(row).toHaveAttribute('data-state', 'open');
  await expect(tabCount(page)).toHaveText(`Offene Fragen${open.length} offen`);
  const [stored] = (await api({ kind: 'held' })).filter((q) => q.id === held.id);
  expect(stored!.state).toBe('open');
  expect(stored!.answers.map((a) => [a.kind, a.role, a.target, a.text])).toEqual([
    ['answer', 'note', 'relation-note', note],
  ]);
  const assertions = await owner.get(`/api/v1/projects/${PROJECT}/relations/${heldId}/assertions`);
  const noted = (
    (await assertions.json()) as { items: { id: string; kind: string; rationale: string | null }[] }
  ).items.find((a) => a.id === stored!.answers[0]!.note!.assertionId);
  expect(noted).toMatchObject({ kind: 'note', rationale: note });
});

test('decide inline: the held placement accepted, the agent’s question rejected', async ({
  page,
}) => {
  const heldPlacement = (await api({ kind: 'held' })).find((q) => q.subject.type === 'placement')!;
  expect(heldPlacement.subject.id).toBe(heldPlacementId);
  await page.goto(`/projects/${PROJECT}/open-questions?kind=held`);
  const row = item(page, heldPlacement.id);
  await primaryOf(row).click();
  const decision = panelOf(row).getByTestId('action-decide-placement');
  await expect(decision).toBeVisible();
  // many items share the page: no single-key shortcuts on the buttons
  await expect(decision.locator('kbd')).toHaveCount(0);
  await decision.getByRole('button', { name: 'Annehmen' }).click();
  await expect(toast(page, 'Angenommen')).toBeVisible();
  await expect(row).toHaveCount(0);
  expect((await placementsWith('accepted')).map((p) => p.id)).toContain(heldPlacementId);

  const asked = await openItem('agent-question', 'decide');
  await page.goto(`/projects/${PROJECT}/open-questions?kind=agent-question`);
  const question = item(page, asked.id);
  await primaryOf(question).click();
  const panel = panelOf(question).getByTestId('action-decide-relation');
  await panel.getByRole('button', { name: 'Ablehnen' }).click();
  await panel.getByLabel('Grund der Ablehnung').fill('Verschiedene Vorgänge.');
  await panel.getByRole('button', { name: 'Ablehnen' }).click();
  await expect(toast(page, 'Abgelehnt')).toBeVisible();
  await expect(question).toHaveCount(0);
  expect((await relationOf(asked.subject.id)).status).toBe('rejected');
});

test('link a call target from the process list: the finding stays in „Befunde“, „Rückgängig“ rejects the relation', async ({
  page,
}) => {
  const call = await openItem('call-target-unknown', 'link', (q) => q.source === 'finding');
  const action = call.actions.find((a) => a.type === 'link')!;
  await page.goto(`/projects/${PROJECT}/open-questions?kind=call-target-unknown`);
  const row = item(page, call.id);
  await primaryOf(row).click();
  const panel = panelOf(row);
  await expect(panel.getByLabel('Prozess suchen')).toBeFocused();
  const target = panel
    .locator('[data-testid=action-option]')
    .filter({ hasNot: page.locator('.sr-only') })
    .first();
  const ref = (await target.getAttribute('data-ref'))!;
  expect(action.suggested ?? []).not.toContain(ref);
  await target.click();
  await expect(panel.getByTestId('action-preview')).toHaveText(
    /^Legt eine angenommene Relation „.+“ → „.+“ an\.$/,
  );
  const response = actionResponse(page, call.id);
  await panel.getByTestId('action-submit').click();
  const result = (await (await response).json()) as ActionResult;
  expect(result.relations.map((r) => [r.effect, r.relation.type, r.relation.to])).toEqual([
    ['manual', 'manual', ref],
  ]);
  const undo = toast(page, 'Verknüpft').getByTestId('toast-action');
  await expect(undo).toHaveText('Rückgängig');
  // R1: the item leaves the list, „Befunde“ keeps the finding
  await expect(row).toHaveCount(0);
  expect((await api({ kind: 'call-target-unknown' })).map((q) => q.id)).not.toContain(call.id);
  const findings = (await (await owner.get(`/api/v1/projects/${PROJECT}/findings`)).json()) as {
    items: { kind: string; refs: string[] }[];
  };
  expect(
    findings.items.some((f) => f.kind === 'unresolved-call' && f.refs.includes(call.subject.id)),
  ).toBe(true);
  // the focus moved on to the next item
  await expect(page.locator(':focus')).toHaveAttribute(
    'data-testid',
    /question-action|open-question/,
  );

  await undo.click();
  await expect(toast(page, 'Rückgängig gemacht')).toBeVisible();
  const relation = await relationOf(result.relations[0]!.relation.id);
  expect(relation.status).toBe('rejected');
  await expect
    .poll(async () => (await api({ kind: 'call-target-unknown' })).map((q) => q.id))
    .toContain(call.id);
  const history = (await (
    await owner.get(
      `/api/v1/projects/${PROJECT}/relations/${result.relations[0]!.relation.id}/assertions`,
    )
  ).json()) as { items: { kind: string; verdict: string | null; rationale: string | null }[] };
  expect(history.items.at(-1)).toMatchObject({ verdict: 'reject', rationale: UNDO_REASON });
});

test('link several possible targets of a dynamic call at once', async ({ page }) => {
  const dynamic = await openItem('call-target-dynamic', 'link');
  await page.goto(`/projects/${PROJECT}/open-questions?kind=call-target-dynamic`);
  const row = item(page, dynamic.id);
  await primaryOf(row).click();
  const panel = panelOf(row);
  const boxes = panel.getByRole('checkbox');
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await expect(panel.getByText('2 von höchstens 10 gewählt')).toBeVisible();
  const response = actionResponse(page, dynamic.id);
  await panel.getByTestId('action-submit').click();
  const result = (await (await response).json()) as ActionResult;
  expect(result.relations).toHaveLength(2);
  await expect(toast(page, 'Verknüpft')).toBeVisible();
  for (const r of result.relations) {
    expect((await relationOf(r.relation.id)).status).toBe('accepted');
    expect(r.relation.from).toBe(dynamic.subject.id);
  }
  await expect(row).toHaveCount(0);
});

test('link a message endpoint to a complementary endpoint of another process', async ({ page }) => {
  const endpoint = await openItem('message-partner-missing', 'link');
  await page.goto(`/projects/${PROJECT}/open-questions?kind=message-partner-missing`);
  const row = item(page, endpoint.id);
  await primaryOf(row).click();
  const panel = panelOf(row);
  // endpoints first, grouped by process; whole processes last
  await expect(panel.getByTestId('picker-section').last()).toHaveText('Ganzer Prozess');
  await panel.getByTestId('action-option').first().click();
  await expect(panel.getByTestId('action-preview')).toContainText('angenommene Relation');
  const response = actionResponse(page, endpoint.id);
  await panel.getByTestId('action-submit').click();
  const result = (await (await response).json()) as ActionResult;
  expect(result.relations).toHaveLength(1);
  await expect(toast(page, 'Verknüpft')).toBeVisible();
  await expect(row).toHaveCount(0);
  expect((await api({ kind: 'message-partner-missing' })).map((q) => q.id)).not.toContain(
    endpoint.id,
  );
});

test('link a pool to a suggested process: the preview names the proposal, the link accepts it', async ({
  page,
}) => {
  // a pool whose flow end has a key-tier proposal from another process (nordwind: „Lieferant“)
  const pool = (await api({ kind: 'black-box-partner', state: 'open' })).find((q) =>
    q.actions.some((a) => a.type === 'link' && (a.proposals ?? []).length > 0),
  );
  expect(pool, 'a pool with a suggested process').toBeDefined();
  const action = pool!.actions.find((a) => a.type === 'link')!;
  const proposal = action.proposals![0]!;
  await page.goto(`/projects/${PROJECT}/open-questions?kind=black-box-partner`);
  const row = item(page, pool!.id);
  await fromMenu(page, row, 'Verknüpfen mit …');
  const panel = panelOf(row);
  // the processes of the pool's flow ends are not offered: a link would join them to themselves
  for (const own of action.exclude ?? [])
    await expect(panel.locator(`[data-testid=action-option][data-ref="${own}"]`)).toHaveCount(0);
  await expect(panel.getByTestId('picker-section').first()).toHaveText('Vorgeschlagen');
  await panel.locator(`[data-testid=action-option][data-ref="${proposal.target}"]`).click();
  await expect(panel.getByTestId('action-preview')).toContainText('nimmt den Vorschlag');
  const response = actionResponse(page, pool!.id);
  await panel.getByTestId('action-submit').click();
  const result = (await (await response).json()) as ActionResult;
  expect(
    result.relations.filter((r) => r.effect === 'decision').map((r) => r.relation.id),
  ).toContain(proposal.relation);
  await expect(toast(page, 'Verknüpft')).toContainText('angenommen');
  expect((await relationOf(proposal.relation)).status).toBe('accepted');
});

test('place a process on a step and take it back; „Gehört zu keinem Schritt“ in one click', async ({
  page,
}) => {
  const first = await openItem('process-without-step', 'place');
  await page.goto(`/projects/${PROJECT}/open-questions?kind=process-without-step`);
  const row = item(page, first.id);
  await primaryOf(row).click();
  const panel = panelOf(row);
  await expect(panel.getByTestId('action-option').last()).toHaveAttribute('data-step', '@outside');
  const option = panel.getByTestId('action-option').first();
  const step = (await option.getAttribute('data-step'))!;
  await option.click();
  await expect(panel.getByTestId('action-preview')).toHaveText(
    /^Platziert „.+“ auf „.+“ \(manuell, gilt sofort\)\.$/,
  );
  const response = actionResponse(page, first.id);
  await panel.getByTestId('action-submit').click();
  const result = (await (await response).json()) as ActionResult;
  expect(result.placements.map((p) => [p.effect, p.placement.elementId])).toEqual([
    ['manual', step],
  ]);
  await expect(row).toHaveCount(0);
  await toast(page, 'Platziert').getByTestId('toast-action').click();
  await expect(toast(page, 'Rückgängig gemacht')).toBeVisible();
  expect((await placementsWith('rejected')).map((p) => p.id)).toContain(
    result.placements[0]!.placement.id,
  );
  await expect
    .poll(async () => (await api({ kind: 'process-without-step' })).map((q) => q.id))
    .toContain(first.id);

  const second = await openItem('process-without-step', 'place', (q) => q.id !== first.id);
  await page.goto(`/projects/${PROJECT}/open-questions?kind=process-without-step`);
  const other = item(page, second.id);
  const outside = actionResponse(page, second.id);
  await fromMenu(page, other, 'Gehört zu keinem Schritt');
  const placed = (await (await outside).json()) as ActionResult;
  expect(placed.placements[0]!.placement.elementId).toBe('@outside');
  await expect(toast(page, 'Platziert')).toContainText('Außerhalb der Kette');
  await expect(other).toHaveCount(0);
});

test('give a step without a process one', async ({ page }) => {
  const step = await openItem('step-without-process', 'place');
  await page.goto(`/projects/${PROJECT}/open-questions?kind=step-without-process`);
  const row = item(page, step.id);
  await primaryOf(row).click();
  const panel = panelOf(row);
  await panel.getByTestId('action-option').first().click();
  await expect(panel.getByTestId('action-submit')).toHaveText('Zuordnen');
  const response = actionResponse(page, step.id);
  await panel.getByTestId('action-submit').click();
  const result = (await (await response).json()) as ActionResult;
  expect(result.placements[0]!.placement.elementId).toBe(step.subject.id);
  await expect(toast(page, 'Platziert')).toBeVisible();
  await expect(row).toHaveCount(0);
});

test('choose the valid copy of a duplicated process id: the calls decided, the item gone', async ({
  page,
}) => {
  const dup = await openItem('duplicate-process-id', 'choose-copy');
  const action = dup.actions.find((a) => a.type === 'choose-copy')!;
  await page.goto(`/projects/${PROJECT}/open-questions?kind=duplicate-process-id`);
  const row = item(page, dup.id);
  await primaryOf(row).click();
  const panel = panelOf(row);
  await expect(panel.getByTestId('action-option')).toHaveCount(action.choices!.length);
  await panel.getByTestId('action-option').first().click();
  await expect(panel.getByTestId('action-note')).toHaveValue(/^Gültig ist „.+“ in .+; die anderen/);
  await expect(
    panel.getByRole('checkbox', {
      name: 'Andere Kopien in der Wertschöpfungskette auf „außerhalb“ setzen',
    }),
  ).toBeChecked();
  const response = actionResponse(page, dup.id);
  await panel.getByTestId('action-submit').click();
  const result = (await (await response).json()) as ActionResult;
  await expect(toast(page, 'Gültige Kopie gewählt').getByTestId('toast-action')).toHaveText(
    'In „Relationen“ ansehen',
  );
  expect(result.relations.map((r) => r.relation.id).sort()).toEqual(
    action.decides!.map((d) => d.id).sort(),
  );
  for (const r of result.relations)
    expect(['accepted', 'rejected']).toContain((await relationOf(r.relation.id)).status);
  // R1b: no call waits on the copies any more
  await expect(row).toHaveCount(0);
  expect(await api({ kind: 'duplicate-process-id' })).toEqual([]);
});

test('mark a pool outside the landscape in one click, take it back, and find marked items by Status', async ({
  page,
}) => {
  const pool = await openItem('black-box-partner', 'outside');
  await page.goto(`/projects/${PROJECT}/open-questions?kind=black-box-partner`);
  const row = item(page, pool.id);
  const response = actionResponse(page, pool.id);
  await primaryOf(row).click();
  const marked = (await (await response).json()) as ActionResult;
  expect(marked.answer).toMatchObject({
    kind: 'outside-landscape',
    role: 'outside-mark',
    text: null,
  });
  await expect(row).toHaveAttribute('data-state', 'answered');
  await expect(row.getByTestId('question-state')).toHaveText('Erledigt (außerhalb)');
  await toast(page, 'Als außerhalb der Landschaft markiert').getByTestId('toast-action').click();
  await expect(toast(page, 'Markierung zurückgenommen')).toBeVisible();
  await expect(row).toHaveAttribute('data-state', 'open');
  const [withdrawn] = (await api({ kind: 'black-box-partner' })).filter((q) => q.id === pool.id);
  expect(withdrawn!.answers.map((a) => [a.role, a.withdrawal !== null])).toEqual([
    ['outside-mark', true],
  ]);

  // marked again: the Status filter finds it as the API does
  await primaryOf(row).click();
  await expect(row).toHaveAttribute('data-state', 'answered');
  const answered = await api({ state: 'answered' });
  expect(answered.map((q) => q.id)).toEqual([pool.id]);
  await page.goto(`/projects/${PROJECT}/open-questions`);
  const state = page.getByLabel('Status', { exact: true });
  await expect(state.getByRole('option', { name: 'Erledigt (außerhalb) (1)' })).toHaveCount(1);
  await state.selectOption('answered');
  await expect(page).toHaveURL(/state=answered/);
  expect(await shownIds(page)).toEqual([pool.id]);
  // the marked item offers the way back on itself
  await item(page, pool.id).getByTestId('question-withdraw-mark').click();
  await expect(toast(page, 'Markierung zurückgenommen')).toBeVisible();
  await expect.poll(async () => (await api({ state: 'answered' })).length).toBe(0);
});

test('requeue an analysis that left pairs unjudged', async ({ page }) => {
  const unjudged = (await api({ kind: 'unjudged' }))[0];
  expect(unjudged, 'the agent left assigned pairs unjudged').toBeDefined();
  await page.goto(`/projects/${PROJECT}/open-questions?kind=unjudged`);
  await primaryOf(item(page, unjudged!.id)).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: /Erneut eingeplant|Schon eingeplant/ }),
  ).toBeVisible();
});

test('notes from the filled-in CSV; a sheet with S5a’s „Antwortart“ still reads', async ({
  page,
}) => {
  await page.goto(`/projects/${PROJECT}/open-questions`);
  await expect(rows(page).first()).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Als CSV exportieren' }).click(),
  ]);
  const sheet = parseSheet(readFileSync(await download.path(), 'utf8'));
  expect(sheet[0]).toEqual(['id', 'Art', 'Frage', 'Ansprechpartner-Hinweis', 'Antwort']);

  // items with notes come back with their latest note: unchanged, nothing stored twice
  const before = await api();
  const noted = before.filter((q) => q.answers.some((a) => a.role === 'note'));
  for (const q of noted) {
    const row = sheet.find((r) => r[0] === q.id)!;
    expect(row[4]).toBe(q.answers.filter((a) => a.role === 'note').at(-1)!.text);
  }
  // the customer writes two notes and one row whose question no longer exists; the sheet
  // gets S5a's column `Antwortart` back: an outside mark on a pool, and an unknown kind
  const open = before.filter((q) => q.state === 'open' && !INFORMATIONAL.has(q.kind));
  const [first, second, pool, third] = [
    open.find((q) => q.kind === 'process-without-step')!,
    open.find((q) => q.kind === 'message-partner-missing')!,
    open.find((q) => q.kind === 'black-box-partner')!,
    open.find((q) => q.kind === 'step-without-process')!,
  ];
  for (const r of sheet) r.push(r === sheet[0] ? 'Antwortart' : '');
  const fill = (id: string, answer: string, kind: string) => {
    const row = sheet.find((r) => r[0] === id)!;
    row[4] = answer;
    row[5] = kind;
  };
  fill(first.id, 'Der Prozess gehört zum Schritt „Auftragsabwicklung“.', '');
  fill(second.id, 'Der Partner ist ein externer Zahlungsdienst.', 'Antwort');
  fill(pool.id, 'Ein externer Spediteur.', 'Liegt außerhalb der Landschaft');
  fill(third.id, 'Vielleicht später.', 'Vielleicht');
  sheet.push(['q-0000000000000000', 'Befund', 'Alte Frage', '', 'Fragen an info@example.com', '']);

  await page.getByRole('button', { name: 'Antworten aus CSV übernehmen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Jede Antwort wird als Notiz an ihrer Frage gespeichert');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Datei auswählen' }).click(),
  ]);
  await chooser.setFiles({
    name: 'antworten.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(writeSheet(sheet), 'utf8'),
  });
  const preview = dialog.getByTestId('answer-sheet-preview');
  const ignored = sheet.length - 1 - noted.length - 5;
  await expect(dialog.getByTestId('answer-sheet-summary')).toHaveText(
    `„antworten.csv“: 3 Antworten werden gespeichert, ${noted.length === 0 ? '' : noted.length === 1 ? '1 ist schon gespeichert, ' : `${noted.length} sind schon gespeichert, `}1 unbekannte Kennung, 1 ungültige Zeile, ${ignored} Zeilen ohne Antwort.`,
  );
  const byOutcome = (outcome: string) =>
    preview.locator(`[data-testid=answer-sheet-row][data-outcome=${outcome}]`);
  await expect(
    byOutcome('recorded')
      .locator(`[data-question-id="${pool.id}"]`)
      .or(byOutcome('recorded').filter({ hasText: 'Ein externer Spediteur.' })),
  ).toContainText('Liegt außerhalb der Landschaft');
  await expect(byOutcome('invalid').getByTestId('answer-sheet-reason')).toContainText(
    'Die Antwortart dieser älteren CSV ist keine von',
  );
  await dialog.getByRole('button', { name: '3 Antworten speichern' }).click();
  await expect(toast(page, '3 Antworten gespeichert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();

  const after = await api();
  const of = (id: string) => after.find((q) => q.id === id)!;
  expect(of(first.id).answers.map((a) => [a.role, a.text])).toEqual([
    ['note', 'Der Prozess gehört zum Schritt „Auftragsabwicklung“.'],
  ]);
  // notes leave their items open; the old sheet's mark marks the pool
  expect(of(first.id).state).toBe('open');
  expect(of(second.id).state).toBe('open');
  expect(of(pool.id).state).toBe('answered');
  expect(of(pool.id).answers.at(-1)).toMatchObject({
    role: 'outside-mark',
    text: 'Ein externer Spediteur.',
  });
  expect(of(third.id).answers).toEqual([]);
  // back to open for the next tests: take the mark back
  await page.goto(`/projects/${PROJECT}/open-questions?state=answered`);
  await item(page, pool.id).getByTestId('question-withdraw-mark').click();
  await expect.poll(async () => (await api({ state: 'answered' })).length).toBe(0);
});

test('the model view’s section acts in place: the outside mark and its undo, a link, a placement, a decision, a requeue, the valid copy and a note', async ({
  page,
}) => {
  // a hold to decide here: the owner holds one more key-tier proposal
  const landscape = (await (await owner.get(`/api/v1/projects/${PROJECT}/landscape`)).json()) as {
    relations: (Relation & { from: string; to: string })[];
  };
  const proposal = landscape.relations.find((r) => r.tier === 'key' && r.status === 'proposed');
  expect(proposal).toBeDefined();
  expect(
    (
      await owner.post(`/api/v1/projects/${PROJECT}/relations/${proposal!.id}/decision`, {
        data: { verdict: 'hold', version: proposal!.version, note: 'Im Modell klären.' },
      })
    ).ok(),
  ).toBe(true);

  const section = page.getByTestId('model-open-questions');
  const inSection = (id: string) => section.locator(`[data-question-id="${id}"]`);
  const openModel = async (q: Question) => {
    const modelKey = q.modelKeys[0]!;
    await page.goto(`/projects/${PROJECT}/models/${modelKey}`);
    await expect(inSection(q.id)).toBeVisible();
    return inSection(q.id);
  };

  // the outside mark and „Rückgängig“
  const pool = await openItem('black-box-partner', 'outside');
  let row = await openModel(pool);
  await primaryOf(row).click();
  await expect(row).toHaveAttribute('data-state', 'answered');
  await toast(page, 'Als außerhalb der Landschaft markiert').getByTestId('toast-action').click();
  await expect(row).toHaveAttribute('data-state', 'open');

  // a link from „Weitere Aktionen“ of the same pool
  const anchors = pool.actions.find((a) => a.type === 'link');
  if (anchors) {
    await fromMenu(page, row, 'Verknüpfen mit …');
    const panel = panelOf(row);
    await panel.getByTestId('action-option').first().click();
    await expect(panel.getByTestId('action-preview')).toContainText('Nachrichtenfluss des Pools');
    const response = actionResponse(page, pool.id);
    await panel.getByTestId('action-submit').click();
    const result = (await (await response).json()) as ActionResult;
    expect(result.relations.length).toBeGreaterThan(0);
    await expect(toast(page, 'Verknüpft')).toBeVisible();
  }

  // a placement
  const proc = await openItem('process-without-step', 'place');
  row = await openModel(proc);
  await primaryOf(row).click();
  await panelOf(row).getByTestId('action-option').first().click();
  await panelOf(row).getByTestId('action-submit').click();
  await expect(toast(page, 'Platziert')).toBeVisible();
  await expect(row).toHaveCount(0);

  // a decision on the new hold
  const hold = (await api({ kind: 'held' })).find((q) => q.subject.id === proposal!.id)!;
  row = await openModel(hold);
  await primaryOf(row).click();
  await panelOf(row)
    .getByTestId('action-decide-relation')
    .getByRole('button', { name: 'Annehmen' })
    .click();
  await expect(toast(page, 'Angenommen')).toBeVisible();
  await expect(row).toHaveCount(0);
  expect((await relationOf(proposal!.id)).status).toBe('accepted');

  // the analysis that left pairs unjudged, queued again from its model
  const unjudged = (await api({ kind: 'unjudged' }))[0];
  expect(unjudged, 'the agent left assigned pairs unjudged').toBeDefined();
  row = await openModel(unjudged!);
  await primaryOf(row).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: /Erneut eingeplant|Schon eingeplant/ }),
  ).toBeVisible();

  // the valid copy, once an agent's new call to a copy brought the duplicate back (R1b)
  const callItem = (await api({ kind: 'call-target-unknown', state: 'open' })).find(
    (q) => q.source === 'finding',
  )!;
  const copies = (
    (await (await owner.get(`/api/v1/projects/${PROJECT}/findings`)).json()) as {
      items: { kind: string; refs: string[] }[];
    }
  ).items.find((f) => f.kind === 'duplicate-process-id')!.refs;
  const proposed = await agent.post(`/api/v1/projects/${PROJECT}/relations`, {
    data: {
      type: 'call',
      from: callItem.subject.id,
      to: copies[0],
      confidence: 0.5,
      rationale: 'Der Name passt zu einer der Kopien.',
    },
  });
  expect(proposed.ok()).toBe(true);
  const dup = await openItem('duplicate-process-id', 'choose-copy');
  row = await openModel(dup);
  await primaryOf(row).click();
  await panelOf(row).getByTestId('action-option').first().click();
  const chosen = actionResponse(page, dup.id);
  await panelOf(row).getByTestId('action-submit').click();
  expect(((await (await chosen).json()) as ActionResult).relations.length).toBeGreaterThan(0);
  await expect(toast(page, 'Gültige Kopie gewählt')).toBeVisible();
  await expect(row).toHaveCount(0);

  // a note
  const other = (await api({ state: 'open' })).find(
    (q) => q.modelKeys.length > 0 && q.actions.some((a) => a.type === 'note' && !a.primary),
  )!;
  row = await openModel(other);
  await fromMenu(page, row, 'Notiz hinzufügen');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Deine Notiz').fill('Im Workshop klären.');
  await dialog.getByRole('button', { name: 'Notiz speichern' }).click();
  await expect(toast(page, 'Notiz gespeichert')).toBeVisible();
  await expect(row.getByTestId('question-answer-text')).toHaveText('Im Workshop klären.');
});

/** A model with a collapsed subprocess (Signavio-style: it stands for another diagram). */
test('„Link korrigieren“ opens the chain page at the step whose link names no process', async ({
  page,
}) => {
  // a step's link names a process the landscape does not have (saved over REST)
  const step = 'step-partnermanagement';
  const CONTENT = `/api/v1/projects/${PROJECT}/value-chains/main/content`;
  const head = await owner.get(CONTENT);
  expect(head.ok()).toBe(true);
  const rev = Number(/"r(\d+)"/.exec(head.headers()['etag'] ?? '')?.[1]);
  const doc = JSON.parse(await head.text()) as {
    elements: { id: string; link?: string }[];
  };
  const element = doc.elements.find((e) => e.id === step);
  expect(element, step).toBeDefined();
  element!.link = 'analyzr:process/fehlt/partner#Process_Fehlt';
  const saved = await owner.put(CONTENT, {
    headers: { 'if-match': `"r${rev}"`, 'content-type': 'application/json' },
    data: JSON.stringify(doc),
  });
  expect(saved.ok(), await saved.text()).toBe(true);

  const fix = await openItem('unresolved-link', 'fix-link', (q) => q.subject.id === step);
  await page.goto(`/projects/${PROJECT}/open-questions?kind=unresolved-link`);
  const row = item(page, fix.id);
  await expect(primaryOf(row)).toHaveText('Link korrigieren');
  await primaryOf(row).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/value-chain\\?step=${step}$`));
  const panel = page.getByTestId('step-panel');
  await expect(panel).toHaveAttribute('data-element-id', step);
  await expect(panel.getByTestId('step-link')).toContainText('nicht auflösbar');
  // its link editor, one click away in edit mode
  await page.getByTestId('edit-chain').click();
  await expect(page.getByTestId('step-panel')).toHaveAttribute('data-element-id', step);
  await expect(page.getByTestId('link-editor')).toBeVisible();
  await page.getByTestId('finish-edit').click();
});

const COLLAPSED = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs_Haupt" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Haupt" name="Bestellung" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Bestellung eingegangen" />
    <bpmn:subProcess id="Sub_Zahlung" name="Zahlung" />
    <bpmn:endEvent id="End_1" name="Bestellung erledigt" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Sub_Zahlung" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Sub_Zahlung" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Haupt">
    <bpmndi:BPMNPlane id="Plane_Haupt" bpmnElement="Process_Haupt">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_Zahlung_di" bpmnElement="Sub_Zahlung"><dc:Bounds x="200" y="78" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1"><dc:Bounds x="360" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="136" y="118" /><di:waypoint x="200" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="300" y="118" /><di:waypoint x="360" y="118" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const PAYMENT = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs_Zahlung" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Zahlung" name="Zahlung durchführen" isExecutable="false">
    <bpmn:startEvent id="Start_Z" name="Zahlung angefordert" />
    <bpmn:endEvent id="End_Z" name="Zahlung erfolgt" />
    <bpmn:sequenceFlow id="Flow_Z" sourceRef="Start_Z" targetRef="End_Z" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Zahlung">
    <bpmndi:BPMNPlane id="Plane_Zahlung" bpmnElement="Process_Zahlung">
      <bpmndi:BPMNShape id="Start_Z_di" bpmnElement="Start_Z"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Z_di" bpmnElement="End_Z"><dc:Bounds x="220" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Z_di" bpmnElement="Flow_Z"><di:waypoint x="136" y="118" /><di:waypoint x="220" y="118" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('the model view links a collapsed subprocess selected on the canvas to the process it means', async ({
  page,
}) => {
  const key = `${PROJECT}-sub`;
  expect(
    (
      await owner.post('/api/v1/projects', { data: { key, name: 'Teilprozess (Offene Fragen)' } })
    ).status(),
  ).toBe(201);
  const form = new FormData();
  form.append('files', new File([COLLAPSED], 'teil/bestellung.bpmn', { type: 'application/xml' }));
  form.append('files', new File([PAYMENT], 'teil/zahlung.bpmn', { type: 'application/xml' }));
  expect((await owner.post(`/api/v1/projects/${key}/imports`, { multipart: form })).ok()).toBe(
    true,
  );

  await page.goto(`/projects/${key}/models/teil/bestellung`);
  await expect(page.getByTestId('bpmn-canvas')).toHaveAttribute('data-imported', 'true');
  // a click on the collapsed subprocess selects it; the panel offers the link
  await page.locator('.djs-element[data-element-id="Sub_Zahlung"]').click();
  await expect(page).toHaveURL(/\?element=Sub_Zahlung/);
  const card = page.getByTestId('subprocess-link');
  await expect(card).toContainText('Eingeklappter Teilprozess „Zahlung“');
  await card.getByRole('button', { name: 'Verknüpfen mit …' }).click();
  const formPanel = card.getByTestId('subprocess-link-form');
  await formPanel
    .locator('[data-testid=action-option][data-ref="teil/zahlung#Process_Zahlung"]')
    .click();
  await expect(formPanel.getByTestId('action-preview')).toHaveText(
    'Legt eine angenommene Relation „Bestellung“ → „Zahlung durchführen“ an.',
  );
  await formPanel.getByTestId('action-submit').click();
  await expect(toast(page, 'Verknüpft')).toBeVisible();
  const relations = async () =>
    (
      (await (await owner.get(`/api/v1/projects/${key}/landscape`)).json()) as {
        relations: (Relation & { from: string; to: string; type: string })[];
      }
    ).relations.filter((r) => r.type === 'manual');
  const [manual] = await relations();
  expect(manual).toMatchObject({
    from: 'teil/bestellung#Process_Haupt',
    to: 'teil/zahlung#Process_Zahlung',
    status: 'accepted',
  });
  await toast(page, 'Verknüpft').getByTestId('toast-action').click();
  await expect(toast(page, 'Rückgängig gemacht')).toBeVisible();
  const response = await owner.get(`/api/v1/projects/${key}/relations/${manual!.id}`);
  expect(((await response.json()) as Relation).status).toBe('rejected');

  // any other element offers nothing
  await page.locator('.djs-element[data-element-id="Start_1"]').click();
  await expect(page).toHaveURL(/\?element=Start_1/);
  await expect(page.getByTestId('subprocess-link')).toHaveCount(0);
});
