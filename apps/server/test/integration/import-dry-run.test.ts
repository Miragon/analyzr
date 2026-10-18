/**
 * The dry runs of an import (M6 §3.5, slice S2b) with the real libraries and
 * a real PostgreSQL: `POST …/imports?dryRun=true` answers the outcomes the
 * import gives and an impact that names what it then does (rule-tier calls
 * accepted, rule proposals added, findings added; on a changed call target
 * the stance withdrawn; nothing again for an unchanged re-import), and
 * writes nothing (no event, no model); a read-only token may run it, not
 * the import. `PUT …?dryRun=true` answers the would-be outcome. The
 * deletion impact names the accepted calls a deletion turns `missing` and
 * the rule stances it withdraws, and deletes nothing. The absent keys of a
 * bundle respect its `source.scope`.
 */
import type {
  FindingList,
  ImportImpact,
  ImportResult,
  ModelPage,
  Project,
  PutModelDryRunResult,
  Relation,
  RelationPage,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importForm, type CorpusFile } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';

let database: TestDatabase;
let t: TestApp;
let files: CorpusFile[];
const P = 'preview';

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject(P);
  await t.createProject('scope');
  files = await corpusFiles('nordwind-handel');
});

afterAll(async () => {
  await database.drop();
});

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await t.asOwner(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

const lastSeq = async (p: string) => (await json<Project>(`/api/v1/projects/${p}`)).lastSeq;
const relations = async (p: string): Promise<Relation[]> =>
  (await json<RelationPage>(`/api/v1/projects/${p}/relations?limit=200`)).items;
const line = (r: { type: string; from: string; to: string }) => `${r.type} ${r.from} ${r.to}`;

function importFiles(p: string, batch: readonly CorpusFile[], dryRun: boolean, manifest?: unknown) {
  const form = importForm(batch);
  if (manifest !== undefined) form.append('manifest', JSON.stringify(manifest));
  return json<ImportResult>(`/api/v1/projects/${p}/imports${dryRun ? '?dryRun=true' : ''}`, {
    method: 'POST',
    body: form,
  });
}

const empty = (impact: ImportImpact) =>
  [
    impact.acceptedCalls,
    impact.proposalsAdded,
    impact.proposalsWithdrawn,
    impact.endpointsChanged,
    impact.findingsAdded,
    impact.findingsResolved,
  ].every((l) => l.count === 0);

describe('POST …/imports?dryRun=true', () => {
  it('answers the outcomes and what the import then does, and writes nothing', async () => {
    const seq = await lastSeq(P);
    const preview = await importFiles(P, files, true);
    expect(await lastSeq(P)).toBe(seq);
    expect((await json<ModelPage>(`/api/v1/projects/${P}/models`)).items).toEqual([]);
    if (!preview.impact) throw new Error('no impact on a dry run');
    expect(preview.impact.files.map((f) => f.modelKey).sort()).toEqual(
      files.map((f) => f.key).sort(),
    );
    expect(preview.impact.files.every((f) => f.factsChanged)).toBe(true);

    const real = await importFiles(P, files, false);
    expect(real.impact).toBeUndefined();
    // the same outcome per file, warnings included
    expect(preview.files).toEqual(real.files);
    // what the import did is what the impact said
    const after = await relations(P);
    expect(preview.impact.acceptedCalls.items.map(line).sort()).toEqual(
      after
        .filter((r) => r.status === 'accepted')
        .map(line)
        .sort(),
    );
    expect(preview.impact.proposalsAdded.items.map(line).sort()).toEqual(
      after
        .filter((r) => r.status === 'proposed')
        .map(line)
        .sort(),
    );
    const { items: findings } = await json<FindingList>(`/api/v1/projects/${P}/findings`);
    expect(preview.impact.findingsAdded.count).toBe(findings.length);
    expect(preview.impact.findingsResolved.count).toBe(0);
  });

  it('answers nothing to do for the same files again', async () => {
    const preview = await importFiles(P, files, true);
    expect(preview.files.every((f) => f.outcome === 'unchanged')).toBe(true);
    if (!preview.impact) throw new Error('no impact');
    expect(preview.impact.files).toEqual([]);
    expect(empty(preview.impact)).toBe(true);
  });

  it('names a changed call target: the rule stance withdrawn, the finding added', async () => {
    const caller = files.find((f) => f.key === 'finanzen/forderungsmanagement');
    if (!caller) throw new Error('finanzen/forderungsmanagement missing');
    const changed = {
      ...caller,
      bytes: new TextEncoder().encode(
        new TextDecoder()
          .decode(caller.bytes)
          .replace(/calledElement="[^"]+"/, 'calledElement="Process_Gibt_Es_Nicht"'),
      ),
    };
    const before = await relations(P);
    const preview = await importFiles(P, [changed], true);
    if (!preview.impact) throw new Error('no impact');
    expect(preview.files.map((f) => f.outcome)).toEqual(['revised']);
    expect(preview.impact.files).toEqual([
      expect.objectContaining({ modelKey: caller.key, factsChanged: true }),
    ]);
    expect(preview.impact.proposalsWithdrawn.count).toBeGreaterThan(0);
    expect(preview.impact.findingsAdded.items.map((f) => f.kind)).toContain('unresolved-call');

    await importFiles(P, [changed], false);
    const after = await relations(P);
    const gone = before.filter(
      (r) =>
        r.status !== 'obsolete' &&
        !after.some((a) => line(a) === line(r) && a.status !== 'obsolete'),
    );
    // every relation that left the review was named as withdrawn
    for (const r of gone)
      expect(preview.impact.proposalsWithdrawn.items.map(line)).toContain(line(r));
  });

  it('lets a read-only token preview, not import', async () => {
    const token = await t.createToken(P, ['analyzr:read']);
    const form = () => importForm(files.slice(0, 2));
    const dry = await t.asToken(token.secret, `/api/v1/projects/${P}/imports?dryRun=true`, {
      method: 'POST',
      body: form(),
    });
    expect(dry.status, await dry.clone().text()).toBe(200);
    const write = await t.asToken(token.secret, `/api/v1/projects/${P}/imports`, {
      method: 'POST',
      body: form(),
    });
    expect(write.status).toBe(403);
  });
});

describe('PUT …?dryRun=true and the deletion impact', () => {
  it('answers the would-be outcome of a PUT with 200, creating nothing', async () => {
    const file = files[0]!;
    const res = await t.asOwner(`/api/v1/projects/scope/models/by-key/neu%2Fmodell?dryRun=true`, {
      method: 'PUT',
      headers: { 'content-type': 'application/xml' },
      body: file.bytes,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PutModelDryRunResult;
    expect(body).toMatchObject({ outcome: 'created', modelKey: 'neu/modell', dryRun: true });
    expect(body.impact.files.map((f) => f.modelKey)).toEqual(['neu/modell']);
    expect((await json<ModelPage>('/api/v1/projects/scope/models')).items).toEqual([]);
  });

  it('names the accepted calls a deletion turns missing, and deletes nothing', async () => {
    const shipping = (await json<ModelPage>(`/api/v1/projects/${P}/models?limit=200`)).items.find(
      (m) => m.key === 'logistik/shipping',
    );
    if (!shipping) throw new Error('logistik/shipping missing');
    const seq = await lastSeq(P);
    const impact = await json<ImportImpact>(
      `/api/v1/projects/${P}/models/${shipping.id}/deletion-impact`,
    );
    expect(await lastSeq(P)).toBe(seq);
    const before = await relations(P);
    const touching = before.filter(
      (r) => r.from.startsWith('logistik/shipping#') || r.to.startsWith('logistik/shipping#'),
    );
    expect(impact.endpointsChanged.items.map((r) => [line(r), r.endpointState]).sort()).toEqual(
      touching
        .filter((r) => r.status === 'accepted')
        .map((r) => [line(r), 'missing'])
        .sort(),
    );
    expect(impact.proposalsWithdrawn.count).toBe(
      touching.filter((r) => r.status === 'proposed').length,
    );
    expect(impact.files).toEqual([]);
    expect(impact.absentKeys.count).toBe(0);

    // the deletion does what the impact said
    expect(
      (await t.asOwner(`/api/v1/projects/${P}/models/${shipping.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    const after = await relations(P);
    for (const r of impact.endpointsChanged.items) {
      expect(after.find((a) => line(a) === line(r))?.endpointState).toBe('missing');
    }
  });
});

describe('absent keys of a bundle', () => {
  const bpmn = (id: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.org/bpmn" id="D_${id}">
  <bpmn:process id="Process_${id}" name="${id}" isExecutable="false">
    <bpmn:startEvent id="S_${id}"/>
  </bpmn:process>
</bpmn:definitions>
`;
  const file = (path: string) => ({
    path,
    key: path.replace(/\.bpmn$/, ''),
    bytes: new TextEncoder().encode(bpmn(path.replace(/\W/g, '_'))),
  });

  it('lists the live keys of the system the bundle does not name, within its scope', async () => {
    const first = [file('finanzen/a.bpmn'), file('finanzen/b.bpmn'), file('lager/c.bpmn')];
    await importFiles('scope', first, false, {
      format: 'analyzr-import/1',
      source: { system: 'signavio' },
      files: [
        { path: 'finanzen/a.bpmn', externalPath: 'Finanzen/A' },
        { path: 'finanzen/b.bpmn', externalPath: 'Finanzen/B' },
        { path: 'lager/c.bpmn', externalPath: 'Lager/C' },
      ],
    });
    // a partial export of „Finanzen“ naming only a: b is absent, c lies outside the scope
    const preview = await importFiles('scope', [file('finanzen/a.bpmn')], true, {
      format: 'analyzr-import/1',
      source: { system: 'signavio', scope: ['Finanzen'] },
      files: [{ path: 'finanzen/a.bpmn', externalPath: 'Finanzen/A' }],
    });
    expect(preview.impact?.absentKeys).toEqual({ count: 1, items: ['finanzen/b'] });
    // without a scope, the whole system
    const whole = await importFiles('scope', [file('finanzen/a.bpmn')], true, {
      format: 'analyzr-import/1',
      source: { system: 'signavio' },
      files: [{ path: 'finanzen/a.bpmn', externalPath: 'Finanzen/A' }],
    });
    expect(whole.impact?.absentKeys.items).toEqual(['finanzen/b', 'lager/c']);
    // without a manifest no system to compare: none
    const plain = await importFiles('scope', [file('finanzen/a.bpmn')], true);
    expect(plain.impact?.absentKeys.count).toBe(0);
  });
});
