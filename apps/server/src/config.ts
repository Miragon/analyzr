import { existsSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_DEMO_LINK_LENGTH, defaultOwnerKeyFile } from '@analyzr/contracts';
import { z } from 'zod';

/** Default database: the Compose service `db` of docker/compose.yaml (project `analyzr`). */
export const DEFAULT_DATABASE_URL = 'postgres://analyzr:analyzr@127.0.0.1:55432/analyzr';

/** Built web UI next to the server in the workspace (`apps/web/dist`). */
const WORKSPACE_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

const EnvSchema = z.object({
  ANALYZR_PORT: z.coerce.number().int().min(0).max(65535).default(7400),
  ANALYZR_HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).default(DEFAULT_DATABASE_URL),
  /** v1 knows only `local` (CONCEPT §6); `oidc` arrives with server mode (R1). */
  ANALYZR_AUTH: z.enum(['local']).default('local'),
  /** Directory of the built web UI; empty string disables static serving. */
  ANALYZR_WEB_DIST: z.string().optional(),
  /** Run pending migrations at startup (`auto`) or not (`off`). */
  ANALYZR_MIGRATE: z.enum(['auto', 'off']).default('auto'),
  /**
   * Ports a browser `Origin` on localhost may have (comma-separated). Default:
   * `ANALYZR_PORT` and the Vite dev server (7401). Add the host port when Docker
   * publishes analyzr on another one.
   */
  ANALYZR_ORIGIN_PORTS: z
    .string()
    .regex(/^\s*\d{1,5}\s*(,\s*\d{1,5}\s*)*$/, 'comma-separated port numbers')
    .optional(),
  /** Key for session cookies (≥ 32 characters); default: random per process. */
  ANALYZR_SESSION_SECRET: z.string().min(32).optional(),
  /**
   * File of the local owner key (the CLI's credential), created on first
   * start; default `$XDG_STATE_HOME/analyzr/owner-key` or
   * `~/.local/state/analyzr/owner-key`. Empty string: no owner key.
   */
  ANALYZR_OWNER_KEY_FILE: z.string().optional(),
  /**
   * Local mode binds to loopback only (CONCEPT §6). `1` allows another
   * `ANALYZR_HOST`, for a container that listens on 0.0.0.0 while its port is
   * published on 127.0.0.1 only (docker/compose.yaml); the server warns.
   */
  ANALYZR_ALLOW_NON_LOOPBACK: z.enum(['0', '1']).default('0'),
  /**
   * `readonly`: the public read-only demo (owner decision 20, CONCEPT §6): every write
   * answers 403 `demo-readonly`, the session is a viewer, MCP, agent tokens
   * and the owner key are off. Unset: local mode, unchanged.
   */
  ANALYZR_DEMO: z.enum(['readonly']).optional(),
  /**
   * The demo's public origins (comma-separated, e.g. `https://analyzr-demo.fly.dev`):
   * the Host and Origin checks accept them instead of localhost. Demo only.
   */
  ANALYZR_PUBLIC_ORIGIN: z.string().optional(),
  /**
   * The demo operator's legal notice (Impressum) and privacy policy, absolute
   * https URLs: `/health` reports them and the web UI's banner links them.
   * Optional, demo only.
   */
  ANALYZR_DEMO_IMPRINT_URL: z.string().optional(),
  ANALYZR_DEMO_PRIVACY_URL: z.string().optional(),
});

type Env = z.infer<typeof EnvSchema>;

/** True for `localhost`, `::1` (also bracketed) and 127.0.0.0/8. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || (isIPv4(h) && h.startsWith('127.'));
}

/** Port of the Vite dev server (`pnpm dev`), an allowed origin by default. */
export const VITE_DEV_PORT = 7401;

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  authMode: 'local';
  /** Absolute path of the built web UI, or `null` if there is none. */
  webDist: string | null;
  migrateOnStart: boolean;
  /** Ports accepted in a localhost `Origin` header. */
  originPorts: number[];
  /** Key for session cookies; `null`: random per process. */
  sessionSecret: string | null;
  /** Absolute path of the local owner key file; `null`: the CLI cannot act as the owner. */
  ownerKeyFile: string | null;
  /** `ANALYZR_ALLOW_NON_LOOPBACK=1`: local mode may bind a non-loopback `host`. */
  allowNonLoopback: boolean;
  /**
   * `ANALYZR_DEMO=readonly` (owner decision 20): the read-only demo and the public origins
   * it is served from; `null` in local mode.
   */
  demo: DemoConfig | null;
}

/** The read-only demo (`ANALYZR_DEMO=readonly`). */
export interface DemoConfig {
  /** Canonical origins (`https://host[:port]`, or `http://` on a loopback host), deduplicated. */
  publicOrigins: string[];
  /** The operator's legal notice (`ANALYZR_DEMO_IMPRINT_URL`, normalized); absent when unset. */
  imprintUrl?: string;
  /** The operator's privacy policy (`ANALYZR_DEMO_PRIVACY_URL`, normalized); absent when unset. */
  privacyUrl?: string;
}

/** The demo's optional legal links: setting name → {@link DemoConfig} field. */
const DEMO_LINK_SETTINGS = [
  ['ANALYZR_DEMO_IMPRINT_URL', 'imprintUrl'],
  ['ANALYZR_DEMO_PRIVACY_URL', 'privacyUrl'],
] as const;

/** Thrown for invalid environment variables; the message lists every problem. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Reads the server configuration from environment variables:
 * `ANALYZR_PORT` (7400), `ANALYZR_HOST` (127.0.0.1), `DATABASE_URL`
 * ({@link DEFAULT_DATABASE_URL}), `ANALYZR_AUTH` (`local`), `ANALYZR_WEB_DIST`
 * (default `apps/web/dist` if it exists), `ANALYZR_MIGRATE` (`auto`),
 * `ANALYZR_ORIGIN_PORTS` (`ANALYZR_PORT,7401`), `ANALYZR_SESSION_SECRET` (random),
 * `ANALYZR_OWNER_KEY_FILE` (`~/.local/state/analyzr/owner-key`),
 * `ANALYZR_ALLOW_NON_LOOPBACK` (`0`), and for the read-only demo `ANALYZR_DEMO`
 * (unset), `ANALYZR_PUBLIC_ORIGIN`, `ANALYZR_DEMO_IMPRINT_URL` and
 * `ANALYZR_DEMO_PRIVACY_URL` (demo only; the last two optional).
 *
 * @throws {ConfigError} if a variable is invalid, if local mode would bind a
 *   non-loopback address without `ANALYZR_ALLOW_NON_LOOPBACK=1`, if
 *   `ANALYZR_PUBLIC_ORIGIN` or a legal link is set outside the demo, or if the
 *   demo is combined with anything that would let a visitor write
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`invalid configuration:\n  ${lines.join('\n  ')}`);
  }
  const e = parsed.data;
  if (e.ANALYZR_DEMO === 'readonly') return loadDemoConfig(e, env);
  if (e.ANALYZR_PUBLIC_ORIGIN !== undefined) {
    throw new ConfigError(
      'ANALYZR_PUBLIC_ORIGIN is set without ANALYZR_DEMO=readonly: only the read-only demo has a public ' +
        'origin (server mode with a login is R1). Local mode serves localhost only.',
    );
  }
  const links = DEMO_LINK_SETTINGS.map(([name]) => name).filter((name) => e[name] !== undefined);
  if (links.length > 0) {
    throw new ConfigError(
      `${links.join(' and ')} ${links.length === 1 ? 'is' : 'are'} set without ANALYZR_DEMO=readonly: ` +
        'only the public read-only demo links its operator’s legal pages. Local mode serves localhost only.',
    );
  }
  const allowNonLoopback = e.ANALYZR_ALLOW_NON_LOOPBACK === '1';
  if (e.ANALYZR_AUTH === 'local' && !isLoopbackHost(e.ANALYZR_HOST) && !allowNonLoopback) {
    throw new ConfigError(
      [
        `ANALYZR_HOST=${e.ANALYZR_HOST} is not a loopback address. Local mode has no login: whoever`,
        'reaches the port can open an owner session, so it listens on 127.0.0.1 only (CONCEPT §6).',
        'Unset ANALYZR_HOST, or, in a container whose port is published on 127.0.0.1 only',
        '(docker run -p 127.0.0.1:7400:7400 …, as docker/compose.yaml does), set ANALYZR_ALLOW_NON_LOOPBACK=1.',
      ].join('\n  '),
    );
  }
  return {
    port: e.ANALYZR_PORT,
    host: e.ANALYZR_HOST,
    databaseUrl: e.DATABASE_URL,
    authMode: e.ANALYZR_AUTH,
    webDist: webDistOf(e),
    migrateOnStart: e.ANALYZR_MIGRATE === 'auto',
    originPorts: e.ANALYZR_ORIGIN_PORTS
      ? [...new Set(e.ANALYZR_ORIGIN_PORTS.split(',').map((p) => Number(p.trim())))]
      : [...new Set([e.ANALYZR_PORT, VITE_DEV_PORT])],
    sessionSecret: e.ANALYZR_SESSION_SECRET ?? null,
    ownerKeyFile:
      e.ANALYZR_OWNER_KEY_FILE === undefined
        ? defaultOwnerKeyFile(env, os.homedir())
        : e.ANALYZR_OWNER_KEY_FILE === ''
          ? null
          : path.resolve(e.ANALYZR_OWNER_KEY_FILE),
    allowNonLoopback,
    demo: null,
  };
}

function webDistOf(e: Env): string | null {
  if (e.ANALYZR_WEB_DIST === undefined) {
    return existsSync(path.join(WORKSPACE_WEB_DIST, 'index.html')) ? WORKSPACE_WEB_DIST : null;
  }
  return e.ANALYZR_WEB_DIST === '' ? null : path.resolve(e.ANALYZR_WEB_DIST);
}

/**
 * Parses `ANALYZR_PUBLIC_ORIGIN`: comma-separated origins, each exactly in its
 * canonical form (`new URL(o).origin === o`: lower-case host, no default
 * port, no path, query or trailing slash), `https:`, or `http:` on a
 * loopback host for local runs of the demo image.
 *
 * @returns the deduplicated origins, or the problems found
 */
export function parsePublicOrigins(value: string): { origins: string[]; problems: string[] } {
  const origins: string[] = [];
  const problems: string[] = [];
  for (const raw of value.split(',').map((o) => o.trim())) {
    if (raw === '') {
      problems.push('an empty origin');
      continue;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      problems.push(`${raw}: not a URL`);
      continue;
    }
    if (url.origin !== raw) {
      problems.push(`${raw}: write the bare origin ${url.origin} (no path, no trailing slash)`);
    } else if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && isLoopbackHost(url.hostname))
    ) {
      problems.push(`${raw}: must be https (http only on a loopback host)`);
    } else if (!origins.includes(raw)) {
      origins.push(raw);
    }
  }
  return { origins, problems };
}

/**
 * Parses a legal link of the demo (`ANALYZR_DEMO_IMPRINT_URL`,
 * `ANALYZR_DEMO_PRIVACY_URL`): an absolute `https:` URL without credentials, at
 * most {@link MAX_DEMO_LINK_LENGTH} characters once normalized.
 *
 * @returns the normalized URL (`URL.href`), or the problem found
 */
export function parseDemoLink(value: string): { url: string } | { problem: string } {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { problem: `${raw === '' ? 'empty' : raw}: not an absolute URL` };
  }
  if (url.protocol !== 'https:') return { problem: `${raw}: must be https` };
  if (url.username !== '' || url.password !== '') {
    return { problem: `${url.host}: must not carry a user name or password` };
  }
  if (url.href.length > MAX_DEMO_LINK_LENGTH) {
    return { problem: `longer than ${MAX_DEMO_LINK_LENGTH} characters` };
  }
  return { url: url.href };
}

/**
 * The read-only demo (owner decision 20): a variant of local mode for public hosting.
 * It needs its public origins and refuses everything that would let a
 * visitor write or act as the owner: an owner key file, extra localhost
 * origin ports, `ANALYZR_ALLOW_NON_LOOPBACK` (a non-loopback `ANALYZR_HOST` needs
 * no opt-in here, since nothing can be changed), and migrations at start
 * (the database is prepared before; `ANALYZR_MIGRATE` defaults to `off`).
 * The operator's legal links are optional and reported by `/health`.
 */
function loadDemoConfig(e: Env, env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  const { origins, problems: originProblems } =
    e.ANALYZR_PUBLIC_ORIGIN === undefined
      ? {
          origins: [],
          problems: ['ANALYZR_PUBLIC_ORIGIN is required (e.g. https://analyzr-demo.fly.dev)'],
        }
      : parsePublicOrigins(e.ANALYZR_PUBLIC_ORIGIN);
  problems.push(
    ...originProblems.map((p) => (p.startsWith('ANALYZR_') ? p : `ANALYZR_PUBLIC_ORIGIN: ${p}`)),
  );
  if (origins.length === 0 && originProblems.length === 0) {
    problems.push('ANALYZR_PUBLIC_ORIGIN names no origin');
  }
  if (env['ANALYZR_OWNER_KEY_FILE'] !== undefined && env['ANALYZR_OWNER_KEY_FILE'] !== '') {
    problems.push('ANALYZR_OWNER_KEY_FILE: the demo has no owner key; leave it unset or empty');
  }
  if (env['ANALYZR_ORIGIN_PORTS'] !== undefined) {
    problems.push(
      'ANALYZR_ORIGIN_PORTS: localhost origins are local mode; use ANALYZR_PUBLIC_ORIGIN',
    );
  }
  if (e.ANALYZR_ALLOW_NON_LOOPBACK === '1') {
    problems.push('ANALYZR_ALLOW_NON_LOOPBACK=1 is a local-mode opt-in; the demo needs none');
  }
  if (env['ANALYZR_MIGRATE'] === 'auto') {
    problems.push(
      'ANALYZR_MIGRATE=auto: the demo database is read-only and migrated before; leave it unset or off',
    );
  }
  const links: Pick<DemoConfig, 'imprintUrl' | 'privacyUrl'> = {};
  for (const [name, field] of DEMO_LINK_SETTINGS) {
    const value = e[name];
    if (value === undefined) continue;
    const link = parseDemoLink(value);
    if ('problem' in link) problems.push(`${name}: ${link.problem}`);
    else links[field] = link.url;
  }
  if (problems.length > 0) {
    throw new ConfigError(
      `invalid read-only demo configuration (ANALYZR_DEMO=readonly):\n  ${problems.join('\n  ')}`,
    );
  }
  return {
    port: e.ANALYZR_PORT,
    host: e.ANALYZR_HOST,
    databaseUrl: e.DATABASE_URL,
    authMode: e.ANALYZR_AUTH,
    webDist: webDistOf(e),
    migrateOnStart: false,
    originPorts: [],
    sessionSecret: e.ANALYZR_SESSION_SECRET ?? null,
    ownerKeyFile: null,
    allowNonLoopback: false,
    demo: { publicOrigins: origins, ...links },
  };
}
