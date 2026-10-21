// Entry of analyzr-convert (M6 S3c §4): runs one ad-hoc converter the consultant approved, bound
// to its full sha256, on one export, and writes analyzr-spec/1 files and the run record for
// analyzr-spec. The only script that executes code an agent wrote: it runs it in a child Node
// under the permission model, without write access, environment or file access of its own.
// Bundled into the plugin as scripts/analyzr-convert.mjs from the release that ships it on; until
// then run from source (node tools/integrate/src/cli/analyzr-convert.ts).
//
// Its static imports load nothing but Node built-ins: the child (`__child`) then loads only the
// modules it needs, so in source mode its one read grant, tools/integrate/src, suffices.
import { CHILD_COMMAND } from '../spec/sandbox.ts';
import { ANALYZR_CONVERT_VERSION } from '../spec/version.ts';

import { parse, run, UsageError } from './common.ts';

const USAGE = `Usage:
  node analyzr-convert.mjs convert <export> --converter <workspace>/converters/<name>.js
      --sha256 <64 hex> --derived converted|reconstructed [--llm-model <id>]
      --workspace <dir> --out <workspace>/specs/<YYYY-MM-DD>-<system> [--json-out <file>]
  node analyzr-convert.mjs __child     internal: started by convert, refuses to run otherwise

convert   runs the converter on every file of <export> (a folder or file below the
          workspace's exports/; a file over 64 MB reaches it unread) and writes one
          analyzr-spec/1 file per model it returns, plus the run record
          analyzr-specs.json, into the new or empty folder --out.
          --sha256 is the converter's full sha256 as the consultant approved it: other
          bytes are refused. The converter (a classic script defining
          convert(input, helpers), importing nothing) runs twice in a child Node under
          the permission model: no file access (this script sends the export's files),
          no writes, no child processes, no environment; Node does not forbid network
          access, the converter's context only holds no way to it. Both runs must give
          the same result. A write-once copy of the converter is kept as
          converters/adhoc-<first 12 hex>.js, and the run is recorded as adhoc:<12 hex>.
          --derived converted for BPMN shapes read one to one, reconstructed (with
          --llm-model, the model you run as) for interpretive mappings such as EPCs
          and plain flowcharts. A model that fails validation, or shares its tool path
          or tool id with another, is listed in failed; the others are written (exit 1).
          A model returned twice byte for byte is written once (duplicates).

Prints a short summary on stdout and, with --json-out, the complete run record into
<file>. Nothing is written into the export or into an analyzr checkout. Exit 0, 1 when
the work fails, 2 on a usage error.
analyzr-integrate analyzr-convert ${ANALYZR_CONVERT_VERSION}
`;

function required(value: string | undefined, option: string): string {
  if (value === undefined || value === '') throw new UsageError(`${option} is required`);
  return value;
}

async function convertCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    converter: { type: 'string' },
    sha256: { type: 'string' },
    derived: { type: 'string' },
    'llm-model': { type: 'string' },
    workspace: { type: 'string' },
    out: { type: 'string' },
    'json-out': { type: 'string' },
  });
  if (positionals.length !== 1) throw new UsageError('convert expects one <export>');
  const converter = required(values.converter, '--converter');
  const sha256 = required(values.sha256, '--sha256');
  if (!/^[0-9a-fA-F]{64}$/.test(sha256)) {
    throw new UsageError("--sha256 is the converter's full sha256 (64 hex characters)");
  }
  const derived = required(values.derived, '--derived');
  if (derived !== 'converted' && derived !== 'reconstructed') {
    throw new UsageError('--derived is converted or reconstructed');
  }
  const workspace = required(values.workspace, '--workspace');
  const out = required(values.out, '--out');
  const { assertSpecOutput } = await import('../spec/guards.ts');
  if (values['json-out'] !== undefined) {
    assertSpecOutput(values['json-out'], '--json-out', { specs: out, workspace });
  }
  const { convertExport } = await import('../spec/converter.ts');
  const { compactConvert } = await import('../spec/compact.ts');
  const { writeDetails } = await import('../spec/plan-args.ts');
  const result = await convertExport({
    exportPath: positionals[0] ?? '',
    converter,
    sha256,
    derived,
    llmModel: values['llm-model'] ?? null,
    workspace,
    outDir: out,
  });
  const details = await writeDetails(values['json-out'], result.record);
  const { formatCompactJson } = await import('../compact.ts');
  process.stdout.write(formatCompactJson({ ...compactConvert(result), details }));
  if (result.record.failed.length > 0) process.exitCode = 1;
}

const [command, ...rest] = process.argv.slice(2);
if (command === CHILD_COMMAND) {
  const { childMain } = await import('../spec/child.ts');
  await childMain();
} else {
  run('analyzr-convert', USAGE, async () => {
    if (
      command === '--help' ||
      command === '-h' ||
      rest.includes('--help') ||
      rest.includes('-h')
    ) {
      process.stdout.write(USAGE);
      return;
    }
    if (command === 'convert') return convertCommand(rest);
    throw new UsageError(
      command === undefined ? 'a command is required' : `unknown command ${command}`,
    );
  });
}
