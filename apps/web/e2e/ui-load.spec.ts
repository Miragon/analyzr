import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { DEMO_SKIP, probeServer } from './server-mode';
import { userPath } from './user-path';

/**
 * The UI load guard (UX-SIMPLIFICATION.md §7, added with UX1; every slice
 * lowers its screens' budgets and adds its tasks). No Playwright spec runs in
 * CI or in the gates, so each slice runs this guard explicitly against an
 * agent-owned stack (compose project `analyzr-<x>` on free ports):
 *
 *   ANALYZR_E2E_URL=http://127.0.0.1:<port> pnpm --filter @analyzr/web e2e ui-load
 *
 * Three projects, at 1440x900 and in a mobile context (390x844, touch, so
 * `(hover: none)` matches): `nordwind-handel` seeded with its chain and worked
 * by the simulation agent (as `pipeline.spec.ts` runs it), `signavio-beispiel`
 * from the CLI's bundle import (`tools/integrate/test/fixtures/signavio/bundle`)
 * and an empty project. A project the stack does not have yet is made here
 * the same way (keys from ANALYZR_UI_LOAD_NORDWIND, …_SIGNAVIO, …_EMPTY), so a
 * fresh stack needs nothing else; an existing one is used as it is, so run the
 * guard only on a stack whose `nordwind-handel` nobody decided in (the pins
 * below are that state's). ANALYZR_UI_LOAD_REPORT=<file> writes every screen's
 * measurements there (controls, words, badges, the first item's top,
 * `scrollWidth`), the numbers DEVELOPMENT.md "Web UI" records per slice.
 *
 * Checked: the load budgets of the slices done so far (UX1 „Übersicht“, UX2b
 * „Offene Fragen“, UX7 „Hochladen“ and the token form; UX7 imports the raw
 * Signavio export into a project of its own per run), the tasks (clicks to the first decision, „Gutschrift“ on
 * a phone, a hold answered from each of its three entries in one dialog, on
 * a fourth project `ui-load-vormerkung` (…_HOLDS) made from the corpus with
 * one held proposal, so `nordwind-handel` stays undecided), consistency
 * (every badge and „Als Nächstes“ number equals the list it opens, every
 * „Offene Punkte“ the sum of its parts, each part its list; no item in two
 * badges), no ids in visible text and in the customer export, menus whose
 * entries fit. „Gutschrift found“ means opened until UX3 makes the phone's
 * model view show it (the `fixme` below).
 */

const ROOT = join(import.meta.dirname, '../../..');
const CORPUS = join(ROOT, 'eval/corpus/nordwind-handel/models');
const GOLDEN = join(ROOT, 'eval/value-chains/nordwind-handel/value-chain.vc.json');
const BUNDLE = join(ROOT, 'tools/integrate/test/fixtures/signavio/bundle');
const SIM_MAIN = join(ROOT, 'apps/agent-sim/src/main.ts');
const CLI_MAIN = join(ROOT, 'apps/cli/src/main.ts');
const NORDWIND = process.env['ANALYZR_UI_LOAD_NORDWIND'] ?? 'nordwind-handel';
const SIGNAVIO = process.env['ANALYZR_UI_LOAD_SIGNAVIO'] ?? 'signavio-beispiel';
const EMPTY = process.env['ANALYZR_UI_LOAD_EMPTY'] ?? 'ui-load-leer';
const REPORT = process.env['ANALYZR_UI_LOAD_REPORT'];

/** P2: no engineering ids in visible text (§7 "No ids"). */
const ID_PATTERN = /rel_|plc_|agt_|mam_|oqa_|q-[0-9a-f]{16}|sid-|Stand s\d|Ereignis \d/;
const MOBILE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: 'de-DE',
} as const;

/** UX1's budgets (§7 "UX1", done when). */
const BUDGET = {
  nextStepWords: 40,
  nextStepControls: 5,
  primaryTopDesktop: 260,
  primaryTopMobile: 300,
  tabRowMobile: 48,
} as const;

/** UX2b's budgets (§7 "UX2b", done when): „Offene Fragen“ on `nordwind-handel`. */
const OQ_BUDGET = {
  controls: 80,
  words: 1_000,
  firstTopDesktop: 250,
  firstTopMobile: 450,
  actionsPerCard: 3,
  wordsPerCard: 35,
  /** A hold answered from each entry („Offene Fragen“, „Vorgemerkt“, the review screen). */
  clicksPerAnswer: 3,
} as const;
const HOLDS = process.env['ANALYZR_UI_LOAD_HOLDS'] ?? 'ui-load-vormerkung';

interface Measure {
  project: string;
  screen: string;
  viewport: string;
  controls: number;
  words: number;
  badges: number;
  firstTop: number | null;
  scrollWidth: number;
  width: number;
}
const measures: Measure[] = [];

let owner: APIRequestContext;
let base = '';

function bpmnFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? bpmnFiles(path) : name.endsWith('.bpmn') ? [path] : [];
  });
}

function run(args: string[], token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ANALYZR_TOKEN: token } });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${args[0]} exited ${String(code)}: ${err}${out}`)),
    );
  });
}

async function exists(key: string): Promise<boolean> {
  return (await owner.get(`/api/v1/projects/${key}`)).ok();
}

async function create(key: string, name: string): Promise<void> {
  expect((await owner.post('/api/v1/projects', { data: { key, name } })).status()).toBe(201);
}

async function token(key: string, scopes: string[]): Promise<{ id: string; secret: string }> {
  const response = await owner.post(`/api/v1/projects/${key}/agent-tokens`, {
    data: { name: 'ui-load', scopes, expiresInDays: 1 },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; secret: string };
}

/** `nordwind-handel` as `analyzr seed --value-chains` makes it, then the simulation agent. */
async function seedNordwind(): Promise<void> {
  await create(NORDWIND, 'Nordwind Handel GmbH');
  const form = new FormData();
  for (const file of bpmnFiles(CORPUS))
    form.append(
      'files',
      new File([readFileSync(file)], relative(CORPUS, file), { type: 'application/xml' }),
    );
  expect((await owner.post(`/api/v1/projects/${NORDWIND}/imports`, { multipart: form })).ok()).toBe(
    true,
  );
  const chain = await owner.put(`/api/v1/projects/${NORDWIND}/value-chains/main/content`, {
    headers: { 'if-none-match': '*', 'content-type': 'application/json' },
    data: readFileSync(GOLDEN, 'utf8'),
  });
  expect(chain.ok()).toBe(true);
  const sim = await token(NORDWIND, ['analyzr:read', 'analyzr:propose']);
  const report = JSON.parse(await run([SIM_MAIN, '--url', base, '--json', '-q'], sim.secret)) as {
    stop: string;
  };
  expect(report.stop).toBe('no-work');
}

/** `signavio-beispiel` from the CLI's bundle import (the M6 path), no agent connected. */
async function importSignavio(): Promise<void> {
  await create(SIGNAVIO, 'Signavio Beispiel');
  const writer = await token(SIGNAVIO, ['analyzr:read', 'analyzr:write']);
  await run([CLI_MAIN, 'import', BUNDLE, '--project', SIGNAVIO, '--url', base], writer.secret);
  // The import's token is no agent: revoked, so the project waits for one to be connected.
  expect(
    (await owner.delete(`/api/v1/projects/${SIGNAVIO}/agent-tokens/${writer.id}`)).status(),
  ).toBe(204);
}

async function json<T>(path: string): Promise<T> {
  const response = await owner.get(path);
  expect(response.ok(), path).toBe(true);
  return (await response.json()) as T;
}

async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const page: { items: T[]; nextCursor: string | null } = await json(
      `${path}${sep}limit=200${cursor ? `&cursor=${cursor}` : ''}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

/** Visible controls, words and badges of the page (shell included), as the audits counted. */
async function measure(page: Page, project: string, screen: string, first: string | null) {
  const m = await page.evaluate((firstSelector) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[inert]');
    };
    const controls = [
      ...document.querySelectorAll(
        'button, a[href], input, select, textarea, [role=tab], [role=menuitem], [role=radio], [role=checkbox], [role=switch]',
      ),
    ].filter(visible);
    const words = document.body.innerText
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const badges = [...document.querySelectorAll('[data-slot=badge]')].filter(visible).length;
    const firstElement = firstSelector
      ? [...document.querySelectorAll(firstSelector)].find(visible)
      : undefined;
    return {
      controls: new Set(controls).size,
      words,
      badges,
      firstTop: firstElement
        ? Math.round(firstElement.getBoundingClientRect().top + window.scrollY)
        : null,
      scrollWidth: document.documentElement.scrollWidth,
      width: window.innerWidth,
    };
  }, first);
  const entry: Measure = {
    project,
    screen,
    viewport: `${m.width}`,
    ...m,
  };
  measures.push(entry);
  return entry;
}

/**
 * Opens `path` and waits until `ready` shows, no skeleton is left and the
 * page's text has not changed for half a second (the counts load in parallel).
 */
async function settle(page: Page, path: string, ready: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 });
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() =>
          document.querySelector('[data-slot=skeleton]') ? '' : document.body.innerText,
        );
        const stable = now !== '' && now === last;
        last = now;
        return stable;
      },
      { intervals: [500], timeout: 30_000 },
    )
    .toBe(true);
}

const visibleText = async (page: Page) => page.locator('body').innerText();
const tabs = (page: Page) =>
  page.getByRole('navigation', { name: 'Projektbereiche' }).getByRole('link');
const badgeOf = async (page: Page, name: RegExp): Promise<number> => {
  const text = await page
    .getByRole('navigation', { name: 'Projektbereiche' })
    .getByRole('link', { name })
    .innerText();
  const match = /(\d+)/.exec(text);
  return match ? Number(match[1]) : 0;
};

async function mobile(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ...MOBILE, baseURL: base });
  return { context, page: await context.newPage() };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(300_000);
  base = baseURL ?? 'http://127.0.0.1:7400';
  const probe = await playwright.request.newContext({ baseURL: base });
  const mode = await probeServer(probe);
  await probe.dispose();
  test.skip(
    mode === 'down',
    'no analyzr server at ANALYZR_E2E_URL; start one to run the UI load guard',
  );
  test.skip(mode === 'demo', DEMO_SKIP);
  owner = await playwright.request.newContext({ baseURL: base });
  expect((await owner.post('/api/v1/session', { data: { client: 'analyzr-web' } })).ok()).toBe(
    true,
  );
  if (!(await exists(NORDWIND))) await seedNordwind();
  if (!(await exists(SIGNAVIO))) await importSignavio();
  if (!(await exists(EMPTY))) await create(EMPTY, 'Leeres Projekt');
});

test.afterAll(async () => {
  await owner?.dispose();
  if (measures.length === 0) return;
  console.log(
    measures
      .map(
        (m) =>
          `${m.project.padEnd(18)} ${m.screen.padEnd(16)} ${m.viewport.padStart(4)}px  controls ${String(m.controls).padStart(3)}  words ${String(m.words).padStart(5)}  badges ${String(m.badges).padStart(3)}  first ${String(m.firstTop ?? '–').padStart(5)}  scrollWidth ${m.scrollWidth}`,
      )
      .join('\n'),
  );
  if (REPORT) writeFileSync(userPath(REPORT), `${JSON.stringify(measures, null, 2)}\n`);
});

// ------------------------------------------------------------------ the shell and „Übersicht“ (UX1)

test('UX1 desktop: four tabs and three badges in one row, „Als Nächstes“ within its budget', async ({
  page,
}) => {
  await settle(page, `/projects/${NORDWIND}`, '[data-testid=next-step]');
  const links = tabs(page);
  expect((await links.allInnerTexts()).map((t) => t.replace(/\d+.*/s, '').trim())).toEqual([
    'Übersicht',
    'Relationen',
    'Wertschöpfungskette',
    'Offene Fragen',
  ]);
  // three badges, never 0; one row (every tab at the same height)
  expect((await links.allInnerTexts()).filter((t) => /\d/.test(t))).toHaveLength(3);
  const tops = await links.evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  await expect(page.getByRole('link', { name: 'Hochladen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Einstellungen' })).toBeVisible();

  const block = page.getByTestId('next-step');
  const inBlock = await block.evaluate((el) => ({
    words: (el as HTMLElement).innerText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length,
    controls: el.querySelectorAll('button, a[href], input, select').length,
  }));
  expect(inBlock.words, 'words above the table').toBeLessThanOrEqual(BUDGET.nextStepWords);
  expect(inBlock.controls, 'controls above the table').toBeLessThanOrEqual(BUDGET.nextStepControls);
  const primary = page.getByTestId('next-step-primary');
  const box = await primary.boundingBox();
  expect(box?.y ?? Infinity, 'primary button top').toBeLessThanOrEqual(BUDGET.primaryTopDesktop);
  const m = await measure(page, NORDWIND, 'Übersicht', '[data-testid=next-step-primary]');
  expect(m.scrollWidth).toBeLessThanOrEqual(m.width);
  expect(await visibleText(page)).not.toMatch(ID_PATTERN);

  // every entry of „Exportieren“ fits its menu (none runs past the box)
  await page.getByTestId('export-hub').click();
  const items = page.getByTestId('export-menu').getByRole('menuitem');
  expect(await items.count()).toBeGreaterThan(0);
  for (const fit of await items.evaluateAll((els) =>
    els.map((e) => ({ text: e.textContent, fits: e.scrollWidth <= e.clientWidth })),
  ))
    expect(fit.fits, fit.text ?? '').toBe(true);
  await page.keyboard.press('Escape');
});

test('UX1 mobile: one tab row of at most 48 px, „Hochladen“ visible, the primary near the top', async ({
  browser,
}) => {
  const { context, page } = await mobile(browser);
  try {
    await settle(page, `/projects/${NORDWIND}`, '[data-testid=next-step]');
    const row = await page.getByTestId('project-tabs').boundingBox();
    expect(row?.height ?? Infinity, 'tab row height').toBeLessThanOrEqual(BUDGET.tabRowMobile);
    const upload = await page.getByRole('link', { name: 'Hochladen' }).boundingBox();
    expect(upload, '„Hochladen“ visible').not.toBeNull();
    expect((upload?.x ?? 0) + (upload?.width ?? 0)).toBeLessThanOrEqual(390);
    const tops = await tabs(page).evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);
    const primary = await page.getByTestId('next-step-primary').boundingBox();
    expect(primary?.y ?? Infinity, 'primary button top').toBeLessThanOrEqual(
      BUDGET.primaryTopMobile,
    );
    const m = await measure(page, NORDWIND, 'Übersicht', '[data-testid=next-step-primary]');
    expect(m.scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(390);
    expect(await visibleText(page)).not.toMatch(ID_PATTERN);

    // the active tab is scrolled into the row (with its badge), also on the last tab
    await settle(page, `/projects/${NORDWIND}/open-questions`, '[data-testid=open-question]');
    const nav = await page.getByRole('navigation', { name: 'Projektbereiche' }).boundingBox();
    const active = await page
      .getByRole('navigation', { name: 'Projektbereiche' })
      .locator('[aria-current=page]')
      .boundingBox();
    expect(nav).not.toBeNull();
    expect(active).not.toBeNull();
    expect(active!.x, 'active tab starts inside the row').toBeGreaterThanOrEqual(nav!.x - 1);
    expect(active!.x + active!.width, 'active tab ends inside the row').toBeLessThanOrEqual(
      nav!.x + nav!.width + 1,
    );
  } finally {
    await context.close();
  }
});

test('UX1 tasks: the first relation decision in one click from „Übersicht“', async ({ page }) => {
  await settle(page, `/projects/${NORDWIND}`, '[data-testid=next-step-primary]');
  await page.getByTestId('next-step-primary').click(); // click 1
  await expect(page.getByTestId('review-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Annehmen/ })).toBeVisible();
});

test('UX1 tasks: „Gutschrift“ found in two interactions on a phone', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  try {
    await settle(page, `/projects/${NORDWIND}`, '[data-testid=model-search]');
    await page.getByRole('searchbox', { name: 'Modell suchen' }).fill('Gutschrift'); // 1
    const rows = page.getByTestId('model-row');
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole('link').first().click(); // 2
    await expect(page).toHaveURL(/\/models\/finanzen\/gutschrift/);
    await expect(page.getByTestId('model-view')).toBeVisible();
  } finally {
    await context.close();
  }
});

// Opened is not yet found: at 390x844 the model view's panel covers the canvas and the header
// until UX3's view-first sheet (its done-when: the model name visible, the canvas ≥ 55 %).
test.fixme('UX3 tasks: „Gutschrift“ on a phone shows its name and its diagram', async ({
  browser,
}) => {
  const { context, page } = await mobile(browser);
  try {
    await settle(
      page,
      `/projects/${NORDWIND}/models/finanzen/gutschrift`,
      '[data-testid=model-view]',
    );
    const name = page.getByRole('heading', { level: 1 }).first();
    const box = await name.boundingBox();
    expect(box, 'the model name is on screen').not.toBeNull();
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('h1') !== null,
      [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
    );
    expect(hit, 'the model name answers elementFromPoint').toBe(true);
    const share = await page.evaluate(() => {
      const canvas = document.querySelector('.djs-container');
      if (!canvas) return 0;
      const r = canvas.getBoundingClientRect();
      const panel = document.querySelector('aside')?.getBoundingClientRect();
      const covered = panel
        ? Math.max(0, Math.min(r.bottom, panel.bottom) - Math.max(r.top, panel.top)) *
          Math.max(0, Math.min(r.right, panel.right) - Math.max(r.left, panel.left))
        : 0;
      return (r.width * r.height - covered) / (window.innerWidth * window.innerHeight);
    });
    expect(share, 'the canvas covers at least 55 % of the screen').toBeGreaterThanOrEqual(0.55);
  } finally {
    await context.close();
  }
});

test('UX1 consistency: every badge, „Als Nächstes“ and „Offene Punkte“ equal their lists', async ({
  page,
}) => {
  interface Relation {
    id: string;
    from: string;
    to: string;
    status: string;
    endpointState: string;
  }
  interface Detail {
    placements: {
      id: string;
      process: string;
      status: string;
      endpointState: string;
      stepLive: boolean;
    }[];
  }
  interface Question {
    group: string;
    subject: { type: string; id: string };
  }
  const isReview = (r: { status: string; endpointState: string }) =>
    r.status === 'proposed' || (r.status === 'accepted' && r.endpointState !== 'ok');
  const landscape = await json<{ relations: Relation[] }>(`/api/v1/projects/${NORDWIND}/landscape`);
  const chain = await json<Detail>(`/api/v1/projects/${NORDWIND}/value-chains/main`);
  const ask = await allPages<Question>(
    `/api/v1/projects/${NORDWIND}/open-questions?state=open&group=ask`,
  );
  const summary = await json<{ askByModel: Record<string, number> }>(
    `/api/v1/projects/${NORDWIND}/open-questions?state=open&group=ask&limit=1`,
  );
  const models = await allPages<{ key: string; openItems: number }>(
    `/api/v1/projects/${NORDWIND}/models`,
  );
  const review = landscape.relations.filter(isReview);
  const open = chain.placements.filter(isReview);

  await settle(page, `/projects/${NORDWIND}`, '[data-testid=next-step-primary]');
  const [relations, placements, questions] = [
    await badgeOf(page, /^Relationen/),
    await badgeOf(page, /^Wertschöpfungskette/),
    await badgeOf(page, /^Offene Fragen/),
  ];
  expect([relations, placements, questions]).toEqual([review.length, open.length, ask.length]);
  await expect(page.getByTestId('next-step-primary')).toHaveText(
    `Vorschläge prüfen (${relations})`,
  );
  // no item in two badges: holds count in „Offene Fragen“ only
  const askRelations = new Set(
    ask.filter((q) => q.subject.type === 'relation').map((q) => q.subject.id),
  );
  const askPlacements = new Set(
    ask.filter((q) => q.subject.type === 'placement').map((q) => q.subject.id),
  );
  expect(review.filter((r) => askRelations.has(r.id))).toEqual([]);
  expect(open.filter((p) => askPlacements.has(p.id))).toEqual([]);

  // „Offene Punkte“ (text, no list holds them all): the model's relations (the list
  // /review?model= opens: queue and held), its open and held placements (a held placement's
  // question names no model in `askByModel`) and its questions to clarify
  const touches = (r: Relation, key: string) =>
    r.from.split('#')[0] === key || r.to.split('#')[0] === key;
  const worked = chain.placements.filter(
    (p) => isReview(p) || (p.status === 'held' && p.stepLive && p.endpointState !== 'missing'),
  );
  for (const m of models) {
    const rel = landscape.relations.filter(
      (r) => touches(r, m.key) && (isReview(r) || r.status === 'held'),
    ).length;
    expect(rel, `${m.key}: relations`).toBe(m.openItems);
    const total =
      rel +
      worked.filter((p) => p.process.split('#')[0] === m.key).length +
      (summary.askByModel[m.key] ?? 0);
    const cell = page
      .locator(`[data-testid=model-row][data-model-key="${m.key}"]`)
      .getByTestId('open-points');
    if (total === 0) await expect(cell).toHaveCount(0);
    else await expect(cell, m.key).toHaveText(String(total));
  }
  // Seeded and worked by the simulation agent, nothing decided: 7 relations (both copies of the
  // called process, four messages, one trigger), 1 open placement, 1 pool question. The plan's 8
  // (UX-SIMPLIFICATION.md §2.5) was the audit stack's, where one of those relations was decided.
  const pinned = page
    .locator('[data-testid=model-row][data-model-key="einkauf/bestellanforderung"]')
    .getByTestId('open-points');
  await expect(pinned).toHaveText('9');
  await expect(
    page
      .locator('[data-testid=model-row][data-model-key="einkauf/bestellanforderung"]')
      .getByTestId('open-points-split'),
  ).toHaveText('7 Relationen · 1 Platzierung · 1 Frage');

  // the lists the badges open, and the relations part of „Offene Punkte“
  await settle(page, `/projects/${NORDWIND}/review`, '[data-testid=queue-row]');
  await expect(page.getByTestId('queue-row')).toHaveCount(relations);
  await page.goto(`/projects/${NORDWIND}/value-chain`);
  await expect(page.getByTestId('open-placement')).toHaveCount(placements, { timeout: 30_000 });
  await settle(
    page,
    `/projects/${NORDWIND}/review?model=einkauf%2Fbestellanforderung`,
    '[data-testid=queue-row]',
  );
  const queued = await page.getByTestId('queue-row').count();
  await page.getByRole('tab', { name: /Vorgemerkt/ }).click();
  const held = await page.getByTestId('held-item').count();
  expect(queued + held).toBe(7);
});

test('UX1: the other two projects and the projects list, desktop and mobile', async ({
  page,
  browser,
}) => {
  // signavio-beispiel: descriptive models, no agent yet; „Offene Punkte“ is no longer 0 everywhere.
  await settle(page, `/projects/${SIGNAVIO}`, '[data-testid=model-row]');
  await expect(page.getByTestId('next-step')).toBeVisible();
  expect(await page.getByTestId('open-points').count()).toBeGreaterThan(0);
  expect(await visibleText(page)).not.toMatch(ID_PATTERN);
  await measure(
    page,
    SIGNAVIO,
    'Übersicht',
    '[data-testid=next-step] a, [data-testid=next-step] button',
  );
  // the empty project: the four tabs without badges, one primary action
  await settle(page, `/projects/${EMPTY}`, '[data-slot=empty]');
  expect(await tabs(page).allInnerTexts()).toEqual([
    'Übersicht',
    'Relationen',
    'Wertschöpfungskette',
    'Offene Fragen',
  ]);
  await expect(page.getByRole('link', { name: 'Modelle hochladen' })).toBeVisible();
  expect(await visibleText(page)).not.toMatch(ID_PATTERN);
  await measure(page, EMPTY, 'Übersicht', '[data-slot=empty] a');
  await settle(page, '/', '[data-testid=project-row]');
  expect(await visibleText(page)).not.toMatch(ID_PATTERN);
  await measure(page, '–', 'Projekte', '[data-testid=project-row]');

  const { context, page: phone } = await mobile(browser);
  try {
    for (const key of [SIGNAVIO, EMPTY]) {
      await settle(phone, `/projects/${key}`, '[data-testid=project-tabs]');
      const m = await measure(
        phone,
        key,
        'Übersicht',
        '[data-testid=next-step] a, [data-testid=next-step] button, [data-slot=empty] a',
      );
      expect(m.scrollWidth, `${key}: no sideways scroll`).toBeLessThanOrEqual(390);
      expect(await visibleText(phone)).not.toMatch(ID_PATTERN);
    }
    await settle(phone, '/', '[data-testid=project-row]');
    await measure(phone, '–', 'Projekte', '[data-testid=project-row]');
  } finally {
    await context.close();
  }
});

// ------------------------------------------------------------------ measured for the next slices

test('the other screens, measured (budgets come with UX3, UX5 and UX6)', async ({
  page,
  browser,
}) => {
  const screens: [string, string, string][] = [
    ['Relationen', `/projects/${NORDWIND}/review`, '[data-testid=queue-row]'],
    ['Kette', `/projects/${NORDWIND}/value-chain`, '[data-testid=chain-overview]'],
    [
      'Modellansicht',
      `/projects/${NORDWIND}/models/vertrieb/order-handling`,
      '[data-testid=model-view]',
    ],
  ];
  const first: Record<string, string> = {
    Relationen: '[data-testid=queue-row]',
    Kette: '[data-testid=open-placement]',
    Modellansicht: '[data-testid=model-relation]',
  };
  for (const [screen, path, ready] of screens) {
    await settle(page, path, ready);
    await measure(page, path.split('/')[2] ?? '', screen, first[screen] ?? null);
  }
  const { context, page: phone } = await mobile(browser);
  try {
    for (const [screen, path, ready] of screens.slice(0, 1)) {
      await settle(phone, path, ready);
      await measure(phone, path.split('/')[2] ?? '', screen, first[screen] ?? null);
    }
  } finally {
    await context.close();
  }
});

// ------------------------------------------------------------------ „Offene Fragen“ (UX2b)

interface AskItem {
  id: string;
  group: string;
  kind: string;
  subject: { type: string; id: string };
}

/** The customer export as text without ids: the Markdown without HTML comments, the CSV without `id`. */
function withoutIds(text: string, format: 'markdown' | 'csv'): string {
  if (format === 'markdown') return text.replace(/<!--[\s\S]*?-->/g, '');
  return text
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .map((line) => line.replace(/^"[^"]*";/, ''))
    .join('\n');
}

test('UX2b desktop: „Offene Fragen“ within 80 controls and 1,000 words, the first card ≤ 250 px', async ({
  page,
}) => {
  const ask = await allPages<AskItem>(
    `/api/v1/projects/${NORDWIND}/open-questions?state=open&group=ask`,
  );
  const summary = await json<{ totals: Record<string, number> }>(
    `/api/v1/projects/${NORDWIND}/open-questions?state=open&group=ask&limit=1`,
  );
  await settle(page, `/projects/${NORDWIND}/open-questions`, '[data-testid=open-question]');
  const m = await measure(page, NORDWIND, 'Offene Fragen', '[data-testid=open-question]');
  expect(m.controls, 'controls').toBeLessThanOrEqual(OQ_BUDGET.controls);
  expect(m.words, 'words').toBeLessThanOrEqual(OQ_BUDGET.words);
  expect(m.firstTop ?? Infinity, 'first card top').toBeLessThanOrEqual(OQ_BUDGET.firstTopDesktop);
  expect(m.scrollWidth).toBeLessThanOrEqual(m.width);
  expect(await visibleText(page)).not.toMatch(ID_PATTERN);

  // the badge, the count line and the cards are „Zu klären“, in the API's order
  const badge = await badgeOf(page, /^Offene Fragen/);
  expect(badge).toBe(summary.totals['ask']);
  expect(badge).toBe(ask.length);
  await expect(page.getByTestId('open-questions-count')).toHaveText(`${ask.length} zu klären`);
  const cards = page.locator('[data-testid=open-question][data-group=ask]');
  expect(
    await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-question-id'))),
  ).toEqual(ask.map((q) => q.id));
  // the agents' questions and the chain's proposals are not listed; the rest is closed
  await expect(page.locator('[data-testid=open-question][data-group=agent]')).toHaveCount(0);
  await expect(page.locator('[data-testid=open-question][data-group=proposal]')).toHaveCount(0);
  await expect(page.getByTestId('open-questions-info')).not.toHaveAttribute('open');
  await expect(page.getByTestId('open-questions-info')).toContainText(
    `Zur Information (${summary.totals['info']})`,
  );

  // a card: at most three actions (disclosures not counted), on average at most 35 words
  const perCard = await cards.evaluateAll((els) =>
    els.map((el) => ({
      actions: el.querySelectorAll(
        '[data-testid=question-actions] > button, [data-testid=question-actions] > a',
      ).length,
      words: (el as HTMLElement).innerText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
        .length,
    })),
  );
  for (const c of perCard) expect(c.actions).toBeLessThanOrEqual(OQ_BUDGET.actionsPerCard);
  const average = perCard.reduce((sum, c) => sum + c.words, 0) / perCard.length;
  expect(average, 'words per card').toBeLessThanOrEqual(OQ_BUDGET.wordsPerCard);
  // no process has two items
  const subjects = ask.map((q) => q.subject.id);
  expect(new Set(subjects).size).toBe(subjects.length);

  // the export for the customer: „Zu klären“ by default under the old name, without ids
  await page.getByTestId('open-questions-export').click();
  const dialog = page.getByTestId('customer-export-dialog');
  await expect(dialog.getByRole('radio', { name: /Zum Lesen \(Markdown\)/ })).toBeChecked();
  const agents = dialog.getByRole('checkbox', { name: /Auch Fragen der Agenten \(\d+\)/ });
  await expect(agents).not.toBeChecked();
  await dialog.getByRole('radio', { name: /Zum Ausfüllen \(CSV\)/ }).check();
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe(`offene-fragen-${NORDWIND}.csv`);
  const sheet = readFileSync(await csv.path(), 'utf8');
  expect(sheet.split('\r\n').filter(Boolean)).toHaveLength(ask.length + 1);
  expect(withoutIds(sheet, 'csv')).not.toMatch(ID_PATTERN);
  await page.getByTestId('open-questions-export').click();
  await dialog.getByRole('radio', { name: /Zum Lesen \(Markdown\)/ }).check();
  const [md] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  expect(md.suggestedFilename()).toBe(`offene-fragen-${NORDWIND}.md`);
  expect(withoutIds(readFileSync(await md.path(), 'utf8'), 'markdown')).not.toMatch(ID_PATTERN);
});

test('UX2b mobile: the first card ≤ 450 px, the filters behind „Filter“, no sideways scroll', async ({
  browser,
}) => {
  const { context, page } = await mobile(browser);
  try {
    await settle(page, `/projects/${NORDWIND}/open-questions`, '[data-testid=open-question]');
    const m = await measure(page, NORDWIND, 'Offene Fragen', '[data-testid=open-question]');
    expect(m.firstTop ?? Infinity, 'first card top').toBeLessThanOrEqual(OQ_BUDGET.firstTopMobile);
    expect(m.scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(390);
    expect(await visibleText(page)).not.toMatch(ID_PATTERN);
    await expect(page.getByLabel('Art', { exact: true })).toBeHidden();
    await page.getByTestId('open-questions-filter-toggle').click();
    await expect(page.getByLabel('Art', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('UX2b: `signavio-beispiel`’s „Offene Fragen“ without ids, measured', async ({ page }) => {
  await settle(page, `/projects/${SIGNAVIO}/open-questions`, '[data-testid=open-question]');
  await measure(page, SIGNAVIO, 'Offene Fragen', '[data-testid=open-question]');
  expect(await visibleText(page)).not.toMatch(ID_PATTERN);
});

/** `ui-load-vormerkung`: the corpus without an agent, one key-tier proposal held with a question. */
async function seedHolds(): Promise<string> {
  if (!(await exists(HOLDS))) {
    await create(HOLDS, 'Vormerkungen (UI-Last)');
    const form = new FormData();
    for (const file of bpmnFiles(CORPUS))
      form.append(
        'files',
        new File([readFileSync(file)], relative(CORPUS, file), { type: 'application/xml' }),
      );
    expect((await owner.post(`/api/v1/projects/${HOLDS}/imports`, { multipart: form })).ok()).toBe(
      true,
    );
  }
  const landscape = await json<{
    relations: { id: string; tier: string; status: string; version: number }[];
  }>(`/api/v1/projects/${HOLDS}/landscape`);
  const held = landscape.relations.find((r) => r.status === 'held');
  if (held) return held.id;
  const key = landscape.relations.find((r) => r.tier === 'key' && r.status === 'proposed');
  expect(key, 'a key-tier proposal to hold').toBeDefined();
  const decided = await owner.post(`/api/v1/projects/${HOLDS}/relations/${key!.id}/decision`, {
    data: {
      verdict: 'hold',
      version: key!.version,
      note: 'Laut Handbuch der Vertrieb.',
      question: 'Wer verschickt die Rechnung?',
    },
  });
  expect(decided.ok()).toBe(true);
  return key!.id;
}

test('UX2b: a hold answered in at most 3 clicks, in one dialog from each entry', async ({
  page,
}) => {
  const relation = await seedHolds();
  const notesBefore = async () =>
    (
      await allPages<AskItem & { answers: unknown[] }>(
        `/api/v1/projects/${HOLDS}/open-questions?kind=held&state=open`,
      )
    ).find((q) => q.subject.id === relation)?.answers.length ?? 0;
  const before = await notesBefore();

  /** From the entry on screen: „Antwort geben“, the text, „Antwort speichern“ (two clicks). */
  async function answer(entry: string, text: string, open: () => Promise<void>): Promise<void> {
    let clicks = 0;
    await open();
    clicks += 1;
    const dialog = page.getByTestId('note-dialog');
    await expect(dialog.getByRole('heading', { name: 'Antwort geben' }), entry).toBeVisible();
    await dialog.getByLabel('Deine Antwort').fill(text);
    await dialog.getByRole('button', { name: 'Antwort speichern' }).click();
    clicks += 1;
    await expect(dialog, entry).toBeHidden();
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Antwort gespeichert' }),
    ).toBeVisible();
    expect(clicks, entry).toBeLessThanOrEqual(OQ_BUDGET.clicksPerAnswer);
  }

  // 1. its card in „Offene Fragen“ (with „Jetzt entscheiden“ to the review screen beside it)
  await settle(page, `/projects/${HOLDS}/open-questions?kind=held`, '[data-testid=open-question]');
  const card = page.locator('[data-testid=open-question][data-kind=held]').first();
  await expect(card.getByRole('link', { name: 'Jetzt entscheiden' })).toHaveAttribute(
    'href',
    `/projects/${HOLDS}/review/${relation}?view=held`,
  );
  // once the hold has an answer, „Jetzt entscheiden“ leads and „Antwort ergänzen“ adds one more
  const answerButton = /^Antwort (geben|ergänzen)$/;
  await answer('card', 'Die Buchhaltung.', () =>
    card.getByRole('button', { name: answerButton }).click(),
  );
  await expect(card.getByRole('button', { name: 'Antwort ergänzen' })).toBeVisible();
  // 2. its row in „Relationen › Vorgemerkt“
  await settle(page, `/projects/${HOLDS}/review?view=held`, '[data-testid=held-item]');
  const row = page.locator(`[data-testid=held-item][data-relation-id="${relation}"]`);
  await answer('Vorgemerkt', 'Bestätigt vom Vertrieb.', () =>
    row.getByRole('button', { name: answerButton }).click(),
  );
  // 3. the review screen
  await settle(page, `/projects/${HOLDS}/review/${relation}?view=held`, '[data-testid=hold-box]');
  // the review screen's hold box shows the latest answer where the decision is made
  await expect(page.getByTestId('hold-answer-latest')).toContainText('Bestätigt vom Vertrieb.');
  await answer('review screen', 'Gilt auch für Teillieferungen.', () =>
    page.getByTestId('hold-box').getByRole('button', { name: answerButton }).click(),
  );
  // all three on the same item, as notes on the relation
  expect(await notesBefore()).toBe(before + 3);
});
// ------------------------------------------------------------------ „Hochladen“ and „Agent verbinden“ (UX7)

/** The synthetic raw Signavio export (M6 S3b): 6 BPMN files, one UTF-16, one with illegal ids, a PDF. */
const RAW_SIGNAVIO = join(ROOT, 'tools/integrate/test/fixtures/signavio/2026-10-14-signavio');
/** UX7's budgets (§7 "UX7", done when). */
const UPLOAD_BUDGET = { wordsBefore: 45, tokenFormControls: 2 } as const;

const wordsOf = (el: Element) =>
  (el as HTMLElement).innerText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

test('UX7: „Hochladen“ in at most 45 words; the raw Signavio export says what happened in German', async ({
  page,
}) => {
  // A project of its own per run: keys are fixed for good, a second run would find every model unchanged.
  const key = `ui-load-hochladen-${Date.now().toString(36)}`;
  await create(key, 'Hochladen');
  await settle(page, `/projects/${key}/upload`, '[data-testid=dropzone]');
  expect(
    await page.getByTestId('dropzone').evaluate(wordsOf),
    'words before an import',
  ).toBeLessThanOrEqual(UPLOAD_BUDGET.wordsBefore);
  await measure(page, key, 'Hochladen', '[data-testid=dropzone]');

  await page.getByTestId('folder-input').setInputFiles(RAW_SIGNAVIO);
  // M6 S2b: the preview first, in the result's layout, then „Importieren“
  await expect(page.getByTestId('import-headline')).toHaveText(
    'Vorschau: 5 Modelle neu · 1 Fehler · 1 übersprungen',
    { timeout: 30_000 },
  );
  await measure(page, key, 'Vorschau', '[data-testid=upload-preview]');
  await page.getByTestId('preview-import').click();
  await expect(page.getByTestId('import-headline')).toHaveText(
    '5 Modelle importiert · 1 Fehler · 1 übersprungen',
    { timeout: 30_000 },
  );
  // „Bonitätsprüfung.bpmn“: one entry naming its 2 elements (9 lines of bpmn-moddle before)
  const bonitaet = page.locator('[data-testid=import-outcome]', {
    hasText: 'Bonitätsprüfung.bpmn',
  });
  await expect(bonitaet.getByTestId('import-warnings').locator(':scope > summary')).toHaveText(
    '2 Hinweise',
  );
  await expect(bonitaet.getByTestId('import-warning')).toHaveCount(1);
  await expect(bonitaet.getByTestId('import-warning')).toHaveAttribute('data-code', 'invalid-id');
  await expect(bonitaet.getByTestId('import-warning')).toContainText(
    '2 Elemente übersprungen, weil ihre ID ungültig ist: Aufgabe „Aufgabe_Bonität_prüfen“, Datenspeicher „4711“.',
  );
  // the UTF-16 file: German, with its remedy
  const utf16 = page.locator('[data-testid=import-outcome][data-outcome=failed]');
  await expect(utf16).toHaveCount(1);
  await expect(utf16.getByTestId('import-problem')).toHaveText(
    'Die Datei ist UTF-16-kodiert; analyzr liest nur UTF-8. Speichere sie als UTF-8 oder wandle den Export mit /analyzr-integrate:integrate-landscape um.',
  );
  await expect(page.getByTestId('import-skipped')).toHaveText(
    '1 Datei übersprungen: Prozesslandkarte.pdf (kein BPMN)',
  );
  // „Als Nächstes“ names the waiting tasks `analyzr import` names (`formatNextSteps`)
  const queued = await allPages<{ id: string }>(
    `/api/v1/projects/${key}/analyses?state=queued&kind=relations`,
  );
  expect(queued).toHaveLength(5);
  await expect(page.getByTestId('upload-next-agent')).toContainText(
    '5 Modelle warten auf den Agenten',
  );
  await expect(
    page.getByTestId('upload-next').getByRole('link', { name: 'Agent verbinden' }),
  ).toBeVisible();
  expect(await visibleText(page)).not.toMatch(/sid-|rel_|q-[0-9a-f]{16}/);
});

test('UX7: the token form shows its name and its button only; step 3 starts the agent', async ({
  page,
}) => {
  await settle(page, `/projects/${EMPTY}/agents`, 'form[aria-label="Agent-Token erstellen"]');
  const controls = await page.locator('form[aria-label="Agent-Token erstellen"]').evaluate(
    (form) =>
      // `checkVisibility`: a closed <details> keeps its content's boxes in Chromium
      [...form.querySelectorAll('button, input, select, [role=checkbox]')].filter((el) =>
        el.checkVisibility(),
      ).length,
  );
  expect(controls, 'visible controls of the token form').toBe(UPLOAD_BUDGET.tokenFormControls);
  await expect(page.getByTestId('connect-start')).toContainText(`/analyzr:relations ${EMPTY}`);
  await measure(page, EMPTY, 'Agent verbinden', null);
});

test.fixme('UX4: after an amendment save „Agent starten“ is visible without navigating', () => {});
test.fixme('UX3/UX5: the bpmn.io watermark answers elementFromPoint at 390, 800 and 1024 px', () => {});
