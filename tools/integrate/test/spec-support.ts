// Shared fixtures and helpers of the analyzr-spec tests (M6 S3c §3.7).
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { renderSpec, type RenderResult } from '../src/spec/render.ts';
import type { Spec, SpecOrigin } from '../src/spec/types.ts';
import { validateSpec } from '../src/spec/validate.ts';
import { parseSpecBytes } from '../src/spec/yaml.ts';

import { fuzzSpec, type FuzzSpec } from './spec-fuzz.ts';
import { PACKAGE_ROOT } from './support.ts';

/** The golden fixtures (test/fixtures/spec/README.md). */
export const SPEC_FIXTURES = path.join(PACKAGE_ROOT, 'test/fixtures/spec');

/** Each golden fixture and how it is read: as a spec the agent wrote or as converter output. */
export const GOLDENS: readonly { name: string; origin: SpecOrigin }[] = [
  { name: 'minimal', origin: 'hand' },
  { name: 'lanes-gateways', origin: 'hand' },
  { name: 'collaboration', origin: 'converter' },
  { name: 'unnamed-messages', origin: 'hand' },
  { name: 'calls-and-stores', origin: 'hand' },
  { name: 'long-texts', origin: 'hand' },
  { name: 'converter-loose', origin: 'converter' },
  { name: 'reconstructed', origin: 'hand' },
  { name: 'as-told', origin: 'hand' },
];

/** The key a golden is rendered with. */
export const goldenKey = (name: string): string => `beispiel/${name}`;

/** How many seeded random specs the tests render. */
export const FUZZ_COUNT = 200;

/** A spec value as YAML or JSON would give it, validated; throws with every error. */
export function specOf(value: unknown, origin: SpecOrigin, label = 'spec'): Spec {
  const result = validateSpec(value, { origin });
  if (result.spec === null) {
    throw new Error(
      `${label} is invalid:\n${result.errors.map((e) => `${e.path}: ${e.message}`).join('\n')}`,
    );
  }
  return result.spec;
}

/** Reads a spec file of the fixtures. */
export async function readFixture(file: string): Promise<unknown> {
  const parsed = parseSpecBytes(new Uint8Array(await readFile(path.join(SPEC_FIXTURES, file))));
  if (parsed.errors.length > 0) {
    throw new Error(`${file}: ${parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return parsed.value;
}

/** A golden fixture's spec. */
export async function goldenSpec(name: string): Promise<Spec> {
  const golden = GOLDENS.find((g) => g.name === name);
  return specOf(await readFixture(`${name}.spec.yaml`), golden?.origin ?? 'hand', name);
}

/** A golden fixture rendered as its golden file is. */
export async function renderGolden(name: string): Promise<RenderResult> {
  return renderSpec(await goldenSpec(name), { key: goldenKey(name) });
}

/** A seeded random spec, validated and rendered; throws with the spec when anything fails. */
export async function renderFuzz(
  seed: number,
): Promise<{ fuzz: FuzzSpec; spec: Spec; result: RenderResult }> {
  const fuzz = fuzzSpec(seed);
  try {
    const spec = specOf(fuzz.value, fuzz.origin, `fuzz seed ${seed}`);
    const result = await renderSpec(spec, { key: `fuzz/s-${seed}` });
    return { fuzz, spec, result };
  } catch (err) {
    throw new Error(
      `${err instanceof Error ? err.message : String(err)}\nseed ${seed} (${fuzz.origin}):\n${JSON.stringify(fuzz.value)}`,
      { cause: err },
    );
  }
}
