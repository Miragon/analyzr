// Writes the renders of seeded random specs (spec-fuzz.ts) into a folder, for the browser check
// of apps/web/e2e/spec-render-import.spec.ts (M6 S3c done-when D2 b):
//   node tools/integrate/test/spec-fuzz-write.ts <empty folder> [count]
// Synthetic only: the specs come from the seeds, never from a customer or the eval corpus.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { renderSpec } from '../src/spec/render.ts';
import { validateSpec } from '../src/spec/validate.ts';

import { fuzzSpec } from './spec-fuzz.ts';

const [folder, countArg = '50'] = process.argv.slice(2);
const count = Number.parseInt(countArg, 10);
if (folder === undefined || !Number.isSafeInteger(count) || count < 1) {
  process.stderr.write('usage: node spec-fuzz-write.ts <empty folder> [count]\n');
  process.exit(2);
}
await mkdir(folder, { recursive: true });
if ((await readdir(folder)).length > 0) {
  process.stderr.write(`${folder} is not empty\n`);
  process.exit(2);
}
for (let seed = 0; seed < count; seed++) {
  const fuzz = fuzzSpec(seed);
  const { spec, errors } = validateSpec(fuzz.value, { origin: fuzz.origin });
  if (spec === null) throw new Error(`seed ${seed}: ${JSON.stringify(errors)}`);
  const { xml } = await renderSpec(spec, { key: `fuzz/s-${seed}` });
  await writeFile(path.join(folder, `fuzz-${String(seed).padStart(3, '0')}.bpmn`), xml);
}
process.stdout.write(`${count} renders in ${folder}\n`);
