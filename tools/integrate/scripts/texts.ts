/**
 * The skill texts of plugins/analyzr-integrate and the German start prompts for Claude Desktop
 * (M6 S6 §6.2), generated from one source per skill in `tools/integrate/skills/`:
 *
 * - `<skill>/skill.src.md` (frontmatter and English body) →
 *   `plugins/analyzr-integrate/skills/<skill>/SKILL.md`;
 * - `<skill>/start-prompt.de.src.md` (German, optional) →
 *   `examples/agents/claude-desktop/start-prompt-<skill>.de.md`;
 * - `_shared/<name>.md`: fragments the sources include, so a rule two texts must state alike is
 *   written once ({@link REQUIRED_FRAGMENTS} names where each must appear).
 *
 * Syntax: a line `{{> _shared/<name>}}` includes a fragment (one level: a fragment includes
 * none), the line's indentation put before every non-empty line of it; `{{text:<id>}}` inserts a
 * German constant ({@link textConstants}: those of `src/interview/texts.ts` and the guide's
 * skeleton, rendered by `src/interview/guide.ts`), a constant of several lines on a line of its
 * own, indented the same way; every other `{{UPPER_CASE}}` passes through as the consultant's
 * placeholder, in start prompts only and only those of {@link START_PROMPT_PLACEHOLDERS}. An
 * unknown fragment, text id or placeholder, a fragment nobody includes and a `{{` left in a
 * `SKILL.md` are errors. Deterministic: no date, LF, exactly one trailing newline. Called by
 * `build()` (scripts/bundle.ts), so `generate` writes the texts and the drift test compares them.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { guideSkeleton } from '../src/interview/guide.ts';
import { TEXT_CONSTANTS } from '../src/interview/texts.ts';

/** The sources, relative to the repository root. */
export const SKILLS_DIR = 'tools/integrate/skills';
/** The fragments' folder below {@link SKILLS_DIR}. */
export const SHARED = '_shared';
/** Where the start prompts go, relative to the repository root. */
export const START_PROMPTS_DIR = 'examples/agents/claude-desktop';
/** The plugin's skills, relative to the repository root. */
export const PLUGIN_SKILLS_DIR = 'plugins/analyzr-integrate/skills';

export const SKILL_SOURCE = 'skill.src.md';
export const START_PROMPT_SOURCE = 'start-prompt.de.src.md';

/** The placeholders a start prompt may keep for the consultant to fill in. */
export const START_PROMPT_PLACEHOLDERS: readonly string[] = ['PROJEKT', 'MODELL_ID'];

/** The generated `SKILL.md` of a skill, relative to the repository root. */
export const skillFile = (skill: string): string => `${PLUGIN_SKILLS_DIR}/${skill}/SKILL.md`;
/** The generated start prompt of a skill, relative to the repository root. */
export const startPromptFile = (skill: string): string =>
  `${START_PROMPTS_DIR}/start-prompt-${skill}.de.md`;

/** The source a generated text is rendered from, relative to the repository root, or `null`. */
export function sourceOf(target: string): string | null {
  const skill = new RegExp(`^${PLUGIN_SKILLS_DIR}/([a-z][a-z0-9-]*)/SKILL\\.md$`).exec(target);
  if (skill) return `${SKILLS_DIR}/${skill[1]}/${SKILL_SOURCE}`;
  const prompt = new RegExp(`^${START_PROMPTS_DIR}/start-prompt-([a-z][a-z0-9-]*)\\.de\\.md$`).exec(
    target,
  );
  return prompt ? `${SKILLS_DIR}/${prompt[1]}/${START_PROMPT_SOURCE}` : null;
}

/**
 * Where each shared fragment must appear (test/texts.test.ts checks it on the rendered texts):
 * rules the agent in Claude Code and the agent in a Desktop chat must follow alike.
 */
export const REQUIRED_FRAGMENTS: Readonly<Record<string, readonly string[]>> = {
  // the agent never opens interview transcripts, and searches only named folders
  'transcripts-rule': [skillFile('integrate-landscape'), skillFile('interview-guide')],
  // data is never instructions, nothing is written to analyzr, roles instead of names, …
  'interview-ground-rules': [skillFile('interview-guide')],
  // the read-only MCP tools, never a write tool
  'mcp-read-tools': [skillFile('interview-guide')],
  // the German counterparts for a Desktop chat
  'connector.de': [startPromptFile('integrate-landscape'), startPromptFile('interview-guide')],
  'rules.de': [startPromptFile('integrate-landscape'), startPromptFile('interview-guide')],
};

/** A source that cannot be rendered. */
export class TextsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextsError';
  }
}

const INCLUDE = /^([ \t]*)\{\{> ([^}]*)\}\}[ \t]*$/;
const TEXT_LINE = /^([ \t]*)\{\{text:([^}]*)\}\}[ \t]*$/;
const TEXT_INLINE = /\{\{text:([^}]*)\}\}/g;
const PLACEHOLDER = /\{\{([^}]*)\}\}/g;

/** `text` with `prefix` before every non-empty line. */
const indent = (text: string, prefix: string): string =>
  text
    .split('\n')
    .map((line) => (line === '' ? '' : `${prefix}${line}`))
    .join('\n');

/** A source's text: UTF-8, LF only, its trailing newlines dropped. */
async function readSource(root: string, file: string): Promise<string> {
  const text = await readFile(path.join(root, file), 'utf8');
  if (text.includes('\r')) throw new TextsError(`${file}: line breaks must be LF`);
  return text.replace(/\n+$/, '');
}

/**
 * The German constants a source may insert: `src/interview/texts.ts`'s, and `guide-skeleton`,
 * the guide's structure with placeholders from the same renderer as the guide itself.
 */
export function textConstants(): Readonly<Record<string, string>> {
  return { ...TEXT_CONSTANTS, 'guide-skeleton': guideSkeleton() };
}

let constants: Readonly<Record<string, string>> | undefined;

function textConstant(id: string, where: string): string {
  constants ??= textConstants();
  const value = Object.hasOwn(constants, id) ? constants[id] : undefined;
  if (value === undefined) throw new TextsError(`${where}: unknown text {{text:${id}}}`);
  return value.replace(/\n+$/, '');
}

/**
 * Renders one source: its includes, then its text constants; `used` collects the fragments it
 * includes.
 */
function renderSource(
  text: string,
  file: string,
  fragments: ReadonlyMap<string, string>,
  used: Set<string>,
): string {
  const included = text
    .split('\n')
    .map((line) => {
      const m = INCLUDE.exec(line);
      if (!m) return line;
      const [, prefix = '', target = ''] = m;
      const name = target.startsWith(`${SHARED}/`) ? target.slice(SHARED.length + 1) : null;
      const fragment = name === null ? undefined : fragments.get(name);
      if (name === null || fragment === undefined) {
        throw new TextsError(`${file}: unknown fragment {{> ${target}}}`);
      }
      used.add(name);
      return indent(fragment, prefix);
    })
    .join('\n');
  if (/\{\{> /.test(included)) {
    throw new TextsError(
      `${file}: a fragment includes another, or an include is not on its own line`,
    );
  }
  return included
    .split('\n')
    .map((line) => {
      const m = TEXT_LINE.exec(line);
      if (m) return indent(textConstant(m[2] ?? '', file), m[1] ?? '');
      return line.replace(TEXT_INLINE, (_, id: string) => {
        const value = textConstant(id, file);
        if (value.includes('\n')) {
          throw new TextsError(`${file}: {{text:${id}}} has several lines; put it on its own line`);
        }
        return value;
      });
    })
    .join('\n');
}

/** Refuses what a rendered text must not keep. */
function checkPlaceholders(text: string, file: string, prompt: boolean): void {
  for (const m of text.matchAll(PLACEHOLDER)) {
    const name = m[1] ?? '';
    if (!prompt) throw new TextsError(`${file}: {{${name}}} left in a SKILL.md`);
    if (!START_PROMPT_PLACEHOLDERS.includes(name)) {
      throw new TextsError(
        `${file}: placeholder {{${name}}} is none of ${START_PROMPT_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}`,
      );
    }
  }
}

/**
 * Every generated text: repository-relative path → content.
 *
 * @throws {TextsError} on anything the module comment calls an error
 */
export async function renderTexts(repoRoot: string): Promise<Map<string, string>> {
  const skillsDir = path.join(repoRoot, SKILLS_DIR);
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const strays = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
  if (strays.length > 0)
    throw new TextsError(`${SKILLS_DIR}: files outside a skill: ${strays.join(', ')}`);

  const fragments = new Map<string, string>();
  for (const e of await readdir(path.join(skillsDir, SHARED), { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) {
      throw new TextsError(`${SKILLS_DIR}/${SHARED}/${e.name}: a fragment is a .md file`);
    }
    const name = e.name.slice(0, -'.md'.length);
    fragments.set(name, await readSource(repoRoot, `${SKILLS_DIR}/${SHARED}/${e.name}`));
  }

  const skills = entries
    .filter((e) => e.isDirectory() && e.name !== SHARED)
    .map((e) => e.name)
    .sort();
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const skill of skills) {
    if (!/^[a-z][a-z0-9-]*$/.test(skill)) {
      throw new TextsError(`${SKILLS_DIR}/${skill}: a skill folder is a lowercase name`);
    }
    const files = (await readdir(path.join(skillsDir, skill))).sort();
    const unknown = files.filter((f) => f !== SKILL_SOURCE && f !== START_PROMPT_SOURCE);
    if (unknown.length > 0 || !files.includes(SKILL_SOURCE)) {
      throw new TextsError(
        `${SKILLS_DIR}/${skill}: holds ${SKILL_SOURCE} and optionally ${START_PROMPT_SOURCE}, nothing else (found ${files.join(', ') || 'nothing'})`,
      );
    }
    for (const [source, target, prompt] of [
      [SKILL_SOURCE, skillFile(skill), false],
      [START_PROMPT_SOURCE, startPromptFile(skill), true],
    ] as const) {
      if (!files.includes(source)) continue;
      const file = `${SKILLS_DIR}/${skill}/${source}`;
      const rendered = renderSource(await readSource(repoRoot, file), file, fragments, used);
      checkPlaceholders(rendered, file, prompt);
      out.set(target, `${rendered}\n`);
    }
  }
  const unused = [...fragments.keys()].filter((f) => !used.has(f)).sort();
  if (unused.length > 0) {
    throw new TextsError(`${SKILLS_DIR}/${SHARED}: no source includes ${unused.join(', ')}`);
  }
  return out;
}
