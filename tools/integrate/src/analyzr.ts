/**
 * The plugin's one way to analyzr (M6 S2b follow-up step 4, owner decision
 * 29 (2)): `analyzr-read.mjs` reads a project's models and identities and
 * previews an import, and cannot write. Exactly three requests exist, built
 * here and checked again right before they are sent ({@link assertAllowed}):
 * `GET …/projects/{p}/models`, `GET …/projects/{p}/external-ids` and `POST
 * …/projects/{p}/imports` with `dryRun=true` built in (the server's dry run
 * writes nothing and takes no lock); anything else throws before a byte is
 * sent. Only an analyzr on this machine (127.0.0.1, ::1 or localhost, no user
 * name or password in the URL; {@link analyzrBase}), no redirects and no
 * proxy ({@link bypassEnvProxy}, {@link assertNoProxy}), so the credential
 * never leaves the machine. The credential is `ANALYZR_TOKEN` (an agent
 * token) or the owner key file, found and checked as the `analyzr` CLI does
 * (`apps/cli/src/credentials.ts`, the constants pinned by a test); it is
 * never printed, also not in an error, and the skill never reads it itself.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** The REST API's prefix (`API_PREFIX` of the contracts). */
export const API_PREFIX = '/api/v1';
/** Most items of one page (`MAX_PAGE_LIMIT` of the contracts). */
export const MAX_PAGE_LIMIT = 200;
export const OWNER_KEY_PREFIX = 'analyzr_ok_';
export const OWNER_KEY_PATTERN = /^analyzr_ok_[A-Za-z0-9_-]{43}$/;
export const OWNER_KEY_FILE_ENV = 'ANALYZR_OWNER_KEY_FILE';
export const AGENT_TOKEN_PREFIX = 'analyzr_at_';
export const AGENT_TOKEN_ENV = 'ANALYZR_TOKEN';
/** An agent token's shape: the prefix and base62 (`apps/server/src/domain/agent-token-secret.ts`). */
const AGENT_TOKEN_PATTERN = /^analyzr_at_[0-9A-Za-z]+$/;

/** How long one request may take (a dry run of 50 files on a large project takes seconds). */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
/** Most pages of `GET …/models` (10,000 models need 50). */
const MAX_PAGES = 1000;

/** Hosts the script talks to: this machine only. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]', 'localhost']);

/** A project key (`ProjectKey` of the contracts): one lowercase slug of at most 64 characters. */
const PROJECT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_SYSTEM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Thrown for a target, a credential or a request the script refuses. */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

/** Thrown for an answer of analyzr other than 2xx, with its problem's code. */
export class AnalyzrError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'AnalyzrError';
    this.status = status;
    this.code = code;
  }
}

/** True for a project key such as `kunde-x`. */
export function isProjectKey(value: string): boolean {
  return value.length <= 64 && PROJECT_KEY.test(value);
}

/** True for a source system such as `signavio`. */
export function isSourceSystem(value: string): boolean {
  return value.length <= 64 && SOURCE_SYSTEM.test(value);
}

/**
 * The origin of an analyzr on this machine, from `--url`: http(s) to
 * 127.0.0.1, [::1] or localhost on any port, without a user name or
 * password, a path, a query or a fragment.
 *
 * @throws {RefusedError} for any other URL
 */
export function analyzrBase(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RefusedError(
      `--url ${JSON.stringify(url)} is no URL; analyzr's URL is like http://127.0.0.1:7400`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RefusedError(`--url ${parsed.protocol} is refused: analyzr is reached over http(s)`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new RefusedError('--url with a user name or password is refused');
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new RefusedError(
      `--url ${parsed.hostname} is refused: analyzr-read talks to analyzr on this machine only (127.0.0.1, [::1], localhost), so the credential never leaves it`,
    );
  }
  if (
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new RefusedError(
      "--url is analyzr's origin only, like http://127.0.0.1:7400 (no path, query or fragment)",
    );
  }
  return new URL(parsed.origin);
}

/** Variables naming a proxy for Node's own proxy support. */
const PROXY_VARIABLES = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'];

/**
 * Turns Node's own proxy support off for this process: `NO_PROXY` and
 * `no_proxy` `*`, set before the first request. With `NODE_USE_ENV_PROXY=1`
 * or `--use-env-proxy` (in any spelling Node takes: `--use_env_proxy`,
 * `=true`, quoted in `NODE_OPTIONS`) Node tunnels even a request to
 * 127.0.0.1 through `HTTP(S)_PROXY`, which would see the credential; its
 * fetch reads `NO_PROXY` at each request (Node 24, pinned by a test).
 */
export function bypassEnvProxy(env: Record<string, string | undefined>): void {
  env['NO_PROXY'] = '*';
  env['no_proxy'] = '*';
}

/** Node's `--use-env-proxy` in an option list, in any spelling it takes (`_` for `-`, `=…`, quoted). */
const USE_ENV_PROXY = /(?:^|\s)--use-env-proxy(?:=\S*)?(?=\s|$)/;
const usesEnvProxy = (options: string): boolean =>
  USE_ENV_PROXY.test(options.replace(/["'\\]/g, '').replace(/_/g, '-'));

/**
 * Refuses to run while Node's proxy support is on (`NODE_USE_ENV_PROXY`, or
 * `--use-env-proxy` in the arguments or `NODE_OPTIONS`) with `HTTP_PROXY` or
 * `HTTPS_PROXY` set: the second guard next to {@link bypassEnvProxy}, for a
 * Node that read `NO_PROXY` once at its start. Any value but empty or `0`
 * counts as on, any spelling of the option too (a false refusal costs only
 * the fallback, the consultant's dry run).
 *
 * @throws {RefusedError} naming the variables, never their values
 */
export function assertNoProxy(
  env: Record<string, string | undefined>,
  execArgv: readonly string[],
): void {
  const flag = env['NODE_USE_ENV_PROXY'];
  const enabled =
    (flag !== undefined && flag !== '' && flag !== '0') ||
    usesEnvProxy(execArgv.join(' ')) ||
    usesEnvProxy(env['NODE_OPTIONS'] ?? '');
  const proxies = PROXY_VARIABLES.filter((v) => (env[v] ?? '') !== '');
  if (enabled && proxies.length > 0) {
    throw new RefusedError(
      `Node would send analyzr's credential through the proxy of ${proxies.join(', ')} (NODE_USE_ENV_PROXY or --use-env-proxy): run analyzr-read without them`,
    );
  }
}

export type Credential =
  { kind: 'owner-key'; secret: string; file: string } | { kind: 'agent-token'; secret: string };

/**
 * The default owner key file (`defaultOwnerKeyFile` of the contracts):
 * `$XDG_STATE_HOME/analyzr/owner-key` for an absolute `XDG_STATE_HOME`, else
 * `<home>/.local/state/analyzr/owner-key`.
 */
export function defaultOwnerKeyFile(env: Record<string, string | undefined>, home: string): string {
  const xdg = env['XDG_STATE_HOME'];
  const base =
    xdg !== undefined && xdg.startsWith('/') ? xdg : `${home.replace(/[\\/]+$/, '')}/.local/state`;
  return `${base.replace(/[\\/]+$/, '')}/analyzr/owner-key`;
}

/**
 * The credential, as the `analyzr` CLI picks it for a read or a dry run:
 * `ANALYZR_TOKEN` when set (an agent token; the owner key there is refused),
 * else the owner key from `ANALYZR_OWNER_KEY_FILE` (relative to `cwd`) or
 * the default file, a regular file of this OS user that group and others
 * cannot access, holding one `analyzr_ok_…` key.
 *
 * @throws {RefusedError} naming the file and what to do, never a secret
 */
export async function readCredential(
  env: Record<string, string | undefined>,
  home: string,
  cwd: string,
): Promise<Credential> {
  const token = env[AGENT_TOKEN_ENV];
  if (token !== undefined && token !== '') {
    if (token.startsWith(OWNER_KEY_PREFIX)) {
      throw new RefusedError(
        `${AGENT_TOKEN_ENV} holds the owner key, not an agent token; never put the owner key there`,
      );
    }
    // Checked in full, so a broken value never reaches a header (whose error would print it).
    if (!AGENT_TOKEN_PATTERN.test(token)) {
      throw new RefusedError(
        `${AGENT_TOKEN_ENV} is no agent token (${AGENT_TOKEN_PREFIX} and letters and digits only)`,
      );
    }
    return { kind: 'agent-token', secret: token };
  }
  const explicit = env[OWNER_KEY_FILE_ENV];
  const file = explicit ? path.resolve(cwd, explicit) : defaultOwnerKeyFile(env, home);
  let info;
  try {
    info = await stat(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new RefusedError(`cannot read the owner key ${file}: ${(err as Error).message}`);
    }
    throw new RefusedError(
      `no owner key at ${file} and no ${AGENT_TOKEN_ENV}: analyzr in Docker or the guard sandbox keeps the key out of reach; set ${AGENT_TOKEN_ENV} to a read token (analyzr token create -p <project> -n integrate-preview -s analyzr:read) or ${OWNER_KEY_FILE_ENV} to a copy of the key`,
    );
  }
  if (!info.isFile()) throw new RefusedError(`owner key ${file} is not a regular file`);
  if (process.platform !== 'win32') {
    const uid = process.getuid?.();
    if (uid !== undefined && info.uid !== uid) {
      throw new RefusedError(`owner key ${file} belongs to another OS user (uid ${info.uid})`);
    }
    if ((info.mode & 0o077) !== 0) {
      throw new RefusedError(
        `owner key ${file} is accessible by group or others (mode ${(info.mode & 0o777).toString(8)}); run: chmod 600 ${file}`,
      );
    }
  }
  const secret = (await readFile(file, 'utf8')).trim();
  if (!OWNER_KEY_PATTERN.test(secret))
    throw new RefusedError(`${file} does not hold an analyzr owner key`);
  return { kind: 'owner-key', secret, file };
}

/** The three requests the script can send. */
export type ReadRequest =
  | { kind: 'models'; project: string; cursor?: string }
  | { kind: 'external-ids'; project: string; system?: string }
  | { kind: 'dry-run'; project: string; body: FormData };

/** The dry run's query: a constant, never built from input. */
const DRY_RUN_QUERY = 'dryRun=true';

/** The method and URL of a request (the project and system checked). */
export function requestFor(base: URL, request: ReadRequest): { method: 'GET' | 'POST'; url: URL } {
  if (!isProjectKey(request.project)) {
    throw new RefusedError(`not a project key: ${JSON.stringify(request.project)}`);
  }
  const project = `${base.origin}${API_PREFIX}/projects/${request.project}`;
  switch (request.kind) {
    case 'models': {
      const url = new URL(`${project}/models`);
      url.searchParams.set('limit', String(MAX_PAGE_LIMIT));
      if (request.cursor !== undefined) url.searchParams.set('cursor', request.cursor);
      return { method: 'GET', url };
    }
    case 'external-ids': {
      const url = new URL(`${project}/external-ids`);
      if (request.system !== undefined) {
        if (!isSourceSystem(request.system)) {
          throw new RefusedError(`not a source system: ${JSON.stringify(request.system)}`);
        }
        url.searchParams.set('system', request.system);
      }
      return { method: 'GET', url };
    }
    case 'dry-run':
      return { method: 'POST', url: new URL(`${project}/imports?${DRY_RUN_QUERY}`) };
  }
}

const ALLOWED_GET = new RegExp(
  `^${API_PREFIX}/projects/[a-z0-9]+(?:-[a-z0-9]+)*/(models|external-ids)$`,
);
const ALLOWED_POST = new RegExp(`^${API_PREFIX}/projects/[a-z0-9]+(?:-[a-z0-9]+)*/imports$`);
const GET_QUERY: Readonly<Record<string, ReadonlySet<string>>> = {
  models: new Set(['limit', 'cursor']),
  'external-ids': new Set(['system']),
};

/**
 * Checks a request right before it is sent: to `base`, a GET of a project's
 * models or identities (with their query parameters only), or the POST of
 * an import with exactly `?dryRun=true`.
 *
 * @throws {RefusedError} for anything else
 */
export function assertAllowed(base: URL, method: string, url: URL): void {
  const refuse = () =>
    new RefusedError(`analyzr-read never sends ${method} ${url.pathname}${url.search}`);
  if (url.origin !== base.origin || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw refuse();
  }
  if (method === 'GET') {
    const what = ALLOWED_GET.exec(url.pathname)?.[1];
    const allowed = what === undefined ? undefined : GET_QUERY[what];
    if (allowed === undefined || [...url.searchParams.keys()].some((k) => !allowed.has(k))) {
      throw refuse();
    }
    return;
  }
  if (method === 'POST' && ALLOWED_POST.test(url.pathname) && url.search === `?${DRY_RUN_QUERY}`) {
    return;
  }
  throw refuse();
}

/** analyzr on this machine with a credential. */
export interface Analyzr {
  base: URL;
  credential: Credential;
  fetch?: typeof globalThis.fetch;
}

/** The problem's code and detail of an answer that is not 2xx, if it has them. */
async function problemOf(response: Response): Promise<{ code: string | null; text: string }> {
  try {
    const body = (await response.json()) as { code?: unknown; detail?: unknown; title?: unknown };
    const code = typeof body.code === 'string' ? body.code : null;
    const detail =
      typeof body.detail === 'string'
        ? body.detail
        : typeof body.title === 'string'
          ? body.title
          : '';
    return {
      code,
      text: `${code ?? ''}${detail === '' ? '' : `${code === null ? '' : ': '}${detail}`}`,
    };
  } catch {
    return { code: null, text: response.statusText };
  }
}

/**
 * Sends one of the three requests (checked by {@link assertAllowed}) and
 * returns its JSON; no redirect is followed.
 *
 * @param what the action, for messages ("list the models of kunde-x")
 * @throws {AnalyzrError} for an answer that is not 2xx
 * @throws {Error} when analyzr cannot be reached or redirects
 */
export async function send<T>(api: Analyzr, request: ReadRequest, what: string): Promise<T> {
  const { method, url } = requestFor(api.base, request);
  assertAllowed(api.base, method, url);
  let response: Response;
  try {
    response = await (api.fetch ?? globalThis.fetch)(url, {
      method,
      headers: { authorization: `Bearer ${api.credential.secret}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(request.kind === 'dry-run' ? { body: request.body } : {}),
    });
  } catch (err) {
    const cause =
      err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
    // Never the credential, should a message quote a header.
    const message = `${err instanceof Error ? err.message : String(err)}${cause}`
      .split(api.credential.secret)
      .join('…');
    throw new Error(
      `cannot ${what}: analyzr at ${api.base.origin} did not answer (${message}); redirects are refused`,
      { cause: err },
    );
  }
  if (!response.ok) {
    const problem = await problemOf(response);
    throw new AnalyzrError(
      `cannot ${what}: analyzr answered ${response.status}${problem.text === '' ? '' : ` ${problem.text}`}`,
      response.status,
      problem.code,
    );
  }
  return (await response.json()) as T;
}

/** Every live model of the project (all pages of `GET …/models`), as `analyzr models list --json` prints them. */
export async function listModels(api: Analyzr, project: string): Promise<unknown[]> {
  const models: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await send<{ items?: unknown; nextCursor?: unknown }>(
      api,
      { kind: 'models', project, ...(cursor === undefined ? {} : { cursor }) },
      `list the models of ${project}`,
    );
    if (!Array.isArray(result.items))
      throw new Error(`analyzr answered no page of models for ${project}`);
    models.push(...(result.items as unknown[]));
    if (typeof result.nextCursor !== 'string' || result.nextCursor === '') return models;
    cursor = result.nextCursor;
  }
  throw new Error(`more than ${MAX_PAGES} pages of models in ${project}`);
}

/** The source-system identity of every live model (`GET …/external-ids`), as `analyzr models external-ids --json` prints it. */
export async function listExternalIds(
  api: Analyzr,
  project: string,
  system?: string,
): Promise<{ items: unknown[] }> {
  const result = await send<{ items?: unknown }>(
    api,
    { kind: 'external-ids', project, ...(system === undefined ? {} : { system }) },
    `list the external ids of ${project}`,
  );
  if (!Array.isArray(result.items))
    throw new Error(`analyzr answered no list of identities for ${project}`);
  return { items: result.items as unknown[] };
}

/** `POST …/imports?dryRun=true` with the files (multipart `files`, the path as file name) and the manifest. */
export async function dryRunImport<T>(
  api: Analyzr,
  project: string,
  files: readonly { path: string; bytes: Uint8Array<ArrayBuffer> }[],
  manifest: string | null,
): Promise<T> {
  const body = new FormData();
  for (const f of files) body.append('files', new File([f.bytes], f.path));
  if (manifest !== null) body.append('manifest', manifest);
  return send<T>(api, { kind: 'dry-run', project, body }, `preview the import into ${project}`);
}
