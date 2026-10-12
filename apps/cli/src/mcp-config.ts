/**
 * Ready-made MCP client configurations for an agent token (CONCEPT §6):
 * Claude Code over HTTP, Claude Desktop through the `analyzr mcp` stdio bridge.
 */
import { fileURLToPath } from 'node:url';

/** Absolute path of the CLI entry point (`apps/cli/src/main.ts`). */
export const CLI_MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

export interface McpConfigTarget {
  /** Server origin as the MCP client reaches it, e.g. `http://127.0.0.1:7400`. */
  url: string;
  token: string;
  /** Absolute path of the Node.js binary (Claude Desktop has no shell PATH). */
  node: string;
  /**
   * Name of the analyzr container when the CLI runs inside it (`ANALYZR_CONTAINER`);
   * Claude Desktop then starts the bridge with `docker exec`.
   */
  container?: string | undefined;
}

export function claudeCodeCommand(t: McpConfigTarget): string {
  return `claude mcp add --transport http analyzr ${t.url.replace(/\/+$/, '')}/mcp --header "Authorization: Bearer ${t.token}"`;
}

/** The `mcpServers.analyzr` entry of `claude_desktop_config.json`. */
export function claudeDesktopServer(t: McpConfigTarget): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  if (t.container) {
    return {
      command: 'docker',
      args: ['exec', '-i', '-e', 'ANALYZR_TOKEN', t.container, 'analyzr', 'mcp'],
      env: { ANALYZR_TOKEN: t.token },
    };
  }
  return {
    command: t.node,
    args: [CLI_MAIN, 'mcp'],
    env: { ANALYZR_URL: t.url, ANALYZR_TOKEN: t.token },
  };
}

export function claudeDesktopConfig(t: McpConfigTarget): string {
  return JSON.stringify({ mcpServers: { analyzr: claudeDesktopServer(t) } }, null, 2);
}
