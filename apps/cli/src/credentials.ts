/**
 * How the CLI authenticates (local mode, CONCEPT §6; docs/DEVELOPMENT.md):
 *
 * - **Owner key** (`analyzr_ok_…`): the server creates it on its first start in a
 *   file only its OS user can read (default `~/.local/state/analyzr/owner-key`,
 *   `ANALYZR_OWNER_KEY_FILE` to override). The CLI reads that file and acts as
 *   the owner on the interactive client `analyzr-cli`: create projects, import,
 *   issue agent tokens. The key never travels in arguments or environment
 *   variables, and the CLI refuses a file that others can read.
 * - **Agent token** (`analyzr_at_…`, `--token` or `ANALYZR_TOKEN`): a project-bound
 *   credential for `analyzr mcp`, and for `import`/`status` when given.
 *
 * The integrate plugin's bundled CLI (M6 S3c, R33) sends the owner key only to
 * analyzr on this machine ({@link keepOwnerKeyLocal}); an agent token goes
 * anywhere, in both CLIs.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  AGENT_TOKEN_PREFIX,
  OWNER_KEY_FILE_ENV,
  OWNER_KEY_PATTERN,
  OWNER_KEY_PREFIX,
  defaultOwnerKeyFile,
} from '@analyzr/contracts';

import { CliError } from './errors.ts';
import type { CliIo } from './io.ts';

export type Credential =
  | {
      kind: 'owner-key';
      secret: string;
      file: string;
      /** The bundled CLI's key: `createApi` sends it only to this machine ({@link keepOwnerKeyLocal}). */
      loopbackOnly?: true;
    }
  | { kind: 'agent-token'; secret: string };

export interface CredentialOptions {
  /** `--token` (else `ANALYZR_TOKEN`). */
  token?: string | undefined;
  /** `--owner-key-file` (else `ANALYZR_OWNER_KEY_FILE`, else the XDG default). */
  ownerKeyFile?: string | undefined;
  /**
   * The bundled CLI (M6 S3c): the owner key goes only to analyzr on this
   * machine; `url` is checked before the key file is read, so a refused host
   * is said first ({@link keepOwnerKeyLocal}; `createApi` checks again).
   */
  ownerKeyLoopbackOnly?: boolean | undefined;
  /** The server URL the command talks to (`--url`, else `ANALYZR_URL`, else the default). */
  url?: string | undefined;
}

/** True if `--owner-key-file` or `ANALYZR_OWNER_KEY_FILE` names the owner key file (else: the default location). */
export function isExplicitOwnerKeyFile(io: CliIo, opts: CredentialOptions): boolean {
  return Boolean(opts.ownerKeyFile ?? io.env[OWNER_KEY_FILE_ENV]);
}

/** The owner key file this invocation uses. */
export function ownerKeyFile(io: CliIo, opts: CredentialOptions): string {
  const explicit = opts.ownerKeyFile ?? io.env[OWNER_KEY_FILE_ENV];
  if (explicit) return path.resolve(io.cwd, explicit);
  return defaultOwnerKeyFile(io.env, io.home);
}

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined;
}

/**
 * Reads the owner key: a regular file of this OS user that group and others
 * cannot access (POSIX), holding one `analyzr_ok_…` key.
 *
 * @throws {CliError} with a hint how to get or fix the file
 */
export async function readOwnerKey(file: string): Promise<string> {
  let info;
  try {
    info = await stat(file);
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') throw err;
    throw new CliError(
      [
        `no owner key at ${file}.`,
        'The analyzr server creates it on its first start on this machine (local mode).',
        'analyzr in Docker: run the command in the container, e.g.',
        '  docker compose -p analyzr -f docker/compose.yaml exec server analyzr <command>',
        `or copy the key and set ${OWNER_KEY_FILE_ENV} (see docs/DEVELOPMENT.md).`,
      ].join('\n'),
    );
  }
  if (!info.isFile()) throw new CliError(`owner key ${file} is not a regular file`);
  if (process.platform !== 'win32') {
    const uid = process.getuid?.();
    if (uid !== undefined && info.uid !== uid) {
      throw new CliError(`owner key ${file} belongs to another OS user (uid ${info.uid})`);
    }
    if ((info.mode & 0o077) !== 0) {
      throw new CliError(
        `owner key ${file} is accessible by group or others (mode ${(info.mode & 0o777).toString(8)}); run: chmod 600 ${file}`,
      );
    }
  }
  const key = (await readFile(file, 'utf8')).trim();
  if (!OWNER_KEY_PATTERN.test(key))
    throw new CliError(`${file} does not hold an analyzr owner key`);
  return key;
}

/** The agent token from `--token`/`ANALYZR_TOKEN`, if any (validated by prefix). */
export function agentToken(io: CliIo, opts: CredentialOptions): string | undefined {
  const token = opts.token ?? io.env['ANALYZR_TOKEN'];
  if (token === undefined || token === '') return undefined;
  if (token.startsWith(OWNER_KEY_PREFIX)) {
    throw new CliError(
      'that is the owner key, not an agent token; never pass it as --token/ANALYZR_TOKEN',
    );
  }
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) {
    throw new CliError(`an agent token starts with ${AGENT_TOKEN_PREFIX}`);
  }
  return token;
}

/** The owner's credential (owner-only commands: seed, token). */
export async function ownerCredential(io: CliIo, opts: CredentialOptions): Promise<Credential> {
  if (opts.ownerKeyLoopbackOnly === true && opts.url !== undefined) keepOwnerKeyLocal(io, opts.url);
  const file = ownerKeyFile(io, opts);
  return {
    kind: 'owner-key',
    secret: await readOwnerKey(file),
    file,
    ...(opts.ownerKeyLoopbackOnly === true ? { loopbackOnly: true as const } : {}),
  };
}

/** An agent token if one is given, else the owner key (import, status). */
export async function anyCredential(io: CliIo, opts: CredentialOptions): Promise<Credential> {
  const token = agentToken(io, opts);
  return token ? { kind: 'agent-token', secret: token } : ownerCredential(io, opts);
}

/** One line naming the credential, never its secret. */
export function describeCredential(c: Credential): string {
  return c.kind === 'owner-key'
    ? `owner key ${c.file}`
    : `agent token ${c.secret.slice(0, AGENT_TOKEN_PREFIX.length + 8)}…`;
}

/** The hosts the bundled CLI sends the owner key to: this machine (local mode, decision 6). */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * The bundled CLI's check before the owner key is sent to `url` (M6 S3c,
 * R33), as `analyzr-read.mjs` judges a host: an http(s) URL whose host, as
 * fetch parses it, is one of {@link LOOPBACK_HOSTS} (so `127.1`,
 * `2130706433` and `[0:0::1]` pass as the same addresses; `127.0.0.2`,
 * `[::ffff:127.0.0.1]`, `localhost.` and `http://127.0.0.1@example.com` do
 * not), with no user name or password. Then `no_proxy` and `NO_PROXY` are
 * `*`, as `analyzr-read.mjs` sets them: Node's proxy support
 * (`NODE_USE_ENV_PROXY`, `--use-env-proxy`) would tunnel even a request to
 * 127.0.0.1 through `HTTP(S)_PROXY`, its fetch reads them at each request,
 * and only an exact `*` means never (not ` * `); every request of a command
 * with the owner key goes to this machine, so no proxy is lost. A redirect
 * cannot carry the key off either: fetch drops `Authorization` on a redirect
 * to another origin.
 *
 * @throws {CliError} naming the host and the agent token for another
 *   analyzr, never the URL as given (it may hold a password)
 */
export function keepOwnerKeyLocal(io: CliIo, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CliError(
      'the URL of --url or ANALYZR_URL is no URL; analyzr on this machine is like http://127.0.0.1:7400',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError(
      `the owner key goes to analyzr over http(s) only, not ${parsed.protocol} (--url or ANALYZR_URL)`,
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new CliError(
      'the owner key goes to no URL with a user name or password (--url or ANALYZR_URL)',
    );
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new CliError(
      `this analyzr CLI sends the owner key only to analyzr on this machine (127.0.0.1, [::1], localhost), not to ${parsed.hostname}; for another analyzr use an agent token (--token or ANALYZR_TOKEN)`,
    );
  }
  io.env['no_proxy'] = '*';
  io.env['NO_PROXY'] = '*';
}
