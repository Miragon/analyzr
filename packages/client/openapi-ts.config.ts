import { defineConfig } from '@hey-api/openapi-ts';

// `pnpm --filter @analyzr/client generate`: openapi.json (written from
// @analyzr/contracts by scripts/write-openapi.ts) → src/generated. Imports use
// `.ts` so Node's type stripping can run the client without a build (CLI).
export default defineConfig({
  input: './openapi.json',
  output: {
    path: './src/generated',
    module: { extension: '.ts' },
  },
  plugins: ['@hey-api/client-fetch', '@hey-api/typescript', '@hey-api/sdk'],
});
