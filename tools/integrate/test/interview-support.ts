// Shared fixtures and helpers of the interview guide's tests (M6 S6 step 2).
import { execFile } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { PACKAGE_ROOT, tempDir } from './support.ts';

/** The synthetic open questions (test/fixtures/interview/README.md). */
export const INTERVIEW_FIXTURES = path.join(PACKAGE_ROOT, 'test/fixtures/interview');
export const QUESTIONS_DATE = '2026-10-27';
export const questionsFixture = (ext: 'json' | 'md' | 'csv'): string =>
  path.join(INTERVIEW_FIXTURES, `${QUESTIONS_DATE}.questions.${ext}`);
/** The agent's notes for the guide of the group `organisationseinheit-lager` from the JSON. */
export const NOTES_FIXTURE = path.join(
  INTERVIEW_FIXTURES,
  `${QUESTIONS_DATE}-organisationseinheit-lager.notes.yaml`,
);
/** The golden guides and their records. */
export const GUIDE_GOLDENS = path.join(INTERVIEW_FIXTURES, 'guides');

export const PROJECT = { key: 'nordwind-handel', name: 'Nordwind Handel GmbH' };

export const INTERVIEW_ENTRY = path.join(PACKAGE_ROOT, 'src/cli/analyzr-interview.ts');

/** A workspace with analyzr-workspace.json and the three questions fixtures in interviews/questions/. */
export async function interviewWorkspace(): Promise<{
  ws: string;
  questions: (ext: 'json' | 'md' | 'csv') => string;
  guides: string;
}> {
  const ws = path.join(await tempDir(), 'kunde');
  const folder = path.join(ws, 'interviews', 'questions');
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(ws, 'analyzr-workspace.json'),
    `${JSON.stringify({ format: 'analyzr-workspace/1', project: PROJECT, analyzrUrl: 'http://127.0.0.1:7400', cli: 'plugin', systems: [] }, null, 2)}\n`,
  );
  for (const ext of ['json', 'md', 'csv'] as const) {
    await copyFile(questionsFixture(ext), path.join(folder, path.basename(questionsFixture(ext))));
  }
  return {
    ws,
    questions: (ext) => path.join(folder, path.basename(questionsFixture(ext))),
    guides: path.join(ws, 'interviews', 'guides'),
  };
}

const run = promisify(execFile);

/** Runs `script` (default: analyzr-interview from source) with Node; the exit code instead of a throw. */
export async function interview(
  args: readonly string[],
  options: { cwd?: string; script?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [options.script ?? INTERVIEW_ENTRY, ...args],
      { cwd: options.cwd ?? PACKAGE_ROOT, env: { PATH: process.env['PATH'] ?? '' } },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** The golden runs: name → the questions input and the `guide` options. */
export const GOLDEN_GUIDES: readonly {
  name: string;
  ext: 'json' | 'md' | 'csv';
  args: readonly string[];
  notes?: boolean;
}[] = [
  // the preferred input, one group, the agent's notes
  {
    name: `${QUESTIONS_DATE}-organisationseinheit-lager`,
    ext: 'json',
    args: ['--group', 'organisationseinheit-lager'],
    notes: true,
  },
  // the same group from the Markdown export
  {
    name: `${QUESTIONS_DATE}-organisationseinheit-lager-md`,
    ext: 'md',
    args: ['--group', 'organisationseinheit-lager'],
  },
  // two groups of the CSV (its contact cell joins owners and lanes)
  {
    name: `${QUESTIONS_DATE}-lager-csv`,
    ext: 'csv',
    args: ['--group', 'lager-kommissionierung', '--group', 'ohne-ansprechpartner'],
  },
  // two groups with the agents' questions, in the list's order across them, cut to five
  {
    name: `${QUESTIONS_DATE}-lager-agent`,
    ext: 'json',
    args: [
      '--group',
      'organisationseinheit-lager',
      '--group',
      'lanes-lagerleitung',
      '--include-agent',
      '--max',
      '5',
    ],
  },
];
