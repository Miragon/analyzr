import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

import type { SpecCheck } from './spec-harness/harness';

/**
 * Done-when D2 (b) of M6 S3c: in a real browser, bpmn-js's NavigatedViewer imports every model
 * analyzr-spec renders without a warning and draws every participant, lane, flow node, data
 * store, flow, data association and message flow: the golden renders of
 * tools/integrate/test/fixtures/spec and 50 seeded random renders, which
 * tools/integrate/test/spec-fuzz-write.ts writes into this test's temporary folder. The page
 * is `e2e/spec-harness`, served by Vite's dev server from inside this spec, so it needs no
 * analyzr server. CI checks the same models with bpmn-js's tree walker only
 * (tools/integrate/test/spec-bpmnjs.test.ts, D2 a). There is no option for other folders:
 * customer renders never pass through the checkout's test output.
 */

const WEB = resolve(import.meta.dirname, '..');
const REPO = resolve(WEB, '../..');
const GOLDENS = join(REPO, 'tools/integrate/test/fixtures/spec');
const FUZZ_WRITER = join(REPO, 'tools/integrate/test/spec-fuzz-write.ts');
const FUZZ_COUNT = 50;

let server: ViteDevServer;
let url = '';
let cacheDir = '';
let fuzzDir = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  cacheDir = mkdtempSync(join(tmpdir(), 'analyzr-spec-harness-'));
  fuzzDir = mkdtempSync(join(tmpdir(), 'analyzr-spec-fuzz-'));
  execFileSync(process.execPath, [FUZZ_WRITER, fuzzDir, String(FUZZ_COUNT)], { cwd: REPO });
  server = await createServer({
    root: join(WEB, 'e2e/spec-harness'),
    configFile: false,
    cacheDir,
    logLevel: 'warn',
    clearScreen: false,
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  url = server.resolvedUrls?.local[0] ?? '';
  expect(url).not.toBe('');
});

test.afterAll(async () => {
  await server?.close();
  if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  if (fuzzDir) rmSync(fuzzDir, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.specHarness?.ready === true, undefined, {
    timeout: 60_000,
  });
  expect(errors).toEqual([]);
}

/** Every `.bpmn` file of a folder, by name. */
function models(folder: string): { name: string; xml: string }[] {
  return readdirSync(folder)
    .filter((f) => f.endsWith('.bpmn'))
    .sort()
    .map((name) => ({ name, xml: readFileSync(join(folder, name), 'utf8') }));
}

test('every golden render imports without warnings and draws every element', async ({ page }) => {
  await open(page);
  const goldens = models(GOLDENS);
  expect(goldens.length).toBeGreaterThanOrEqual(9);
  for (const { name, xml } of goldens) {
    const result = await page.evaluate((x) => window.specHarness.check(x), xml);
    expect(result, name).toMatchObject({
      warnings: 0,
      errors: 0,
      missing: 0,
    } satisfies Partial<SpecCheck>);
    expect(result.shapes, name).toBeGreaterThan(0);
  }
});

test(`${FUZZ_COUNT} seeded random renders import without warnings and draw every element`, async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  const renders = models(fuzzDir);
  expect(renders).toHaveLength(FUZZ_COUNT);
  for (const { name, xml } of renders) {
    const result = await page.evaluate((x) => window.specHarness.check(x), xml);
    expect(result, name).toMatchObject({
      warnings: 0,
      errors: 0,
      missing: 0,
    } satisfies Partial<SpecCheck>);
  }
});
