import { ANALYZR_DEFAULT_PORT } from './limits';

/**
 * Ready-to-paste MCP client configurations for the "Agent verbinden" page
 * (CONCEPT §6, local mode). Every client reaches `/mcp` with an agent token;
 * stdio-only clients such as Claude Desktop start the `analyzr mcp` bridge.
 */

/** Placeholder shown while no token secret is at hand. */
export const TOKEN_PLACEHOLDER = 'analyzr_at_…';

/** Compose project `analyzr`, service `server` (docker/compose.yaml). */
export const DOCKER_CONTAINER = 'analyzr-server-1';

/** Placeholder for the repository checkout in the Claude Desktop snippet. */
export const CHECKOUT_PLACEHOLDER = '/pfad/zu/analyzr';

/**
 * The server origin MCP clients use. In production the server serves the UI,
 * so it is the page's origin; under the Vite dev server (port 7401) it is the
 * server on 7400.
 */
export function serverOrigin(
  location: Pick<Location, 'protocol' | 'hostname' | 'port'>,
  dev: boolean,
): string {
  const host = location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname;
  const port = dev ? String(ANALYZR_DEFAULT_PORT) : location.port;
  return `${location.protocol}//${host}${port ? `:${port}` : ''}`;
}

export function mcpUrl(origin: string): string {
  return `${origin}/mcp`;
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Claude Code: HTTP transport with the token from the environment. */
export function claudeCodeCommand(origin: string, secret: string | null): string {
  return [
    `export ANALYZR_TOKEN=${shellQuote(secret ?? TOKEN_PLACEHOLDER)}`,
    `claude mcp add --transport http analyzr ${mcpUrl(origin)} --header "Authorization: Bearer \${ANALYZR_TOKEN}"`,
  ].join('\n');
}

/**
 * Claude Desktop (stdio only): `analyzr mcp` from the repository checkout with
 * Node 24. Desktop has no shell `PATH`, so `node` is best an absolute path.
 */
export function claudeDesktopNodeConfig(
  origin: string,
  secret: string | null,
  checkout: string,
  nodeCommand = 'node',
): string {
  const root = (checkout.trim() || CHECKOUT_PLACEHOLDER).replace(/\/+$/, '');
  return JSON.stringify(
    {
      mcpServers: {
        analyzr: {
          command: nodeCommand.trim() || 'node',
          args: [`${root}/apps/cli/src/main.ts`, 'mcp'],
          env: { ANALYZR_URL: origin, ANALYZR_TOKEN: secret ?? TOKEN_PLACEHOLDER },
        },
      },
    },
    null,
    2,
  );
}

/**
 * Claude Desktop (stdio only): `analyzr mcp` inside the analyzr container, where
 * the bridge reaches the server at its default http://127.0.0.1:7400;
 * `-e ANALYZR_TOKEN` hands the token from `env` through to the bridge.
 * Claude Desktop has no shell `PATH` on macOS, so `dockerCommand` should be
 * absolute (`which docker`, usually /usr/local/bin/docker).
 */
export function claudeDesktopDockerConfig(secret: string | null, dockerCommand = 'docker'): string {
  return JSON.stringify(
    {
      mcpServers: {
        analyzr: {
          command: dockerCommand.trim() || 'docker',
          args: ['exec', '-i', '-e', 'ANALYZR_TOKEN', DOCKER_CONTAINER, 'analyzr', 'mcp'],
          env: { ANALYZR_TOKEN: secret ?? TOKEN_PLACEHOLDER },
        },
      },
    },
    null,
    2,
  );
}

/** Any MCP client with Streamable HTTP and custom headers (`.mcp.json` shape). */
export function genericMcpConfig(origin: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        analyzr: {
          type: 'http',
          url: mcpUrl(origin),
          headers: { Authorization: 'Bearer ${ANALYZR_TOKEN}' },
        },
      },
    },
    null,
    2,
  );
}
