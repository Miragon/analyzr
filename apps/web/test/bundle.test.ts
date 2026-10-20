// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterAll, describe, expect, it } from 'vitest';
import { build, type Plugin, type UserConfig } from 'vite';

/**
 * The bundle guard of the value chain page (M4 §5, moved from S0 to S3): two
 * production builds of the web app into memory (as `pnpm build` makes them),
 * reading the module ids of every chunk.
 *
 * 1. One copy each of diagram-js, zod v4 (no zod v3), the renderer and
 *    schema-model in the web chunks.
 * 2. The entry chunk and its static imports hold none of them, nor the chain
 *    page, its components or the step view: those load with their routes;
 *    nor the open-questions page, its components and libs (M6 S4, S5a and
 *    S5c-1, the tab's route chunk and the model view's lazy section, which
 *    also carries the collapsed subprocess's „Verknüpfen mit …“); nor the
 *    model amendments (M6 S5c-2: the amend form with its inline dry run since
 *    UX4, the model view's „Ergänzen“ with its history, the header's badge
 *    and „Mehr“, the change list), which load with the tab and the model
 *    view's own lazy module; the agent work's words and the second click
 *    they share with the „Vorschau“ (`lib/agent-cost.ts`, S2b follow-up)
 *    are in the entry, `amendments.ts` re-exports them.
 *    Of `@analyzr/contracts`, only the zod-free `paths.ts` (the upload's file
 *    rule, M6 S1), `impact-merge.ts` (the „Vorschau“'s merge of its batches,
 *    shared with the CLI, M6 S2b follow-up), `open-question-labels.ts` (M6
 *    S4), `open-question-csv.ts` and `personal-data.ts` (M6 S5a: the answer
 *    sheet's reader and the personal-data check) and `amendment-labels.ts`
 *    (M6 S5c-2), and, for a dropped bundle's manifest (UX8),
 *    `api/import-manifest.ts` with its schema (zod) and the modules it
 *    imports, a dynamic import of its own, are in the bundle; all but
 *    `paths.ts` and `impact-merge.ts` in lazy chunks only.
 *    The entry stays under a gzip ceiling, so a page that slips into it shows.
 * 3. The main CSS has no `.vc-` rule (the renderer's CSS comes with the chunk).
 * 4. Budget: with the diagram-js (+ diagram-js-direct-editing) dependency
 *    closure split into a shared chunk, the code only the chain canvas (and
 *    the import's document check, which shares schema-model and zod with it)
 *    loads is at most 40 KB gzip. It counts the chunks reachable from those
 *    two dynamic imports and from no other entry: the page's route chunk is an
 *    entry of its own, so panels, dialogs and the save logic there do not
 *    count; only what the canvas module itself pulls in does (zod, the
 *    renderer and schema-model take about 35 KB). Raising the budget is an
 *    owner decision.
 */

const WEB = resolve(import.meta.dirname, '..');
const BUDGET = 40 * 1024;
/**
 * The entry chunk with its static imports, gzip (Node's default level): 192.9 KB
 * measured after the S3 review moved the value chain routes out of it, 199.8 KB
 * on 2026-10-10 with the demo banner's legal links, against the former 200 KB.
 * The owner raised the ceiling to 240 KB that day („du kannst die Grenze dann
 * anheben jetzt schon“). Raise it on purpose, with the new measurement, when
 * the app shell grows; that is an owner decision, like the budget above.
 * 207.5 KB after M6 S4 (2026-10-16): the entry's own code grew by under 1 KB
 * (route, tab count, the model view's lazy import). The other ~6 KB is
 * rolldown 1.2 splitting the entry: a new dynamic import whose chunk shares
 * entry modules (plain-text, review, button) moves those modules into extra
 * shared chunks, which gzip separately; either of S4's two lazy imports alone
 * does it (201.5 KB in 2 chunks without both, 206.2 or 207.6 KB with one).
 * Before the next lazy route, `build.rolldownOptions.output.codeSplitting`
 * groups or a newer rolldown may win that back. 207.9 KB after M6 S5c-1
 * (2026-10-17): the toast's action button and the model view's second lazy
 * import of the open-questions section's module (the collapsed subprocess's
 * „Verknüpfen mit …“, same chunk); the action row, its pickers and panels and
 * Radix's dropdown menu (with floating-ui) load with the open-questions
 * chunks only. 208.0 KB after S5c-1's review round: the picker list's
 * truncation hint, now shared with the dynamic call's multi-select. 211.1 KB
 * after M6 S5c-2 (2026-10-17): under 1 KB of entry code (the models table's
 * mark „ergänzt“ and its query, the upload result's amendment counts, the
 * model view's three lazy imports of the amendments module and the canvas's
 * `amended` prop); the rest is rolldown splitting the entry again, from 5
 * chunks into 7, since the amend form and the model view's amendments module
 * share UI modules (field, textarea, permissions) with it.
 * 211.0 KB on 2026-10-18 before UX1 (UX2a changed no entry module). 209.2 KB
 * after UX1 (2026-10-18): the plan's „`codeSplitting` groups come first“
 * (UX-SIMPLIFICATION.md §3.13 item 8) as one group in `vite.config.ts`
 * (`tags: ['$initial']`) that keeps every module the entry loads statically
 * in one chunk, so rolldown no longer splits the entry into 7 separately
 * gzipped chunks (that alone was about 8 KB); UX1's own entry code (the
 * shell's four tabs and „Einstellungen“, „Als Nächstes“, the „Agent starten“
 * popover, the export hub, the light menu, the phase chips and search, the
 * German problem texts, `useProjectCounts`) is about 6 KB of it, measured
 * with the old splitting (217.3 KB in 7 chunks). Lazy modules stay lazy: the
 * group only takes modules the entry already loads. 209.3 KB after UX2b
 * (2026-10-18): the three lazy imports of the open-questions modules from
 * entry screens (the hold's „Antwort geben“ in the „Vorgemerkt“ list and on
 * the review screen, the customer export dialog in the export hub) and the
 * review screen's hold box; the tab itself, its cards, the dialog and the
 * held questions' query load with the open-questions chunks only. 209.8 KB
 * after the first wave's review round (2026-10-18): the tab row scrolled to
 * the active tab with its edge fade, „Offene Punkte“ as text with a tooltip
 * (no links), the hold box's latest answer, „Nochmal versuchen“'s toggle and
 * the key field of „Neues Projekt“; the hold's fallback answer on the
 * relation loads with the open-questions chunks only. 218.1 KB before UX3
 * (UX7's upload panel and connect page, UX8's provenance chip and project
 * source line, S2b's „Vorschau“). 219.8 KB after UX3 (2026-10-18): the canvas
 * panel with its sheet and light tabs, the canvas header, the media query
 * hook and the model view's relation cards and legend; „Mehr“ with its
 * revisions and „Herkunft“ dialog loads with the amendments chunk only.
 * 220.7 KB after UX4: the root's host for „Agent starten“ from a toast and
 * the rule that joins a link and its amendment into one card entry; the
 * pickers, the inline dry run and the removal of „Sammeln“ are lazy.
 * 221.3 KB after UX5 step 1: the views of „Relationen“, the queue's rows and
 * status line, the key tier's bulk dialog and the shared pipeline state.
 * 221.9 KB after UX5 step 2: the review screen on the shared panel (sheet,
 * top bar, stacked panes, the pane chip's info), the closed „Verlauf“.
 * 222.1 KB after UX6 step 1: the canvas header without an area, the chain's
 * „Agent starten“ on `RetryAgent`; the chain's panel, cards and header load
 * with its route chunk. Unchanged after step 2 (the chain on the shared
 * panel and sheet, the way back from „Offene Fragen“).
 * 223.4 KB after UX9: the result views of „Relationen“ („Weitere Filter“ on
 * the light popover, „Entschieden von“ and „Öffnen“ per row, 40 rows a page
 * in the URL, the empty state with „Agent starten“, the review screen walking
 * and returning to a result view), the revoke dialog the review screen loads
 * with the rules' new switch and menus, and the projects list's summary with
 * the shared „Offene Punkte“ cell. 224.1 KB after M6 S2c-1, 225.1 KB after
 * S2c-2 (2026-10-20): the calls line on „Übersicht“ and after „Importieren“,
 * `?bulk=calls` with the bulk dialog's calls group, selection and focus.
 * 226.0 KB after S2c-3 and its review: the bulk accept's offer of a rule
 * for derived calls (`derivedCallSource`, none when a rule names the source),
 * the „Vorschau“ line's rules part, `?new=calls` and the marks of such
 * acceptances; the rule dialog's third „Art“ loads with the rules page.
 * 226.1 KB after S2c-4: the system rule card's line and the dialog „Vor der
 * Vertrauensregel angenommen“ load with the rules page. 226.3 KB after the
 * S2b follow-up's step 1 (2026-10-20): the batches' merge is the contracts'
 * zod-free `impact-merge.ts` (shared with the CLI), with the relations
 * tasks' merge, in place of the web's own. 226.6 KB after its step 2: the
 * merge of the value chain's part (placements, placement task). 227.6 KB
 * after its step 3 (227.4 KB before its review fixes: the batch note's
 * pairs, the lists only with items, a double click arming only): the
 * „Vorschau“'s cost line, its placements line and the two lists in „Was
 * ändert sich?“, the warning for a claimed relations task with the second
 * click („Trotzdem importieren“), in `lib/agent-cost.ts` with the second
 * click the amend form now shares.
 */
const ENTRY_CEILING = 240 * 1024;

interface ChunkInfo {
  fileName: string;
  code: string;
  moduleIds: string[];
  isEntry: boolean;
  isDynamicEntry: boolean;
  facadeModuleId: string | null;
  imports: string[];
  dynamicImports: string[];
  importedCss: string[];
}

interface BuildReport {
  chunks: ChunkInfo[];
  css: Map<string, string>;
}

const outDirs: string[] = [];
afterAll(() => {
  for (const dir of outDirs) rmSync(dir, { recursive: true, force: true });
});

async function buildReport(extra: UserConfig['build'] = {}): Promise<BuildReport> {
  const report: BuildReport = { chunks: [], css: new Map() };
  const collect: Plugin = {
    name: 'analyzr-bundle-report',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') {
          const meta = (item as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata;
          report.chunks.push({
            fileName: item.fileName,
            code: item.code,
            moduleIds: [...item.moduleIds],
            isEntry: item.isEntry,
            isDynamicEntry: item.isDynamicEntry,
            facadeModuleId: item.facadeModuleId,
            imports: [...item.imports],
            dynamicImports: [...item.dynamicImports],
            importedCss: [...(meta?.importedCss ?? [])],
          });
        } else if (item.fileName.endsWith('.css')) {
          report.css.set(
            item.fileName,
            typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source),
          );
        }
      }
    },
  };
  const outDir = mkdtempSync(join(tmpdir(), 'analyzr-web-bundle-'));
  outDirs.push(outDir);
  // vitest sets NODE_ENV=test, which builds React's development code and JSX into the bundle;
  // measure what `pnpm build` ships.
  const nodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  try {
    await build({
      root: WEB,
      configFile: join(WEB, 'vite.config.ts'),
      logLevel: 'silent',
      mode: 'production',
      plugins: [collect],
      build: { outDir, write: false, emptyOutDir: false, ...extra },
    });
  } finally {
    process.env['NODE_ENV'] = nodeEnv;
  }
  return report;
}

/** `node_modules/.pnpm/<name>@<version>/…` directories of a package in module ids. */
function versionsOf(ids: readonly string[], name: string): Set<string> {
  const pattern = new RegExp(`[\\\\/]\\.pnpm[\\\\/]${name.replace('/', '\\+')}@([^\\\\/_]+)`);
  const found = new Set<string>();
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match?.[1]) found.add(match[1]);
  }
  return found;
}

/** Real package directories of `name` and its dependencies, recursively (pnpm layout). */
function closure(from: string, name: string, seen = new Set<string>()): Set<string> {
  const link = join(from, name);
  if (!existsSync(link)) return seen;
  const dir = realpathSync(link);
  if (seen.has(dir)) return seen;
  seen.add(dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  // In pnpm's store a package's dependencies are its siblings in node_modules.
  const siblings = name.includes('/') ? dirname(dirname(dir)) : dirname(dir);
  for (const dep of Object.keys(pkg.dependencies ?? {})) closure(siblings, dep, seen);
  return seen;
}

/** Chunk file names reachable from `start` over static imports. */
function reachable(chunks: readonly ChunkInfo[], start: string): Set<string> {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const out = new Set<string>();
  const walk = (name: string) => {
    if (out.has(name)) return;
    out.add(name);
    for (const next of byName.get(name)?.imports ?? []) walk(next);
  };
  walk(start);
  return out;
}

const isChainEntry = (c: ChunkInfo) =>
  c.isDynamicEntry && (c.facadeModuleId ?? '').endsWith(`canvas${sep}chain-canvas.tsx`);
/**
 * The import's document check (M4 §3.3), loaded by the page before an import:
 * part of the chain code, so what it shares with the canvas (schema-model,
 * zod) still counts as chain-only.
 */
const isChainCheckEntry = (c: ChunkInfo) =>
  c.isDynamicEntry && (c.facadeModuleId ?? '').endsWith(`canvas${sep}check-document.ts`);
const CHAIN_PACKAGES = [
  'zod',
  '@miragon/value-chain-renderer',
  '@miragon/value-chain-schema-model',
  'diagram-js',
];
const isChainModule = (id: string) =>
  CHAIN_PACKAGES.some((name) => versionsOf([id], name).size > 0);
/** The value chain page, its components and the step view (route chunks). */
const isChainPageModule = (id: string) =>
  [
    join(WEB, 'src/routes/value-chain-page.tsx'),
    join(WEB, 'src/routes/value-chain-step-page.tsx'),
    join(WEB, 'src/components/value-chain') + sep,
  ].some((path) => id === path || id.startsWith(path));

/**
 * The open-questions page, its components and libs (M6 S4; S5a: the answer
 * dialogs, `open-question-answers.ts`, `open-question-actions.ts`; S5c-1: the
 * action row, its pickers and panels, `open-question-pickers.ts`, and the
 * collapsed subprocess's „Verknüpfen mit …“ in the model view; UX2b: the
 * customer export dialog and a hold's „Antwort geben“, also loaded lazily by
 * the export hub, the „Vorgemerkt“ list and the review screen): a route
 * chunk and lazy sections.
 */
const isOpenQuestionsModule = (id: string) =>
  [
    join(WEB, 'src/routes/project-open-questions-page.tsx'),
    join(WEB, 'src/components/open-questions') + sep,
    join(WEB, 'src/lib/open-question'),
  ].some((path) => id === path || id.startsWith(path));

/**
 * Model amendments (M6 S5c-2): the amend form, the model view's section,
 * header parts and the change list, and their lib.
 */
const isAmendmentsModule = (id: string) =>
  [join(WEB, 'src/components/amendments') + sep, join(WEB, 'src/lib/amendments.ts')].some(
    (path) => id === path || id.startsWith(path),
  );

describe('web bundle (M4 §5 bundle guard)', { timeout: 120_000 }, () => {
  it('holds one diagram-js and one zod v4, keeps the chain code lazy and its CSS out of the main CSS', async () => {
    const { chunks, css } = await buildReport();
    const ids = chunks.flatMap((c) => c.moduleIds);

    expect(versionsOf(ids, 'diagram-js').size).toBe(1);
    const zod = [...versionsOf(ids, 'zod')];
    expect(zod).toHaveLength(1);
    expect(zod[0]).toMatch(/^4\./);
    expect([...versionsOf(ids, '@miragon/value-chain-renderer')]).toEqual(['0.3.0']);
    expect([...versionsOf(ids, '@miragon/value-chain-schema-model')]).toEqual(['0.3.0']);

    const entry = chunks.find((c) => c.isEntry);
    expect(entry).toBeDefined();
    const main = reachable(chunks, entry?.fileName ?? '');
    const mainModules = chunks.filter((c) => main.has(c.fileName)).flatMap((c) => c.moduleIds);
    expect(mainModules.filter(isChainModule)).toEqual([]);
    // M6 S1, S4 and S5a: the web's runtime imports from the contracts are zod-free: the file
    // rule and (S2b follow-up) the batches' merge (entry), the open questions' labels, the
    // answer sheet's reader and the personal-data check (lazy chunks only).
    const contracts = join(WEB, '../../packages/contracts') + sep;
    const contractsFile = (name: string) => join('..', '..', 'packages', 'contracts', 'src', name);
    const fromContracts = (list: readonly string[]) =>
      [...new Set(list.filter((id) => id.startsWith(contracts)))]
        .map((id) => relative(WEB, id))
        .sort();
    expect(fromContracts(ids)).toEqual(
      [
        contractsFile('amendment-labels.ts'),
        contractsFile('impact-merge.ts'),
        contractsFile('open-question-csv.ts'),
        contractsFile('open-question-labels.ts'),
        contractsFile('paths.ts'),
        contractsFile('personal-data.ts'),
        // UX8: a dropped bundle's manifest, checked with the contracts' own schema (with zod)
        contractsFile('api/import-manifest.ts'),
        contractsFile('api/common.ts'),
        contractsFile('ids.ts'),
        contractsFile('refs.ts'),
        contractsFile('zod-utils.ts'),
      ].sort(),
    );
    // S2b follow-up: the „Vorschau“ merges its batches with the merge the CLI uses.
    expect(fromContracts(mainModules)).toEqual(
      [contractsFile('impact-merge.ts'), contractsFile('paths.ts')].sort(),
    );
    // … loaded with a dynamic import only when a folder has a manifest, never with the entry.
    expect(
      chunks.some(
        (c) =>
          c.isDynamicEntry &&
          (c.facadeModuleId ?? '').endsWith(`contracts${sep}src${sep}api${sep}import-manifest.ts`),
      ),
    ).toBe(true);
    expect(chunks.some(isChainEntry)).toBe(true);
    // The chain page, its panels and the step view load with their routes, not with every page.
    expect(mainModules.filter(isChainPageModule).map((id) => relative(WEB, id))).toEqual([]);
    // M6 S4 and S5a: the tab „Offene Fragen“, the model view's section and the answer
    // dialogs load lazily as well.
    expect(mainModules.filter(isOpenQuestionsModule).map((id) => relative(WEB, id))).toEqual([]);
    // M6 S5c-2: the amendments' form, section, bar and downloads load lazily too; the words of
    // the agent work they share with the „Vorschau“ (S2b follow-up) come with the entry.
    expect(mainModules.filter(isAmendmentsModule).map((id) => relative(WEB, id))).toEqual([]);
    expect(mainModules).toContain(join(WEB, 'src/lib/agent-cost.ts'));
    expect(ids.some(isAmendmentsModule)).toBe(true);
    expect(
      chunks.some(
        (c) =>
          c.isDynamicEntry &&
          (c.facadeModuleId ?? '').endsWith(`amendments${sep}model-amendments.tsx`),
      ),
    ).toBe(true);
    expect(
      ids
        .filter((id) => id.startsWith(join(WEB, 'src/lib/open-question-')))
        .map((id) => relative(WEB, id))
        .sort(),
    ).toEqual([
      'src/lib/open-question-actions.ts',
      'src/lib/open-question-answers.ts',
      'src/lib/open-question-pickers.ts',
    ]);
    expect(
      chunks.some(
        (c) =>
          c.isDynamicEntry &&
          (c.facadeModuleId ?? '').endsWith(`routes${sep}project-open-questions-page.tsx`),
      ),
    ).toBe(true);
    const entryGzip = chunks
      .filter((c) => main.has(c.fileName))
      .reduce((sum, c) => sum + gzipSync(c.code).length, 0);
    console.log(
      `entry chunk and its static imports: ${(entryGzip / 1024).toFixed(1)} KB gzip (ceiling ${ENTRY_CEILING / 1024} KB)`,
    );
    expect(entryGzip).toBeLessThanOrEqual(ENTRY_CEILING);

    const mainCss = chunks
      .filter((c) => main.has(c.fileName))
      .flatMap((c) => c.importedCss)
      .map((file) => css.get(file) ?? '');
    expect(mainCss.length).toBeGreaterThan(0);
    // A rule of the renderer starts its selector with `.vc-`; analyzr's own are scoped (`.analyzr-vc .vc-…`).
    const rendererRule = /(?:^|[{},])\s*\.vc-[a-z]/;
    expect(mainCss.filter((sheet) => rendererRule.test(sheet))).toHaveLength(0);
    const chainCss = chunks.filter(isChainEntry).flatMap((c) => c.importedCss);
    expect(chainCss.some((file) => rendererRule.test(css.get(file) ?? ''))).toBe(true);
  });

  it(`keeps the chain-only code within ${BUDGET / 1024} KB gzip beyond the shared diagram-js code`, async () => {
    const renderer = realpathSync(join(WEB, 'node_modules/@miragon/value-chain-renderer'));
    const from = dirname(dirname(renderer));
    const shared = [...closure(from, 'diagram-js'), ...closure(from, 'diagram-js-direct-editing')];
    expect(shared.length).toBeGreaterThan(3);
    const inShared = (id: string) => shared.some((dir) => id.startsWith(dir + sep));

    const { chunks } = await buildReport({
      rolldownOptions: {
        output: {
          codeSplitting: {
            includeDependenciesRecursively: false,
            groups: [{ name: 'djs', test: (id: string) => inShared(id) }],
          },
        },
      },
    });
    const chain = chunks.find(isChainEntry);
    expect(chain).toBeDefined();
    const check = chunks.find(isChainCheckEntry);
    expect(check).toBeDefined();
    const others = new Set<string>();
    for (const c of chunks) {
      if ((c.isEntry || c.isDynamicEntry) && c !== chain && c !== check)
        for (const name of reachable(chunks, c.fileName)) others.add(name);
    }
    const djs = new Set(
      chunks
        .filter((c) => c.moduleIds.length > 0 && c.moduleIds.every(inShared))
        .map((c) => c.fileName),
    );
    expect(djs.size).toBeGreaterThan(0);
    const only = [
      ...new Set([
        ...reachable(chunks, chain?.fileName ?? ''),
        ...reachable(chunks, check?.fileName ?? ''),
      ]),
    ]
      .filter((name) => !others.has(name) && !djs.has(name))
      .map((name) => chunks.find((c) => c.fileName === name))
      .filter((c): c is ChunkInfo => c !== undefined);
    // No diagram-js module may hide in the counted chunks (it would be counted twice or not at all).
    expect(only.flatMap((c) => c.moduleIds).filter(inShared)).toEqual([]);

    const sizes = only.map((c) => ({ chunk: c.fileName, gzip: gzipSync(c.code).length }));
    const total = sizes.reduce((sum, s) => sum + s.gzip, 0);
    const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
    console.log(
      [
        `chain-only code: ${kb(total)} gzip (budget ${kb(BUDGET)})`,
        ...sizes.map((s) => `  ${s.chunk}: ${kb(s.gzip)}`),
        `shared diagram-js chunk(s): ${[...djs]
          .map((name) => kb(gzipSync(chunks.find((c) => c.fileName === name)?.code ?? '').length))
          .join(', ')}`,
      ].join('\n'),
    );
    expect(total).toBeLessThanOrEqual(BUDGET);
  });
});
