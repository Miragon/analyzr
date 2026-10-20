/**
 * Typed provenance, the manifest and stable identity end to end (M6 §3.2–§3.4,
 * §4.3, slice S2a) with the real libraries and a real PostgreSQL. Requires
 * (§8 "S2"):
 * - the integrate plugin's golden bundle (`tools/integrate/test/fixtures/
 *   signavio/bundle`) imports with its manifest as the part `manifest`: every
 *   uploaded revision carries the declared provenance plus `uploader` and
 *   `manifestSha256`, and the key map rebuilt from `GET …/external-ids`
 *   equals the one the bundle was written with (its manifest's key, tool id
 *   and tool folder per file);
 * - provenance round trips through PUT (`Analyzr-Manifest`) and import; a
 *   manifest's pinned key wins over the path; a checksum mismatch is the
 *   warning `manifest-sha-mismatch` and the file is imported;
 *   `external-id-moved` and `external-id-changed` appear in their cases and
 *   not for an as-told draft without a tool id; an invalid manifest refuses
 *   the request;
 * - identical bytes stay `unchanged` and keep their first revision's
 *   provenance, while the folder they declare is recorded (below); an upload
 *   without a manifest keeps a declared identity (`external-ids` and the
 *   warnings read the newest identity row);
 * - an export's empty or odd informational fields are stored tidied, the
 *   scope round trips, and values jsonb cannot hold (a NUL, a lone
 *   surrogate) or credentials in a link refuse the manifest (422), not 500;
 * - an amended head follows `source.upstream`: the provenance stays on the
 *   uploaded revision, `external-ids`, the identity warnings and the change
 *   list read it there, and a re-import puts the new provenance on the new
 *   uploaded revision;
 * - `extract_warnings` is written at insert (`[]` without warnings) and
 *   `extractor-loss` asks about the lost elements of synthetic fixtures;
 *   migration 0017 leaves older revisions null;
 * - the identity rows (M6 S2b follow-up step 5, owner decision 29 (1)): an
 *   unchanged file whose manifest entry declares another tool id, folder or
 *   link records it (one `model.identity_declared` event and one row, no
 *   revision, no task, `facts_hash` and the trust class kept), and
 *   `external-ids`, `Model.identity`, the absent keys, the identity warnings
 *   and the change list read the newest row; the same declaration again is
 *   quiet; a bundle imported over bytes first uploaded without one gives the
 *   models their identity; `provenance-kept` speaks of the derivation only,
 *   also beside a `trust-kept` for another credential, and goes as a
 *   file's fifth warning; the dry run answers what the import does and
 *   writes nothing; deletion and revival, PUT, amended heads and agent
 *   tokens; the table is append-only and its guard refuses rows that do not
 *   match their revision, their event or the model's kept revision.
 */
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ExternalIdList,
  ImportResult,
  OpenQuestionPage,
  PutModelDryRunResult,
  PutModelResult,
  type ImportManifest,
  type Model,
  type OpenQuestion,
  type Project,
  type ProjectId,
  type Revision,
  type RevisionPage,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { createDatabase } from '../../src/db/client.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../src/db/migrate.ts';
import { createStore } from '../../src/db/store.ts';
import { LAGER_KEY, lager } from '../support/amend-fixtures.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { NO_ENGINE } from '../support/trust.ts';

const BUNDLE = fileURLToPath(
  new URL('../../../../tools/integrate/test/fixtures/signavio/bundle/', import.meta.url),
);

let database: TestDatabase;
let t: TestApp;
const projects = new Map<string, Project>();

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  for (const p of [
    'bundle',
    'ident',
    'put',
    'amended',
    'loss',
    'later',
    'unid',
    'revived',
    'agent',
    'credential',
  ]) {
    projects.set(p, await t.createProject(p));
  }
});

afterAll(async () => {
  await database.drop();
});

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const DEFS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.org/bpmn"';

/** A small descriptive model; `task` changes its bytes and facts. */
function bpmn(id: string, task = 'Prüfen', body = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} id="Defs_${id}">
  <bpmn:process id="Process_${id}" name="${id}" isExecutable="false">
    <bpmn:documentation>Prozess ${id}.</bpmn:documentation>
    <bpmn:startEvent id="Start_${id}" name="Los"/>
    <bpmn:task id="Task_${id}" name="${task}"/>${body}
    <bpmn:endEvent id="End_${id}" name="Fertig"/>
  </bpmn:process>
</bpmn:definitions>
`;
}

function manifestOf(
  files: ImportManifest['files'],
  source: Partial<ImportManifest['source']> = {},
): ImportManifest {
  return { format: 'analyzr-import/1', source: { system: 'signavio', ...source }, files };
}

async function importFiles(
  project: string,
  files: { path: string; bytes: Uint8Array | string }[],
  manifest?: ImportManifest | string,
): Promise<Response> {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.bytes]), f.path);
  if (manifest !== undefined) {
    form.append('manifest', typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  }
  return t.asOwner(`/api/v1/projects/${project}/imports`, { method: 'POST', body: form });
}

async function imported(
  project: string,
  files: { path: string; bytes: Uint8Array | string }[],
  manifest?: ImportManifest | string,
): Promise<ImportResult['files']> {
  const res = await importFiles(project, files, manifest);
  const text = await res.text();
  expect(res.status, text.slice(0, 800)).toBe(200);
  return ImportResult.parse(JSON.parse(text)).files;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await t.asOwner(path);
  const text = await res.text();
  expect(res.status, `${path}: ${text.slice(0, 600)}`).toBe(200);
  return JSON.parse(text) as T;
}

async function modelId(project: string, key: string): Promise<string> {
  const page = await getJson<{ items: { id: string; key: string }[] }>(
    `/api/v1/projects/${project}/models?limit=200`,
  );
  const m = page.items.find((i) => i.key === key);
  if (!m) throw new Error(`no model ${key} in ${project}`);
  return m.id;
}

async function revisions(project: string, key: string): Promise<Revision[]> {
  const id = await modelId(project, key);
  return (await getJson<RevisionPage>(`/api/v1/projects/${project}/models/${id}/revisions`)).items;
}

async function externalIds(project: string, system?: string): Promise<ExternalIdList> {
  const q = system === undefined ? '' : `?system=${system}`;
  return ExternalIdList.parse(await getJson(`/api/v1/projects/${project}/external-ids${q}`));
}

/** `PUT …/models/by-key/{key}` with an optional `Analyzr-Manifest` header (base64url JSON). */
function put(project: string, key: string, xml: string, manifest?: unknown, raw?: string) {
  const header =
    raw ??
    (manifest === undefined
      ? undefined
      : Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64url'));
  return t.asOwner(`/api/v1/projects/${project}/models/by-key/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/xml',
      ...(header === undefined ? {} : { 'analyzr-manifest': header }),
    },
    body: xml,
  });
}

function projectIdOf(project: string): ProjectId {
  const p = projects.get(project);
  if (!p) throw new Error(`no project ${project}`);
  return p.id;
}

async function lastSeq(project: string): Promise<number> {
  return (await getJson<Project>(`/api/v1/projects/${project}`)).lastSeq;
}

/** The events of a project after `seq`, in order. */
async function eventsAfter(project: string, seq: number) {
  return createStore(database.db).read((tx) =>
    tx.events.list(projectIdOf(project), { afterSeq: seq, limit: 10_000 }),
  );
}

/** The identity rows of a project (M6 S2b follow-up step 5), by key and seq. */
async function identityRows(project: string) {
  const rows = await database.db.execute<{
    key: string;
    seq: string;
    kind: string;
    revision_id: string;
    system: string;
    external_id: string | null;
    external_path: string | null;
    url: string | null;
    principal_id: string;
    client_id: string | null;
  }>(sql`
    select m.key, i.seq, i.kind, i.revision_id, i.system, i.external_id, i.external_path, i.url,
      i.principal_id, i.client_id
    from model_identity i join model m on m.project_id = i.project_id and m.id = i.model_id
    join project p on p.id = i.project_id
    where p.key = ${project} order by m.key, i.seq`);
  return rows.rows.map((r) => ({ ...r, seq: Number(r.seq) }));
}

/** `POST …/imports?dryRun=true`: the would-be outcomes and the impact; writes nothing. */
async function dryRun(
  project: string,
  files: { path: string; bytes: Uint8Array | string }[],
  manifest?: ImportManifest | string,
): Promise<ImportResult> {
  const seq = await lastSeq(project);
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.bytes]), f.path);
  if (manifest !== undefined) {
    form.append('manifest', typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  }
  const res = await t.asOwner(`/api/v1/projects/${project}/imports?dryRun=true`, {
    method: 'POST',
    body: form,
  });
  const text = await res.text();
  expect(res.status, text.slice(0, 800)).toBe(200);
  expect(await lastSeq(project)).toBe(seq);
  return ImportResult.parse(JSON.parse(text));
}

async function getModel(project: string, key: string): Promise<Model> {
  return getJson<Model>(`/api/v1/projects/${project}/models/${await modelId(project, key)}`);
}

async function storedWarnings(project: string): Promise<{ key: string; warnings: unknown }[]> {
  const rows = await database.db.execute<{ key: string; warnings: unknown }>(sql`
    select m.key, r.extract_warnings as warnings
    from model_revision r join model m on m.project_id = r.project_id and m.id = r.model_id
    join project p on p.id = r.project_id
    where p.key = ${project} order by m.key, r.rev`);
  return rows.rows;
}

/** The golden bundle: its manifest, the compact JSON the CLI sends, and its files by path. */
async function readBundle(): Promise<{
  manifest: ImportManifest;
  sent: string;
  files: { path: string; bytes: Uint8Array }[];
}> {
  const manifest = JSON.parse(
    await readFile(join(BUNDLE, 'analyzr-import.json'), 'utf8'),
  ) as ImportManifest;
  const entries = (await readdir(BUNDLE, { recursive: true }))
    .map((e) => e.split('\\').join('/'))
    .filter((e) => e.endsWith('.bpmn'))
    .sort();
  const files = await Promise.all(
    entries.map(async (p) => ({ path: p, bytes: new Uint8Array(await readFile(join(BUNDLE, p))) })),
  );
  return { manifest, sent: JSON.stringify(manifest), files };
}

/** The Postgres error of a failed statement (Drizzle wraps it in `cause`): constraint or message. */
async function failure(statement: string): Promise<string> {
  try {
    await database.db.execute(sql.raw(statement));
  } catch (err) {
    const cause = (err as { cause?: { message?: string; constraint?: string } }).cause;
    return cause?.constraint ?? cause?.message ?? String(err);
  }
  throw new Error(`statement succeeded: ${statement}`);
}

// --------------------------------------------------------------- the bundle

describe('the integrate plugin’s golden bundle with its manifest', () => {
  let manifest: ImportManifest;
  let sent: string;
  let files: { path: string; bytes: Uint8Array }[];

  beforeAll(async () => {
    ({ manifest, sent, files } = await readBundle());
  });

  it('imports every file under its pinned key without a warning', async () => {
    // As the CLI sends it: compact JSON (a text part's line breaks would become CRLF).
    const result = await imported('bundle', files, sent);
    expect(result.map((f) => [f.modelKey, f.outcome])).toEqual(
      manifest.files.map((f) => [f.key, 'created']),
    );
    // Normalized by normalize-bpmn and matching their checksums: no warning of either kind.
    expect(result.filter((f) => f.warnings || f.importWarnings)).toEqual([]);
  });

  it('stores the declared provenance on each uploaded revision, with uploader and manifestSha256', async () => {
    for (const entry of manifest.files) {
      const [rev] = await revisions('bundle', entry.key ?? '');
      expect(rev?.source, entry.path).toEqual({
        kind: 'import',
        path: entry.path,
        uploader: 'human',
        manifestSha256: sha(sent),
        system: 'signavio',
        systemVersion: '19.6.0',
        exportedAt: '2026-10-14T00:00:00Z',
        importer: { name: 'analyzr-integrate/normalize-bpmn', version: '0.1.0' },
        externalId: entry.externalId,
        externalPath: entry.externalPath,
        derived: entry.derived,
        ...(entry.losses ? { losses: entry.losses } : {}),
        // The trust rule (M6 S2c): a Signavio export names no Camunda engine.
        trust: {
          class: 'derived',
          reasons: ['no-engine', ...(entry.derived?.kind === 'converted' ? ['converted'] : [])],
        },
      });
    }
  });

  it('sums the provenance up on each model: system, derivation, export date (UX8)', async () => {
    const page = await getJson<{ items: { key: string; source: unknown }[] }>(
      '/api/v1/projects/bundle/models?limit=200',
    );
    const byKey = new Map(page.items.map((m) => [m.key, m.source]));
    for (const entry of manifest.files) {
      expect(byKey.get(entry.key ?? ''), entry.path).toEqual({
        system: 'signavio',
        derived: entry.derived?.kind ?? null,
        exportedAt: '2026-10-14T00:00:00Z',
      });
    }
    // the bundle converts some files: the badge has something to say
    expect(manifest.files.some((f) => f.derived && f.derived.kind !== 'export')).toBe(true);
  });

  it('rebuilds the key map the bundle was written with from GET …/external-ids', async () => {
    // The bundle's manifest is written from the confirmed keymap.json: per file its key, tool
    // id and tool folder (tools/integrate src/bundle.ts writeBundle).
    const keymapEntries = manifest.files
      .map((f) => ({ key: f.key, externalId: f.externalId ?? null, externalPath: f.externalPath }))
      .sort((a, b) => ((a.key ?? '') < (b.key ?? '') ? -1 : 1));
    const rebuilt = (await externalIds('bundle', 'signavio')).items.map(
      ({ key, externalId, externalPath }) => ({ key, externalId, externalPath }),
    );
    expect(rebuilt).toEqual(keymapEntries);
    expect((await externalIds('bundle')).items.every((i) => i.system === 'signavio')).toBe(true);
    expect((await externalIds('bundle', 'aris')).items).toEqual([]);
    expect((await t.asOwner('/api/v1/projects/bundle/external-ids?system=ARIS')).status).toBe(422);
  });

  it('stores the (absent) extractor warnings of every revision as []', async () => {
    expect((await storedWarnings('bundle')).map((r) => r.warnings)).toEqual(
      manifest.files.map(() => []),
    );
  });

  it('keeps the revision’s provenance for identical bytes and records the moved folder (decision 29 (1))', async () => {
    // Moving a model to another folder leaves a Signavio export's bytes as they were.
    const moved = (f: ImportManifest['files'][number]) => `Verschoben/${f.externalPath ?? ''}`;
    const movedFiles = manifest.files.map((f) => ({ ...f, externalPath: moved(f) }));
    const later = JSON.stringify(
      manifestOf(movedFiles, { systemVersion: '20.0.0', exportedAt: '2026-11-01T00:00:00Z' }),
    );
    const versandBefore = await getModel('bundle', 'logistik/versand');
    const revisionsBefore = await revisions('bundle', 'logistik/versand');
    // A scoped partial export of the moved area: nothing is absent before the import …
    const scoped = manifestOf(
      manifest.files.filter((f) => f.key === 'finanzen/rechnungsstellung'),
      { scope: ['Verschoben/Gemeinsame Dokumente/Logistik'] },
    );
    const rechnung = files.filter((f) => f.path === 'finanzen/rechnungsstellung.bpmn');
    expect((await dryRun('bundle', rechnung, scoped)).impact?.absentKeys).toEqual({
      count: 0,
      items: [],
    });
    // The dry run answers what the import then does, and writes nothing.
    const preview = await dryRun('bundle', files, later);
    const before = await lastSeq('bundle');
    const result = await imported('bundle', files, later);
    expect(preview.files).toEqual(result);
    expect(result.every((f) => f.outcome === 'unchanged' && f.identityUpdated === true)).toBe(true);
    // No hint: the folders are recorded; the derivations are the revisions' own.
    expect(result.filter((f) => f.importWarnings)).toEqual([]);
    // One event per file, no revision, no task, nothing else.
    const written = await eventsAfter('bundle', before);
    expect(written.map((e) => e.type)).toEqual(manifest.files.map(() => 'model.identity_declared'));
    expect(await lastSeq('bundle')).toBe(before + manifest.files.length);
    const versandEvent = written.find((e) => e.subjectRef === 'logistik/versand');
    expect(versandEvent?.payload).toEqual({
      modelId: versandBefore.id,
      modelKey: 'logistik/versand',
      revisionId: versandBefore.headRevisionId,
      system: 'signavio',
      externalId: 'sid-5F0E4D3C-2B1A-4F9E-8D7C-6B5A4F3E2D78',
      manifestSha256: sha(later),
    });
    // The revision keeps its first provenance, facts and trust class.
    expect(await revisions('bundle', 'logistik/versand')).toEqual(revisionsBefore);
    expect(revisionsBefore[0]?.source).toMatchObject({
      systemVersion: '19.6.0',
      externalPath: 'Gemeinsame Dokumente/Logistik/Versand',
    });
    const versand = await getModel('bundle', 'logistik/versand');
    expect(versand).toEqual({
      ...versandBefore,
      identity: {
        system: 'signavio',
        externalId: 'sid-5F0E4D3C-2B1A-4F9E-8D7C-6B5A4F3E2D78',
        externalPath: 'Verschoben/Gemeinsame Dokumente/Logistik/Versand',
        url: null,
      },
    });
    expect(versandBefore.identity?.externalPath).toBe('Gemeinsame Dokumente/Logistik/Versand');
    expect((await externalIds('bundle')).items.map((i) => i.externalPath)).toEqual(
      manifest.files.map(moved),
    );
    // … and the moved model is absent from the scoped partial export afterwards.
    expect((await dryRun('bundle', rechnung, scoped)).impact?.absentKeys).toEqual({
      count: 1,
      items: ['logistik/versand'],
    });
    const rows = await identityRows('bundle');
    expect(rows.filter((r) => r.key === 'logistik/versand')).toEqual([
      expect.objectContaining({
        kind: 'revision',
        revision_id: versandBefore.headRevisionId,
        external_path: 'Gemeinsame Dokumente/Logistik/Versand',
        client_id: 'analyzr-web',
      }),
      expect.objectContaining({
        kind: 'unchanged',
        seq: versandEvent?.seq,
        revision_id: versandBefore.headRevisionId,
        external_path: 'Verschoben/Gemeinsame Dokumente/Logistik/Versand',
        url: null,
      }),
    ]);
    // The same declaration again (only the export date and version differ): quiet.
    const seq = await lastSeq('bundle');
    const same = await imported(
      'bundle',
      files,
      manifestOf(movedFiles, { systemVersion: '20.0.1', exportedAt: '2026-11-02T00:00:00Z' }),
    );
    expect(
      same.every((f) => f.outcome === 'unchanged' && !f.importWarnings && !f.identityUpdated),
    ).toBe(true);
    expect(await lastSeq('bundle')).toBe(seq);
    // The original manifest: the old folders back, six more rows.
    const back = await imported('bundle', files, sent);
    expect(back.every((f) => f.identityUpdated === true && !f.importWarnings)).toBe(true);
    expect((await externalIds('bundle')).items.map((i) => i.externalPath)).toEqual(
      manifest.files.map((f) => f.externalPath),
    );
    expect((await identityRows('bundle')).map((r) => r.kind)).toEqual(
      manifest.files.flatMap(() => ['revision', 'unchanged', 'unchanged']),
    );
    expect(await revisions('bundle', 'logistik/versand')).toEqual(revisionsBefore);
  });
});

// --------------------------------------------------------------- identity

describe('pinned keys, checksums and the identity warnings', () => {
  it('lets a pinned key win over the path, and a file the manifest does not list keep its path key', async () => {
    const result = await imported(
      'ident',
      [
        { path: 'Gemeinsame Dokumente/Vertrieb/Auftrag (neu).bpmn', bytes: bpmn('Auftrag') },
        { path: 'Ohne Eintrag.bpmn', bytes: bpmn('Ohne') },
      ],
      manifestOf([
        {
          path: 'Gemeinsame Dokumente/Vertrieb/Auftrag (neu).bpmn',
          key: 'vertrieb/auftrag',
          externalId: 'sid-1',
          externalPath: 'Vertrieb/Auftrag',
        },
      ]),
    );
    expect(result.map((f) => [f.path, f.modelKey, f.outcome])).toEqual([
      ['Gemeinsame Dokumente/Vertrieb/Auftrag (neu).bpmn', 'vertrieb/auftrag', 'created'],
      ['Ohne Eintrag.bpmn', 'ohne-eintrag', 'created'],
    ]);
    const [unlisted] = await revisions('ident', 'ohne-eintrag');
    expect(unlisted?.source).toEqual({
      kind: 'import',
      path: 'Ohne Eintrag.bpmn',
      uploader: 'human',
      trust: NO_ENGINE,
    });
  });

  it('warns about a checksum mismatch and imports the file', async () => {
    const xml = bpmn('Rechnung');
    const [file] = await imported(
      'ident',
      [{ path: 'finanzen/rechnung.bpmn', bytes: xml }],
      manifestOf([{ path: 'finanzen/rechnung.bpmn', externalId: 'sid-2', sha256: '0'.repeat(64) }]),
    );
    expect(file).toMatchObject({ modelKey: 'finanzen/rechnung', outcome: 'created' });
    expect(file?.importWarnings).toEqual([
      expect.objectContaining({
        code: 'manifest-sha-mismatch',
        manifestSha256: '0'.repeat(64),
        fileSha256: sha(xml),
      }),
    ]);
    // A matching checksum is quiet.
    const [again] = await imported(
      'ident',
      [{ path: 'finanzen/rechnung.bpmn', bytes: bpmn('Rechnung', 'Neu') }],
      manifestOf([
        {
          path: 'finanzen/rechnung.bpmn',
          externalId: 'sid-2',
          sha256: sha(bpmn('Rechnung', 'Neu')),
        },
      ]),
    );
    expect(again).toMatchObject({ outcome: 'revised' });
    expect(again?.importWarnings).toBeUndefined();
  });

  it('warns when a tool id already belongs to another live key (external-id-moved)', async () => {
    const [moved] = await imported(
      'ident',
      [{ path: 'vertrieb/auftragsabwicklung.bpmn', bytes: bpmn('Auftrag', 'Umbenannt') }],
      manifestOf([{ path: 'vertrieb/auftragsabwicklung.bpmn', externalId: 'sid-1' }]),
    );
    expect(moved).toMatchObject({ modelKey: 'vertrieb/auftragsabwicklung', outcome: 'created' });
    expect(moved?.importWarnings).toEqual([
      {
        code: 'external-id-moved',
        message:
          'signavio id sid-1 already belongs to vertrieb/auftrag: two models now carry it (moved or renamed in the tool?)',
        system: 'signavio',
        externalId: 'sid-1',
        otherKeys: ['vertrieb/auftrag'],
      },
    ]);
  });

  it("warns when the key's head carries another tool id (external-id-changed), and imports", async () => {
    const [changed] = await imported(
      'ident',
      [{ path: 'finanzen/rechnung.bpmn', bytes: bpmn('Rechnung', 'Aus ARIS') }],
      manifestOf([{ path: 'finanzen/rechnung.bpmn', externalId: 'A-77' }], { system: 'aris' }),
    );
    expect(changed).toMatchObject({ outcome: 'revised' });
    expect(changed?.importWarnings).toEqual([
      expect.objectContaining({
        code: 'external-id-changed',
        system: 'aris',
        externalId: 'A-77',
        previous: { system: 'signavio', externalId: 'sid-2' },
      }),
    ]);
    expect((await externalIds('ident', 'aris')).items).toEqual([
      { key: 'finanzen/rechnung', system: 'aris', externalId: 'A-77', externalPath: null },
    ]);
  });

  it('stays silent when the real model replaces an as-told draft without a tool id', async () => {
    const [draft] = await imported(
      'ident',
      [{ path: 'einkauf/bestellung.bpmn', bytes: bpmn('Bestellung', 'Erzählt') }],
      manifestOf(
        [{ path: 'einkauf/bestellung.bpmn', derived: { kind: 'as-told', from: ['src-1'] } }],
        { system: 'interview' },
      ),
    );
    expect(draft?.importWarnings).toBeUndefined();
    const [real] = await imported(
      'ident',
      [{ path: 'einkauf/bestellung.bpmn', bytes: bpmn('Bestellung', 'Modelliert') }],
      manifestOf([{ path: 'einkauf/bestellung.bpmn', externalId: 'sid-9' }]),
    );
    expect(real).toMatchObject({ outcome: 'revised' });
    expect(real?.importWarnings).toBeUndefined();
  });

  it('keeps a declared identity when an upload without a manifest revises the model', async () => {
    await imported(
      'ident',
      [{ path: 'lager/kommission.bpmn', bytes: bpmn('Kommission') }],
      manifestOf([
        { path: 'lager/kommission.bpmn', externalId: 'sid-K', externalPath: 'Lager/Kommission' },
      ]),
    );
    const rows = (await identityRows('ident')).length;
    // „Hochladen“ in the web sends no manifest (M6 S2a): new bytes, no declared provenance.
    const res = await put('ident', 'lager/kommission', bpmn('Kommission', 'Neu im Web'));
    expect(res.status).toBe(200);
    const revised = PutModelResult.parse(await res.json());
    expect(revised.revision.source).toEqual({
      kind: 'upload',
      uploader: 'human',
      trust: NO_ENGINE,
    });
    // the head declares nothing: no summary on the model, though `external-ids` keeps the identity
    expect(revised.model.source).toBeNull();
    // … and so does the model's newest identity row: the PUT wrote none (M6 S2b follow-up step 5).
    expect(revised.model.identity).toEqual({
      system: 'signavio',
      externalId: 'sid-K',
      externalPath: 'Lager/Kommission',
      url: null,
    });
    expect((await identityRows('ident')).length).toBe(rows);
    expect(
      (await externalIds('ident', 'signavio')).items.find((i) => i.key === 'lager/kommission'),
    ).toEqual({
      key: 'lager/kommission',
      system: 'signavio',
      externalId: 'sid-K',
      externalPath: 'Lager/Kommission',
    });
    // The identity still protects the model.
    const [moved] = await imported(
      'ident',
      [{ path: 'lager/kommissionierung.bpmn', bytes: bpmn('Kommissionierung') }],
      manifestOf([{ path: 'lager/kommissionierung.bpmn', externalId: 'sid-K' }]),
    );
    expect(moved?.importWarnings?.map((w) => [w.code, w.otherKeys])).toEqual([
      ['external-id-moved', ['lager/kommission']],
    ]);
  });

  it("accepts an export's empty or odd informational fields and stores them tidied, and stores the scope", async () => {
    // The integrate plugin 0.1.0 writes an export's exporterVersion="" as systemVersion "".
    const [file] = await imported(
      'ident',
      [{ path: 'einkauf/anfrage.bpmn', bytes: bpmn('Anfrage') }],
      manifestOf(
        [
          {
            path: 'einkauf/anfrage.bpmn',
            externalId: 'sid-E',
            externalPath: 'Einkauf/\u0000Anfrage\ud800',
            derived: { kind: 'converted', converter: '' },
          },
        ],
        { systemVersion: '', scope: ['Einkauf', 'Lager/Wareneingang'] },
      ),
    );
    expect(file).toMatchObject({ outcome: 'created' });
    const [rev] = await revisions('ident', 'einkauf/anfrage');
    expect(rev?.source).toMatchObject({
      system: 'signavio',
      scope: ['Einkauf', 'Lager/Wareneingang'],
      externalPath: 'Einkauf/ Anfrage\uFFFD',
      derived: { kind: 'converted', converter: null },
    });
    expect(rev?.source.systemVersion).toBeUndefined();
  });

  it('refuses a manifest whose values PostgreSQL cannot store, and imports none of the files', async () => {
    const before = (await storedWarnings('ident')).length;
    for (const entry of [
      { path: 'nul.bpmn', url: 'https://tool.example/a\u0000b' },
      { path: 'nul.bpmn', externalId: 'ok\ud800' },
      { path: 'nul.bpmn', url: 'https://user:secret@tool.example/x' },
    ]) {
      const res = await importFiles(
        'ident',
        [
          { path: 'nul.bpmn', bytes: bpmn('Nul') },
          { path: 'sauber.bpmn', bytes: bpmn('Sauber') },
        ],
        JSON.stringify(manifestOf([entry])),
      );
      const text = await res.text();
      expect(res.status, text).toBe(422);
      expect(JSON.parse(text)).toMatchObject({
        code: 'validation-failed',
        reason: 'invalid-manifest',
      });
    }
    expect((await storedWarnings('ident')).length).toBe(before);
  });

  it('refuses an invalid manifest before importing anything', async () => {
    const before = (await storedWarnings('ident')).length;
    for (const bad of [
      '{',
      JSON.stringify({ format: 'analyzr-import/1', source: { system: 'signavio' } }),
      JSON.stringify(manifestOf([{ path: 'x.bpmn', key: 'X' }])),
    ]) {
      const res = await importFiles('ident', [{ path: 'x.bpmn', bytes: bpmn('X') }], bad);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'validation-failed',
        reason: 'invalid-manifest',
      });
    }
    const two = new FormData();
    two.append('files', new Blob([bpmn('X')]), 'x.bpmn');
    two.append('manifest', JSON.stringify(manifestOf([])));
    two.append('manifest', JSON.stringify(manifestOf([])));
    const res = await t.asOwner('/api/v1/projects/ident/imports', { method: 'POST', body: two });
    expect(res.status).toBe(422);
    expect((await storedWarnings('ident')).length).toBe(before);
  });
});

// --------------------------------------------------------------- PUT

describe('PUT with the header Analyzr-Manifest', () => {
  const one = (entry: Record<string, unknown>, source: Record<string, unknown> = {}) => ({
    format: 'analyzr-import/1',
    source: { system: 'signavio', exportedAt: '2026-10-14T09:12Z', ...source },
    files: [{ path: 'Vertrieb/Angebot.bpmn', ...entry }],
  });

  it('stores the declared provenance on the uploaded revision (round trip)', async () => {
    const xml = bpmn('Angebot');
    const res = await put(
      'put',
      'vertrieb/angebot',
      xml,
      one({
        key: 'vertrieb/angebot',
        externalId: 'sid-A',
        externalPath: 'Vertrieb/Angebot',
        url: 'https://tool.example/sid-A',
        derived: { kind: 'export' },
        sha256: sha(xml),
      }),
    );
    expect(res.status).toBe(201);
    const result = PutModelResult.parse(await res.json());
    expect(result.importWarnings).toBeUndefined();
    expect(result.revision.source).toEqual({
      kind: 'upload',
      path: 'Vertrieb/Angebot.bpmn',
      uploader: 'human',
      manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      system: 'signavio',
      exportedAt: '2026-10-14T09:12Z',
      externalId: 'sid-A',
      externalPath: 'Vertrieb/Angebot',
      url: 'https://tool.example/sid-A',
      derived: { kind: 'export' },
      trust: NO_ENGINE,
    });
    expect((await revisions('put', 'vertrieb/angebot'))[0]?.source).toEqual(result.revision.source);
    // Without the header: kind and uploader only, as every upload since S2a.
    const plain = PutModelResult.parse(
      await (await put('put', 'vertrieb/ohne', bpmn('Ohne'))).json(),
    );
    expect(plain.revision.source).toEqual({ kind: 'upload', uploader: 'human', trust: NO_ENGINE });
    expect(plain.importWarnings).toBeUndefined();
  });

  it('answers the import warnings: a checksum mismatch and a moved tool id', async () => {
    const res = await put(
      'put',
      'vertrieb/angebot-neu',
      bpmn('AngebotNeu'),
      one({ externalId: 'sid-A', sha256: 'f'.repeat(64) }),
    );
    expect(res.status).toBe(201);
    const result = PutModelResult.parse(await res.json());
    expect(result.importWarnings?.map((w) => w.code)).toEqual([
      'manifest-sha-mismatch',
      'external-id-moved',
    ]);
  });

  it('records the folder an unchanged PUT declares; its dry run writes nothing (M6 S2b follow-up step 5)', async () => {
    const xml = bpmn('Angebot');
    const header = Buffer.from(
      JSON.stringify(
        one({
          key: 'vertrieb/angebot',
          externalId: 'sid-A',
          externalPath: 'Vertrieb/Angebote/Angebot',
          url: 'https://tool.example/sid-A',
          derived: { kind: 'export' },
          sha256: sha(xml),
        }),
      ),
      'utf8',
    ).toString('base64url');
    const request = (query: string) =>
      t.asOwner(`/api/v1/projects/put/models/by-key/vertrieb%2Fangebot${query}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/xml', 'analyzr-manifest': header },
        body: xml,
      });
    const seq = await lastSeq('put');
    const dry = await request('?dryRun=true');
    expect(dry.status).toBe(200);
    const preview = PutModelDryRunResult.parse(await dry.json());
    expect(await lastSeq('put')).toBe(seq);
    // vertrieb/angebot-neu declared sid-A too (above): both carry it.
    expect(preview).toMatchObject({ outcome: 'unchanged', dryRun: true });
    expect(preview.importWarnings?.map((w) => w.code)).toEqual(['external-id-moved']);
    const res = await request('');
    expect(res.status).toBe(200);
    const result = PutModelResult.parse(await res.json());
    expect(result.outcome).toBe('unchanged');
    expect(result.importWarnings).toEqual(preview.importWarnings);
    expect(result.model.identity).toEqual({
      system: 'signavio',
      externalId: 'sid-A',
      externalPath: 'Vertrieb/Angebote/Angebot',
      url: 'https://tool.example/sid-A',
    });
    expect((await eventsAfter('put', seq)).map((e) => e.type)).toEqual(['model.identity_declared']);
    expect(
      (await externalIds('put')).items.find((i) => i.key === 'vertrieb/angebot')?.externalPath,
    ).toBe('Vertrieb/Angebote/Angebot');
    // The revision keeps the path and folder it was stored with.
    expect((await revisions('put', 'vertrieb/angebot'))[0]?.source).toMatchObject({
      externalPath: 'Vertrieb/Angebot',
    });
  });

  it('refuses a manifest naming another key, several files, or no base64url', async () => {
    const xml = bpmn('Zwei');
    for (const [manifest, raw] of [
      [one({ key: 'vertrieb/anders' }), undefined],
      [{ ...one({}), files: [{ path: 'a.bpmn' }, { path: 'b.bpmn' }] }, undefined],
      [{ ...one({}), files: [] }, undefined],
      [undefined, 'kein base64!'],
      [undefined, Buffer.from('{').toString('base64url')],
      // What jsonb cannot hold: a lone surrogate in the path (it becomes `source.path`).
      [
        undefined,
        Buffer.from(JSON.stringify({ ...one({}), files: [{ path: 'V\ud800.bpmn' }] })).toString(
          'base64url',
        ),
      ],
    ] as const) {
      const res = await put('put', 'vertrieb/zwei', xml, manifest, raw);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'validation-failed',
        reason: 'invalid-manifest',
      });
    }
    expect(
      (await getJson<{ items: { key: string }[] }>('/api/v1/projects/put/models')).items.map(
        (m) => m.key,
      ),
    ).not.toContain('vertrieb/zwei');
  });
});

// --------------------------------------------------------------- amended heads

describe('an amended head follows source.upstream', () => {
  const API = '/api/v1/projects/amended';

  async function changeList(): Promise<string> {
    const res = await t.asOwner(`${API}/amendments/export?format=markdown`);
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(200);
    return text;
  }

  async function amendDocumentation(after: string) {
    const id = await modelId('amended', LAGER_KEY);
    const m = await getJson<{ headRev: number }>(`${API}/models/${id}`);
    const res = await t.asOwner(`${API}/models/${id}/amendments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': `"r${m.headRev}"` },
      body: JSON.stringify({
        items: [{ elementId: 'Process_Lager', op: 'process-documentation', after }],
      }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
  }

  it('keeps the provenance on the uploaded revision and reads it there', async () => {
    await imported(
      'amended',
      [{ path: 'lager/einlagerung.bpmn', bytes: lager() }],
      manifestOf([
        { path: 'lager/einlagerung.bpmn', externalId: 'sid-L', externalPath: 'Lager/Einlagerung' },
      ]),
    );
    await amendDocumentation('Lagert Ware ein.');
    const [amendedHead, uploaded] = await revisions('amended', LAGER_KEY);
    expect(amendedHead?.source).toMatchObject({ kind: 'amendment', uploader: 'human' });
    expect(amendedHead?.source.upstream?.revisionId).toBe(uploaded?.id);
    expect(amendedHead?.source.externalId).toBeUndefined();
    expect(uploaded?.source).toMatchObject({ kind: 'import', externalId: 'sid-L' });
    // the model's summary reads the uploaded revision too (UX8)
    const id = await modelId('amended', LAGER_KEY);
    expect((await getJson<{ source: unknown }>(`${API}/models/${id}`)).source).toEqual({
      system: 'signavio',
      derived: null,
      exportedAt: null,
    });
    expect((await externalIds('amended')).items).toEqual([
      {
        key: LAGER_KEY,
        system: 'signavio',
        externalId: 'sid-L',
        externalPath: 'Lager/Einlagerung',
      },
    ]);
    // The change list names where the model lives in the source tool, from upstream.
    expect(await changeList()).toContain('Im Quellsystem (signavio): Lager/Einlagerung\n');
  });

  it('puts a re-import’s provenance on the new uploaded revision; the warnings compare with upstream', async () => {
    const reexport = `${lager()}<!-- re-export -->\n`;
    const [same] = await imported(
      'amended',
      [{ path: 'lager/einlagerung.bpmn', bytes: reexport }],
      manifestOf([
        { path: 'lager/einlagerung.bpmn', externalId: 'sid-L', externalPath: 'Lager/Neu' },
      ]),
    );
    expect(same).toMatchObject({ outcome: 'revised', amendments: { applied: { count: 1 } } });
    expect(same?.importWarnings).toBeUndefined();
    const [amendedHead, uploaded] = await revisions('amended', LAGER_KEY);
    expect(amendedHead?.source.kind).toBe('amendment');
    expect(amendedHead?.source.upstream?.revisionId).toBe(uploaded?.id);
    expect(uploaded?.source).toMatchObject({ kind: 'import', externalPath: 'Lager/Neu' });
    expect((await externalIds('amended')).items[0]?.externalPath).toBe('Lager/Neu');
    expect(await changeList()).toContain('Im Quellsystem (signavio): Lager/Neu\n');
    // Another tool id against the amended head's upstream.
    const [changed] = await imported(
      'amended',
      [{ path: 'lager/einlagerung.bpmn', bytes: `${reexport}<!-- 2 -->\n` }],
      manifestOf([{ path: 'lager/einlagerung.bpmn', externalId: 'sid-X' }]),
    );
    expect(changed?.importWarnings?.map((w) => [w.code, w.previous])).toEqual([
      ['external-id-changed', { system: 'signavio', externalId: 'sid-L' }],
    ]);
  });

  it('records a moved folder for the uploaded bytes under an amended head (M6 S2b follow-up step 5)', async () => {
    const uploadedBytes = `${lager()}<!-- re-export -->\n<!-- 2 -->\n`;
    const before = await revisions('amended', LAGER_KEY);
    const head = await getModel('amended', LAGER_KEY);
    expect(before[0]?.source.kind).toBe('amendment');
    const seq = await lastSeq('amended');
    const [file] = await imported(
      'amended',
      [{ path: 'lager/einlagerung.bpmn', bytes: uploadedBytes }],
      manifestOf([
        { path: 'lager/einlagerung.bpmn', externalId: 'sid-X', externalPath: 'Lager/Umgezogen' },
      ]),
    );
    expect(file).toMatchObject({ outcome: 'unchanged', identityUpdated: true });
    expect(file?.importWarnings).toBeUndefined();
    // The amended head stays: no revision, no derivation, one event.
    expect((await eventsAfter('amended', seq)).map((e) => e.type)).toEqual([
      'model.identity_declared',
    ]);
    expect(await revisions('amended', LAGER_KEY)).toEqual(before);
    const after = await getModel('amended', LAGER_KEY);
    expect(after.headRev).toBe(head.headRev);
    expect(after.identity).toEqual({
      system: 'signavio',
      externalId: 'sid-X',
      externalPath: 'Lager/Umgezogen',
      url: null,
    });
    // The row names the uploaded revision the bytes are kept as (the head's upstream).
    expect((await identityRows('amended')).at(-1)).toMatchObject({
      kind: 'unchanged',
      revision_id: before[0]?.source.upstream?.revisionId,
    });
    // The change list points to the model where it lives now.
    expect(await changeList()).toContain('Im Quellsystem (signavio): Lager/Umgezogen\n');
  });
});

// --------------------------------------------------------------- identity rows

describe('the identity rows (M6 S2b follow-up step 5, decision 29 (1))', () => {
  /** A Camunda 7 model: a human's upload of it is modelled (M6 S2c). */
  const camunda = (id: string) =>
    bpmn(id).replace(DEFS, `${DEFS} xmlns:camunda="http://camunda.org/schema/1.0/bpmn"`);
  const keeps = (now: string) =>
    `unchanged, so its revision keeps the derivation none declared (this file: ${now}); tool ` +
    'id, folder and link go by this file; a correction needs changed bytes';

  it('gives models first uploaded without a bundle their identity when the bundle brings the same bytes', async () => {
    const { manifest, sent, files } = await readBundle();
    const first = await imported('later', files);
    expect(first.every((f) => f.outcome === 'created')).toBe(true);
    expect((await externalIds('later')).items).toEqual([]);
    const versand = await getModel('later', 'logistik/versand');
    expect(versand.identity).toBeNull();
    const result = await imported('later', files, sent);
    expect(result.map((f) => [f.modelKey, f.outcome, f.identityUpdated])).toEqual(
      manifest.files.map((f) => [f.key, 'unchanged', true]),
    );
    // The revisions keep the derivation none declared: every file says so; the class is the
    // same both ways (no engine), so no trust-kept.
    expect(result.map((f) => f.importWarnings?.map((w) => [w.code, w.message]))).toEqual(
      manifest.files.map((f) => [
        [
          'provenance-kept',
          keeps(f.derived?.kind === 'converted' ? 'converted with normalize-bpmn@0.1.0' : 'export'),
        ],
      ]),
    );
    expect(
      manifest.files.filter((f) => f.derived?.kind === 'converted').length,
    ).toBeGreaterThanOrEqual(1);
    expect((await externalIds('later', 'signavio')).items).toEqual(
      manifest.files.map((f) => ({
        key: f.key,
        system: 'signavio',
        externalId: f.externalId ?? null,
        externalPath: f.externalPath ?? null,
      })),
    );
    expect((await identityRows('later')).map((r) => r.kind)).toEqual(
      manifest.files.map(() => 'unchanged'),
    );
    const after = await getModel('later', 'logistik/versand');
    expect(after).toEqual({
      ...versand,
      identity: {
        system: 'signavio',
        externalId: 'sid-5F0E4D3C-2B1A-4F9E-8D7C-6B5A4F3E2D78',
        externalPath: 'Gemeinsame Dokumente/Logistik/Versand',
        url: null,
      },
    });
    // `Model.source` describes the bytes, which declare nothing.
    expect(after.source).toBeNull();
    // The identity now protects the model.
    const [moved] = await imported(
      'later',
      [{ path: 'logistik/versand-neu.bpmn', bytes: bpmn('VersandNeu') }],
      manifestOf([
        {
          path: 'logistik/versand-neu.bpmn',
          externalId: 'sid-5F0E4D3C-2B1A-4F9E-8D7C-6B5A4F3E2D78',
        },
      ]),
    );
    expect(moved?.importWarnings?.map((w) => [w.code, w.otherKeys])).toEqual([
      ['external-id-moved', ['logistik/versand']],
    ]);
  });

  it('records another tool id for unchanged bytes, and an entry without one (case (i))', async () => {
    const eins = bpmn('Eins');
    const zwei = bpmn('Zwei');
    const entry = (externalId?: string) => ({
      path: 'a/eins.bpmn',
      ...(externalId === undefined ? {} : { externalId }),
      externalPath: 'A/Eins',
    });
    await imported(
      'unid',
      [
        { path: 'a/eins.bpmn', bytes: eins },
        { path: 'a/zwei.bpmn', bytes: zwei },
      ],
      manifestOf([
        entry('sid-1'),
        { path: 'a/zwei.bpmn', externalId: 'sid-2', externalPath: 'A/Zwei' },
      ]),
    );
    const [renamed] = await imported(
      'unid',
      [{ path: 'a/eins.bpmn', bytes: eins }],
      manifestOf([entry('sid-NEW')]),
    );
    expect(renamed).toMatchObject({ outcome: 'unchanged', identityUpdated: true });
    expect(renamed?.importWarnings).toEqual([
      {
        code: 'external-id-changed',
        message:
          'this unchanged file (signavio id sid-NEW) now identifies a/eins, which held signavio id sid-1',
        system: 'signavio',
        externalId: 'sid-NEW',
        previous: { system: 'signavio', externalId: 'sid-1' },
      },
    ]);
    expect((await externalIds('unid')).items[0]).toEqual({
      key: 'a/eins',
      system: 'signavio',
      externalId: 'sid-NEW',
      externalPath: 'A/Eins',
    });
    // The tool id of another live key: both keys carry it afterwards.
    const [taken] = await imported(
      'unid',
      [{ path: 'a/eins.bpmn', bytes: eins }],
      manifestOf([entry('sid-2')]),
    );
    expect(
      taken?.importWarnings?.map((w) => [w.code, w.otherKeys ?? w.previous, w.message]),
    ).toEqual([
      [
        'external-id-moved',
        ['a/zwei'],
        'signavio id sid-2 already belongs to a/zwei: two models now carry it (moved or renamed in the tool?)',
      ],
      [
        'external-id-changed',
        { system: 'signavio', externalId: 'sid-NEW' },
        'this unchanged file (signavio id sid-2) now identifies a/eins, which held signavio id sid-NEW',
      ],
    ]);
    expect((await externalIds('unid')).items.map((i) => [i.key, i.externalId])).toEqual([
      ['a/eins', 'sid-2'],
      ['a/zwei', 'sid-2'],
    ]);
    // An entry without a tool id replaces the identity whole, silently; the key stays listed.
    const [noId] = await imported(
      'unid',
      [{ path: 'a/eins.bpmn', bytes: eins }],
      manifestOf([entry()]),
    );
    expect(noId).toMatchObject({ outcome: 'unchanged', identityUpdated: true });
    expect(noId?.importWarnings).toBeUndefined();
    expect((await externalIds('unid', 'signavio')).items[0]).toEqual({
      key: 'a/eins',
      system: 'signavio',
      externalId: null,
      externalPath: 'A/Eins',
    });
    expect((await identityRows('unid')).map((r) => [r.key, r.kind, r.external_id])).toEqual([
      ['a/eins', 'revision', 'sid-1'],
      ['a/eins', 'unchanged', 'sid-NEW'],
      ['a/eins', 'unchanged', 'sid-2'],
      ['a/eins', 'unchanged', null],
      ['a/zwei', 'revision', 'sid-2'],
    ]);
  });

  it('keeps rows across a deletion: the change list names the last place, a revival without a manifest the identity before', async () => {
    const API = '/api/v1/projects/revived';
    const declare = (externalPath: string) =>
      manifestOf([{ path: 'lager/einlagerung.bpmn', externalId: 'sid-R', externalPath }]);
    const [created] = await imported(
      'revived',
      [{ path: 'lager/einlagerung.bpmn', bytes: lager() }],
      declare('Lager/Alt'),
    );
    expect(created?.outcome).toBe('created');
    const id = await modelId('revived', LAGER_KEY);
    const amend = await t.asOwner(`${API}/models/${id}/amendments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': '"r1"' },
      body: JSON.stringify({
        items: [{ elementId: 'Process_Lager', op: 'process-documentation', after: 'Neu.' }],
      }),
    });
    expect(amend.status, await amend.clone().text()).toBe(201);
    const [moved] = await imported(
      'revived',
      [{ path: 'lager/einlagerung.bpmn', bytes: lager() }],
      declare('Lager/Neu'),
    );
    expect(moved).toMatchObject({ outcome: 'unchanged', identityUpdated: true });
    expect((await t.asOwner(`${API}/models/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await externalIds('revived')).items).toEqual([]);
    const changeList = await t.asOwner(`${API}/amendments/export?format=markdown`);
    expect(changeList.status).toBe(200);
    expect(await changeList.text()).toContain('Im Quellsystem (signavio): Lager/Neu\n');
    // Revived without a manifest: the newest row from before the deletion is its identity.
    const revived = await put('revived', LAGER_KEY, lager());
    expect(revived.status).toBe(201);
    expect(PutModelResult.parse(await revived.json()).model.identity?.externalPath).toBe(
      'Lager/Neu',
    );
    expect((await externalIds('revived')).items.map((i) => i.externalPath)).toEqual(['Lager/Neu']);
    // Deleted and revived with a manifest: the new one.
    expect((await t.asOwner(`${API}/models/${id}`, { method: 'DELETE' })).status).toBe(204);
    const [again] = await imported(
      'revived',
      [{ path: 'lager/einlagerung.bpmn', bytes: `${lager()}<!-- wieder -->\n` }],
      declare('Lager/Wieder'),
    );
    expect(again?.outcome).toBe('created');
    expect((await externalIds('revived')).items.map((i) => i.externalPath)).toEqual([
      'Lager/Wieder',
    ]);
    expect((await identityRows('revived')).map((r) => [r.kind, r.external_path])).toEqual([
      ['revision', 'Lager/Alt'],
      ['unchanged', 'Lager/Neu'],
      ['revision', 'Lager/Wieder'],
    ]);
  });

  it('records an agent token’s declaration under its principal; the class stays the uploaded revision’s', async () => {
    const xml = camunda('Agent');
    const [created] = await imported(
      'agent',
      [{ path: 'agent/modell.bpmn', bytes: xml }],
      manifestOf([
        {
          path: 'agent/modell.bpmn',
          externalId: 'sid-G',
          externalPath: 'Agent/Alt',
          derived: { kind: 'export' },
        },
      ]),
    );
    expect(created?.outcome).toBe('created');
    const before = await getModel('agent', 'agent/modell');
    expect(before.trust).toMatchObject({ class: 'modelled' });
    const token = await t.createToken('agent', ['analyzr:read', 'analyzr:write']);
    const form = new FormData();
    form.append('files', new Blob([xml]), 'agent/modell.bpmn');
    form.append(
      'manifest',
      JSON.stringify(
        manifestOf([
          {
            path: 'agent/modell.bpmn',
            externalId: 'sid-G',
            externalPath: 'Agent/Neu',
            derived: { kind: 'converted', converter: 'normalize-bpmn@0.1.0' },
          },
        ]),
      ),
    );
    const res = await t.asToken(token.secret, '/api/v1/projects/agent/imports', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(200);
    const [file] = ImportResult.parse(await res.json()).files;
    expect(file).toMatchObject({ outcome: 'unchanged', identityUpdated: true });
    // trust-kept speaks for the derivation too: no provenance-kept next to it.
    expect(file?.importWarnings?.map((w) => w.code)).toEqual(['trust-kept']);
    const after = await getModel('agent', 'agent/modell');
    expect(after.trust).toEqual(before.trust);
    expect(after.source).toEqual(before.source);
    expect(after.identity?.externalPath).toBe('Agent/Neu');
    const row = (await identityRows('agent')).at(-1);
    expect(row).toMatchObject({ kind: 'unchanged', principal_id: token.principalId });
    expect(row?.principal_id).not.toBe((await identityRows('agent'))[0]?.principal_id);
  });

  it('says the derivation stays beside a trust-kept for another credential, and keeps a file at four warnings', async () => {
    const path = 'kredit/antrag.bpmn';
    const xml = camunda('Antrag');
    // The owner's model holding sid-K, and an agent token's PUT of Camunda bytes declaring sid-A
    // but no derivation: derived (agent-upload), its derivation none declared.
    await imported(
      'credential',
      [{ path: 'kredit/konto.bpmn', bytes: camunda('Konto') }],
      manifestOf([{ path: 'kredit/konto.bpmn', externalId: 'sid-K' }]),
    );
    const agent = await t.createToken('credential', ['analyzr:read', 'analyzr:write']);
    const created = await t.asToken(
      agent.secret,
      `/api/v1/projects/credential/models/by-key/${encodeURIComponent('kredit/antrag')}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/xml',
          'analyzr-manifest': Buffer.from(
            JSON.stringify(manifestOf([{ path, externalId: 'sid-A' }])),
            'utf8',
          ).toString('base64url'),
        },
        body: xml,
      },
    );
    expect(created.status).toBe(201);
    expect((await getModel('credential', 'kredit/antrag')).trust).toMatchObject({
      class: 'derived',
      reasons: ['agent-upload'],
      derivedKind: null,
    });
    const trustKept =
      "unchanged, so analyzr keeps the model's trust class derived (agent-upload); this request " +
      'would make it modelled; a reclassification needs changed bytes';
    // The owner's bundle declares an export: trust-kept says nothing of the derivation, so
    // provenance-kept says it stays none declared (the owner's „Ohne Angabe“ rules take its calls).
    const exported = manifestOf([{ path, externalId: 'sid-A', derived: { kind: 'export' } }]);
    const both = await dryRun('credential', [{ path, bytes: xml }], exported);
    expect(both.files[0]?.importWarnings?.map((w) => [w.code, w.message])).toEqual([
      ['provenance-kept', keeps('export')],
      ['trust-kept', trustKept],
    ]);
    expect(await imported('credential', [{ path, bytes: xml }], exported)).toEqual(both.files);
    // The owner's modelled Konto under the same export: a read-only token's dry run classifies
    // by its own credential (trust-kept), and says the same provenance-kept as the owner's.
    const konto = [{ path: 'kredit/konto.bpmn', bytes: camunda('Konto') }];
    const kontoExported = manifestOf([
      { path: 'kredit/konto.bpmn', externalId: 'sid-K', derived: { kind: 'export' } },
    ]);
    const reader = await t.createToken('credential', ['analyzr:read']);
    const form = new FormData();
    for (const f of konto) form.append('files', new Blob([f.bytes]), f.path);
    form.append('manifest', JSON.stringify(kontoExported));
    const read = await t.asToken(reader.secret, '/api/v1/projects/credential/imports?dryRun=true', {
      method: 'POST',
      body: form,
    });
    expect(read.status).toBe(200);
    expect(
      ImportResult.parse(await read.json()).files[0]?.importWarnings?.map((w) => w.code),
    ).toEqual(['provenance-kept', 'trust-kept']);
    expect(
      (await dryRun('credential', konto, kontoExported)).files[0]?.importWarnings?.map(
        (w) => w.code,
      ),
    ).toEqual(['provenance-kept']);
    // Five candidates: a wrong checksum, another key's tool id that differs from its own, the
    // export and trust-kept; provenance-kept goes, so the file keeps the contract's four.
    const five = manifestOf([
      { path, externalId: 'sid-K', sha256: '0'.repeat(64), derived: { kind: 'export' } },
    ]);
    const capped = await dryRun('credential', [{ path, bytes: xml }], five);
    expect(capped.files[0]?.importWarnings?.map((w) => w.code)).toEqual([
      'manifest-sha-mismatch',
      'external-id-moved',
      'external-id-changed',
      'trust-kept',
    ]);
    expect(await imported('credential', [{ path, bytes: xml }], five)).toEqual(capped.files);
  });

  it('is append-only, and its guard refuses rows that do not match their revision or event', async () => {
    const revision = async (project: string, key: string, where = 'true') => {
      const rows = await database.db.execute<{
        id: string;
        project_id: string;
        model_id: string;
        seq: string;
      }>(
        sql.raw(`
          select r.id, r.project_id, r.model_id, r.seq from model_revision r
          join model m on m.project_id = r.project_id and m.id = r.model_id
          join project p on p.id = r.project_id
          where p.key = '${project}' and m.key = '${key}' and ${where}
          order by r.seq desc limit 1`),
      );
      const row = rows.rows[0];
      if (!row) throw new Error(`no revision of ${project} ${key}`);
      return row;
    };
    const declared = await revision('unid', 'a/zwei');
    const other = await revision('unid', 'a/eins');
    const amendedRev = await revision('amended', LAGER_KEY, `r.source->>'kind' = 'amendment'`);
    const undeclared = await revision('later', 'logistik/versand');
    const [eventRow] = (
      await database.db.execute<{ seq: string }>(
        sql.raw(
          `select seq from event where project_id = '${declared.project_id}' and type = 'model.identity_declared' limit 1`,
        ),
      )
    ).rows;
    const row = (r: typeof declared, columns: Record<string, string> = {}): string => {
      const values: Record<string, string> = {
        project_id: `'${r.project_id}'`,
        model_id: `'${r.model_id}'`,
        seq: r.seq,
        revision_id: `'${r.id}'`,
        kind: `'revision'`,
        system: `'signavio'`,
        external_id: `'sid-2'`,
        external_path: `'A/Zwei'`,
        url: 'NULL',
        principal_id: `(select principal_id from model_revision where id = '${r.id}')`,
        ...columns,
      };
      return `INSERT INTO model_identity (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`;
    };
    // An unchanged row exactly as its event (a/eins's sid-NEW) declared it: the guard passes it
    // and the primary key refuses it, as the row is there; any field off its event, the guard.
    const event = `(select %s from event where project_id = '${other.project_id}' and seq = ${eventRow?.seq ?? '0'})`;
    const onEvent = (columns: Record<string, string> = {}) =>
      row(other, {
        kind: `'unchanged'`,
        seq: eventRow?.seq ?? '0',
        external_id: `'sid-NEW'`,
        external_path: `'A/Eins'`,
        principal_id: event.replace('%s', 'principal_id'),
        client_id: event.replace('%s', 'client_id'),
        ...columns,
      });
    // A fake event naming a revision of the revived model (dropped again with the statement,
    // which `select 1/0` fails when the guard passes): only the revision its unchanged bytes are
    // kept as, its amended head's upstream, takes a row.
    const kept = await revision(
      'revived',
      LAGER_KEY,
      `r.source->>'kind' is distinct from 'amendment'`,
    );
    const first = await revision('revived', LAGER_KEY, 'r.rev = 1');
    const onFakeEvent = (r: typeof kept) => {
      const seq = `(select max(seq) from event where project_id = '${r.project_id}')`;
      const principal = `(select principal_id from model_revision where id = '${r.id}')`;
      return (
        `INSERT INTO event (project_id, seq, type, principal_id, subject_ref, payload) VALUES ` +
        `('${r.project_id}', ${seq} + 1, 'model.identity_declared', ${principal}, '${LAGER_KEY}', ` +
        `jsonb_build_object('modelId', '${r.model_id}', 'revisionId', '${r.id}', 'system', 'signavio', 'externalId', 'sid-R'));\n` +
        `${row(r, { kind: `'unchanged'`, seq, external_id: `'sid-R'`, external_path: `'Lager/X'`, principal_id: principal })};\n` +
        'select 1/0'
      );
    };
    for (const [statement, message] of [
      ['UPDATE model_identity SET url = url', /model_identity is append-only: UPDATE/],
      ['DELETE FROM model_identity', /model_identity is append-only: DELETE/],
      ['TRUNCATE model_identity', /model_identity is append-only: TRUNCATE/],
      [onEvent(), /^model_identity_pk$/],
      [onEvent({ external_id: `'sid-other'` }), /^model_identity: revision/],
      [onEvent({ system: `'aris'` }), /^model_identity: revision/],
      [
        onEvent({
          principal_id: `(select id from principal where id <> ${event.replace('%s', 'principal_id')} limit 1)`,
        }),
        /^model_identity: revision/,
      ],
      [onEvent({ client_id: `'another-client'` }), /^model_identity: revision/],
      // the revived model's upload under its amended head passes, its first upload does not
      [onFakeEvent(kept), /^division by zero$/],
      [onFakeEvent(first), /^model_identity: revision/],
      // a revision row by another principal than its revision's
      [
        row(declared, {
          principal_id: `(select id from principal where id <> (select principal_id from model_revision where id = '${declared.id}') limit 1)`,
        }),
        /^model_identity: revision/,
      ],
      // an amended revision
      [
        row(amendedRev, { external_id: 'NULL', external_path: 'NULL' }),
        /^model_identity: revision/,
      ],
      // another model's revision
      [
        row(other, {
          model_id: `'${declared.model_id}'`,
          kind: `'unchanged'`,
          seq: eventRow?.seq ?? '0',
        }),
        /^model_identity: revision/,
      ],
      // a revision row off its revision's seq, or with other fields
      [row(declared, { seq: `${declared.seq} + 1000` }), /^model_identity: revision/],
      [row(declared, { external_path: `'B/Zwei'` }), /^model_identity: revision/],
      [row(declared, { url: `'https://t.example/x'` }), /^model_identity: revision/],
      // an undeclared revision
      [
        row(undeclared, { external_id: 'NULL', external_path: 'NULL' }),
        /^model_identity: revision/,
      ],
      // an unchanged row whose seq is no model.identity_declared event (here: model.revised)
      [row(declared, { kind: `'unchanged'` }), /^model_identity: revision/],
      [row(declared, { kind: `'other'`, seq: '999999' }), /^model_identity_kind_check$/],
      // a second row of one stored revision: the guard pins its seq to the revision's, so the
      // primary key refuses it (before model_identity_revision_unique)
      [row(declared), /^model_identity_pk$/],
    ] as const) {
      expect(await failure(statement), statement).toMatch(message);
    }
    // The guard's error class is a check violation.
    try {
      await database.db.execute(sql.raw(row(declared, { url: `'https://t.example/x'` })));
      throw new Error('inserted');
    } catch (err) {
      expect((err as { cause?: { code?: string } }).cause?.code).toBe('23514');
    }
  });
});

// --------------------------------------------------------------- warnings

describe('stored extractor warnings and extractor-loss', () => {
  const duplicate = bpmn(
    'Doppelt',
    'Erst',
    '\n    <bpmn:task id="Task_Doppelt" name="Zweit"/>\n    <bpmn:unknownThing id="U_1"/>',
  );
  const illegal = bpmn('Illegal', 'Gut', '\n    <bpmn:task id="Aufgabe_Bonität" name="Prüfen"/>');

  it('writes the warnings at insert and asks about the lost elements', async () => {
    const result = await imported('loss', [
      { path: 'test/doppelt.bpmn', bytes: duplicate },
      { path: 'test/illegal.bpmn', bytes: illegal },
      { path: 'test/sauber.bpmn', bytes: bpmn('Sauber') },
    ]);
    expect(result.map((f) => [f.modelKey, f.warningCount ?? 0])).toEqual([
      ['test/doppelt', 2],
      ['test/illegal', 1],
      ['test/sauber', 0],
    ]);
    const stored = await storedWarnings('loss');
    expect(
      stored.map((r) => [r.key, (r.warnings as { code: string }[]).map((w) => w.code)]),
    ).toEqual([
      ['test/doppelt', ['parse-warning', 'parse-warning']],
      ['test/illegal', ['parse-warning']],
      ['test/sauber', []],
    ]);
    const page = OpenQuestionPage.parse(
      await getJson('/api/v1/projects/loss/open-questions?kind=extractor-loss&limit=200'),
    );
    const items: OpenQuestion[] = page.items;
    expect(items.map((q) => [q.subject.id, q.source])).toEqual([
      ['test/doppelt', 'signal'],
      ['test/illegal', 'signal'],
    ]);
    expect(items[0]?.detail).toContain(
      '2 Elemente übersprungen: doppelte ID „Task_Doppelt“; nicht lesbares Element „bpmn:unknownThing“.',
    );
    expect(items[1]?.detail).toContain('ein Element übersprungen: ungültige ID „Aufgabe_Bonität“.');
  });

  it('drops the question once a clean export replaces the model', async () => {
    await imported('loss', [{ path: 'test/doppelt.bpmn', bytes: bpmn('Doppelt', 'Repariert') }]);
    const page = OpenQuestionPage.parse(
      await getJson('/api/v1/projects/loss/open-questions?kind=extractor-loss&limit=200'),
    );
    expect(page.items.map((q) => q.subject.id)).toEqual(['test/illegal']);
  });
});

describe('migration 0017 on a database with revisions', () => {
  it('leaves the revisions stored before it without warnings (null)', async () => {
    const name = `analyzr_mig17_${randomBytes(6).toString('hex')}`;
    const admin = async (statement: string) => {
      const client = new pg.Client({ connectionString: inject('adminDatabaseUrl') });
      await client.connect();
      try {
        await client.query(statement);
      } finally {
        await client.end();
      }
    };
    await admin(`CREATE DATABASE "${name}"`);
    const url = new URL(inject('adminDatabaseUrl'));
    url.pathname = `/${name}`;
    const db = createDatabase(url.toString(), { max: 2 });
    const before = await mkdtemp(join(tmpdir(), 'analyzr-mig17-'));
    try {
      await cp(MIGRATIONS_DIR, before, { recursive: true });
      const journalPath = join(before, 'meta', '_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
        entries: { tag: string }[];
      };
      journal.entries = journal.entries.filter((e) => e.tag < '0017');
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(db.db, { migrationsFolder: before });
      const P = 'prj_01J9Z3N4X5Q6R7S8T9V0W1X2M7';
      const OWNER = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2M7';
      await db.db.execute(
        sql.raw(`
          INSERT INTO project (id, key, name) VALUES ('${P}', 'mig17', 'Migration 17');
          INSERT INTO principal (id, kind, iss, subject, handle) VALUES ('${OWNER}', 'user', 'urn:analyzr:local', 'owner', 'owner');
          INSERT INTO model (id, project_id, key, name) VALUES ('mdl_m17', '${P}', 'a/b', 'B');
          INSERT INTO model_revision (id, project_id, model_id, rev, xml, content_hash, facts_hash, facts_version,
                                      processes, message_flows, source, principal_id, seq)
            VALUES ('rev_m17', '${P}', 'mdl_m17', 1, '\\x3c782f3e', 'c', 'f', '1', '[]', '[]',
                    '{"kind":"import","path":"a/b.bpmn"}', '${OWNER}', 1);
        `),
      );
      await runMigrations(db.db);
      const rows = await db.db.execute(
        sql.raw(`SELECT id, extract_warnings, source FROM model_revision`),
      );
      expect(rows.rows).toEqual([
        { id: 'rev_m17', extract_warnings: null, source: { kind: 'import', path: 'a/b.bpmn' } },
      ]);
    } finally {
      await db.close();
      await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await rm(before, { recursive: true, force: true });
    }
  });
});
