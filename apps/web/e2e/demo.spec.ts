import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

import { probeServer } from './server-mode';

/**
 * The read-only demo in the browser (owner decision 20), against the demo image
 * (`docker/compose.demo.yaml`, ANALYZR_E2E_URL=http://127.0.0.1:7480). It clicks
 * through every read view of both seeded landscapes and fails on any request
 * that is not a read (the viewer session aside), on any API answer 4xx/5xx,
 * on a CSP violation and on any write action shown (by its text or its test
 * id). The review shows the simulation agent's proposals, questions,
 * no-links (tab „Kein Zusammenhang“) and placement proposals (owner decision
 * 20(4)) and, for the dev landscape, the open questions with their export and
 * the model view's section (M6 S4). The banner links the operator's „Impressum“ and „Datenschutz“ (from
 * `/health`) at every width, phone included, in one line of the height of
 * `--analyzr-banner-h`; that test runs last, so a demo without the optional links
 * fails it alone. Skips itself unless the server reports `demo: "readonly"`.
 * ANALYZR_SCREENSHOTS_DIR=<dir> saves `demo-*.png` screenshots there.
 */

const PROJECTS = ['nordwind-handel', 'stadtwerke-auental'] as const;
const SHOTS = process.env['ANALYZR_SCREENSHOTS_DIR'];

/** Texts of actions that change something; none may appear on the demo. */
const WRITE_ACTIONS = [
  /Neues Projekt/,
  /^Hochladen$/,
  /Modelle hochladen/,
  /^Agent verbinden$/,
  /^Regeln$/,
  /annehmen…/,
  /Erneut einplanen/,
  /Aufgabe einplanen/,
  /^Bearbeiten$/,
  /^Annehmen/,
  /^Erneut annehmen/,
  /^Ablehnen/,
  /^Vormerken/,
  /^Korrigieren/,
  /Notiz speichern/,
  /Token erstellen/,
  /^Prozess hinzufügen$/,
  /^Platzieren$/,
  /erneut bestätigen/,
  /^Speichern$/,
  /^Importieren$/,
  /Antworten aus CSV übernehmen/,
  // M6 S5c-1: the open questions' actions
  /^Notiz hinzufügen$/,
  /^Weitere Aktionen$/,
  /^Entscheiden$/,
  /Verknüpfen mit/,
  // UX2a: the API's renamed action labels (the decide labels in WRITE_BUTTONS below)
  /^Nur verknüpfen …$/,
  /im Modell eintragen …$/,
  /^Prozess platzieren …$/,
  /^Liegt außerhalb der Landschaft$/,
  /^Markierung zurücknehmen$/,
  // UX1: the shell's write entries, „Als Nächstes“ and the renamed write labels of the plan
  /^Einstellungen$/,
  /^Annahmeregeln$/,
  /Agent starten/,
  /Nochmal versuchen/,
  /unauffällige annehmen/,
  /^Ziel wählen …$/,
  /^Partner wählen …$/,
  /^Antwort ergänzen$/,
  /^Antwort geben$/,
  /^Jetzt entscheiden$/,
  /^\+ Notiz$/,
  /^Notiz$/,
  // UX2b: a hold's answer in the note dialog
  /^Antwort speichern$/,
  /^Anlegen oder importieren$/,
  // M6 S5c-2: model amendments
  /^Eintragen …$/,
  /^Ändern …$/,
  /^Sammeln$/,
  /^Zurücknehmen$/,
  /^Jetzt speichern$/,
  /^Alle zurücknehmen$/,
];

/**
 * Write actions whose label a read link shares: as a button (the `decide` action of an open
 * question, UX2a) they write; „Auf der Kette prüfen“ is also the viewer's link to a placement
 * on the chain (M6 S4), so only buttons and menu items are checked.
 */
const WRITE_BUTTONS = [/^Vorschlag prüfen$/, /^Auf der Kette prüfen$/];

/** Test ids of the value chain's write actions (stable where texts may change). */
const WRITE_TEST_IDS = [
  'add-process',
  'requeue-chain',
  'import-chain',
  'save-chain',
  'edit-chain',
  'bulk-open',
  'placement-decision',
  'question-actions',
  'question-withdraw-mark',
  'hold-answer',
  'subprocess-link',
  'open-questions-import',
  'amend-form',
  'amend-section-edit',
  'amend-withdraw',
  'withdraw-confirm',
  'collect-bar',
];

const unexpected: string[] = [];

function watch(page: Page): void {
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' || request.method() === 'HEAD') return;
    if (request.method() === 'POST' && url.pathname === '/api/v1/session') return;
    unexpected.push(`${request.method()} ${url.pathname}`);
  });
  page.on('response', (response: Response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/') && response.status() >= 400) {
      unexpected.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
    }
  });
  page.on('console', (message) => {
    if (/Content Security Policy|CSP violation/i.test(message.text())) {
      unexpected.push(`CSP: ${message.text()}`);
    }
  });
}

/**
 * No write action as a button, link or test id, and none in a menu: write
 * entries in menus are `menuitem`s that exist only while the menu is open, so
 * every visible menu trigger is opened (and closed again) and its items are
 * checked too (UX-SIMPLIFICATION.md §7 "Demo write guard").
 */
async function noWriteActions(page: Page): Promise<void> {
  for (const name of WRITE_ACTIONS) {
    await expect(page.getByRole('button', { name }), String(name)).toHaveCount(0);
    await expect(page.getByRole('link', { name }), String(name)).toHaveCount(0);
  }
  for (const name of WRITE_BUTTONS)
    await expect(page.getByRole('button', { name }), String(name)).toHaveCount(0);
  for (const id of WRITE_TEST_IDS) await expect(page.getByTestId(id), id).toHaveCount(0);
  const triggers = page.locator('[aria-haspopup=menu]').filter({ visible: true });
  for (let i = 0; i < (await triggers.count()); i += 1) {
    const trigger = triggers.nth(i);
    if (await trigger.isDisabled()) continue;
    await trigger.click();
    const items = page.getByRole('menuitem');
    await expect(items.first()).toBeVisible();
    for (const name of await items.allInnerTexts()) {
      for (const write of [...WRITE_ACTIONS, ...WRITE_BUTTONS])
        expect(write.test(name.trim()), `menu item „${name.trim()}“`).toBe(false);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  }
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `demo-${name}.png`) });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const mode = await probeServer(request);
  test.skip(mode !== 'demo', 'the server at ANALYZR_E2E_URL is not the read-only demo');
});

test.beforeEach(({ page }) => {
  unexpected.length = 0;
  watch(page);
});

test.afterEach(() => {
  expect(unexpected).toEqual([]);
});

test('projects: the banner, both landscapes as a reader, nothing to create', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByTestId('demo-banner');
  await expect(banner).toContainText('Demo – nur lesen.');
  await expect(banner.getByRole('link', { name: /analyzr auf GitHub/ })).toHaveAttribute(
    'href',
    'https://github.com/Miragon/analyzr',
  );
  await expect(page.locator('html')).toHaveAttribute('data-analyzr-demo', 'readonly');
  const rows = page.getByTestId('project-row');
  await expect(rows).toHaveCount(PROJECTS.length);
  for (const row of await rows.all()) await expect(row).toContainText('Leser');
  await noWriteActions(page);
  await expect(page.getByText(/Testlandschaften laden/)).toHaveCount(0);
  await shot(page, '01-projects');
});

for (const project of PROJECTS) {
  test(`${project}: „Übersicht“, relations, findings and the model view read`, async ({ page }) => {
    await page.goto(`/projects/${project}`);
    await expect(page.getByTestId('model-row').first()).toBeVisible();
    // Owner decision 26: four object tabs, no „Hochladen“, no „Einstellungen“ for a reader.
    const nav = page.getByRole('navigation', { name: 'Projektbereiche' });
    expect(
      (await nav.getByRole('link').allTextContents()).map((t) => t.replace(/\d+.*/, '').trim()),
    ).toEqual(['Übersicht', 'Relationen', 'Wertschöpfungskette', 'Offene Fragen']);
    // „Als Nächstes“ reads, with nothing to click that writes (only „Exportieren“, a read).
    const next = page.getByTestId('next-step');
    await expect(next).toContainText('Als Nächstes');
    await expect(next.getByRole('link').first()).toBeVisible();
    for (const name of await next.getByRole('button').allInnerTexts())
      expect(name.trim()).toBe('Exportieren');
    await noWriteActions(page);
    await nav.getByRole('link', { name: /^Relationen/ }).click();
    await expect(page.getByTestId('queue-row').first()).toBeVisible();
    await page.getByTestId('all-relations').click();
    await expect(page.getByTestId('relation-row').first()).toBeVisible();
    // Q2: the list „Befunde“ behind its link at the foot of „Offene Fragen“ (the dev landscape;
    // the holdout's questions stay unread, its findings page opens by its URL as before).
    if (project === 'nordwind-handel') {
      await page.goto(`/projects/${project}/open-questions`);
      await page.getByTestId('findings-link').click();
    } else await page.goto(`/projects/${project}/findings`);
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await page.goto(`/projects/${project}`);
    await page.getByTestId('model-row').first().getByRole('link').first().click();
    await expect(page.getByTestId('model-view')).toBeVisible();
    await expect(page.locator('.djs-container')).toBeVisible();
    if (project === 'nordwind-handel') await shot(page, '02-model-view');
  });

  test(`${project}: the review inbox and screen in read mode`, async ({ page }) => {
    await page.goto(`/projects/${project}/review`);
    const queue = page.getByTestId('queue-row');
    await expect(queue.first()).toBeVisible();
    expect(await queue.count()).toBeGreaterThan(0);
    await noWriteActions(page);
    if (project === 'nordwind-handel') await shot(page, '03-inbox');
    await queue
      .first()
      .getByRole('link', { name: /Prüfen/ })
      .first()
      .click();
    await expect(page.getByTestId('review-screen')).toBeVisible();
    await expect(page.getByTestId('read-only-review')).toHaveText(
      'Nur lesen – in der Demo entscheidest du nicht.',
    );
    // The decision shortcuts do nothing; J walks on.
    await page.keyboard.press('a');
    await page.keyboard.press('r');
    await page.keyboard.press('h');
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await noWriteActions(page);
    await expect(page.locator('[data-testid=review-pane] .djs-container').first()).toBeVisible();
    if (project === 'nordwind-handel') await shot(page, '04-review');
    const before = page.url();
    await page.keyboard.press('j');
    await expect(page).not.toHaveURL(before);
  });

  test(`${project}: the agent's no-links, read-only`, async ({ page }) => {
    await page.goto(`/projects/${project}/review`);
    await page.getByRole('tab', { name: /^Kein Zusammenhang/ }).click();
    await expect(page).toHaveURL(/view=no-links/);
    const items = page.getByTestId('no-link-item');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThan(0);
    await expect(items.first()).toContainText('Kein Zusammenhang laut');
    await expect(items.first()).toContainText('agent:');
    await expect(items.first().getByRole('button')).toHaveCount(0);
    await noWriteActions(page);
    if (project === 'nordwind-handel') await shot(page, '06-no-links');
  });

  test(`${project}: the value chain with the agent's placements, and a step`, async ({ page }) => {
    await page.goto(`/projects/${project}/value-chain`);
    await expect(page.getByTestId('value-chain-page')).toBeVisible();
    await expect(page.getByTestId('vc-canvas')).toBeVisible();
    await expect(page.getByTestId('chain-overview')).toBeVisible();
    await expect(page.getByTestId('chain-stage')).toBeVisible();
    await expect(page.getByTestId('edit-chain')).toHaveCount(0);
    await expect(page.getByTestId('import-chain')).toHaveCount(0);
    await noWriteActions(page);
    const open = page.getByTestId('open-placement');
    if ((await open.count()) > 0) {
      await open.first().click();
      await expect(page.getByTestId('placement-card').first()).toBeVisible();
      await noWriteActions(page);
    }
    if (project === 'nordwind-handel') await shot(page, '05-value-chain');
    // From the overview: a step, its panel, then the step view.
    await page.goto(`/projects/${project}/value-chain`);
    const item = page.getByTestId('step-tree-item').first();
    await item.click();
    await expect(page.getByTestId('step-panel')).toBeVisible();
    await noWriteActions(page);
    await page.getByTestId('open-step').click();
    await expect(page.getByTestId('step-view')).toBeVisible();
    await noWriteActions(page);
  });

  test(`${project}: write pages answer with a notice`, async ({ page }) => {
    for (const [path, text] of [
      ['upload', 'In der Demo kannst du keine Modelle hochladen.'],
      ['agents', 'In der Demo verbindet sich kein Agent'],
      ['rules', 'In der Demo gibt es keine Annahmeregeln.'],
    ] as const) {
      await page.goto(`/projects/${project}/${path}`);
      await expect(page.getByTestId('read-only-notice')).toContainText(text);
    }
  });
}

// M6 S4: read permission, so the demo shows them; the walk checks the dev landscape only
// (the holdout's questions stay unread, as its other details).
test('nordwind-handel: the open questions read, exported and in the model view', async ({
  page,
}) => {
  await page.goto('/projects/nordwind-handel/open-questions');
  const items = page.getByTestId('open-question');
  await expect(items.first()).toBeVisible();
  // UX2b: „Zu klären“ as cards, without the promise of an action to a reader
  await expect(page.getByTestId('open-questions-count')).toContainText('zu klären');
  await expect(page.getByTestId('open-questions-intro')).toHaveText(
    'Was in der Landschaft noch fehlt.',
  );
  await noWriteActions(page);
  // the export for the customer: a dialog, the default file name unchanged
  await page.getByRole('button', { name: 'Für den Kunden exportieren …' }).click();
  const dialog = page.getByTestId('customer-export-dialog');
  await dialog.getByRole('radio', { name: /Zum Ausfüllen \(CSV\)/ }).check();
  await noWriteActions(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('offene-fragen-nordwind-handel.csv');
  await page.goto('/projects/nordwind-handel');
  await page.getByTestId('model-row').first().getByRole('link').first().click();
  // the model view's „Fragen“ (UX2b: „Zu klären“ only)
  const section = page.getByTestId('model-open-questions');
  await expect(section.getByRole('heading', { name: /^Fragen \(\d+\)$/ })).toBeVisible();
  await noWriteActions(page);
});

test('the API refuses writes and MCP from the browser context too', async ({ request }) => {
  const write = await request.post('/api/v1/projects', { data: { key: 'x', name: 'x' } });
  expect(write.status()).toBe(403);
  expect(((await write.json()) as { code: string }).code).toBe('demo-readonly');
  expect((await request.post('/mcp', { data: {} })).status()).toBe(404);
});

/** The banner's legal links as `/health` reports them (`docker/compose.demo.yaml` sets both). */
async function legalLinks(
  request: APIRequestContext,
): Promise<{ name: string; href: string | undefined }[]> {
  const health = (await (await request.get('/health')).json()) as {
    imprintUrl?: string;
    privacyUrl?: string;
  };
  return [
    { name: 'Impressum', href: health.imprintUrl },
    { name: 'Datenschutz', href: health.privacyUrl },
  ];
}

/*
 * Last on purpose: the file runs serially, so a failed test skips every test
 * after it. The links are optional settings (an older image, or a demo started
 * without them), and their absence must not hide whether the read-only walk
 * and the write barrier above hold.
 */
test('the banner links the Impressum and Datenschutz at every width, phone included', async ({
  page,
  request,
}) => {
  const links = await legalLinks(request);
  for (const { href } of links) expect(href, 'both legal links in /health').toMatch(/^https:\/\//);
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const banner = page.getByTestId('demo-banner');
    await expect(banner).toContainText('Demo – nur lesen.');
    const legal = banner.getByRole('navigation', { name: 'Rechtliches' });
    for (const { name, href } of links) {
      const link = legal.getByRole('link', { name, exact: true });
      await expect(link, `${name} at ${width}px`).toBeVisible();
      await expect(link).toHaveAttribute('href', href ?? '');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noreferrer');
      await expect(link).toHaveText(name);
      // Whole, inside the banner and the viewport: never cut off or truncated.
      const box = await link.boundingBox();
      expect(box, `${name} at ${width}px`).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(await link.evaluate((a) => a.scrollWidth <= a.clientWidth)).toBe(true);
    }
    // One line: the banner's height is --analyzr-banner-h, and the page does not scroll sideways.
    const fit = await banner.evaluate((b) => {
      const probe = document.createElement('div');
      probe.style.height = 'var(--analyzr-banner-h)';
      document.body.append(probe);
      const expected = probe.getBoundingClientRect().height;
      probe.remove();
      return {
        height: b.getBoundingClientRect().height,
        expected,
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        bannerOverflow: b.scrollWidth > b.clientWidth,
      };
    });
    expect(fit.expected, `--analyzr-banner-h at ${width}px`).toBeGreaterThan(0);
    expect(fit.height, `banner height at ${width}px`).toBe(fit.expected);
    expect(fit.sideways, `horizontal scroll at ${width}px`).toBe(false);
    expect(fit.bannerOverflow, `banner overflow at ${width}px`).toBe(false);
    if (width === 320) await shot(page, '07-phone');
  }
});
