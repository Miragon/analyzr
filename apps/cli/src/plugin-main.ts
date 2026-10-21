// The entry of the integrate plugin's bundled CLI `scripts/analyzr.mjs` (M6 S3c, owner
// decision 30 (3)): the core program (every command of `analyzr` but `seed` and `mcp`), whose
// next steps name `node <this file> --url <url>` and which sends the
// owner key only to analyzr on this machine. Node 24 runs it from source as well (type stripping), as the parity tests do; no
// shebang, since the bundle's banner writes one.
import { buildPluginProgram, runProgram } from './core-program.ts';
import { processIo } from './io.ts';

process.exitCode = await runProgram(process.argv.slice(2), processIo, (io) =>
  buildPluginProgram(io, process.argv[1] ?? 'analyzr.mjs'),
);
