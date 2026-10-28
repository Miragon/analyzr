import { defineConfig } from 'vitest/config';

// Many tests run the entries as child processes from source (Node strips the types on every
// start), and the converter runner's tests start a sandboxed child of their own: beside the
// other packages' suites on a CI runner that outlasts vitest's default 5 s.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
