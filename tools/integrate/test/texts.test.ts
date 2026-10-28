// The text generator (scripts/texts.ts, M6 S6 §6.2): the skill texts and the German start prompts
// from tools/integrate/skills/, their includes and constants, the fragments every text that
// needs them shares, and the errors. That the committed files equal a fresh render is the drift
// test's first case.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { extractFacts } from '@analyzr/bpmn-facts';
import { describe, expect, it } from 'vitest';

import {
  REQUIRED_FRAGMENTS,
  renderTexts,
  SKILLS_DIR,
  skillFile,
  sourceOf,
  START_PROMPT_PLACEHOLDERS,
  START_PROMPTS_DIR,
  startPromptFile,
  textConstants,
  TextsError,
} from '../scripts/texts.ts';
import { guideSkeleton } from '../src/interview/guide.ts';
import {
  CONSENT_CHECKLIST,
  CONSENT_WITHOUT,
  MD_INFORMATIONAL,
  MD_OUTSIDE_MARK,
  MD_WITHDRAWN,
  TECHNICAL_KINDS,
  WEB_ANSWERS_BUTTON,
  WEB_EXPORT_BUTTON,
  WEB_EXPORT_CSV,
  WEB_EXPORT_MARKDOWN,
} from '../src/interview/texts.ts';
import { renderSpec } from '../src/spec/render.ts';
import { validateSpec } from '../src/spec/validate.ts';
import { parseSpecText } from '../src/spec/yaml.ts';

import { REPO_ROOT, tempDir } from './support.ts';

const texts = await renderTexts(REPO_ROOT);
const text = (file: string): string => texts.get(file) ?? '';
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** A source's text with its `{{text:<id>}}` constants as rendered. */
const withConstants = (source: string): string =>
  source.replace(/\{\{text:([^}]*)\}\}/g, (_, id: string) => textConstants()[id] ?? `?${id}`);

/** Every source file below tools/integrate/skills/, repository-relative. */
async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(path.join(REPO_ROOT, SKILLS_DIR), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(REPO_ROOT, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

/** A repository root with these sources below tools/integrate/skills/. */
async function sources(files: Record<string, string>): Promise<string> {
  const root = await tempDir();
  await mkdir(path.join(root, SKILLS_DIR, '_shared'), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, SKILLS_DIR, file)), { recursive: true });
    await writeFile(path.join(root, SKILLS_DIR, file), content);
  }
  return root;
}

const failure = async (files: Record<string, string>): Promise<string> => {
  try {
    await renderTexts(await sources(files));
  } catch (err) {
    if (err instanceof TextsError) return err.message;
    throw err;
  }
  return 'no error';
};

describe('the generated texts', () => {
  it('are the skills and start prompts that ship now', () => {
    expect([...texts.keys()].sort()).toEqual(
      [
        skillFile('integrate-landscape'),
        skillFile('interview-guide'),
        startPromptFile('integrate-landscape'),
        startPromptFile('interview-guide'),
      ].sort(),
    );
  });

  it('resolve every include and constant; start prompts keep only the consultant’s placeholders', () => {
    for (const [file, content] of texts) {
      expect(content.endsWith('\n') && !content.endsWith('\n\n'), file).toBe(true);
      expect(content, file).not.toContain('\r');
      expect(content, file).not.toMatch(/\{\{[>]|\{\{text:/);
      const placeholders = [...content.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]);
      if (file.endsWith('/SKILL.md')) expect(placeholders, file).toEqual([]);
      else {
        for (const p of placeholders) expect(START_PROMPT_PLACEHOLDERS, file).toContain(p);
        expect(placeholders, file).toContain('PROJEKT');
      }
    }
  });

  it('carry every shared fragment where it must appear, word for word', async () => {
    for (const [fragment, files] of Object.entries(REQUIRED_FRAGMENTS)) {
      const source = await readFile(
        path.join(REPO_ROOT, SKILLS_DIR, '_shared', `${fragment}.md`),
        'utf8',
      );
      expect(files.length, fragment).toBeGreaterThan(0);
      // (the fragment as rendered: its constants inserted)
      for (const file of files)
        expect(flat(text(file)), `${fragment} in ${file}`).toContain(flat(withConstants(source)));
    }
    // the transcripts rule in every skill, and the interview rules in every interview skill
    for (const file of [...texts.keys()].filter((f) => f.endsWith('/SKILL.md'))) {
      expect(REQUIRED_FRAGMENTS['transcripts-rule'], file).toContain(file);
    }
  });

  it('start every Desktop prompt with the read-only connector', () => {
    for (const file of [...texts.keys()].filter((f) => f.includes('/start-prompt-'))) {
      expect(text(file).split('\n')[0], file).toBe('Nutze nur den Connector `analyzr-lesen`.');
      // no write tool, and du to the consultant
      expect(text(file), file).not.toMatch(
        /\b(propose|claim|submit|release|withdraw|decide)_[a-z_]+/,
      );
      expect([...text(file).matchAll(/„([^“]+)“/g)].map((m) => m[1]).join(' '), file).not.toMatch(
        /\b(Sie|Ihnen|Ihr)\b/,
      );
    }
  });

  it('give the Desktop chat the guide’s skeleton from the guide’s own renderer', () => {
    const prompt = text(startPromptFile('interview-guide'));
    expect(prompt).toContain(`\`\`\`\`markdown\n${guideSkeleton()}\n\`\`\`\``);
    expect(textConstants()['guide-skeleton']).toBe(guideSkeleton());
    // the skeleton has the guide's headings, the checklist and every line a question of the
    // Markdown export can have, with placeholders where the guide has values
    const skeleton = guideSkeleton();
    for (const line of [
      '# Interviewleitfaden: <Ansprechpartner>',
      '<Projekt> · offene Fragen aus analyzr vom <Datum der Datei> · <Anzahl> Fragen in der Reihenfolge von „Offene Fragen“ (die mit der größten Wirkung zuerst)',
      '## Vor dem Gespräch',
      ...CONSENT_CHECKLIST.map((l) => `- [ ] ${l}`),
      CONSENT_WITHOUT,
      '### F1. <Frage, wörtlich>',
      '`q-…` · <Art>',
      '- Warum wir fragen: <Begründung, wörtlich>',
      '- Betrifft: <Betrifft, wörtlich>',
      '- Notiz zur Vormerkung: <Notiz zur Vormerkung, wörtlich>',
      '- Vormerkung: <Vormerkung, wörtlich>',
      '- Was die Landkarte schon sagt: <höchstens zwei Sätze>',
      '- Bisher notiert (<Datum>): <letzte Notiz, wörtlich>',
      '  - <bis zu drei Nachfragen>',
      '- Notizen:',
      '## Abläufe ohne Modell',
      'Die Landkarte kennt in diesem Bereich: „<Prozess>“, „<Prozess>“',
      '## Abschluss',
    ]) {
      expect(skeleton.split('\n'), line).toContain(line);
    }
    // no value of a real guide: the date and the count are placeholders
    expect(skeleton).not.toMatch(/\d\d\.\d\d\.\d{4}|\d+ Fragen?\b/);
    expect(prompt).toContain('Sprich die Gesprächspartner mit „du“ an');
    expect(prompt).not.toMatch(/„Sie“/);
  });

  it('give the Desktop chat a picture spec example that validates and renders', async () => {
    const prompt = text(startPromptFile('integrate-landscape'));
    const [yaml = '', ...rest] = [...prompt.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map(
      (m) => m[1],
    );
    expect(rest).toEqual([]);
    const parsed = parseSpecText(yaml.replace('{{MODELL_ID}}', 'claude-opus-5-5'));
    expect(parsed.errors).toEqual([]);
    const result = validateSpec(parsed.value, { origin: 'hand' });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.spec?.derived).toMatchObject({
      kind: 'reconstructed',
      llmModel: 'claude-opus-5-5',
    });
    const rendered = await renderSpec(result.spec!, { key: 'einkauf/bestellanforderung' });
    const facts = await extractFacts(rendered.bytes, { modelKey: 'einkauf/bestellanforderung' });
    expect(facts.warnings).toEqual([]);
    expect(facts.engine).toBeNull();
    expect(rendered.summary.calls).toEqual([
      expect.objectContaining({ target: 'Bestellabwicklung' }),
    ]);
  });
});

describe('the texts that must read as analyzr writes them', () => {
  const read = (file: string) => readFile(path.join(REPO_ROOT, file), 'utf8');

  it('quote the web’s labels and the export’s markers word for word', async () => {
    const dialog = await read('apps/web/src/components/open-questions/customer-export-dialog.tsx');
    expect(dialog).toContain(`label: '${WEB_EXPORT_MARKDOWN}'`);
    expect(dialog).toContain(`label: '${WEB_EXPORT_CSV}'`);
    const page = await read('apps/web/src/routes/project-open-questions-page.tsx');
    expect(page).toMatch(new RegExp(`^\\s*${WEB_EXPORT_BUTTON}$`, 'm'));
    const sheet = await read('apps/web/src/components/open-questions/answer-sheet-dialog.tsx');
    expect(sheet).toMatch(new RegExp(`^\\s*${WEB_ANSWERS_BUTTON}$`, 'm'));
    const exported = await read('apps/server/src/domain/open-questions/export.ts');
    expect(exported).toContain(`lines.push('- ${MD_INFORMATIONAL}')`);
    expect(exported).toContain(`\`, ${MD_WITHDRAWN} am \${formatDateDe(a.withdrawal.at)}\``);
    expect(MD_OUTSIDE_MARK).toBe('Liegt außerhalb der Landschaft');
    // the technical kinds are kinds the server files under „Zu klären“
    const model = await read('apps/server/src/domain/open-questions/model.ts');
    for (const kind of TECHNICAL_KINDS) {
      expect(model, kind).toMatch(new RegExp(`^ {2}(?:'${kind}'|${kind}): 'ask',$`, 'm'));
    }
  });

  it('use every constant they offer, and the texts name the web as the constants do', async () => {
    const used = new Set<string>();
    for (const file of await sourceFiles()) {
      for (const m of (await read(file)).matchAll(/\{\{text:([^}]*)\}\}/g)) used.add(m[1] ?? '');
    }
    expect([...used].sort()).toEqual(Object.keys(textConstants()).sort());
    // and no text writes a web label by hand without its ellipsis
    for (const [file, content] of texts) {
      expect(content, file).not.toMatch(
        /„Antworten aus CSV übernehmen“|„Für den Kunden exportieren“/,
      );
    }
  });
});

describe('the generated Desktop prompts', () => {
  it('are each generated from a source, or one of the hand-written ones', async () => {
    const prompts = (await readdir(path.join(REPO_ROOT, START_PROMPTS_DIR)))
      .filter((f) => /^start-prompt.*\.md$/.test(f))
      .map((f) => `${START_PROMPTS_DIR}/${f}`);
    const generated = [...texts.keys()].filter((f) => f.startsWith(`${START_PROMPTS_DIR}/`));
    // the M3/M4 prompts are written by hand; a prompt whose source went is stale
    expect(prompts.filter((f) => !generated.includes(f)).sort()).toEqual(
      ['start-prompt-draft.de.md', 'start-prompt-placements.de.md', 'start-prompt.de.md'].map(
        (f) => `${START_PROMPTS_DIR}/${f}`,
      ),
    );
    for (const file of generated)
      expect(sourceOf(file), file).toMatch(/start-prompt\.de\.src\.md$/);
    expect(sourceOf(skillFile('interview-guide'))).toBe(
      `${SKILLS_DIR}/interview-guide/skill.src.md`,
    );
    expect(sourceOf('plugins/analyzr-integrate/scripts/inspect.mjs')).toBeNull();
  });
});

describe('the generator', () => {
  const skill = '---\nname: x\n---\n\nBody.\n';

  it('includes fragments with the include line’s indentation, and constants', async () => {
    const root = await sources({
      'x/skill.src.md': '1. Rule:\n   {{> _shared/a}}\nSee {{text:web-markdown-export}}.\n',
      'x/start-prompt.de.src.md': '{{text:guide-skeleton}}\nProjekt {{PROJEKT}}\n',
      '_shared/a.md': 'line one\n\nline three\n\n',
    });
    const out = await renderTexts(root);
    expect(out.get(skillFile('x'))).toBe(
      `1. Rule:\n   line one\n\n   line three\nSee ${textConstants()['web-markdown-export']}.\n`,
    );
    expect(out.get(startPromptFile('x'))).toBe(`${guideSkeleton()}\nProjekt {{PROJEKT}}\n`);
  });

  it('refuses unknown fragments, constants and placeholders, unused fragments and strays', async () => {
    expect(await failure({ 'x/skill.src.md': '{{> _shared/none}}\n' })).toBe(
      `${SKILLS_DIR}/x/skill.src.md: unknown fragment {{> _shared/none}}`,
    );
    expect(await failure({ 'x/skill.src.md': '{{text:none}}\n' })).toBe(
      `${SKILLS_DIR}/x/skill.src.md: unknown text {{text:none}}`,
    );
    expect(await failure({ 'x/skill.src.md': 'Projekt {{PROJEKT}}\n' })).toBe(
      `${SKILLS_DIR}/x/skill.src.md: {{PROJEKT}} left in a SKILL.md`,
    );
    expect(
      await failure({ 'x/skill.src.md': skill, 'x/start-prompt.de.src.md': '{{ANZAHL}}\n' }),
    ).toMatch(/placeholder \{\{ANZAHL\}\} is none of \{\{PROJEKT\}\}, \{\{MODELL_ID\}\}$/);
    expect(await failure({ 'x/skill.src.md': skill, '_shared/a.md': 'unused\n' })).toBe(
      `${SKILLS_DIR}/_shared: no source includes a`,
    );
    expect(
      await failure({
        'x/skill.src.md': '{{> _shared/a}}\n',
        '_shared/a.md': '{{> _shared/b}}\n',
        '_shared/b.md': 'b\n',
      }),
    ).toMatch(/a fragment includes another/);
    expect(await failure({ 'x/skill.src.md': skill, 'x/notes.md': 'x\n' })).toMatch(
      /holds skill\.src\.md and optionally start-prompt\.de\.src\.md, nothing else/,
    );
    expect(await failure({ 'x/skill.src.md': 'a\r\nb\n' })).toMatch(/line breaks must be LF$/);
    expect(await failure({ 'x/skill.src.md': 'See {{text:guide-skeleton}} inline.\n' })).toMatch(
      /has several lines; put it on its own line$/,
    );
  });
});
