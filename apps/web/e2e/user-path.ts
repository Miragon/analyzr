import { resolve } from 'node:path';

/**
 * A path the user passed in an environment variable, resolved like the CLI
 * does (apps/cli/src/io.ts): `pnpm --filter @analyzr/web e2e` runs Playwright
 * in apps/web and passes the directory pnpm was started in as `INIT_CWD`, so a
 * relative path from the repository root resolves against that, not against
 * apps/web. Outside a package script (plain `npx playwright test`) the working
 * directory is the base. Absolute paths stay as they are.
 */
export function userPath(
  path: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd: string = process.cwd(),
): string {
  const base = env['npm_lifecycle_event'] && env['INIT_CWD'] ? env['INIT_CWD'] : cwd;
  return resolve(base, path);
}
