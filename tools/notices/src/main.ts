// `pnpm notices`: writes THIRD-PARTY-NOTICES.md at the repository root (src/notices.ts).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { NOTICES_FILE, REPO_ROOT, generateNotices } from './notices.ts';

const file = path.join(REPO_ROOT, NOTICES_FILE);
const text = await generateNotices();
await writeFile(file, text);
console.log(`wrote ${NOTICES_FILE} (${Buffer.byteLength(text, 'utf8')} bytes)`);
