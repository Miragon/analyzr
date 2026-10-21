import { rm } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CLI_MAIN } from '../../src/cli-main.ts';
import { NO_STDIO_BRIDGE, parseExpiry, parseScopes } from '../../src/commands/token.ts';
import { buildPluginProgram } from '../../src/core-program.ts';
import type { CliIo } from '../../src/io.ts';
import { runCli } from '../../src/program.ts';
import { OWNER_KEY, fakeApi, json, ownerKeyFile, problem, tempDir, testIo } from '../support/io.ts';

let dir: string;
let keyFile: string;

beforeAll(async () => {
  dir = await tempDir();
  keyFile = await ownerKeyFile(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SECRET = `analyzr_at_${'s'.repeat(49)}`;

function created(scopes: string[]) {
  return {
    id: 'agt_01J9Z3N4X5Q6R7S8T9V0W1X2Y3',
    name: 'claude',
    prefix: 'ssssssss',
    scopes,
    expiresAt: '2027-01-05T00:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
    createdAt: '2026-10-07T00:00:00.000Z',
    secret: SECRET,
  };
}

describe('parseScopes / parseExpiry', () => {
  it('accepts full and short scope names, lists and duplicates', () => {
    expect(parseScopes(['analyzr:read'])).toEqual(['analyzr:read']);
    expect(parseScopes(['read,propose', 'analyzr:read'])).toEqual([
      'analyzr:read',
      'analyzr:propose',
    ]);
    expect(parseScopes(['write', 'read'])).toEqual(['analyzr:read', 'analyzr:write']);
    expect(() => parseScopes(['analyzr:review'])).toThrow(/unknown scope/);
    expect(() => parseScopes([','])).toThrow(/at least one/);
  });

  it('reads days and weeks within 1–365 days', () => {
    expect(parseExpiry('90d')).toBe(90);
    expect(parseExpiry('90')).toBe(90);
    expect(parseExpiry('12w')).toBe(84);
    expect(parseExpiry('365D')).toBe(365);
    for (const bad of ['0d', '366d', '53w', '1y', 'soon', '']) {
      expect(() => parseExpiry(bad), bad).toThrow(/invalid expiry/);
    }
  });
});

describe('analyzr token create', () => {
  it('creates a token as the owner and prints the secret with client configurations', async () => {
    const api = fakeApi({
      'POST /api/v1/projects/nordwind-handel/agent-tokens': async (req) => {
        const body = (await req.json()) as { scopes: string[] };
        return json(created(body.scopes), 201);
      },
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch);
    const code = await runCli(
      [
        'token',
        'create',
        '--project',
        'nordwind-handel',
        '--name',
        'claude',
        '--scopes',
        'analyzr:read',
        'propose',
        '--expires',
        '30d',
      ],
      t.io,
    );
    expect(t.err()).toBe('');
    expect(code).toBe(0);
    expect(api.seen).toHaveLength(1);
    expect(api.seen[0]?.authorization).toBe(`Bearer ${OWNER_KEY}`);
    expect(await api.seen[0]?.body.json()).toEqual({
      name: 'claude',
      scopes: ['analyzr:read', 'analyzr:propose'],
      expiresInDays: 30,
    });

    const out = t.out();
    expect(out).toContain(`\n${SECRET}\n`);
    expect(out).toContain('shown only now');
    expect(out).toContain(
      `claude mcp add --transport http analyzr http://127.0.0.1:7400/mcp --header "Authorization: Bearer ${SECRET}"`,
    );
    // Claude Desktop: absolute node and CLI paths (no shell PATH), env carries URL and token.
    const desktop = JSON.parse(out.slice(out.indexOf('{'))) as {
      mcpServers: { analyzr: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(desktop.mcpServers.analyzr).toEqual({
      command: process.execPath,
      args: [CLI_MAIN, 'mcp'],
      env: { ANALYZR_URL: 'http://127.0.0.1:7400', ANALYZR_TOKEN: SECRET },
    });
    expect(out).not.toContain(OWNER_KEY);
  });

  it('prints a docker exec bridge for Claude Desktop inside the container', async () => {
    const api = fakeApi({
      'POST /api/v1/projects/p/agent-tokens': () => json(created(['analyzr:read']), 201),
    });
    const t = testIo(
      { ANALYZR_OWNER_KEY_FILE: keyFile, ANALYZR_CONTAINER: 'analyzr-server-1' },
      api.fetch,
    );
    expect(await runCli(['token', 'create', '-p', 'p'], t.io)).toBe(0);
    const out = t.out();
    const desktop = JSON.parse(out.slice(out.indexOf('{'))) as {
      mcpServers: { analyzr: unknown };
    };
    expect(out).toContain('replace "docker" with its');
    expect(desktop.mcpServers.analyzr).toEqual({
      command: 'docker',
      args: ['exec', '-i', '-e', 'ANALYZR_TOKEN', 'analyzr-server-1', 'analyzr', 'mcp'],
      env: { ANALYZR_TOKEN: SECRET },
    });
    // Defaults: read + propose for 90 days.
    expect(await api.seen[0]?.body.json()).toEqual({
      name: 'agent',
      scopes: ['analyzr:read', 'analyzr:propose'],
      expiresInDays: 90,
    });
  });

  it('names no file of a missing mcp in the plugin’s bundled CLI (M6 S3c): the Claude Code command and where the bridge is', async () => {
    const plugin = (io: CliIo) => buildPluginProgram(io, '/opt/plugin/scripts/analyzr.mjs');
    const api = fakeApi({
      'POST /api/v1/projects/p/agent-tokens': () => json(created(['analyzr:read']), 201),
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch);
    expect(await runCli(['token', 'create', '-p', 'p'], t.io, plugin)).toBe(0);
    const out = t.out();
    expect(out).toContain(`\n${SECRET}\n`);
    expect(out).toContain(
      `  claude mcp add --transport http analyzr http://127.0.0.1:7400/mcp --header "Authorization: Bearer ${SECRET}"\n\n${NO_STDIO_BRIDGE}\n`,
    );
    expect(NO_STDIO_BRIDGE).toBe(
      "Claude Desktop: the stdio bridge needs analyzr mcp from an analyzr checkout or the container (docs/DEVELOPMENT.md); the plugin's analyzr.mjs has no mcp",
    );
    expect(out).not.toContain('main.ts');
    expect(out).not.toContain('claude_desktop_config.json');
    expect(out).not.toContain('{');

    // inside the container the docker exec bridge names no file of the plugin either
    const container = testIo(
      { ANALYZR_OWNER_KEY_FILE: keyFile, ANALYZR_CONTAINER: 'analyzr-server-1' },
      api.fetch,
    );
    expect(await runCli(['token', 'create', '-p', 'p'], container.io, plugin)).toBe(0);
    const desktop = JSON.parse(container.out().slice(container.out().indexOf('{'))) as {
      mcpServers: { analyzr: unknown };
    };
    expect(desktop.mcpServers.analyzr).toEqual({
      command: 'docker',
      args: ['exec', '-i', '-e', 'ANALYZR_TOKEN', 'analyzr-server-1', 'analyzr', 'mcp'],
      env: { ANALYZR_TOKEN: SECRET },
    });
  });

  it('--json prints only the token', async () => {
    const api = fakeApi({
      'POST /api/v1/projects/p/agent-tokens': () => json(created(['analyzr:read']), 201),
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch);
    expect(await runCli(['token', 'create', '-p', 'p', '--json'], t.io)).toBe(0);
    expect(JSON.parse(t.out())).toMatchObject({ secret: SECRET, scopes: ['analyzr:read'] });
  });

  it('rejects invalid input before calling the server', async () => {
    const api = fakeApi({});
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch);
    expect(await runCli(['token', 'create', '-p', 'p', '--scopes', 'analyzr:review'], t.io)).toBe(
      1,
    );
    expect(t.err()).toContain('unknown scope');
    expect(await runCli(['token', 'create', '-p', 'p', '--expires', '2y'], t.io)).toBe(1);
    expect(t.err()).toContain('invalid expiry');
    expect(api.seen).toEqual([]);
  });

  it('needs the owner key and reports server problems', async () => {
    const none = testIo({ ANALYZR_OWNER_KEY_FILE: `${dir}/missing` });
    expect(await runCli(['token', 'create', '-p', 'p'], none.io)).toBe(1);
    expect(none.err()).toContain('no owner key');

    const api = fakeApi({
      'POST /api/v1/projects/p/agent-tokens': () =>
        problem(404, 'not-found', 'project p not found'),
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch);
    expect(await runCli(['token', 'create', '-p', 'p'], t.io)).toBe(1);
    expect(t.err()).toContain(
      'create an agent token in p failed (404 not-found): project p not found',
    );
  });
});

describe('analyzr token list / revoke', () => {
  it('lists tokens without secrets and revokes by id', async () => {
    const { secret: _secret, ...token } = created(['analyzr:read']);
    const api = fakeApi({
      'GET /api/v1/projects/p/agent-tokens': () => json({ items: [token] }),
      'DELETE /api/v1/projects/p/agent-tokens/agt_01J9Z3N4X5Q6R7S8T9V0W1X2Y3': () =>
        new Response(null, { status: 204 }),
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch);
    expect(await runCli(['token', 'list', '-p', 'p'], t.io)).toBe(0);
    expect(t.out()).toContain('agt_01J9Z3N4X5Q6R7S8T9V0W1X2Y3  analyzr_at_ssssssss…  claude');
    expect(t.out()).toContain('never used');
    expect(
      await runCli(['token', 'revoke', 'agt_01J9Z3N4X5Q6R7S8T9V0W1X2Y3', '-p', 'p'], t.io),
    ).toBe(0);
    expect(t.out()).toContain('revoked agt_01J9Z3N4X5Q6R7S8T9V0W1X2Y3');
    expect(api.seen.map((s) => s.method)).toEqual(['GET', 'DELETE']);
  });
});
