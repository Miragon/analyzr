// Shared helpers of the script entries: JSON on stdout, errors on stderr, exit codes
// 0 (done), 1 (the work failed) and 2 (usage error).
import { parseArgs, type ParseArgsConfig } from 'node:util';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Parses `argv` strictly; unknown options and missing values are usage errors. */
export function parse<T extends ParseArgsConfig['options']>(
  argv: readonly string[],
  options: T,
): ReturnType<typeof parseArgs<{ args: string[]; options: T; allowPositionals: true }>> {
  try {
    return parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}

/** Runs a script's main function with the exit codes above. */
export function run(name: string, usage: string, main: () => Promise<void>): void {
  main().then(
    () => {
      process.exitCode ??= 0;
    },
    (err: unknown) => {
      if (err instanceof UsageError) {
        process.stderr.write(`${name}: ${err.message}\n\n${usage}`);
        process.exitCode = 2;
        return;
      }
      process.stderr.write(`${name}: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    },
  );
}
