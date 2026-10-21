import type { Command } from 'commander';

import { CLI_MAIN } from './cli-main.ts';
import { CLI_COMMAND } from './commands/import.ts';
import { mcpCommand } from './commands/mcp.ts';
import { SEED_TOKEN_NAME, seedCommand } from './commands/seed.ts';
import { buildCoreProgram, globalOptions, runProgram } from './core-program.ts';
import { processIo, type CliIo } from './io.ts';

/**
 * Builds the `analyzr` command tree of the checkout and the container: the
 * core program (`core-program.ts`, every command the integrate plugin's
 * bundled CLI shares) and then `mcp` and `seed`. Global options: `--url`
 * (`ANALYZR_URL`, default http://127.0.0.1:7400), `--token`
 * (`ANALYZR_TOKEN`, an agent token) and `--owner-key-file`
 * (`ANALYZR_OWNER_KEY_FILE`).
 */
export function buildProgram(io: CliIo = processIo): Command {
  const program = buildCoreProgram(io, {
    description:
      'analyzr command line: seed, import, list, requeue, delete, amend and pull models, list, export, answer and act on open questions, list, export and withdraw model amendments, push and pull the value chain, manage agent tokens and auto-accept rules, bridge MCP over stdio',
    commandName: () => CLI_COMMAND,
    mcpEntry: CLI_MAIN,
    ownerKeyLoopbackOnly: false,
  });
  const globals = () => globalOptions(program, io);

  program
    .command('mcp')
    .description(
      'MCP stdio bridge to <url>/mcp with ANALYZR_TOKEN (for Claude Desktop and other stdio-only clients)',
    )
    .action(() => mcpCommand(io, globals()));

  program
    .command('seed')
    .description(
      'create one project per eval landscape and import its models (default: every scored landscape); --value-chains also creates its golden value chain',
    )
    .argument('[landscape...]', 'landscape names, e.g. nordwind-handel stadtwerke-auental')
    .option('--corpus <dir>', 'corpus directory (default: eval/corpus of this checkout)')
    .option(
      '-p, --project <key>',
      'seed exactly one landscape into a new project with this key, named "<landscape name> (<key>)" (a fresh project per live run; an existing one is refused)',
    )
    .option('--issue-tokens', 'also create a read+propose agent token per project')
    .option(
      '--token-name <name>',
      `name of the tokens --issue-tokens creates (default ${SEED_TOKEN_NAME}); eval:live records under it`,
    )
    .option(
      '--value-chains',
      "also create each landscape's golden value chain from eval/value-chains, without placements (an existing chain is never overwritten)",
    )
    .option(
      '--value-chains-dir <dir>',
      'golden value chains directory (default: eval/value-chains of this checkout)',
    )
    .option('--verbose', 'list every imported file')
    .option('--json', 'print JSON')
    .action(
      (
        landscapes: string[],
        opts: {
          corpus?: string;
          project?: string;
          issueTokens?: boolean;
          tokenName?: string;
          valueChains?: boolean;
          valueChainsDir?: string;
          verbose?: boolean;
          json?: boolean;
        },
      ) => seedCommand(io, landscapes, { ...globals(), ...opts }),
    );

  return program;
}

/**
 * Runs the CLI and returns the process exit code; never throws. `build`
 * makes the program (default {@link buildProgram}).
 */
export async function runCli(
  argv: readonly string[],
  io: CliIo = processIo,
  build: (io: CliIo) => Command = buildProgram,
): Promise<number> {
  return runProgram(argv, io, build);
}
