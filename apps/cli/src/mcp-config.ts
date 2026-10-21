/**
 * Ready-made MCP client configurations for an agent token (CONCEPT §6):
 * Claude Code over HTTP, Claude Desktop through the `analyzr mcp` stdio bridge.
 */
export interface McpConfigTarget {
  /** Server origin as the MCP client reaches it, e.g. `http://127.0.0.1:7400`. */
  url: string;
  token: string;
  /** Absolute path of the Node.js binary (Claude Desktop has no shell PATH). */
  node: string;
  /**
   * Absolute path of the CLI entry Claude Desktop starts `mcp` with
   * (`CLI_MAIN` of the checkout); needed unless `container` is set.
   */
  entry?: string | undefined;
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
  if (t.entry === undefined) throw new Error('the stdio bridge needs the CLI entry it starts');
  return {
    command: t.node,
    args: [t.entry, 'mcp'],
    env: { ANALYZR_URL: t.url, ANALYZR_TOKEN: t.token },
  };
}

export function claudeDesktopConfig(t: McpConfigTarget): string {
  return JSON.stringify({ mcpServers: { analyzr: claudeDesktopServer(t) } }, null, 2);
}
