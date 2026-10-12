import { defineConfig } from 'vitest/config';

// Unit tests only: the policy, the recorder, the CLI and the agent loop
// against an in-memory MCP server. The end-to-end run against a real analyzr
// (PostgreSQL, real libraries, HTTP and the `analyzr mcp` bridge) is the server
// integration test apps/server/test/integration/agent-sim.test.ts.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
