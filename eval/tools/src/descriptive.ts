// eval:descriptive (M6 §3.11, S3a): how much of the LLM-free relation finding
// survives descriptive, tool-style models.
//
//   pnpm eval:descriptive           (from the repository root)
//   node src/descriptive.ts [--out <dir>] [--no-write] [landscape ...]
//
// For every scored landscape: transform the models with the cumulative
// variants of lib/descriptive.mjs (engine-stripped, descriptive, pools,
// tasks, no-docs; the context from the unchanged models' facts, never from
// expected.yaml), extract the facts of each variant (an extractor warning is
// an error), run the rule tier and the candidate generation, score them
// against expected.yaml (src/score.ts), estimate each model's claim input
// (src/claim-estimate.ts) and write eval/reports/descriptive.{md,json}. The
// holdout appears in aggregate only (descriptive-score.ts `redactDescriptive`);
// the console prints whole-landscape numbers only. Report only, no threshold.
// Exit codes: 0 written; 1 a transform or the extraction failed (an extractor
// warning included); 2 a usage error.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { VARIANTS, transformModel } from '../lib/descriptive.mjs';
import { REPORTS_DIR } from './candidates.ts';
import { CORPUS_DIR, listScoredLandscapes } from './corpus.ts';
import { CLAIM_BUDGET_BYTES } from './claim-estimate.ts';
import { transformContexts } from './descriptive-context.ts';
import { ASSUMPTIONS, FACTS_EFFECTS, renderDescriptiveMarkdown, type DescriptiveReport } from './descriptive-report.ts';
import {
  redactDescriptive,
  scoreVariant,
  type LandscapeDescriptive,
  type VariantModel,
  type VariantName,
  type VariantResult,
} from './descriptive-score.ts';
import { loadLandscape } from './landscape.ts';

export const USAGE = 'usage: pnpm eval:descriptive [--out <dir>] [--no-write] [landscape ...]\n';

/** The report order: the unchanged models, then the cumulative variants. */
export const REPORT_VARIANTS: readonly VariantName[] = ['baseline', ...VARIANTS];

/** A transform produced BPMN the extractor warns about, or could not run. */
export class DescriptiveError extends Error {
  override readonly name = 'DescriptiveError';
}

/** Every variant's models of a landscape (the transforms' output, in memory only). */
export async function landscapeVariants(dir: string): Promise<{
  loaded: Awaited<ReturnType<typeof loadLandscape>>;
  variants: Map<VariantName, VariantModel[]>;
}> {
  const loaded = await loadLandscape(dir);
  const contexts = transformContexts(loaded.facts);
  const variants = new Map<VariantName, VariantModel[]>(REPORT_VARIANTS.map((v) => [v, []]));
  for (const m of loaded.models) {
    variants.get('baseline')?.push({ key: m.key, xml: m.xml });
    const ctx = contexts.get(m.key) ?? { callees: {}, messages: {} };
    let out;
    try {
      out = await transformModel(m.xml, ctx);
    } catch (err) {
      throw new DescriptiveError(`${loaded.meta.name}/${m.key}: transform failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const v of VARIANTS) variants.get(v)?.push({ key: m.key, xml: out[v] });
  }
  return { loaded, variants };
}

/** Scores one landscape in every variant (unredacted). */
export async function evaluateLandscape(dir: string): Promise<LandscapeDescriptive> {
  const { loaded, variants } = await landscapeVariants(dir);
  const results: VariantResult[] = [];
  const tags = new Map<string, { mustLink: number; covered: number[] }>();
  for (const name of REPORT_VARIANTS) {
    const { result, byTag } = await scoreVariant(name, loaded.meta, loaded.expected, variants.get(name) ?? []);
    if (result.warnings > 0) {
      throw new DescriptiveError(`${loaded.meta.name}, variant ${name}: ${result.warnings} extractor warnings`);
    }
    results.push(result);
    for (const [tag, g] of byTag) {
      const row = tags.get(tag) ?? { mustLink: g.mustLink, covered: [] };
      row.covered.push(g.covered);
      tags.set(tag, row);
    }
  }
  const byTag = [...tags.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([tag, g]) => ({ tag, mustLink: g.mustLink, covered: g.covered }));
  return {
    name: loaded.meta.name,
    split: loaded.meta.split,
    models: loaded.models.length,
    variants: results,
    ...(loaded.meta.split === 'dev' ? { byTag } : {}),
  };
}

/** The report over the given landscapes (default: every scored landscape), the holdout redacted. */
export async function evaluateDescriptive(names?: readonly string[], corpusDir: string = CORPUS_DIR): Promise<DescriptiveReport> {
  const landscapes = names && names.length > 0 ? [...names] : await listScoredLandscapes(corpusDir);
  const out: LandscapeDescriptive[] = [];
  for (const name of landscapes) out.push(redactDescriptive(await evaluateLandscape(path.join(corpusDir, name))));
  return {
    variants: [...REPORT_VARIANTS],
    budgetBytes: CLAIM_BUDGET_BYTES,
    assumptions: [...ASSUMPTIONS],
    factsEffects: [...FACTS_EFFECTS],
    landscapes: out,
  };
}

const show = (c: number | string): string => String(c);

async function main(): Promise<number> {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      options: {
        out: { type: 'string', default: REPORTS_DIR },
        'no-write': { type: 'boolean', default: false },
      },
      allowPositionals: true,
    }));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return 2;
  }
  let report: DescriptiveReport;
  try {
    report = await evaluateDescriptive(positionals);
  } catch (err) {
    if (!(err instanceof DescriptiveError)) throw err;
    process.stderr.write(`eval:descriptive: ${err.message}\n`);
    return 1;
  }
  for (const l of report.landscapes) {
    console.log(`${l.name} (${l.split}), ${l.models} models`);
    for (const v of l.variants) {
      console.log(
        `  ${v.variant.padEnd(16)} must_link in rules ∪ candidates ${show(v.mustLink.covered)}/${v.mustLink.total}, ` +
          `rule-tier accepted ${v.ruleTier.accepted} (under 24.2: ${v.ruleTier.acceptedUnderTrustPolicy}), ` +
          `candidates ${v.candidates.total}, claim max ${(v.claim.maxBytes / 1024).toFixed(1)} KB`,
      );
    }
  }
  if (!values['no-write']) {
    // Relative to where pnpm was started (INIT_CWD, the repository root), like the other eval commands.
    const cwd = process.env['INIT_CWD'] ?? process.cwd();
    const out = path.resolve(cwd, values.out);
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'descriptive.md'), renderDescriptiveMarkdown(report));
    await writeFile(path.join(out, 'descriptive.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report: ${path.relative(cwd, path.join(out, 'descriptive.md'))}`);
  }
  console.log('eval:descriptive: written (report only, no threshold)');
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
