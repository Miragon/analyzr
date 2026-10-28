// The interview guide (src/interview/guide.ts, notes.ts and the entry src/cli/analyzr-interview.ts,
// M6 S6 §2.3–§2.6): the golden guides and records from the three inputs (rewrite them with
// ANALYZR_UPDATE_GOLDEN=1), the version pin GUIDE_OUTPUTS, every id once and in order,
// determinism, the notes file's checks, selection by slug only, and where the script reads and
// writes.
import { createHash } from 'node:crypto';
import {
  copyFile,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderGuide } from '../src/interview/guide.ts';
import { checkNotes, formalAddress } from '../src/interview/notes.ts';
import { readQuestionsJson, selectQuestions } from '../src/interview/questions.ts';
import {
  AFTER_INTERVIEW,
  CONSENT_CHECKLIST,
  CONSENT_WITHOUT,
  GUIDE_QUOTES,
} from '../src/interview/texts.ts';
import { ANALYZR_INTERVIEW_VERSION } from '../src/version.ts';

import {
  GOLDEN_GUIDES,
  GUIDE_GOLDENS,
  interview,
  interviewWorkspace,
  NOTES_FIXTURE,
  PROJECT,
  QUESTIONS_DATE,
  questionsFixture,
} from './interview-support.ts';
import { REPO_ROOT, tempDir } from './support.ts';

/**
 * Per ANALYZR_INTERVIEW_VERSION, the sha256 of the golden guides and records ({@link goldenDigest}):
 * a change to what the script writes for the same questions needs a new version in src/version.ts.
 */
const GUIDE_OUTPUTS: Readonly<Record<string, string>> = {
  '0.1.0': 'ca5c16d479bc3f34b0cad97dbb5cc5a2ab75e9760d6b8ad9047a8ea9259b3032',
};

const UPDATE = process.env['ANALYZR_UPDATE_GOLDEN'] === '1';

type Workspace = Awaited<ReturnType<typeof interviewWorkspace>>;

/** Runs one golden's `guide` in `w`, the guide named after the golden. */
async function runGolden(w: Workspace, golden: (typeof GOLDEN_GUIDES)[number], script?: string) {
  const args = [
    'guide',
    w.questions(golden.ext),
    '--workspace',
    w.ws,
    ...golden.args,
    '--out',
    path.join(w.guides, `${golden.name}.md`),
  ];
  if (golden.notes === true) {
    await mkdir(w.guides, { recursive: true });
    const notes = path.join(w.guides, path.basename(NOTES_FIXTURE));
    await copyFile(NOTES_FIXTURE, notes);
    args.push('--notes', notes);
  }
  return interview(args, script === undefined ? {} : { script });
}

/** sha256 over the golden files' names and bytes. */
async function goldenDigest(): Promise<string> {
  const hash = createHash('sha256');
  for (const file of (await readdir(GUIDE_GOLDENS)).sort()) {
    hash
      .update(`${file}\0`)
      .update(await readFile(path.join(GUIDE_GOLDENS, file)))
      .update('\0');
  }
  return hash.digest('hex');
}

describe('the golden guides', () => {
  it.each(GOLDEN_GUIDES.map((g) => [g.name, g] as const))('%s', async (name, golden) => {
    const w = await interviewWorkspace();
    const r = await runGolden(w, golden);
    expect(r, r.stderr).toMatchObject({ code: 0, stderr: '' });
    const out = JSON.parse(r.stdout) as { ids: string[]; questions: number; warnings: unknown[] };
    expect(out.warnings).toEqual([]);
    for (const file of [`${name}.md`, `${name}.guide.json`]) {
      const written = await readFile(path.join(w.guides, file), 'utf8');
      if (UPDATE) {
        await mkdir(GUIDE_GOLDENS, { recursive: true });
        await writeFile(path.join(GUIDE_GOLDENS, file), written);
      }
      expect(written, file).toBe(await readFile(path.join(GUIDE_GOLDENS, file), 'utf8'));
    }
    // every id exactly once, in the guide's order, as its record and the output list them
    const guide = await readFile(path.join(w.guides, `${name}.md`), 'utf8');
    const record = JSON.parse(
      await readFile(path.join(w.guides, `${name}.guide.json`), 'utf8'),
    ) as {
      questions: { n: number; id: string }[];
    };
    const shown = [...guide.matchAll(/^`(q-[0-9a-f]{16})` /gm)].map((m) => m[1]);
    expect(shown).toEqual(out.ids);
    expect(record.questions.map((q) => q.id)).toEqual(out.ids);
    expect(record.questions.map((q) => q.n)).toEqual(out.ids.map((_, i) => i + 1));
    for (const id of out.ids) expect(guide.split(id).length - 1, id).toBe(1);
    expect([...guide.matchAll(/^### F(\d+)\. /gm)].map((m) => Number(m[1]))).toEqual(
      out.ids.map((_, i) => i + 1),
    );
  });

  it('pins what the script writes per ANALYZR_INTERVIEW_VERSION', async () => {
    const digest = await goldenDigest();
    expect(
      digest,
      `analyzr-interview ${ANALYZR_INTERVIEW_VERSION} wrote other guides before: bump ANALYZR_INTERVIEW_VERSION in src/version.ts and add {'<new version>': '${digest}'} to GUIDE_OUTPUTS`,
    ).toBe(GUIDE_OUTPUTS[ANALYZR_INTERVIEW_VERSION]);
  });

  it('writes the same bytes on every run, from any folder', async () => {
    const [a, b] = [await interviewWorkspace(), await interviewWorkspace()];
    const golden = GOLDEN_GUIDES[0]!;
    await runGolden(a, golden);
    const args = ['guide', b.questions('json'), '--workspace', b.ws, ...golden.args];
    await mkdir(b.guides, { recursive: true });
    await copyFile(NOTES_FIXTURE, path.join(b.guides, path.basename(NOTES_FIXTURE)));
    const r = await interview(
      [...args, '--notes', path.join(b.guides, path.basename(NOTES_FIXTURE))],
      { cwd: await tempDir() },
    );
    expect(r).toMatchObject({ code: 0, stderr: '' });
    // the default name: <date>-<slugs>.md
    expect(path.basename((JSON.parse(r.stdout) as { guide: string }).guide)).toBe(
      `${golden.name}.md`,
    );
    for (const file of [`${golden.name}.md`, `${golden.name}.guide.json`]) {
      expect(await readFile(path.join(b.guides, file), 'utf8')).toBe(
        await readFile(path.join(a.guides, file), 'utf8'),
      );
    }
  });

  it('opens with the neutral consent checklist and speaks to the interviewee with „du“', async () => {
    const guide = await readFile(
      path.join(GUIDE_GOLDENS, `${QUESTIONS_DATE}-organisationseinheit-lager.md`),
      'utf8',
    );
    const before = /## Vor dem Gespräch\n\n([\s\S]*?)\n\n## /.exec(guide)?.[1] ?? '';
    expect(before.split('\n')).toEqual([
      ...CONSENT_CHECKLIST.map((l) => `- [ ] ${l}`),
      '',
      CONSENT_WITHOUT,
    ]);
    // the consent of decision 31 (3), word for word, and what holds without it
    expect(CONSENT_CHECKLIST[0]).toBe(
      'Einverständnis eingeholt: Aufzeichnung oder Mitschrift, Auswertung mit einem KI-Assistenten (Namen vorher ersetzt), Ergebnis in analyzr ohne Namen',
    );
    expect(CONSENT_WITHOUT).toContain(
      'Ohne Einverständnis zur Auswertung mit einem KI-Assistenten',
    );
    // after the interview, under „Abschluss“: transcripts/, and no AI assistant while names are in it
    const closing = /\n## Abschluss\n\n([\s\S]*)$/.exec(guide)?.[1];
    expect(closing).toBe(`„${GUIDE_QUOTES.closing}“\n\n${AFTER_INTERVIEW}\n`);
    expect(AFTER_INTERVIEW).toContain('geht es an keinen KI-Assistenten');
    const quotes = [...guide.matchAll(/„([^“]+)“/g)].map((m) => m[1] ?? '');
    expect(quotes.join(' ')).toMatch(/\bdu\b/);
    // the texts the script writes say „du“; „Sie“ and „Ihr…“ only where the questions quote
    // the customer's labels
    const own = guide
      .split('\n')
      .filter((l) => !/^(### F|- |`q-)/.test(l))
      .join('\n');
    expect(formalAddress(own)).toBe(false);
  });
});

describe('the guide’s lines', () => {
  const guideOf = async (notes: Parameters<typeof renderGuide>[0]['notes'] = null) => {
    const file = readQuestionsJson(await readFile(questionsFixture('json'), 'utf8'));
    const { groups, items } = selectQuestions(file, ['organisationseinheit-lager']);
    return renderGuide({
      project: PROJECT,
      date: QUESTIONS_DATE,
      input: 'json',
      groups,
      items,
      total: items.length,
      notes,
    });
  };

  it('leaves out a line without a value and escapes every value as the server does', async () => {
    const guide = await guideOf();
    // F3 has no note, no hold, no agent notes
    const f3 = /### F3\.[\s\S]*?(?=\n### F4\.)/.exec(guide)?.[0] ?? '';
    expect(f3).not.toMatch(/Bisher notiert|Vormerkung|Was die Landkarte|Nachfragen/);
    expect(guide).toContain(
      '- Notiz zur Vormerkung: Laut Workshop gibt es einen eigenen Express-Ablauf, siehe https\\://wiki.nordwind.example/lager \\[intern\\] \\*vorläufig\\*',
    );
    // a heading on one line, a note's line break under its item
    expect(guide).toContain(
      '### F2. Gilt die Übergabe an den Versand auch für Expressaufträge? Und wer gibt sie frei?',
    );
    expect(guide).toContain(
      '- Bisher notiert (22.10.2026): Express läuft über die Packstation 2.  \n  Freigabe durch die Schichtleitung.',
    );
    // the actions to choose from by the answer, never the note; one alone without „je nach“
    expect(guide).toContain(
      '- In „Offene Fragen“ danach, je nach Antwort: „Liegt außerhalb der Landschaft“ oder „Verknüpfen mit …“',
    );
    expect(guide).toContain('- In „Offene Fragen“ danach: „Vorschlag prüfen“');
    expect(guide).not.toContain('Notiz hinzufügen');
    // without notes, no „Die Landkarte kennt“: the questions alone do not say what it knows
    expect(guide).not.toContain('Die Landkarte kennt');
    const known = await guideOf({ known: ['Wareneingang', '„Inventur“'], questions: new Map() });
    expect(known).toContain('Die Landkarte kennt in diesem Bereich: „Wareneingang“, „Inventur“');
  });
});

describe('the notes file', () => {
  const ids = new Set(['q-3f2a9c41d07be815', 'q-1e5f7a3c9d2b4086']);
  const errors = (text: string) => checkNotes(text, ids).errors.map((e) => `${e.path}: ${e.code}`);

  it('reads the fixture and the reference example', async () => {
    const fixture = checkNotes(
      await readFile(NOTES_FIXTURE, 'utf8'),
      new Set([...ids, 'q-8b1d0e2f4a6c9375', 'q-9d3b6f1a8e2c7054']),
    );
    expect(fixture.errors).toEqual([]);
    expect(fixture.warnings).toEqual([]);
    expect(fixture.notes?.known).toHaveLength(5);
  });

  it('refuses unknown keys and ids, long or broken texts, personal data and YAML tricks', () => {
    const f = 'format: analyzr-guide-notes/1\n';
    expect(errors('format: analyzr-guide-notes/2\n')).toEqual(['format: notes-format']);
    expect(errors(`${f}extra: 1\n`)).toEqual(['extra: notes-key']);
    expect(errors(`${f}questions:\n  q-0000000000000000: {landscape: x}\n`)).toEqual([
      'questions.q-0000000000000000: notes-unknown-question',
    ]);
    expect(errors(`${f}questions:\n  q-3f2a9c41d07be815: {landscape: x, quelle: y}\n`)).toEqual([
      'questions.q-3f2a9c41d07be815.quelle: notes-key',
    ]);
    // a question id in a text would show that id twice
    expect(
      errors(
        `${f}known: [Siehe q-1e5f7a3c9d2b4086]\nquestions:\n  q-3f2a9c41d07be815: {followUps: [Wie bei q-1e5f7a3c9d2b4086?]}\n`,
      ),
    ).toEqual([
      'known[0]: notes-question-id',
      'questions.q-3f2a9c41d07be815.followUps[0]: notes-question-id',
    ]);
    expect(
      errors(`${f}questions:\n  q-3f2a9c41d07be815: {landscape: "${'x'.repeat(301)}"}\n`),
    ).toEqual(['questions.q-3f2a9c41d07be815.landscape: notes-too-long']);
    expect(errors(`${f}questions:\n  q-3f2a9c41d07be815: {landscape: "a\\nb"}\n`)).toEqual([
      'questions.q-3f2a9c41d07be815.landscape: notes-line-break',
    ]);
    expect(errors(`${f}questions:\n  q-3f2a9c41d07be815: {followUps: [a, b, c, d]}\n`)).toEqual([
      'questions.q-3f2a9c41d07be815.followUps: notes-too-many',
    ]);
    expect(
      errors(
        `${f}questions:\n  q-1e5f7a3c9d2b4086:\n    followUps: [Ruf die Lagerleitung an (0151 2345 6789)?, Schreib an lager@nordwind.example?]\n`,
      ),
    ).toEqual([
      'questions.q-1e5f7a3c9d2b4086.followUps[0]: notes-personal-data',
      'questions.q-1e5f7a3c9d2b4086.followUps[1]: notes-personal-data',
    ]);
    expect(errors(`${f}known: &a [x]\nquestions: *a\n`).every((e) => /yaml/.test(e))).toBe(true);
    expect(errors(`${f}known: [x]\n---\nknown: [y]\n`)).toEqual(['line 3, column 1: yaml']);
    expect(
      errors(`${f}known: ${JSON.stringify(Array.from({ length: 51 }, (_, i) => `P${i}`))}\n`),
    ).toEqual(['known: notes-too-many']);
    // the messages name the kind of personal data, never the value
    const text = `${f}questions:\n  q-1e5f7a3c9d2b4086: {landscape: "Mail an lager@nordwind.example"}\n`;
    expect(JSON.stringify(checkNotes(text, ids))).not.toContain('lager@');
  });

  it('warns when a follow-up addresses the interviewee formally', () => {
    const text =
      'format: analyzr-guide-notes/1\nquestions:\n  q-3f2a9c41d07be815:\n    followUps:\n      - Wann bekommen Sie das Avis?\n      - Sie oder die Schichtleitung?\n      - Wer bekommt das Avis, wenn sie im Urlaub sind?\n';
    const address = (i: number) => ({
      path: `questions.q-3f2a9c41d07be815.followUps[${i}]`,
      code: 'address-form',
      message: 'says „Sie“ or „Ihr…“: the guide addresses the interviewee with „du“',
    });
    // „Sie“ at a sentence start too: in a question to the interviewee it is the formal address
    expect(checkNotes(text, ids).warnings).toEqual([address(0), address(1)]);
    expect(formalAddress('Wo liegt Ihre Ablage?')).toBe(true);
    expect(formalAddress('Was können wir Ihnen schicken?')).toBe(true);
    expect(formalAddress('Ihr Team, die Disposition? Wer genau?')).toBe(false);
    expect(formalAddress('Wer prüft, ob sie vollständig ist?')).toBe(false);
  });
});

describe('analyzr-interview.mjs from source', () => {
  it('lists the groups by slug', async () => {
    const w = await interviewWorkspace();
    const r = await interview(['groups', w.questions('json'), '--workspace', w.ws]);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(r.stdout)).toEqual({
      input: 'json',
      questionsFile: `interviews/questions/${QUESTIONS_DATE}.questions.json`,
      questions: 10,
      groups: [
        { slug: 'organisationseinheit-lager', label: 'Organisationseinheit Lager', count: 4 },
        { slug: 'lanes-lagerleitung', label: 'Lanes Lagerleitung', count: 2 },
        { slug: 'lanes-disposition-versand', label: 'Lanes Disposition, Versand', count: 2 },
        { slug: 'lanes-lager', label: 'Lanes Lager', count: 1 },
        { slug: 'ohne-ansprechpartner', label: 'Ohne Ansprechpartner', count: 1 },
      ],
      leftOut: { informational: 1, answered: 1, technical: 1, agent: 1, proposal: 1 },
      warnings: [],
    });
  });

  it('takes groups by slug only, never a label', async () => {
    const w = await interviewWorkspace();
    const base = ['guide', w.questions('json'), '--workspace', w.ws];
    const label = await interview([...base, '--group', 'Organisationseinheit Lager']);
    expect(label.code).toBe(2);
    expect(label.stderr).toContain(
      '--group takes a slug as analyzr-interview.mjs groups prints it',
    );
    const unknown = await interview([...base, '--group', 'einkauf']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain(
      'no group einkauf in this file; its groups: organisationseinheit-lager, lanes-versand,',
    );
    expect((await interview(base)).code).toBe(2);
    // a group whose questions are all done
    const done = await interview([...base, '--group', 'lanes-versand']);
    expect(done).toMatchObject({
      code: 1,
      stderr: 'analyzr-interview: these groups hold no question to clarify\n',
    });
    await expect(readdir(w.guides)).rejects.toThrow();
  });

  it('reads only below interviews/questions/ and writes only into interviews/guides/', async () => {
    const w = await interviewWorkspace();
    const guide = (input: string, ...more: string[]) =>
      interview([
        'guide',
        input,
        '--workspace',
        w.ws,
        '--group',
        'organisationseinheit-lager',
        ...more,
      ]);
    // a transcript, a file in the workspace root, the owner key: refused, unread
    await mkdir(path.join(w.ws, 'transcripts'), { recursive: true });
    for (const file of [
      path.join(w.ws, 'transcripts', '2026-10-27.questions.json'),
      path.join(w.ws, '2026-10-27.questions.json'),
    ]) {
      await copyFile(questionsFixture('json'), file);
      const r = await guide(file);
      expect(r.code, file).toBe(1);
      expect(r.stderr).toContain(
        "the questions file lies in the workspace's interviews/questions/",
      );
    }
    // a symbolic or hard link inside the folder
    const linked = path.join(w.ws, 'interviews', 'questions', '2026-10-28.questions.json');
    await symlink(path.join(w.ws, 'transcripts', '2026-10-27.questions.json'), linked);
    expect((await guide(linked)).code).toBe(1);
    const hard = path.join(w.ws, 'interviews', 'questions', '2026-10-29.questions.json');
    await link(path.join(w.ws, '2026-10-27.questions.json'), hard);
    expect((await guide(hard)).stderr).toContain('a symbolic link, a hard link or no regular file');
    // --out outside interviews/guides/, or not a .md
    for (const out of [
      path.join(w.ws, 'reports', 'x.md'),
      path.join(w.guides, 'x.guide.md'),
      path.join(w.guides, 'x.txt'),
    ]) {
      const r = await guide(w.questions('json'), '--out', out);
      expect(r.code, out).toBe(1);
      expect(r.stderr).toContain("it names a new <name>.md in the workspace's interviews/guides/");
    }
    // the notes file only in interviews/guides/
    const notes = path.join(w.ws, 'x.notes.yaml');
    await copyFile(NOTES_FIXTURE, notes);
    expect((await guide(w.questions('json'), '--notes', notes)).stderr).toContain(
      "the notes file lies in the workspace's interviews/guides/",
    );
    await expect(readdir(w.guides)).rejects.toThrow();
  });

  it('refuses a workspace without its file or inside a checkout, and a date it cannot read', async () => {
    const w = await interviewWorkspace();
    const bare = await tempDir();
    const r = await interview(['groups', w.questions('json'), '--workspace', bare]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('holds no analyzr-workspace.json');
    const inside = await interview(['groups', questionsFixture('json'), '--workspace', REPO_ROOT]);
    expect(inside.code).toBe(1);
    expect(inside.stderr).toContain('lies inside the analyzr checkout');
    const renamed = path.join(w.ws, 'interviews', 'questions', 'offene-fragen.json');
    await copyFile(questionsFixture('json'), renamed);
    const undated = await interview([
      'guide',
      renamed,
      '--workspace',
      w.ws,
      '--group',
      'organisationseinheit-lager',
    ]);
    expect(undated.code).toBe(2);
    expect(undated.stderr).toContain('--date <YYYY-MM-DD> is required');
    for (const date of ['2026-02-30', '27.10.2026', '2026-13-01']) {
      const bad = await interview([
        'guide',
        renamed,
        '--workspace',
        w.ws,
        '--group',
        'organisationseinheit-lager',
        '--date',
        date,
      ]);
      expect(bad.code, date).toBe(2);
    }
    const ok = await interview([
      'guide',
      renamed,
      '--workspace',
      w.ws,
      '--group',
      'organisationseinheit-lager',
      '--date',
      '2026-10-30',
    ]);
    expect(path.basename((JSON.parse(ok.stdout) as { guide: string }).guide)).toBe(
      '2026-10-30-organisationseinheit-lager.md',
    );
  });

  it('keeps an existing guide unless --replace, and writes nothing when the notes fail', async () => {
    const w = await interviewWorkspace();
    const golden = GOLDEN_GUIDES[0]!;
    expect((await runGolden(w, golden)).code).toBe(0);
    const file = path.join(w.guides, `${golden.name}.md`);
    await writeFile(file, '# Meine Notizen\n');
    const again = await runGolden(w, golden);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('exists (the consultant may have written into it)');
    expect(await readFile(file, 'utf8')).toBe('# Meine Notizen\n');
    // broken notes: errors on stdout, exit 1, nothing written
    const notes = path.join(w.guides, `${golden.name}.notes.yaml`);
    await writeFile(notes, 'format: analyzr-guide-notes/1\nquestions:\n  q-0000000000000000: {}\n');
    const args = ['guide', w.questions('json'), '--workspace', w.ws, ...golden.args];
    const failed = await interview([...args, '--notes', notes, '--out', file, '--replace']);
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({
      written: false,
      errors: [{ path: 'questions.q-0000000000000000', code: 'notes-unknown-question' }],
    });
    expect(await readFile(file, 'utf8')).toBe('# Meine Notizen\n');
    const replaced = await interview([...args, '--out', file, '--replace']);
    expect(replaced.code).toBe(0);
    expect(await readFile(file, 'utf8')).toMatch(
      /^# Interviewleitfaden: Organisationseinheit Lager\n/,
    );
  });

  it('leaves the notes of a question --max cuts off unused', async () => {
    const w = await interviewWorkspace();
    await mkdir(w.guides, { recursive: true });
    const notes = path.join(w.guides, path.basename(NOTES_FIXTURE));
    await copyFile(NOTES_FIXTURE, notes);
    const r = await interview([
      'guide',
      w.questions('json'),
      '--workspace',
      w.ws,
      '--group',
      'organisationseinheit-lager',
      '--max',
      '1',
      '--notes',
      notes,
    ]);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    const out = JSON.parse(r.stdout) as {
      guide: string;
      ids: string[];
      questions: number;
      of: number;
    };
    expect(out).toMatchObject({ ids: ['q-3f2a9c41d07be815'], questions: 1, of: 4 });
    const guide = await readFile(out.guide, 'utf8');
    expect(guide).toContain('· die erste von 4 Fragen in der Reihenfolge');
    expect(guide).toContain('Kommt jede Lieferung mit einem Avis an?');
    expect(guide).not.toContain('Wer stößt den Nachschub an');
  });

  it('keeps the list’s order across groups and warns when --max leaves a group empty', async () => {
    const w = await interviewWorkspace();
    const r = await interview([
      'guide',
      w.questions('json'),
      '--workspace',
      w.ws,
      '--group',
      'lanes-lager',
      '--group',
      'organisationseinheit-lager',
      '--max',
      '3',
    ]);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    const out = JSON.parse(r.stdout) as {
      guide: string;
      ids: string[];
      groups: { slug: string }[];
      warnings: { code: string; message: string }[];
    };
    expect(out.ids).toEqual(['q-3f2a9c41d07be815', 'q-8b1d0e2f4a6c9375', 'q-1e5f7a3c9d2b4086']);
    expect(out.groups.map((g) => g.slug)).toEqual(['organisationseinheit-lager']);
    expect(out.warnings).toEqual([
      {
        code: 'group-cut',
        message:
          "--max 3 leaves the group lanes-lager without a question: its questions come later in the file's order",
      },
    ]);
    expect(path.basename(out.guide)).toBe(`${QUESTIONS_DATE}-organisationseinheit-lager.md`);
    // a chosen group with nothing to ask beside one with questions
    const empty = await interview([
      'guide',
      w.questions('json'),
      '--workspace',
      w.ws,
      '--group',
      'lanes-lager',
      '--group',
      'lanes-versand',
    ]);
    expect(JSON.parse(empty.stdout)).toMatchObject({
      ids: ['q-0d2f4b6a8c3e1597'],
      warnings: [
        { code: 'group-empty', message: 'the group lanes-versand holds no question to clarify' },
      ],
    });
  });

  it('follows no link of the interviews folders, of --out, and writes only into the workspace', async () => {
    const w = await interviewWorkspace();
    const questions = path.join(w.ws, 'interviews', 'questions');
    // interviews/questions as a link into transcripts/
    await mkdir(path.join(w.ws, 'transcripts'), { recursive: true });
    await rename(questions, path.join(w.ws, 'transcripts', 'q'));
    await symlink(path.join(w.ws, 'transcripts', 'q'), questions);
    const read = await interview(['groups', w.questions('json'), '--workspace', w.ws]);
    expect(read.code).toBe(1);
    expect(read.stderr).toContain('interviews/questions/ of the workspace is a symbolic link');
    await rename(questions, path.join(w.ws, 'link'));
    await rename(path.join(w.ws, 'transcripts', 'q'), questions);
    // interviews/guides as a link out of the workspace
    const elsewhere = await tempDir();
    await symlink(elsewhere, w.guides);
    const base = ['guide', w.questions('json'), '--workspace', w.ws, '--group', 'lanes-lager'];
    const write = await interview(base);
    expect(write.code).toBe(1);
    expect(write.stderr).toContain('interviews/guides/ of the workspace is a symbolic link');
    expect(await readdir(elsewhere)).toEqual([]);
    await rename(w.guides, path.join(w.ws, 'link-2'));
    // --out as a link to the consultant's own file, even with --replace
    await mkdir(w.guides);
    const own = path.join(w.guides, 'eigene.md');
    await writeFile(own, '# Meine Notizen\n');
    await symlink(own, path.join(w.guides, 'b.md'));
    const linked = await interview([...base, '--out', path.join(w.guides, 'b.md'), '--replace']);
    expect(linked.code).toBe(1);
    expect(linked.stderr).toContain('is refused');
    expect(await readFile(own, 'utf8')).toBe('# Meine Notizen\n');
    expect((await readdir(w.guides)).sort()).toEqual(['b.md', 'eigene.md']);
  });

  it('checks the size before it reads, and reads the notes as strict UTF-8', async () => {
    const w = await interviewWorkspace();
    const big = path.join(w.ws, 'interviews', 'questions', '2026-10-28.questions.json');
    await writeFile(big, '');
    await truncate(big, 21 * 1024 * 1024);
    const r = await interview(['groups', big, '--workspace', w.ws]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('22020096 bytes; a questions file holds at most 20971520');
    await mkdir(w.guides, { recursive: true });
    const notes = path.join(w.guides, 'x.notes.yaml');
    await writeFile(
      notes,
      Buffer.concat([
        Buffer.from('format: analyzr-guide-notes/1\nknown: [Wareneingang'),
        Buffer.from([0xff]),
        Buffer.from(']\n'),
      ]),
    );
    const args = ['guide', w.questions('json'), '--workspace', w.ws, '--group', 'lanes-lager'];
    const bad = await interview([...args, '--notes', notes]);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout)).toMatchObject({
      written: false,
      errors: [{ code: 'notes-encoding' }],
    });
    await truncate(notes, 300 * 1024);
    const large = await interview([...args, '--notes', notes]);
    expect(JSON.parse(large.stdout)).toMatchObject({ errors: [{ code: 'notes-too-large' }] });
    expect(await readdir(w.guides)).toEqual(['x.notes.yaml']);
  });

  it('warns of personal data in what analyzr holds, naming the question, never the value', async () => {
    const w = await interviewWorkspace();
    const items = JSON.parse(await readFile(w.questions('json'), 'utf8')) as {
      answers: { text: string }[];
    }[];
    items[0]!.answers[0]!.text =
      'Laut Lagerleitung (lager@nordwind.example) kommt das Avis per Portal.';
    await writeFile(w.questions('json'), JSON.stringify(items));
    const r = await interview([
      'guide',
      w.questions('json'),
      '--workspace',
      w.ws,
      '--group',
      'organisationseinheit-lager',
    ]);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    const out = JSON.parse(r.stdout) as { warnings: unknown[] };
    expect(out.warnings).toEqual([
      {
        code: 'personal-data',
        message:
          'F1 (q-3f2a9c41d07be815): latestNote holds eine E-Mail-Adresse; the guide shows it as analyzr has it',
      },
    ]);
    expect(r.stdout).not.toContain('lager@');
  });

  it('prints its usage with its version', async () => {
    const r = await interview(['--help']);
    expect(r.stdout).toMatch(
      new RegExp(
        `analyzr-integrate analyzr-interview ${ANALYZR_INTERVIEW_VERSION.replaceAll('.', '\\.')}\\n$`,
      ),
    );
    expect((await interview(['guess'])).code).toBe(2);
  });
});
