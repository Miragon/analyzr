// Entry of analyzr-interview (M6 S6 §2): the interview guide from analyzr's open questions.
// `groups` lists a questions file's contact groups with their slugs; `guide` writes the guide of
// the groups named by slug, with its record, into the workspace's interviews/guides/. It reads
// only the questions file below the workspace's interviews/questions/ and the agent's notes file
// below interviews/guides/, never anything below transcripts/; it needs no network, environment
// or clock. Bundled into the plugin as scripts/analyzr-interview.mjs since plugin 0.1.6; the
// tests also run it from source (node tools/integrate/src/cli/analyzr-interview.ts).
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, type Stats } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { personalDataList, personalDataWarnings } from '@analyzr/contracts/personal-data';

import { checkoutOf, isInside, PathGuardError, resolvedPath, WORKSPACE_FILE } from '../guards.ts';
import { guideRecord, renderGuide, type GuideInput } from '../interview/guide.ts';
import {
  checkNotes,
  MAX_NOTES_BYTES,
  type GuideNotes,
  type NotesProblem,
} from '../interview/notes.ts';
import {
  countGroups,
  inputOf,
  leftOutCounts,
  QuestionsError,
  readQuestions,
  selectQuestions,
  type QuestionItem,
  type QuestionsFile,
  type QuestionsProblem,
} from '../interview/questions.ts';
import { ANALYZR_INTERVIEW_VERSION } from '../version.ts';
import { decodeUtf8 } from '../yaml.ts';

import { parse, printJson, run, UsageError } from './common.ts';

const USAGE = `Usage:
  node analyzr-interview.mjs groups <questions file> --workspace <dir> [--include-agent]
  node analyzr-interview.mjs guide <questions file> --workspace <dir> --group <slug>...
      [--date <YYYY-MM-DD>] [--max <n>] [--include-agent] [--notes <notes.yaml>]
      [--out <guide.md>] [--replace]

<questions file> lies below <dir>/interviews/questions/ (the folder of the workspace with
analyzr-workspace.json): the CLI's "analyzr questions list -p <project> --state open
--group ask --group agent --format json -o <file>" (.json, preferred), else the web's
Markdown export (.md) or its CSV (.csv). Only the questions to clarify (group ask) are
asked; --include-agent adds the agents' questions on their proposals.

groups  prints the file's contact groups (the step owners, else the lanes, else „Ohne
        Ansprechpartner“) with their slug and the count of questions a guide would ask,
        and what no guide asks (informational, answered, technical: work for you in
        analyzr, agent, proposal).
guide   writes the German interview guide of the groups --group names by slug (repeat
        for several; never a label) into <guide.md> (default
        <dir>/interviews/guides/<date>-<slugs>.md), and its record <name>.guide.json:
        every question verbatim with its id (q-…), in the file's order, also across the
        groups (the warning group-cut names a group --max leaves empty). --date is the
        questions file's date (default: the YYYY-MM-DD its name starts with); --max keeps
        the first n questions; --notes adds the checked analyzr-guide-notes/1 file (in
        <dir>/interviews/guides/); an existing guide is replaced only with --replace.
        Exit 1 with "errors" when the notes do not pass: nothing is written.

Exit 0, 1 when the work fails, 2 on a usage error.
analyzr-integrate analyzr-interview ${ANALYZR_INTERVIEW_VERSION}
`;

/** Largest questions file read (bytes). */
const MAX_QUESTIONS_BYTES = 20 * 1024 * 1024;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const wantsHelp = (argv: readonly string[]): boolean =>
  argv.includes('--help') || argv.includes('-h');

const posix = (p: string): string => p.split(path.sep).join('/');

interface Workspace {
  dir: string;
  project: { key: string; name: string };
}

/** The workspace: a folder with analyzr-workspace.json naming the project, outside any checkout. */
async function openWorkspace(dir: string | undefined): Promise<Workspace> {
  if (dir === undefined || dir === '') throw new UsageError('--workspace is required');
  const resolved = resolvedPath(dir);
  const checkout = checkoutOf(resolved);
  if (checkout !== null) {
    throw new PathGuardError(
      `--workspace ${dir} lies inside the analyzr checkout ${checkout}: customer data stays outside it, in a workspace per customer`,
    );
  }
  const file = path.join(resolved, WORKSPACE_FILE);
  if (!existsSync(file)) {
    throw new PathGuardError(
      `--workspace ${dir} holds no ${WORKSPACE_FILE}: open the workspace first`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error(`${WORKSPACE_FILE} is not valid JSON`);
  }
  const project = (value as { project?: { key?: unknown; name?: unknown } } | null)?.project;
  if (typeof project?.key !== 'string' || typeof project.name !== 'string') {
    throw new Error(`${WORKSPACE_FILE} names no project {key, name}`);
  }
  return { dir: resolved, project: { key: project.key, name: project.name } };
}

/**
 * The workspace's folder `interviews/<name>`: refused when it, or `interviews`, is a symbolic
 * link or no folder (so no link leads the script into transcripts/ or out of the workspace).
 */
function interviewsFolder(ws: Workspace, name: 'questions' | 'guides'): string {
  const folder = path.join(ws.dir, 'interviews', name);
  for (const dir of [path.join(ws.dir, 'interviews'), folder]) {
    const stat = lstatSync(dir, { throwIfNoEntry: false });
    if (stat !== undefined && !stat.isDirectory()) {
      throw new PathGuardError(
        `${posix(path.relative(ws.dir, dir))}/ of the workspace is a symbolic link or no folder: make it a folder of its own`,
      );
    }
  }
  return folder;
}

/**
 * Refuses a file to read that is no regular file of its own (a symbolic or hard link, a folder)
 * or lies outside `folder` (resolved); returns its resolved path and its size.
 */
function ownFile(
  file: string,
  option: string,
  folder: string,
  what: string,
): { resolved: string; stat: Stats } {
  const resolved = resolvedPath(file);
  if (!isInside(resolved, folder) || resolved === folder) {
    throw new PathGuardError(`${option} ${file} is refused: ${what}`);
  }
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat === undefined) throw new Error(`${file} does not exist`);
  if (!stat.isFile() || stat.nlink > 1) {
    throw new PathGuardError(
      `${option} ${file} is refused: a symbolic link, a hard link or no regular file`,
    );
  }
  return { resolved, stat };
}

interface Loaded {
  file: QuestionsFile;
  path: string;
  bytes: Buffer;
}

async function loadQuestions(input: string, ws: Workspace): Promise<Loaded> {
  const { resolved, stat } = ownFile(
    input,
    '<questions file>',
    interviewsFolder(ws, 'questions'),
    `the questions file lies in the workspace's interviews/questions/ (copy it there first)`,
  );
  const kind = inputOf(resolved);
  if (kind === null) throw new UsageError('<questions file> ends in .json, .md or .csv');
  // (the size before the read: a huge file is never loaded)
  if (stat.size > MAX_QUESTIONS_BYTES) {
    throw new Error(
      `${input}: ${stat.size} bytes; a questions file holds at most ${MAX_QUESTIONS_BYTES}`,
    );
  }
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_QUESTIONS_BYTES) {
    throw new Error(
      `${input}: ${bytes.length} bytes; a questions file holds at most ${MAX_QUESTIONS_BYTES}`,
    );
  }
  const text = decodeUtf8(bytes);
  if (text === null) throw new Error(`${input} is not UTF-8: save it as UTF-8`);
  return { file: readQuestions(kind, text), path: resolved, bytes };
}

/** The fields of a question the guide prints that the shared check finds personal data in. */
function personalDataOf(items: readonly QuestionItem[]): QuestionsProblem[] {
  const out: QuestionsProblem[] = [];
  items.forEach((q, i) => {
    const fields: [string, string | null][] = [
      ['text', q.text],
      ['detail', q.detail],
      ['subjectLabel', q.subjectLabel],
      ['context', q.context],
      ['label', q.label],
      ['latestNote', q.latestNote?.text ?? null],
    ];
    for (const [field, value] of fields) {
      const found = value === null ? null : personalDataList(personalDataWarnings(value));
      if (found !== null) {
        out.push({
          code: 'personal-data',
          message: `F${i + 1} (${q.id}): ${field} holds ${found}; the guide shows it as analyzr has it`,
        });
      }
    }
  });
  return out;
}

async function groupsCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    workspace: { type: 'string' },
    'include-agent': { type: 'boolean' },
  });
  if (positionals.length !== 1) throw new UsageError('groups expects one <questions file>');
  const ws = await openWorkspace(values.workspace);
  const loaded = await loadQuestions(positionals[0] ?? '', ws);
  const options = { includeAgent: values['include-agent'] === true };
  const groups = countGroups(loaded.file, options);
  printJson({
    input: loaded.file.input,
    questionsFile: posix(path.relative(ws.dir, loaded.path)),
    questions: groups.reduce((n, g) => n + g.count, 0),
    groups: groups.map((g) => ({ slug: g.slug, label: g.label, count: g.count })),
    leftOut: leftOutCounts(loaded.file, options),
    warnings: loaded.file.warnings,
  });
}

/** The date: `--date`, else the `YYYY-MM-DD` the file name starts with. */
function dateOf(given: string | undefined, file: string): string {
  const date = given ?? /^(\d{4}-\d{2}-\d{2})/.exec(path.basename(file))?.[1];
  if (date === undefined) {
    throw new UsageError(
      '--date <YYYY-MM-DD> is required: the questions file name starts with no date',
    );
  }
  const m = DATE.exec(date);
  const [year, month, day] = [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  if (m === null || day < 1 || day > days) {
    throw new UsageError(`--date ${JSON.stringify(date)} is no date YYYY-MM-DD`);
  }
  return date;
}

async function guideCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    workspace: { type: 'string' },
    group: { type: 'string', multiple: true },
    date: { type: 'string' },
    max: { type: 'string' },
    'include-agent': { type: 'boolean' },
    notes: { type: 'string' },
    out: { type: 'string' },
    replace: { type: 'boolean' },
  });
  if (positionals.length !== 1) throw new UsageError('guide expects one <questions file>');
  const slugs = values.group ?? [];
  if (slugs.length === 0) {
    throw new UsageError(
      '--group <slug> is required (the slugs analyzr-interview.mjs groups prints)',
    );
  }
  for (const s of slugs) {
    if (!SLUG.test(s)) {
      throw new UsageError(
        `--group takes a slug as analyzr-interview.mjs groups prints it (a-z, 0-9 and -), never a label`,
      );
    }
  }
  let max: number | null = null;
  if (values.max !== undefined) {
    if (!/^[1-9]\d{0,3}$/.test(values.max)) throw new UsageError('--max is a count from 1 to 9999');
    max = Number(values.max);
  }
  const ws = await openWorkspace(values.workspace);
  const input = positionals[0] ?? '';
  const date = dateOf(values.date, input);
  const loaded = await loadQuestions(input, ws);
  const includeAgent = values['include-agent'] === true;
  const selected = selectQuestions(loaded.file, [...new Set(slugs)], { includeAgent });
  if (selected.items.length === 0) {
    throw new QuestionsError('nothing-to-ask', 'these groups hold no question to clarify');
  }
  const items = max === null ? selected.items : selected.items.slice(0, max);
  // the groups the guide asks (--max may leave one without a question)
  const groups = selected.groups.filter((g) => items.some((q) => q.groupLabel === g.key));
  const warnings: (QuestionsProblem | NotesProblem)[] = [...loaded.file.warnings];
  for (const g of selected.groups.filter((x) => !groups.includes(x))) {
    warnings.push(
      selected.items.some((q) => q.groupLabel === g.key)
        ? {
            code: 'group-cut',
            message: `--max ${max} leaves the group ${g.slug} without a question: its questions come later in the file's order`,
          }
        : { code: 'group-empty', message: `the group ${g.slug} holds no question to clarify` },
    );
  }

  const guides = interviewsFolder(ws, 'guides');
  const given =
    values.out === undefined
      ? path.join(
          guides,
          `${date}-${groups
            .map((g) => g.slug)
            .join('-')
            .slice(0, 120)
            .replace(/-+$/, '')}.md`,
        )
      : path.resolve(values.out);
  // a link named as --out is refused before it is followed
  const link = lstatSync(given, { throwIfNoEntry: false });
  const out = resolvedPath(given);
  if (
    link?.isSymbolicLink() === true ||
    !/\.md$/.test(out) ||
    /\.guide\.md$|\.notes\.md$/.test(out) ||
    path.dirname(out) !== resolvedPath(guides) ||
    checkoutOf(out) !== null
  ) {
    throw new PathGuardError(
      `--out ${out} is refused: it names a new <name>.md in the workspace's interviews/guides/`,
    );
  }
  const record = out.replace(/\.md$/, '.guide.json');

  let notes: GuideNotes | null = null;
  let notesFile: string | null = null;
  if (values.notes !== undefined) {
    if (!values.notes.endsWith('.notes.yaml')) {
      throw new UsageError(
        "--notes names a <name>.notes.yaml in the workspace's interviews/guides/",
      );
    }
    const { resolved, stat } = ownFile(
      values.notes,
      '--notes',
      guides,
      `the notes file lies in the workspace's interviews/guides/`,
    );
    const failed = (problem: NotesProblem): void => {
      printJson({ written: false, errors: [problem], warnings });
      process.exitCode = 1;
    };
    // (the size before the read, and strictly UTF-8)
    if (stat.size > MAX_NOTES_BYTES) {
      failed({
        path: '',
        code: 'notes-too-large',
        message: `${stat.size} bytes; a notes file holds at most ${MAX_NOTES_BYTES}`,
      });
      return;
    }
    const text = decodeUtf8(await readFile(resolved));
    if (text === null) {
      failed({ path: '', code: 'notes-encoding', message: 'not UTF-8: save the notes as UTF-8' });
      return;
    }
    // every chosen question (notes for one --max cuts off are left unused)
    const checked = checkNotes(text, new Set(selected.items.map((q) => q.id)));
    warnings.push(...checked.warnings);
    if (checked.notes === null) {
      printJson({ written: false, errors: checked.errors, warnings });
      process.exitCode = 1;
      return;
    }
    notes = checked.notes;
    notesFile = posix(path.relative(ws.dir, resolved));
  }
  warnings.push(...personalDataOf(items));

  const guide: GuideInput = {
    project: ws.project,
    date,
    input: loaded.file.input,
    groups,
    items,
    total: selected.items.length,
    notes,
  };
  const markdown = renderGuide(guide);
  const json = guideRecord(guide, {
    questionsFile: posix(path.relative(ws.dir, loaded.path)),
    sha256: createHash('sha256').update(loaded.bytes).digest('hex'),
    guide: posix(path.relative(ws.dir, out)),
    notes: notesFile,
    max,
  });
  for (const target of [out, record]) {
    const existing = lstatSync(target, { throwIfNoEntry: false });
    if (existing !== undefined && (!existing.isFile() || existing.nlink > 1)) {
      throw new PathGuardError(`${target} is a symbolic link, a hard link or no regular file`);
    }
    if (existing !== undefined && values.replace !== true) {
      throw new Error(
        `${target} exists (the consultant may have written into it): name another --out, or pass --replace`,
      );
    }
  }
  await mkdir(guides, { recursive: true });
  // without --replace never over a file that appeared meanwhile
  const flag = values.replace === true ? 'w' : 'wx';
  await writeFile(out, markdown, { flag });
  await writeFile(record, json, { flag });
  printJson({
    written: true,
    guide: out,
    record,
    input: loaded.file.input,
    questions: items.length,
    of: selected.items.length,
    groups: groups.map((g) => ({ slug: g.slug, label: g.label })),
    ids: items.map((q) => q.id),
    notes: notesFile,
    errors: [],
    warnings,
  });
}

run('analyzr-interview', USAGE, async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || (command !== undefined && wantsHelp(rest))) {
    process.stdout.write(USAGE);
    return;
  }
  switch (command) {
    case 'groups':
      return groupsCommand(rest);
    case 'guide':
      return guideCommand(rest);
    default:
      throw new UsageError(
        command === undefined ? 'a command is required' : `unknown command ${command}`,
      );
  }
});
