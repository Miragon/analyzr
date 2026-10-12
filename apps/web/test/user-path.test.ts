import { describe, expect, it } from 'vitest';

import { userPath } from '../e2e/user-path';

// `ANALYZR_E2E_VC_EXTRA=eval/value-chains/…` (HANDOFF, the holdout import
// check) is given from the repository root while pnpm runs Playwright in
// apps/web.
describe('userPath (e2e paths from environment variables)', () => {
  const ROOT = '/repo';
  const WEB = '/repo/apps/web';
  const chain = 'eval/value-chains/nordwind-handel/value-chain.vc.json';

  it('resolves against the directory pnpm was started in under a package script', () => {
    const env = { npm_lifecycle_event: 'e2e', INIT_CWD: ROOT };
    expect(userPath(chain, env, WEB)).toBe(`${ROOT}/${chain}`);
  });

  it('resolves against the working directory outside a package script', () => {
    expect(userPath(chain, { INIT_CWD: ROOT }, WEB)).toBe(`${WEB}/${chain}`);
    expect(userPath(chain, {}, ROOT)).toBe(`${ROOT}/${chain}`);
  });

  it('keeps an absolute path', () => {
    const env = { npm_lifecycle_event: 'e2e', INIT_CWD: ROOT };
    expect(userPath('/elsewhere/chain.vc.json', env, WEB)).toBe('/elsewhere/chain.vc.json');
  });
});
