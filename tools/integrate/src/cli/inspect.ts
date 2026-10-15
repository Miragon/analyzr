// Entry of plugins/analyzr-integrate/scripts/inspect.mjs (M6 §3.7 step 1).
import { compactInspect, formatCompactJson } from '../compact.ts';
import { inspectExport } from '../inspect.ts';
import { INSPECT_VERSION } from '../version.ts';

import { parse, printJson, run, UsageError } from './common.ts';

const USAGE = `Usage: node inspect.mjs <export> [--summary]

Prints a deterministic JSON inventory of <export> (a folder or one file):
per file size, sha256, kind, encoding, XML root and namespaces, a BPMN
summary, a zip listing and tool markers; totals and the tools the markers
point at. Reads only. --summary prints the export at a glance instead
(totals, tools, files per folder, archive-like folders and files, files
that are no BPMN or carry a note), short also for hundreds of files; run
inspect on a single file for its details.
Exit 0, 1 when <export> cannot be read, 2 on a usage error.
analyzr-integrate inspect ${INSPECT_VERSION}
`;

run('inspect', USAGE, async () => {
  const { values, positionals } = parse(process.argv.slice(2), {
    summary: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  });
  if (values.help === true) {
    process.stdout.write(USAGE);
    return;
  }
  if (positionals.length !== 1) throw new UsageError('expected exactly one export path');
  const report = await inspectExport(positionals[0] ?? '');
  if (values.summary === true) {
    process.stdout.write(formatCompactJson(compactInspect(report)));
  } else {
    printJson(report);
  }
});
