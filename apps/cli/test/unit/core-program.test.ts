// M6 S3c step 3: the core program both CLIs share. The plugin's bundled CLI has every command
// of the checkout's but `seed` and `mcp`, the same help, next steps naming the command that runs
// it, and the owner key only for analyzr on this machine; the parse guard holds in both.
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CLI_COMMAND, formatImpact, ruleStep } from '../../src/commands/import.ts';
import {
  buildPluginProgram,
  nodeCommand,
  PLUGIN_DESCRIPTION,
  pluginCommand,
} from '../../src/core-program.ts';
import { keepOwnerKeyLocal } from '../../src/credentials.ts';
import type { CliIo } from '../../src/io.ts';
import { buildProgram, runCli } from '../../src/program.ts';
import { commandTree, helpTexts } from '../support/help.ts';
import {
  AGENT_TOKEN,
  OWNER_KEY,
  fakeApi,
  json,
  ownerKeyFile,
  tempDir,
  testIo,
} from '../support/io.ts';
import {
  NAMED_COMMANDS,
  fakeImpact,
  nextStepRoutes,
  writeNextStepBundle,
} from '../support/next-steps.ts';

const SCRIPT = '/Users/berater/.claude/plugins/analyzr integrate/scripts/analyzr.mjs';
const COMMAND = "node '/Users/berater/.claude/plugins/analyzr integrate/scripts/analyzr.mjs'";
/** What the plugin's next steps name for analyzr at its default URL. */
const AT_DEFAULT = `${COMMAND} --url http://127.0.0.1:7400`;
const plugin = (io: CliIo): Command => buildPluginProgram(io, SCRIPT);

let dir: string;
let keyFile: string;

beforeAll(async () => {
  dir = await tempDir();
  keyFile = await ownerKeyFile(dir);
  await writeNextStepBundle(path.join(dir, 'bundle'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/**
 * What `entry` imports statically, transitively: the CLI's own modules (relative to src/) and
 * the packages (bare specifiers, never followed).
 */
async function importGraph(entry: string): Promise<{ modules: string[]; packages: string[] }> {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const queue = [path.join(SRC, entry)];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (modules.has(file)) continue;
    modules.add(file);
    if (!file.endsWith('.ts')) continue;
    const text = await readFile(file, 'utf8');
    for (const [, spec = ''] of text.matchAll(
      /(?:\bfrom\s+|^import\s+|\bimport\(\s*)'([^']+)'/gm,
    )) {
      if (spec.startsWith('.')) queue.push(path.resolve(path.dirname(file), spec));
      else packages.add(spec);
    }
  }
  return {
    modules: [...modules].map((m) => path.relative(SRC, m)).sort(),
    packages: [...packages].sort(),
  };
}

/** The help sections of {@link helpTexts}, by command path. */
function sections(program: Command): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of helpTexts(program).split(/^## /m).slice(1)) {
    const at = part.indexOf('\n');
    map.set(part.slice(0, at), part.slice(at));
  }
  return map;
}

describe('the core program', () => {
  it('has every command of the checkout but seed and mcp, each with the same help', () => {
    const full = sections(buildProgram(testIo().io));
    const core = sections(plugin(testIo().io));
    expect([...core.keys()]).toEqual(
      [...full.keys()].filter((p) => p !== 'analyzr mcp' && p !== 'analyzr seed'),
    );
    for (const [at, text] of core) {
      if (at !== 'analyzr') expect(text.trimEnd(), at).toBe(full.get(at)?.trimEnd());
    }
    const root = core.get('analyzr') ?? '';
    expect(root.replace(/\s+/g, ' ')).toContain(PLUGIN_DESCRIPTION);
    expect(root).not.toMatch(/^ {2}(seed|mcp)\b/m);
    for (const { command } of commandTree(plugin(testIo().io)).slice(1)) {
      if (command.parent?.parent === null)
        expect(root).toMatch(new RegExp(`^  ${command.name()}`, 'm'));
    }
  });

  it('the plugin’s entry imports neither seed nor mcp, nor any package but these', async () => {
    const plugin = await importGraph('plugin-main.ts');
    expect(plugin.modules).toContain('core-program.ts');
    expect(plugin.modules).toContain('commands/import.ts');
    const away = ['main.ts', 'program.ts', 'cli-main.ts', 'commands/seed.ts', 'commands/mcp.ts'];
    for (const module of [...away, 'mcp-bridge.ts']) expect(plugin.modules).not.toContain(module);
    // the bundle's packages (step 4's notices): a new one is a decision, not an accident
    expect(plugin.packages.filter((p) => !p.startsWith('node:'))).toEqual([
      '@analyzr/client',
      '@analyzr/contracts',
      '@analyzr/contracts/impact-merge',
      'commander',
    ]);
    // the walk sees what the checkout's entry brings
    const checkout = await importGraph('main.ts');
    expect(checkout.modules).toEqual(expect.arrayContaining([...away, 'mcp-bridge.ts']));
    expect(checkout.packages).toEqual(
      expect.arrayContaining(['@modelcontextprotocol/client', 'yaml']),
    );
  });

  it('names `node <script>`, the script shell-quoted, and always --url, also the default', () => {
    expect(nodeCommand(SCRIPT)).toBe(COMMAND);
    expect(nodeCommand('/opt/plugins/scripts/analyzr.mjs')).toBe(
      'node /opt/plugins/scripts/analyzr.mjs',
    );
    expect(pluginCommand(SCRIPT, 'http://127.0.0.1:7400')).toBe(AT_DEFAULT);
    expect(pluginCommand(SCRIPT, 'http://localhost:7400')).toBe(
      `${COMMAND} --url http://localhost:7400`,
    );
    expect(pluginCommand(SCRIPT, "http://127.0.0.1:7500/a b'c")).toBe(
      `${COMMAND} --url 'http://127.0.0.1:7500/a b'\\''c'`,
    );
    expect(CLI_COMMAND).toBe('analyzr');
  });

  it('prints the version of the root package.json', async () => {
    const t = testIo();
    expect(await runCli(['--version'], t.io, plugin)).toBe(0);
    expect(t.out()).toMatch(/^0\.1\.0/);
  });
});

describe('the next steps of an import (commandName)', () => {
  /** The import of the next-step bundle with `build`, its text output. */
  async function importText(
    build: (io: CliIo) => Command,
    globals: string[] = [],
    env: Record<string, string> = {},
  ): Promise<string> {
    const api = fakeApi(nextStepRoutes('kunde-x'));
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile, ...env }, api.fetch, { cwd: dir });
    expect(
      await runCli(
        [...globals, 'import', 'bundle', '-p', 'kunde-x', '--create', '--name', 'Kunde X'],
        t.io,
        build,
      ),
    ).toBe(0);
    expect(t.err()).toBe('');
    return t.out();
  }

  it('name the command that runs the CLI in every step; the rest of the text is the same', async () => {
    const checkout = await importText(buildProgram);
    const bundled = await importText(plugin);
    for (const sub of NAMED_COMMANDS.filter((c) => c !== 'status')) {
      expect(checkout, sub).toContain(`analyzr ${sub} `);
      expect(bundled, sub).toContain(`${AT_DEFAULT} ${sub} `);
    }
    // no step names a command the consultant cannot run
    expect(bundled).not.toMatch(new RegExp(`analyzr (${NAMED_COMMANDS.join('|')}) `));
    expect(bundled).toContain(
      "other clients: the start prompts in examples/agents (in analyzr's repository); a token:",
    );
    expect(checkout).toContain('other clients: the start prompts in examples/agents; a token:');
    expect(
      bundled.replaceAll(AT_DEFAULT, 'analyzr').replaceAll(" (in analyzr's repository)", ''),
    ).toBe(checkout);
  });

  it('carry the --url of the run in the plugin, also the default, so they reach the same analyzr', async () => {
    const checkout = await importText(buildProgram);
    for (const [globals, env, url] of [
      [['--url', 'http://localhost:7500/'], {}, 'http://localhost:7500'],
      [[], { ANALYZR_URL: 'http://[::1]:7500' }, "'http://[::1]:7500'"],
      [[], {}, 'http://127.0.0.1:7400'],
      // the default named on the command line while the shell names another analyzr: a step
      // run in that shell must still reach this one
      [
        ['--url', 'http://127.0.0.1:7400'],
        { ANALYZR_URL: 'http://localhost:7500' },
        'http://127.0.0.1:7400',
      ],
    ] as const) {
      const bundled = await importText(plugin, [...globals], env);
      for (const sub of NAMED_COMMANDS.filter((c) => c !== 'status')) {
        expect(bundled, sub).toContain(`${COMMAND} --url ${url} ${sub} `);
      }
      expect(bundled.split(COMMAND).length).toBe(bundled.split(`${COMMAND} --url ${url} `).length);
      // the checkout's steps stay as they are (the skill adds --url)
      expect(await importText(buildProgram, [...globals], env)).not.toContain('--url');
      expect(
        bundled
          .replaceAll(`${COMMAND} --url ${url}`, 'analyzr')
          .replaceAll(" (in analyzr's repository)", '')
          .replaceAll(url.replace(/^'|'$/g, ''), 'http://127.0.0.1:7400'),
      ).toBe(checkout);
    }
  });

  it('name it in the owner rule steps that apply or turn on a rule', () => {
    const rule = {
      id: 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y1' as const,
      name: 'Aufrufe: Export ohne Engine',
      enabled: true,
      proposedBy: 'rule' as const,
      derivedKind: 'export' as const,
      converter: null,
    };
    const exported = { derivedKind: 'export' as const, converter: null };
    expect(ruleStep('demo', exported, [rule], COMMAND)).toBe(
      `  or let the owner rule "Aufrufe: Export ohne Engine" accept them: ${COMMAND} rules apply aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y1 -p demo`,
    );
    expect(ruleStep('demo', exported, [{ ...rule, enabled: false }], COMMAND)).toBe(
      `  or turn on the owner rule "Aufrufe: Export ohne Engine" for that source: ${COMMAND} rules enable aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y1 -p demo`,
    );
  });

  it('name it in the hint of status for an analyzr without projects, without seed', async () => {
    const routes = {
      'GET /health': () => json({ status: 'ok', version: '1', db: 'ok' }),
      'GET /api/v1/me': () =>
        json({
          principalId: 'prn_1',
          kind: 'user',
          handle: 'owner',
          authMode: 'local',
          clientId: 'analyzr-cli',
        }),
      'GET /api/v1/projects': () => json({ items: [], nextCursor: null }),
    };
    const status = async (build: (io: CliIo) => Command, globals: string[] = []) => {
      const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, fakeApi(routes).fetch);
      expect(await runCli([...globals, 'status'], t.io, build)).toBe(0);
      return t.out().trimEnd().split('\n').at(-1);
    };
    expect(await status(buildProgram)).toBe(
      'no projects yet: analyzr seed, or analyzr import <dir> --project <key> --create',
    );
    expect(await status(plugin)).toBe(
      `no projects yet: ${AT_DEFAULT} import <dir> --project <key> --create`,
    );
    expect(await status(plugin, ['--url', 'http://localhost:7500'])).toBe(
      `no projects yet: ${COMMAND} --url http://localhost:7500 import <dir> --project <key> --create`,
    );
  });

  it('name it in the batch line of a dry run too', () => {
    expect(formatImpact(fakeImpact(['a']), 'demo', 2, COMMAND)).toContain(
      `(after the import, the waiting line and ${COMMAND} status count them)`,
    );
    expect(formatImpact(fakeImpact(['a']), 'demo', 2)).toContain(
      '(after the import, the waiting line and analyzr status count them)',
    );
  });
});

describe('the parse guard (R34)', () => {
  const GUARDED: [string[], string][] = [
    [
      ['import', 'b', '-p', 'p', '--create', '--name', '--dry-run'],
      '--name "--dry-run": an option value never starts with --; did you forget the name?',
    ],
    [
      ['import', 'b', '-p', 'p', '--name=--dry-run'],
      '--name "--dry-run": an option value never starts with --; did you forget the name?',
    ],
    [
      ['import', 'b', '-p', '--dry-run'],
      '--project "--dry-run": an option value never starts with --; did you forget the project?',
    ],
    [
      ['--url', '--dry-run', 'health'],
      '--url "--dry-run": an option value never starts with --; did you forget the url?',
    ],
    [
      ['token', 'create', '-p', 'p', '--scopes', '--json'],
      '--scopes "--json": an option value never starts with --; did you forget the scope?',
    ],
    [
      ['questions', 'link', 'q-1', '-p', 'p', '--to', 'a#X', '--to', '--json'],
      '--to "--json": an option value never starts with --; did you forget the target?',
    ],
    [
      ['token', 'create', '-p', 'p', '-n', '--json'],
      '--name "--json": an option value never starts with --; did you forget the name?',
    ],
    [
      ['import', 'b', '-p', 'p', '--create', '--name', '--dryrun'],
      '--name "--dryrun": an option value never starts with --; did you forget the name?',
    ],
    [
      ['import', 'b', '-p', 'p', '--create', '--name', '--'],
      '--name "--": an option value never starts with --; did you forget the name?',
    ],
    // a repeated option keeps only its last value: every occurrence is checked
    [
      ['import', 'b', '-p', '--dry-run', '-p', 'p'],
      '--project "--dry-run": an option value never starts with --; did you forget the project?',
    ],
    [
      ['import', 'b', '-p', 'p', '--create', '--name', '--dry-run', '--name', 'Kunde'],
      '--name "--dry-run": an option value never starts with --; did you forget the name?',
    ],
    [
      ['--url', '--dry-run', '--url', 'http://127.0.0.1:7400', 'health'],
      '--url "--dry-run": an option value never starts with --; did you forget the url?',
    ],
    [
      ['value-chain', 'push', 'f.vc.json', '-p', 'p', '--base', '--dry-run', '--base', '3'],
      '--base "--dry-run": an option value never starts with --; did you forget the revision?',
    ],
    [
      ['rules', 'revoke', 'aar_x', '-p', 'p', '--reason', '--dry-run', '--reason', 'x', '--yes'],
      '--reason "--dry-run": an option value never starts with --; did you forget the text?',
    ],
    [
      ['amendments', 'withdraw', 'mam_x', '-p', 'p', '--rev', '--json'],
      '--rev "--json": an option value never starts with --; did you forget the number?',
    ],
    // after the -- that ends the options, a flag is read as an argument
    [
      ['import', '-p', 'p', '--', '--dry-run'],
      'argument "--dry-run": an argument never starts with --; an option belongs before the -- that ends them',
    ],
    [
      ['models', 'delete', '-p', 'p', 'a', '--', 'b', '--yes'],
      'argument "--yes": an argument never starts with --; an option belongs before the -- that ends them',
    ],
  ];

  for (const [name, build] of [
    ['the checkout', buildProgram],
    ['the plugin', plugin],
  ] as const) {
    it(`refuses an option value starting with -- as a usage error (exit 2), sending nothing: ${name}`, async () => {
      for (const [argv, message] of GUARDED) {
        const api = fakeApi({});
        const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
        expect(await runCli(argv, t.io, build), argv.join(' ')).toBe(2);
        expect(t.err()).toBe(`analyzr: ${message}\n`);
        expect(t.out()).toBe('');
        expect(api.seen).toEqual([]);
      }
    });
  }

  it('guards the checkout’s own commands too', async () => {
    const t = testIo();
    expect(await runCli(['seed', '--corpus', '--json'], t.io)).toBe(2);
    expect(t.err()).toContain('--corpus "--json": an option value never starts with --');
  });

  it('lets text with a space through, in both', async () => {
    for (const build of [buildProgram, plugin]) {
      const api = fakeApi({});
      const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
      await runCli(
        ['questions', 'answer', 'q-0123456789abcdef', '-p', 'p', '--text', '-- siehe oben'],
        t.io,
        build,
      );
      expect(t.err()).not.toContain('never starts with --');
      expect(api.seen.length).toBeGreaterThan(0);
    }
  });

  it('lets a value with one dash and the defaults through', async () => {
    const api = fakeApi(nextStepRoutes('p'));
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch);
    expect(
      await runCli(['token', 'create', '-p', 'p', '--name', '-x', '--json'], t.io, plugin),
    ).toBe(0);
    expect(await api.seen[0]?.body.json()).toEqual({
      name: '-x',
      scopes: ['analyzr:read', 'analyzr:propose'],
      expiresInDays: 90,
    });
  });
});

describe('the owner key only for this machine (ownerKeyLoopbackOnly, R33)', () => {
  const REMOTE = 'http://192.0.2.1:7400';

  it('judges the host as fetch parses the URL', () => {
    for (const url of [
      'http://127.0.0.1:7400',
      'http://localhost:7400',
      'http://LOCALHOST:7400/',
      'https://localhost',
      'http://[::1]:7400',
      'http://[0:0:0:0:0:0:0:1]:7400',
      'http://127.1:7400',
      'http://2130706433:7400',
    ]) {
      expect(() => keepOwnerKeyLocal(testIo().io, url), url).not.toThrow();
    }
    for (const [url, why] of [
      [REMOTE, /not to 192\.0\.2\.1; for another analyzr use an agent token/],
      ['http://127.0.0.2:7400', /not to 127\.0\.0\.2/],
      ['http://[::ffff:127.0.0.1]:7400', /not to \[::ffff:7f00:1\]/],
      ['http://localhost.:7400', /not to localhost\./],
      ['http://a.localhost:7400', /not to a\.localhost/],
      ['http://0.0.0.0:7400', /not to 0\.0\.0\.0/],
      ['http://127.0.0.1:7400@analyzr.example.com', /user name or password/],
      ['http://127.0.0.1.example.com', /not to 127\.0\.0\.1\.example\.com/],
      ['http://user:pw@127.0.0.1:7400', /user name or password/],
      ['localhost:7400', /over http\(s\) only, not localhost:/],
      ['127.0.0.1:7400', /is no URL/],
      ['ws://localhost:7400', /over http\(s\) only, not ws:/],
      ['file://localhost/etc/passwd', /over http\(s\) only, not file:/],
      ['localhost', /^the URL of --url or ANALYZR_URL is no URL;/],
    ] as const) {
      expect(() => keepOwnerKeyLocal(testIo().io, url), url).toThrow(why);
    }
    // the URL as given never shows: it may hold a password
    expect(() => keepOwnerKeyLocal(testIo().io, 'http://user:geheim@[::1')).toThrow(
      /^the URL of --url or ANALYZR_URL is no URL; analyzr on this machine is like http:\/\/127\.0\.0\.1:7400$/,
    );
  });

  it('keeps Node’s proxy support away from this machine: no_proxy and NO_PROXY are exactly *', () => {
    const envs: Record<string, string>[] = [
      {},
      { NO_PROXY: 'corp.example, localhost' },
      { no_proxy: 'a.example', NO_PROXY: 'b.example' },
      { no_proxy: ' * ' },
      { NO_PROXY: '*' },
    ];
    for (const env of envs) {
      const t = testIo(env);
      keepOwnerKeyLocal(t.io, 'http://127.0.0.1:7400');
      expect({ NO_PROXY: t.io.env['NO_PROXY'], no_proxy: t.io.env['no_proxy'] }).toEqual({
        NO_PROXY: '*',
        no_proxy: '*',
      });
    }
    // a refused host changes nothing
    const t = testIo({ no_proxy: 'a.example' });
    expect(() => keepOwnerKeyLocal(t.io, REMOTE)).toThrow();
    expect(t.io.env).toEqual({ no_proxy: 'a.example' });
  });

  it('refuses another host in every command of the plugin before the owner key is sent', async () => {
    const leaves = commandTree(plugin(testIo().io)).filter(
      ({ command }) => command.commands.length === 0 && command.name() !== 'help',
    );
    expect(leaves.length).toBeGreaterThan(30);
    let refused = 0;
    for (const { path: at, command } of leaves) {
      const words = at.split(' ').slice(1);
      const args = command.registeredArguments.filter((a) => a.required).map(() => 'x');
      const options = command.options
        .filter((o) => o.mandatory)
        .flatMap((o) => [o.long ?? o.flags, 'p']);
      const api = fakeApi({});
      const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
      await runCli(['--url', REMOTE, ...words, ...args, ...options], t.io, plugin);
      expect(
        api.seen.filter((s) => s.authorization === `Bearer ${OWNER_KEY}`),
        at,
      ).toEqual([]);
      if (t.err().includes('sends the owner key only to analyzr on this machine')) refused++;
    }
    // the commands that fail before (a file to read, a flag to give) never got to a request
    expect(refused).toBeGreaterThan(20);
  });

  it('refuses it for import --create and token create; status says so; an agent token goes anywhere', async () => {
    const REFUSAL =
      'this analyzr CLI sends the owner key only to analyzr on this machine (127.0.0.1, [::1], localhost), not to 192.0.2.1; for another analyzr use an agent token (--token or ANALYZR_TOKEN)';
    for (const argv of [
      ['import', 'bundle', '-p', 'kunde-x', '--create'],
      ['token', 'create', '-p', 'kunde-x'],
    ]) {
      const api = fakeApi({});
      const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
      expect(await runCli(['--url', REMOTE, ...argv], t.io, plugin), argv.join(' ')).toBe(1);
      expect(t.err()).toBe(`analyzr: ${REFUSAL}\n`);
      expect(api.seen).toEqual([]);
    }
    // status reports the server, asked without a credential, as without a key
    const health = fakeApi({
      'GET /health': () => Response.json({ status: 'ok', version: '1', db: 'ok' }),
    });
    const s = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, health.fetch);
    expect(await runCli(['--url', REMOTE, 'status'], s.io, plugin)).toBe(0);
    expect(s.out()).toContain(`no credentials, so no projects: ${REFUSAL}`);
    expect(health.seen.map((r) => [r.path, r.authorization])).toEqual([['/health', null]]);
    // the host is said first, before a missing key file
    const none = testIo({ ANALYZR_OWNER_KEY_FILE: path.join(dir, 'missing') }, fakeApi({}).fetch);
    expect(await runCli(['--url', REMOTE, 'token', 'list', '-p', 'p'], none.io, plugin)).toBe(1);
    expect(none.err()).toContain('not to 192.0.2.1');

    const api = fakeApi(nextStepRoutes('p'));
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile, ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch);
    expect(await runCli(['--url', REMOTE, 'models', 'list', '-p', 'p'], t.io, plugin)).toBe(0);
    expect(api.seen.map((s) => [s.path, s.authorization])).toEqual([
      ['/api/v1/projects/p/models', `Bearer ${AGENT_TOKEN}`],
    ]);
  });

  it('sends it to this machine; the checkout sends it to any host, as before', async () => {
    for (const [build, url] of [
      [plugin, 'http://localhost:7400'],
      [buildProgram, REMOTE],
    ] as const) {
      const api = fakeApi(nextStepRoutes('p'));
      const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch);
      expect(await runCli(['--url', url, 'models', 'list', '-p', 'p'], t.io, build)).toBe(0);
      expect(api.seen.map((s) => s.authorization)).toEqual([`Bearer ${OWNER_KEY}`]);
      expect(t.io.env['NO_PROXY']).toBe(build === plugin ? '*' : undefined);
    }
  });
});
