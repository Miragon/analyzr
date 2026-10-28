// `pnpm --filter @analyzr/integrate generate`: writes the bundled scripts and the
// THIRD-PARTY-NOTICES.md of plugins/analyzr-integrate (scripts/bundle.ts), its skill texts and
// the Claude Desktop start prompts (scripts/texts.ts, from tools/integrate/skills/). Run it after
// every change of tools/integrate/src, tools/integrate/skills or a bundled dependency, and
// commit the result; the drift test fails until the files match.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { build, REPO_ROOT } from './bundle.ts';

const { files, packages } = await build();
for (const [file, content] of files) {
  const absolute = path.join(REPO_ROOT, file);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
  console.log(`wrote ${file} (${Buffer.byteLength(content, 'utf8')} bytes)`);
}
console.log(`bundled packages: ${packages.map((p) => `${p.name}@${p.version}`).join(', ')}`);
