// The open questions an interview guide is made from (src/interview/questions.ts, M6 S6 §2.1,
// §2.2): the three inputs, the fixtures as the server writes them, the copies of the server's
// rules, grouping, slugs, order and selection, and the refusals.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { OpenQuestion } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import {
  countGroups,
  groupsOf,
  leftOutCounts,
  leftOutReason,
  QuestionsError,
  readQuestionsCsv,
  readQuestionsJson,
  readQuestionsMarkdown,
  selectQuestions,
  type QuestionItem,
} from '../src/interview/questions.ts';
import { askWhoGroup, escapeMarkdown, unescapeMarkdown } from '../src/interview/server-rules.ts';

import { questionsFixture } from './interview-support.ts';
import { PACKAGE_ROOT, REPO_ROOT } from './support.ts';

const UPDATE = process.env['ANALYZR_UPDATE_GOLDEN'] === '1';
const SERVER_EXPORT = path.join(REPO_ROOT, 'apps/server/src/domain/open-questions/export.ts');

const fixture = (ext: 'json' | 'md' | 'csv') => readFile(questionsFixture(ext), 'utf8');
const json = async () => readQuestionsJson(await fixture('json'));
const markdown = async () => readQuestionsMarkdown(await fixture('md'));
const csv = async () => readQuestionsCsv(await fixture('csv'));

/** What the server's export module offers (loaded at run time: tools/integrate imports nothing from apps/). */
interface ServerExport {
  renderOpenQuestionsMarkdown: (
    items: readonly unknown[],
    header: {
      projectName: string;
      asOf: Date;
      filter: Record<string, unknown>;
      concerns?: ReadonlyMap<string, string>;
    },
  ) => string;
  renderOpenQuestionsCsv: (
    items: readonly unknown[],
    concerns?: ReadonlyMap<string, string>,
  ) => string;
  escapeMarkdown: (text: string) => string;
  askWhoGroup: (askWho: unknown) => string | null;
}

/** A function's or constant's source text, from its first line to its closing line at column 0. */
function block(source: string, start: string): string {
  const lines = source.split('\n');
  const from = lines.findIndex((l) => l.startsWith(start));
  if (from < 0) throw new Error(`no ${start}`);
  const to = lines.findIndex((l, i) => i > from && /^\}\)?;?$/.test(l));
  return lines.slice(from, to + 1).join('\n');
}

describe('the questions fixtures', () => {
  it('are open questions as the contracts define them, in the order analyzr lists them', async () => {
    const items = JSON.parse(await fixture('json')) as unknown;
    expect(OpenQuestion.array().safeParse(items).error?.issues ?? []).toEqual([]);
    expect((await json()).warnings).toEqual([]);
  });

  it("are the server's Markdown and CSV exports of the JSON", async () => {
    const server = (await import(pathToFileURL(SERVER_EXPORT).href)) as ServerExport;
    const items = JSON.parse(await fixture('json')) as { group: string; state: string }[];
    const concerns = new Map([
      ['q-c47e2a9b05d1f863', '„Bestandsüberwachung“ in „Nordwind Handel – Lager“'],
      ['q-b2d4f6a8c0e1357a', '„Inventur“ in „Nordwind Handel – Inventur“'],
    ]);
    const md = server.renderOpenQuestionsMarkdown(
      items.filter((q) => q.group !== 'proposal'),
      {
        projectName: 'Nordwind Handel GmbH',
        asOf: new Date('2026-10-27T15:00:00.000Z'),
        filter: { group: ['ask', 'agent', 'info'] },
        concerns,
      },
    );
    const sheet = server.renderOpenQuestionsCsv(
      items.filter((q) => (q.group === 'ask' || q.group === 'agent') && q.state === 'open'),
      concerns,
    );
    if (UPDATE) {
      await writeFile(questionsFixture('md'), md);
      await writeFile(questionsFixture('csv'), sheet);
    }
    expect(await fixture('md')).toBe(md);
    expect(await fixture('csv')).toBe(sheet);
    // and the copies give what the server gives
    for (const text of [
      'Versand_Auftrag*Eil',
      'siehe https://wiki.example/x [intern]',
      '1. Zeile\n- zwei',
    ]) {
      expect(escapeMarkdown(text)).toBe(server.escapeMarkdown(text));
    }
  });

  it("copy the server's export rules unchanged (src/interview/server-rules.ts)", async () => {
    const server = await readFile(SERVER_EXPORT, 'utf8');
    const copy = await readFile(path.join(PACKAGE_ROOT, 'src/interview/server-rules.ts'), 'utf8');
    // (the copy exports `slug`, which the server keeps to itself)
    const unexported = (text: string) => text.replace(/^export /, '');
    for (const name of [
      'function ownersText(',
      'function contactText(',
      'function askWhoGroup(',
      'function detailText(',
      'const DATE = new Intl.DateTimeFormat(',
      'function formatDateDe(',
      'function escapeMarkdown(',
      'function slug(',
    ]) {
      const find = (text: string) =>
        unexported(block(text, text.includes(`export ${name}`) ? `export ${name}` : name));
      expect(find(copy), name).toBe(find(server));
    }
    expect(copy).toContain("const WITHOUT_HINT = 'Ohne Ansprechpartner';");
    expect(server).toContain("const WITHOUT_HINT = 'Ohne Ansprechpartner';");
  });
});

describe('reading the three inputs', () => {
  it('reads the same questions from each, with what each input carries', async () => {
    const [j, m, c] = [await json(), await markdown(), await csv()];
    const byId = (items: readonly QuestionItem[]) => new Map(items.map((q) => [q.id, q]));
    const fromJson = byId(j.items);
    expect(j.items).toHaveLength(15);
    expect(m.items).toHaveLength(14);
    expect(c.items).toHaveLength(12);
    for (const q of m.items) {
      const twin = fromJson.get(q.id);
      expect(twin, q.id).toBeDefined();
      expect([q.kind, q.kindLabel, q.text, q.detail, q.context, q.label], q.id).toEqual([
        twin?.kind,
        twin?.kindLabel,
        twin?.text,
        twin?.detail,
        twin?.context,
        twin?.label,
      ]);
      // the server's Markdown groups are the JSON's
      expect(q.groupLabel, q.id).toBe(twin?.groupLabel);
      expect(q.contact, q.id).toBe(twin?.contact);
      expect(q.latestNote, q.id).toEqual(twin?.latestNote);
    }
    for (const q of c.items) {
      const twin = fromJson.get(q.id);
      expect(q.text, q.id).toBe(
        twin?.detail === null ? twin.text : `${twin?.text} ${twin?.detail}`,
      );
      expect(q.contact, q.id).toBe(twin?.contact);
      expect(q.latestNote?.text, q.id).toBe(twin?.latestNote?.text);
      expect(q.latestNote?.date ?? null, q.id).toBeNull();
    }
    // JSON alone carries the models, the counts and the actions; the exports' „Betrifft“ names more
    expect(fromJson.get('q-3f2a9c41d07be815')).toMatchObject({
      modelKeys: ['lager/wareneingang'],
      unlocks: 12,
      block: 0,
      primaryAction: 'Liegt außerhalb der Landschaft',
      // every action but the note, in the web's order
      actions: ['Liegt außerhalb der Landschaft', 'Verknüpfen mit …'],
      latestNote: {
        text: 'Laut Lagerleitung kommt das Avis über das Speditionsportal.',
        date: '21.10.2026',
      },
    });
    expect(byId(m.items).get('q-c47e2a9b05d1f863')).toMatchObject({
      subjectLabel: '„Bestandsüberwachung“ in „Nordwind Handel – Lager“',
      detail:
        'Laut Agent: Die Bestandsüberwachung passt zu „Lager“ und zu „Controlling“; das Modell sagt nicht, wer sie verantwortet.',
      modelKeys: [],
      unlocks: null,
      primaryAction: null,
      actions: [],
    });
    expect(m.projectName).toBe('Nordwind Handel GmbH');
  });

  it('undoes the Markdown escape, line breaks and all', async () => {
    const hold = (await markdown()).items.find((q) => q.id === 'q-8b1d0e2f4a6c9375');
    expect(hold).toMatchObject({
      text: 'Gilt die Übergabe an den Versand auch für Expressaufträge?\nUnd wer gibt sie frei?',
      context:
        'Laut Workshop gibt es einen eigenen Express-Ablauf, siehe https://wiki.nordwind.example/lager [intern] *vorläufig*',
      label: 'mit Lager klären',
      latestNote: {
        text: 'Express läuft über die Packstation 2.\nFreigabe durch die Schichtleitung.',
        date: '22.10.2026',
      },
    });
    for (const text of [
      'a\\*b `c` [d] <e> |f| ~g~ _h_ Participant_Bank &amp; x://y www.example.org a@b.de',
      '# Titel\n> Zitat\n- Punkt\n+ plus\n= gleich\n1. Liste\n2) zwei',
      'Ende mit Leerzeichen \nund leere Zeile\n\ndanach',
      'Backslash \\ vor \\: und \\_',
    ]) {
      expect(unescapeMarkdown(escapeMarkdown(text).split('\n')), text).toBe(text);
    }
  });

  it('marks what no guide asks: informational, answered, technical, the agents’ and the chain’s', async () => {
    expect(leftOutCounts(await json())).toEqual({
      informational: 1,
      answered: 1,
      technical: 1,
      agent: 1,
      proposal: 1,
    });
    // the Markdown names the agent's question and a technical one by their kind, an
    // informational item and a live outside mark by their lines; the CSV holds the open
    // questions only
    expect(leftOutCounts(await markdown())).toEqual({
      informational: 1,
      answered: 1,
      technical: 1,
      agent: 1,
      proposal: 0,
    });
    expect(leftOutCounts(await csv())).toEqual({
      informational: 0,
      answered: 0,
      technical: 1,
      agent: 1,
      proposal: 0,
    });
    expect(leftOutCounts(await json(), { includeAgent: true }).agent).toBe(0);
    // the work for the consultant, whatever the input: a model to export again
    for (const file of [await json(), await markdown(), await csv()]) {
      expect(
        file.items.filter((q) => leftOutReason(q) === 'technical').map((q) => q.id),
        file.input,
      ).toEqual(['q-e3a5c7f9b1d0284a']);
    }
  });
});

describe('groups, slugs and selection', () => {
  it('groups as the server does, „Ohne Ansprechpartner“ last, slugs unique and ASCII', async () => {
    const j = await json();
    // the slug is the whole label (the server's file-name rule), so a lane and an org unit of
    // the same name never compete for one
    expect(j.groups.map((g) => [g.slug, g.label])).toEqual([
      ['organisationseinheit-lager', 'Organisationseinheit Lager'],
      ['lanes-versand', 'Lanes Versand'],
      ['lanes-lagerleitung', 'Lanes Lagerleitung'],
      ['lanes-disposition-versand', 'Lanes Disposition, Versand'],
      ['organisationseinheiten-lager-versand', 'Organisationseinheiten Lager, Versand'],
      ['lanes-lager', 'Lanes Lager'],
      ['ohne-ansprechpartner', 'Ohne Ansprechpartner'],
    ]);
    expect((await markdown()).groups.map((g) => [g.slug, g.label])).toEqual(
      j.groups.map((g) => [g.slug, g.label]),
    );
    // the CSV's contact cell joins owners and lanes into groups of its own
    expect((await csv()).groups.map((g) => g.slug)).toEqual([
      'lager-wareneingang',
      'lager-kommissionierung',
      'lagerleitung',
      'disposition-versand',
      'lager-wareneingang-qualitaetspruefung',
      'lager-versand-packstation',
      'lager',
      'ohne-ansprechpartner',
    ]);
    // the server's group rule (cases of apps/server's export tests)
    expect(askWhoGroup({ lanes: ['A'], stepOwners: ['X', 'Y'], folder: 'f' })).toBe(
      'Organisationseinheiten X, Y',
    );
    expect(askWhoGroup({ lanes: ['A', 'B'], stepOwners: [], folder: 'f' })).toBe('Lanes A, B');
    expect(askWhoGroup({ lanes: [], stepOwners: [], folder: 'f' })).toBeNull();
    // long and odd names
    const odd = groupsOf(
      ['Ä'.repeat(90), '&', '&&', 'Lanes A-2', 'Lanes A', 'Lanes A.', 'Lanes A!'].map(
        (label) => ({ groupLabel: label }) as QuestionItem,
      ),
    );
    expect(odd.map((g) => g.slug)).toEqual([
      'ae'.repeat(30),
      'gruppe',
      'gruppe-2',
      'lanes-a-2',
      'lanes-a',
      'lanes-a-3',
      'lanes-a-4',
    ]);
    for (const g of odd) expect(g.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    // many groups of one slug stay fast (a counter per slug, not a search from 2)
    const many = Array.from(
      { length: 20_000 },
      (_, i) => ({ groupLabel: String.fromCodePoint(0x4e00 + i) }) as QuestionItem,
    );
    const started = performance.now();
    expect(groupsOf(many).at(-1)?.slug).toBe('gruppe-20000');
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('counts per group only what a guide asks', async () => {
    const count = (file: Awaited<ReturnType<typeof json>>, includeAgent = false) =>
      countGroups(file, { includeAgent }).map((g) => `${g.slug}:${g.count}`);
    // `lanes-versand` holds only the answered question, `organisationseinheiten-lager-versand`
    // only a technical one: no guide group
    expect(count(await json())).toEqual([
      'organisationseinheit-lager:4',
      'lanes-lagerleitung:2',
      'lanes-disposition-versand:2',
      'lanes-lager:1',
      'ohne-ansprechpartner:1',
    ]);
    expect(count(await json(), true)[0]).toBe('organisationseinheit-lager:5');
    expect(count(await markdown())).toEqual(count(await json()));
  });

  it('selects by slug and keeps the file’s order, also across the groups', async () => {
    const j = await json();
    const pick = (slugs: string[], includeAgent = false) =>
      selectQuestions(j, slugs, { includeAgent }).items.map((q) => q.id);
    const lager = [
      'q-3f2a9c41d07be815',
      'q-8b1d0e2f4a6c9375',
      'q-1e5f7a3c9d2b4086',
      'q-9d3b6f1a8e2c7054',
    ];
    expect(pick(['organisationseinheit-lager'])).toEqual(lager);
    expect(pick(['organisationseinheit-lager'], true)).toEqual([
      'q-3f2a9c41d07be815',
      'q-8b1d0e2f4a6c9375',
      'q-1e5f7a3c9d2b4086',
      'q-5a9c3e7b1f0d2846',
      'q-9d3b6f1a8e2c7054',
    ]);
    // the list's order across the groups (the most open decisions first), whatever the order of
    // the slugs: the Lagerleitung's question with 7 before the Lager's with 5
    expect(pick(['lanes-lagerleitung', 'organisationseinheit-lager'])).toEqual([
      'q-3f2a9c41d07be815',
      'q-8b1d0e2f4a6c9375',
      'q-c47e2a9b05d1f863',
      'q-1e5f7a3c9d2b4086',
      'q-9d3b6f1a8e2c7054',
      'q-b2d4f6a8c0e1357a',
    ]);
    expect(pick(['ohne-ansprechpartner', 'lanes-lager'])).toEqual(
      pick(['lanes-lager', 'ohne-ansprechpartner']),
    );
    expect(pick(['ohne-ansprechpartner', 'lanes-lager'])).toEqual([
      'q-6e0a2c4b8d1f5379',
      'q-0d2f4b6a8c3e1597',
    ]);
    // never the answered, the technical, the informational or the chain's
    expect(pick(['lanes-versand'])).toEqual([]);
    expect(pick(['organisationseinheiten-lager-versand'])).toEqual([]);
    expect(() => selectQuestions(j, ['Organisationseinheit Lager'])).toThrow(
      /no group Organisationseinheit Lager in this file; its groups: organisationseinheit-lager, lanes-versand, /,
    );
  });

  it('adds the agents’ questions from the Markdown and the CSV too', async () => {
    const [m, c] = [await markdown(), await csv()];
    const pick = (file: typeof m, slugs: string[], includeAgent: boolean) =>
      selectQuestions(file, slugs, { includeAgent }).items.map((q) => q.id);
    expect(pick(m, ['organisationseinheit-lager'], false)).toEqual([
      'q-3f2a9c41d07be815',
      'q-8b1d0e2f4a6c9375',
      'q-1e5f7a3c9d2b4086',
      'q-9d3b6f1a8e2c7054',
    ]);
    expect(pick(m, ['organisationseinheit-lager'], true)).toEqual([
      'q-3f2a9c41d07be815',
      'q-8b1d0e2f4a6c9375',
      'q-1e5f7a3c9d2b4086',
      'q-5a9c3e7b1f0d2846',
      'q-9d3b6f1a8e2c7054',
    ]);
    // the CSV's group of the contact cell „Lager, Kommissionierung“
    expect(pick(c, ['lager-kommissionierung'], false)).toEqual([
      'q-8b1d0e2f4a6c9375',
      'q-9d3b6f1a8e2c7054',
    ]);
    expect(pick(c, ['lager-kommissionierung'], true)).toEqual([
      'q-8b1d0e2f4a6c9375',
      'q-5a9c3e7b1f0d2846',
      'q-9d3b6f1a8e2c7054',
    ]);
  });

  it('warns when a hand-edited JSON is out of analyzr’s order', async () => {
    const items = JSON.parse(await fixture('json')) as unknown[];
    [items[0], items[1]] = [items[1], items[0]];
    expect(readQuestionsJson(JSON.stringify(items)).warnings).toEqual([
      {
        code: 'order-unexpected',
        message:
          "item 2 (q-3f2a9c41d07be815) is not in the order analyzr lists the questions in; the guide keeps the file's order",
      },
    ]);
  });
});

describe('refusals, never echoing the file', () => {
  const code = (fn: () => unknown): string => {
    try {
      fn();
    } catch (err) {
      if (err instanceof QuestionsError) return `${err.code}: ${err.message}`;
      throw err;
    }
    return 'no error';
  };

  it('JSON: not JSON, not a list, a bad field, a duplicate id', async () => {
    expect(code(() => readQuestionsJson('{"items": [ Frau Meier ]'))).toBe(
      'json: not valid JSON: write it with analyzr questions list --format json',
    );
    expect(code(() => readQuestionsJson('{"x": 1}'))).toMatch(/^json: not a list/);
    const items = JSON.parse(await fixture('json')) as Record<string, unknown>[];
    const bad = structuredClone(items);
    (bad[2] as Record<string, unknown>)['askWho'] = { lanes: 'Frau Meier', stepOwners: [] };
    expect(code(() => readQuestionsJson(JSON.stringify(bad)))).toBe(
      'json-item: item 3: askWho is no {lanes, stepOwners, folder}',
    );
    const id = structuredClone(items);
    (id[0] as Record<string, unknown>)['id'] = 'Frau Meier';
    expect(code(() => readQuestionsJson(JSON.stringify(id)))).toBe(
      'json-item: item 1: id is no open question id (q-…)',
    );
    expect(code(() => readQuestionsJson(JSON.stringify([items[0], items[0]])))).toBe(
      'duplicate-id: the id q-3f2a9c41d07be815 appears twice',
    );
    // a model key the guide shows as code: only a well-formed key (no backtick, no line break)
    for (const key of ['m/x` <img src=x onerror=alert(2)> `', 'lager/x\n## Überschrift', '']) {
      const keys = structuredClone(items);
      (keys[0] as Record<string, unknown>)['modelKeys'] = [key];
      expect(
        code(() => readQuestionsJson(JSON.stringify(keys))),
        key,
      ).toBe('json-item: item 1: modelKeys is no list of model keys');
    }
    // an unknown kind (a newer analyzr) keeps its name
    const kind = structuredClone(items);
    (kind[0] as Record<string, unknown>)['kind'] = 'new-kind';
    const read = readQuestionsJson(JSON.stringify(kind));
    expect(read.items[0]).toMatchObject({ kind: null, kindLabel: 'new-kind' });
    expect(read.warnings.map((w) => w.code)).toEqual(['kind-unknown']);
  });

  it('Markdown: no ids, an item without its id; an export of no questions is empty', async () => {
    expect(code(() => readQuestionsMarkdown('# Offene Fragen: X\n\nFrau Meier fragt.\n'))).toMatch(
      /^md-no-ids: no open question with its id/,
    );
    const empty = readQuestionsMarkdown(
      '# Offene Fragen: Nordwind Handel GmbH\n\nStand 27.10.2026: 0 offene Fragen, nach Ansprechpartner gruppiert.\n\nKeine offenen Fragen.\n',
    );
    expect([empty.items, empty.groups, empty.projectName]).toEqual([
      [],
      [],
      'Nordwind Handel GmbH',
    ]);
    const text = (await fixture('md')).replace('<!-- q-8b1d0e2f4a6c9375 -->\n', '');
    expect(code(() => readQuestionsMarkdown(text))).toBe(
      "md-id-missing: item 2 has no id (<!-- q-… --> right after its heading): only the web's Markdown export carries them",
    );
  });

  it('CSV: no id column, a row without an id, an unterminated cell', async () => {
    expect(code(() => readQuestionsCsv('"Frage";"Antwort"\r\n"x";""\r\n'))).toBe(
      'csv-columns: the CSV lacks the column "id", "Frage" or "Ansprechpartner" of the export',
    );
    const sheet = (await fixture('csv')).replace('"q-3f2a9c41d07be815"', '"Frau Meier"');
    expect(code(() => readQuestionsCsv(sheet))).toBe(
      'csv-id: row 2: no open question id (q-…) in "id"',
    );
    expect(code(() => readQuestionsCsv('"id";"Frage";"Ansprechpartner\r\n'))).toMatch(
      /^csv-unterminated-quote: /,
    );
    // a sheet of S5a (Ansprechpartner-Hinweis, Antwortart) still reads
    const old = (await fixture('csv')).replace('"Ansprechpartner";', '"Ansprechpartner-Hinweis";');
    expect(readQuestionsCsv(old).items).toHaveLength(12);
  });
});
