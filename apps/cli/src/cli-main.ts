import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the checkout's CLI entry point (`apps/cli/src/main.ts`),
 * which Claude Desktop starts `analyzr mcp` with. A module of its own: the
 * integrate plugin's bundled CLI has no `mcp` and must not carry this path
 * (M6 S3c), while `mcp-config.ts` is in its bundle.
 */
export const CLI_MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
