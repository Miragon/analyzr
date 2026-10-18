/**
 * Ingest of `eval/corpus/_sample` end to end with the real deterministic
 * libraries (`libraryAnalysis`: `@analyzr/bpmn-facts` + `@analyzr/relations`),
 * checked against `eval/corpus/_sample/expected.yaml`. The scored landscapes
 * are covered by corpus.test.ts.
 */
import type {
  FindingList,
  ImportResult,
  ModelPage,
  PutModelResult,
  RelationPage,
  RevisionFacts,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importForm, libraryView, type CorpusFile } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';

let database: TestDatabase;
let t: TestApp;
let files: CorpusFile[];

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject('sample');
  files = await corpusFiles('_sample');
});

afterAll(async () => {
  await database.drop();
});

async function relations(): Promise<string[]> {
  const page = (await (
    await t.asOwner('/api/v1/projects/sample/relations?limit=200')
  ).json()) as RelationPage;
  return page.items.map((r) => `${r.type} ${r.from} ${r.to} ${r.status} ${r.tier}`).sort();
}

describe('real @analyzr/bpmn-facts and @analyzr/relations on eval/corpus/_sample', () => {
  it('imports every model and stores the extracted facts', async () => {
    const res = await t.asOwner('/api/v1/projects/sample/imports', {
      method: 'POST',
      body: importForm(files),
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as ImportResult;
    expect(result.files.map((f) => [f.modelKey, f.outcome])).toEqual([
      ['finance/payment-collection', 'created'],
      ['finanzen/rechnungsstellung', 'created'],
      ['vertrieb/auftragsabwicklung', 'created'],
    ]);

    const models = (await (await t.asOwner('/api/v1/projects/sample/models')).json()) as ModelPage;
    // The engine comes from `modeler:executionPlatform` (M2).
    expect(models.items.map((m) => [m.key, m.engine])).toEqual([
      ['finance/payment-collection', 'c7'],
      ['finanzen/rechnungsstellung', 'c8'],
      ['vertrieb/auftragsabwicklung', 'c7'],
    ]);
    const order = models.items.find((m) => m.key === 'vertrieb/auftragsabwicklung');
    expect(order).toBeDefined();
    const facts = (await (
      await t.asOwner(
        `/api/v1/projects/sample/models/${order?.id}/revisions/${order?.headRevisionId}/facts`,
      )
    ).json()) as RevisionFacts;
    const refs = facts.facts.map((f) => f.ref);
    expect(refs).toContain('vertrieb/auftragsabwicklung#Call_ZahlungAbwickeln');
    expect(refs).toContain('vertrieb/auftragsabwicklung#Event_WareVersandbereit');
  });

  it('derives the rule-tier links of expected.yaml and nothing it forbids', async () => {
    const stored = await relations();
    // must_link pairs the rule tier can see (same id or name); the de-en
    // message is semantic and left to agents.
    expect(stored).toEqual(
      [
        'call vertrieb/auftragsabwicklung#Call_ZahlungAbwickeln finance/payment-collection#Process_PaymentCollection accepted rule',
        'message vertrieb/auftragsabwicklung#Event_WareVersandbereit finanzen/rechnungsstellung#Start_WareVersandbereit proposed key',
        'signal finanzen/rechnungsstellung#End_RechnungsstellungAbgeschlossen finance/payment-collection#Start_InvoicingCompleted proposed key',
        'signal finanzen/rechnungsstellung#End_RechnungsstellungAbgeschlossen vertrieb/auftragsabwicklung#Start_RechnungsstellungAbgeschlossen proposed key',
      ].sort(),
    );
    const { rules } = await libraryView(files);
    expect(
      rules.relations.map((r) => `${r.type} ${r.from} ${r.to} ${r.status} ${r.tier}`).sort(),
    ).toEqual(stored);
  });

  it('reports the findings of expected.yaml', async () => {
    const { items } = (await (
      await t.asOwner('/api/v1/projects/sample/findings')
    ).json()) as FindingList;
    const of = (kind: string) => items.filter((f) => f.kind === kind).flatMap((f) => f.refs);
    expect(of('dynamic-call')).toEqual(['finanzen/rechnungsstellung#Call_RechnungAusgeben']);
    expect(of('unresolved-call')).toEqual(['finanzen/rechnungsstellung#Call_Mahnwesen']);
    expect(of('duplicate-process-id')).toEqual([]);
    expect(of('dangling-throw')).toContain('finance/payment-collection#Task_SendReminder');
    expect(of('unmatched-catch')).toContain('finance/payment-collection#Event_PaymentReceived');
    const { rules } = await libraryView(files);
    expect(items).toEqual(rules.findings);
  });

  it('rejects hostile XML with 422 bpmn-invalid', async () => {
    const res = await t.putModel(
      'sample',
      'evil/xxe',
      '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>',
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'bpmn-invalid' });
  });

  it('names the encoding when it is why a file is no XML (UX7: the web names the remedy)', async () => {
    const utf16 = Uint8Array.from([
      0xff,
      0xfe,
      ...[...'<x/>'].flatMap((c) => [c.charCodeAt(0), 0]),
    ]);
    const latin1 = Uint8Array.from([
      ...new TextEncoder().encode('<x name="'),
      0xe4,
      0x22,
      0x2f,
      0x3e,
    ]);
    // well-formedness, not the encoding: an unclosed root
    const broken = new TextEncoder().encode(
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">',
    );
    const res = await t.asOwner('/api/v1/projects/sample/imports', {
      method: 'POST',
      body: importForm([
        { path: 'enc/utf16.bpmn', bytes: utf16 },
        { path: 'enc/latin1.bpmn', bytes: latin1 },
        { path: 'enc/broken.bpmn', bytes: broken },
      ]),
    });
    expect(res.status).toBe(200);
    const { files: outcomes } = (await res.json()) as ImportResult;
    expect(
      outcomes.map((o) => [o.path, o.outcome, o.problem?.['reason'], o.problem?.['encoding']]),
    ).toEqual([
      ['enc/utf16.bpmn', 'failed', 'not-xml', 'utf-16'],
      ['enc/latin1.bpmn', 'failed', 'not-xml', 'not-utf-8'],
      ['enc/broken.bpmn', 'failed', 'not-xml', undefined],
    ]);
    expect(outcomes[2]?.problem).not.toHaveProperty('encoding');
    expect(outcomes.map((o) => o.problem?.code)).toEqual([
      'bpmn-invalid',
      'bpmn-invalid',
      'bpmn-invalid',
    ]);
  });

  it('re-importing identical files changes nothing', async () => {
    const before = await relations();
    const res = await t.asOwner('/api/v1/projects/sample/imports', {
      method: 'POST',
      body: importForm(files),
    });
    const result = (await res.json()) as ImportResult;
    expect(result.files.every((f) => f.outcome === 'unchanged')).toBe(true);
    expect(await relations()).toEqual(before);
  });
});

describe('extractor warnings in import and PUT results (M6 S1)', () => {
  const bpmn = (tasks: readonly string[]) =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">',
      '  <bpmn:process id="Process_A" isExecutable="false">',
      ...tasks.map((id, i) => `    <bpmn:task id="${id}" name="Aufgabe ${i + 1}" />`),
      '  </bpmn:process>',
      '</bpmn:definitions>',
      '',
    ].join('\n');
  const clean = bpmn(['Task_A', 'Task_B']);
  // bpmn-moddle drops the second element itself, so the extractor never sees a `duplicate-id`.
  const duplicate = bpmn(['Task_A', 'Task_A']);
  // A 400-character id that is no NCName: bpmn-moddle's message quotes it (about 490 characters).
  const illegal = bpmn([`1${'a'.repeat(399)}`]);
  const file = (path: string, xml: string) => ({ path, bytes: new TextEncoder().encode(xml) });

  async function importOne(path: string, xml: string): Promise<ImportResult['files'][number]> {
    const res = await t.asOwner('/api/v1/projects/warnings/imports', {
      method: 'POST',
      body: importForm([file(path, xml)]),
    });
    expect(res.status).toBe(200);
    const { files: outcomes } = (await res.json()) as ImportResult;
    expect(outcomes).toHaveLength(1);
    return outcomes[0]!;
  }

  beforeAll(async () => {
    await t.createProject('warnings');
  });

  it('import: a warning-free file answers exactly as before, a duplicate id in a revision warns', async () => {
    const created = await importOne('w/dup.bpmn', clean);
    expect(created).toEqual({
      path: 'w/dup.bpmn',
      modelKey: 'w/dup',
      outcome: 'created',
      problem: null,
    });
    expect(Object.keys(created)).toEqual(['path', 'modelKey', 'outcome', 'problem']);

    const revised = await importOne('w/dup.bpmn', duplicate);
    expect(revised).toMatchObject({ modelKey: 'w/dup', outcome: 'revised', problem: null });
    expect(revised.warnings).toEqual([
      { code: 'parse-warning', message: expect.stringMatching(/duplicate ID <Task_A>/) as unknown },
    ]);
    expect(revised.warningCount).toBe(1);

    // Identical bytes are not extracted: no warnings on `unchanged`.
    const unchanged = await importOne('w/dup.bpmn', duplicate);
    expect(unchanged).toEqual({
      path: 'w/dup.bpmn',
      modelKey: 'w/dup',
      outcome: 'unchanged',
      problem: null,
    });
  });

  it('import: a long bpmn-moddle message is cut to 300 characters ending in …', async () => {
    const created = await importOne('w/illegal.bpmn', illegal);
    expect(created).toMatchObject({ outcome: 'created', warningCount: 1 });
    const [warning] = created.warnings ?? [];
    expect(warning?.code).toBe('parse-warning');
    expect(warning?.message).toHaveLength(300);
    expect(warning?.message).toMatch(/^unparsable content <bpmn:task> .*illegal ID <1a+…$/);
  });

  it('PUT answers the same; a warning-free PUT has no warnings key', async () => {
    const created = await t.putModel('warnings', 'p/dup', clean);
    expect(created.status).toBe(201);
    expect(Object.keys((await created.json()) as object)).toEqual(['outcome', 'model', 'revision']);

    const revised = await t.putModel('warnings', 'p/dup', duplicate);
    expect(revised.status).toBe(200);
    const body = (await revised.json()) as PutModelResult;
    expect(body.outcome).toBe('revised');
    expect(body.warnings).toEqual([
      { code: 'parse-warning', message: expect.stringMatching(/duplicate ID <Task_A>/) as unknown },
    ]);
    expect(body.warningCount).toBe(1);

    const long = await t.putModel('warnings', 'p/illegal', illegal);
    expect(long.status).toBe(201);
    const cut = (await long.json()) as PutModelResult;
    expect(cut.warningCount).toBe(1);
    expect(cut.warnings?.[0]?.message).toHaveLength(300);
    expect(cut.warnings?.[0]?.message.endsWith('…')).toBe(true);

    const unchanged = (await (await t.putModel('warnings', 'p/dup', duplicate)).json()) as object;
    expect(Object.keys(unchanged)).toEqual(['outcome', 'model', 'revision']);
  });
});
