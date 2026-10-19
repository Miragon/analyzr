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
 * „Offene Fragen“, UX3 the model view, UX7 „Hochladen“ and the token form; UX7 imports the raw
 * Signavio export into a project of its own per run), the tasks (clicks to the first decision, „Gutschrift“ on
 * a phone, a hold answered from each of its three entries in one dialog, on
 * a fourth project `ui-load-vormerkung` (…_HOLDS) made from the corpus with
 * one held proposal, so `nordwind-handel` stays undecided), consistency
 * (every badge and „Als Nächstes“ number equals the list it opens, every
 * „Offene Punkte“ the sum of its parts, each part its list; no item in two
 * badges), no ids in visible text and in the customer export, menus whose
 * entries fit; UX3's model view (the panel's budgets, the element filter,
 * „Gutschrift“ found, opened and shown on a phone, the bpmn.io watermark);
 * UX4's question actions (a call target in 3 clicks with „Passt vermutlich“
 * in a project of its own per run, „Agent starten“ after an amendment, the
 * ghost button „Notiz“); UX5's „Zu prüfen“ (the first proposal, the
 * controls, the words per row, the cards on a phone) and review screen (the
 * panel's words, the way back on a phone, the watermark); UX6's chain (the
 * primary in view, the panel's and the header's controls and words, the
 * card's controls, „nichts angenommen“ on 4 steps, the selected step's 4 px
 * outline, the panel's toggle, the phone's sheet and project link); M6
 * S2c-2's calls line on `signavio-beispiel` (its number the bulk dialog's
 * selection behind „Gesammelt annehmen“, closed without a decision; the
 * accept itself runs in `trust-calls.spec.ts` on projects of its own).
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

/** UX3's budgets (§7 "UX3", done when): the model view of `vertrieb/order-handling`. */
const MODEL_BUDGET = {
  panelControls: 25,
  panelWords: 300,
  chips: 3,
  /** At 390x844 the canvas the top bar and the collapsed sheet leave, of the viewport. */
  canvasShareMobile: 0.55,
} as const;

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
  await steady(page);
}

/** Waits until no skeleton is left and the page's text has not changed for half a second. */
async function steady(page: Page): Promise<void> {
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

test('UX1/UX3 tasks: „Gutschrift“ found in two interactions on a phone, its name and its diagram shown', async ({
  browser,
}) => {
  const { context, page } = await mobile(browser);
  try {
    await settle(page, `/projects/${NORDWIND}`, '[data-testid=model-search]');
    await page.getByRole('searchbox', { name: 'Modell suchen' }).fill('Gutschrift'); // 1
    const rows = page.getByTestId('model-row');
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole('link').first().click(); // 2
    await expect(page).toHaveURL(/\/models\/finanzen\/gutschrift/);
    await expect(page.getByTestId('bpmn-canvas')).toHaveAttribute('data-imported', 'true');
    // UX3's view-first phone: the name in the top bar, the sheet collapsed, the canvas ≥ 55 %
    const name = page.getByTestId('canvas-title');
    await expect(name).toHaveText(/Gutschrift/);
    const box = await name.boundingBox();
    expect(box, 'the model name is on screen').not.toBeNull();
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('h1') !== null,
      [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
    );
    expect(hit, 'the model name answers elementFromPoint').toBe(true);
    await expect(page.getByTestId('model-panel')).toHaveAttribute('data-sheet', 'collapsed');
    await expect(page.getByTestId('panel-handle')).toHaveText(/^Fragen \d+ · Relationen \d+$/);
    const share = await page.evaluate(() => {
      const area = (r: { left: number; top: number; right: number; bottom: number }) =>
        Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
      const cut = (
        a: DOMRect,
        b: { left: number; top: number; right: number; bottom: number },
      ) => ({
        left: Math.max(a.left, b.left),
        top: Math.max(a.top, b.top),
        right: Math.min(a.right, b.right),
        bottom: Math.min(a.bottom, b.bottom),
      });
      const view = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const canvas = document.querySelector('[data-testid=model-canvas]')?.getBoundingClientRect();
      if (!canvas) return 0;
      const shown = cut(canvas, view);
      // what the top bar and the sheet cover of it
      const covered = ['[data-testid=model-header]', '[data-testid=model-panel]']
        .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
        .filter((r): r is DOMRect => r !== undefined)
        .reduce((sum, r) => sum + area(cut(r, shown)), 0);
      return (area(shown) - covered) / area(view);
    });
    expect(share, 'the canvas covers at least 55 % of the screen').toBeGreaterThanOrEqual(
      MODEL_BUDGET.canvasShareMobile,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      MOBILE.viewport.width,
    );
    await measure(page, NORDWIND, 'Modellansicht', null);
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
  await expect(page.getByTestId('review-placements')).toHaveText(
    new RegExp(`^Platzierungen prüfen \\(${placements}\\)`),
    { timeout: 30_000 },
  );
  // „Zu prüfen“ shows its first rows; „Alle n zeigen“ the rest (UX6)
  const all = page.getByTestId('open-placements-all');
  if ((await all.count()) > 0) await all.click();
  await expect(page.getByTestId('open-placement')).toHaveCount(placements);
  await settle(
    page,
    `/projects/${NORDWIND}/review?model=einkauf%2Fbestellanforderung`,
    '[data-testid=queue-row]',
  );
  const queued = await page.getByTestId('queue-row').count();
  await page
    .getByRole('navigation', { name: 'Ansichten' })
    .getByRole('link', { name: 'Vorgemerkt' })
    .click();
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

// ------------------------------------------------------------------ the trust rule's fast path (M6 S2c-2)

test('S2c: `signavio-beispiel`’s calls line equals the group „Gesammelt annehmen“ opens selected; nothing decided', async ({
  page,
}) => {
  interface Relation {
    id: string;
    type: string;
    tier: string;
    status: string;
    endpointState: string;
    attrs: Record<string, unknown>;
    provenance: { question: string | null } | null;
    noLinks: unknown[];
  }
  // The web's `isBulkCall`: the unique calls of derived models (the CLI imported with a token)
  // with no agent's question and no no-link, what „Gesammelt annehmen“ selects.
  const isBulkCall = (r: Relation) =>
    r.type === 'call' &&
    r.tier === 'key' &&
    r.status === 'proposed' &&
    r.attrs['match'] === 'derived-caller' &&
    !r.provenance?.question?.trim() &&
    r.noLinks.length === 0;
  const isReview = (r: Relation) =>
    r.status === 'proposed' || (r.status === 'accepted' && r.endpointState !== 'ok');
  const landscape = await json<{ relations: Relation[] }>(`/api/v1/projects/${SIGNAVIO}/landscape`);
  const derived = landscape.relations.filter(isBulkCall).map((r) => r.id);
  expect(derived.length, '„Rechnung stellen“ only proposed').toBeGreaterThan(0);

  await settle(page, `/projects/${SIGNAVIO}`, '[data-testid=next-step]');
  const line = page.locator('[data-testid=next-step-line][data-kind=calls]');
  await expect(line).toHaveText(
    new RegExp(`^${derived.length} eindeutigen? Aufrufe? zuerst bestätigen · Gesammelt annehmen$`),
  );
  // no second line for the same rows while every open relation is such a call
  if (landscape.relations.filter(isReview).length === derived.length)
    await expect(page.locator('[data-testid=next-step-line][data-kind=review-too]')).toHaveCount(0);
  await line.getByRole('link', { name: 'Gesammelt annehmen' }).click(); // 1
  await expect(page).toHaveURL(new RegExp(`/projects/${SIGNAVIO}/review\\?bulk=calls$`));
  const dialog = page.getByTestId('bulk-dialog');
  await expect(dialog.getByTestId('bulk-calls').getByRole('heading')).toHaveText(
    `Eindeutige Aufrufe aus abgeleiteten Modellen (${derived.length})`,
    { timeout: 30_000 },
  );
  const selected = await dialog
    .locator('[data-testid=bulk-row]:has([role=checkbox][aria-checked=true])')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-relation-id')));
  expect(new Set(selected), 'the line’s number is the dialog’s selection').toEqual(
    new Set(derived),
  );
  await expect(dialog.getByTestId('bulk-confirm')).toHaveText(
    derived.length === 1 ? '1 annehmen' : `${derived.length} annehmen`,
  );
  // the review page behind the modal settles too (its counts load in parallel)
  await steady(page);
  await measure(page, SIGNAVIO, 'Gesammelt annehmen', '[data-testid=bulk-row]');
  expect(await visibleText(page)).not.toMatch(ID_PATTERN);
  // closed without a decision (the later tests need the project as imported); `?bulk` goes
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/projects/${SIGNAVIO}/review$`));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('review-start')).toBeFocused();
  expect(
    (
      await json<{ relations: Relation[] }>(`/api/v1/projects/${SIGNAVIO}/landscape`)
    ).relations.filter(isBulkCall),
  ).toHaveLength(derived.length);
});

// ------------------------------------------------------------------ measured for the next slices

const CONTROLS =
  'button, a[href], input, select, textarea, [role=tab], [role=menuitem], [role=radio], [role=checkbox], [role=switch]';

// ------------------------------------------------------------------ the chain (UX6)

/** UX6's budgets (§7 "UX6", done when), on `nordwind-handel` after the simulation agent. */
const CHAIN_BUDGET = {
  panelWords: 150,
  panelControls: 40,
  /** Besides the chip „3 Prozesse ohne Schritt“, which leads to the panel's list (§3.8 item 2). */
  headerControls: 4,
  cardControls: 6,
  /** „nichts angenommen“ only on steps whose subtree waits for nothing (12 before). */
  quietLabels: 4,
} as const;

test('UX6 desktop: „Platzierungen prüfen (n)“ in view, the panel within 40 controls and 150 words, the header in 4, the card in 6, „nichts angenommen“ on 4 steps', async ({
  page,
}) => {
  const chain = await json<{ placements: { status: string; endpointState: string }[] }>(
    `/api/v1/projects/${NORDWIND}/value-chains/main`,
  );
  const open = chain.placements.filter(
    (p) => p.status === 'proposed' || (p.status === 'accepted' && p.endpointState !== 'ok'),
  ).length;
  await settle(page, `/projects/${NORDWIND}/value-chain`, '[data-testid=chain-summary]');
  await measure(page, NORDWIND, 'Kette', '[data-testid=review-placements]');
  const primary = page.getByTestId('review-placements');
  await expect(primary).toHaveText(new RegExp(`^Platzierungen prüfen \\(${open}\\)`));
  await expect(primary).toBeInViewport({ ratio: 1 });
  const load = await page.evaluate((selector) => {
    // checkVisibility: a closed disclosure's content (content-visibility: hidden) is not shown
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true });
    };
    // a disclosure's summary is a control too
    const controls = (root: Element) =>
      [...root.querySelectorAll(`${selector}, summary`)].filter(visible);
    const words = (el: Element) =>
      (el as HTMLElement).innerText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const panel = document.querySelector('aside[aria-label="Wertschöpfungskette: Details"]')!;
    const header = document.querySelector('[data-testid=chain-header]')!;
    return {
      panelWords: words(panel),
      panelControls: controls(panel).length,
      headerControls: controls(header).filter(
        (c) => c.getAttribute('data-testid') !== 'unplaced-chip',
      ).length,
      quiet: [...document.querySelectorAll('[data-testid=vc-canvas] .analyzr-vc-badge')].filter(
        (b) => b.textContent === 'nichts angenommen',
      ).length,
      scrolled: panel.querySelector('.overflow-y-auto')?.scrollTop ?? 0,
    };
  }, CONTROLS);
  console.log(`UX6 chain: ${JSON.stringify(load)}`);
  expect(load.scrolled).toBe(0);
  expect(load.panelWords).toBeLessThanOrEqual(CHAIN_BUDGET.panelWords);
  expect(load.panelControls).toBeLessThanOrEqual(CHAIN_BUDGET.panelControls);
  expect(load.headerControls).toBeLessThanOrEqual(CHAIN_BUDGET.headerControls);
  expect(load.quiet).toBe(CHAIN_BUDGET.quietLabels);
  expect(await page.getByTestId('chain-overview').innerText()).not.toMatch(ID_PATTERN);

  // the first card: „Details“, „Im Modell“ and the four decisions
  await primary.click();
  const card = page.locator('[data-testid=placement-card][data-active=true]');
  await expect(card).toBeVisible();
  const cardControls = await card.evaluate(
    (el, selector) =>
      [...el.querySelectorAll(`${selector}, summary`)]
        .filter((c) => {
          const r = c.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && c.checkVisibility({ visibilityProperty: true });
        })
        .map((c) => (c as HTMLElement).innerText.trim()),
    CONTROLS,
  );
  console.log(`UX6 card: ${JSON.stringify(cardControls)}`);
  expect(cardControls.length).toBeLessThanOrEqual(CHAIN_BUDGET.cardControls);
  expect(await card.innerText()).not.toMatch(ID_PATTERN);
  // the model path, not the ref (the simulation agent's rationale may cite one: its text)
  expect(await card.getByTestId('placement-model').innerText()).not.toContain('#');
});

test('UX6 canvas: the selected step outlined 4 px wide, the panel hidden by its toggle', async ({
  page,
}) => {
  await settle(page, `/projects/${NORDWIND}/value-chain`, '[data-testid=chain-summary]');
  await page.getByTestId('step-tree').locator('summary').click();
  await page.getByTestId('step-tree-item').first().click();
  const outline = page.locator(
    '[data-testid=vc-canvas] .djs-element.analyzr-vc-selected .djs-visual > path:first-child',
  );
  await expect(outline).toHaveCount(1);
  expect(await outline.evaluate((el) => getComputedStyle(el).strokeWidth)).toBe('4px');
  // the toggle in the zoom group gives the canvas the panel's room, and back
  const area = page.getByTestId('chain-canvas-area');
  const before = (await area.boundingBox())!.width;
  await page.getByRole('button', { name: 'Details ausblenden' }).click();
  await expect(page.getByTestId('chain-panel')).toHaveCount(0);
  expect((await area.boundingBox())!.width).toBeGreaterThan(before + 400);
  await page.getByRole('button', { name: 'Details zeigen' }).click();
  await expect(page.getByTestId('chain-panel')).toBeVisible();
});

test('UX6 mobile: the chain view-first, the project link on top, the sheet collapsed to „n offen“', async ({
  browser,
}) => {
  const { context, page } = await mobile(browser);
  try {
    await settle(page, `/projects/${NORDWIND}/value-chain`, '[data-testid=chain-panel]');
    await expect(page.getByTestId('chain-panel')).toHaveAttribute('data-sheet', 'collapsed');
    await expect(page.getByTestId('panel-handle')).toHaveText(/^\d+ offen$/);
    const box = await page.getByTestId('canvas-back').boundingBox();
    expect(box, 'the project link is on screen').not.toBeNull();
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="canvas-back"]') !== null,
      [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
    );
    expect(hit, 'the project link answers elementFromPoint').toBe(true);
    // the canvas ends above the sheet and covers most of the screen
    const area = (await page.getByTestId('chain-canvas-area').boundingBox())!;
    const handle = (await page.getByTestId('panel-handle').boundingBox())!;
    expect(area.y + area.height).toBeLessThanOrEqual(handle.y + 1);
    expect(area.height / MOBILE.viewport.height).toBeGreaterThan(0.55);
    await page.getByTestId('panel-handle').click();
    await expect(page.getByTestId('chain-panel')).toHaveAttribute('data-sheet', 'expanded');
    await expect(page.getByTestId('review-placements')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      MOBILE.viewport.width,
    );
  } finally {
    await context.close();
  }
});

// ------------------------------------------------------------------ UX9

/** UX9's budgets (§7 "UX9", done when). */
const UX9_BUDGET = {
  /** The result view „Alle“, the shell included (194 at the audit). */
  resultControls: 60,
  /** A rule row: „Aktiv“, „Bearbeiten“, „Mehr“ (6 at the audit). */
  ruleRowControls: 3,
  /** The rule dialog: four criteria and the prefilled name (10 at the audit). */
  dialogFields: 5,
} as const;

test('UX9: the result view „Alle“ within 60 controls, one per row, no ids, no ref tooltips', async ({
  page,
}) => {
  await settle(page, `/projects/${NORDWIND}/relations`, '[data-testid=relation-row]');
  const m = await measure(page, NORDWIND, 'Relationen › Alle', '[data-testid=relation-row]');
  expect(m.controls).toBeLessThanOrEqual(UX9_BUDGET.resultControls);
  const perRow = await page
    .locator('[data-testid=relation-row]')
    .evaluateAll(
      (rows, selector) => Math.max(...rows.map((r) => r.querySelectorAll(selector).length)),
      CONTROLS,
    );
  expect(perRow).toBe(1);
  expect(await page.locator('main').innerText()).not.toMatch(ID_PATTERN);
  expect(await page.locator('[data-testid=relation-row] [title*="#"]').count()).toBe(0);
});

test('UX9: a rule row in 3 controls, the dialog in four criteria and the prefilled name', async ({
  page,
}) => {
  // a rule that is off accepts nothing: the other checks' numbers stay
  const NAME = 'UI-Last: Gleicher Name ab 95 %';
  const rules = await json<{ items: { name: string }[] }>(
    `/api/v1/projects/${NORDWIND}/auto-accept-rules`,
  );
  if (!rules.items.some((r) => r.name === NAME)) {
    const created = await owner.post(`/api/v1/projects/${NORDWIND}/auto-accept-rules`, {
      data: { name: NAME, kind: 'relation', tier: 'key', minConfidence: 0.95, enabled: false },
    });
    expect(created.status()).toBe(201);
  }
  await settle(page, `/projects/${NORDWIND}/rules`, '[data-testid=rule-row]');
  await measure(page, NORDWIND, 'Annahmeregeln', '[data-testid=rule-row]');
  const row = page.locator('[data-testid=rule-row]').filter({ hasText: NAME });
  const rowControls = await row.evaluate(
    (el, selector) =>
      [...el.querySelectorAll(`${selector}, summary`)].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && c.checkVisibility({ visibilityProperty: true });
      }).length,
    CONTROLS,
  );
  expect(rowControls).toBeLessThanOrEqual(UX9_BUDGET.ruleRowControls);
  await page.getByTestId('new-rule').click();
  const fields = page.getByTestId('rule-dialog').getByTestId('rule-fields');
  const shown = await fields.evaluate(
    (el) =>
      [...el.querySelectorAll('input, select, textarea, [role=checkbox], [role=switch]')].filter(
        (c) => c.getAttribute('aria-hidden') !== 'true' && c.checkVisibility(),
      ).length,
  );
  expect(shown).toBe(UX9_BUDGET.dialogFields);
  await expect(page.getByTestId('rule-dialog').getByLabel('Name')).toHaveValue(/ab \d+ %/);
  await page.keyboard.press('Escape');
});

test('UX9: the projects list shows „Offen für dich“ as the sum of the project’s badges and „Zuletzt geändert“', async ({
  page,
}) => {
  await settle(page, `/projects/${NORDWIND}`, '[data-testid=next-step-primary]');
  const badges = [
    await badgeOf(page, /^Relationen/),
    await badgeOf(page, /^Wertschöpfungskette/),
    await badgeOf(page, /^Offene Fragen/),
  ];
  await settle(page, '/', '[data-testid=project-row]');
  const row = page.locator('[data-testid=project-row]').filter({ hasText: NORDWIND });
  await expect(row.getByTestId('open-points')).toHaveText(
    String(badges.reduce((sum, n) => sum + n, 0)),
  );
  await expect(row.getByTestId('last-changed')).toHaveText(/^\d\d\.\d\d\.\d{4}$/);
  await measure(page, '–', 'Projekte', '[data-testid=project-row]');
});

// ------------------------------------------------------------------ „Relationen › Zu prüfen“ (UX5)

/** UX5's budgets (§7 "UX5", done when): „Zu prüfen“ on `nordwind-handel`. */
const REVIEW_BUDGET = {
  firstTop: 360,
  perRow: 1,
  /** Controls of the view itself, besides the rows (the shell's header and tabs apart). */
  outside: 12,
  /**
   * Words of the page at the audit's 42 rows (768 then); the guard's stack, worked by the
   * simulation agent, has more rows, so the budget scales with them (the same words per row).
   */
  words: 450,
  auditRows: 42,
} as const;

test('UX5 desktop: „Zu prüfen“ with the first proposal ≤ 360 px, one link per row, ≤ 12 controls besides, 450 words at 42 rows, no name cut', async ({
  page,
}) => {
  await settle(page, `/projects/${NORDWIND}/review`, '[data-testid=queue-row]');
  const entry = await measure(page, NORDWIND, 'Zu prüfen', '[data-testid=queue-row]');
  const load = await page.evaluate((selector) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const all = [...document.querySelectorAll(selector)].filter(visible);
    const rows = [...document.querySelectorAll('[data-testid=queue-row]')];
    const shell = (el: Element) =>
      el.closest('header') !== null || el.closest('[data-testid=project-tabs]') !== null;
    return {
      perRow: Math.max(...rows.map((r) => all.filter((el) => r.contains(el)).length)),
      links: rows.map((r) => r.querySelectorAll('a[href]').length),
      outside: all.filter((el) => !el.closest('[data-testid=queue-row]') && !shell(el)).length,
      cut: [...document.querySelectorAll('[data-testid=queue-link]')].filter(
        (el) => el.scrollWidth > el.clientWidth,
      ).length,
    };
  }, CONTROLS);
  console.log(
    `Zu prüfen: ${load.outside} controls besides the rows, at most ${load.perRow} per row, ${entry.words} words, first at ${entry.firstTop} px`,
  );
  expect(entry.firstTop, 'the first proposal from the top').toBeLessThanOrEqual(
    REVIEW_BUDGET.firstTop,
  );
  const rows = await page.getByTestId('queue-row').count();
  expect(entry.words, `words of the page with ${rows} rows`).toBeLessThanOrEqual(
    Math.round(
      (REVIEW_BUDGET.words * Math.max(rows, REVIEW_BUDGET.auditRows)) / REVIEW_BUDGET.auditRows,
    ),
  );
  expect(load.perRow, 'controls per queue row').toBeLessThanOrEqual(REVIEW_BUDGET.perRow);
  expect(new Set(load.links), 'one link per row').toEqual(new Set([1]));
  expect(load.outside, 'controls besides the rows').toBeLessThanOrEqual(REVIEW_BUDGET.outside);
  expect(load.cut, 'names cut in the queue').toBe(0);
  // the bulk action's count is its default selection
  const offered = Number(
    /^(\d+) unauffällige annehmen …$/.exec(await page.getByTestId('bulk-open').innerText())?.[1],
  );
  await page.getByTestId('bulk-open').click();
  await expect(page.getByTestId('bulk-summary')).toHaveText(`${offered} von ${offered} ausgewählt`);
  await page.keyboard.press('Escape');
  expect(await visibleText(page)).not.toMatch(ID_PATTERN);
});

test('UX5 mobile: „Zu prüfen“ as cards, no sideways scroll', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  try {
    await settle(page, `/projects/${NORDWIND}/review`, '[data-testid=queue-row]');
    const entry = await measure(page, NORDWIND, 'Zu prüfen', '[data-testid=queue-row]');
    expect(entry.scrollWidth).toBeLessThanOrEqual(MOBILE.viewport.width);
  } finally {
    await context.close();
  }
});

// ------------------------------------------------------------------ the model view (UX3)

const ORDER_HANDLING = 'vertrieb/order-handling';
const FIRST_QUESTION = '[data-testid=model-panel] [data-testid=open-question]';

/** The panel's visible controls and words, and where its first question ends. */
async function panelLoad(page: Page) {
  return page.getByTestId('model-panel').evaluate((aside) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        getComputedStyle(el).visibility !== 'hidden' &&
        !el.closest('[inert]')
      );
    };
    const controls = [
      ...aside.querySelectorAll(
        'button, a[href], input, select, textarea, [role=tab], [role=menuitem], [role=radio], [role=checkbox], [role=switch]',
      ),
    ].filter(visible);
    const first = aside.querySelector('[data-testid=open-question]')?.getBoundingClientRect();
    return {
      controls: new Set(controls).size,
      words: (aside as HTMLElement).innerText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
        .length,
      firstBottom: first ? Math.round(first.bottom) : null,
      panelBottom: Math.round(aside.getBoundingClientRect().bottom),
    };
  });
}

test('UX3 desktop: the first question without scrolling, the panel within 25 controls and 300 words, three chips and „Mehr“', async ({
  page,
}) => {
  await settle(page, `/projects/${NORDWIND}/models/${ORDER_HANDLING}`, FIRST_QUESTION);
  await expect(page.locator('[data-testid=panel-tab][data-tab=questions]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const load = await panelLoad(page);
  expect(load.firstBottom, 'the first question ends inside the panel').not.toBeNull();
  expect(load.firstBottom!).toBeLessThanOrEqual(load.panelBottom);
  expect(load.controls, 'visible controls of the panel').toBeLessThanOrEqual(
    MODEL_BUDGET.panelControls,
  );
  expect(load.words, 'words of the panel').toBeLessThanOrEqual(MODEL_BUDGET.panelWords);
  // the header: the crumb the one way back, at most three chips and „Mehr“
  const header = page.getByTestId('model-header');
  await expect(header.getByRole('navigation', { name: 'Brotkrumen' })).toContainText('Übersicht');
  expect(await header.locator('[data-slot=badge]').count()).toBeLessThanOrEqual(MODEL_BUDGET.chips);
  await expect(header.getByTestId('model-more')).toBeVisible();
  expect(await page.getByTestId('model-panel').innerText()).not.toMatch(ID_PATTERN);
  const entry = await measure(page, NORDWIND, 'Modellansicht', FIRST_QUESTION);
  console.log(`Modellansicht panel: ${load.controls} controls, ${load.words} words`);
  expect(entry.scrollWidth).toBeLessThanOrEqual(entry.width);
});

test('UX3: a selected element filters both tabs, „Alle zeigen“ lifts it', async ({ page }) => {
  interface Relation {
    from: string;
    to: string;
  }
  const { relations } = await json<{ relations: Relation[] }>(
    `/api/v1/projects/${NORDWIND}/landscape`,
  );
  const own = (ref: string) => ref.startsWith(`${ORDER_HANDLING}#`);
  const touching = relations.filter((r) => own(r.from) || own(r.to));
  const [element] = [...new Set(touching.flatMap((r) => [r.from, r.to]).filter(own))].sort();
  expect(element, 'an element of the model with a relation').toBeDefined();
  const count = async (tab: string) =>
    Number(
      (await page.locator(`[data-testid=panel-tab][data-tab=${tab}]`).innerText()).replace(
        /\D/g,
        '',
      ),
    );

  await settle(page, `/projects/${NORDWIND}/models/${ORDER_HANDLING}`, FIRST_QUESTION);
  const all = { questions: await count('questions'), relations: await count('relations') };
  expect(all.relations).toBe(touching.length);

  const elementId = element!.slice(element!.indexOf('#') + 1);
  await settle(
    page,
    `/projects/${NORDWIND}/models/${ORDER_HANDLING}?element=${encodeURIComponent(elementId)}`,
    '[data-testid=panel-element]',
  );
  // the element's label in the panel header, its id behind it
  await expect(page.getByTestId('panel-element')).not.toContainText(elementId);
  const expected = touching.filter((r) => r.from === element || r.to === element).length;
  expect(await count('relations')).toBe(expected);
  expect(await count('questions')).toBeLessThanOrEqual(all.questions);
  await page.locator('[data-testid=panel-tab][data-tab=relations]').click();
  await expect(page.getByTestId('model-relation')).toHaveCount(expected);

  await page.getByTestId('panel-show-all').click();
  await expect(page).not.toHaveURL(/element=/);
  await expect(page.getByTestId('model-relation')).toHaveCount(all.relations);
});

test('UX3: the bpmn.io watermark answers elementFromPoint at 390, 800, 1024 and 1440 px', async ({
  page,
}) => {
  const check = () =>
    page.locator('.bjs-powered-by').evaluate((mark) => {
      const r = mark.getBoundingClientRect();
      const points: [number, number][] = [
        [r.left + 1, r.top + 1],
        [r.right - 1, r.top + 1],
        [r.left + 1, r.bottom - 1],
        [r.right - 1, r.bottom - 1],
        [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
      ];
      return {
        inside:
          r.width > 0 &&
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= window.innerWidth &&
          r.bottom <= window.innerHeight,
        unobstructed: points.every(([x, y]) => mark.contains(document.elementFromPoint(x, y))),
      };
    });
  for (const [width, height] of [
    [390, 844],
    [800, 1024],
    [1024, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await settle(
      page,
      `/projects/${NORDWIND}/models/${ORDER_HANDLING}`,
      '[data-testid=model-view]',
    );
    await expect(page.getByTestId('bpmn-canvas')).toHaveAttribute('data-imported', 'true');
    await expect
      .poll(check, { message: `${width}px`, timeout: 5_000 })
      .toEqual({ inside: true, unobstructed: true });
    if (width < 1024) {
      // the expanded sheet: the canvas container ends above it, the watermark moves up with it
      await page.getByTestId('panel-handle').click();
      await expect(page.getByTestId('model-panel')).toHaveAttribute('data-sheet', 'expanded');
      await expect
        .poll(check, { message: `${width}px, sheet expanded`, timeout: 5_000 })
        .toEqual({ inside: true, unobstructed: true });
    }
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
    await dialog.getByRole('button', { name: 'Antwort speichern (nicht änderbar)' }).click();
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
    `/projects/${HOLDS}/review/${relation}?view=held&from=open-questions`,
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
    // in the decision bar since UX5, where „Vormerken“ was
    page.getByTestId('decision-panel').getByRole('button', { name: answerButton }).click(),
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

// ------------------------------------------------------------------ question actions (UX4)

/**
 * `nordwind-handel` has no process „Inkasso“ („Process_Inkasso“ names none):
 * the UX4 task runs in a project of its own per run, the corpus plus one
 * model „Inkasso“ under another id, so the call stays without a target.
 */
const INKASSO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs_Inkasso" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Inkassobuero" name="Inkasso" isExecutable="false">
    <bpmn:startEvent id="Start_Inkasso" name="Forderung übernommen" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Inkasso">
    <bpmndi:BPMNPlane id="Plane_Inkasso" bpmnElement="Process_Inkassobuero">
      <bpmndi:BPMNShape id="Start_Inkasso_di" bpmnElement="Start_Inkasso">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

test('UX4 tasks: the call target of „Forderung an Inkasso übergeben“ in 3 clicks, „Inkasso“ under „Passt vermutlich“; „Agent starten“ after an amendment', async ({
  page,
}) => {
  const key = `ui-load-ziel-${Date.now().toString(36)}`;
  await create(key, 'Aufrufziel (UI-Last)');
  const form = new FormData();
  for (const file of bpmnFiles(CORPUS))
    form.append(
      'files',
      new File([readFileSync(file)], relative(CORPUS, file), { type: 'application/xml' }),
    );
  form.append(
    'files',
    new File([INKASSO_XML], 'finanzen/inkasso.bpmn', { type: 'application/xml' }),
  );
  expect((await owner.post(`/api/v1/projects/${key}/imports`, { multipart: form })).ok()).toBe(
    true,
  );
  // an agent to start once the model changed (§2.6)
  await token(key, ['analyzr:read', 'analyzr:propose']);
  const call = (
    await allPages<AskItem & { subjectLabel: string }>(
      `/api/v1/projects/${key}/open-questions?kind=call-target-unknown&state=open`,
    )
  ).find((q) => q.subjectLabel.includes('Forderung an Inkasso übergeben'));
  expect(call, 'the open question of „Forderung an Inkasso übergeben“').toBeDefined();

  await settle(
    page,
    `/projects/${key}/open-questions?kind=call-target-unknown`,
    '[data-testid=open-question]',
  );
  const card = page.locator(`[data-testid=open-question][data-question-id="${call!.id}"]`);
  const entry = card.locator('[data-testid=question-action][data-primary=true]');
  await expect(entry).toHaveText('Ziel wählen …');
  await entry.click(); // 1
  const panel = card.getByTestId('question-action-panel');
  await expect(panel.getByTestId('action-option').first()).toBeVisible();
  // the options under their sections, in order
  const listed = await panel
    .locator('[role=radiogroup], ul')
    .first()
    .evaluate((list) => {
      const out: { section: string; text: string; ref: string }[] = [];
      let section = '';
      for (const el of list.querySelectorAll(
        '[data-testid=picker-section], [data-testid=action-option]',
      )) {
        if (el.getAttribute('data-testid') === 'picker-section') section = el.textContent ?? '';
        else
          out.push({ section, text: el.textContent ?? '', ref: el.getAttribute('data-ref') ?? '' });
      }
      return out;
    });
  const likely = listed.filter((o) => o.section === 'Passt vermutlich');
  expect(likely.length, '„Passt vermutlich“ lists at most three').toBeLessThanOrEqual(3);
  expect(likely[0]?.ref).toBe('finanzen/inkasso#Process_Inkassobuero');
  expect(likely[0]?.text).toMatch(/^Inkasso – /);
  await panel
    .locator('[data-testid=action-option][data-ref="finanzen/inkasso#Process_Inkassobuero"]')
    .click(); // 2
  // a value that names no process: the link leads, the third click would link
  const submit = panel.getByTestId('action-submit');
  await expect(submit).toHaveText('Verknüpfen');
  await expect(submit).toBeEnabled();
  // in the model instead: checked, the dry run inline, one „Speichern“, then „Agent starten“
  await panel.getByTestId('action-in-model').click();
  await expect(panel.getByTestId('amend-effect')).toContainText('Danach:');
  await expect(submit).toHaveText('Speichern');
  await submit.click();
  const saved = page.getByTestId('toast').filter({ hasText: 'Ergänzung gespeichert' });
  await expect(saved).toBeVisible();
  await saved.getByTestId('toast-action').click();
  await expect(page.getByTestId('agent-start-host')).toContainText(`/analyzr:relations ${key}`);
  await expect(card).toHaveCount(0);
});

test('UX4: a card whose only further action is the note shows the ghost button „Notiz“, no menu', async ({
  page,
}) => {
  await settle(page, `/projects/${NORDWIND}/open-questions`, '[data-testid=open-question]');
  const cards = await page.getByTestId('open-question').evaluateAll((els) =>
    els.map((e) => ({
      ghost:
        e.querySelector('[data-testid=question-action][data-action=note][data-primary=false]') !==
        null,
      menu: e.querySelector('[data-testid=question-more-actions]') !== null,
    })),
  );
  const ghosts = cards.filter((c) => c.ghost).length;
  console.log(`„Offene Fragen“: ${ghosts} of ${cards.length} cards with the ghost button „Notiz“`);
  expect(ghosts).toBeGreaterThan(0);
  expect(cards.filter((c) => c.ghost && c.menu)).toHaveLength(0);
  // no „Sammeln“ anywhere
  expect(await visibleText(page)).not.toContain('Sammeln');
});

// ------------------------------------------------------------------ the review screen (UX5 step 2)

/** An agent's open proposal with a rationale on `nordwind-handel`, the first by id. */
async function agentProposal(): Promise<string> {
  const { relations } = await json<{
    relations: {
      id: string;
      status: string;
      provenance: { sourceKind: string; rationale: string | null } | null;
    }[];
  }>(`/api/v1/projects/${NORDWIND}/landscape`);
  const found = relations
    .filter(
      (r) =>
        r.status === 'proposed' &&
        r.provenance?.sourceKind === 'agent' &&
        (r.provenance.rationale ?? '') !== '',
    )
    .map((r) => r.id)
    .sort()[0];
  expect(found, 'an agent proposal with a rationale').toBeDefined();
  return found!;
}

/** UX5's budget for the review panel (§7 "UX5", done when). */
const REVIEW_PANEL_WORDS = 110;

test('UX5 desktop: the review panel of an agent proposal in at most 110 words with „Verlauf“ closed', async ({
  page,
}) => {
  const id = await agentProposal();
  await settle(page, `/projects/${NORDWIND}/review/${id}`, '[data-testid=review-details]');
  await expect(page.getByTestId('review-history')).not.toHaveAttribute('open', '');
  const words = await page
    .getByTestId('review-panel')
    .evaluate(
      (el) =>
        (el as HTMLElement).innerText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length,
    );
  console.log(`review panel: ${words} words`);
  expect(words, 'words of the review panel').toBeLessThanOrEqual(REVIEW_PANEL_WORDS);
  expect(await page.getByTestId('review-panel').innerText()).not.toMatch(ID_PATTERN);
  await measure(page, NORDWIND, 'Prüfung', null);
});

test('UX5 mobile: the review screen view-first, the way back and ‹ › on top, the sheet collapsed', async ({
  browser,
}) => {
  const id = await agentProposal();
  const { context, page } = await mobile(browser);
  try {
    await settle(page, `/projects/${NORDWIND}/review/${id}`, '[data-testid=review-screen]');
    await expect(page.getByTestId('review-panel')).toHaveAttribute('data-sheet', 'collapsed');
    for (const testId of ['review-back', 'review-previous', 'review-next']) {
      const box = await page.getByTestId(testId).boundingBox();
      expect(box, `${testId} is on screen`).not.toBeNull();
      const hit = await page.evaluate(
        ([x, y, wanted]) =>
          document.elementFromPoint(x, y)?.closest(`[data-testid="${wanted}"]`) !== null,
        [box!.x + box!.width / 2, box!.y + box!.height / 2, testId] as const,
      );
      expect(hit, `${testId} answers elementFromPoint`).toBe(true);
    }
    await expect(page.getByTestId('panel-handle')).toHaveText(/→ .* · \d+ %$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      MOBILE.viewport.width,
    );
  } finally {
    await context.close();
  }
});

test('UX5: the review screen’s bpmn.io watermark answers elementFromPoint at 390, 800, 1024 and 1440 px', async ({
  page,
}) => {
  const id = await agentProposal();
  const check = () =>
    page.locator('.bjs-powered-by').evaluateAll((marks) =>
      marks.map((mark) => {
        const r = mark.getBoundingClientRect();
        const points: [number, number][] = [
          [r.left + 1, r.top + 1],
          [r.right - 1, r.top + 1],
          [r.left + 1, r.bottom - 1],
          [r.right - 1, r.bottom - 1],
          [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
        ];
        return {
          inside:
            r.width > 0 &&
            r.left >= 0 &&
            r.top >= 0 &&
            r.right <= window.innerWidth &&
            r.bottom <= window.innerHeight,
          unobstructed: points.every(([x, y]) => mark.contains(document.elementFromPoint(x, y))),
        };
      }),
    );
  for (const [width, height] of [
    [390, 844],
    [800, 1024],
    [1024, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await settle(page, `/projects/${NORDWIND}/review/${id}`, '[data-testid=review-screen]');
    await expect(page.getByTestId('bpmn-canvas').first()).toHaveAttribute('data-imported', 'true');
    // every pane's watermark, the one or both
    await expect
      .poll(check, { message: `${width}px`, timeout: 5_000 })
      .toEqual(expect.arrayContaining([{ inside: true, unobstructed: true }]));
    const marks = await check();
    expect(
      marks.every((m) => m.inside && m.unobstructed),
      `${width}px: every pane`,
    ).toBe(true);
    if (width < 1024) {
      await page.getByTestId('panel-handle').click();
      await expect(page.getByTestId('review-panel')).toHaveAttribute('data-sheet', 'expanded');
      await expect
        .poll(async () => (await check()).every((m) => m.inside && m.unobstructed), {
          message: `${width}px, sheet expanded`,
          timeout: 5_000,
        })
        .toBe(true);
    }
  }
});
