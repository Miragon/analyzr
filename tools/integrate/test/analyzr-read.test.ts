// analyzr-read.mjs (src/cli/analyzr-read.ts, src/analyzr.ts, src/preview.ts; M6 S2b follow-up
// step 4, owner decision 29 (2)): the skill's pre-approved, read-only way to analyzr, run as the
// plugin runs it against a fake analyzr. The real server is the CLI's e2e test.
import { execFile } from 'node:child_process';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import {
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  AGENT_TOKEN_PREFIX as CONTRACT_AGENT_TOKEN_PREFIX,
  API_PREFIX as CONTRACT_API_PREFIX,
  createProblem,
  defaultOwnerKeyFile as contractDefaultOwnerKeyFile,
  IMPORT_MANIFEST_FILE as CONTRACT_MANIFEST_FILE,
  IMPORT_MANIFEST_FORMAT as CONTRACT_MANIFEST_FORMAT,
  MAX_IMPORT_BYTES as CONTRACT_MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES as CONTRACT_MAX_IMPORT_FILES,
  MAX_MODEL_BYTES as CONTRACT_MAX_MODEL_BYTES,
  MAX_PAGE_LIMIT as CONTRACT_MAX_PAGE_LIMIT,
  OWNER_KEY_FILE_ENV as CONTRACT_OWNER_KEY_FILE_ENV,
  OWNER_KEY_PATTERN as CONTRACT_OWNER_KEY_PATTERN,
  OWNER_KEY_PREFIX as CONTRACT_OWNER_KEY_PREFIX,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AGENT_TOKEN_PREFIX,
  analyzrBase,
  API_PREFIX,
  assertAllowed,
  assertNoProxy,
  bypassEnvProxy,
  defaultOwnerKeyFile,
  MAX_PAGE_LIMIT,
  OWNER_KEY_FILE_ENV,
  OWNER_KEY_PATTERN,
  OWNER_KEY_PREFIX,
  RefusedError,
  requestFor,
  send,
} from '../src/analyzr.ts';
import {
  IMPORT_MANIFEST_FILE,
  IMPORT_MANIFEST_FORMAT,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
  MAX_MODEL_BYTES,
  planImport,
  processesToPlace,
} from '../src/preview.ts';

import {
  FAKE_IDENTITIES,
  FAKE_MODELS,
  fakeAnalyzr,
  fakeImpact,
  type FakeAnalyzr,
} from './fake-analyzr.ts';
import { PACKAGE_ROOT, REPO_ROOT, SIGNAVIO_BUNDLE } from './support.ts';

const execFileAsync = promisify(execFile);
const ENTRY = path.join(PACKAGE_ROOT, 'src/cli/analyzr-read.ts');
const KEY = `${OWNER_KEY_PREFIX}${'k'.repeat(43)}`;
/** An agent token's shape (`analyzr_at_` and base62). */
const TOKEN = `${AGENT_TOKEN_PREFIX}${'r'.repeat(49)}`;

/** `expect.stringMatching`, typed for object literals. */
const matching = (re: RegExp): string => expect.stringMatching(re) as string;

let server: FakeAnalyzr;
/** Where `moved` redirects to: it must never see a request. */
let elsewhere: FakeAnalyzr;
let dir: string;
let ws: string;
let keyFile: string;

beforeAll(async () => {
  elsewhere = await fakeAnalyzr();
  server = await fakeAnalyzr({ redirectTo: elsewhere.url });
  dir = await mkdtemp(path.join(tmpdir(), 'analyzr-read-'));
  ws = path.join(dir, 'ws');
  await mkdir(path.join(ws, 'reports'), { recursive: true });
  await writeFile(path.join(ws, 'analyzr-workspace.json'), '{}\n');
  keyFile = path.join(dir, 'state', 'owner-key');
  await mkdir(path.dirname(keyFile));
  await writeFile(keyFile, `${KEY}\n`);
  await chmod(keyFile, 0o600);
});

afterAll(async () => {
  await server.close();
  await elsewhere.close();
  await rm(dir, { recursive: true, force: true });
});

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the entry as the plugin runs the bundled script, with the owner key file and no token. */
async function read(args: readonly string[], env: Record<string, string> = {}): Promise<Result> {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith('ANALYZR_') && k !== 'XDG_STATE_HOME',
    ),
  );
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [ENTRY, ...args], {
      cwd: ws,
      env: { ...clean, [OWNER_KEY_FILE_ENV]: keyFile, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const reports = (name: string) => path.join(ws, 'reports', name);

describe('analyzr-read models and external-ids', () => {
  it('writes every page of the models as analyzr models list --json does', async () => {
    const file = reports('2026-10-14-signavio.models.json');
    const r = await read(['models', '-p', 'kunde-x', '--url', server.url, '--json-out', file]);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(r.stdout)).toEqual({ project: 'kunde-x', models: 3, written: file });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(FAKE_MODELS);
    expect(server.log.slice(-2)).toEqual([
      {
        method: 'GET',
        url: '/api/v1/projects/kunde-x/models?limit=200',
        authorization: `Bearer ${KEY}`,
        files: [],
        manifest: null,
      },
      {
        method: 'GET',
        url: '/api/v1/projects/kunde-x/models?limit=200&cursor=next',
        authorization: `Bearer ${KEY}`,
        files: [],
        manifest: null,
      },
    ]);
  });

  it('writes the identities as analyzr models external-ids --json does, with an agent token', async () => {
    const file = reports('2026-10-14-signavio.external-ids.json');
    const token = TOKEN;
    const r = await read(
      [
        'external-ids',
        '-p',
        'kunde-x',
        '--url',
        server.url,
        '--system',
        'signavio',
        '--json-out',
        file,
      ],
      { ANALYZR_TOKEN: token },
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      project: 'kunde-x',
      models: 2,
      bySystem: { signavio: 2 },
      written: file,
    });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      items: FAKE_IDENTITIES.filter((i) => i.system === 'signavio'),
    });
    expect(server.log.at(-1)).toMatchObject({
      method: 'GET',
      url: '/api/v1/projects/kunde-x/external-ids?system=signavio',
      authorization: `Bearer ${token}`,
    });
  });

  it('says why a project or a credential does not work, naming no secret', async () => {
    const file = reports('missing.models.json');
    expect(
      await read(['models', '-p', 'missing', '--url', server.url, '--json-out', file]),
    ).toMatchObject({
      code: 1,
      stderr: matching(
        /cannot list the models of missing: analyzr answered 404 not-found: project missing not found/,
      ),
    });
    await expect(readFile(file)).rejects.toThrow(/ENOENT/);
    const owner = await read(['models', '-p', 'kunde-x', '--url', server.url, '--json-out', file], {
      ANALYZR_TOKEN: KEY,
    });
    expect(owner).toMatchObject({ code: 1, stderr: matching(/ANALYZR_TOKEN holds the owner key/) });
    expect(owner.stderr).not.toContain(KEY);
    const open = path.join(dir, 'open-key');
    await writeFile(open, KEY);
    await chmod(open, 0o644);
    const loose = await read(['models', '-p', 'kunde-x', '--url', server.url, '--json-out', file], {
      [OWNER_KEY_FILE_ENV]: open,
    });
    expect(loose).toMatchObject({ code: 1, stderr: matching(/accessible by group or others/) });
    expect(
      await read(['models', '-p', 'kunde-x', '--url', server.url, '--json-out', file], {
        [OWNER_KEY_FILE_ENV]: path.join(dir, 'none'),
      }),
    ).toMatchObject({ code: 1, stderr: matching(/no owner key at .* and no ANALYZR_TOKEN/) });
    // A broken token never reaches a header, whose error would print it.
    const before = server.log.length;
    for (const token of [`${TOKEN}\nX`, `${AGENT_TOKEN_PREFIX}read-only`, `${TOKEN} `]) {
      const broken = await read(
        ['models', '-p', 'kunde-x', '--url', server.url, '--json-out', file],
        { ANALYZR_TOKEN: token },
      );
      expect(broken).toMatchObject({
        code: 1,
        stderr: matching(/ANALYZR_TOKEN is no agent token/),
      });
      expect(broken.stderr).not.toContain('r'.repeat(49));
      expect(broken.stderr).not.toContain('read-only');
    }
    expect(server.log.length).toBe(before);
  });

  it('names no credential when a request fails', async () => {
    const api = {
      base: analyzrBase('http://127.0.0.1:7400'),
      credential: { kind: 'agent-token' as const, secret: TOKEN },
      fetch: () => Promise.reject(new TypeError(`invalid header value "Bearer ${TOKEN}"`)),
    };
    const failed = send(api, { kind: 'models', project: 'p' }, 'list the models of p');
    await expect(failed).rejects.toThrow(/did not answer \(invalid header value "Bearer …"\)/);
    await expect(failed).rejects.not.toThrow(TOKEN);
  });
});

describe('analyzr-read preview', () => {
  it('previews the golden bundle as analyzr import --dry-run sends it, and reports the agent work', async () => {
    const details = reports('2026-10-14-signavio.preview.json');
    const r = await read([
      'preview',
      SIGNAVIO_BUNDLE,
      '-p',
      'kunde-x',
      '--url',
      server.url,
      '--json-out',
      details,
    ]);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    const manifestText = await readFile(path.join(SIGNAVIO_BUNDLE, 'analyzr-import.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as { files: { path: string; key: string }[] };
    const keys = manifest.files.map((f) => f.key);
    expect(server.log.at(-1)).toEqual({
      method: 'POST',
      url: '/api/v1/projects/kunde-x/imports?dryRun=true',
      authorization: `Bearer ${KEY}`,
      files: manifest.files.map((f) => f.path),
      manifest: JSON.stringify(JSON.parse(manifestText)),
    });
    expect(JSON.parse(r.stdout)).toEqual({
      project: 'kunde-x',
      credential: 'owner-key',
      batches: 1,
      batchesWithNew: 1,
      counts: { created: 6, revised: 0, unchanged: 0, failed: 0, skipped: 0 },
      manifest: {
        system: 'signavio',
        listed: 6,
        unlisted: { count: 0, items: [] },
        missing: { count: 0, items: [] },
      },
      files: { count: 0, items: [] },
      skipped: { count: 0, items: [] },
      importWarnings: {},
      impact: {
        factsChanged: 6,
        processesAdded: 6,
        processesRemoved: 0,
        acceptedCalls: 0,
        callsProposed: { count: 0, wasAccepted: 0, byReason: [] },
        endpointsChanged: 0,
        placementsChanged: 0,
        proposalsAdded: 0,
        proposalsWithdrawn: 0,
        findingsAdded: 0,
        findingsResolved: 0,
        absentKeys: { count: 1, items: ['absent/one'] },
      },
      agentWork: {
        relations: {
          queued: 6,
          cancelled: 1,
          claimed: 1,
          claimedKeys: [keys[0]],
          pairs: 60,
          rejudged: 1,
        },
        placement: { outcome: 'queued', toPlace: 2, again: 1, due: 2 },
      },
      details,
    });
    expect(JSON.parse(await readFile(details, 'utf8'))).toEqual({
      project: 'kunde-x',
      files: manifest.files.map((f) => ({
        path: f.path,
        modelKey: f.key,
        outcome: 'created',
        warnings: [],
        warningCount: 0,
      })),
      counts: { created: 6, revised: 0, unchanged: 0, failed: 0 },
      manifest: { system: 'signavio', listed: 6, stored: 6, kept: 0, unlisted: [], missing: [] },
      impact: fakeImpact(keys),
      batches: 1,
    });
  });

  it('sends batches of 50 files with the whole manifest each, merges them and exits 1 for a file that would fail', async () => {
    const bundle = path.join(dir, 'big-bundle');
    await mkdir(path.join(bundle, 'm'), { recursive: true });
    await mkdir(path.join(bundle, 'node_modules'), { recursive: true });
    const paths = [
      ...Array.from({ length: 60 }, (_, i) => `m/p${String(i).padStart(2, '0')}.bpmn`),
      'zz-fail.bpmn',
    ];
    for (const p of paths) await writeFile(path.join(bundle, p), '<definitions/>');
    // Never picked up: hidden files, node_modules, other endings.
    await writeFile(path.join(bundle, '.hidden.bpmn'), '<definitions/>');
    await writeFile(path.join(bundle, 'node_modules', 'x.bpmn'), '<definitions/>');
    await writeFile(path.join(bundle, 'notes.txt'), 'x');
    const manifest = {
      format: 'analyzr-import/1',
      source: { system: 'tool' },
      files: paths.map((p) => ({ path: p, key: `k/${path.basename(p, '.bpmn')}` })),
    };
    await writeFile(
      path.join(bundle, 'analyzr-import.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const before = server.log.length;
    const r = await read(['preview', bundle, '-p', 'kunde-x', '--url', server.url]);
    expect(r.code).toBe(1);
    const posts = server.log.slice(before);
    expect(posts.map((p) => [p.method, p.url, p.files.length])).toEqual([
      ['POST', '/api/v1/projects/kunde-x/imports?dryRun=true', 50],
      ['POST', '/api/v1/projects/kunde-x/imports?dryRun=true', 11],
    ]);
    expect(posts.flatMap((p) => p.files)).toEqual(paths);
    for (const p of posts) expect(p.manifest).toBe(JSON.stringify(manifest));
    expect(JSON.parse(r.stdout)).toMatchObject({
      batches: 2,
      batchesWithNew: 2,
      counts: { created: 60, failed: 1 },
      files: {
        count: 1,
        items: [
          {
            path: 'zz-fail.bpmn',
            key: 'k/zz-fail',
            outcome: 'failed',
            problem: '422 bpmn-invalid: no definitions',
          },
        ],
      },
      impact: { factsChanged: 60, absentKeys: { count: 1 } },
      agentWork: {
        relations: { queued: 60, cancelled: 2, claimed: 2, pairs: 600, rejudged: 2 },
        placement: { outcome: 'queued', toPlace: 2, again: 2, due: 2 },
      },
      details: null,
    });
  });

  it('previews into an existing project and a bundle folder only', async () => {
    const before = server.log.length;
    expect(
      await read(['preview', SIGNAVIO_BUNDLE, '-p', 'missing', '--url', server.url]),
    ).toMatchObject({
      code: 1,
      stderr: matching(/analyzr answered 404 not-found/),
    });
    const plain = path.join(dir, 'plain');
    await mkdir(plain);
    await writeFile(path.join(plain, 'a.bpmn'), '<definitions/>');
    expect(await read(['preview', plain, '-p', 'kunde-x', '--url', server.url])).toMatchObject({
      code: 1,
      stderr: matching(
        /no analyzr-import\.json in .*: preview the bundle folder normalize-bpmn wrote/,
      ),
    });
    expect(
      await read(['preview', path.join(dir, 'nowhere'), '-p', 'kunde-x', '--url', server.url]),
    ).toMatchObject({
      code: 1,
      stderr: matching(/is not a directory/),
    });
    expect(server.log.length).toBe(before + 1);
  });
});

describe('analyzr-read refuses', () => {
  const file = () => reports('refused.models.json');

  it.each([
    [
      'http://example.com',
      /example\.com is refused: analyzr-read talks to analyzr on this machine only/,
    ],
    ['http://10.0.0.1:7400', /10\.0\.0\.1 is refused/],
    ['http://127.0.0.2:7400', /127\.0\.0\.2 is refused/],
    ['http://user:secret@127.0.0.1:7400', /with a user name or password is refused/],
    ['http://127.0.0.1:7400@example.com', /example\.com is refused|user name or password/],
    ['ftp://127.0.0.1', /ftp: is refused/],
    ['http://127.0.0.1:7400/api', /origin only/],
    ['not a url', /is no URL/],
  ])('--url %s before any credential is read', async (url, message) => {
    const before = server.log.length;
    const r = await read(['models', '-p', 'kunde-x', '--url', url, '--json-out', file()], {
      [OWNER_KEY_FILE_ENV]: path.join(dir, 'no-such-key'),
    });
    expect(r).toMatchObject({ code: 1, stderr: matching(message) });
    expect(r.stderr).not.toMatch(/owner key/);
    expect(server.log.length).toBe(before);
  });

  it('a proxy Node would send the credential through', async () => {
    const before = server.log.length;
    const proxied: Record<string, string>[] = [
      { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: elsewhere.url },
      { NODE_OPTIONS: '--use-env-proxy', https_proxy: elsewhere.url },
      // Every spelling Node takes (Node 24.15 tunnels a request to 127.0.0.1 with each).
      { NODE_OPTIONS: '--use_env_proxy', HTTP_PROXY: elsewhere.url },
      { NODE_OPTIONS: '--use-env-proxy=true', HTTP_PROXY: elsewhere.url },
      { NODE_OPTIONS: '"--use-env-proxy"', HTTP_PROXY: elsewhere.url },
    ];
    for (const env of proxied) {
      expect(
        await read(['models', '-p', 'kunde-x', '--url', server.url, '--json-out', file()], {
          ...env,
          [OWNER_KEY_FILE_ENV]: path.join(dir, 'no-such-key'),
        }),
      ).toMatchObject({
        code: 1,
        stderr: matching(/through the proxy of (HTTP_PROXY|https_proxy)/),
      });
    }
    expect(server.log.length).toBe(before);
    expect(elsewhere.log).toEqual([]);
    // A proxy variable alone does not reroute Node's fetch.
    expect(() => assertNoProxy({ HTTP_PROXY: 'http://proxy:3128' }, [])).not.toThrow();
    expect(() =>
      assertNoProxy({ NODE_USE_ENV_PROXY: '0', HTTP_PROXY: 'http://proxy:3128' }, []),
    ).not.toThrow();
    for (const argv of [['--use-env-proxy'], ['--use_env_proxy'], ['--use-env-proxy=true']]) {
      expect(() => assertNoProxy({ HTTP_PROXY: 'http://proxy:3128' }, argv)).toThrow(RefusedError);
    }
    expect(() =>
      assertNoProxy({ HTTP_PROXY: 'http://proxy:3128' }, ['--no-use-env-proxy']),
    ).not.toThrow();
  });

  it('never lets Node send a request through a proxy (NO_PROXY=*, read at each request)', async () => {
    // The second guard under the refusal above: Node with its proxy support on, the proxy set,
    // and the script's bypass, as for a spelling the refusal does not know.
    // A proxy that takes the connection and drops it, counting.
    let tunnelled = 0;
    const proxy = createTcpServer((socket) => {
      tunnelled++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    const fetchAfter = async (bypass: boolean) => {
      const code = [
        `import { bypassEnvProxy } from ${JSON.stringify(pathToFileURL(path.join(PACKAGE_ROOT, 'src/analyzr.ts')).href)};`,
        bypass ? 'bypassEnvProxy(process.env);' : '',
        `const r = await fetch(${JSON.stringify(`${server.url}/api/v1/projects/kunde-x/external-ids`)}).then((x) => x.status, () => 'failed');`,
        'process.stdout.write(String(r));',
      ].join('\n');
      const { stdout } = await execFileAsync(
        process.execPath,
        ['--use-env-proxy', '--input-type=module', '-e', code],
        { env: { PATH: process.env['PATH'] ?? '', HTTP_PROXY: proxyUrl } },
      );
      return stdout;
    };
    const before = server.log.length;
    try {
      expect(await fetchAfter(false)).toBe('failed');
      // Node may retry the dropped connection (once on macOS, a dozen times on Linux in CI).
      const reached = tunnelled;
      expect(reached).toBeGreaterThan(0);
      expect(server.log.length).toBe(before);
      expect(await fetchAfter(true)).toBe('200');
      expect([tunnelled, server.log.length]).toEqual([reached, before + 1]);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
    const env: Record<string, string | undefined> = { NO_PROXY: 'localhost' };
    bypassEnvProxy(env);
    expect(env).toEqual({ NO_PROXY: '*', no_proxy: '*' });
  });

  it('a redirect: the credential never goes elsewhere', async () => {
    const r = await read(['models', '-p', 'moved', '--url', server.url, '--json-out', file()]);
    expect(r).toMatchObject({ code: 1, stderr: matching(/did not answer.*redirects are refused/) });
    expect(elsewhere.log).toEqual([]);
    await expect(readFile(file())).rejects.toThrow(/ENOENT/);
  });

  it('a --json-out that is not its own kind of file in the workspace’s reports/, or inside the bundle or an analyzr checkout', async () => {
    const bundle = path.join(dir, 'guarded-bundle');
    await cp(SIGNAVIO_BUNDLE, bundle, { recursive: true });
    const notes = path.join(ws, 'notes.txt');
    await writeFile(notes, 'mine');
    await symlink(notes, reports('link.models.json'));
    // A hard link: the write would change the consultant's file under its other name.
    await link(notes, reports('hard.models.json'));
    // A dangling link (an unpacked zip can hold one): the write would create its target.
    const victim = path.join(dir, 'victim');
    await mkdir(victim);
    await symlink(path.join(victim, 'settings.local.json'), reports('dangling.models.json'));
    const exportDir = path.join(ws, 'exports', '2026-10-01-signavio');
    await mkdir(exportDir, { recursive: true });
    const before = server.log.length;
    for (const [args, message] of [
      [
        [
          'models',
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          path.join(ws, 'keymap.json'),
        ],
        /names a file <name>\.models\.json/,
      ],
      [
        [
          'models',
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          path.join(ws, '.claude', 'settings.json'),
        ],
        /names a file/,
      ],
      [
        [
          'models',
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          reports('x.external-ids.json'),
        ],
        /names a file <name>\.models\.json/,
      ],
      [
        [
          'external-ids',
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          reports('x.models.json'),
        ],
        /names a file <name>\.external-ids\.json/,
      ],
      [
        ['models', '-p', 'kunde-x', '--url', server.url, '--json-out', reports('.models.json')],
        /names a file/,
      ],
      [
        ['models', '-p', 'kunde-x', '--url', server.url, '--json-out', reports('link.models.json')],
        /names a file/,
      ],
      [
        [
          'models',
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          reports('dangling.models.json'),
        ],
        /is a symbolic link/,
      ],
      [
        ['models', '-p', 'kunde-x', '--url', server.url, '--json-out', reports('hard.models.json')],
        /a hard link/,
      ],
      [
        [
          'models',
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          path.join(exportDir, 'e.models.json'),
        ],
        /lies in no workspace's reports\/ folder/,
      ],
      [
        [
          'models',
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          path.join(ws, 'reports', '..', '..', 'victim', 'new', 'deep', 'q.models.json'),
        ],
        /lies in no workspace's reports\/ folder/,
      ],
      [
        [
          'models',
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          path.join(dir, 'reports', 'no-workspace.models.json'),
        ],
        /lies in no workspace's reports\/ folder/,
      ],
      [
        [
          'preview',
          bundle,
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          path.join(bundle, 'x.preview.json'),
        ],
        /lies inside the bundle/,
      ],
      [
        [
          'models',
          '-p',
          'kunde-x',
          '--url',
          server.url,
          '--json-out',
          path.join(REPO_ROOT, 'tools/integrate/test/x.models.json'),
        ],
        /lies inside the analyzr checkout/,
      ],
    ] as const) {
      expect(await read(args), args.join(' ')).toMatchObject({
        code: 1,
        stderr: matching(message),
      });
    }
    expect(server.log.length).toBe(before);
    expect(await readFile(notes, 'utf8')).toBe('mine');
    await expect(readFile(path.join(bundle, 'x.preview.json'))).rejects.toThrow(/ENOENT/);
    await expect(stat(path.join(victim, 'settings.local.json'))).rejects.toThrow(/ENOENT/);
    await expect(stat(path.join(victim, 'new'))).rejects.toThrow(/ENOENT/);
    await expect(stat(path.join(exportDir, 'e.models.json'))).rejects.toThrow(/ENOENT/);
  });

  it('every option it does not know: no --create, no --name, no other command', async () => {
    const before = server.log.length;
    for (const args of [
      ['preview', SIGNAVIO_BUNDLE, '-p', 'kunde-x', '--url', server.url, '--create'],
      ['preview', SIGNAVIO_BUNDLE, '-p', 'kunde-x', '--url', server.url, '--name', 'x'],
      ['preview', SIGNAVIO_BUNDLE, '-p', 'kunde-x', '--url', server.url, '--dry-run'],
      ['preview', SIGNAVIO_BUNDLE, '-p', 'kunde-x', '--url', server.url, '--token', 'analyzr_at_x'],
      ['preview', SIGNAVIO_BUNDLE, SIGNAVIO_BUNDLE, '-p', 'kunde-x', '--url', server.url],
      ['import', SIGNAVIO_BUNDLE, '-p', 'kunde-x', '--url', server.url],
      ['models', 'extra', '-p', 'kunde-x', '--url', server.url, '--json-out', file()],
      ['models', '-p', 'kunde-x', '--url', server.url],
      ['models', '-p', 'Kunde X', '--url', server.url, '--json-out', file()],
      ['models', '--url', server.url, '--json-out', file()],
      ['models', '-p', 'kunde-x', '--json-out', file()],
      [
        'external-ids',
        '-p',
        'kunde-x',
        '--url',
        server.url,
        '--system',
        'Signavio!',
        '--json-out',
        reports('x.external-ids.json'),
      ],
      [],
    ]) {
      expect(await read(args), args.join(' ')).toMatchObject({
        code: 2,
        stderr: matching(/^analyzr-read: /),
      });
    }
    expect(server.log.length).toBe(before);
    expect(await read(['--help'])).toMatchObject({ code: 0, stdout: matching(/^Usage:/) });
  });

  it('sent only the three requests in all these runs', () => {
    expect(server.log.length).toBeGreaterThan(5);
    for (const r of server.log) {
      expect(`${r.method} ${r.url}`).toMatch(
        /^(?:GET \/api\/v1\/projects\/[a-z0-9-]+\/(?:models\?limit=200(?:&cursor=[^&]+)?|external-ids(?:\?system=[a-z0-9-]+)?)|POST \/api\/v1\/projects\/[a-z0-9-]+\/imports\?dryRun=true)$/,
      );
    }
  });
});

describe('the request guard (src/analyzr.ts)', () => {
  const base = analyzrBase('http://127.0.0.1:7400');

  it('builds exactly the three requests', () => {
    expect(requestFor(base, { kind: 'models', project: 'p' })).toEqual({
      method: 'GET',
      url: new URL('http://127.0.0.1:7400/api/v1/projects/p/models?limit=200'),
    });
    expect(requestFor(base, { kind: 'external-ids', project: 'p', system: 's' }).url.href).toBe(
      'http://127.0.0.1:7400/api/v1/projects/p/external-ids?system=s',
    );
    expect(requestFor(base, { kind: 'dry-run', project: 'p', body: new FormData() })).toEqual({
      method: 'POST',
      url: new URL('http://127.0.0.1:7400/api/v1/projects/p/imports?dryRun=true'),
    });
    expect(() => requestFor(base, { kind: 'models', project: '../x' })).toThrow(RefusedError);
    expect(() => requestFor(base, { kind: 'external-ids', project: 'p', system: 'a&b' })).toThrow(
      RefusedError,
    );
  });

  it.each([
    ['POST', 'http://127.0.0.1:7400/api/v1/projects/p/imports'],
    ['POST', 'http://127.0.0.1:7400/api/v1/projects/p/imports?dryRun=false'],
    ['POST', 'http://127.0.0.1:7400/api/v1/projects/p/imports?dryRun=true&x=1'],
    ['POST', 'http://127.0.0.1:7400/api/v1/projects'],
    ['PUT', 'http://127.0.0.1:7400/api/v1/projects/p/models/by-key/a?dryRun=true'],
    ['DELETE', 'http://127.0.0.1:7400/api/v1/projects/p/models/a'],
    ['GET', 'http://127.0.0.1:7400/api/v1/projects/p/models/a'],
    ['GET', 'http://127.0.0.1:7400/api/v1/projects/p/models?stage=judged'],
    ['GET', 'http://127.0.0.1:7400/api/v1/session'],
    ['GET', 'http://localhost:7400/api/v1/projects/p/models'],
    ['GET', 'http://127.0.0.1:7401/api/v1/projects/p/models'],
  ])('refuses %s %s', (method, url) => {
    expect(() => assertAllowed(base, method, new URL(url))).toThrow(RefusedError);
  });

  it('takes this machine’s analyzr only', () => {
    expect(analyzrBase('http://127.0.0.1:7400/').href).toBe('http://127.0.0.1:7400/');
    expect(analyzrBase('http://[::1]:7400').href).toBe('http://[::1]:7400/');
    expect(analyzrBase('http://LOCALHOST:7400').href).toBe('http://localhost:7400/');
    expect(() => analyzrBase('http://[::ffff:127.0.0.1]:7400')).toThrow(RefusedError);
    // The URL parser makes these 127.0.0.1 (still this machine).
    expect(analyzrBase('http://127.0.0.1.:7400').href).toBe('http://127.0.0.1:7400/');
    expect(analyzrBase('http://0x7f000001:7400').href).toBe('http://127.0.0.1:7400/');
    expect(() => analyzrBase('http://127.0.0.1:7400?x=1')).toThrow(RefusedError);
  });
});

describe('what analyzr-read mirrors of the contracts and the CLI', () => {
  it('has the contracts’ constants (it bundles no zod)', () => {
    expect(API_PREFIX).toBe(CONTRACT_API_PREFIX);
    expect(MAX_PAGE_LIMIT).toBe(CONTRACT_MAX_PAGE_LIMIT);
    expect(OWNER_KEY_PREFIX).toBe(CONTRACT_OWNER_KEY_PREFIX);
    expect(OWNER_KEY_PATTERN.source).toBe(CONTRACT_OWNER_KEY_PATTERN.source);
    expect(OWNER_KEY_FILE_ENV).toBe(CONTRACT_OWNER_KEY_FILE_ENV);
    expect(AGENT_TOKEN_PREFIX).toBe(CONTRACT_AGENT_TOKEN_PREFIX);
    expect([MAX_IMPORT_FILES, MAX_IMPORT_BYTES, MAX_MODEL_BYTES]).toEqual([
      CONTRACT_MAX_IMPORT_FILES,
      CONTRACT_MAX_IMPORT_BYTES,
      CONTRACT_MAX_MODEL_BYTES,
    ]);
    expect([IMPORT_MANIFEST_FILE, IMPORT_MANIFEST_FORMAT]).toEqual([
      CONTRACT_MANIFEST_FILE,
      CONTRACT_MANIFEST_FORMAT,
    ]);
    for (const [env, home] of [
      [{}, '/home/u'],
      [{ XDG_STATE_HOME: '/state/' }, '/home/u'],
      [{ XDG_STATE_HOME: 'relative' }, '/home/u/'],
    ] as const) {
      expect(defaultOwnerKeyFile(env, home)).toBe(contractDefaultOwnerKeyFile(env, home));
    }
  });

  it('fails a file locally as the CLI does (createProblem)', () => {
    const bytes = new Uint8Array(new ArrayBuffer(1));
    const plan = planImport(
      [
        { path: '!!!.bpmn', bytes },
        { path: 'a.bpmn', bytes },
        { path: 'b.bpmn', bytes },
        { path: 'big.bpmn', bytes: new Uint8Array(new ArrayBuffer(MAX_MODEL_BYTES + 1)) },
      ],
      (p) => (p === 'b.bpmn' ? 'a' : p === '!!!.bpmn' ? null : p.replace('.bpmn', '')),
    );
    expect(plan.failed).toEqual([
      {
        path: '!!!.bpmn',
        modelKey: null,
        outcome: 'failed',
        problem: createProblem('validation-failed', 'the path gives no valid model key'),
      },
      {
        path: 'b.bpmn',
        modelKey: 'a',
        outcome: 'failed',
        problem: createProblem(
          'validation-failed',
          'another file of this import has model key a (a.bpmn)',
        ),
      },
      {
        path: 'big.bpmn',
        modelKey: 'big',
        outcome: 'failed',
        problem: createProblem(
          'payload-too-large',
          `a model may have at most ${MAX_MODEL_BYTES} bytes`,
        ),
      },
    ]);
    expect(plan.batches.map((b) => b.map((f) => f.path))).toEqual([['a.bpmn']]);
  });

  it('counts the processes to place as the web’s „Vorschau“ does', () => {
    const task = (
      outcome: 'queued' | 'open' | 'deferred' | 'nothing-due' | 'not-triggered',
      due: number,
      newlyDue: number,
    ) => ({
      outcome,
      due,
      newlyDue,
      again: 0,
    });
    expect(processesToPlace(task('queued', 9, 2))).toBe(9);
    expect(processesToPlace(task('queued', 2, 5))).toBe(5);
    expect(processesToPlace(task('open', 9, 1))).toBe(1);
    expect(processesToPlace(task('deferred', 3, 2))).toBe(2);
    expect(processesToPlace(task('nothing-due', 0, 0))).toBe(0);
    expect(processesToPlace(task('not-triggered', 4, 0))).toBe(0);
  });
});
