import {
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
  type CreatedAgentToken,
} from '@analyzr/client';
import { AGENT_TOKEN_MAX_DAYS, AgentScope } from '@analyzr/contracts';

import { call, createApi, type Api } from '../api.ts';
import { ownerCredential, type CredentialOptions } from '../credentials.ts';
import { CliError } from '../errors.ts';
import type { CliIo } from '../io.ts';
import { claudeCodeCommand, claudeDesktopConfig } from '../mcp-config.ts';

export const DEFAULT_SCOPES: readonly AgentScope[] = ['analyzr:read', 'analyzr:propose'];

/**
 * Parses scopes given as `analyzr:read`, `read`, or comma-separated lists
 * (`read,propose`). `analyzr:review` is never valid for agent tokens.
 *
 * @throws {CliError} for unknown scopes
 */
export function parseScopes(values: readonly string[]): AgentScope[] {
  const scopes = new Set<AgentScope>();
  for (const raw of values.flatMap((v) => v.split(',')).map((v) => v.trim())) {
    if (raw === '') continue;
    const parsed = AgentScope.safeParse(raw.includes(':') ? raw : `analyzr:${raw}`);
    if (!parsed.success) {
      throw new CliError(
        `unknown scope ${JSON.stringify(raw)}; agent tokens take ${AgentScope.options.join(', ')}`,
      );
    }
    scopes.add(parsed.data);
  }
  if (scopes.size === 0) throw new CliError('give at least one scope');
  return AgentScope.options.filter((s) => scopes.has(s));
}

/**
 * Parses an expiry such as `90d`, `12w` or `90` (days) into days (1–365).
 *
 * @throws {CliError} for other forms or out-of-range values
 */
export function parseExpiry(value: string): number {
  const m = /^\s*(\d{1,4})\s*([dw]?)\s*$/i.exec(value);
  const days = m?.[1] ? Number(m[1]) * (m[2]?.toLowerCase() === 'w' ? 7 : 1) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > AGENT_TOKEN_MAX_DAYS) {
    throw new CliError(
      `invalid expiry ${JSON.stringify(value)}: use days such as 90d (1–${AGENT_TOKEN_MAX_DAYS} days) or weeks such as 12w`,
    );
  }
  return days;
}

export interface TokenOptions extends CredentialOptions {
  url: string;
  project: string;
}

export interface TokenCreateOptions extends TokenOptions {
  name: string;
  scopes: string[];
  expires: string;
  json?: boolean;
  /** The CLI entry of the Claude Desktop configuration ({@link formatCreatedToken}). */
  mcpEntry: string | null;
}

/**
 * Said instead of a Claude Desktop configuration by the integrate plugin's
 * bundled CLI outside the container (M6 S3c): it has no `mcp`, so a
 * configuration would name a file that does not exist.
 */
export const NO_STDIO_BRIDGE =
  "Claude Desktop: the stdio bridge needs analyzr mcp from an analyzr checkout or the container (docs/DEVELOPMENT.md); the plugin's analyzr.mjs has no mcp";

/** Creates an agent token as the owner; returns it including its secret. */
export async function createToken(
  api: Api,
  project: string,
  body: { name: string; scopes: AgentScope[]; expiresInDays: number },
): Promise<CreatedAgentToken> {
  return call(
    api,
    `create an agent token in ${project}`,
    createAgentToken({ client: api.client, path: { project }, body }),
  );
}

/**
 * Text shown once after creating a token: the secret and client
 * configurations, for Claude Desktop the `docker exec` bridge inside the
 * container (`ANALYZR_CONTAINER`), else `mcp` of `mcpEntry`; with `null`
 * (the bundled CLI, M6 S3c) {@link NO_STDIO_BRIDGE} instead.
 */
export function formatCreatedToken(
  io: CliIo,
  url: string,
  project: string,
  token: CreatedAgentToken,
  mcpEntry: string | null,
): string {
  const target = {
    url,
    token: token.secret,
    node: process.execPath,
    entry: mcpEntry ?? undefined,
    container: io.env['ANALYZR_CONTAINER'],
  };
  const desktop =
    target.container || target.entry !== undefined
      ? [
          'Claude Desktop (claude_desktop_config.json):',
          ...(target.container
            ? [
                '  Claude Desktop starts it without your shell PATH: replace "docker" with its',
                '  absolute path (`which docker`, on macOS usually /usr/local/bin/docker).',
              ]
            : []),
          claudeDesktopConfig(target)
            .split('\n')
            .map((l) => `  ${l}`)
            .join('\n'),
        ]
      : [NO_STDIO_BRIDGE];
  return [
    `Agent token "${token.name}" for project ${project}`,
    `  id       ${token.id}`,
    `  scopes   ${token.scopes.join(' ')}`,
    `  expires  ${token.expiresAt}`,
    '',
    token.secret,
    '',
    'The secret is shown only now. Connect an MCP client:',
    '',
    'Claude Code:',
    `  ${claudeCodeCommand(target)}`,
    '',
    ...desktop,
    '',
  ].join('\n');
}

/** `analyzr token create --project <p> [--name] [--scopes …] [--expires 90d] [--json]`. */
export async function tokenCreateCommand(io: CliIo, opts: TokenCreateOptions): Promise<void> {
  const body = {
    name: opts.name,
    scopes: parseScopes(opts.scopes),
    expiresInDays: parseExpiry(opts.expires),
  };
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const token = await createToken(api, opts.project, body);
  io.stdout(
    opts.json
      ? `${JSON.stringify(token, null, 2)}\n`
      : formatCreatedToken(io, opts.url, opts.project, token, opts.mcpEntry),
  );
}

/** `analyzr token list --project <p> [--json]`. */
export async function tokenListCommand(
  io: CliIo,
  opts: TokenOptions & { json?: boolean },
): Promise<void> {
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const { items } = await call(
    api,
    `list agent tokens of ${opts.project}`,
    listAgentTokens({ client: api.client, path: { project: opts.project } }),
  );
  if (opts.json) {
    io.stdout(`${JSON.stringify(items, null, 2)}\n`);
    return;
  }
  if (items.length === 0) {
    io.stdout(`no agent tokens in ${opts.project}\n`);
    return;
  }
  for (const t of items) {
    const state = t.revokedAt ? `revoked ${t.revokedAt}` : `expires ${t.expiresAt}`;
    const used = t.lastUsedAt ? `last used ${t.lastUsedAt}` : 'never used';
    io.stdout(
      `${t.id}  analyzr_at_${t.prefix}…  ${t.name}  [${t.scopes.join(' ')}]  ${state}, ${used}\n`,
    );
  }
}

/** `analyzr token revoke --project <p> <id>`. */
export async function tokenRevokeCommand(io: CliIo, id: string, opts: TokenOptions): Promise<void> {
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  await call(
    api,
    `revoke agent token ${id}`,
    revokeAgentToken({ client: api.client, path: { project: opts.project, token: id } }),
  );
  io.stdout(`revoked ${id}\n`);
}
